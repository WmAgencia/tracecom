/** Automated audit engine for TraceCom diagnostic bundles.
 *
 * Pure and deterministic: receives structured telemetry (the same fields the
 * browser/deep pipeline already emits) and returns PASS/FAIL/WARN per check
 * with machine-readable evidence. Never reads secrets, never executes orders.
 */
import { settleTrade } from "../training/settlement.js";
import { resolveGroundTruthChain, type PriceObservationRef } from "./ground-truth.js";

export type DiagnosticEvent = { t: number; type: string; signalId?: string; data?: Record<string, unknown> };
export type PriceSample = { value: number; timestamp: number; accepted?: boolean; reason?: string; source?: string };
export type SignalSample = { signalId: string; direction: string; createdAt: number; countdownEndsAt: number; status?: string; profile?: string; rawConfidence?: number; trendAlignment?: string; macroTrend?: string };
export type PositionSample = { signalId?: string; detectedAt: number; hasOpenPosition?: boolean; direction?: string; evidence?: string[]; price?: number | null };
export type SettlementSample = { signalId?: string; entryPrice: number | null; exitPrice: number | null; entryTimestamp: number; exitTimestamp: number; result: string; source?: string; entryPriceObservationId?: string | null; settlementPriceObservationId?: string | null };
export type FastDecisionSample = { candleId?: string; at: number; decision: string; rawConfidence?: number; regime?: string; trendAlignment?: string; counterTrend?: boolean; deepAnalysisAgeMs?: number | null; settlementResult?: string | null; deepFastAlignment?: string };
export type TimeoutSample = { at: number; latencyMs: number; deadlineMs: number; status?: string };

export type AuditInput = {
  sessionId?: string;
  events?: DiagnosticEvent[];
  prices?: PriceSample[];
  signals?: SignalSample[];
  positions?: PositionSample[];
  settlements?: SettlementSample[];
  fastDecisions?: FastDecisionSample[];
  timeouts?: TimeoutSample[];
  priceObservations?: Array<PriceObservationRef & { frameId?: string | null; source?: string | null; confidence?: number | null }>;
};

export type AuditStatus = "PASS" | "FAIL" | "WARN";
export type AuditCheckResult = { check: string; status: AuditStatus; evidence: Array<Record<string, unknown>> };

export const AUDIT_CHECKS = ["SIGNAL_FLAPPING", "COUNTDOWN_RESET", "OVERLAPPING_OPERATION", "PRICE_PROVENANCE", "OUTLIER_LEAKAGE", "SETTLEMENT_CAUSALITY", "TIMEOUT_ANOMALY", "FALSE_POSITION_DIRECTION", "POSITION_DETECTION", "STALE_CONTEXT", "DEEP_FAST_CONFLICT", "COUNTER_TREND_FAILURE"] as const;
export type AuditCheckName = typeof AUDIT_CHECKS[number];

const PANEL_TOKENS = /panel|posi|card|open|opera|expir|opç|opc|acima|abaixo|stake|invest/i;
const positionWindowMs = 70_000;

