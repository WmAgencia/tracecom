/**
 * PRACTICE_FOUR_WAY_3X_TEST_V1 â€” harness ISOLADO de execucao experimental.
 *
 * Invariantes:
 *  - NAO existe segundo caminho de broker: ordens so saem via runtime.requestOrder (mesmo Execution Gate).
 *  - PRACTICE_ONLY=true hard-coded; REAL nunca e tocado; arm e independente do REAL ARM.
 *  - Default DRY_RUN: registra WOULD_EXECUTE e NAO chama requestOrder.
 *  - Cap por estrategia (3) e total (12) com reserva ATOMICA em Postgres; idempotencia por chave.
 *  - Falha em qualquer guard => BLOCK/FAILED_SAFE; auto-disarm em mudanca de conta/kill/DB.
 */
import crypto from "node:crypto";

export const EXPERIMENT_ID = "PRACTICE_FIVE_WAY_3X_TEST_V1";
export const EXPERIMENT_STRATEGIES = Object.freeze(["PROFESSIONAL_BRAIN_G2", "PROFESSIONAL_AGENT_SYSTEM_V4", "DUAL_REASONING_V1", "SOLO_REASONING_V1", "INDICATOR_5M_V1"]);
export const ARM_PHRASE = "CONTA PRACTICE â†’ ARMAR EXPERIMENTO 4X3";
export const MAX_PER_STRATEGY = 3;
export const MAX_TOTAL = 15;
export const PRACTICE_ONLY = true;
export const EXPERIMENT_STATES = Object.freeze(["CREATED", "DRY_RUN", "READY_TO_ARM", "ARMED_PRACTICE", "RUNNING", "COMPLETE", "STOPPED", "FAILED_SAFE"]);
export const EXPERIMENT_EVENTS = Object.freeze(["EXPERIMENT_CREATED", "DRY_RUN_STARTED", "WOULD_EXECUTE", "ARM_REQUESTED", "ARMED", "DECISION_RECEIVED", "ORDER_REQUESTED", "ORDER_BLOCKED", "BROKER_ACCEPTED", "BROKER_REJECTED", "SETTLED", "STRATEGY_COMPLETE", "EXPERIMENT_COMPLETE", "STOPPED", "FAILED_SAFE"]);

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const nowMs = () => Date.now();

export function validateExperimentGuards({
  state = null,
  accountContext = null,
  brokerAccountType = null,
  realState = null,
  realTradingEnabled = false,
  killSwitchEngaged = false,
  brokerConnected = false,
  dataQuality = "UNKNOWN",
  marketValid = false,
  stake = null,
  strategyCount = 0,
  totalCount = 0,
} = {}) {
  const errors = [];
  if (PRACTICE_ONLY !== true) errors.push("PRACTICE_ONLY_GUARD_BROKEN");
  if (state !== "ARMED_PRACTICE" && state !== "RUNNING") errors.push(`NOT_ARMED:${String(state)}`);
  if (String(accountContext).toUpperCase() !== "PRACTICE") errors.push(`ACCOUNT_CONTEXT_NOT_PRACTICE:${String(accountContext)}`);
  if (brokerAccountType !== null && String(brokerAccountType).toUpperCase() !== "PRACTICE") errors.push(`BROKER_ACCOUNT_NOT_PRACTICE:${String(brokerAccountType)}`);
  if (realState !== null && realState !== "LOCKED") errors.push(`REAL_NOT_LOCKED:${String(realState)}`);
  if (realTradingEnabled === true) errors.push("REAL_TRADING_ENABLED_DOES_NOT_AUTHORIZE_EXPERIMENT");
  if (killSwitchEngaged === true) errors.push("KILL_SWITCH_ENGAGED");
  if (brokerConnected !== true) errors.push("BROKER_DISCONNECTED");
  if (String(dataQuality).toUpperCase() === "UNSAFE") errors.push("DATA_QUALITY_UNSAFE");
  if (marketValid !== true) errors.push("MARKET_INVALID");
  if (!Number.isFinite(Number(stake)) || Number(stake) <= 0) errors.push("STAKE_INVALID");
  if (strategyCount >= MAX_PER_STRATEGY) errors.push("EXPERIMENT_STRATEGY_CAP_REACHED");
  if (totalCount >= MAX_TOTAL) errors.push("EXPERIMENT_TOTAL_CAP_REACHED");
  return { ok: errors.length === 0, errors };
}

