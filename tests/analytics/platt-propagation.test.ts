/**
 * P-A (B2): Platt Propagation tests.
 *
 * Verifica que `recordDecision` consulta o `CalibrationEngine` (quando injetado)
 * e propaga `probabilityCalibrated` para o repositório.
 *
 * Casos (alinhados com o brief B2 — `calibrateProbability`):
 *  1. Engine com snapshot CALIBRATED → persiste valor Platt calibrado.
 *  2. Engine ausente (null) → `probability_calibrated = null`, raw preservado.
 *  3. Engine presente mas sem snapshot (chave nunca vista)
 *     → fallback para rawProb.
 *  4. Engine presente com INSUFFICIENT_SAMPLE (n < 30) → `null` (passthrough).
 *
 * Compatibilidade retroativa: testes existentes constroem o service SEM engine
 * e devem continuar passando.
 */
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import {
  CalibrationEngine,
  type CalibrationKey,
  type CalibrationSnapshot,
} from "../../src/analytics/calibration-engine";
import type { DecisionRecord } from "../../src/analytics/types";
import type { MarketCandle, Timeframe } from "../../src/market/model";

const T0 = Date.parse("2023-01-01T00:00:00Z");
const M = 3_600_000;

function repoOf(): { store: Datastore; repo: DecisionRepository } {
  const store = new Datastore({ path: ":memory:" });
  return { store, repo: new DecisionRepository(store) };
}

function candleSource(candles: MarketCandle[]) {
  return (_s: string, _tf: Timeframe) => candles;
}

/** Subclasse de CalibrationEngine que MOCKA `calibrateProbability` (helper B2). */
class MockCalibrationEngine extends CalibrationEngine {
  public mockCalibrated: number | null = null;
  public mockCalibrateCalls: Array<{ key: CalibrationKey; rawProbability: number | null }> = [];
  public mockSnapshot: CalibrationSnapshot | null = null;
  public mockSampleSizeGate = 30;

  override getSnapshot(key: CalibrationKey): CalibrationSnapshot | null {
    return this.mockSnapshot;
  }

  override calibrateProbability(rawProbability: number | null, key: CalibrationKey): number | null {
    this.mockCalibrateCalls.push({ key, rawProbability });
    // Quando snapshot mockado diz INSUFFICIENT_SAMPLE → null (passthrough B2).
    if (this.mockSnapshot && this.mockSnapshot.status === "INSUFFICIENT_SAMPLE") {
      return null;
    }
    // Snapshot null → fallback raw (chave nunca vista).
    if (this.mockSnapshot === null) {
      return rawProbability;
    }
    // Demais casos: devolve mock; se mockCalibrated for null, devolve raw como
    // sinal de "não calibrado" (mantém compatibilidade com o método real).
    return this.mockCalibrated ?? rawProbability;
  }
}

function mkRow(overrides: Partial<DecisionRecord> & { id: string }): DecisionRecord {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "BTCUSDT",
    timeframe: overrides.timeframe ?? "1h",
    direction: overrides.direction ?? "up",
    decision: overrides.decision ?? "BUY",
    horizon: overrides.horizon ?? 5,
    entryTime: overrides.entryTime ?? 0,
    entryPrice: overrides.entryPrice ?? 100,
    score: overrides.score ?? 0.5,
    confidence: overrides.confidence ?? 0.7,
    probability: overrides.probability ?? null,
    probabilityCalibrated: overrides.probabilityCalibrated ?? null,
    sampleSize: overrides.sampleSize ?? 50,
    regime: overrides.regime ?? "unknown",
    rationale: overrides.rationale ?? "test",
    providerId: overrides.providerId ?? null,
    modelVersion: overrides.modelVersion ?? null,
    featureVersion: overrides.featureVersion ?? null,
    outcome: overrides.outcome ?? "pending",
    exitTime: overrides.exitTime ?? null,
    exitPrice: overrides.exitPrice ?? null,
    returnPct: overrides.returnPct ?? null,
    grossReturnPct: overrides.grossReturnPct ?? null,
    costPct: overrides.costPct ?? null,
    evaluatedAt: overrides.evaluatedAt ?? null,
    evaluationAttempts: overrides.evaluationAttempts ?? 0,
    lastEvaluationError: overrides.lastEvaluationError ?? null,
    evaluationLocked: overrides.evaluationLocked ?? false,
    createdAt: overrides.createdAt ?? 0,
  };
}

