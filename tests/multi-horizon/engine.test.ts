import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../src/market/model";
import { runPrequentialExperiment } from "../../src/multi-horizon/engine";

function candles(symbol: string, count = 2_800): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 1.1 + index * 0.000002 + Math.sin(index / 8) * 0.00003;
    return { provider: "test", symbol, timeframe: "1m", open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close, volume: 0, timestamp: 1_700_000_000_000 + index * 60_000, receivedAt: 1_700_000_000_000 + (index + 1) * 60_000, isClosed: true, source: "test", quality: "high" };
  });
}

describe("multi-horizon prequential research", () => {
  it("refuses sub-minute outcomes from a 1m provider", () => {
    const result = runPrequentialExperiment({ provider: "yahoo-forex", minimumResolutionSeconds: 60, series: { "EUR/USD": candles("EUR/USD") } }, 30);
    expect(result.status).toBe("PROVIDER_LIMITATION");
    expect(result.trades).toHaveLength(0);
  });

  it("uses frozen versions only after the 800-trade boundary", () => {
    const series = Object.fromEntries(["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"].map((symbol) => [symbol, candles(symbol)]));
    const result = runPrequentialExperiment({ provider: "test", minimumResolutionSeconds: 60, series, maxActionable: 1_000 }, 60);
    expect(result.status).toBe("COMPLETED");
    expect(result.trades).toHaveLength(1_000);
    const holdout = result.trades.filter((row) => row.phase === "LOCKED_HOLDOUT");
    expect(holdout).toHaveLength(200);
    expect(new Set(holdout.map((row) => `${row.modelVersion}/${row.strategyVersion}`)).size).toBe(1);
    expect(result.trades.every((row) => row.dataQualityScore >= 0.7)).toBe(true);
  });
});
