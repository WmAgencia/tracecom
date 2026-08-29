import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import type { MarketCandle, Timeframe } from "../../src/market/model";
import {
  arrayStore,
  getCalibrationReport,
  type CalibrationDecisionRow,
  type CalibrationStore,
} from "../../src/analytics/calibration";
import type { DecisionRecord } from "../../src/analytics/types";

function mkCandle(ts: number, close: number): MarketCandle {
  return {
    provider: "binance",
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

const T0 = Date.parse("2023-01-01T00:00:00Z");
const HOUR = 3_600_000;

/** Helper para criar DecisionRecord já avaliada, pronta para o relatório. */
function mkRow(p: Partial<DecisionRecord>): DecisionRecord {
  return {
    id: p.id ?? crypto.randomUUID(),
    symbol: p.symbol ?? "BTCUSDT",
    timeframe: p.timeframe ?? "1h",
    direction: p.direction ?? "up",
    decision: p.decision ?? "BUY",
    horizon: p.horizon ?? 5,
    entryTime: p.entryTime ?? T0,
    entryPrice: p.entryPrice ?? 100,
    score: p.score ?? 0.5,
    confidence: p.confidence ?? 0.7,
    probability: p.probability ?? 0.6,
    sampleSize: p.sampleSize ?? 50,
    regime: p.regime ?? "uptrend",
    rationale: p.rationale ?? "test",
    outcome: p.outcome ?? "hit",
    exitTime: p.exitTime ?? T0 + HOUR,
    exitPrice: p.exitPrice ?? 110,
    returnPct: p.returnPct ?? 1.0,
    evaluatedAt: p.evaluatedAt ?? T0 + HOUR,
    createdAt: p.createdAt ?? T0,
  };
}

/** Adapter mínimo de store baseado no DecisionRepository real. */
function repoStore(repo: DecisionRepository): CalibrationStore {
  return {
    async listEvaluatedDecisions() {
      // O repositório atual expõe `stats` e `listPending`. Para o calibration
      // usamos o mesmo DB subjacente via uma query inline.
      const rows = (repo as unknown as { store: { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } } })
        .store.db
        .prepare(
          "SELECT * FROM decision_records WHERE outcome != 'pending' ORDER BY evaluated_at ASC",
        )
        .all() as unknown as DecisionRecord[];
      return rows;
    },
  };
}

describe("CAMADA 4 — Calibration report", () => {
  it("store vazio → zeros", async () => {
    const rep = await getCalibrationReport(arrayStore([]));
    expect(rep.totalDecisions).toBe(0);
    expect(rep.evaluated).toBe(0);
    expect(rep.wins).toBe(0);
    expect(rep.misses).toBe(0);
    expect(rep.winRate).toBe(0);
    expect(rep.brierScore).toBe(0);
    expect(rep.ece).toBe(0);
    expect(rep.perSignal.BUY.n).toBe(0);
    expect(rep.perSignal.SELL.n).toBe(0);
    expect(rep.perSignal.WAIT.n).toBe(0);
    expect(rep.topSetups).toEqual([]);
    expect(rep.drawdownObserved).toBe(0);
    expect(rep.guardStatus.circuitBreaker).toBe("ok");
    expect(typeof rep.snapshotAt).toBe("string");
  });

  it("10 wins + 5 misses de BUY → perSignal.BUY.n=15, wins=10, winRate=2/3", async () => {
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(mkRow({ decision: "BUY", outcome: "hit", returnPct: 1 + i * 0.1 }));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(mkRow({ decision: "BUY", outcome: "miss", returnPct: -(1 + i * 0.1) }));
    }
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.perSignal.BUY.n).toBe(15);
    expect(rep.perSignal.BUY.wins).toBe(10);
    expect(rep.perSignal.BUY.winRate).toBeCloseTo(10 / 15, 5);
    expect(rep.perSignal.BUY.avgReturn).not.toBeNull();
    expect(rep.wins).toBe(10);
    expect(rep.misses).toBe(5);
    expect(rep.winRate).toBeCloseTo(10 / 15, 5);
    expect(rep.perSignal.SELL.n).toBe(0);
    expect(rep.perSignal.WAIT.n).toBe(0);
  });

  it("ECE < 0.1 com 100 pontos bem calibrados (prob ≈ outcome-rate por bin)", async () => {
    // Para cada um dos 10 bins de probabilidade, geramos 10 decisões cuja taxa
    // de acerto coincide aproximadamente com a probabilidade central do bin.
    // Isso é calibração quase perfeita → ECE bem abaixo de 0.1.
    const rows: DecisionRecord[] = [];
    for (let bin = 0; bin < 10; bin++) {
      const p = (bin + 0.5) / 10; // probabilidade central do bin
      const hitsInBin = Math.floor(p * 10);
      for (let k = 0; k < 10; k++) {
        const outcome: "hit" | "miss" = k < hitsInBin ? "hit" : "miss";
        rows.push(mkRow({ probability: p, outcome, decision: "BUY" }));
      }
    }
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.ece).toBeLessThan(0.1);
    // Brier ≤ 1 (sanity bound)
    expect(rep.brierScore).toBeGreaterThanOrEqual(0);
    expect(rep.brierScore).toBeLessThanOrEqual(1);
  });

  it("perTimeframe separa por timeframe", async () => {
    const rows: DecisionRecord[] = [
      mkRow({ timeframe: "1h", decision: "BUY", outcome: "hit" }),
      mkRow({ timeframe: "1h", decision: "BUY", outcome: "hit" }),
      mkRow({ timeframe: "1h", decision: "BUY", outcome: "miss" }),
      mkRow({ timeframe: "4h", decision: "SELL", outcome: "hit" }),
      mkRow({ timeframe: "4h", decision: "SELL", outcome: "miss" }),
      mkRow({ timeframe: "4h", decision: "SELL", outcome: "miss" }),
      mkRow({ timeframe: "1d", decision: "BUY", outcome: "hit" }),
    ];
    const rep = await getCalibrationReport(arrayStore(rows));
    const tf1h = rep.perTimeframe["1h"]!;
    const tf4h = rep.perTimeframe["4h"]!;
    const tf1d = rep.perTimeframe["1d"]!;
    expect(tf1h.n).toBe(3);
    expect(tf1h.wins).toBe(2);
    expect(tf1h.winRate).toBeCloseTo(2 / 3, 5);
    expect(tf4h.n).toBe(3);
    expect(tf4h.wins).toBe(1);
    expect(tf1d.n).toBe(1);
    expect(tf1d.winRate).toBe(1);
  });

  it("topSetups: top 5 com n >= 5", async () => {
    const regimes = [
      { name: "uptrend", n: 8, hits: 6 },
      { name: "downtrend", n: 7, hits: 2 },
      { name: "range", n: 6, hits: 4 },
      { name: "volatile", n: 5, hits: 1 },
      { name: "breakout", n: 10, hits: 7 },
      { name: "tiny", n: 3, hits: 3 }, // abaixo do minN — não deve aparecer
      { name: "medium", n: 5, hits: 3 },
    ];
    const rows: DecisionRecord[] = [];
    for (const r of regimes) {
      for (let i = 0; i < r.n; i++) {
        const outcome: "hit" | "miss" = i < r.hits ? "hit" : "miss";
        rows.push(mkRow({ regime: r.name, outcome }));
      }
    }
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.topSetups.length).toBeLessThanOrEqual(5);
    // "tiny" tem n=3 < minN=5 → não aparece
    expect(rep.topSetups.find((s) => s.setup === "tiny")).toBeUndefined();
    // "breakout" tem n=10 → é o top
    expect(rep.topSetups[0]?.setup).toBe("breakout");
    expect(rep.topSetups[0]?.n).toBe(10);
    // Todos têm n >= 5
    for (const s of rep.topSetups) expect(s.n).toBeGreaterThanOrEqual(5);
    // Quantidade total limitada a 5
    expect(rep.topSetups.length).toBeLessThanOrEqual(5);
    // Pelo menos 5 setups válidos
    const eligible = regimes.filter((r) => r.n >= 5);
    expect(eligible.length).toBe(6);
  });

  it("drawdown observado é derivado das losses reais", async () => {
    const rows: DecisionRecord[] = [
      mkRow({ outcome: "miss", returnPct: -2, evaluatedAt: T0 }),
      mkRow({ outcome: "miss", returnPct: -3, evaluatedAt: T0 }),
      mkRow({ outcome: "hit", returnPct: 5, evaluatedAt: T0 }),
      // outro dia: perda menor
      mkRow({ outcome: "miss", returnPct: -1.5, evaluatedAt: T0 + 24 * HOUR }),
    ];
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.drawdownObserved).toBeCloseTo(5, 5); // -2 + -3 = 5 no dia 1
    expect(rep.drawdownMax).toBe(5); // limite
    expect(rep.guardStatus.dailyLossPct).toBeCloseTo(5, 5);
    expect(rep.guardStatus.circuitBreaker).toBe("ok"); // não excedeu 5
    expect(rep.guardStatus.lastLossAt).not.toBeNull();
  });

  it("guardStatus.tripped quando drawdown diário excede limite", async () => {
    const rows: DecisionRecord[] = [
      mkRow({ outcome: "miss", returnPct: -3, evaluatedAt: T0 }),
      mkRow({ outcome: "miss", returnPct: -3, evaluatedAt: T0 }),
    ];
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.drawdownObserved).toBe(6);
    expect(rep.guardStatus.circuitBreaker).toBe("tripped");
  });

  it("integra com DecisionRepository real via adapter", async () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new DecisionRepository(store);
    const candles = [
      mkCandle(T0, 100),
      mkCandle(T0 + HOUR, 102),
      mkCandle(T0 + 2 * HOUR, 105),
      mkCandle(T0 + 3 * HOUR, 104),
      mkCandle(T0 + 4 * HOUR, 108),
      mkCandle(T0 + 5 * HOUR, 112), // exit
    ];
    const svc = new AnalyticsService(repo, () => candles, { minMovePct: 0.5, lookback: 100 });
    await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.8,
      probability: 0.75,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "test",
    });
    await svc.evaluatePending();
    const rep = await getCalibrationReport(repoStore(repo));
    expect(rep.totalDecisions).toBe(1);
    expect(rep.wins).toBe(1);
    expect(rep.misses).toBe(0);
    expect(rep.winRate).toBe(1);
    store.close();
  });

  it("filtra por janela (days) — exclui decisões fora do range", async () => {
    const old = mkRow({ outcome: "hit", evaluatedAt: T0 });
    const recent = mkRow({ outcome: "miss", evaluatedAt: Date.now() - 1000 });
    const rep = await getCalibrationReport(
      arrayStore([old, recent]),
      { days: 7 },
    );
    // Apenas a "recent" deve entrar (T0 = 2023, fora dos últimos 7 dias)
    expect(rep.totalDecisions).toBe(1);
    expect(rep.wins).toBe(0);
    expect(rep.misses).toBe(1);
  });

  it("suporta função síncrona como store", async () => {
    const rows = [mkRow({ outcome: "hit" }), mkRow({ outcome: "miss" })];
    const syncStore: CalibrationStore = {
      listEvaluatedDecisions: () => rows,
    };
    const rep = await getCalibrationReport(syncStore);
    expect(rep.totalDecisions).toBe(2);
    expect(rep.wins).toBe(1);
    expect(rep.misses).toBe(1);
  });

  // Teste do tipo: garantir que CalibrationDecisionRow é exportado (não usado aqui, mas garante a superfície pública).
  void (null as unknown as CalibrationDecisionRow);
});
