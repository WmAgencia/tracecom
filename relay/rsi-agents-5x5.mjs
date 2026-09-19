/**
 * RSI AGENTS PINNED — agentes NORMAIS do runtime TraceCon:
 *   6 x RSI_REVERSAL_STRICT   (reversao confirmada: RSI extremo + Bollinger + DMI/ADX completo)
 *   6 x RSI_EXTREME_PULLBACK  (pullback curto: RSI extremo + Bollinger, bloqueia band riding/aceleracao)
 *
 * 12 ativos OTC PINADOS (5 antigos + GBPUSD/EURUSD) com atribuicao PERSISTIDA no banco:
 *   - sem troca silenciosa e sem substituicao dinamica de universo;
 *   - mercado ausente/fechado/sem feed/invalido/em conflito => FAIL CLOSED,
 *     o agente fica WAIT/BLOCK e o motivo exato e persistido;
 *   - ordem SEMPRE pelo caminho normal: runtime.submitAgentOrder -> requestOrder
 *     (Execution Gate unico) sob ARM/autoExecute PRACTICE.
 *
 * Skills congeladas (rsi-variants.mjs) intactas. Sem harness, sem cap de experimento.
 * Stake operacional R$1 (policy) exposta no status com requestedStake/effectiveStake.
 * REAL nunca e habilitado por este modulo.
 */
