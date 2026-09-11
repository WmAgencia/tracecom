import { describe, expect, it } from "vitest";
import {
  arrayStore,
  getCalibrationReport,
  type ReliabilityBin,
} from "../../src/analytics/calibration";
import type { DecisionRecord } from "../../src/analytics/types";

const T0 = Date.parse("2023-01-01T00:00:00Z");
const HOUR = 3_600_000;

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
    probabilityCalibrated: p.probabilityCalibrated ?? null,
    sampleSize: p.sampleSize ?? 50,
    regime: p.regime ?? "uptrend",
    rationale: p.rationale ?? "test",
    providerId: p.providerId ?? "binance",
    modelVersion: p.modelVersion ?? "test",
    featureVersion: p.featureVersion ?? "test",
    outcome: p.outcome ?? "hit",
    exitTime: p.exitTime ?? T0 + HOUR,
    exitPrice: p.exitPrice ?? 110,
    returnPct: p.returnPct ?? 1.0,
    grossReturnPct: p.grossReturnPct ?? null,
    costPct: p.costPct ?? null,
    evaluatedAt: p.evaluatedAt ?? T0 + HOUR,
    evaluationAttempts: p.evaluationAttempts ?? 1,
    lastEvaluationError: p.lastEvaluationError ?? null,
    evaluationLocked: p.evaluationLocked ?? false,
    createdAt: p.createdAt ?? T0,
  };
}

/**
 * B-R: Reliability diagram endpoint — expõe os 10 bins internos de
 * `computeBrierAndEce` via `reliabilityDiagram` no report. O endpoint HTTP
 * `/api/analytics/calibration/bins` repassa esse subconjunto, então os
 * invariantes aqui cobrem ambos os caminhos (cliente direto do relatório
 * + cliente HTTP dedicado).
 */
describe("B-R — Reliability diagram (bins expostos via getCalibrationReport)", () => {
  it("Caso 1: 1000 records uniformes → 10 bins retornados, todos com count > 0", async () => {
    // Gera 1000 decisões espalhadas uniformemente entre [0,1) com taxa de
    // acerto ~50%. Cada um dos 10 bins deve receber ~100 amostras.
    const N = 1000;
    const rows: DecisionRecord[] = [];
    for (let i = 0; i < N; i++) {
      const probability = i / N; // 0.000, 0.001, ..., 0.999
      // outcome: metade hits, metade misses (intercalados)
      const outcome: "hit" | "miss" = i % 2 === 0 ? "hit" : "miss";
      rows.push(mkRow({ probability, outcome, decision: "BUY" }));
    }
    const rep = await getCalibrationReport(arrayStore(rows));
    expect(rep.reliabilityDiagram).toBeDefined();
    const bins = rep.reliabilityDiagram!.bins;
    expect(bins).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(bins[i]!.count, `bin ${i} deveria ter count > 0`).toBeGreaterThan(0);
    }
    // Total de samples distribuídos deve bater com o universo direcional.
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(N);
  });

  it("Caso 2: bins têm lo < hi dentro de [0,1]", async () => {
    // Sintético pequeno só pra validar bounds; não importa calibração aqui.
    const rows: DecisionRecord[] = [
      mkRow({ probability: 0.1, outcome: "hit" }),
      mkRow({ probability: 0.55, outcome: "miss" }),
      mkRow({ probability: 0.95, outcome: "hit" }),
    ];
    const rep = await getCalibrationReport(arrayStore(rows));
    const bins = rep.reliabilityDiagram!.bins;
    expect(bins).toHaveLength(10);
    bins.forEach((b: ReliabilityBin, i: number) => {
      expect(b.lo).toBeGreaterThanOrEqual(0);
      expect(b.hi).toBeLessThanOrEqual(1);
      expect(b.lo).toBeLessThan(b.hi);
      // Adjacência perfeita entre bins (sem gaps, sem overlap).
      if (i > 0) expect(b.lo).toBeCloseTo(bins[i - 1]!.hi, 12);
    });
    // Primeiro bin começa em 0 e último termina em 1.
    expect(bins[0]!.lo).toBe(0);
    expect(bins[9]!.hi).toBe(1);
  });

  it("Caso 3: ece === reliabilityDiagram.ece (consistência entre endpoints)", async () => {
    // O endpoint /calibration expõe `ece` no topo; /calibration/bins expõe
    // `reliabilityDiagram.ece`. Como ambos derivam do mesmo computeBrierAndEce,
    // devem ser idênticos.
    const rows: DecisionRecord[] = [];
    for (let bin = 0; bin < 10; bin++) {
      const p = (bin + 0.5) / 10;
      const hitsInBin = Math.floor(p * 10);
      for (let k = 0; k < 10; k++) {
        const outcome: "hit" | "miss" = k < hitsInBin ? "hit" : "miss";
        rows.push(mkRow({ probability: p, outcome, decision: "BUY" }));
      }
    }
    const rep = await getCalibrationReport(arrayStore(rows));
    // Bate exato (não aproximado): mesma computação.
    expect(rep.ece).toBe(rep.reliabilityDiagram!.ece);
    // ECE bem calibrado < 0.1 (sanity).
    expect(rep.ece).toBeLessThan(0.1);
    // Bins também são cobertos aqui: cada bin com count > 0.
    expect(rep.reliabilityDiagram!.bins.filter((b) => b.count > 0).length).toBe(10);
  });

  it("Caso 4: store vazio → bins é array de 10 elementos com count=0", async () => {
    const rep = await getCalibrationReport(arrayStore([]));
    expect(rep.reliabilityDiagram).toBeDefined();
    const bins = rep.reliabilityDiagram!.bins;
    expect(bins).toHaveLength(10);
    for (const b of bins) {
      expect(b.count).toBe(0);
      expect(b.predictedMean).toBeNull();
      expect(b.actualMean).toBeNull();
      expect(b.gap).toBe(0);
    }
    // Shape fixo mesmo sem dados: ECE 0.
    expect(rep.ece).toBe(0);
    expect(rep.reliabilityDiagram!.ece).toBe(0);
  });
});
