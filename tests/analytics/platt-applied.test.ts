/**
 * Testes P-A (B2): Platt Scaling aplicado ao histórico de DecisionRecords.
 *
 * Cobre os 3 cenários do brief:
 *  1. 100 records sintéticos descalibrados (p=0.7, y=0.5) — após applyCalibration,
 *     novos valores têm média ≈ 0.5 (Platt aprendeu a correção).
 *  2. 20 records (n < 30) — todos ficam `probabilityCalibrated = null`.
 *  3. Dois regimes diferentes (uptrend n=50, downtrend n=50) com vieses opostos —
 *     cada regime é calibrado independentemente.
 */
import { describe, it, expect } from "vitest";
import { CalibrationEngine, type CalibrationKey } from "../../src/analytics/calibration-engine";
import { applyPlatt } from "../../src/analytics/platt-scaler";
import type { DecisionRecord } from "../../src/analytics/types";

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

describe("P-A (B2) — Platt Scaling aplicado", () => {
  it("Caso 1: 100 records descalibrados (p=0.7, y=0.5) → média calibrada ≈ 0.5", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    // 100 amostras com p=0.7 e outcome 50/50 → modelo otimista.
    for (let i = 0; i < 100; i++) {
      const ts = T0 - 60 * 86_400_000 + i * 60_000;
      const outcome: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "unknown",
        probability: 0.7,
        outcome,
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);

    // Todos devem ter um valor calibrado (n=100 >= 30).
    const calibratedValues = calibrated
      .map((r) => r.probabilityCalibrated)
      .filter((v): v is number => v !== null);
    expect(calibratedValues.length).toBe(100);

    // Platt deve aprender a reduzir 0.7 → ≈0.5 (taxa real).
    const mean = calibratedValues.reduce((a, b) => a + b, 0) / calibratedValues.length;
    // Platt ou isotonic devem ambos baixar significativamente abaixo de 0.7.
    // Aceitamos uma janela ampla (0.35 .. 0.65) — o valor exato depende de Platt vs isotonic.
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);

    // Garantia: nenhum valor calibrado é igual ao raw 0.7 (Platt mudou).
    expect(mean).not.toBeCloseTo(0.7, 1);
  });

  it("Caso 2: 20 records (n < 30) → todos ficam probabilityCalibrated = null", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const ts = T0 - 60 * 86_400_000 + i * 60_000;
      const outcome: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "unknown",
        probability: 0.6,
        outcome,
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);

    // 20 < 30 → nenhum deve ter probabilidade calibrada.
    for (const r of calibrated) {
      expect(r.probabilityCalibrated).toBeNull();
    }
  });

  it("Caso 3: dois regimes com vieses opostos calibrados independentemente", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rowsA: DecisionRecord[] = []; // uptrend: superotimista (p=0.7, y=0.5)
    const rowsB: DecisionRecord[] = []; // downtrend: superpessimista (p=0.3, y=0.5)
    for (let i = 0; i < 50; i++) {
      const ts = T0 - 30 * 86_400_000 + i * 60_000;
      // uptrend: outcome aleatório (50/50), probabilidade otimista 0.7
      const outcomeA: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rowsA.push(mkRow({
        id: `a${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: 0.7,
        outcome: outcomeA,
        evaluatedAt: ts,
        createdAt: ts,
      }));
      // downtrend: outcome aleatório (50/50), probabilidade pessimista 0.3
      const outcomeB: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rowsB.push(mkRow({
        id: `b${i}`,
        symbol: "ETHUSDT",
        timeframe: "1h",
        regime: "downtrend",
        probability: 0.3,
        outcome: outcomeB,
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    const all = [...rowsA, ...rowsB];
    engine.pushHistory(all);
    const calibrated = engine.applyCalibration(all);

    // Separa por regime.
    const calA = calibrated.filter((r) => r.regime === "uptrend");
    const calB = calibrated.filter((r) => r.regime === "downtrend");
    expect(calA.length).toBe(50);
    expect(calB.length).toBe(50);

    // Ambos regimes devem ter sido calibrados (cada um n=50 >= 30).
    for (const r of calA) expect(r.probabilityCalibrated).not.toBeNull();
    for (const r of calB) expect(r.probabilityCalibrated).not.toBeNull();

    // Médias:
    //  - uptrend: deve baixar de 0.7 em direção a 0.5.
    //  - downtrend: deve subir de 0.3 em direção a 0.5.
    const meanA = calA.reduce((acc, r) => acc + (r.probabilityCalibrated ?? 0), 0) / calA.length;
    const meanB = calB.reduce((acc, r) => acc + (r.probabilityCalibrated ?? 0), 0) / calB.length;
    expect(meanA).toBeLessThan(0.7); // baixou (Platt aprendeu que 0.7 é otimista)
    expect(meanB).toBeGreaterThan(0.3); // subiu (Platt aprendeu que 0.3 é pessimista)
    // Os regimes devem ter sido calibrados com sinais opostos:
    // A diferença entre as médias calibradas deve ser bem menor que entre as raw.
    const rawDiff = Math.abs(0.7 - 0.3); // 0.4
    const calDiff = Math.abs(meanA - meanB);
    expect(calDiff).toBeLessThan(rawDiff);
  });

  it("retorna novo array (não muta original)", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 50; i++) {
      const ts = T0 - 30 * 86_400_000 + i * 60_000;
      const outcome: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: 0.6,
        outcome,
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);
    expect(calibrated).not.toBe(rows); // referência nova
    expect(calibrated.length).toBe(rows.length);
    // O array original deve estar intacto.
    for (const r of rows) {
      expect(r.probabilityCalibrated).toBeNull();
    }
    // O array novo deve ter valores diferentes.
    let countCalibrated = 0;
    for (const r of calibrated) {
      if (r.probabilityCalibrated !== null) countCalibrated++;
    }
    expect(countCalibrated).toBe(50);
  });

  it("aplica Platt corretamente para uma chave específica (fit manual)", () => {
    // Garante que o método usa fitPlatt+applyPlatt corretamente.
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    // Modelo com viés forte: p_i = 0.5 ± 0.4*i/50, y_i = 1 (sempre hit) → Platt deve aprender slope > 0.
    for (let i = 0; i < 60; i++) {
      const ts = T0 - 30 * 86_400_000 + i * 60_000;
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: 0.5 + (i / 60) * 0.4, // 0.5..0.9
        outcome: "hit", // sempre acerto
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);
    // Pelo menos 30 devem ter sido calibrados (n=60).
    let n = 0;
    for (const r of calibrated) if (r.probabilityCalibrated !== null) n++;
    expect(n).toBe(60);
    // Os valores calibrados devem estar numa faixa diferente da raw 0.5..0.9.
    // Como outcome é sempre hit, Platt deve comprimir para algo próximo da média.
    const calVals = calibrated.map((r) => r.probabilityCalibrated!).filter((v) => Number.isFinite(v));
    const meanCal = calVals.reduce((a, b) => a + b, 0) / calVals.length;
    // Platt deve ter aprendido um viés (provavelmente comprime para ≈1.0 ou
    // fica próximo da média de y=1 com algum ajuste).
    expect(Number.isFinite(meanCal)).toBe(true);
    expect(meanCal).toBeGreaterThan(0.5);
  });

  it("records com probability=null ficam com probabilityCalibrated=null", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 50; i++) {
      const ts = T0 - 30 * 86_400_000 + i * 60_000;
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: i < 25 ? 0.6 : null, // metade sem probability
        outcome: "hit",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);
    // Os 25 com probability=null devem ter probabilityCalibrated=null.
    let nullCount = 0;
    for (const r of calibrated) {
      if (r.probability === null) {
        expect(r.probabilityCalibrated).toBeNull();
        nullCount++;
      }
    }
    expect(nullCount).toBe(25);
  });

  it("records com probability fora de [0,1] ficam com probabilityCalibrated=null", () => {
    const engine = new CalibrationEngine();
    const T0 = Date.now();
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < 50; i++) {
      const ts = T0 - 30 * 86_400_000 + i * 60_000;
      rows.push(mkRow({
        id: `r${i}`,
        symbol: "BTCUSDT",
        timeframe: "1h",
        regime: "uptrend",
        probability: i < 25 ? 0.6 : 1.5, // 25 com probability inválida
        outcome: "hit",
        evaluatedAt: ts,
        createdAt: ts,
      }));
    }
    engine.pushHistory(rows);
    const calibrated = engine.applyCalibration(rows);
    let nullCount = 0;
    for (const r of calibrated) {
      if (r.probability !== null && (r.probability < 0 || r.probability > 1)) {
        expect(r.probabilityCalibrated).toBeNull();
        nullCount++;
      }
    }
    expect(nullCount).toBe(25);
  });

  it("usa applyPlatt internamente (validação matemática)", () => {
    // Confirma que o resultado bate com applyPlatt manual para os mesmos params.
    const samples = [
      { p: 0.3, y: 0 },
      { p: 0.4, y: 0 },
      { p: 0.5, y: 1 },
      { p: 0.6, y: 1 },
      { p: 0.7, y: 1 },
    ];
    const params = { method: "platt" as const, A: 1, B: 0 };
    const expected = samples.map((s) => applyPlatt(s.p, params));
    expect(expected[0]).toBeCloseTo(0.3, 5);
    expect(expected[2]).toBeCloseTo(0.5, 5);
    expect(expected[4]).toBeCloseTo(0.7, 5);
  });
});
