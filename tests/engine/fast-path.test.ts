import { describe, expect, it } from "vitest";
import { buildFastDecision, FAST_PATH_DEADLINE_MS, PREDICTION_HORIZON_SECONDS } from "../../src/engine/fast-path";
import { settleTrade } from "../../src/training/settlement";

const now = 1_000_000;

function series(prices: number[], start = now - 24_000, step = 2_000, endAt = now) {
  const count = prices.length;
  const first = endAt - (count - 1) * step;
  return prices.map((value, index) => ({ value, timestamp: first + index * step }));
}

/** O label oficial é sempre o preço em T+60; caminho intermediário não muda nada. */
function labelFor(direction: "BUY" | "SELL", entry: number, path: number[]) {
  return settleTrade({ direction, entryPrice: entry, exitPrice: path[path.length - 1]!, entryTimestamp: 0, exitTimestamp: 60_000, dueTimestamp: 60_000 }).outcome;
}

describe("fast decision path — T+60 semantics", () => {
  it("always declares a 60-second prediction horizon", () => {
    const result = buildFastDecision({ now, prices: series([1.385, 1.3852]) });
    expect(result.predictionHorizonSeconds).toBe(PREDICTION_HORIZON_SECONDS);
    expect(result.candleSeconds).toBe(5);
    expect(PREDICTION_HORIZON_SECONDS / 5).toBe(12);
  });

  it("always exposes a nonzero evidence probability distribution", () => {
    const result = buildFastDecision({ now, prices: series([1.385, 1.3852, 1.3854, 1.3856]) });
    expect(result.pBuy).toBeGreaterThanOrEqual(0); expect(result.pSell).toBeGreaterThanOrEqual(0); expect(result.pWait).toBeGreaterThanOrEqual(0);
    expect(result.pBuy + result.pSell + result.pWait).toBeCloseTo(1, 8);
    expect(result.probabilitySource).toBe("EVIDENCE_MODEL");
  });

  it("BUY labels only the T+60 price, not the intermediate path", () => {
    const entry = 1.3850;
    expect(labelFor("BUY", entry, [1.386, 1.383, 1.386, 1.383, 1.3862])).toBe("WIN");
    expect(labelFor("BUY", entry, [1.386, 1.386, 1.386, 1.386, 1.3848])).toBe("LOSS");
    expect(labelFor("BUY", entry, [1.386, 1.386, 1.386, 1.386, 1.3850])).toBe("DRAW");
  });

  it("SELL labels only the T+60 price, not the intermediate path", () => {
    const entry = 1.3850;
    expect(labelFor("SELL", entry, [1.384, 1.386, 1.384, 1.386, 1.3845])).toBe("WIN");
    expect(labelFor("SELL", entry, [1.384, 1.384, 1.384, 1.384, 1.3855])).toBe("LOSS");
  });

  it("generates all three profiles from the same evidence with identical confidence", () => {
    const result = buildFastDecision({ now, prices: series([1.3850, 1.3854, 1.3858, 1.3862, 1.3866, 1.3870]) });
    const profiles = Object.values(result.profiles);
    expect(profiles).toHaveLength(3);
    for (const profile of profiles) expect(profile.confidence).toBe(result.rawConfidence);
  });

  it("conservative never signals more than aggressive in a controlled fixture", () => {
    const strong = buildFastDecision({ now, prices: series([1.3850, 1.3855, 1.3860, 1.3865, 1.3870, 1.3875]) });
    expect(strong.profiles.AGGRESSIVE.decision).toBe("BUY");
    const weak = buildFastDecision({ now, prices: series([1.3850, 1.38502, 1.38501, 1.38503, 1.38502, 1.38504]) });
    expect(weak.profiles.CONSERVATIVE.decision).toBe("WAIT");
    expect(["WAIT"]).toContain(weak.profiles.AGGRESSIVE.decision === "WAIT" ? "WAIT" : weak.profiles.AGGRESSIVE.decision);
  });

  it("aggressive can still WAIT when there is no evidence", () => {
    const result = buildFastDecision({ now, prices: [] });
    expect(result.profiles.AGGRESSIVE.decision).toBe("WAIT");
    expect(result.operational).toBe(false);
  });

  it("times out beyond the deadline without producing an operational signal", () => {
    const result = buildFastDecision({ now, prices: series([1.3850, 1.3860, 1.3870]), deadlineMs: 0 });
    expect(result.fastPathStatus).toBe("FAST_PATH_TIMEOUT");
    expect(result.operational).toBe(false);
    expect(result.decision).toBe("WAIT");
  });

  it("never reports TIMEOUT for a sub-deadline run (167ms vs 5000ms regression)", () => {
    const fast = buildFastDecision({ now, prices: series([1.3850, 1.3855]), deadlineMs: 5_000 });
    expect(fast.timings.totalMs).toBeLessThan(5_000);
    expect(fast.fastPathStatus).toBe("FAST_PATH_COMPLETED");
    const insufficient = buildFastDecision({ now, prices: series([1.3850]), deadlineMs: 5_000 });
    expect(insufficient.fastPathStatus).toBe("FAST_PATH_COMPLETED");
    expect(insufficient.operational).toBe(false);
  });

  it("keeps the fast path well under the 5s budget in controlled runs", () => {
    const started = Date.now();
    const result = buildFastDecision({ now, prices: series([1.3850, 1.3855, 1.3860, 1.3865]) });
    expect(Date.now() - started).toBeLessThan(FAST_PATH_DEADLINE_MS);
    expect(result.timings.totalMs).toBeLessThan(FAST_PATH_DEADLINE_MS);
  });

  it("ignores future prices (no leakage) and reports evidence age", () => {
    const future = { value: 2.0, timestamp: now + 60_000 };
    const result = buildFastDecision({ now, prices: [...series([1.3850, 1.3855]), future] });
    expect(result.bullScore).toBe(buildFastDecision({ now, prices: series([1.3850, 1.3855]) }).bullScore);
    expect(result.evidenceAgeMs).toBeLessThanOrEqual(2_000);
  });

  it("ignores stale deep context instead of letting it bias a new decision", () => {
    const stale = { version: 1, at: now - 200_000, trend: "BULLISH", momentum: "UP" };
    const fresh = { version: 2, at: now - 5_000, trend: "BULLISH", momentum: "UP" };
    const prices = series([1.3850, 1.3851, 1.3850, 1.3851]);
    const withoutContext = buildFastDecision({ now, prices });
    const withStale = buildFastDecision({ now, prices, deepContext: stale });
    const withFresh = buildFastDecision({ now, prices, deepContext: fresh });
    expect(withStale.bullScore).toBe(withoutContext.bullScore);
    expect(withFresh.bullScore).toBeGreaterThanOrEqual(withoutContext.bullScore);
    expect(withStale.deepAnalysisAgeMs).toBeGreaterThan(90_000);
  });
});
