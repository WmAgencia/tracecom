import { describe, expect, it } from "vitest";
import { bucketStart, CandleAggregator } from "../../src/market/aggregator";
import type { MarketCandle, MarketTick } from "../../src/market/model";

function candle(timestamp: number, o = 100, h = 110, l = 90, c = 105, v = 10, isClosed = false, seq?: number): MarketCandle {
  return {
    provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
    open: o, high: h, low: l, close: c, volume: v,
    timestamp, receivedAt: timestamp + 1_000, isClosed,
    source: "ws:kline", quality: "high", ...(seq !== undefined ? { sequence: seq } : {}),
  };
}

const BLOCK = "2023-01-01T00:03:00Z";
const M = 60_000;

describe("CandleAggregator (1m→3m)", () => {
  it("agrega 3 candles de 1m em um de 3m com OHLCV correto", () => {
    const agg = new CandleAggregator({ target: "3m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const now = t0 + 2 * M + 30_000; // ainda dentro do bucket 3m (00:00–00:03)
    agg.ingest({ kind: "candle", candle: candle(t0 + 0 * M, 100, 105, 99, 101, 10) }, now);
    agg.ingest({ kind: "candle", candle: candle(t0 + 1 * M, 101, 108, 100, 107, 20) }, now);
    const res = agg.ingest({ kind: "candle", candle: candle(t0 + 2 * M, 107, 109, 104, 108, 30) }, now);
    const target = res.candles.find((c) => c.timeframe === "3m");
    expect(target).toBeDefined();
    expect(target!.open).toBe(100);
    expect(target!.high).toBe(109);
    expect(target!.low).toBe(99);
    expect(target!.close).toBe(108);
    expect(target!.volume).toBe(10 + 20 + 30);
    expect(target!.timestamp).toBe(t0);
  });

  it("bucketStart alinha em UTC (início do bucket)", () => {
    expect(bucketStart(Date.parse("2023-01-01T00:04:30Z"), "3m")).toBe(Date.parse("2023-01-01T00:03:00Z"));
    expect(bucketStart(Date.parse("2023-01-01T00:05:00Z"), "3m")).toBe(Date.parse("2023-01-01T00:03:00Z"));
  });

  it("agrega a partir de ticks dentro do bucket", () => {
    const agg = new CandleAggregator({ target: "1m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const now = t0 + 30_000; // dentro do bucket 1m
    const tick = (t: number, p: number, q: number): MarketTick => ({
      provider: "binance", symbol: "BTCUSDT", price: p, quantity: q,
      timestamp: t, receivedAt: t + 1, source: "ws:trade", quality: "high",
    });
    agg.ingest({ kind: "tick", tick: tick(t0, 100, 1) }, now);
    const res = agg.ingest({ kind: "tick", tick: tick(t0 + 10_000, 105, 2) }, now);
    const c = res.candles[0]!;
    expect(c.open).toBe(100);
    expect(c.close).toBe(105);
    expect(c.high).toBe(105);
    expect(c.low).toBe(100);
    expect(c.volume).toBe(3);
  });

  it("deduplica pela sequência (mesmo provider+symbol+sequence)", () => {
    const agg = new CandleAggregator({ target: "1m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const now = t0 + 30_000;
    agg.ingest({ kind: "candle", candle: candle(t0, 100, 105, 99, 104, 10, false, 42) }, now);
    const res = agg.ingest({ kind: "candle", candle: candle(t0, 200, 205, 199, 204, 40, false, 42) }, now);
    const c = res.candles.find((x) => x.timestamp === t0)!;
    expect(c.open).toBe(100); // primeiro permanece (dedup por seq)
  });

  it("marca candles como fechados quando o tempo passou do fim do bucket", () => {
    const agg = new CandleAggregator({ target: "1m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    agg.ingest({ kind: "candle", candle: candle(t0, 100, 105, 99, 104, 10) }, t0 + 30_000);
    const res = agg.ingest({ kind: "candle", candle: candle(t0 + 1 * M, 104, 110, 102, 108, 12) }, t0 + 2 * M + 5_000);
    const first = res.candles.find((c) => c.timestamp === t0)!;
    expect(first.isClosed).toBe(true);
    const second = res.candles.find((c) => c.timestamp === t0 + M)!;
    expect(second!.isClosed).toBe(true);
  });

  it("não altera um candle já fechado com dados tardios (integridade do passado)", () => {
    const agg = new CandleAggregator({ target: "1m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    agg.ingest({ kind: "candle", candle: candle(t0, 100, 105, 99, 104, 10) }, t0 + 1 * M + 5_000);
    // agora o bucket t0 está fechado. Um tick tardio para t0 não pode mudar nada.
    const res = agg.ingest({ kind: "tick", tick: { provider: "binance", symbol: "BTCUSDT", price: 999, quantity: 999, timestamp: t0 + 30_000, receivedAt: t0 + 2 * M, source: "ws:trade", quality: "high" } }, t0 + 2 * M);
    const c = res.candles.find((x) => x.timestamp === t0)!;
    expect(c.close).toBe(104); // não virou 999
    expect(c.high).toBe(105);
  });

  it("ordena cronologicamente mesmo com entradas fora de ordem", () => {
    const agg = new CandleAggregator({ target: "1m", provider: "binance", symbol: "BTCUSDT", source: "test", quality: "high" });
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const now = t0 + 3 * M - 1;
    agg.ingest({ kind: "candle", candle: candle(t0 + 2 * M, 108, 109, 104, 108, 30) }, now);
    agg.ingest({ kind: "candle", candle: candle(t0 + 0 * M, 100, 105, 99, 101, 10) }, now);
    const res = agg.ingest({ kind: "candle", candle: candle(t0 + 1 * M, 101, 108, 100, 107, 20) }, now);
    const ts = res.candles.map((c) => c.timestamp);
    expect(ts).toEqual([t0, t0 + M, t0 + 2 * M]);
  });
});
