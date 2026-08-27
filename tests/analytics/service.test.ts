import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import type { MarketCandle, Timeframe } from "../../src/market/model";

function mk(ts: number, close: number): MarketCandle {
  return { provider: "binance", symbol: "BTCUSDT", timeframe: "1h", open: close, high: close + 1, low: close - 1, close, volume: 10, timestamp: ts, receivedAt: ts + 1, isClosed: true, source: "test", quality: "high" };
}

const T0 = Date.parse("2023-01-01T00:00:00Z");
const M = 3_600_000;

function repoOf() {
  const store = new Datastore({ path: ":memory:" });
  return { store, repo: new DecisionRepository(store) };
}

function candleSource(candles: MarketCandle[]) {
  return (_s: string, _tf: Timeframe) => candles;
}

describe("AnalyticsService + DecisionRepository", () => {
  it("registra uma decisão pendente", async () => {
    const { store, repo } = repoOf();
    const svc = new AnalyticsService(repo, () => []);
    const rec = await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", horizon: 5,
      entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7, probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "teste",
    });
    expect(rec.outcome).toBe("pending");
    expect(rec.sampleSize).toBe(50);
    store.close();
  });

  it("valida apenas decisões cujo horizonte já decorreu (dados reais, sem inventar)", async () => {
    const { store, repo } = repoOf();
    const now = Date.now();
    // decisão antiga (horizonte decorrido): entrada T0, saída T0+5h
    const candles = [
      mk(T0, 100), mk(T0 + M, 101), mk(T0 + 2 * M, 102), mk(T0 + 3 * M, 105),
      mk(T0 + 4 * M, 106), mk(T0 + 5 * M, 108), // exit
    ];
    const svc = new AnalyticsService(repo, candleSource(candles), { minMovePct: 0.5, lookback: 100 });
    await svc.recordDecision({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7, probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "teste" });
    void now;
    const res = await svc.evaluatePending();
    expect(res.evaluated).toBe(1);
    expect(res.outcomes.hit).toBe(1);
    const stats = await svc.stats();
    expect(stats.wins).toBe(1);
    expect(stats.total).toBe(1);
    store.close();
  });

  it("BUY com queda → miss", async () => {
    const { store, repo } = repoOf();
    const candles = [mk(T0, 100), mk(T0 + M, 95), mk(T0 + 2 * M, 90), mk(T0 + 3 * M, 92), mk(T0 + 4 * M, 91), mk(T0 + 5 * M, 89)];
    const svc = new AnalyticsService(repo, candleSource(candles), { minMovePct: 0.5, lookback: 100 });
    await svc.recordDecision({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7, probability: null, sampleSize: 50, regime: "downtrend", rationale: "x" });
    const res = await svc.evaluatePending();
    expect(res.outcomes.miss).toBe(1);
    store.close();
  });

  it("decisão recente (horizonte não decorrido) fica pendente", async () => {
    const { store, repo } = repoOf();
    const future = Date.now() - 1_000; // muito recente
    const svc = new AnalyticsService(repo, candleSource([mk(future, 100)]), { minMovePct: 0.5, lookback: 100 });
    await svc.recordDecision({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", horizon: 5, entryTime: future, entryPrice: 100, score: 0.5, confidence: 0.7, probability: null, sampleSize: 50, regime: "uptrend", rationale: "x" });
    const res = await svc.evaluatePending();
    expect(res.evaluated).toBe(0);
    const stats = await svc.stats();
    expect(stats.pending).toBe(1);
    store.close();
  });

  it("WAIT não gera outcome direcional (flat)", async () => {
    const { store, repo } = repoOf();
    const candles = [mk(T0, 100), mk(T0 + M, 100.1), mk(T0 + 2 * M, 100.2), mk(T0 + 3 * M, 100.3), mk(T0 + 4 * M, 100.4), mk(T0 + 5 * M, 100.5)];
    const svc = new AnalyticsService(repo, candleSource(candles), { minMovePct: 0.5, lookback: 100 });
    await svc.recordDecision({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "WAIT", horizon: 5, entryTime: T0, entryPrice: 100, score: 0.1, confidence: 0.5, probability: null, sampleSize: 10, regime: "range", rationale: "x" });
    const res = await svc.evaluatePending();
    expect(res.outcomes.flat).toBe(1);
    const stats = await svc.stats();
    expect(stats.winRate).toBeNull(); // zero direcionais
    store.close();
  });
});
