import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../src/market/model";
import { analyzeSmc } from "../../src/quant/smc";

const candle = (i: number, open: number, high: number, low: number, close: number): MarketCandle => ({
  provider: "test", symbol: "EUR/USD", timeframe: "1m", open, high, low, close,
  volume: 100, timestamp: i * 60_000, receivedAt: i * 60_000 + 60_000,
  isClosed: true, source: "test", quality: "high",
});

describe("SMC determinístico", () => {
  it("detecta FVG bullish e preenchimento posterior", () => {
    const candles = [
      candle(0, 100, 101, 99, 100),
      candle(1, 100, 103, 100, 102.8),
      candle(2, 103, 104, 102, 103.5),
      candle(3, 103.5, 104, 100.5, 101),
    ];
    const result = analyzeSmc(candles, { swings: [], trend: "sideways", structureLabel: "" });
    expect(result.fairValueGaps[0]).toMatchObject({ direction: "bullish", from: 101, to: 102, filled: true });
  });

  it("classifica fechamento contra trend como CHOCH", () => {
    const candles = [
      candle(0, 100, 101, 99, 100),
      candle(1, 100, 101, 98, 99),
      candle(2, 99, 103, 99, 102),
    ];
    const result = analyzeSmc(candles, {
      trend: "down", structureLabel: "",
      swings: [{ index: 1, timestamp: 60_000, price: 101, kind: "LH" }],
    });
    expect(result.structureBreak).toMatchObject({ kind: "CHOCH", direction: "bullish", level: 101 });
  });

  it("expõe premium/discount e score limitado", () => {
    const candles = [candle(0, 100, 110, 90, 100), candle(1, 100, 105, 95, 99), candle(2, 99, 100, 91, 92)];
    const result = analyzeSmc(candles, { swings: [], trend: "sideways", structureLabel: "" });
    expect(result.dealingRange?.zone).toBe("discount");
    expect(result.biasScore).toBeGreaterThanOrEqual(-1);
    expect(result.biasScore).toBeLessThanOrEqual(1);
  });
});
