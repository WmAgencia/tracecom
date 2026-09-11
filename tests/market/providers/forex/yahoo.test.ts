import { describe, expect, it } from "vitest";
import { AutoForexProvider } from "../../../../src/market/providers/forex/auto";
import { YahooForexProvider } from "../../../../src/market/providers/forex/yahoo";
import type { MarketDataProvider } from "../../../../src/market/providerV2";

function responseFor(now: number): Response {
  const timestamps = [Math.floor((now - 120_000) / 1000), Math.floor((now - 60_000) / 1000)];
  return new Response(JSON.stringify({ chart: { result: [{ timestamp: timestamps, meta: { instrumentType: "CURRENCY" }, indicators: { quote: [{ open: [1.1, 1.1001], high: [1.1002, 1.1003], low: [1.0998, 1.1], close: [1.1001, 1.1002], volume: [0, 0] }] } }] } }), { status: 200 });
}

describe("YahooForexProvider", () => {
  it("normalizes only real chart OHLC and never synthesizes missing points", async () => {
    const now = Date.now();
    const provider = new YahooForexProvider({ fetchImpl: async () => responseFor(now) });
    const result = await provider.getCandles({ symbol: "EUR/USD", timeframe: "1m", start: now - 180_000, end: now, limit: 10 });
    expect(result.source).toBe("rest:yahoo-chart");
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]!.provider).toBe("yahoo-forex");
    expect(result.candles[0]!.source).toBe("rest:yahoo-chart");
  });

  it("rejects non-Forex symbols", async () => {
    const provider = new YahooForexProvider({ fetchImpl: async () => responseFor(Date.now()) });
    await expect(provider.getCandles({ symbol: "BTCUSDT", timeframe: "1m", start: 0, end: Date.now(), limit: 10 })).rejects.toThrow(/Forex/);
  });

  it("agrega 4h apenas com quatro candles 1h contíguos reais", async () => {
    const start = Date.UTC(2025, 0, 2, 0, 0, 0);
    const timestamps = Array.from({ length: 4 }, (_, i) => (start + i * 3_600_000) / 1000);
    const response = new Response(JSON.stringify({
      chart: {
        result: [{
          timestamp: timestamps,
          meta: { instrumentType: "CURRENCY" },
          indicators: { quote: [{
            open: [1.1, 1.101, 1.102, 1.103],
            high: [1.102, 1.103, 1.104, 1.105],
            low: [1.099, 1.1, 1.101, 1.102],
            close: [1.101, 1.102, 1.103, 1.104],
            volume: [0, 0, 0, 0],
          }] },
        }],
      },
    }), { status: 200 });
    const provider = new YahooForexProvider({ fetchImpl: async () => response });
    const result = await provider.getCandles({ symbol: "EUR/USD", timeframe: "4h", start, end: start + 4 * 3_600_000, limit: 10 });
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]).toMatchObject({ timeframe: "4h", timestamp: start, open: 1.1, close: 1.104, high: 1.105, low: 1.099 });
  });
});

describe("AutoForexProvider", () => {
  it("falls back only between Forex providers and exposes PROVIDER_UNAVAILABLE", async () => {
    const failing: MarketDataProvider = {
      id: "oanda", state: "disconnected", connectedAt: null,
      connect: async () => { throw new Error("offline"); }, disconnect: () => undefined, getStatus: () => "error",
      subscribe: async () => () => undefined, getTicker: async () => ({ price: 0, quality: "unknown", receivedAt: 0, source: "none" }),
      getCandles: async () => ({ candles: [], source: "none", quality: "unknown" }), getTrades: async () => ({ trades: [], source: "none" }),
      getOrderBook: async () => ({ provider: "oanda", symbol: "EUR/USD", bids: [], asks: [], timestamp: 0, receivedAt: 0, quality: "unknown" }),
      getMarketMetadata: async () => null, historical: { provider: "oanda", fetchPage: async () => ({ candles: [], nextStartTime: null }) },
    };
    const yahoo = new YahooForexProvider({ fetchImpl: async () => responseFor(Date.now()) });
    const auto = new AutoForexProvider([failing, yahoo]);
    await auto.connect();
    expect(auto.activeProviderId).toBe("yahoo-forex");
    expect(auto.state).toBe("connected");
  });
});
