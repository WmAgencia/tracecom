import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { CandleRepository } from "../../src/store/repositories/candleRepository";
import type { MarketCandle } from "../../src/market/model";

function mk(ts: number, close: number, isClosed = true): MarketCandle {
  return {
    provider: "binance", symbol: "BTCUSDT", timeframe: "1h", open: close, high: close + 1, low: close - 1, close,
    volume: 5, timestamp: ts, receivedAt: ts + 1, isClosed, source: "rest", quality: "high",
  };
}

const T0 = Date.parse("2023-01-01T00:00:00Z");

describe("CandleRepository (cold store)", () => {
  it("persiste apenas candles fechados (ignora abertos)", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new CandleRepository(store, "binance");
    const n = repo.upsert([mk(T0, 100, true), mk(T0 + 3_600_000, 101, false)]);
    expect(n).toBe(1);
    expect(repo.count("BTCUSDT", "1h")).toBe(1);
    store.close();
  });

  it("upsert idempotente (PK) — não duplica", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new CandleRepository(store, "binance");
    repo.upsert([mk(T0, 100)]);
    repo.upsert([mk(T0, 100)]);
    expect(repo.count("BTCUSDT", "1h")).toBe(1);
    store.close();
  });

  it("rejeita valores inválidos (nunca persiste NaN/preço<=0)", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new CandleRepository(store, "binance");
    const n = repo.upsert([mk(T0, Number.NaN), mk(T0 + 3_600_000, 0), mk(T0 + 7_200_000, 50)]);
    expect(n).toBe(1);
    expect(repo.count("BTCUSDT", "1h")).toBe(1);
    store.close();
  });

  it("get retorna em ordem cronológica e com filtros start/end", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new CandleRepository(store, "binance");
    repo.upsert([mk(T0, 100), mk(T0 + 3_600_000, 101), mk(T0 + 7_200_000, 102)]);
    const two = repo.get({ symbol: "BTCUSDT", timeframe: "1h", start: T0 + 3_600_000 });
    expect(two.length).toBe(2);
    expect(two[0]!.timestamp).toBe(T0 + 3_600_000);
    store.close();
  });

  it("detecta gaps no cold store (informação futura não preenche)", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new CandleRepository(store, "binance");
    // pula o candle de 1h em T0+3.6M
    repo.upsert([mk(T0, 100), mk(T0 + 7_200_000, 102)]);
    const gaps = repo.gaps("BTCUSDT", "1h");
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.from).toBe(T0 + 3_600_000);
    expect(gaps[0]!.to).toBe(T0 + 7_200_000);
    store.close();
  });
});
