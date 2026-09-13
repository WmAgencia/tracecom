import { describe, expect, it } from "vitest";
import { runAutopsy } from "../../src/research/session-autopsy";
import { queryEvaluations, queryEvents, queryFastDecisions, queryPositions } from "../../src/research/query-filters";
import type { Evaluation } from "../../src/research/replay-engine";

const T = 1_000_000;
const planted = {
  sessionId: "vision_autopsy",
  prices: [{ value: 1.384125, timestamp: T - 2_000, accepted: true, source: "X" }, { value: 1.3885, timestamp: T, accepted: false, reason: "TEMPORAL_SPIKE" }],
  signals: [{ signalId: "op_1", direction: "BUY", createdAt: T, countdownEndsAt: T + 12_000 }],
  positions: [{ signalId: "op_1", detectedAt: T + 12_000, direction: "SELL", evidence: ["green_candles"] }, { signalId: "op_1", detectedAt: T + 13_000, hasOpenPosition: true, evidence: ["open_positions_panel"] }],
  events: [
    { t: T, type: "ENTRY_COUNTDOWN_STARTED", signalId: "op_1", data: { countdownEndsAt: T + 10_000 } },
    { t: T + 1_000, type: "ENTRY_COUNTDOWN_STARTED", signalId: "op_1", data: { countdownEndsAt: T + 12_000 } },
    { t: T + 2_000, type: "POSITION_DIRECTION_MISMATCH", signalId: "op_1" },
    { t: T + 25_000, type: "ENTRY_NOT_CONFIRMED", signalId: "op_1" },
  ],
  settlements: [{ signalId: "op_1", entryPrice: 1.38571, exitPrice: 1.3885, entryTimestamp: T, exitTimestamp: T + 30_000, result: "WIN" }],
  fastDecisions: [
    { candleId: "candle_1", at: T, decision: "BUY", counterTrend: true, trendAlignment: "COUNTER_TREND", deepAnalysisAgeMs: 120_000, settlementResult: "LOSS", rawConfidence: .73 },
    { candleId: "candle_2", at: T + 5_000, decision: "WAIT", rawConfidence: .5 },
  ],
  timeouts: [{ at: T, latencyMs: 167, deadlineMs: 5_000 }],
};

const evaluations: Evaluation[] = [
  { evaluationId: "v1:me_1", variantId: "v1", marketEventId: "me_1", groundTruthId: "gt_1", decision: "BUY", rawConfidence: .82, regime: "TREND_UP", macroTrend: "UP", microTrend: "UP", trendAlignment: "WITH_TREND", predictionHorizonSeconds: 60, latencyMs: 1, status: "FAST_PATH_COMPLETED", counterfactualResult: "LOSS", brokerSideEffects: 0 },
  { evaluationId: "v1:me_2", variantId: "v1", marketEventId: "me_2", groundTruthId: "gt_2", decision: "WAIT", rawConfidence: .55, regime: "RANGE", macroTrend: "SIDEWAYS", microTrend: "SIDEWAYS", trendAlignment: "NEUTRAL", predictionHorizonSeconds: 60, latencyMs: 1, status: "FAST_PATH_COMPLETED", counterfactualResult: null, brokerSideEffects: 0 },
];

describe("session autopsy + safe queries", () => {
  it("produces counters and suspected failure causes with evidence", () => {
    const report = runAutopsy(planted);
    expect(report.signals).toBe(1);
    expect(report.entryDetectionFailures).toBe(1);
    expect(report.positionDirectionMismatches).toBe(1);
    expect(report.countdownIssues).toBeGreaterThanOrEqual(1);
    expect(report.priceIssues).toBeGreaterThanOrEqual(1);
    expect(report.counterTrendSignals).toBe(1);
    expect(report.staleContext).toBe(1);
    expect(report.latencyAnomalies).toBe(1);
    const causes = report.topSuspectedFailureCauses.map((item) => item.suspectedFailureCause);
    expect(causes).toContain("PRICE_GROUND_TRUTH");
    expect(causes).toContain("POSITION_DETECTION");
    expect(causes).toContain("TIMEOUT");
    expect(causes).toContain("COUNTER_TREND");
    expect(report.auditFindings.some((item) => item.status === "FAIL")).toBe(true);
  });

  it("returns zeros for a clean bundle", () => {
    const report = runAutopsy({ events: [], prices: [], signals: [], positions: [], settlements: [], fastDecisions: [], timeouts: [] });
    expect(report).toMatchObject({ signals: 0, wins: 0, losses: 0, entryDetectionFailures: 0, priceIssues: 0, latencyAnomalies: 0 });
    expect(report.topSuspectedFailureCauses).toEqual([]);
  });

  it("answers safe queries without SQL", () => {
    expect(queryEvaluations(evaluations, { result: "LOSS" })).toHaveLength(1);
    expect(queryEvaluations(evaluations, { minConfidence: .8, result: "LOSS" })).toHaveLength(1);
    expect(queryEvaluations(evaluations, { minConfidence: .9 })).toHaveLength(0);
    expect(queryEvaluations(evaluations, { decision: "WAIT" })[0]?.marketEventId).toBe("me_2");
    expect(queryEvents(planted.events, { eventType: "ENTRY_NOT_CONFIRMED" })).toHaveLength(1);
    expect(queryPositions(planted.positions, { hasOpenPosition: true })).toHaveLength(1);
    expect(queryPositions(planted.positions, { direction: "SELL" })).toHaveLength(1);
    expect(queryFastDecisions(planted.fastDecisions, { counterTrend: true })).toHaveLength(1);
  });
});
