/**
 * P-A (B2) — Platt Scaling integration tests para recordDecision.
 *
 * Estes testes verificam a integração ponta-a-ponta entre
 * AnalyticsService.recordDecision e CalibrationEngine:
 *
 *  Caso 1: histórico n < 30 → probabilityCalibrated = null
 *  Caso 2: histórico n ≥ 30 com padrão Platt-friendly → probabilityCalibrated ≠ raw
 *  Caso 3: sem calibrationEngine injetado → funciona, raw preservado, calibrated = null
 *  Caso 4: coluna probability_calibrated é nullable no SQLite (default null)
 *
 * Estes casos correspondem ao brief B2 do TRACECON backlog.
 */
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import {
  CalibrationEngine,
  type CalibrationKey,
} from "../../src/analytics/calibration-engine";
import type { DecisionRecord } from "../../src/analytics/types";

const T0 = Date.parse("2023-01-01T00:00:00Z");

function repoOf(): { store: Datastore; repo: DecisionRepository } {
  const store = new Datastore({ path: ":memory:" });
  return { store, repo: new DecisionRepository(store) };
}

/** Helper para criar DecisionRecord com defaults razoáveis. */
function mkRow(overrides: Partial<DecisionRecord> & { id: string }): DecisionRecord {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "BTCUSDT",
    timeframe: overrides.timeframe ?? "1h",
    direction: overrides.direction ?? "up",
    decision: overrides.decision ?? "BUY",
    horizon: overrides.horizon ?? 5,
    entryTime: overrides.entryTime ?? T0,
    entryPrice: overrides.entryPrice ?? 100,
    score: overrides.score ?? 0.5,
    confidence: overrides.confidence ?? 0.7,
    probability: overrides.probability ?? null,
    probabilityCalibrated: overrides.probabilityCalibrated ?? null,
    sampleSize: overrides.sampleSize ?? 50,
    regime: overrides.regime ?? "uptrend",
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
    createdAt: overrides.createdAt ?? T0,
  };
}

const FUSED_INPUT_BASE = {
  symbol: "BTCUSDT",
  timeframe: "1h",
  direction: "up",
  decision: "BUY" as const,
  horizon: 5,
  entryTime: T0,
  entryPrice: 100,
  score: 0.5,
  confidence: 0.7,
  regime: "uptrend",
  rationale: "B2 integration",
};

