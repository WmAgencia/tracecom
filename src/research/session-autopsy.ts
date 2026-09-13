/** Structured session autopsy built on the audit engine.
 *
 * Pure: receives a diagnostic bundle (same shape as the audit endpoint) and
 * returns counters plus suspected failure causes. Suspected causes are
 * hypotheses backed by concrete audit evidence — never claimed as proven.
 */
import { runAudit, type AuditCheckResult, type AuditInput } from "./audit-engine.js";
import type { Evaluation } from "./replay-engine.js";

export type AutopsyInput = AuditInput & { evaluations?: Evaluation[]; agentRuns?: Array<{ agentId?: string; structuredOutput?: Record<string, unknown> | null }> };

export type SuspectedCause = { suspectedFailureCause: string; evidenceCount: number; examples: Array<Record<string, unknown>> };

export type AutopsyReport = {
  sessionId: string | null;
  totalMarketEvents: number;
  signals: number;
  wins: number; losses: number; draws: number; unknown: number;
  entryDetectionFailures: number;
  positionDirectionMismatches: number;
  countdownIssues: number;
  priceIssues: number;
  agentDisagreements: number;
  counterTrendSignals: number;
  deepFastConflicts: number;
  staleContext: number;
  latencyAnomalies: number;
  auditFindings: AuditCheckResult[];
  topSuspectedFailureCauses: SuspectedCause[];
};

const CAUSE_BY_CHECK: Record<string, string> = {
  SIGNAL_FLAPPING: "FAST_OVERREACTION",
  COUNTDOWN_RESET: "COUNTDOWN_INVARIANT",
  OVERLAPPING_OPERATION: "OPERATIONAL_OVERLAP",
  PRICE_PROVENANCE: "PRICE_GROUND_TRUTH",
  OUTLIER_LEAKAGE: "PRICE_GROUND_TRUTH",
  SETTLEMENT_CAUSALITY: "SETTLEMENT_NON_CAUSAL",
  TIMEOUT_ANOMALY: "TIMEOUT",
  FALSE_POSITION_DIRECTION: "POSITION_DETECTION",
  POSITION_DETECTION: "POSITION_DETECTION",
  STALE_CONTEXT: "DEEP_STALE",
  DEEP_FAST_CONFLICT: "FAST_OVERREACTION",
  COUNTER_TREND_FAILURE: "COUNTER_TREND",
};

export function runAutopsy(input: AutopsyInput): AutopsyReport {
  const auditFindings = runAudit(input);
  const settlements = input.settlements ?? [];
  const signals = input.signals ?? [];
  const events = input.events ?? [];
  const fastDecisions = input.fastDecisions ?? [];
  const positions = input.positions ?? [];
  const timeouts = input.timeouts ?? [];
  const evaluations = input.evaluations ?? [];
  const wins = settlements.filter((item) => item.result === "WIN").length;
  const losses = settlements.filter((item) => item.result === "LOSS").length;
  const draws = settlements.filter((item) => item.result === "DRAW").length;
  const unknown = settlements.filter((item) => item.result === "UNKNOWN").length;
  const agentRuns = input.agentRuns ?? [];
  const agentDirections = agentRuns.map((run) => run.structuredOutput && typeof run.structuredOutput.direction === "string" ? run.structuredOutput.direction : null).filter((direction): direction is string => Boolean(direction));
  const majority = agentDirections.length ? agentDirections.sort((a, b) => agentDirections.filter((item) => item === b).length - agentDirections.filter((item) => item === a).length)[0] : null;
  const causeBuckets = new Map<string, Array<Record<string, unknown>>>();
  for (const finding of auditFindings) {
    if (finding.status === "PASS") continue;
    const cause = CAUSE_BY_CHECK[finding.check] ?? finding.check;
    const rows = causeBuckets.get(cause) ?? [];
    rows.push(...finding.evidence.slice(0, 5));
    causeBuckets.set(cause, rows);
  }
  return {
    sessionId: input.sessionId ?? null,
    totalMarketEvents: new Set([...fastDecisions.map((item) => item.candleId ?? String(item.at)), ...events.filter((item) => item.type === "VISION_MARKET_SAMPLE").map((item) => String(item.data?.frameId ?? item.t))]).size,
    signals: signals.length,
    wins, losses, draws, unknown,
    entryDetectionFailures: events.filter((item) => item.type === "ENTRY_NOT_CONFIRMED").length,
    positionDirectionMismatches: events.filter((item) => item.type === "POSITION_DIRECTION_MISMATCH").length,
    countdownIssues: auditFindings.find((item) => item.check === "COUNTDOWN_RESET")?.evidence.length ?? 0,
    priceIssues: (auditFindings.find((item) => item.check === "PRICE_PROVENANCE")?.evidence.length ?? 0) + (auditFindings.find((item) => item.check === "OUTLIER_LEAKAGE")?.evidence.length ?? 0),
    agentDisagreements: majority ? agentDirections.filter((direction) => direction !== majority).length : 0,
    counterTrendSignals: fastDecisions.filter((item) => item.counterTrend === true && (item.decision === "BUY" || item.decision === "SELL")).length,
    deepFastConflicts: fastDecisions.filter((item) => item.trendAlignment === "COUNTER_TREND").length,
    staleContext: fastDecisions.filter((item) => item.deepAnalysisAgeMs !== null && item.deepAnalysisAgeMs !== undefined && item.deepAnalysisAgeMs > 90_000).length,
    latencyAnomalies: timeouts.filter((item) => item.latencyMs <= item.deadlineMs).length + evaluations.filter((item) => item.status === "FAST_PATH_TIMEOUT").length,
    auditFindings,
    topSuspectedFailureCauses: [...causeBuckets.entries()].map(([suspectedFailureCause, examples]) => ({ suspectedFailureCause, evidenceCount: examples.length, examples })).sort((a, b) => b.evidenceCount - a.evidenceCount),
  };
}
