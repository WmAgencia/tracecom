import { describe, expect, it } from "vitest";
import { MarketPipeline } from "../../src/market/pipeline";
import type { MarketDataProvider, ProviderEvent } from "../../src/market/providerV2";
import type { MarketCandle, MarketTick } from "../../src/market/model";

function mkCandle(ts: number, isClosed = true): MarketCandle {
  return {
    provider: "fake", symbol: "BTCUSDT", timeframe: "1m",
    open: 100, high: 105, low: 99, close: 104, volume: 10,
    timestamp: ts, receivedAt: ts + 1_000, isClosed, source: "ws", quality: "high",
  };
}

/** Provider sintético para testes de pipeline (não inventa; emite eventos). */
class FakeProvider implements MarketDataProvider {
  id = "fake";
  state: "disconnected" | "connecting" | "connected" | "reconnecting" | "error" = "disconnected";
  connectedAt: number | null = null;
  private listeners: Array<(ev: ProviderEvent) => void> = [];
  emit(ev: ProviderEvent): void {
    for (const l of this.listeners) l(ev);
  }
  async connect(): Promise<void> {
    this.state = "connected";
    this.connectedAt = Date.now();
  }
  disconnect(): void {
    this.state = "disconnected";
  }
  getStatus() {
    return this.state;
  }
  async subscribe(_opts: { symbol: string }, listener: (ev: ProviderEvent) => void): Promise<() => void> {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  async getTicker() {
    return { price: 100, quality: "high" as const, receivedAt: Date.now(), source: "fake" };
  }
  async getCandles() {
    return { candles: [] as MarketCandle[], source: "fake", quality: "high" as const };
  }
  async getTrades() {
    return { trades: [] as MarketTick[], source: "fake" };
  }
  async getOrderBook() {
    return null as never;
  }
  async getMarketMetadata() {
    return null;
  }
  historical = { provider: "fake", fetchPage: async () => ({ candles: [], nextStartTime: null }) };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("MarketPipeline: integridade temporal e múltiplos consumidores", () => {
  it("não deixa informação futura alterar candle passado (sem look-ahead)", async () => {
    const provider = new FakeProvider();
    const pipeline = new MarketPipeline({ provider, logger: silentLog, staleAfterMs: 60_000 });
    const t0 = Date.parse("2023-01-01T00:00:00Z");

    await pipeline.start([{ symbol: "BTCUSDT", timeframe: "1m", native: true }]);
    provider.emit({ type: "candle", candle: mkCandle(t0) });

    const before = pipeline.state.getCandles("BTCUSDT", "1m").find((x) => x.timestamp === t0)!;
    expect(before.close).toBe(104);

    // Informação futura (timestamp posterior) não pode mutar o bucket t0.
    provider.emit({ type: "candle", candle: mkCandle(t0 + 60_000) });
    const after = pipeline.state.getCandles("BTCUSDT", "1m").find((x) => x.timestamp === t0)!;
    expect(after.close).toBe(104);
    expect(after.high).toBe(105);
  });

  it("alimenta múltiplos consumidores a partir de UMA conexão", async () => {
    const provider = new FakeProvider();
    const pipeline = new MarketPipeline({ provider, logger: silentLog });
    await pipeline.start([{ symbol: "ETHUSDT", timeframe: "1m", native: true }]);
    let quant = 0;
    let ui = 0;
    pipeline.subscribe(() => quant++);
    pipeline.subscribe(() => ui++);
    const t = Date.parse("2023-01-01T00:00:00Z");
    provider.emit({
      type: "tick",
      tick: { provider: "fake", symbol: "ETHUSDT", price: 2000, quantity: 1, timestamp: t, receivedAt: t + 1, source: "fake", quality: "high" },
    });
    expect(quant).toBe(1);
    expect(ui).toBe(1);
  });

  it("rejeita tick com preço inválido (não chega ao estado)", async () => {
    const provider = new FakeProvider();
    const pipeline = new MarketPipeline({ provider, logger: silentLog });
    await pipeline.start([{ symbol: "ETHUSDT", timeframe: "1m", native: true }]);
    let got = 0;
    pipeline.subscribe(() => got++);
    const t = Date.parse("2023-01-01T00:00:00Z");
    provider.emit({
      type: "tick",
      tick: { provider: "fake", symbol: "ETHUSDT", price: Number.NaN, quantity: 1, timestamp: t, receivedAt: t + 1, source: "fake", quality: "high" },
    });
    expect(got).toBe(0);
  });
});
