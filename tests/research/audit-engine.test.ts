import { describe, expect, it } from "vitest";
import { runAudit, type AuditInput } from "../../src/research/audit-engine";

const T = 1_000_000;

function plantedBundle(): AuditInput {
  return {
    sessionId: "vision_synthetic_audit",
    prices: [
      { value: 1.384025, timestamp: T - 4_000, accepted: true, source: "IQ_OPTION_CURRENT_PRICE_LABEL" },
      { value: 1.384125, timestamp: T - 2_000, accepted: true, source: "IQ_OPTION_CURRENT_PRICE_LABEL" },
      { value: 1.388500, timestamp: T, accepted: false, reason: "TEMPORAL_SPIKE", source: "IQ_OPTION_CURRENT_PRICE_LABEL" },
    ],
    signals: [
      { signalId: "op_1", direction: "BUY", createdAt: T, countdownEndsAt: T + 10_000, rawConfidence: .73, trendAlignment: "COUNTER_TREND" },
      { signalId: "op_2", direction: "SELL", createdAt: T + 5_000, countdownEndsAt: T + 15_000 },
    ],
    positions: [
      { signalId: "op_1", detectedAt: T + 12_000, direction: "SELL", evidence: ["green_candles", "uptrend"] },
      { signalId: "op_1", detectedAt: T + 13_000, hasOpenPosition: true, evidence: ["open_positions_panel"], direction: "BUY" },
    ],
    events: [
      { t: T, type: "ENTRY_COUNTDOWN_STARTED", signalId: "op_1", data: { countdownEndsAt: T + 10_000 } },
      { t: T + 2_000, type: "ENTRY_COUNTDOWN_STARTED", signalId: "op_1", data: { countdownEndsAt: T + 12_000 } },
      { t: T + 25_000, type: "ENTRY_NOT_CONFIRMED", signalId: "op_1" },
    ],
    settlements: [
      { signalId: "op_1", entryPrice: 1.38571, exitPrice: 1.3860, entryTimestamp: T, exitTimestamp: T + 30_000, result: "WIN" },
      { signalId: "op_1", entryPrice: 1.384125, exitPrice: 1.3885, entryTimestamp: T, exitTimestamp: T + 61_000, result: "WIN", source: "IQ_OPTION_CURRENT_PRICE_LABEL" },
    ],
    fastDecisions: [
      { candleId: "candle_1", at: T, decision: "BUY", trendAlignment: "COUNTER_TREND", counterTrend: true, deepAnalysisAgeMs: 120_000, settlementResult: "LOSS", rawConfidence: .73 },
    ],
    timeouts: [{ at: T + 60_000, latencyMs: 167, deadlineMs: 5_000 }],
  };
}

describe("automated audit engine", () => {
  it("passes a clean session", () => {
    const clean: AuditInput = {
      prices: [{ value: 1.385, timestamp: T - 2_000, accepted: true, source: "X" }],
      signals: [{ signalId: "op_clean", direction: "BUY", createdAt: T, countdownEndsAt: T + 10_000 }],
      positions: [{ signalId: "op_clean", detectedAt: T + 5_000, hasOpenPosition: true, direction: "BUY", evidence: ["open_position_card"], price: 1.385 }],
      events: [{ t: T, type: "ENTRY_COUNTDOWN_STARTED", signalId: "op_clean", data: { countdownEndsAt: T + 10_000 } }],
      settlements: [{ signalId: "op_clean", entryPrice: 1.385, exitPrice: 1.386, entryTimestamp: T, exitTimestamp: T + 61_000, result: "WIN" }],
      fastDecisions: [],
      timeouts: [{ at: T, latencyMs: 6_000, deadlineMs: 5_000 }],
    };
    const results = runAudit(clean);
    expect(results.every((item) => item.status !== "FAIL")).toBe(true);
  });

  it("detects every planted problem with structured evidence", () => {
    const byCheck = Object.fromEntries(runAudit(plantedBundle()).map((item) => [item.check, item]));
    expect(byCheck.SIGNAL_FLAPPING!.status).toBe("FAIL");
    expect(byCheck.COUNTDOWN_RESET!.status).toBe("FAIL");
    expect(byCheck.OVERLAPPING_OPERATION!.status).toBe("FAIL");
    expect(byCheck.PRICE_PROVENANCE!.status).toBe("FAIL");
    expect(byCheck.OUTLIER_LEAKAGE!.status).toBe("FAIL");
    expect(byCheck.SETTLEMENT_CAUSALITY!.status).toBe("FAIL");
    expect(byCheck.TIMEOUT_ANOMALY!.status).toBe("FAIL");
    expect(byCheck.FALSE_POSITION_DIRECTION!.status).toBe("FAIL");
    expect(byCheck.POSITION_DETECTION!.status).toBe("FAIL");
    expect(byCheck.STALE_CONTEXT!.status).toBe("WARN");
    expect(byCheck.DEEP_FAST_CONFLICT!.status).toBe("WARN");
    expect(byCheck.COUNTER_TREND_FAILURE!.status).toBe("WARN");
    expect(byCheck.PRICE_PROVENANCE!.evidence[0]).toMatchObject({ reason: "entry_price_not_from_causal_observation" });
    expect(byCheck.TIMEOUT_ANOMALY!.evidence[0]).toMatchObject({ latencyMs: 167, deadlineMs: 5_000, reason: "timeout_within_deadline" });
    expect(byCheck.FALSE_POSITION_DIRECTION!.evidence[0]).toMatchObject({ direction: "SELL", reason: "direction_without_panel_evidence" });
  });

  it("supports selecting a subset of checks", () => {
    const results = runAudit(plantedBundle(), ["TIMEOUT_ANOMALY"]);
    expect(results.map((item) => item.check)).toEqual(["TIMEOUT_ANOMALY"]);
  });
});