import { evaluateVariant, STRICT_ID, PULLBACK_ID } from "./rsi-variants.mjs";
import { effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";

export const RSI_AGENTS_VERSION = "rsi-agents-pinned-12-v2";
export const RSI_AGENTS = Object.freeze({ STRICT: "RSI_REVERSAL_STRICT", PULLBACK: "RSI_EXTREME_PULLBACK", STRICT_SKILL: STRICT_ID, PULLBACK_SKILL: PULLBACK_ID });

/** Universo PINADO (12 mercados). A ordem desta lista e a fonte da atribuicao persistida. */
export const RSI_AGENT_PINNED_ASSIGNMENTS = Object.freeze([
  Object.freeze({ marketKey: "AUDCAD:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "AUDCHF:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "AUDJPY:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "AUDNZD:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "AUDUSD:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "GBPUSD:OTC", strategy: "RSI_REVERSAL_STRICT" }),
  Object.freeze({ marketKey: "BTCUSD:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
  Object.freeze({ marketKey: "CADCHF:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
  Object.freeze({ marketKey: "CADJPY:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
  Object.freeze({ marketKey: "EURAUD:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
  Object.freeze({ marketKey: "EURCAD:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
  Object.freeze({ marketKey: "EURUSD:OTC", strategy: "RSI_EXTREME_PULLBACK" }),
]);
export const RSI_AGENT_PINNED_COUNT = RSI_AGENT_PINNED_ASSIGNMENTS.length;
export const RSI_AGENT_GROUP_COUNT = RSI_AGENT_PINNED_ASSIGNMENTS.filter((entry) => entry.strategy === "RSI_REVERSAL_STRICT").length;
export const RSI_AGENT_MIN_CANDLES = 60;

export const RSI_AGENTS_POLICY = Object.freeze({
  version: RSI_AGENTS_VERSION, mode: "NORMAL_RUNTIME_AGENT", practiceOnly: true, realLocked: true,
  stakeBrl: 1, groupSize: RSI_AGENT_GROUP_COUNT, pinnedUniverseSize: RSI_AGENT_PINNED_COUNT,
  finalWindowMs: 5000, minimumSafeMarginMs: 3000,
  turbCutoffMs: 30_000, noSilentSubstitution: true, failClosed: true, pinned: true, autoInvert: false,
  sameExpiryRequired: true, singleBrokerPath: "runtime.submitAgentOrder -> requestOrder",
});

const CONFLICT = "CONFLICT";
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export class RsiAgents5x5 {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.assignments = new Map(); // marketKey -> { strategy, activeId, canonical, availability, pinned, blocked, blockReason, assignedAt }
    this.agents = new Map();      // marketKey -> state observavel
    this.submitted = new Map();   // idempotencyKey -> { at, marketKey, direction }
    this.lastEvaluationAt = new Map();
    this.rejections = [];
    this.unpinnedPersisted = [];  // linhas antigas no banco fora da lista pinada (nao avaliadas)
    this.conflicts = [];          // divergencia banco x pin (fail closed)
    this.pinnedReady = false;
    this.lastReconcileAt = 0;
    this.lastAvailabilitySignature = "";
  }

  /** Popula o mapa de atribuicoes PINADAS de forma SINCRONA (sem I/O). */
  ensurePinned(markets = []) {
    const list = Array.isArray(markets) ? markets : [];
    const byKey = new Map(list.map((market) => [market?.marketKey, market]));
    for (const pinned of RSI_AGENT_PINNED_ASSIGNMENTS) {
      const market = byKey.get(pinned.marketKey) ?? null;
      const otc = market ? String(market.marketType ?? "").toUpperCase() === "OTC" : null;
      const availability = !market ? "MISSING_NOT_IN_UNIVERSE" : otc !== true ? "INVALID_MARKET_TYPE" : String(market.availability ?? "UNKNOWN");
      const existing = this.assignments.get(pinned.marketKey);
      // Conflito persistido/pinado permanece fail-closed ate reconciliacao explicita.
      if (existing && (existing.availability === CONFLICT || String(existing.blockReason ?? "").startsWith("CONFLICT_"))) continue;
      if (existing && existing.strategy !== pinned.strategy) {
        // Nunca sobrescreve: divergencia de estrategia e conflito fail-closed.
        existing.availability = CONFLICT;
        existing.blocked = true;
        existing.blockReason = `CONFLICT_PINNED_STRATEGY:${pinned.strategy}`;
        if (!this.conflicts.some((entry) => entry.marketKey === pinned.marketKey)) this.conflicts.push({ marketKey: pinned.marketKey, pinned: pinned.strategy, persisted: existing.strategy, reason: existing.blockReason });
        continue;
      }
      this.assignments.set(pinned.marketKey, {
        strategy: pinned.strategy, pinned: true,
        activeId: market?.activeId ?? null, canonical: market?.canonical ?? null,
        availability,
        blocked: availability === CONFLICT || availability === "INVALID_MARKET_TYPE",
        blockReason: availability === CONFLICT ? `CONFLICT_PINNED_STRATEGY:${pinned.strategy}` : availability === "INVALID_MARKET_TYPE" ? "INVALID_MARKET_TYPE" : null,
        inUniverse: Boolean(market), open: availability === "OPEN",
        assignedAt: existing?.assignedAt ?? this.now(),
      });
    }
    this.pinnedReady = true;
    return [...this.assignments.entries()];
  }

  /**
   * Descobre/confirma o universo PINADO e reconcilia com o banco (persistencia).
   * Nunca troca um mercado pinado por outro. Mercado fora da lista pinada fica
   * apenas reportado (unpinnedPersisted) e NUNCA e avaliado.
   */
  async assignUniverse(markets = []) {
    this.ensurePinned(markets);
    await this.#reconcilePinned();
    return [...this.assignments.entries()];
  }

  /** Reconciliacao banco x pin: insere pinados ausentes, bloqueia conflitos, reporta extras. */
  async #reconcilePinned() {
    if (this.now() - this.lastReconcileAt < 15_000) return;
    this.lastReconcileAt = this.now();
    if (this.pool?.query) {
      try {
        const rows = (await this.pool.query("SELECT market_key, strategy, availability, active_id FROM iq_rsi_agent_assignments")).rows;
        const persisted = new Map(rows.map((row) => [row.market_key, row]));
        for (const [marketKey, assignment] of this.assignments) {
          const row = persisted.get(marketKey);
          if (row && String(row.strategy) !== assignment.strategy) {
            assignment.availability = CONFLICT;
            assignment.blocked = true;
            assignment.blockReason = `CONFLICT_PERSISTED_STRATEGY:${row.strategy}`;
            if (!this.conflicts.some((entry) => entry.marketKey === marketKey)) this.conflicts.push({ marketKey, pinned: assignment.strategy, persisted: String(row.strategy), reason: assignment.blockReason });
            await this.pool.query("UPDATE iq_rsi_agent_assignments SET availability=$2, block_reason=$3, updated_at=now() WHERE market_key=$1", [marketKey, CONFLICT, assignment.blockReason]).catch(() => undefined);
            this.log("RSI_AGENT_ASSIGNMENT_CONFLICT", JSON.stringify({ marketKey, pinned: assignment.strategy, persisted: String(row.strategy) }));
            continue;
          }
          if (!row) {
            await this.pool.query(
              "INSERT INTO iq_rsi_agent_assignments(market_key, strategy, active_id, canonical, availability, pinned, block_reason) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(market_key) DO UPDATE SET availability=$5, pinned=true, block_reason=$6, updated_at=now()",
              [marketKey, assignment.strategy, assignment.activeId, assignment.canonical, assignment.availability, assignment.blockReason],
            ).catch(() => undefined);
            this.log("RSI_AGENT_ASSIGNMENT_PINNED", JSON.stringify({ marketKey, strategy: assignment.strategy }));
          } else if (row.availability !== assignment.availability || String(row.active_id ?? "") !== String(assignment.activeId ?? "")) {
            await this.pool.query("UPDATE iq_rsi_agent_assignments SET availability=$2, active_id=$3, pinned=true, block_reason=$4, updated_at=now() WHERE market_key=$1", [marketKey, assignment.availability, assignment.activeId, assignment.blockReason]).catch(() => undefined);
          }
        }
        const pinnedKeys = new Set(RSI_AGENT_PINNED_ASSIGNMENTS.map((entry) => entry.marketKey));
        this.unpinnedPersisted = rows.filter((row) => !pinnedKeys.has(row.market_key)).map((row) => ({ marketKey: row.market_key, strategy: String(row.strategy), availability: String(row.availability ?? "UNKNOWN") }));
        if (this.unpinnedPersisted.length) {
          await this.pool.query(
            "UPDATE iq_rsi_agent_assignments SET block_reason='UNPINNED_KEPT_INACTIVE', updated_at=now() WHERE market_key = ANY($1::text[]) AND (block_reason IS DISTINCT FROM 'UNPINNED_KEPT_INACTIVE')",
            [this.unpinnedPersisted.map((row) => row.marketKey)],
          ).catch(() => undefined);
          this.log("RSI_AGENT_UNPINNED_PERSISTED", JSON.stringify({ markets: this.unpinnedPersisted.map((row) => row.marketKey) }));
        }
      } catch (error) {
        this.log("RSI_AGENT_RECONCILE_FAILED", String(error?.message ?? error).slice(0, 140));
      }
    }
    const signature = [...this.assignments.values()].map((assignment) => `${assignment.availability}:${assignment.blocked === true ? 1 : 0}`).join("|");
    if (signature !== this.lastAvailabilitySignature) {
      this.lastAvailabilitySignature = signature;
      for (const [marketKey, assignment] of this.assignments) {
        if (assignment.availability !== "OPEN" || assignment.blocked === true) this.log("RSI_AGENT_AVAILABILITY", JSON.stringify({ marketKey, availability: assignment.availability, pinned: true, reason: assignment.blockReason, note: "fail closed: sem substituicao silenciosa" }));
      }
    }
  }

  /** Marcador de indisponibilidade vindo do runtime (sem substituicao silenciosa). */
  async markAvailability(marketKey, availability) {
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return;
    const next = String(availability ?? "UNKNOWN");
    if (assignment.availability === next) return;
    assignment.availability = next;
    assignment.open = next === "OPEN";
    if (this.pool?.query) await this.pool.query("UPDATE iq_rsi_agent_assignments SET availability=$2, updated_at=now() WHERE market_key=$1", [marketKey, next]).catch(() => undefined);
    this.log("RSI_AGENT_AVAILABILITY", JSON.stringify({ marketKey, availability: next, pinned: true, note: "sem substituicao silenciosa" }));
  }

  skillFor(strategy) { return strategy === RSI_AGENTS.STRICT ? RSI_AGENTS.STRICT_SKILL : RSI_AGENTS.PULLBACK_SKILL; }

  /** Avaliacao por mercado (candles reais do runtime) + execucao via caminho normal quando ARMADO. */
  async observeMarket({ marketKey, marketType = "OTC", activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return null;
    const at = num(now) ?? this.now();
    const list = Array.isArray(candles) ? candles : [];
    const skill = this.skillFor(assignment.strategy);
    const agentId = `${assignment.strategy}:${marketKey}`;
    const blockedReason = assignment.blocked === true
      ? assignment.blockReason ?? "BLOCKED"
      : String(marketType ?? "").toUpperCase() !== "OTC"
        ? "INVALID_MARKET_TYPE"
        : assignment.availability === "MISSING_NOT_IN_UNIVERSE"
          ? "MISSING_NOT_IN_UNIVERSE"
          : assignment.availability === "INVALID_MARKET_TYPE"
            ? "INVALID_MARKET_TYPE"
            : assignment.availability !== "OPEN"
              ? `MARKET_${assignment.availability}`
              : list.length < RSI_AGENT_MIN_CANDLES
                ? "NO_FEED_INSUFFICIENT_CANDLES"
                : null;
    if (blockedReason) {
      const blockedState = {
        agentId, marketKey, strategy: assignment.strategy, at, accountMode: "PRACTICE",
        rsi: null, rsiBand: null, rsiTrajectory: null, bollinger: null, bollingerState: null, bollingerConfirmed: false, bandRiding: null,
        plusDI: null, minusDI: null, spread: null, adx: null, adxSlope: null,
        structuralTrend: "UNKNOWN", shortHorizonDirection: null,
        decision: "WAIT", waitReason: blockedReason, reason: blockedReason, candidateAt: null, revalidationAt: null, submitAt: null,
        orderId: null, executionId: null, requestedStake: RSI_AGENTS_POLICY.stakeBrl, effectiveStake: null,
      };
      this.#setState(blockedState); void this.#persist(blockedState);
      return blockedState;
    }
    const evaluation = evaluateVariant({ variant: skill, candles: list, now: at });
    const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: effectiveSafeMarginMs(latency) }) : null;
    const state = {
      agentId, marketKey, strategy: assignment.strategy, at, accountMode: "PRACTICE",
      rsi: evaluation.rsi ?? null, rsiBand: evaluation.rsiBand ?? null, rsiTrajectory: evaluation.rsiTrajectory ?? null,
      bollinger: evaluation.bollinger ?? null, bollingerState: evaluation.status ?? null, bollingerConfirmed: evaluation.bollingerConfirmed ?? false, bandRiding: evaluation.bandRiding ?? false,
      plusDI: evaluation.dmi?.plusDI ?? null, minusDI: evaluation.dmi?.minusDI ?? null, spread: evaluation.dmi?.spread ?? null,
      adx: evaluation.adx?.value ?? null, adxSlope: evaluation.adx?.slope ?? null,
      structuralTrend: this.#structuralTrend(list), shortHorizonDirection: evaluation.direction ?? null,
      decision: "WAIT", waitReason: null, reason: null, candidateAt: null, revalidationAt: null, submitAt: null,
      orderId: null, executionId: null, requestedStake: RSI_AGENTS_POLICY.stakeBrl, effectiveStake: null,
    };
    if (!evaluation.direction) { state.waitReason = "NO_OPPORTUNITY"; state.reason = evaluation.reason ?? "RSI fora de extremo"; this.#setState(state); return state; }
    if (!evaluation.accepted) {
      state.waitReason = evaluation.status;
      state.reason = evaluation.rejectedStrongTrend || evaluation.strongAccel ? "tendencia antiga forte/acelerando" : "confirmacoes incompletas";
      this.#setState(state); return state;
    }
    state.decision = evaluation.direction; state.reason = `confluencia ${evaluation.variant}`;
    if (!window) { void this.#persist(state); this.#setState(state); return state; }
    if (at < window.entryWindowOpensAt) { state.waitReason = "OBSERVE_ONLY"; this.#setState(state); return state; }
    if (at > window.entryWindowClosesAt) {
      state.waitReason = at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
      this.#setState(state); return state;
    }
    const revalidation = evaluateVariant({ variant: skill, candles: list, now: at });
    state.revalidationAt = at;
    if (!revalidation.accepted || revalidation.direction !== state.decision) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = "condicao desapareceu na revalidacao";
      this.#setState(state); void this.#persist(state); return state;
    }
    state.candidateAt = state.candidateAt ?? at;
    const idempotencyKey = `rsi-agent:${assignment.strategy}:${marketKey}:${targetExpiryAt}:${state.decision}`;
    if (this.submitted.has(idempotencyKey)) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    try {
      const order = await this.runtime.submitAgentOrder({ marketKey, direction: state.decision, strategyId: assignment.strategy, skill: evaluation.variant, stake: RSI_AGENTS_POLICY.stakeBrl, idempotencyKey, decisionId: agentId });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      state.submitAt = this.now();
      state.orderId = order?.brokerOrderId !== null && order?.brokerOrderId !== undefined ? String(order.brokerOrderId) : null;
      state.executionId = order?.executionId !== null && order?.executionId !== undefined ? String(order.executionId) : null;
      state.requestedStake = num(order?.stakeRequested) ?? RSI_AGENTS_POLICY.stakeBrl;
      state.effectiveStake = num(order?.stake) ?? null;
      if (accepted) {
        this.submitted.set(idempotencyKey, { at: state.submitAt, marketKey, direction: state.decision });
        state.reason = `ordem aceita pelo broker (PRACTICE) execution=${state.executionId ?? "-"} order=${state.orderId ?? "-"} stake=${state.effectiveStake ?? "-"}`;
        state.position = { status: "OPEN", brokerOrderId: state.orderId, executionId: state.executionId, requestedStake: state.requestedStake, effectiveStake: state.effectiveStake };
      } else {
        state.waitReason = `ORDER_${order?.disposition ?? order?.state ?? "BLOCKED"}`;
        state.reason = String(order?.reason ?? order?.state ?? "bloqueado").slice(0, 160);
        this.rejections.push({ marketKey, strategy: assignment.strategy, reason: state.waitReason, at, orderId: state.orderId, executionId: state.executionId });
      }
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.rejections.push({ marketKey, strategy: assignment.strategy, reason: code, message: state.reason, at });
      this.log("RSI_AGENT_ORDER_BLOCKED", JSON.stringify({ marketKey, strategy: assignment.strategy, reason: code }));
    }
    this.#setState(state); void this.#persist(state);
    return state;
  }

  /** Resultado real de trade vindo do settlement do broker (mesmo caminho normal). */
  recordSettlement({ marketKey = null, result = null, profit = null, entryPrice = null, expiryPrice = null, payout = null } = {}) {
    const assignment = this.assignments.get(marketKey);
    let state = this.agents.get(marketKey);
    if (!state && !assignment) return null;
    if (!state) { state = { agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy, at: this.now(), decision: "WAIT", waitReason: null, reason: null }; this.agents.set(marketKey, state); }
    state.lastResult = result; state.lastPnl = num(profit); state.expiryPrice = num(expiryPrice); state.entryPrice = num(entryPrice); state.payout = num(payout);
    state.position = { status: "SETTLED", result, profit: num(profit), orderId: state.orderId ?? null, executionId: state.executionId ?? null, requestedStake: state.requestedStake ?? RSI_AGENTS_POLICY.stakeBrl, effectiveStake: state.effectiveStake ?? null };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    void this.#persist(state);
    return state;
  }

  #setState(state) { this.agents.set(state.marketKey, state); this.lastEvaluationAt.set(state.marketKey, state.at); }
  #structuralTrend(candles) { const list = Array.isArray(candles) ? candles : []; if (list.length < 30) return "UNKNOWN"; const first = Number(list[list.length - 30]?.close); const last = Number(list[list.length - 1]?.close); if (!Number.isFinite(first) || !Number.isFinite(last)) return "UNKNOWN"; if (last > first) return "BULLISH"; if (last < first) return "BEARISH"; return "NEUTRAL"; }

  async #persist(state) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state(agent_id, market_key, strategy, status, decision, wait_reason, rsi, rsi_band, bollinger_state, dmi, adx, structural_trend, short_horizon_direction, candidate_at, revalidation_at, submit_at, last_reason, position, last_result, last_pnl, account_mode, requested_stake, effective_stake, order_id, execution_id, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26::jsonb, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$4, decision=$5, wait_reason=$6, rsi=$7, rsi_band=$8, bollinger_state=$9::jsonb, dmi=$10::jsonb, adx=$11::jsonb, structural_trend=$12, short_horizon_direction=$13, candidate_at=$14, revalidation_at=$15, submit_at=$16, last_reason=$17, position=$18::jsonb, last_result=$19, last_pnl=$20, account_mode=$21, requested_stake=$22, effective_stake=$23, order_id=$24, execution_id=$25, payload=$26::jsonb, updated_at=now()`,
      [state.agentId, state.marketKey, state.strategy, state.waitReason ? "WAIT" : (state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING"), state.decision, state.waitReason, state.rsi, state.rsiBand, JSON.stringify({ upper: state.bollinger?.upper ?? null, middle: state.bollinger?.middle ?? null, lower: state.bollinger?.lower ?? null, position: state.bollinger?.position ?? null, state: state.bollingerState, confirmed: state.bollingerConfirmed, bandRiding: state.bandRiding }), JSON.stringify({ plusDI: state.plusDI, minusDI: state.minusDI, spread: state.spread }), JSON.stringify({ value: state.adx, slope: state.adxSlope }), state.structuralTrend, state.shortHorizonDirection, state.candidateAt, state.revalidationAt, state.submitAt, state.reason, JSON.stringify(state.position ?? null), state.lastResult ?? null, state.lastPnl ?? null, state.accountMode ?? "PRACTICE", state.requestedStake ?? RSI_AGENTS_POLICY.stakeBrl, state.effectiveStake ?? null, state.orderId ?? null, state.executionId ?? null, JSON.stringify({ policy: RSI_AGENTS_POLICY, pinned: true })],
    ).catch(() => undefined);
  }

  async status() {
    const agents = RSI_AGENT_PINNED_ASSIGNMENTS.map((pinned) => {
      const assignment = this.assignments.get(pinned.marketKey) ?? { strategy: pinned.strategy, availability: "PENDING_NOT_EVALUATED", activeId: null, pinned: true, blocked: false, blockReason: null };
      const marketKey = pinned.marketKey;
      const state = this.agents.get(marketKey) ?? { agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy, decision: "WAIT", waitReason: assignment.availability === "OPEN" ? "SEM_AVALIACAO" : assignment.availability, reason: assignment.blockReason ?? null };
      return { ...state, strategy: assignment.strategy, availability: assignment.availability, activeId: assignment.activeId, pinned: true, blocked: assignment.blocked === true, blockReason: assignment.blockReason ?? null, skill: this.skillFor(assignment.strategy) };
    });
    const summarize = (strategy) => {
      const group = agents.filter((agent) => agent.strategy === strategy);
      return { total: group.length, analyzing: group.filter((agent) => !agent.waitReason).length, waiting: group.filter((agent) => agent.waitReason).length, blocked: group.filter((agent) => agent.blocked === true).length, signals: group.filter((agent) => agent.decision === "BUY" || agent.decision === "SELL").length, open: group.filter((agent) => agent.position?.status === "OPEN").length, settled: group.filter((agent) => agent.lastResult).length, wins: group.filter((agent) => agent.lastResult === "WIN").length, losses: group.filter((agent) => agent.lastResult === "LOSS").length };
    };
    const feedMissing = agents.filter((agent) => agent.availability === "MISSING_NOT_IN_UNIVERSE").map((agent) => agent.marketKey);
    return {
      version: RSI_AGENTS_VERSION, mode: "NORMAL_RUNTIME_AGENT", enabled: this.enabled, policy: RSI_AGENTS_POLICY,
      practiceOnly: true, realTouched: false, stakeBrl: RSI_AGENTS_POLICY.stakeBrl, pinned: true, failClosed: true,
      pinnedMarkets: RSI_AGENT_PINNED_ASSIGNMENTS.map((entry) => ({ marketKey: entry.marketKey, strategy: entry.strategy })),
      feedMissing, conflicts: this.conflicts.slice(-20), unpinnedPersisted: this.unpinnedPersisted.slice(-20),
      groups: { strict: summarize(RSI_AGENTS.STRICT), pullback: summarize(RSI_AGENTS.PULLBACK) },
      assignments: agents.map((agent) => ({ marketKey: agent.marketKey, strategy: agent.strategy, skill: agent.skill, availability: agent.availability, activeId: agent.activeId, pinned: true, blocked: agent.blocked === true, blockReason: agent.blockReason ?? null })),
      agents: agents.map((agent) => ({ agentId: agent.agentId, marketKey: agent.marketKey, strategy: agent.strategy, availability: agent.availability, pinned: true, blocked: agent.blocked === true, blockReason: agent.blockReason ?? null, decision: agent.decision, waitReason: agent.waitReason, reason: agent.reason, rsi: agent.rsi, rsiBand: agent.rsiBand, rsiTrajectory: agent.rsiTrajectory, bollinger: agent.bollinger, bollingerState: agent.bollingerState, plusDI: agent.plusDI, minusDI: agent.minusDI, spread: agent.spread, adx: agent.adx, adxSlope: agent.adxSlope, structuralTrend: agent.structuralTrend, shortHorizonDirection: agent.shortHorizonDirection, candidateAt: agent.candidateAt, revalidationAt: agent.revalidationAt, submitAt: agent.submitAt, accountMode: agent.accountMode ?? "PRACTICE", requestedStake: agent.requestedStake ?? RSI_AGENTS_POLICY.stakeBrl, effectiveStake: agent.effectiveStake ?? null, orderId: agent.orderId ?? null, executionId: agent.executionId ?? null, position: agent.position ?? null, lastResult: agent.lastResult ?? null, lastPnl: agent.lastPnl ?? null })),
      rejections: this.rejections.slice(-40),
      readyToArm: true, armed: false,
      armInstructions: "ARM PRACTICE no TraceCon (autoExecute) — os 12 agentes pinados passam a enviar via requestOrder normal; REAL continua LOCKED.",
    };
  }
}

export function rsiAgentsFreezeManifest() {
  return {
    schema: "rsi-agents-pinned-12-freeze-v2", version: RSI_AGENTS_VERSION, frozenAtUtc: new Date().toISOString(), policy: RSI_AGENTS_POLICY,
    pinned: RSI_AGENT_PINNED_ASSIGNMENTS.map((entry) => ({ ...entry })),
    skills: { strict: RSI_AGENTS.STRICT_SKILL, pullback: RSI_AGENTS.PULLBACK_SKILL }, noTuning: true,
    rules: {
      strict: "RSI extremo + Bollinger + DMI/ADX completo; strong continuation bloqueia",
      pullback: "RSI extremo + Bollinger; short pullback permitido; band riding/aceleracao forte bloqueia",
      singleBrokerPath: "runtime.submitAgentOrder -> requestOrder", realLocked: true, stakeBrl: 1,
      failClosed: "mercado ausente/fechado/sem feed/invalido/em conflito => WAIT/BLOCK com motivo persistido; sem substituicao silenciosa",
    },
  };
}