describe("P-A (B2) — Platt Scaling integration em AnalyticsService.recordDecision", () => {
  // ────────────────────────────────────────────────────────────────────
  // Caso 1: histórico n < 30 → probabilityCalibrated = null
  // ────────────────────────────────────────────────────────────────────
  it("Caso 1: n<30 history → probabilityCalibrated = null", async () => {
    const { store, repo } = repoOf();
    const engine = new CalibrationEngine();

    // Histórico com APENAS 20 amostras (< 30) — engine não produz snapshot útil.
    const T0ms = Date.now();
    const history: DecisionRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const ts = T0ms - 30 * 86_400_000 + i * 60_000;
      history.push(mkRow({
        id: `hist${i}`,
        probability: 0.6,
        outcome: i % 2 === 0 ? "hit" : "miss",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(history);
    // fitForKey com n<30 deve setar INSUFFICIENT_SAMPLE, e calibrate() cai no fallback.
    engine.fitForKey({ symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" }, T0ms);

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rec = await svc.recordDecision({
      ...FUSED_INPUT_BASE,
      probability: 0.55,
      sampleSize: 50, // input.sampleSize >= 30 — passa o gate do gate interno
    });

    // raw preservado.
    expect(rec.probability).toBe(0.55);
    // Sem amostra suficiente, não há estimativa calibrada defensável.
    expect(rec.probabilityCalibrated).toBeNull();

    store.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Caso 2: n ≥ 30 com Platt-friendly pattern → probabilityCalibrated ≠ raw
  // ────────────────────────────────────────────────────────────────────
  it("Caso 2: n≥30 rows com padrão Platt-friendly → calibrated ≠ raw", async () => {
    const { store, repo } = repoOf();
    const engine = new CalibrationEngine();
    const T0ms = Date.now();
    const key: CalibrationKey = { symbol: "BTCUSDT", timeframe: "1h", regime: "uptrend" };

    // Padrão Platt-friendly: p varia de 0.2 → 0.8 (range amplo) com outcome = 1 (sempre hit).
    // Platt deve aprender slope > 0 e comprimir/extender probabilidades.
    const history: DecisionRecord[] = [];
    const N = 60;
    for (let i = 0; i < N; i++) {
      const ts = T0ms - 35 * 86_400_000 + i * 60_000; // distribui em janela 35d
      history.push(mkRow({
        id: `hist${i}`,
        probability: 0.2 + (i / N) * 0.6, // 0.2..0.8
        outcome: "hit",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    for (let i = 0; i < 20; i++) {
      const ts = T0ms - 2 * 86_400_000 + i * 60_000;
      history.push(mkRow({
        id: `oos${i}`,
        probability: 0.35 + (i / 20) * 0.3,
        outcome: i < 12 ? "hit" : "miss",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(history);
    const snap = engine.fitForKey(key, T0ms);
    // 60 amostras > 30 — não deve ser INSUFFICIENT_SAMPLE.
    expect(snap.status).not.toBe("INSUFFICIENT_SAMPLE");
    // O motor pode escolher Isotonic quando ele vence Platt na validação OOS.
    expect(["platt", "isotonic"]).toContain(snap.fit.params.method);
    if (snap.fit.params.method === "platt") expect(snap.fit.params.A).toBeGreaterThan(0);

    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      calibrationEngine: engine,
    });

    const rawProb = 0.5;
    const rec = await svc.recordDecision({
      ...FUSED_INPUT_BASE,
      probability: rawProb,
      sampleSize: 50,
    });

    // raw preservado.
    expect(rec.probability).toBe(rawProb);
    // Platt aplicou uma transformação → calibrado ≠ raw.
    expect(rec.probabilityCalibrated).not.toBeNull();
    expect(rec.probabilityCalibrated).not.toBe(rawProb);
    // Valor calibrado em (0, 1).
    expect(rec.probabilityCalibrated!).toBeGreaterThan(0);
    expect(rec.probabilityCalibrated!).toBeLessThan(1);

    // Persistiu no banco.
    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.probabilityCalibrated).toBe(rec.probabilityCalibrated);
    expect(all[0]!.probability).toBe(rawProb);

    store.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Caso 3: sem calibrationEngine → ainda funciona, raw preservado
  // ────────────────────────────────────────────────────────────────────
  it("Caso 3: sem calibrationEngine injetado → service funciona, raw preservado, calibrated = null", async () => {
    const { store, repo } = repoOf();
    const svc = new AnalyticsService({
      persist: repo,
      candles: () => [],
      // calibrationEngine: undefined (deliberadamente omitido — modo legado)
    });

    const rec = await svc.recordDecision({
      ...FUSED_INPUT_BASE,
      probability: 0.73,
      sampleSize: 50,
    });

    // raw preservado.
    expect(rec.probability).toBe(0.73);
    // sem engine → null.
    expect(rec.probabilityCalibrated).toBeNull();

    // Persistido.
    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.probability).toBe(0.73);
    expect(all[0]!.probabilityCalibrated).toBeNull();

    // input.probability NÃO deve ter sido mutado.
    // (Verificável indiretamente: o valor inserido no DB é igual ao valor original do input.)
    store.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Caso 4: coluna probability_calibrated é nullable no schema
  // ────────────────────────────────────────────────────────────────────
  it("Caso 4: schema coluna probability_calibrated é nullable (default null)", () => {
    const store = new Datastore({ path: ":memory:" });

    // Insere um registro SEM a coluna → não deve falhar (coluna nullable).
    // Usamos o repo real para confirmar que o INSERT funciona sem probabilityCalibrated.
    const repo = new DecisionRepository(store);
    void repo.save({
      id: "test1",
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
      // probabilityCalibrated omitido — deve usar null default
      sampleSize: 50,
      regime: "uptrend",
      rationale: "schema test",
      createdAt: T0,
    });

    // Lê de volta e confirma que é null.
    const rows = store.db.prepare(
      "SELECT probability_calibrated FROM decision_records WHERE id = ?",
    ).get("test1") as { probability_calibrated: number | null } | undefined;
    expect(rows).toBeDefined();
    expect(rows!.probability_calibrated).toBeNull();

    // Inspeção do schema via PRAGMA table_info.
    const schema = store.db.prepare("PRAGMA table_info(decision_records)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const probCalCol = schema.find((c) => c.name === "probability_calibrated");
    expect(probCalCol).toBeDefined();
    expect(probCalCol!.type).toBe("REAL");
    expect(probCalCol!.notnull).toBe(0); // nullable

    store.close();
  });
});
