/**
 * Testes de shadow trading (paper trading).
 *
 * Cobre: openShadowTrade, evaluateShadowTrade, ShadowRepository (CRUD + stats)
 * e a integração AnalyticsService.evaluatePendingShadows com filtragem por
 * horizonte.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { ShadowRepository } from "../../src/store/repositories/shadowRepository";
import { AnalyticsService } from "../../src/analytics/service";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { openShadowTrade, evaluateShadowTrade } from "../../src/analytics/shadow";
import type { MarketCandle, Timeframe } from "../../src/market/model";

const T0 = Date.parse("2023-01-01T00:00:00Z");
const M = 3_600_000; // 1h em ms

function mkCandle(ts: number, close: number, tf: Timeframe = "1h"): MarketCandle {
  return {
    provider: "binance",
    symbol: "BTCUSDT",
    timeframe: tf,
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

function candleSource(candles: MarketCandle[]) {
  return (_s: string, _tf: Timeframe) => candles;
}

describe("openShadowTrade", () => {
  it("gera id, seta exit null e outcome pending, com timestamps corretos", () => {
    const t = openShadowTrade({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      entryTime: T0,
      entryPrice: 100,
      confidence: 0.7,
      probability: 0.6,
    });
    expect(t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(t.symbol).toBe("BTCUSDT");
    expect(t.timeframe).toBe("1h");
    expect(t.direction).toBe("up");
    expect(t.decision).toBe("BUY");
    expect(t.entryTime).toBe(T0);
    expect(t.entryPrice).toBe(100);
    expect(t.exitTime).toBeNull();
    expect(t.exitPrice).toBeNull();
    expect(t.outcome).toBe("pending");
    expect(t.returnPct).toBeNull();
    expect(t.confidence).toBe(0.7);
    expect(t.probability).toBe(0.6);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.evaluatedAt).toBeNull();
  });

  it("aceita SELL e WAIT sem lançar", () => {
    const sell = openShadowTrade({
      symbol: "ETHUSDT",
      timeframe: "15m",
      direction: "down",
      decision: "SELL",
      entryTime: T0,
      entryPrice: 50,
    });
    expect(sell.decision).toBe("SELL");
    expect(sell.confidence).toBeNull();
    expect(sell.probability).toBeNull();

    const wait = openShadowTrade({
      symbol: "ETHUSDT",
      timeframe: "15m",
      direction: "up",
      decision: "WAIT",
      entryTime: T0,
      entryPrice: 50,
    });
    expect(wait.decision).toBe("WAIT");
  });
});

describe("evaluateShadowTrade", () => {
  function tradeAt(entryPrice: number, decision: "BUY" | "SELL" | "WAIT"): ReturnType<typeof openShadowTrade> {
    return openShadowTrade({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision,
      entryTime: T0,
      entryPrice,
    });
  }

  function candleSeries(prices: number[]): { timestamp: number; close: number }[] {
    return prices.map((p, i) => ({ timestamp: T0 + i * M, close: p }));
  }

  it("BUY com candles futuros subindo → outcome='hit', returnPct líquido (gross - 0.3 PP)", () => {
    const trade = tradeAt(100, "BUY");
    const candles = candleSeries([100, 101, 102, 103, 104, 110]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("hit");
    expect(result.exitTime).toBe(T0 + 5 * M);
    expect(result.exitPrice).toBe(110);
    // returnPct agora é LÍQUIDO (gross 10 PP - 0.3 PP custo = 9.7 PP).
    expect(result.returnPct).toBeGreaterThan(0);
    expect(result.returnPct).toBeCloseTo(9.7, 5);
    // grossReturnPct guarda o bruto para audit.
    expect(result.grossReturnPct).toBeCloseTo(10, 5);
    expect(result.evaluatedAt).not.toBeNull();
  });

  it("BUY com candles futuros caindo → outcome='miss' (sem stop, retorno líquido)", () => {
    // stopLossPct=1 (100%) desabilita o stop-loss; assim a queda maior só no
    // candle de saída não dispara stopped.
    const trade = openShadowTrade({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      entryTime: T0, entryPrice: 100, stopLossPct: 1,
    });
    const candles = candleSeries([100, 99.5, 99, 98.5, 98, 95]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("miss");
    expect(result.returnPct).toBeLessThan(0);
    expect(result.returnPct).toBeCloseTo(-5.3, 5);
    expect(result.grossReturnPct).toBeCloseTo(-5, 5);
  });

  it("SELL com candles futuros caindo → outcome='hit'", () => {
    // stopLossPct=1 (100%) desabilita o stop-loss.
    const trade = openShadowTrade({
      symbol: "BTCUSDT", timeframe: "1h", direction: "down", decision: "SELL",
      entryTime: T0, entryPrice: 100, stopLossPct: 1,
    });
    const candles = candleSeries([100, 99.5, 99, 98.5, 98, 95]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("hit");
    expect(result.returnPct).toBeLessThan(0); // líquido: preço caiu
    // Para SELL, gross=-5, líquido=-5.3.
    expect(result.returnPct).toBeCloseTo(-5.3, 5);
    expect(result.grossReturnPct).toBeCloseTo(-5, 5);
  });

  it("SELL com candles futuros subindo → outcome='miss' (sem stop, líquido)", () => {
    // stopLossPct=1 (100%) desabilita o stop-loss.
    const trade = openShadowTrade({
      symbol: "BTCUSDT", timeframe: "1h", direction: "down", decision: "SELL",
      entryTime: T0, entryPrice: 100, stopLossPct: 1,
    });
    const candles = candleSeries([100, 100.5, 101, 101.5, 102, 105]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("miss");
    expect(result.returnPct).toBeGreaterThan(0);
    expect(result.returnPct).toBeCloseTo(4.7, 5);
    expect(result.grossReturnPct).toBeCloseTo(5, 5);
  });

  it("WAIT → outcome='flat' mesmo com movimento direcional", () => {
    const trade = tradeAt(100, "WAIT");
    const candles = candleSeries([100, 101, 102, 103, 104, 110]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("flat");
    expect(result.returnPct).toBeCloseTo(9.7, 5);
    expect(result.grossReturnPct).toBeCloseTo(10, 5);
    expect(result.exitPrice).toBe(110);
  });

  it("candle de exit não existe → outcome='insufficient', exit null", () => {
    const trade = tradeAt(100, "BUY");
    const candles = candleSeries([100, 101, 102, 103]); // só 4 candles; exit seria no 5
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("insufficient");
    expect(result.exitTime).toBeNull();
    expect(result.exitPrice).toBeNull();
    expect(result.returnPct).toBeNull();
  });

  it("|pct| < minMovePct → outcome='flat'", () => {
    const trade = tradeAt(100, "BUY");
    const candles = candleSeries([100, 100.1, 100.2, 100.15, 100.18, 100.2]); // ~0.2% < 0.5%
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("flat");
    expect(result.returnPct).not.toBeNull();
    expect(Math.abs(result.returnPct!)).toBeLessThan(0.5);
  });

  it("é idempotente — trade já avaliado retorna como está", () => {
    const trade = tradeAt(100, "BUY");
    const candles = candleSeries([100, 101, 102, 103, 104, 110]);
    const first = evaluateShadowTrade(trade, candles, 5, 0.5);
    const second = evaluateShadowTrade(first, candles, 5, 0.5);
    expect(second).toEqual(first);
  });

  // ===== Stop-loss por candle =====

  it("BUY com candles caindo > 1.5% no meio da janela → outcome='stopped' e stopLossTriggeredAt setado", () => {
    const trade = tradeAt(100, "BUY");
    // entry 100, candle 2 (T0+2h) cai para 98 → -2% > 1.5% → stop
    const candles = candleSeries([100, 99, 98, 99, 102, 105]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("stopped");
    expect(result.stopLossTriggeredAt).toBe(T0 + 2 * M);
    expect(result.exitTime).toBe(T0 + 2 * M);
    expect(result.exitPrice).toBe(98);
    // returnPct é líquido após custos (~-2% - 0.3 PP ≈ -2.3)
    expect(result.returnPct).toBeCloseTo(-2.3, 1);
    expect(result.grossReturnPct).toBeCloseTo(-2, 5);
    expect(result.evaluatedAt).not.toBeNull();
  });

  it("SELL com candles subindo > 1.5% no meio da janela → outcome='stopped'", () => {
    const trade = tradeAt(100, "SELL");
    // entry 100, candle 3 (T0+3h) sobe para 102 → +2% > 1.5% → stop
    const candles = candleSeries([100, 100.5, 101, 102, 103, 104]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("stopped");
    expect(result.stopLossTriggeredAt).toBe(T0 + 3 * M);
    expect(result.exitPrice).toBe(102);
    expect(result.returnPct).toBeCloseTo(1.7, 1);
    expect(result.grossReturnPct).toBeCloseTo(2, 5);
  });

  it("BUY com candles caindo 0.5% (dentro do stop) → outcome normal hit/miss", () => {
    // Cai 0.5% no meio da janela (dentro do stop 1.5%), termina subindo → hit
    const trade = tradeAt(100, "BUY");
    const candles = candleSeries([100, 99.5, 99.7, 100.5, 101.5, 105]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("hit");
    expect(result.stopLossTriggeredAt).toBeNull();
    // gross 5%, líquido ≈ 4.7
    expect(result.returnPct).toBeCloseTo(4.7, 1);
    expect(result.grossReturnPct).toBeCloseTo(5, 5);
  });

  it("BUY sem stopLossPct usa default 1.5% — stop dispara a -2%", () => {
    const trade = tradeAt(100, "BUY"); // sem stopLossPct → default 0.015
    const candles = candleSeries([100, 99, 98, 99, 102, 105]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("stopped");
    expect(result.stopLossTriggeredAt).toBe(T0 + 2 * M);
  });

  it("SELL sem stopLossPct usa default 1.5% — stop dispara a +2%", () => {
    const trade = tradeAt(100, "SELL");
    const candles = candleSeries([100, 100.5, 101, 102, 103, 104]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("stopped");
    expect(result.stopLossTriggeredAt).toBe(T0 + 3 * M);
  });

  it("BUY com stopLossPct custom 5% — candle -4% NÃO dispara stop, candle -6% sim", () => {
    const trade = openShadowTrade({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      entryTime: T0, entryPrice: 100, stopLossPct: 0.05,
    });
    const candles = candleSeries([100, 99, 96, 94, 95, 105]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    // candle 1 (99, -1%) e 2 (96, -4%) dentro do stop 5%, candle 3 (94, -6%) dispara
    expect(result.outcome).toBe("stopped");
    expect(result.stopLossTriggeredAt).toBe(T0 + 3 * M);
    expect(result.exitPrice).toBe(94);
  });

  it("WAIT ignora stop-loss — outcome segue flat", () => {
    const trade = tradeAt(100, "WAIT");
    const candles = candleSeries([100, 90, 80, 95, 105, 110]);
    const result = evaluateShadowTrade(trade, candles, 5, 0.5);
    expect(result.outcome).toBe("flat");
    expect(result.stopLossTriggeredAt).toBeNull();
  });
});

describe("ShadowRepository (in-memory)", () => {
  let store: Datastore;
  let repo: ShadowRepository;

  beforeEach(() => {
    store = new Datastore({ path: ":memory:" });
    repo = new ShadowRepository(store);
  });

  afterEach(() => {
    store.close();
  });

  it("save + list faz roundtrip fiel", () => {
    const t = openShadowTrade({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      entryTime: T0,
      entryPrice: 100,
      confidence: 0.8,
      probability: 0.6,
    });
    repo.save(t);

    const all = repo.list();
    expect(all.length).toBe(1);
    expect(all[0]!.id).toBe(t.id);
    expect(all[0]!.symbol).toBe("BTCUSDT");
    expect(all[0]!.decision).toBe("BUY");
    expect(all[0]!.confidence).toBe(0.8);
    expect(all[0]!.outcome).toBe("pending");
  });

  it("update aplica campos parciais sem mexer nos demais", () => {
    const t = openShadowTrade({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      entryTime: T0,
      entryPrice: 100,
    });
    repo.save(t);
    repo.update(t.id, { outcome: "hit", exitTime: T0 + 5 * M, exitPrice: 110, returnPct: 10, evaluatedAt: T0 + 6 * M });

    const loaded = repo.list()[0]!;
    expect(loaded.outcome).toBe("hit");
    expect(loaded.exitTime).toBe(T0 + 5 * M);
    expect(loaded.exitPrice).toBe(110);
    expect(loaded.returnPct).toBe(10);
    expect(loaded.evaluatedAt).toBe(T0 + 6 * M);
    expect(loaded.entryPrice).toBe(100); // preservado
  });

  it("list filtra por symbol e signal", () => {
    const a = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    const b = openShadowTrade({ symbol: "ETHUSDT", timeframe: "1h", direction: "up", decision: "SELL", entryTime: T0, entryPrice: 50 });
    const c = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "SELL", entryTime: T0, entryPrice: 105 });
    repo.save(a); repo.save(b); repo.save(c);

    expect(repo.list({ symbol: "BTCUSDT" }).length).toBe(2);
    expect(repo.list({ signal: "SELL" }).length).toBe(2);
    expect(repo.list({ symbol: "BTCUSDT", signal: "BUY" }).length).toBe(1);
    expect(repo.list({ symbol: "BTCUSDT", signal: "BUY" })[0]!.id).toBe(a.id);
  });

  it("listPending retorna apenas outcome='pending'", () => {
    const pending = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    const evaluated = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    repo.save(pending);
    repo.save(evaluated);
    repo.update(evaluated.id, { outcome: "hit", exitTime: T0 + M, exitPrice: 110, returnPct: 10, evaluatedAt: T0 });

    const list = repo.listPending(Number.MAX_SAFE_INTEGER, M);
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(pending.id);
  });

  it("stats calcula total, wins, winRate, netReturn, avgReturn e perSignal", () => {
    // BUY: 2 hits, 1 miss → winRate BUY 2/3
    const b1 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    const b2 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    const b3 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", entryTime: T0, entryPrice: 100 });
    // SELL: 1 hit, 1 miss → winRate SELL 1/2
    const s1 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "down", decision: "SELL", entryTime: T0, entryPrice: 100 });
    const s2 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "down", decision: "SELL", entryTime: T0, entryPrice: 100 });
    // WAIT: 1 flat
    const w1 = openShadowTrade({ symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "WAIT", entryTime: T0, entryPrice: 100 });

    for (const t of [b1, b2, b3, s1, s2, w1]) repo.save(t);
    repo.update(b1.id, { outcome: "hit", exitTime: T0 + M, exitPrice: 110, returnPct: 10, evaluatedAt: T0 });
    repo.update(b2.id, { outcome: "hit", exitTime: T0 + M, exitPrice: 105, returnPct: 5, evaluatedAt: T0 });
    repo.update(b3.id, { outcome: "miss", exitTime: T0 + M, exitPrice: 90, returnPct: -10, evaluatedAt: T0 });
    repo.update(s1.id, { outcome: "hit", exitTime: T0 + M, exitPrice: 90, returnPct: -10, evaluatedAt: T0 });
    repo.update(s2.id, { outcome: "miss", exitTime: T0 + M, exitPrice: 110, returnPct: 10, evaluatedAt: T0 });
    repo.update(w1.id, { outcome: "flat", exitTime: T0 + M, exitPrice: 100, returnPct: 0, evaluatedAt: T0 });

    const stats = repo.stats();
    expect(stats.total).toBe(6);
    expect(stats.evaluated).toBe(6);
    expect(stats.wins).toBe(3);
    expect(stats.misses).toBe(2);
    // wins=3 (BUY2+SELL1), misses=2 (BUY1+SELL1) → winRate 3/5
    expect(stats.winRate).toBeCloseTo(3 / 5, 5);
    expect(stats.netReturn).toBeCloseTo(10 + 5 - 10 - 10 + 10 + 0, 5);
    expect(stats.perSignal.BUY.n).toBe(3);
    expect(stats.perSignal.BUY.wins).toBe(2);
    expect(stats.perSignal.BUY.winRate).toBeCloseTo(2 / 3, 5);
    expect(stats.perSignal.SELL.n).toBe(2);
    expect(stats.perSignal.SELL.wins).toBe(1);
    expect(stats.perSignal.SELL.winRate).toBeCloseTo(1 / 2, 5);
  });
});

describe("AnalyticsService.evaluatePendingShadows", () => {
  it("filtra por horizonte e avalia apenas trades com horizonte decorrido", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const shadowRepo = new ShadowRepository(store);
      const horizon = 5;

      // Trade 1: antigo, horizonte decorrido (entry T0, exit T0+5h no passado)
      const candlesOld = [
        mkCandle(T0, 100),
        mkCandle(T0 + M, 102),
        mkCandle(T0 + 2 * M, 104),
        mkCandle(T0 + 3 * M, 106),
        mkCandle(T0 + 4 * M, 108),
        mkCandle(T0 + 5 * M, 110),
      ];
      const svc = new AnalyticsService(decisionRepo, candleSource(candlesOld), { minMovePct: 0.5, lookback: 100 }, shadowRepo);

      await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: T0, entryPrice: 100, confidence: 0.7, probability: 0.6,
      });

      // Trade 2: recente, horizonte NÃO decorrido (entry agora, exit no futuro)
      await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: Date.now() - M, // 1h atrás; exit seria em 4h no futuro
        entryPrice: 100,
      });

      const result = await svc.evaluatePendingShadows(horizon);
      // Apenas o trade antigo deve ser avaliado
      expect(result).not.toBeNull();
      expect(result!.evaluated).toBe(1);
      expect(result!.outcomes.hit).toBe(1);

      // O trade recente segue pendente
      const pending = shadowRepo.list({ signal: "BUY" }).filter((t) => t.outcome === "pending");
      expect(pending.length).toBe(1);
    } finally {
      store.close();
    }
  });

  it("retorna null se shadowRepo não foi injetado", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const svc = new AnalyticsService(decisionRepo, candleSource([]));
      const r = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: T0, entryPrice: 100,
      });
      expect(r).toBeNull();
      const r2 = await svc.evaluatePendingShadows(12);
      expect(r2).toBeNull();
      await expect(svc.shadowStats()).resolves.toBeNull();
    } finally {
      store.close();
    }
  });

  // ===== Cooldown entre trades =====

  it("recordShadowTrade rejeita novo BUY no mesmo symbol+direction se último foi há < 4h", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const shadowRepo = new ShadowRepository(store);
      const svc = new AnalyticsService(decisionRepo, candleSource([]), { minMovePct: 0.5, lookback: 100 }, shadowRepo);

      const t0Entry = Date.parse("2023-01-01T00:00:00Z");
      const t1Entry = t0Entry + 60 * 60 * 1000; // 1h depois → dentro do cooldown de 4h

      const first = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: t0Entry, entryPrice: 100,
      });
      expect(first).not.toBeNull();

      const second = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: t1Entry, entryPrice: 105,
      });
      expect(second).toBeNull();

      // Apenas o primeiro está persistido
      const all = shadowRepo.list({ symbol: "BTCUSDT", signal: "BUY" });
      expect(all.length).toBe(1);
      expect(all[0]!.id).toBe(first!.id);
    } finally {
      store.close();
    }
  });

  it("recordShadowTrade aceita novo BUY se último do mesmo symbol+direction foi há > 4h", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const shadowRepo = new ShadowRepository(store);
      const svc = new AnalyticsService(decisionRepo, candleSource([]), { minMovePct: 0.5, lookback: 100 }, shadowRepo);

      const t0Entry = Date.parse("2023-01-01T00:00:00Z");
      const t1Entry = t0Entry + 5 * 60 * 60 * 1000; // 5h depois → fora do cooldown

      const first = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: t0Entry, entryPrice: 100,
      });
      expect(first).not.toBeNull();

      const second = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: t1Entry, entryPrice: 105,
      });
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first!.id);

      const all = shadowRepo.list({ symbol: "BTCUSDT", signal: "BUY" });
      expect(all.length).toBe(2);
    } finally {
      store.close();
    }
  });

  it("cooldown respeita direção: SELL não bloqueia novo BUY (mesmo symbol)", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const shadowRepo = new ShadowRepository(store);
      const svc = new AnalyticsService(decisionRepo, candleSource([]), { minMovePct: 0.5, lookback: 100 }, shadowRepo);

      const t0Entry = Date.parse("2023-01-01T00:00:00Z");
      const t1Entry = t0Entry + 60 * 60 * 1000; // 1h depois

      const first = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "down", decision: "SELL",
        entryTime: t0Entry, entryPrice: 100,
      });
      expect(first).not.toBeNull();

      // direction diferente (up vs down) → não bloqueia
      const second = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        entryTime: t1Entry, entryPrice: 105,
      });
      expect(second).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("WAIT ignora cooldown (pode empilhar sinais WAIT)", async () => {
    const store = new Datastore({ path: ":memory:" });
    try {
      const decisionRepo = new DecisionRepository(store);
      const shadowRepo = new ShadowRepository(store);
      const svc = new AnalyticsService(decisionRepo, candleSource([]), { minMovePct: 0.5, lookback: 100 }, shadowRepo);

      const t0Entry = Date.parse("2023-01-01T00:00:00Z");
      const t1Entry = t0Entry + 60 * 60 * 1000;

      const first = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "WAIT",
        entryTime: t0Entry, entryPrice: 100,
      });
      const second = await svc.recordShadowTrade({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "WAIT",
        entryTime: t1Entry, entryPrice: 100,
      });
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    } finally {
      store.close();
    }
  });
});