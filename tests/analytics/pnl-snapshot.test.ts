/**
 * Testes — pnl-snapshot.ts (CAMADA 5 — Validação).
 *
 * Verifica que getPerfSnapshot:
 *   1. Soma PnL corretamente em sequências de wins.
 *   2. Captura max drawdown em sequências mistas (wins + losses).
 *   3. Filtra por lookbackDays corretamente.
 *   4. Filtra por signalFilter (BUY/SELL) corretamente.
 *   5. Retorna zeros e períodos null em store vazio.
 *
 * Usa Datastore in-memory para integrar com o schema SQLite real.
 */
import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import {
  buildPerfSnapshotFromRecords,
  getPerfSnapshot,
} from "../../src/analytics/pnl-snapshot";
import type { DecisionRecord } from "../../src/analytics/types";
import type { MarketCandle } from "../../src/market/model";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkCandle(ts: number, close: number): MarketCandle {
  return {
    provider: "test",
    symbol: "BTCUSDT",
    timeframe: "1h",
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    timestamp: ts,
    receivedAt: ts + 1,
    isClosed: true,
    source: "test",
    quality: "high",
  };
}

const M = 3_600_000;

function freshStore() {
  const store = new Datastore({ path: ":memory:" });
  return store;
}

function freshRepo(store: Datastore) {
  return new DecisionRepository(store);
}

