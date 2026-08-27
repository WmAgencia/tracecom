import { describe, expect, it } from "vitest";
import { buildMarketContext } from "../../src/market/context";
import { MarketDataService } from "../../src/market/service";
import { ProviderNotConfiguredError } from "../../src/market/providerV2";
import { MarketState } from "../../src/market/state";
import type { MarketCandle } from "../../src/market/model";

function c(ts: number, close: number): MarketCandle {
  return { provider: "binance", symbol: "BTCUSDT", timeframe: "1m", open: close, high: close + 1, low: close - 1, close, volume: 5, timestamp: ts, receivedAt: ts + 1, isClosed: true, source: "rest", quality: "high" };
}

describe("MarketContext (para o agente)", () => {
  it("limited os candles recentes (não passa stream bruto)", () => {
    const state = new MarketState();
    const now = Date.now();
    for (let i = 0; i < 200; i++) state.putCandle(c(now - (199 - i) * 60_000, 100));
    const ctx = buildMarketContext({
      provider: "binance", providerState: "connected", symbol: "BTCUSDT", timeframe: "1m",
      currentPrice: 100, latestClosedCandle: state.getCandles("BTCUSDT", "1m").at(-1) ?? null,
      candles: state.getCandles("BTCUSDT", "1m"), volume: 100, quality: "high", freshness: "fresh",
    });
    expect(ctx.recentCandles.length).toBeLessThanOrEqual(60);
    expect(ctx.available).toBe(true);
    expect(ctx.currentPrice).toBe(100);
  });

  it("marca indisponível quando sem conexão → agente deve ser WAIT", () => {
    const ctx = buildMarketContext({
      provider: "binance", providerState: "disconnected", symbol: "BTCUSDT", timeframe: "1m",
      currentPrice: null, latestClosedCandle: null, candles: [], volume: null, quality: "unknown", freshness: "unavailable",
    });
    expect(ctx.available).toBe(false);
    expect(ctx.note).toMatch(/WAIT|incerta/i);
  });
});

describe("MarketDataService: PROVIDER_NOT_CONFIGURED", () => {
  it("lança erro estruturado quando não há provedor", async () => {
    const svc = new MarketDataService({ provider: null, pipeline: null });
    await expect(svc.getMarketData({ symbol: "BTCUSDT", timeframe: "1m" })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
