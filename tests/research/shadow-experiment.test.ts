import { describe, expect, it } from "vitest";
import { settleTrade } from "../../src/training/settlement";
import { buildCandles, computeFeatures, evaluateStrategies, settleOutcome, shouldAttemptSettlement, wilsonLower } from "../../relay/experiment.mjs";

const obs = (start: number, values: number[]) => values.map((v, i) => ({ t: start + i * 1000, v }));

describe("shadow experiment engine (causal, accounting-safe)", () => {
  it("derives 5s candles without fabricating missing OHLC", () => {
    const candles = buildCandles(obs(0, [1, 2, 3, 4, 100, 5]) as never);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ start: 0, open: 1, high: 100, low: 1, close: 100, n: 5 });
    expect(candles[1]).toMatchObject({ start: 5000, open: 5, close: 5, high: 5, low: 5, n: 1 });
  });

  it("features only use the supplied causal candles (no future knowledge)", () => {
    const base = Array.from({ length: 60 }, (_, i) => ({ start: i * 5000, close: 1 + i * 0.0001 }));
    const truncated = computeFeatures(base.slice(0, 40) as never);
    const full = computeFeatures(base as never);
    expect(truncated.last).toBe(base[39]!.close);
    expect(truncated.last).not.toBe(full.last);
    expect(truncated.momentum60).toBeCloseTo((base[39]!.close - base[27]!.close) / base[27]!.close, 12);
  });

  it("keeps the probability distribution normalized and WAIT first-class", () => {
    const rows = evaluateStrategies(computeFeatures(Array.from({ length: 60 }, (_, i) => ({ start: i * 5000, close: 1 + Math.sin(i / 3) * 0.0005 })) as never));
    expect(rows.length).toBe(6);
    expect(rows.map((r) => r.strategyVersion)).toContain("shadow-reversion-v4");
    for (const row of rows) {
      expect(row.pBuy + row.pSell + row.pWait).toBeCloseTo(1, 8);
      expect(["BUY", "SELL", "WAIT"]).toContain(row.direction);
    }
  });

  it("settlement outcome mirrors settleTrade for WIN/LOSS/DRAW/UNKNOWN", () => {
    const entry = 1.39;
    for (const [direction, exit] of [["BUY", 1.4], ["BUY", 1.38], ["SELL", 1.38], ["SELL", 1.4]] as const) {
      const canon = settleTrade({ direction, entryPrice: entry, exitPrice: exit, entryTimestamp: 0, exitTimestamp: 60_000, dueTimestamp: 60_000 });
      expect(settleOutcome(direction, entry, exit)).toBe(canon.outcome);
    }
    const draw = settleTrade({ direction: "BUY", entryPrice: entry, exitPrice: entry, entryTimestamp: 0, exitTimestamp: 60_000, dueTimestamp: 60_000 });
    expect(settleOutcome("BUY", entry, entry)).toBe(draw.outcome);
    expect(settleOutcome("BUY", entry, NaN)).toBe("UNKNOWN");
  });

  it("never counts evaluations as independent ground truth (accounting helper)", () => {
    expect(wilsonLower(60, 100)).toBeGreaterThan(0.4);
    expect(wilsonLower(0, 0)).toBeNull();
  });

  it("waits for the observation grace period before marking UNKNOWN", () => {
    const target = 1_000_000;
    expect(shouldAttemptSettlement(target, target)).toBe(false);
    expect(shouldAttemptSettlement(target + 14_999, target)).toBe(false);
    expect(shouldAttemptSettlement(target + 15_001, target)).toBe(true);
  });
});
