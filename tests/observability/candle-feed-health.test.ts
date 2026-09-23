/**
 * CANDLE FEED HEALTH — separa as camadas CONNECTED / SUBSCRIBED / RECEIVING / STORING
 * e prova os motivos de bloqueio (NO_CANDLE_HISTORY, INSUFFICIENT_CANDLES, CANDLE_FEED_STALE, MARKET_NOT_SUBSCRIBED).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const healthModule = await import("../../relay/intelligence/candle-feed-health.mjs");
const { marketFeedHealth, candleFeedHealth } = healthModule as any;

const makeCandles = (count: number, lastAt: number) => Array.from({ length: count }, (_, index) => ({
  id: `c${index}`, bucketStart: lastAt - (count - 1 - index) * 5_000, bucketEnd: lastAt - (count - 1 - index) * 5_000 + 5_000, open: 1, high: 1.1, low: 0.9, close: 1.05,
}));

const makeCtx = (marketKey: string, { count = 50, lastAt = 1_000_000, subscriptionState = "SUBSCRIBED", enabled = true, availability = "OPEN" } = {}) => {
  const candles = makeCandles(count, lastAt);
  return {
    marketKey, activeId: 76, enabled, marketType: "OTC", availability, subscriptionState,
    candles: new Map(candles.map((candle) => [candle.bucketStart, candle])),
    lastCandle: candles[candles.length - 1] ?? null,
  };
};

describe("candle feed health — por mercado", () => {
  it("subscribed + candles frescos => feedReady", () => {
    const now = 1_003_000;
    const health = marketFeedHealth(makeCtx("EURUSD:OTC", { lastAt: 1_000_000 }), { now, maxAgeMs: 15_000 });
    expect(health.feedReady).toBe(true);
    expect(health.storedCandles).toBe(50);
    expect(health.ageMs).toBe(3_000);
    expect(health.reasons).toEqual([]);
    expect(health.subscriptionState).toBe("SUBSCRIBED");
  });

  it("stale => CANDLE_FEED_STALE; poucos candles => INSUFFICIENT_CANDLES; vazio => NO_CANDLE_HISTORY", () => {
    const now = 1_060_000;
    expect(marketFeedHealth(makeCtx("A", { lastAt: 1_000_000 }), { now, maxAgeMs: 15_000 }).reasons).toContain("CANDLE_FEED_STALE");
    expect(marketFeedHealth(makeCtx("B", { count: 10, lastAt: now - 1_000 }), { now, maxAgeMs: 15_000 }).reasons).toContain("INSUFFICIENT_CANDLES");
    expect(marketFeedHealth(makeCtx("C", { count: 0, lastAt: now }), { now, maxAgeMs: 15_000 }).reasons).toContain("NO_CANDLE_HISTORY");
  });

  it("nao assinado => MARKET_NOT_SUBSCRIBED (mesmo com candles no buffer)", () => {
    const health = marketFeedHealth(makeCtx("D", { subscriptionState: "UNSUBSCRIBED", lastAt: 1_000_000 }), { now: 1_001_000 });
    expect(health.feedReady).toBe(false);
    expect(health.reasons).toContain("MARKET_NOT_SUBSCRIBED");
  });
});

describe("candle feed health — global", () => {
  it("camadas: disconnect => CANDLE_FEED_DISCONNECTED; conectado com mercado ready => feedReady", () => {
    const now = 1_004_000;
    const markets = [makeCtx("EURUSD:OTC", { lastAt: 1_000_000 }), makeCtx("USDJPY:OTC", { count: 10, lastAt: now - 1_000 })];
    const disconnected = candleFeedHealth({ session: { connected: false, host: null, connectionId: null }, markets, metrics: { candlesReceivedTotal: 10, candlesStoredTotal: 5, lastMarketMessageAt: now - 1_000 }, now });
    expect(disconnected.wsConnected).toBe(false);
    expect(disconnected.feedReady).toBe(false);
    expect(disconnected.reasons).toContain("CANDLE_FEED_DISCONNECTED");
    const connected = candleFeedHealth({ session: { connected: true, host: "ws.iqoption.com", connectionId: "abc" }, markets, metrics: { candlesReceivedTotal: 10, candlesStoredTotal: 5, lastMarketMessageAt: now - 1_000 }, now, reconnects: 2, lastReconnectAt: now - 60_000 });
    expect(connected.feedReady).toBe(true);
    expect(connected.marketsSubscribed).toBe(2);
    expect(connected.marketsWithCandles).toBe(2);
    expect(connected.marketsReady).toBe(1);
    expect(connected.reconnectCount).toBe(2);
    expect(connected.candlesReceivedTotal).toBe(10);
    expect(connected.candlesStoredTotal).toBe(5);
    expect(connected.reasons).toContain("INSUFFICIENT_CANDLES");
  });

  it("sem subscriptions/candles => reasons e feedReady=false", () => {
    const now = 1_004_000;
    const health = candleFeedHealth({ session: { connected: true }, markets: [makeCtx("X", { count: 0, subscriptionState: "FAILED", lastAt: now })], metrics: {}, now });
    expect(health.feedReady).toBe(false);
    expect(health.reasons).toContain("MARKET_NOT_SUBSCRIBED");
    expect(health.subscriptionCount).toBe(0);
    expect(health.marketsWithCandles).toBe(0);
  });
});
