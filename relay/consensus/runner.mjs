/**
 * CONSENSUS RUNNER — orquestra o fluxo novo por ativo (SOMENTE BINARY OTC).
 * candle -> snapshot -> RSI (oportunidade) -> especialistas -> decisor
 *   WAIT  -> watch continua (log coalescido)
 *   BUY/SELL -> janela final (revalidacao causal no tick 1s) -> safe cutoff -> Execution Gate -> ordem
 * Execucao desligada por padrao (observe-only) ate validacao; 1 ordem por vez garantida pelo runtime.
 */
import { evaluateConsensus, evaluateConsensusFromSnapshot } from "./index.mjs";
import { createConsensusLog } from "./log.mjs";

export const CONSENSUS_RUNNER_VERSION = "consensus-runner-v1";

const num = (value) => (value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export class ConsensusRunner {
  constructor({ runtime = null, pool = null, now = () => Date.now(), log = () => {}, enabled = true, execute = false, requireOtc = true, cooldownMs = 180_000, maxOpportunityAgeMs = 10 * 60_000, safeCutoffMs = 7_000, emit = () => {} } = {}) {
    this.runtime = runtime; this.pool = pool; this.now = now; this.log = log;
    this.enabled = enabled === true; this.execute = execute === true; this.requireOtc = requireOtc !== false;
    this.cooldownMs = cooldownMs; this.maxOpportunityAgeMs = maxOpportunityAgeMs; this.safeCutoffMs = safeCutoffMs; this.emit = emit;
    this.opportunities = new Map(); this.lastPersist = new Map(); this.lastSubmitAt = new Map();
    this.counters = { evaluations: 0, snapshots: 0, noSnapshot: 0, rsiNormal: 0, opportunities: 0, specialistsEvaluated: 0, waits: 0, approvals: 0, revalidateAttempts: 0, missed: 0, blocked: 0, submits: 0, orderRejected: 0, settled: 0 };
    this.waitReasons = new Map();
    this.recentDecisions = [];
    this.logger = createConsensusLog({
      emit: ({ structured, human }) => {
        if (human) this.log("CONSENSUS_HUMAN", "\n" + human);
        this.emit("consensus.decision", structured);
      },
    });
  }

  status() {
    return {
      version: CONSENSUS_RUNNER_VERSION, enabled: this.enabled, execute: this.execute, scope: "BINARY_OTC_ONLY",
      counters: { ...this.counters },
      funnel: {
        snapshots: this.counters.snapshots, noSnapshot: this.counters.noSnapshot,
        rsiNormal: this.counters.rsiNormal, rsiOpportunity: this.counters.opportunities,
        specialistsEvaluated: this.counters.specialistsEvaluated,
        consensusWait: this.counters.waits, consensusApprove: this.counters.approvals,
        revalidateAttempts: this.counters.revalidateAttempts, safeCutoffMissed: this.counters.missed,
        gateBlocked: this.counters.blocked, orderSubmitted: this.counters.submits, orderRejected: this.counters.orderRejected,
      },
      waitReasons: Object.fromEntries([...this.waitReasons.entries()].sort((a, b) => b[1] - a[1])),
      opportunities: [...this.opportunities.entries()].map(([marketKey, row]) => ({ marketKey, side: row.side, ageMs: this.now() - row.candidateAt })),
      recent: this.recentDecisions.slice(-15),
    };
  }

  hasActiveOpportunity(marketKey) {
    const row = this.opportunities.get(marketKey);
    return Boolean(row && this.now() - row.candidateAt <= this.maxOpportunityAgeMs);
  }

  async observeMarket({ marketKey, marketType = null, candles = [], now = null, targetExpiryAt = null, payout = null, snapshot: providedSnapshot = null } = {}) {
    if (!this.enabled) return null;
    if (this.requireOtc && marketType !== "OTC") return null;
    const at = num(now) ?? this.now();
    const result = providedSnapshot ? evaluateConsensusFromSnapshot(providedSnapshot) : evaluateConsensus({ marketKey, marketType, candles, now: at, payout, targetExpiryAt });
    this.counters.evaluations += 1;
    if (!result.snapshot) { this.counters.noSnapshot += 1; return null; }
    this.counters.snapshots += 1;
    const { snapshot, rsi, priceAction, bollinger, dmiAdx, decision } = result;

    if (!rsi?.opportunity) this.counters.rsiNormal += 1;
    if (rsi?.opportunity) {
      this.counters.specialistsEvaluated += 1;
      const current = this.opportunities.get(marketKey);
      if (!current || current.side !== rsi.side) {
        this.opportunities.set(marketKey, { side: rsi.side, candidateAt: at, snapshotId: snapshot.snapshotId });
        this.counters.opportunities += 1;
        this.emit("consensus.opportunity", { marketKey, side: rsi.side, rsi: rsi.rsi, state: rsi.state, at, snapshotId: snapshot.snapshotId });
      }
    } else {
      const current = this.opportunities.get(marketKey);
      if (current && at - current.candidateAt > this.maxOpportunityAgeMs) {
        this.opportunities.delete(marketKey);
        this.emit("consensus.opportunity_expired", { marketKey, side: current.side, at });
      }
    }

    this.logger.logEvaluation({ marketKey, snapshot, rsi, priceAction, bollinger, dmiAdx, decision });
    const specialistOutputs = rsi?.opportunity ? { priceAction, bollinger, dmiAdx } : null;
    const entry = {
      at, marketKey, snapshotId: snapshot.snapshotId, specialistOutputs,
      decision: decision.decision, side: decision.side, reason: decision.reason,
      evidenceStrength: decision.evidenceStrength, supporting: decision.supportingEvidence, counter: decision.counterEvidence,
      lastCandleAt: snapshot.bucketEnd, closedCandles: snapshot.provenance?.closedCandles ?? null,
      rsi: rsi?.rsi ?? null, rsiState: rsi?.state ?? null, rsiTrajectory: rsi?.trajectory ?? [],
      bollingerState: bollinger?.state ?? null, dmiState: dmiAdx?.state ?? null, paStructure: priceAction?.structure ?? null,
      latencyMs: result.latencyMs,
    };
    this.recentDecisions.push({ at: entry.at, marketKey, decision: entry.decision, side: entry.side, reason: entry.reason, evidenceStrength: entry.evidenceStrength, rsi: entry.rsi, rsiState: entry.rsiState, bollingerState: entry.bollingerState, dmiState: entry.dmiState, paStructure: entry.paStructure, latencyMs: entry.latencyMs });
    if (this.recentDecisions.length > 200) this.recentDecisions.splice(0, this.recentDecisions.length - 200);
    await this.#persistDecision(entry).catch(() => undefined);

    if (decision.decision === "BUY" || decision.decision === "SELL") {
      this.counters.approvals += 1;
      this.emit("consensus.approval", { marketKey, side: decision.side, evidenceStrength: decision.evidenceStrength, snapshotId: snapshot.snapshotId, at });
      if (this.execute === true) return this.#submit({ marketKey, side: decision.side, at, targetExpiryAt, snapshotId: snapshot.snapshotId });
    } else {
      this.counters.waits += 1;
      const codes = rsi?.opportunity ? (decision.counterEvidence ?? []).map((row) => row.code) : ["NO_RSI_OPPORTUNITY"];
      for (const code of codes) this.waitReasons.set(code, (this.waitReasons.get(code) ?? 0) + 1);
      if (codes.length > 1) this.waitReasons.set("MULTIPLE_COUNTER_EVIDENCE", (this.waitReasons.get("MULTIPLE_COUNTER_EVIDENCE") ?? 0) + 1);
    }
    return { decision: decision.decision, side: decision.side, snapshotId: snapshot.snapshotId, evidenceStrength: decision.evidenceStrength };
  }

  async #submit({ marketKey, side, at, targetExpiryAt, snapshotId }) {
    const runtime = this.runtime;
    if (!runtime?.submitAgentV2LiveOrder) return null;
    if (!Number.isFinite(Number(targetExpiryAt))) { this.counters.missed += 1; return null; }
    if (at > Number(targetExpiryAt) - this.safeCutoffMs) {
      this.counters.missed += 1;
      this.emit("consensus.missed", { marketKey, side, at, targetExpiryAt });
      return null;
    }
    if (at - (this.lastSubmitAt.get(marketKey) ?? 0) < this.cooldownMs) { this.counters.blocked += 1; return null; }
    const opportunity = this.opportunities.get(marketKey) ?? null;
    const stake = Number(runtime.config?.defaultStake) > 0 ? Number(runtime.config.defaultStake) : 2;
    try {
      this.counters.revalidateAttempts += 1;
      const order = await runtime.submitAgentV2LiveOrder({
        marketKey, direction: side, strategyId: "CONSENSUS_V1", skill: "CONSENSUS_V1",
        stake, expectedStake: stake, entryMode: "CONSENSUS_FINAL",
        idempotencyKey: `consensus:${marketKey}:${targetExpiryAt}:${side}`,
        candidateAt: opportunity?.candidateAt ?? at, expiryAt: Number(targetExpiryAt),
      });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      if (accepted) {
        this.counters.submits += 1;
        this.lastSubmitAt.set(marketKey, at);
        this.opportunities.delete(marketKey);
        this.emit("consensus.order", { marketKey, side, orderId: order?.brokerOrderId ?? null, executionId: order?.executionId ?? null, snapshotId, at });
      } else {
        this.counters.blocked += 1;
      }
      return order;
    } catch (error) {
      this.counters.blocked += 1;
      this.counters.orderRejected += 1;
      this.emit("consensus.blocked", { marketKey, side, code: String(error?.code ?? error?.message ?? error).slice(0, 120), at });
      return null;
    }
  }

  async #persistDecision(entry) {
    if (!this.pool?.query) return;
    const last = this.lastPersist.get(entry.marketKey) ?? { decision: null, at: 0 };
    const changed = last.decision !== entry.decision;
    const stale = entry.at - last.at > 60_000;
    if (entry.decision === "WAIT" && !changed && !stale) return;
    this.lastPersist.set(entry.marketKey, { decision: entry.decision, at: entry.at });
    await this.pool.query(
      `INSERT INTO iq_consensus_decisions(at, market_key, snapshot_id, decision, side, reason, evidence_strength, latency_ms, rsi, rsi_state, rsi_trajectory, bollinger_state, dmi_state, pa_structure, supporting, counter, payload, account_context)
       VALUES(now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17)`,
      [entry.marketKey, entry.snapshotId, entry.decision, entry.side, String(entry.reason ?? "").slice(0, 400), entry.evidenceStrength, entry.latencyMs, entry.rsi, entry.rsiState, JSON.stringify(entry.rsiTrajectory ?? []), entry.bollingerState, entry.dmiState, entry.paStructure, JSON.stringify(entry.supporting ?? []), JSON.stringify(entry.counter ?? []), JSON.stringify({ runner: CONSENSUS_RUNNER_VERSION, snapshot: { bucketEnd: entry.lastCandleAt ?? null, closedCandles: entry.closedCandles ?? null }, specialistOutputs: entry.specialistOutputs ?? null }), this.runtime?.accountContext?.context ?? "PRACTICE"],
    );
  }
}
