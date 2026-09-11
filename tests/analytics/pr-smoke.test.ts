/**
 * Smoke real do scheduler P-R.
 * Roda `evaluatePending` + OutcomeScheduler.start/stop em Datastore real :memory:
 * com 1 decisão registrada, valida idempotência e persistência.
 */
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import { createOutcomeScheduler } from "../../src/analytics/scheduler";
import type { MarketCandle, Timeframe } from "../../src/market/model";

describe("P-R smoke real", () => {
  it("scheduler.start/runOnce/stop funciona end-to-end em SQLite real", async () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new DecisionRepository(store);
    const T0 = Date.parse("2023-01-01T00:00:00Z");
    const M = 3_600_000;
    const candles: MarketCandle[] = [
      { ts: T0, c: 100 }, { ts: T0 + 5 * M, c: 110 },
    ].map(({ ts, c }) => ({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1h" as const,
      open: c, high: c + 1, low: c - 1, close: c, volume: 10,
      timestamp: ts, receivedAt: ts + 1, isClosed: true, source: "smoke", quality: "high" as const,
    }));
    const svc = new AnalyticsService({
      persist: repo,
      candles: (_s: string, _tf: Timeframe) => candles,
      cfg: { minMovePct: 0.5, lookback: 100 },
    });
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "smoke",
    });
    const scheduler = createOutcomeScheduler(svc, { intervalMs: 60_000, providerId: "binance" });
    expect(scheduler.running).toBe(false);
    scheduler.start();
    expect(scheduler.running).toBe(true);
    scheduler.start(); // idempotente
    expect(scheduler.running).toBe(true);
    // Não espera tick agendado — usa runOnce para resultado determinístico.
    const r = await scheduler.runOnce();
    expect(r.evaluated).toBe(1);
    expect(r.outcomes.hit).toBe(1);
    // Snapshot do DB.
    const all = await repo.listAll();
    expect(all[0]?.outcome).toBe("hit");
    expect(all[0]?.exitPrice).toBe(110);
    expect(all[0]?.providerId).toBeNull(); // snapshots só vão pra DB se passados no recordDecision
    expect(all[0]?.evaluationAttempts).toBe(1);
    await scheduler.stop();
    expect(scheduler.running).toBe(false);
    store.close();
  });
});