/** Cria candles com saída exata após `horizon` candles (causal). */
function buildCandles(entryTime: number, entryClose: number, exitClose: number, horizon: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i <= horizon; i++) {
    const ts = entryTime + i * M;
    const close = i === 0 ? entryClose : i === horizon ? exitClose : entryClose + (exitClose - entryClose) * (i / horizon);
    out.push(mkCandle(ts, close));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("getPerfSnapshot — store vazio", () => {
  it("retorna zeros e periodStart/periodEnd null", () => {
    const store = freshStore();
    const snap = getPerfSnapshot(store);
    expect(snap.pnlTotal).toBe(0);
    expect(snap.pnlPct).toBe(0);
    expect(snap.sharpe).toBe(0);
    expect(snap.maxDrawdown).toBe(0);
    expect(snap.nTrades).toBe(0);
    expect(snap.winRate).toBe(0);
    expect(snap.periodStart).toBeNull();
    expect(snap.periodEnd).toBeNull();
    store.close();
  });
});

describe("getPerfSnapshot — sequências de wins", () => {
  it("10 wins seguidos: pnlTotal > 0, maxDrawdown = 0", async () => {
    const store = freshStore();
    const repo = freshRepo(store);
    const t0 = Date.parse("2024-01-01T00:00:00Z");

    // 10 decisões BUY, cada uma ganha +1%
    for (let i = 0; i < 10; i++) {
      const candles = buildCandles(t0 + i * 100 * M, 100, 101, 5);
      const svc = new AnalyticsService(repo, () => candles, { minMovePct: 0.5, lookback: 100 });
      await svc.recordDecision({
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction: "up",
        decision: "BUY",
        horizon: 5,
        entryTime: t0 + i * 100 * M,
        entryPrice: 100,
        score: 0.5,
        confidence: 0.7,
        probability: 0.6,
        sampleSize: 50,
        regime: "uptrend",
        rationale: "test",
      });
      await svc.evaluatePending();
    }

    const snap = getPerfSnapshot(store);
    expect(snap.nTrades).toBe(10);
    expect(snap.pnlTotal).toBeGreaterThan(0);
    expect(snap.pnlTotal).toBeCloseTo(10 * 1, 0); // ~10%
    expect(snap.maxDrawdown).toBe(0); // sem losses, nunca cai
    expect(snap.winRate).toBe(1);
    expect(snap.periodStart).not.toBeNull();
    expect(snap.periodEnd).not.toBeNull();
    store.close();
  });
});

describe("getPerfSnapshot — sequência mista (wins + losses)", () => {
  it("5 wins + 3 losses: maxDrawdown registrado como % do loss", async () => {
    const store = freshStore();
    const repo = freshRepo(store);
    const t0 = Date.parse("2024-02-01T00:00:00Z");

    // 5 wins (BUY com alta +2%) seguidos de 3 losses (BUY com queda -2%)
    // BUY com pct>0 → hit; BUY com pct<0 → miss
    const sequence: Array<{ ret: number; decision: "BUY" | "SELL" }> = [
      { ret: 2, decision: "BUY" },
      { ret: 2, decision: "BUY" },
      { ret: 2, decision: "BUY" },
      { ret: 2, decision: "BUY" },
      { ret: 2, decision: "BUY" },
      { ret: -2, decision: "BUY" }, // loss
      { ret: -2, decision: "BUY" }, // loss
      { ret: -2, decision: "BUY" }, // loss
    ];
    for (let i = 0; i < sequence.length; i++) {
      const { ret, decision } = sequence[i]!;
      const candles = buildCandles(t0 + i * 100 * M, 100, 100 * (1 + ret / 100), 5);
      const svc = new AnalyticsService(repo, () => candles, { minMovePct: 0.5, lookback: 100 });
      await svc.recordDecision({
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction: "up",
        decision,
        horizon: 5,
        entryTime: t0 + i * 100 * M,
        entryPrice: 100,
        score: 0.5,
        confidence: 0.7,
        probability: 0.6,
        sampleSize: 50,
        regime: "uptrend",
        rationale: "test",
      });
      await svc.evaluatePending();
    }

    const snap = getPerfSnapshot(store);
    expect(snap.nTrades).toBe(8);
    expect(snap.winRate).toBe(5 / 8);
    // PnL: 5*(+2) + 3*(-2) = +4
    expect(snap.pnlTotal).toBeCloseTo(4, 1);
    // Cura: 2,4,6,8,10,8,6,4 → pico=10 → drawdown = 4-10 = -6
    expect(snap.maxDrawdown).toBeCloseTo(-6, 1);
    store.close();
  });
});

describe("getPerfSnapshot — filtros", () => {
  it("lookbackDays filtra decisões antigas", async () => {
    const store = freshStore();
    const repo = freshRepo(store);
    const now = Date.now();
    const day = 86_400_000;
    const oldCreatedAt = now - 30 * day;
    const newCreatedAt = now - 1 * day;

    // Decisão antiga (30d atrás) — inserida direto com created_at controlado
    await repo.save({
      id: "old-1",
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: oldCreatedAt,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.6,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "antiga",
      outcome: "hit",
      exitTime: oldCreatedAt + 5 * M,
      exitPrice: 101,
      returnPct: 1,
      evaluatedAt: oldCreatedAt + 5 * M,
      createdAt: oldCreatedAt,
    });

    // Decisão recente (1d atrás) — inserida direto com created_at controlado
    await repo.save({
      id: "new-1",
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: newCreatedAt,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.6,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "recente",
      outcome: "hit",
      exitTime: newCreatedAt + 5 * M,
      exitPrice: 102,
      returnPct: 2,
      evaluatedAt: newCreatedAt + 5 * M,
      createdAt: newCreatedAt,
    });

    // Sem filtro → ambas (2)
    const all = getPerfSnapshot(store);
    expect(all.nTrades).toBe(2);
    expect(all.pnlTotal).toBeCloseTo(3, 1);

    // lookback 7 dias → só a recente (1)
    const recent = getPerfSnapshot(store, { lookbackDays: 7 });
    expect(recent.nTrades).toBe(1);
    expect(recent.pnlTotal).toBeCloseTo(2, 1);
    store.close();
  });

  it("signalFilter='BUY' só conta decisões BUY", async () => {
    const store = freshStore();
    const repo = freshRepo(store);
    const t0 = Date.parse("2024-03-01T00:00:00Z");

    // 3 BUY + 2 SELL
    for (let i = 0; i < 3; i++) {
      const candles = buildCandles(t0 + i * 100 * M, 100, 101, 5);
      const svc = new AnalyticsService(repo, () => candles, { minMovePct: 0.5, lookback: 100 });
      await svc.recordDecision({
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction: "up",
        decision: "BUY",
        horizon: 5,
        entryTime: t0 + i * 100 * M,
        entryPrice: 100,
        score: 0.5,
        confidence: 0.7,
        probability: 0.6,
        sampleSize: 50,
        regime: "uptrend",
        rationale: "buy",
      });
      await svc.evaluatePending();
    }
    for (let i = 0; i < 2; i++) {
      const candles = buildCandles(t0 + (i + 3) * 100 * M, 100, 99, 5);
      const svc = new AnalyticsService(repo, () => candles, { minMovePct: 0.5, lookback: 100 });
      await svc.recordDecision({
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction: "down",
        decision: "SELL",
        horizon: 5,
        entryTime: t0 + (i + 3) * 100 * M,
        entryPrice: 100,
        score: 0.5,
        confidence: 0.7,
        probability: 0.6,
        sampleSize: 50,
        regime: "downtrend",
        rationale: "sell",
      });
      await svc.evaluatePending();
    }

    // Sem filtro → 5 trades
    const all = getPerfSnapshot(store);
    expect(all.nTrades).toBe(5);

    // signalFilter='BUY' → 3 trades (só BUY)
    const onlyBuy = getPerfSnapshot(store, { signalFilter: "BUY" });
    expect(onlyBuy.nTrades).toBe(3);
    expect(onlyBuy.pnlTotal).toBeCloseTo(3, 1); // 3 wins de +1%

    // signalFilter='SELL' → 2 trades (só SELL)
    const onlySell = getPerfSnapshot(store, { signalFilter: "SELL" });
    expect(onlySell.nTrades).toBe(2);
    expect(onlySell.pnlTotal).toBeCloseTo(-2, 1); // 2 wins de -1%
    store.close();
  });
});

describe("buildPerfSnapshotFromRecords — helper puro", () => {
  it("records sintéticos: monta snapshot corretamente", () => {
    const t0 = Date.parse("2024-01-01T00:00:00Z");
    const records: DecisionRecord[] = [
      mkRecord(t0, "BUY", "hit", 1),
      mkRecord(t0 + 1000, "BUY", "hit", 1),
      mkRecord(t0 + 2000, "BUY", "miss", -2),
    ];
    const snap = buildPerfSnapshotFromRecords(records);
    expect(snap.nTrades).toBe(3);
    expect(snap.pnlTotal).toBe(0);
    // Cura: 1, 2, 0 → pico=2 → DD = 0-2 = -2
    expect(snap.maxDrawdown).toBeCloseTo(-2, 5);
    // 2 hit + 1 miss → winRate = 2/3
    expect(snap.winRate).toBeCloseTo(2 / 3, 5);
    expect(snap.periodStart).toBe(new Date(t0).toISOString());
    expect(snap.periodEnd).toBe(new Date(t0 + 2000).toISOString());
  });

  it("records vazios: zeros e nulls", () => {
    const snap = buildPerfSnapshotFromRecords([]);
    expect(snap.nTrades).toBe(0);
    expect(snap.pnlTotal).toBe(0);
    expect(snap.maxDrawdown).toBe(0);
    expect(snap.periodStart).toBeNull();
    expect(snap.periodEnd).toBeNull();
  });
});

function mkRecord(
  createdAt: number,
  decision: "BUY" | "SELL" | "WAIT",
  outcome: "hit" | "miss" | "flat" | "pending",
  returnPct: number | null,
): DecisionRecord {
  return {
    id: `id-${createdAt}`,
    symbol: "BTCUSDT",
    timeframe: "1h",
    direction: decision === "SELL" ? "down" : "up",
    decision,
    horizon: 5,
    entryTime: createdAt,
    entryPrice: 100,
    score: 0.5,
    confidence: 0.7,
    probability: 0.6,
    sampleSize: 50,
    regime: "uptrend",
    rationale: "x",
    outcome,
    exitTime: createdAt + 5 * M,
    exitPrice: 100 * (1 + (returnPct ?? 0) / 100),
    returnPct,
    evaluatedAt: createdAt + 5 * M,
    createdAt,
  };
}