describe("P-A B2 — Platt propagation em recordDecision", () => {
  it("Caso 1: engine com CALIBRATED → persiste probability_calibrated do engine", async () => {
    const { store, repo } = repoOf();
    const engine = new MockCalibrationEngine();
    const key: CalibrationKey = { symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" };
    engine.mockSnapshot = {
      key,
      fit: {
        params: { method: "platt", A: 1.0, B: 0.0 },
        nSamples: 120,
        nHits: 60,
        nMisses: 60,
        logLoss: 0.5,
        brierScore: 0.2,
        trainedOn: { from: 0, to: 1 },
        trainedAt: 0,
      },
      oos: null,
      status: "CALIBRATED",
      reasonCodes: [],
      updatedAt: 0,
    };
    engine.mockCalibrated = 0.65;

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.6,
      sampleSize: 50, // >= 30 — passa o gate
      regime: "uptrend",
      rationale: "B2 Caso 1",
    });

    expect(rec.probability).toBe(0.6);
    expect(rec.probabilityCalibrated).toBe(0.65);
    expect(engine.mockCalibrateCalls).toHaveLength(1);
    expect(engine.mockCalibrateCalls[0]!.key).toEqual(key);
    expect(engine.mockCalibrateCalls[0]!.rawProbability).toBe(0.6);

    // Persistência: lê o registro de volta via listAll() e confirma a coluna.
    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.probabilityCalibrated).toBe(0.65);
    expect(all[0]!.probability).toBe(0.6);
    store.close();
  });

  it("Caso 2: sem engine (null) → probability_calibrated = null, raw preservado", async () => {
    const { store, repo } = repoOf();
    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      // calibrationEngine: undefined (deliberadamente omitido)
    });
    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.42,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "B2 Caso 2",
    });
    expect(rec.probability).toBe(0.42);
    expect(rec.probabilityCalibrated).toBeNull();

    const all = await repo.listAll();
    expect(all[0]!.probabilityCalibrated).toBeNull();
    expect(all[0]!.probability).toBe(0.42);
    store.close();
  });

  it("Caso 3: engine presente mas sem snapshot (chave nunca vista) → fallback para rawProb", async () => {
    const { store, repo } = repoOf();
    const engine = new MockCalibrationEngine();
    // Sem mockSnapshot → getSnapshot retorna null → fallback raw.
    engine.mockSnapshot = null;
    engine.mockCalibrated = null;

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.55,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "B2 Caso 3 (chave nunca vista)",
    });

    // Esperado: fallback para raw (0.55) já que engine não tem snapshot.
    expect(rec.probabilityCalibrated).toBe(0.55);
    expect(rec.probability).toBe(0.55);

    const all = await repo.listAll();
    expect(all[0]!.probabilityCalibrated).toBe(0.55);
    store.close();
  });

  it("Caso 4: engine presente com INSUFFICIENT_SAMPLE → null (passthrough)", async () => {
    const { store, repo } = repoOf();
    const engine = new MockCalibrationEngine();
    const key: CalibrationKey = { symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" };
    engine.mockSnapshot = {
      key,
      fit: {
        params: { method: "platt", A: 1, B: 0 },
        nSamples: 0,
        nHits: 0,
        nMisses: 0,
        logLoss: 0,
        brierScore: 0,
        trainedOn: { from: 0, to: 1 },
        trainedAt: 0,
      },
      oos: null,
      status: "INSUFFICIENT_SAMPLE",
      reasonCodes: ["INSUFFICIENT_SAMPLE: train n=0 < 30"],
      updatedAt: 0,
    };
    // mockCalibrated é null (simula "calibResult.calibrated === null").
    engine.mockCalibrated = null;

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.55,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "B2 Caso 4 (INSUFFICIENT_SAMPLE)",
    });

    // Esperado: passthrough → null (não usar Platt não-confiável).
    expect(rec.probabilityCalibrated).toBeNull();
    expect(rec.probability).toBe(0.55);

    const all = await repo.listAll();
    expect(all[0]!.probabilityCalibrated).toBeNull();
    store.close();
  });

  it("Compat retroativa: input sem `probability` (null) + engine → calibrated=null", async () => {
    const { store, repo } = repoOf();
    const engine = new MockCalibrationEngine();
    engine.mockSnapshot = {
      key: { symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" },
      fit: {
        params: { method: "platt", A: 1, B: 0 },
        nSamples: 100,
        nHits: 50,
        nMisses: 50,
        logLoss: 0.5,
        brierScore: 0.2,
        trainedOn: { from: 0, to: 1 },
        trainedAt: 0,
      },
      oos: null,
      status: "CALIBRATED",
      reasonCodes: [],
      updatedAt: 0,
    };
    engine.mockCalibrated = 0.9;
    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });
    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "WAIT",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.1,
      confidence: 0.5,
      probability: null, // sem probabilidade crua — nada para calibrar
      sampleSize: 50,
      regime: "uptrend",
      rationale: "B2 sem prob",
    });
    expect(rec.probability).toBeNull();
    expect(rec.probabilityCalibrated).toBeNull();
    // Não deve ter chamado calibrate (nada para calibrar).
    expect(engine.mockCalibrateCalls).toHaveLength(0);
    store.close();
  });

  it("Compat retroativa: input sem engine (não injetado) → service funciona", async () => {
    // Este teste já é coberto por tests/analytics/service.test.ts mas
    // reforçamos aqui que o construtor aceita deps sem calibrationEngine.
    const { store, repo } = repoOf();
    const candles = [
      { provider: "binance", symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 102, low: 99, close: 101, volume: 10, timestamp: T0, receivedAt: T0 + 1, isClosed: true, source: "test", quality: "high" } as MarketCandle,
      { provider: "binance", symbol: "BTCUSDT", timeframe: "1h", open: 101, high: 103, low: 100, close: 102, volume: 10, timestamp: T0 + M, receivedAt: T0 + M + 1, isClosed: true, source: "test", quality: "high" } as MarketCandle,
    ];
    const svc = new AnalyticsService({
      persist: repo,
      candles: candleSource(candles),
    });
    const rec = await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY", horizon: 1,
      entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7, probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "compat",
    });
    expect(rec.probabilityCalibrated).toBeNull(); // sem engine → null
    store.close();
  });

  it("B2 end-to-end: CalibrationEngine real (sem mocking) propaga Platt-scaled value", async () => {
    // Verifica que o fluxo completo engine-real → service → DB persiste corretamente.
    const { store, repo } = repoOf();
    const engine = new CalibrationEngine();
    const T0ms = Date.now();
    const key: CalibrationKey = { symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" };
    // Gera 120 amostras (passa do gate 30+) espalhadas em 30 dias (train window).
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 120; i++) {
      // Espalha nos últimos 30 dias; train window é 30 dias, OOS 7 dias.
      // Para entrar no train: timestamps entre [now-37d, now-7d).
      const ts = T0ms - 35 * 86_400_000 + i * 60_000; // 35 dias atrás até ~34.87 dias
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: 0.5 + (i % 50) / 100,
        outcome: i % 3 === 0 ? "miss" : "hit",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    for (let i = 0; i < 30; i++) {
      const ts = T0ms - 2 * 86_400_000 + i * 60_000;
      rows.push(mkRow({
        id: `oos-${i}`, symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend",
        probability: 0.45 + (i % 10) / 100,
        outcome: i % 3 === 0 ? "miss" : "hit",
        evaluatedAt: ts, createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const snap = engine.fitForKey(key, T0ms);
    // Pode ser PROVISIONAL ou CALIBRATED dependendo da ECE — em qualquer caso
    // não deve ser INSUFFICIENT_SAMPLE (pois temos 120 amostras > 30).
    expect(snap.status).not.toBe("INSUFFICIENT_SAMPLE");

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rec = await svc.recordDecision({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      decision: "BUY",
      horizon: 5,
      entryTime: T0,
      entryPrice: 100,
      score: 0.5,
      confidence: 0.7,
      probability: 0.6,
      sampleSize: 50,
      regime: "uptrend",
      rationale: "B2 e2e",
    });

    expect(rec.probability).toBe(0.6);
    expect(rec.probabilityCalibrated).not.toBeNull();
    // Platt-scaled value deve estar em [0,1].
    expect(rec.probabilityCalibrated).toBeGreaterThanOrEqual(0);
    expect(rec.probabilityCalibrated!).toBeLessThanOrEqual(1);

    const all = await repo.listAll();
    expect(all[0]!.probabilityCalibrated).toBe(rec.probabilityCalibrated);
    store.close();
  });
});
