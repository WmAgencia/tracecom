import { describe, expect, it } from "vitest";
import { recommendPaperPosition } from "../../src/risk/bankroll";

const base = {
  balance: 10_000,
  calibratedProbability: 0.6,
  sampleSize: 80,
  payoutRatio: 1.5,
  stopDistancePct: 0.01,
  state: { realizedDailyLossPct: 0, currentDrawdownPct: 0, openPositions: 0, killSwitch: false },
};

describe("recommendPaperPosition", () => {
  it("uses fractional Kelly but caps risk and derives notional from the stop", () => {
    const result = recommendPaperPosition(base);
    expect(result.status).toBe("approved");
    expect(result.kellyFraction).toBeCloseTo(0.333333, 5);
    expect(result.appliedRiskFraction).toBe(0.01);
    expect(result.maxLoss).toBe(100);
    expect(result.positionNotional).toBe(10_000);
  });

  it("does not size when calibration evidence is insufficient", () => {
    const result = recommendPaperPosition({ ...base, sampleSize: 4 });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain("INSUFFICIENT_CALIBRATION_SAMPLE");
  });

  it("blocks manual kill switch, drawdown and daily budget independently", () => {
    expect(recommendPaperPosition({ ...base, state: { ...base.state, killSwitch: true } }).reasonCodes).toContain("KILL_SWITCH_ACTIVE");
    expect(recommendPaperPosition({ ...base, state: { ...base.state, currentDrawdownPct: 0.2 } }).reasonCodes).toContain("MAX_DRAWDOWN_REACHED");
    expect(recommendPaperPosition({ ...base, state: { ...base.state, realizedDailyLossPct: 0.05 } }).reasonCodes).toContain("DAILY_LOSS_LIMIT_REACHED");
  });

  it("rejects a negative edge instead of increasing stake after losses", () => {
    const result = recommendPaperPosition({ ...base, calibratedProbability: 0.3 });
    expect(result.status).toBe("no_edge");
    expect(result.positionNotional).toBe(0);
  });
});
