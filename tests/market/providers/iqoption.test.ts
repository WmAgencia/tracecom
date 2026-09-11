import { describe, expect, it } from "vitest";
import { IqOptionMarketProvider } from "../../../src/market/providers/iqoption/provider";
import { normalizeIqSymbol } from "../../../src/market/providers/iqoption/symbol-resolver";

describe("IqOptionMarketProvider", () => {
  it("keeps OTC distinct and accepts only normalized read-only market frames", async () => {
    expect(normalizeIqSymbol("EUR/USD-OTC")).toEqual({ symbol: "EURUSD-OTC", isOtc: true });
    const provider = new IqOptionMarketProvider();
    const seen: string[] = [];
    await provider.subscribe({ symbol: "EURUSD-OTC", topics: ["klines"], timeframes: ["1m"] }, (event) => seen.push(event.type));
    expect(provider.ingest({ kind: "candle", tabId: 4, activeId: 1, symbol: "EUR/USD-OTC", timeframe: "1m", open: 1.1, high: 1.2, low: 1.05, close: 1.15, volume: 0, timestamp: 1_700_000_000_000, isClosed: true, sequence: 1, receivedAt: 1_700_000_001_000, serverTime: 1_700_000_001_000 })).toBe(true);
    expect(seen).toContain("candle");
    expect((await provider.getCandles({ symbol: "EURUSD-OTC", timeframe: "1m", start: 0 })).candles).toHaveLength(1);
  });

  it("rejects duplicate/out-of-order frames and reports unhealthy stale feed", () => {
    const provider = new IqOptionMarketProvider();
    const frame = { kind: "tick" as const, tabId: 1, activeId: 1, symbol: "EURUSD", price: 1.2, timestamp: 1_700_000_000_000, sequence: 2, receivedAt: 1_700_000_000_100 };
    expect(provider.ingest(frame)).toBe(true);
    expect(provider.ingest(frame)).toBe(false);
    expect(provider.health(1_700_000_020_000).stale).toBe(true);
    expect(provider.health().rejectedFrames).toBe(1);
  });
});