export function runAudit(input: AuditInput, checks?: readonly string[]): AuditCheckResult[] {
  const selected = new Set(checks && checks.length ? checks : AUDIT_CHECKS);
  const results: AuditCheckResult[] = [];
  const signals = (input.signals ?? []).slice().sort((a, b) => a.createdAt - b.createdAt);
  const events = (input.events ?? []).slice().sort((a, b) => a.t - b.t);

  if (selected.has("SIGNAL_FLAPPING")) {
    const evidence: Array<Record<string, unknown>> = [];
    for (let index = 1; index < signals.length; index++) {
      const previous = signals[index - 1]!, current = signals[index]!;
      if (current.direction !== previous.direction && current.createdAt < previous.createdAt + positionWindowMs) evidence.push({ previous: previous.signalId, previousDirection: previous.direction, next: current.signalId, nextDirection: current.direction, deltaMs: current.createdAt - previous.createdAt });
    }
    results.push({ check: "SIGNAL_FLAPPING", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("COUNTDOWN_RESET")) {
    const bySignal = new Map<string, number[]>();
    for (const event of events) if (event.type === "ENTRY_COUNTDOWN_STARTED" && event.signalId) { const rows = bySignal.get(event.signalId) ?? []; rows.push(Number(event.data?.countdownEndsAt) || 0); bySignal.set(event.signalId, rows); }
    const evidence: Array<Record<string, unknown>> = [];
    for (const [signalId, ends] of bySignal) { const unique = [...new Set(ends)]; if (unique.length > 1) evidence.push({ signalId, countdownEndsAt: unique }); }
    for (const signal of signals) if (signal.countdownEndsAt && signal.createdAt && signal.countdownEndsAt !== signal.createdAt + 10_000) evidence.push({ signalId: signal.signalId, createdAt: signal.createdAt, countdownEndsAt: signal.countdownEndsAt, reason: "countdown_not_immutable" });
    results.push({ check: "COUNTDOWN_RESET", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("OVERLAPPING_OPERATION")) {
    const evidence: Array<Record<string, unknown>> = [];
    for (let index = 1; index < signals.length; index++) { const previous = signals[index - 1]!, current = signals[index]!; if (current.createdAt < previous.createdAt + positionWindowMs) evidence.push({ previous: previous.signalId, next: current.signalId, deltaMs: current.createdAt - previous.createdAt }); }
    results.push({ check: "OVERLAPPING_OPERATION", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("PRICE_PROVENANCE")) {
    const evidence: Array<Record<string, unknown>> = [];
    const observations = input.priceObservations ?? [];
    const strictMode = observations.length > 0 || (input.settlements ?? []).some((item) => item.entryPriceObservationId || item.settlementPriceObservationId);
    if (strictMode) {
      for (const settlement of input.settlements ?? []) {
        const chain = resolveGroundTruthChain({ entryPriceObservationId: settlement.entryPriceObservationId, settlementPriceObservationId: settlement.settlementPriceObservationId, entryTimestamp: settlement.entryTimestamp, settlementTimestamp: settlement.exitTimestamp, entryPrice: settlement.entryPrice, settlementPrice: settlement.exitPrice, observations });
        if (chain.status !== "COMPLETE") evidence.push({ signalId: settlement.signalId ?? null, status: chain.status, reasons: chain.reasons, entryPriceObservationId: settlement.entryPriceObservationId ?? null, settlementPriceObservationId: settlement.settlementPriceObservationId ?? null, reason: "price_provenance_incomplete" });
      }
    } else {
      const accepted = (input.prices ?? []).filter((sample) => sample.accepted !== false && Number.isFinite(sample.value));
      for (const settlement of input.settlements ?? []) {
        if (settlement.entryPrice === null) continue;
        const causal = accepted.filter((sample) => sample.timestamp <= settlement.entryTimestamp + 3_000).sort((a, b) => b.timestamp - a.timestamp)[0];
        if (!causal || causal.value !== settlement.entryPrice) evidence.push({ signalId: settlement.signalId ?? null, entryPrice: settlement.entryPrice, nearestAccepted: causal ? { value: causal.value, timestamp: causal.timestamp, source: causal.source ?? null } : null, provenance: "LEGACY_INCOMPLETE_PROVENANCE", reason: causal ? "entry_price_not_from_causal_observation" : "no_causal_price_observation" });
      }
    }
    results.push({ check: "PRICE_PROVENANCE", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("OUTLIER_LEAKAGE")) {
    const rejected = (input.prices ?? []).filter((sample) => sample.accepted === false);
    const evidence: Array<Record<string, unknown>> = [];
    for (const settlement of input.settlements ?? []) for (const sample of rejected) if (settlement.exitPrice !== null && settlement.exitPrice === sample.value) evidence.push({ signalId: settlement.signalId ?? null, price: sample.value, reason: sample.reason ?? null, usage: "rejected_price_used_in_settlement" });
    results.push({ check: "OUTLIER_LEAKAGE", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("SETTLEMENT_CAUSALITY")) {
    const evidence: Array<Record<string, unknown>> = [];
    for (const settlement of input.settlements ?? []) {
      const due = settlement.entryTimestamp + 60_000;
      if (settlement.exitTimestamp < due) { evidence.push({ signalId: settlement.signalId ?? null, reason: "settlement_before_expiration", exitTimestamp: settlement.exitTimestamp, due }); continue; }
      if (settlement.entryPrice === null) continue;
      const recomputed = settleTrade({ direction: settlement.result === "UNKNOWN" ? "BUY" : (settlement.entryPrice <= (settlement.exitPrice ?? settlement.entryPrice) ? "BUY" : "SELL"), entryPrice: settlement.entryPrice, exitPrice: settlement.exitPrice, entryTimestamp: settlement.entryTimestamp, exitTimestamp: settlement.exitTimestamp, dueTimestamp: due }).outcome;
      if (settlement.exitPrice !== null && recomputed !== settlement.result && settlement.result !== "UNKNOWN") evidence.push({ signalId: settlement.signalId ?? null, declared: settlement.result, recomputed, reason: "settlement_diverges_from_settleTrade" });
    }
    results.push({ check: "SETTLEMENT_CAUSALITY", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("TIMEOUT_ANOMALY")) {
    const evidence = (input.timeouts ?? []).filter((timeout) => timeout.latencyMs <= timeout.deadlineMs).map((timeout) => ({ at: timeout.at, latencyMs: timeout.latencyMs, deadlineMs: timeout.deadlineMs, reason: "timeout_within_deadline" }));
    results.push({ check: "TIMEOUT_ANOMALY", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("FALSE_POSITION_DIRECTION")) {
    const evidence = (input.positions ?? []).filter((position) => (position.direction === "BUY" || position.direction === "SELL") && !(position.evidence ?? []).some((item) => PANEL_TOKENS.test(String(item)))).map((position) => ({ signalId: position.signalId ?? null, direction: position.direction, evidence: position.evidence ?? [], reason: "direction_without_panel_evidence" }));
    results.push({ check: "FALSE_POSITION_DIRECTION", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("POSITION_DETECTION")) {
    const evidence: Array<Record<string, unknown>> = [];
    for (const signal of signals) {
      const failed = events.some((event) => event.type === "ENTRY_NOT_CONFIRMED" && event.signalId === signal.signalId);
      if (!failed) continue;
      const seen = (input.positions ?? []).filter((position) => position.detectedAt >= signal.createdAt && position.detectedAt <= signal.createdAt + positionWindowMs + 20_000 && (position.hasOpenPosition === true || (position.evidence ?? []).some((item) => PANEL_TOKENS.test(String(item)))));
      if (seen.length) evidence.push({ signalId: signal.signalId, reason: "entry_not_confirmed_despite_visual_position", positions: seen.map((position) => ({ detectedAt: position.detectedAt, evidence: position.evidence ?? [] })) });
    }
    results.push({ check: "POSITION_DETECTION", status: evidence.length ? "FAIL" : "PASS", evidence });
  }
  if (selected.has("STALE_CONTEXT")) {
    const evidence = (input.fastDecisions ?? []).filter((decision) => decision.deepAnalysisAgeMs !== null && decision.deepAnalysisAgeMs !== undefined && decision.deepAnalysisAgeMs > 90_000).map((decision) => ({ at: decision.at, candleId: decision.candleId ?? null, deepAnalysisAgeMs: decision.deepAnalysisAgeMs, reason: "stale_deep_context" }));
    results.push({ check: "STALE_CONTEXT", status: evidence.length ? "WARN" : "PASS", evidence });
  }
  if (selected.has("DEEP_FAST_CONFLICT")) {
    const evidence = (input.fastDecisions ?? []).filter((decision) => decision.trendAlignment === "COUNTER_TREND").map((decision) => ({ at: decision.at, candleId: decision.candleId ?? null, decision: decision.decision, trendAlignment: decision.trendAlignment, regime: decision.regime ?? null }));
    results.push({ check: "DEEP_FAST_CONFLICT", status: evidence.length ? "WARN" : "PASS", evidence });
  }
  if (selected.has("COUNTER_TREND_FAILURE")) {
    const evidence = (input.fastDecisions ?? []).filter((decision) => decision.counterTrend === true && (decision.decision === "BUY" || decision.decision === "SELL") && decision.settlementResult === "LOSS").map((decision) => ({ at: decision.at, candleId: decision.candleId ?? null, decision: decision.decision, rawConfidence: decision.rawConfidence ?? null, reason: "counter_trend_loss" }));
    results.push({ check: "COUNTER_TREND_FAILURE", status: evidence.length ? "WARN" : "PASS", evidence });
  }
  return results;
}