export function buildIdempotencyKey({ strategyId, opportunityId, direction, decisionId = null }) {
  return `exp4x3:${strategyId}:${opportunityId}:${direction}:${decisionId ?? "auto"}`;
}

export class FourWayExperiment {
  constructor({ pool = null, runtime = null, now = nowMs, log = () => {}, minStakeBrl = 1 } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.minStakeBrl = Number(minStakeBrl) || 1;
    this.memory = { state: "DRY_RUN", counters: new Map(EXPERIMENT_STRATEGIES.map((strategy) => [strategy, { executed: 0, reserved: 0 }])), executions: new Map(), events: [] };
    this.lastError = null;
  }

  get persistent() { return Boolean(this.pool?.query); }

  async ensureCreated() {
    if (!this.persistent) return { state: this.memory.state };
    try {
      await this.pool.query(
        `INSERT INTO iq_execution_experiments(id, state, max_total, min_stake_brl) VALUES($1,'DRY_RUN',$2,$3) ON CONFLICT(id) DO NOTHING`,
        [EXPERIMENT_ID, MAX_TOTAL, this.minStakeBrl],
      );
      for (const strategy of EXPERIMENT_STRATEGIES) {
        await this.pool.query(
          `INSERT INTO iq_experiment_strategy_state(experiment_id, strategy_id, max_executions) VALUES($1,$2,$3) ON CONFLICT(experiment_id, strategy_id) DO NOTHING`,
          [EXPERIMENT_ID, strategy, MAX_PER_STRATEGY],
        );
      }
      return { state: (await this.#experimentRow())?.state ?? "DRY_RUN" };
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 160); return { state: null, error: this.lastError }; }
  }

  async #experimentRow() {
    if (!this.persistent) return { id: EXPERIMENT_ID, state: this.memory.state };
    const rows = await this.pool.query(`SELECT * FROM iq_execution_experiments WHERE id=$1`, [EXPERIMENT_ID]).then((r) => r.rows).catch(() => []);
    return rows[0] ?? null;
  }

