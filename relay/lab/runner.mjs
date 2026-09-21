/**
 * LAB RUNNER — orquestra as 6 estrategias sobre UM snapshot por avaliacao (PRACTICE-only).
 * Submissoes SERIALIZADAS globalmente (evita corrida reserve/release sob concorrencia de 30 mercados).
 * Timeout duro no submit + checagem de execucao tardia (mantem atribuicao e nunca deixa reserva presa).
 * Capacidade: settled + open < 20 por estrategia (reserva atomica no banco; open_count reconciliado
 * a partir dos trades reais em cada ciclo e no start).
 */
import { routeSnapshot } from "./router.mjs";
import { LabStore, LAB_SETTLEMENT_CAP } from "./store.mjs";
import { LAB_STRATEGY_IDS, LAB_EXPIRY_POLICY, labSpecsHash } from "./strategy-specs.mjs";

export const LAB_RUNNER_VERSION = "lab-runner-v2";
const SUBMIT_TIMEOUT_MS = 10_000;
const ACK_RESOLVE_GRACE_MS = 3 * 60_000;

function qualityOf(result) {
  const counter = (result.counterEvidence ?? []).length;
  const support = (result.supportingEvidence ?? []).length;
  if (counter === 0 && support >= 3) return "A";
  if (counter <= 1 && support >= 2) return "B";
  return "C";
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LabRunner {
  constructor({ runtime = null, pool = null, now = () => Date.now(), log = () => {}, emit = () => {}, enabled = false, runId = null, stake = null, strategies = null, cap = null, sourceRunId = null, sourceStrategy = null, reportRootDir = "estrategias/lab-6" } = {}) {
    this.runtime = runtime; this.pool = pool; this.now = now; this.log = log; this.emit = emit;
    this.enabled = enabled === true;
    this.runId = runId ?? `lab6-20260920-practice`;
    this.specsHash = labSpecsHash();
    this.stake = Number(stake) > 0 ? Number(stake) : (Number(runtime?.config?.defaultStake) > 0 ? Number(runtime.config.defaultStake) : 1);
    this.strategies = Array.isArray(strategies) && strategies.length ? strategies : LAB_STRATEGY_IDS;
    this.cap = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : LAB_SETTLEMENT_CAP;
    this.sourceRunId = sourceRunId; this.sourceStrategy = sourceStrategy; this.reportRootDir = reportRootDir;
    this.store = new LabStore({ pool, runId: this.runId, specsHash: this.specsHash, stake: this.stake, expiryPolicy: LAB_EXPIRY_POLICY, cap: this.cap, sourceRunId, sourceStrategy });
    this.states = new Map();
    for (const id of this.strategies) this.states.set(id, { opportunity: null, lastDecision: null, lastSide: null, lastPersistAt: 0, recovered: null });
    this.counters = { evaluations: 0, opportunities: 0, waits: 0, approvals: 0, blockedReal: 0, capacityBlocked: 0, submits: 0, rejected: 0, timeouts: 0, settled: 0, missed: 0, recoveredOpen: 0, recoveredSettled: 0 };
    this.submitQueue = [];
    this.submitBusy = false;
    this.started = false;
  }

  async start() {
    if (!this.enabled || this.started) return;
    this.started = true;
    await this.store.ensureRun(this.strategies).catch((error) => this.log("LAB_ENSURE_RUN_FAIL", String(error?.message ?? error).slice(0, 160)));
    await this.store.reconcileOpenCounts().catch((error) => this.log("LAB_RECONCILE_FAIL", String(error?.message ?? error).slice(0, 160)));
    const recovered = await this.store.loadState(this.strategies).catch(() => ({ strategies: [], openTrades: [] }));
    for (const row of recovered.strategies ?? []) {
      const st = this.states.get(row.strategy_id); if (!st) continue;
      st.recovered = { settled: row.settled_count, open: row.open_count, wins: row.wins, losses: row.losses, draws: row.draws, complete: row.complete };
    }
    this.counters.recoveredOpen = (recovered.openTrades ?? []).length;
    this.counters.recoveredSettled = (recovered.strategies ?? []).reduce((acc, row) => acc + Number(row.settled_count ?? 0), 0);
    this.log("LAB_START", JSON.stringify({ runId: this.runId, specsHash: this.specsHash.slice(0, 12), stake: this.stake, recoveredOpen: this.counters.recoveredOpen, recoveredSettled: this.counters.recoveredSettled }));
    this.emit("lab.started", { runId: this.runId, specsHash: this.specsHash });
  }

  practiceOk() {
    return String(this.runtime?.config?.mode).toUpperCase() === "PRACTICE" && this.runtime?.accountContext?.context === "PRACTICE";
  }

  hasActiveOpportunity(marketKey) {
    for (const st of this.states.values()) { if (st.opportunity && st.opportunity.marketKey === marketKey && this.now() - st.opportunity.candidateAt <= 10 * 60_000) return true; }
    return false;
  }

  async observeMarket({ snapshot, marketKey, targetExpiryAt = null, payout = null } = {}) {
    if (!this.enabled || !this.started || !snapshot) return null;
    this.counters.evaluations += 1;
    if (!this.practiceOk()) { this.counters.blockedReal += 1; return null; }
    const at = this.now();
    const results = routeSnapshot(snapshot, { only: this.strategies });
    const submissions = [];
    for (const result of results) {
      const st = this.states.get(result.strategyId); if (!st) continue;
      if (result.opportunity === true) {
        if (!st.opportunity || st.opportunity.side !== result.side) st.opportunity = { side: result.side, candidateAt: at, snapshotId: result.snapshotId, marketKey };
        this.counters.opportunities += 1;
      }
      const approved = result.decision === "BUY" || result.decision === "SELL";
      if (approved) this.counters.approvals += 1; else this.counters.waits += 1;
      const changed = st.lastDecision !== result.decision || st.lastSide !== (result.side ?? null);
      const stale = at - st.lastPersistAt > 60_000;
      if (changed || stale) {
        st.lastDecision = result.decision; st.lastSide = result.side ?? null; st.lastPersistAt = at;
        void this.store.persistDecision({ strategyId: result.strategyId, marketKey, snapshotId: result.snapshotId, decision: result.decision, side: result.side, reason: result.reason, evidenceStrength: result.evidenceStrength, counter: result.counterEvidence }).catch(() => undefined);
      }
      if (!approved) continue;
      const expiry = Number(targetExpiryAt);
      if (!Number.isFinite(expiry)) continue;
      if (at < expiry - 45_000) continue;
      if (at > expiry - LAB_EXPIRY_POLICY.safeCutoffMs) { this.counters.missed += 1; this.emit("lab.missed", { strategyId: result.strategyId, marketKey, at }); continue; }
      submissions.push({ result, expiry, candidateAt: st.opportunity?.candidateAt ?? at });
    }
    for (const submission of submissions) {
      if (this.submitQueue.length >= 40) { this.counters.capacityBlocked += 1; continue; }
      await new Promise((resolve) => {
        this.submitQueue.push({ submission, marketKey, snapshot, payout, resolve });
        this.#pumpSubmitQueue();
      });
    }
    return results.length;
  }

  #pumpSubmitQueue() {
    if (this.submitBusy) return;
    const next = this.submitQueue.shift();
    if (!next) return;
    this.submitBusy = true;
    const job = this.#submitOne(next.submission, { marketKey: next.marketKey, snapshot: next.snapshot, payout: next.payout });
    Promise.resolve(job).catch(() => undefined).finally(() => { this.submitBusy = false; next.resolve(); this.#pumpSubmitQueue(); });
  }

  async #submitOne({ result, expiry, candidateAt }, { marketKey, snapshot, payout }) {
    const at = this.now();
    const st = this.states.get(result.strategyId);
    const strategyTradeId = `lab:${this.runId}:${result.strategyId}:${marketKey}:${expiry}:${result.side}`;
    const reserved = await this.store.reserveSlotWithTrade({
      strategyTradeId, strategyId: result.strategyId, strategyVersion: result.strategyVersion,
      episodeId: snapshot?.indicators?.fib?.episodeId ?? null, snapshotId: result.snapshotId, marketKey, direction: result.side,
      stake: this.stake, payout: payout ?? snapshot?.payout ?? null, requestedExpiry: new Date(expiry).toISOString(),
      expiryAt: new Date(expiry).toISOString(), candidateAt: new Date(candidateAt).toISOString(), decision: result.decision,
      reason: result.reason, evidenceStrength: result.evidenceStrength, entryQuality: qualityOf(result),
      supporting: result.supportingEvidence, counter: result.counterEvidence, specialistOutputs: result.specialistOutputs, entrySnapshot: snapshot,
    }).catch((error) => { this.log("LAB_RESERVE_FAIL", String(error?.message ?? error).slice(0, 160)); return null; });
    if (!reserved) { this.counters.capacityBlocked += 1; this.emit("lab.capacity_blocked", { strategyId: result.strategyId, marketKey, at }); return; }
    try {
      let order = null;
      try {
        order = await Promise.race([
          this.runtime.submitLabPracticeOrder({ marketKey, direction: result.side, strategyId: result.strategyId, strategyTradeId, stake: this.stake }),
          sleep(SUBMIT_TIMEOUT_MS).then(() => ({ __timeout: true })),
        ]);
      } catch (error) {
        order = { __error: String(error?.code ?? error?.message ?? error) };
      }
      if (order?.__timeout === true || order?.__error) {
        const late = await this.pool?.query?.("SELECT execution_id, broker_order_id, state FROM iq_executions WHERE decision_id=$1 LIMIT 1", [strategyTradeId]).catch(() => null);
        const row = late?.rows?.[0] ?? null;
        if (row) {
          order = { state: row.state, executionId: row.execution_id, brokerOrderId: row.broker_order_id };
        } else if (order?.__timeout === true) {
          this.counters.timeouts += 1;
          await this.store.updateTradeState({ strategyTradeId, state: "PENDING_ACK" }).catch(() => undefined);
          this.log("LAB_PENDING_ACK", JSON.stringify({ strategyId: result.strategyId, marketKey, strategyTradeId }));
          return;
        } else {
          throw Object.assign(new Error(order?.__error ?? "SUBMIT_ERROR"), { code: order?.__error ?? "LAB_SUBMIT_ERROR" });
        }
      }
      const accepted = Boolean(order && (order.brokerOrderId || order.requestId || order.executionId || ["ACKNOWLEDGED", "REQUESTED", "PENDING", "EXECUTED"].includes(String(order.state))));
      if (!accepted) throw Object.assign(new Error(String(order?.reason ?? order?.state ?? "ORDER_NOT_ACCEPTED")), { code: "LAB_ORDER_NOT_ACCEPTED" });
      this.counters.submits += 1;
      st.opportunity = null;
      await this.store.updateTradeState({ strategyTradeId, state: String(order?.state ?? "REQUESTED"), executionId: order?.executionId ?? null, brokerOrderId: order?.brokerOrderId ?? null, actualExpiry: order?.expirationAt ?? null });
      this.emit("lab.order", { strategyId: result.strategyId, marketKey, side: result.side, strategyTradeId, executionId: order?.executionId ?? null, at });
      this.log("LAB_ORDER", JSON.stringify({ strategyId: result.strategyId, marketKey, side: result.side, strategyTradeId }));
    } catch (error) {
      await this.store.updateTradeState({ strategyTradeId, state: "REJECTED" }).catch(() => undefined);
      await this.store.releaseReservation(result.strategyId).catch((releaseError) => this.log("LAB_RELEASE_FAIL", String(releaseError?.message ?? releaseError).slice(0, 160)));
      this.counters.rejected += 1;
      this.log("LAB_ORDER_REJECTED", JSON.stringify({ strategyId: result.strategyId, marketKey, strategyTradeId, code: String(error?.code ?? error?.message ?? error).slice(0, 140) }));
      this.emit("lab.order_rejected", { strategyId: result.strategyId, marketKey, code: String(error?.code ?? error?.message ?? error).slice(0, 120), at });
    }
  }

  async pollSettlements() {
    if (!this.enabled || !this.started || !this.pool?.query) return;
    await this.store.reconcileOpenCounts().catch(() => undefined);
    const lateAcks = (await this.pool.query(
      "UPDATE iq_lab_trades t SET state='REQUESTED', execution_id=COALESCE(t.execution_id, e.execution_id), broker_order_id=COALESCE(t.broker_order_id, e.broker_order_id), updated_at=now() FROM iq_executions e WHERE t.run_id=$1 AND t.result IS NULL AND t.state IN ('SUBMITTED','PENDING_ACK','UNKNOWN') AND e.decision_id = t.strategy_trade_id RETURNING t.strategy_trade_id",
      [this.runId]).catch(() => ({ rows: [] }))).rows ?? [];
    for (const row of lateAcks) this.log("LAB_LATE_ACK_ATTRIBUTED", JSON.stringify({ strategyTradeId: row.strategy_trade_id }));
    const stale = (await this.pool.query(
      "UPDATE iq_lab_trades SET state='EXPIRED_STALE', updated_at=now() WHERE run_id=$1 AND result IS NULL AND state IN ('SUBMITTED','PENDING_ACK','UNKNOWN','REQUESTED','ACKNOWLEDGED') AND entry_at < now() - interval '5 minutes' RETURNING strategy_id",
      [this.runId]).catch(() => ({ rows: [] }))).rows ?? [];
    for (const row of stale) { await this.store.releaseReservation(row.strategy_id).catch(() => undefined); this.log("LAB_STALE_EXPIRED", JSON.stringify({ strategyId: row.strategy_id })); }
    const rows = (await this.pool.query(
      `SELECT t.strategy_trade_id, t.strategy_id, e.broker_result, e.profit, e.settled_at
       FROM iq_lab_trades t JOIN iq_executions e ON (e.decision_id = t.strategy_trade_id OR (t.execution_id IS NOT NULL AND e.execution_id = t.execution_id))
       WHERE t.run_id=$1 AND t.result IS NULL AND t.state IN ('REQUESTED','ACKNOWLEDGED') LIMIT 50`, [this.runId]).catch(() => ({ rows: [] }))).rows ?? [];
    for (const row of rows) {
      const mapped = ["WIN", "LOSS", "DRAW"].includes(row.broker_result) ? row.broker_result : null;
      if (!mapped) continue;
      await this.store.markTradeSettled({ strategyTradeId: row.strategy_trade_id, result: mapped, pnl: Number(row.profit ?? 0), settlementAt: row.settled_at ?? null });
      await this.store.releaseSlot(row.strategy_id, { result: mapped });
      this.counters.settled += 1;
      this.emit("lab.settlement", { strategyId: row.strategy_id, strategyTradeId: row.strategy_trade_id, result: mapped, pnl: Number(row.profit ?? 0) });
    }
    const states = await this.store.strategyStates().catch(() => []);
    if (states.length === this.strategies.length && states.every((row) => row.complete === true)) {
      await this.store.finishRun().catch(() => undefined);
      this.emit("lab.complete", { runId: this.runId });
    }
  }

  status() {
    return {
      version: LAB_RUNNER_VERSION, enabled: this.enabled, started: this.started, runId: this.runId,
      specsHash: this.specsHash, stake: this.stake, practiceOnly: true, settlementCap: this.cap,
      strategiesConfigured: this.strategies, sourceRunId: this.sourceRunId, sourceStrategy: this.sourceStrategy, reportRootDir: this.reportRootDir,
      counters: { ...this.counters },
      strategies: [...this.states.entries()].map(([strategyId, st]) => ({ strategyId, opportunity: st.opportunity ? { side: st.opportunity.side, ageMs: this.now() - st.opportunity.candidateAt } : null, recovered: st.recovered })),
    };
  }
}
