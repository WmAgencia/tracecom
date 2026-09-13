import { describe, expect, it } from "vitest";
import { classifyRegime } from "../../src/engine/regime";

const now = 1_000_000;
const series = (prices: number[], step = 2_000, endAt = now) => prices.map((value, index) => ({ value, timestamp: endAt - (prices.length - 1 - index) * step }));

describe("causal market regime", () => {
  it("classifies a monotonic advance as TREND_UP and the inverse as TREND_DOWN", () => {
    expect(classifyRegime(series([1.3850, 1.3853, 1.3856, 1.3859, 1.3862, 1.3865]), now).regime).toBe("TREND_UP");
    expect(classifyRegime(series([1.3865, 1.3862, 1.3859, 1.3856, 1.3853, 1.3850]), now).regime).toBe("TREND_DOWN");
  });

  it("classifies a compressed oscillation as RANGE", () => {
    expect(classifyRegime(series([1.38501, 1.38503, 1.38500, 1.38502, 1.38501, 1.38502]), now).regime).toBe("RANGE");
  });

  it("detects high volatility", () => {
    expect(classifyRegime(series([1.3850, 1.3875, 1.3830, 1.3880, 1.3825, 1.3870]), now).regime).toBe("HIGH_VOLATILITY");
  });

  it("never consumes observations after now", () => {
    const future = [{ value: 9.99, timestamp: now + 60_000 }, { value: 9.99, timestamp: now + 120_000 }];
    const causalOnly = classifyRegime(series([1.3850, 1.3851, 1.3852, 1.3853]), now);
    const withFuture = classifyRegime([...series([1.3850, 1.3851, 1.3852, 1.3853]), ...future], now);
    expect(withFuture.regime).toBe(causalOnly.regime);
  });

  it("is deterministic for the same causal state (regime persistence)", () => {
    const prices = series([1.3850, 1.3853, 1.3856, 1.3859]);
    expect(classifyRegime(prices, now).regime).toBe(classifyRegime(prices, now).regime);
  });

  it("returns UNCERTAIN without sufficient evidence", () => {
    expect(classifyRegime([{ value: 1.385, timestamp: now }], now).regime).toBe("UNCERTAIN");
    expect(classifyRegime([], now).regime).toBe("UNCERTAIN");
  });
});