  async #counters() {
    if (!this.persistent) return [...this.memory.counters.entries()].map(([strategyId, value]) => ({ strategy_id: strategyId, executed_count: value.executed, reserved_count: value.reserved, max_executions: MAX_PER_STRATEGY }));
    return this.pool.query(`SELECT strategy_id, executed_count, reserved_count, max_executions FROM iq_experiment_strategy_state WHERE experiment_id=$1 ORDER BY strategy_id`, [EXPERIMENT_ID]).then((r) => r.rows).catch(() => []);
  }

  async #setState(nextState, { reason = null, actor = "system" } = {}) {
    if (!EXPERIMENT_STATES.includes(nextState)) throw new Error(`EXPERIMENT_STATE_INVALID:${nextState}`);
    if (this.persistent) await this.pool.query(`UPDATE iq_execution_experiments SET state=$2, stopped_reason=COALESCE($3, stopped_reason), updated_at=now() WHERE id=$1`, [EXPERIMENT_ID, nextState, reason]);
    this.memory.state = nextState;
    await this.#audit(nextState === "ARMED_PRACTICE" ? "ARMED" : nextState === "STOPPED" ? "STOPPED" : nextState === "COMPLETE" ? "EXPERIMENT_COMPLETE" : "EXPERIMENT_CREATED", { state: nextState, reason, actor });
    return { state: nextState, reason };
  }

  async #audit(eventType, payload = {}, strategyId = null) {
    if (!EXPERIMENT_EVENTS.includes(eventType)) return;
    if (this.persistent) await this.pool.query(`INSERT INTO iq_experiment_events(experiment_id, event_type, strategy_id, payload) VALUES($1,$2,$3,$4::jsonb)`, [EXPERIMENT_ID, eventType, strategyId, JSON.stringify(payload)]).catch(() => undefined);
    this.memory.events.push({ at: this.now(), eventType, strategyId, payload });
    if (this.memory.events.length > 500) this.memory.events.splice(0, this.memory.events.length - 500);
  }

  /** DRY_RUN -> READY_TO_ARM somente com preflight limpo. */
  async prepare({ preflight = null } = {}) {
    await this.ensureCreated();
    const current = await this.#experimentRow();
    if (!current) return { ok: false, error: "EXPERIMENT_ROW_MISSING" };
    if (!["DRY_RUN", "CREATED"].includes(current.state)) return { ok: false, error: `STATE_NOT_PREPARABLE:${current.state}` };
    const checks = {
      practiceAccount: String(preflight?.accountContext ?? "").toUpperCase() === "PRACTICE",
      brokerConnected: preflight?.brokerConnected === true,
      realLocked: preflight?.realState === "LOCKED",
      killSwitchOff: preflight?.killSwitchEngaged !== true,
      minStakeAccepted: Number(preflight?.minStakeBrl) > 0,
      dataQualityOk: String(preflight?.dataQuality ?? "").toUpperCase() !== "UNSAFE",
      countersZero: (preflight?.totalCount ?? 0) === 0,
    };
    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (failed.length) { await this.#audit("ORDER_BLOCKED", { stage: "PREPARE", failed }); return { ok: false, error: "PREPARE_FAILED", failed }; }
    if (this.persistent) await this.pool.query(`UPDATE iq_execution_experiments SET state='READY_TO_ARM', min_stake_brl=$2, updated_at=now() WHERE id=$1`, [EXPERIMENT_ID, Number(preflight?.minStakeBrl) || this.minStakeBrl]);
    await this.#setState("READY_TO_ARM", { actor: "prepare" });
    await this.#audit("DRY_RUN_STARTED", { note: "preflight ok; DRY_RUN continua ate ARM explicito." });
    return { ok: true, state: "READY_TO_ARM", checks };
  }

  /** ARM exige frase exata + guards completos. Nunca usa REAL ARM. */
  async arm({ phrase = "", actor = "manual", preflight = null } = {}) {
    await this.#audit("ARM_REQUESTED", { actor });
    const current = await this.#experimentRow();
    if (!current) return { ok: false, error: "EXPERIMENT_ROW_MISSING" };
    if (phrase !== ARM_PHRASE) return { ok: false, error: "ARM_PHRASE_INVALID" };
    if (!["READY_TO_ARM", "DRY_RUN"].includes(current.state)) return { ok: false, error: `STATE_NOT_ARMABLE:${current.state}` };
    const guards = validateExperimentGuards({
      state: "ARMED_PRACTICE", accountContext: preflight?.accountContext, brokerAccountType: preflight?.brokerAccountType,
      realState: preflight?.realState, realTradingEnabled: preflight?.realTradingEnabled === true,
      killSwitchEngaged: preflight?.killSwitchEngaged === true, brokerConnected: preflight?.brokerConnected === true,
      dataQuality: preflight?.dataQuality, marketValid: true, stake: preflight?.minStakeBrl,
      strategyCount: 0, totalCount: preflight?.totalCount ?? 0,
    });
    if (!guards.ok) { await this.#audit("ORDER_BLOCKED", { stage: "ARM", errors: guards.errors }); return { ok: false, error: "ARM_GUARDS_FAILED", errors: guards.errors }; }
    if (this.persistent) await this.pool.query(`UPDATE iq_execution_experiments SET state='ARMED_PRACTICE', arm_phrase_hash=$2, armed_by=$3, armed_at=now(), min_stake_brl=$4, updated_at=now() WHERE id=$1`, [EXPERIMENT_ID, sha256(phrase), String(actor).slice(0, 60), Number(preflight?.minStakeBrl) || this.minStakeBrl]);
    await this.#setState("ARMED_PRACTICE", { actor });
    return { ok: true, state: "ARMED_PRACTICE" };
  }

  async stop(reason = "MANUAL_STOP", { actor = "manual" } = {}) {
    await this.#setState("STOPPED", { reason, actor });
    return { ok: true, state: "STOPPED", reason };
  }

  async failSafe(reason, detail = {}) { await this.#audit("FAILED_SAFE", { reason, ...detail }); return this.#setState("FAILED_SAFE", { reason, actor: "guard" }); }

  /** Reserva ATOMICA do slot: UPDATE condicional (lock de linha no Postgres). */
  async #reserveSlot(strategyId) {
    if (!this.persistent) {
      const counter = this.memory.counters.get(strategyId) ?? { executed: 0, reserved: 0 };
      if (counter.executed + counter.reserved >= MAX_PER_STRATEGY) return { ok: false, error: "EXPERIMENT_STRATEGY_CAP_REACHED" };
      counter.reserved += 1; this.memory.counters.set(strategyId, counter);
      return { ok: true, executed: counter.executed, reserved: counter.reserved };
    }
    const rows = await this.pool.query(
      `UPDATE iq_experiment_strategy_state SET reserved_count = reserved_count + 1, updated_at=now()
        WHERE experiment_id=$1 AND strategy_id=$2 AND executed_count + reserved_count < max_executions
        RETURNING executed_count, reserved_count`,
      [EXPERIMENT_ID, strategyId],
    ).then((r) => r.rows).catch(() => []);
    if (!rows.length) {
      const total = await this.#totalCount();
      return { ok: false, error: total >= MAX_TOTAL ? "EXPERIMENT_TOTAL_CAP_REACHED" : "EXPERIMENT_STRATEGY_CAP_REACHED" };
    }
    return { ok: true, executed: rows[0].executed_count, reserved: rows[0].reserved_count };
  }

  async #releaseSlot(strategyId, { accepted = false } = {}) {
    if (!this.persistent) {
      const counter = this.memory.counters.get(strategyId); if (!counter) return;
      counter.reserved = Math.max(0, counter.reserved - 1); if (accepted) counter.executed += 1;
      this.memory.counters.set(strategyId, counter); return;
    }
    await this.pool.query(
      `UPDATE iq_experiment_strategy_state SET reserved_count = GREATEST(0, reserved_count - 1), executed_count = executed_count + $3, updated_at=now() WHERE experiment_id=$1 AND strategy_id=$2`,
      [EXPERIMENT_ID, strategyId, accepted ? 1 : 0],
    ).catch(() => undefined);
  }

  async #totalCount() { const counters = await this.#counters(); return counters.reduce((sum, row) => sum + Number(row.executed_count ?? 0), 0); }

  /** Recebe a decisao final existente da arquitetura; NUNCA altera a decisao. */
  async observeDecision({ strategyId, opportunityId, decisionId = null, marketKey = null, marketType = null, direction = null, scenario = null, whyNow = null, targetEntryAt = null, targetExpiryAt = null, payout = null, snapshot = null } = {}) {
    if (!EXPERIMENT_STRATEGIES.includes(strategyId)) return { ok: false, error: "STRATEGY_NOT_IN_EXPERIMENT" };
    await this.#audit("DECISION_RECEIVED", { opportunityId, direction, scenario }, strategyId);
    if (direction !== "BUY" && direction !== "SELL") return { ok: true, wouldExecute: false, reason: "WAIT_NEVER_EXECUTES" };
    return this.tryForward({ strategyId, opportunityId, decisionId, marketKey, marketType, direction, scenario, whyNow, targetEntryAt, targetExpiryAt, payout, snapshot });
  }

  /** Encaminha para o MESMO requestOrder (Execution Gate) somente se ARMED e guards OK. */
  async tryForward({ strategyId, opportunityId, decisionId = null, marketKey = null, marketType = null, direction = null, scenario = null, whyNow = null, targetEntryAt = null, targetExpiryAt = null, payout = null, snapshot = null, context = null } = {}) {
    await this.ensureCreated();
    const row = await this.#experimentRow();
    const state = row?.state ?? this.memory.state;
    const counters = await this.#counters();
    const strategyCount = Number(counters.find((c) => c.strategy_id === strategyId)?.executed_count ?? 0) + Number(counters.find((c) => c.strategy_id === strategyId)?.reserved_count ?? 0);
    const totalCount = counters.reduce((sum, c) => sum + Number(c.executed_count ?? 0), 0);
    const idempotencyKey = buildIdempotencyKey({ strategyId, opportunityId, direction, decisionId });
    if (this.persistent) {
      const existing = await this.pool.query(`SELECT status FROM iq_experiment_executions WHERE experiment_id=$1 AND idempotency_key=$2`, [EXPERIMENT_ID, idempotencyKey]).then((r) => r.rows).catch(() => []);
      if (existing.length) return { ok: true, executed: false, duplicate: true, idempotencyKey };
    } else if (this.memory.executions.has(idempotencyKey)) {
      return { ok: true, executed: false, duplicate: true, idempotencyKey };
    }
    const guards = validateExperimentGuards({
      // DRY_RUN/READY_TO_ARM: valida TODOS os guards exceto o arm (que e checado no ramo de execucao real).
      state: state === "DRY_RUN" || state === "READY_TO_ARM" ? "ARMED_PRACTICE" : state,
      accountContext: context?.accountContext, brokerAccountType: context?.brokerAccountType,
      realState: context?.realState, realTradingEnabled: context?.realTradingEnabled === true,
      killSwitchEngaged: context?.killSwitchEngaged === true, brokerConnected: context?.brokerConnected === true,
      dataQuality: context?.dataQuality, marketValid: context?.marketValid !== false && Boolean(marketKey),
      stake: this.minStakeBrl, strategyCount, totalCount,
    });
    if (!guards.ok) {
      await this.#audit("ORDER_BLOCKED", { opportunityId, direction, errors: guards.errors, branch: state === "ARMED_PRACTICE" || state === "RUNNING" ? undefined : "DRY_RUN" }, strategyId);
      return { ok: true, executed: false, blocked: true, errors: guards.errors };
    }
    if (state === "DRY_RUN" || state === "READY_TO_ARM") {
      await this.#audit("WOULD_EXECUTE", { opportunityId, direction, idempotencyKey, stakeBrl: this.minStakeBrl, scenario }, strategyId);
      await this.#recordExecution({ strategyId, opportunityId, decisionId, idempotencyKey, marketKey, marketType, direction, payout, snapshot, status: "WOULD_EXECUTE" });
      return { ok: true, executed: false, dryRun: true, wouldExecute: true, idempotencyKey };
    }
    const reservation = await this.#reserveSlot(strategyId);
    if (!reservation.ok) { await this.#audit("ORDER_BLOCKED", { opportunityId, direction, error: reservation.error }, strategyId); return { ok: true, executed: false, blocked: true, errors: [reservation.error] }; }
    await this.#audit("ORDER_REQUESTED", { opportunityId, direction, idempotencyKey, stakeBrl: this.minStakeBrl }, strategyId);
    try {
      const order = await this.runtime.experimentRequestOrder({
        strategyId, opportunityId, decisionId, idempotencyKey, marketKey, direction,
        stake: this.minStakeBrl, snapshot, experimentId: EXPERIMENT_ID,
      });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      await this.#releaseSlot(strategyId, { accepted });
      await this.#recordExecution({ strategyId, opportunityId, decisionId, idempotencyKey, marketKey, marketType, direction, payout, snapshot, status: accepted ? "BROKER_ACCEPTED" : "BROKER_REJECTED", brokerOrderId: order?.brokerOrderId ?? null, executionId: order?.executionId ?? null, timestamps: { requestOrderAt: this.now() } });
      await this.#audit(accepted ? "BROKER_ACCEPTED" : "BROKER_REJECTED", { opportunityId, brokerOrderId: order?.brokerOrderId ?? null }, strategyId);
      const updated = await this.#counters();
      const strategyRow = updated.find((c) => c.strategy_id === strategyId);
      if (strategyRow && Number(strategyRow.executed_count) >= MAX_PER_STRATEGY) await this.#audit("STRATEGY_COMPLETE", { executed: strategyRow.executed_count }, strategyId);
      const totalAfter = updated.reduce((sum, c) => sum + Number(c.executed_count ?? 0), 0);
      if (totalAfter >= MAX_TOTAL) { await this.#audit("EXPERIMENT_COMPLETE", { total: totalAfter }); await this.#setState("COMPLETE", { reason: "ALL_STRATEGIES_AT_CAP" }); }
      return { ok: true, executed: accepted, idempotencyKey, order: accepted ? { executionId: order?.executionId ?? null, brokerOrderId: order?.brokerOrderId ?? null } : null };
    } catch (error) {
      await this.#releaseSlot(strategyId, { accepted: false });
      await this.#audit("BROKER_REJECTED", { opportunityId, error: String(error?.message ?? error).slice(0, 160) }, strategyId);
      return { ok: false, executed: false, error: "ORDER_REQUEST_FAILED", detail: String(error?.message ?? error).slice(0, 160) };
    }
  }

  async #recordExecution({ strategyId, opportunityId, decisionId, idempotencyKey, marketKey, marketType, direction, payout, snapshot, status, brokerOrderId = null, executionId = null, timestamps = {} }) {
    const row = { experimentId: EXPERIMENT_ID, strategyId, opportunityId, decisionId, executionId, idempotencyKey, marketKey, marketType, direction, payout, status, brokerOrderId, snapshot, timestamps };
    if (!this.persistent) { this.memory.executions.set(idempotencyKey, row); return; }
    await this.pool.query(
      `INSERT INTO iq_experiment_executions(experiment_id, strategy_id, opportunity_id, decision_id, execution_id, idempotency_key, market_key, market_type, direction, payout, stake_brl, status, broker_order_id, decision_snapshot, timestamps, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb, now())
       ON CONFLICT(experiment_id, idempotency_key) DO UPDATE SET status=$12, broker_order_id=COALESCE($13, iq_experiment_executions.broker_order_id), execution_id=COALESCE($5, iq_experiment_executions.execution_id), timestamps=$15::jsonb, updated_at=now()`,
      [EXPERIMENT_ID, strategyId, opportunityId, decisionId, executionId, idempotencyKey, marketKey, marketType, direction, payout, this.minStakeBrl, status, brokerOrderId, JSON.stringify(snapshot ?? {}), JSON.stringify(timestamps ?? {})],
    ).catch(() => undefined);
  }

  async recordSettlement({ strategyId, opportunityId, idempotencyKey, result, entryPrice = null, expiryPrice = null, payout = null, practicePnl = null } = {}) {
    const status = "SETTLED";
    if (this.persistent) await this.pool.query(`UPDATE iq_experiment_executions SET status=$3, result=$4, practice_pnl=$5, updated_at=now() WHERE experiment_id=$1 AND idempotency_key=$2`, [EXPERIMENT_ID, idempotencyKey, status, result, practicePnl]).catch(() => undefined);
    await this.#audit("SETTLED", { opportunityId, result, entryPrice, expiryPrice, payout, practicePnl }, strategyId);
    return { ok: true, status };
  }

  /** Settlement de execucao experimental por brokerOrderId (idempotente). */
  async recordSettlementByBrokerOrder({ brokerOrderId = null, result = null, profit = null, entryPrice = null, expiryPrice = null } = {}) {
    if (!this.persistent || !brokerOrderId) return { ok: false, reason: "NO_POOL_OR_ORDER" };
    const rows = await this.pool.query(`SELECT strategy_id, opportunity_id, idempotency_key, payout FROM iq_experiment_executions WHERE experiment_id=$1 AND broker_order_id=$2 LIMIT 1`, [EXPERIMENT_ID, String(brokerOrderId)]).then((r) => r.rows).catch(() => []);
    if (!rows.length) return { ok: false, reason: "EXECUTION_NOT_FOUND" };
    const row = rows[0];
    return this.recordSettlement({ strategyId: row.strategy_id, opportunityId: row.opportunity_id, idempotencyKey: row.idempotency_key, result, entryPrice, expiryPrice, payout: row.payout, practicePnl: profit });
  }

  async status() {
    await this.ensureCreated();
    const row = await this.#experimentRow();
    const counters = await this.#counters();
    const state = row?.state ?? this.memory.state;
    const progress = Object.fromEntries(EXPERIMENT_STRATEGIES.map((strategy) => { const found = counters.find((c) => c.strategy_id === strategy); return [strategy, { executed: Number(found?.executed_count ?? 0), reserved: Number(found?.reserved_count ?? 0), max: MAX_PER_STRATEGY }]; }));
    const totalExecuted = Object.values(progress).reduce((sum, value) => sum + value.executed, 0);
    const executions = this.persistent
      ? await this.pool.query(`SELECT strategy_id, opportunity_id, direction, status, result, broker_order_id, market_key, market_type, payout, created_at FROM iq_experiment_executions WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 50`, [EXPERIMENT_ID]).then((r) => r.rows).catch(() => [])
      : [...this.memory.executions.values()].slice(-50);
    return {
      experimentId: EXPERIMENT_ID, state, practiceOnly: PRACTICE_ONLY, controlsExecution: state === "ARMED_PRACTICE" || state === "RUNNING" ? false : true,
      armPhraseRequired: true, armPhraseHint: "CONTA PRACTICE â†’ ARMAR EXPERIMENTO 4X3 (hash)", minStakeBrl: this.minStakeBrl,
      maxPerStrategy: MAX_PER_STRATEGY, maxTotal: MAX_TOTAL, totalExecuted, progress,
      events: this.memory.events.slice(-30), executions: executions.slice(0, 50),
      errors: this.lastError, note: "Harness isolado; ordens somente via runtime.requestOrder; REAL nunca participa.",
    };
  }
}

export function fourWayFreezeManifest() {
  return { schema: "four-way-experiment-freeze-v1", experimentId: EXPERIMENT_ID, frozenAtUtc: new Date().toISOString(), practiceOnly: true, maxPerStrategy: MAX_PER_STRATEGY, maxTotal: MAX_TOTAL, states: [...EXPERIMENT_STATES], armPhraseHashRequired: true, singleBrokerPath: "runtime.requestOrder", noTuning: true };
}

