import { describe, expect, it } from "vitest";
import { Backtester, DEFAULT_CRITERIA } from "../../src/backtest/backtest";
import type { MarketCandle } from "../../src/market/model";

describe("directional backtest returns", () => {
  it("reports a positive return when a down setup wins on falling prices", async () => {
    const candles: MarketCandle[] = Array.from({ length: 120 }, (_, i) => ({
      provider: "test", symbol: "EURUSD", timeframe: "1m",
      open: 200 - i, high: 201 - i, low: 198 - i, close: 200 - i,
      volume: 100, timestamp: i * 60_000, receivedAt: i * 60_000 + 1,
      isClosed: true, source: "test", quality: "high",
    }));
    const result = await new Backtester().run({
      symbol: "EURUSD", timeframe: "1m",
      target: { direction: "down", horizon: 2, minMovePct: 0.1 },
      criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0 },
      source: { getCandles: async () => candles }, oosRatio: 0.25,
    });
    const wins = result.steps.filter((step) => step.outcome === "hit");
    expect(wins.length).toBeGreaterThan(0);
    expect(wins.every((step) => step.returnPct > 0)).toBe(true);
  });
});
