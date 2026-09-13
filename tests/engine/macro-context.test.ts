import { describe, expect, it } from "vitest";
import { buildMacroContext, buildMicroContext, CANDLE_TIMEFRAME_SECONDS, counterTrendEvidence, MACRO_THRESHOLDS, PREDICTION_HORIZON_SECONDS, trendAlignmentFor, VISIBLE_WINDOW_SECONDS } from "../../src/engine/macro-context";

const now = 1_000_000;
const series = (prices: number[], step = 2_000, endAt = now) => prices.map((value, index) => ({ value, timestamp: endAt - (prices.length - 1 - index) * step }));

const up = series([1.3850, 1.3853, 1.3856, 1.3859, 1.3862, 1.3865]);
const down = series([1.3865, 1.3862, 1.3859, 1.3856, 1.3853, 1.3850]);

describe("macro/micro context with the three separate time concepts", () => {
  it("keeps candle timeframe, visible window and horizon explicitly different", () => {
    expect(CANDLE_TIMEFRAME_SECONDS).toBe(5);
    expect(VISIBLE_WINDOW_SECONDS).toBe(900);
    expect(PREDICTION_HORIZON_SECONDS).toBe(60);
    expect(VISIBLE_WINDOW_SECONDS / CANDLE_TIMEFRAME_SECONDS).toBe(180);
  });

  it("classifies the macro trend causally", () => {
    expect(["UP", "STRONG_UP"]).toContain(buildMacroContext(up, now).trend);
    expect(["DOWN", "STRONG_DOWN"]).toContain(buildMacroContext(down, now).trend);
  });

  it("ignores future observations", () => {
    const future = [{ value: 9.9, timestamp: now + 60_000 }, { value: 9.9, timestamp: now + 120_000 }];
    expect(buildMacroContext([...up, ...future], now).trend).toBe(buildMacroContext(up, now).trend);
  });

  it("does not flip the macro on a single noisy observation (hysteresis)", () => {
    const macro = buildMacroContext(up, now);
    const noisy = buildMacroContext([...up, { value: up[up.length - 1]!.value - .0035, timestamp: now + 2_000 }], now + 2_000, macro);
    expect(noisy.trend).toBe(macro.trend);
    expect(noisy.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it("eventually accepts a real, persistent macro reversal", () => {
    let macro = buildMacroContext(up, now);
    const reversed: typeof up = [];
    for (let index = 0; index < MACRO_THRESHOLDS.confirmations + 1; index++) {
      const shifted = series([1.3865 - .0003 * index, 1.3862 - .0003 * index, 1.3859 - .0003 * index, 1.3856 - .0003 * index, 1.3853 - .0003 * index, 1.3850 - .0003 * index], 2_000, now + 2_000 * (index + 1));
      macro = buildMacroContext(shifted, now + 2_000 * (index + 1), macro);
      reversed.push(...shifted.slice(0, 0));
    }
    expect(["DOWN", "STRONG_DOWN"]).toContain(macro.trend);
    expect(macro.transitions).toBeGreaterThanOrEqual(1);
  });

  it("reacts quickly at the micro scale and detects reversals", () => {
    const reversal = series([1.3850, 1.3848, 1.3846, 1.3844, 1.3842, 1.3840, 1.3841, 1.3844, 1.3847, 1.3850, 1.3853, 1.3856], 2_000);
    const micro = buildMicroContext(reversal, now);
    expect(["REVERSAL_UP", "UP"]).toContain(micro.microTrend);
  });

  it("maps alignment and demands explicit evidence for counter-trend", () => {
    expect(trendAlignmentFor("BUY", "STRONG_UP")).toBe("WITH_TREND");
    expect(trendAlignmentFor("BUY", "STRONG_DOWN")).toBe("COUNTER_TREND");
    expect(trendAlignmentFor("NONE", "STRONG_DOWN")).toBe("NEUTRAL");
    const micro = buildMicroContext(series([1.3840, 1.3842, 1.3844, 1.3846, 1.3848, 1.3850], 2_000), now);
    const alone = counterTrendEvidence("BUY", "STRONG_DOWN", { microTrend: "UP", microMomentum: .2, evidence: [] }, series([1.3850, 1.3845, 1.3840]), now);
    expect(alone.length).toBe(0);
    const confirmed = counterTrendEvidence("BUY", "STRONG_DOWN", { microTrend: "REVERSAL_UP", microMomentum: .6, evidence: [] }, series([1.3850, 1.3842, 1.3851]), now);
    expect(confirmed.length).toBeGreaterThanOrEqual(2);
  });
});
