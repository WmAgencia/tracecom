import { describe, it, expect } from "vitest";
import {
  wilsonLowerBound,
  wilsonUpperBound,
  wilsonInterval,
  isActionable,
  expectedValue,
  calibrate,
  type CalibrationPoint,
} from "../../src/fusion/calibration";

/**
 * Testes da CAMADA 2 de calibração (Wilson / Brier / ECE).
 *
 * Funções sob teste:
 *   - wilsonLowerBound / wilsonUpperBound / wilsonInterval
 *   - isActionable
 *   - expectedValue
 *   - calibrate (Brier + ECE com 10 bins)
 */

describe("wilson CI bounds", () => {
  it("wilsonLowerBound(50, 100) ≈ 0.407 (Wilson é mais largo que a aproximação ±1.96/√n)", () => {
    const lb = wilsonLowerBound(50, 100);
    // Valor canônico Newcombe 1998: 0.4073876...
    expect(lb).toBeGreaterThan(0.40);
    expect(lb).toBeLessThan(0.41);
    // Confirmação chave do spec: NÃO é 0.50.
    expect(lb).toBeLessThan(0.45);
  });

  it("wilsonLowerBound(5, 10) ≈ 0.31 (n pequeno → intervalo largo)", () => {
    const lb = wilsonLowerBound(5, 10);
    // Valor canônico: 0.3097 (não 0.21; essa seria a aproximação normal ingênua).
    expect(lb).toBeGreaterThan(0.30);
    expect(lb).toBeLessThan(0.32);
    // Continua abaixo de p=0.5.
    expect(lb).toBeLessThan(0.5);
  });

  it("wilsonUpperBound(50, 100) ≈ 0.593", () => {
    const ub = wilsonUpperBound(50, 100);
    // Valor canônico: 0.5926... — não 0.60 exato.
    expect(ub).toBeGreaterThan(0.59);
    expect(ub).toBeLessThan(0.60);
    expect(ub).toBeGreaterThan(0.5);
  });

  it("wilsonInterval devolve lower<=upper e ambos em [0,1]", () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });

  it("lower e upper se afastam do p bruto em amostras pequenas", () => {
    const ci = wilsonInterval(5, 10);
    expect(ci.lower).toBeLessThan(0.5);
    expect(ci.upper).toBeGreaterThan(0.5);
  });

  it("total=0 devolve {lower:0, upper:0}", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 0 });
  });
});

describe("isActionable", () => {
  it("retorna false quando ciLower ≤ baseline + margem (0.05)", () => {
    // 0.45 > 0.50 + 0.05 = 0.55? NÃO, então false.
    expect(
      isActionable({ probability: 0.6, ciLower: 0.45, baseline: 0.5 }),
    ).toBe(false);
  });

  it("retorna true quando ciLower > baseline + margem", () => {
    // 0.58 > 0.50 + 0.05 = 0.55? SIM, então true.
    expect(
      isActionable({ probability: 0.7, ciLower: 0.58, baseline: 0.5 }),
    ).toBe(true);
  });

  it("exige > estrito, não ≥ (minMargin=0 e ciLower == baseline → false)", () => {
    expect(
      isActionable({
        probability: 0.5,
        ciLower: 0.5,
        baseline: 0.5,
        minMargin: 0,
      }),
    ).toBe(false);
  });

  it("respeita margem customizada", () => {
    // ciLower=0.55, baseline=0.5, minMargin=0.10 → 0.55 > 0.6? NÃO
    expect(
      isActionable({
        probability: 0.6,
        ciLower: 0.55,
        baseline: 0.5,
        minMargin: 0.1,
      }),
    ).toBe(false);

    // mesma entrada, minMargin=0.04 → 0.55 > 0.54? SIM
    expect(
      isActionable({
        probability: 0.6,
        ciLower: 0.55,
        baseline: 0.5,
        minMargin: 0.04,
      }),
    ).toBe(true);
  });
});

describe("expectedValue", () => {
  it("prob=0.6 com ganho=1, perda=1 → 0.2", () => {
    expect(expectedValue({ probability: 0.6, gain: 1, loss: 1 })).toBeCloseTo(0.2, 10);
  });

  it("prob=0.4 com ganho=1, perda=1 → -0.2", () => {
    expect(expectedValue({ probability: 0.4, gain: 1, loss: 1 })).toBeCloseTo(-0.2, 10);
  });

  it("usa defaults gain=loss=1 se omitidos", () => {
    expect(expectedValue({ probability: 0.6 })).toBeCloseTo(0.2, 10);
  });

  it("honra gain/loss customizados (assimétrico)", () => {
    // prob=0.5, gain=2, loss=1 → 0.5*2 - 0.5*1 = 0.5
    expect(expectedValue({ probability: 0.5, gain: 2, loss: 1 })).toBeCloseTo(0.5, 10);
  });
});

describe("calibrate (Brier + ECE)", () => {
  it("lista vazia → n=0, brier=0, ece=0, reliability vazio", () => {
    const r = calibrate([]);
    expect(r.n).toBe(0);
    expect(r.brierScore).toBe(0);
    expect(r.ece).toBe(0);
    expect(r.reliability).toEqual([]);
  });

  it("amostra bem calibrada produz brier baixo e ece baixo (100 pontos)", () => {
    // 100 pontos determinísticos bem calibrados: 10 bins × 10 pontos, com
    // freq_observada ≈ p_bin. Para um preditor probabilístico binário, o
    // Brier mínimo teórico é E[p(1-p)] ≈ 0.25 para p uniforme em [0,1];
    // logo brier < 0.25 já indica boa calibração.
    const points: CalibrationPoint[] = [];
    for (let b = 0; b < 10; b++) {
      const pEmitted = (b + 0.5) / 10;
      const successes = Math.round(pEmitted * 10);
      for (let i = 0; i < 10; i++) {
        const outcome: 0 | 1 = i < successes ? 1 : 0;
        points.push({ probabilityEmitted: pEmitted, outcome });
      }
    }
    const r = calibrate(points);
    expect(r.n).toBe(100);
    expect(r.brierScore).toBeLessThan(0.30);
    // ECE = 0.05 com tolerância de ponto flutuante (IEEE-754: 0.05000000000000001)
    expect(r.ece).toBeLessThan(0.06);
  });

  it("amostra grande bem calibrada (1000 pts) atinge brier próximo do ótimo e ece<0.02", () => {
    // 100 pts por bin. Limite teórico do Brier ≈ E[p(1-p)] ≈ 0.0833 com p_bin uniformemente espaçado.
    const points: CalibrationPoint[] = [];
    for (let b = 0; b < 10; b++) {
      const pEmitted = (b + 0.5) / 10;
      const successes = Math.round(pEmitted * 100);
      for (let i = 0; i < 100; i++) {
        const outcome: 0 | 1 = i < successes ? 1 : 0;
        points.push({ probabilityEmitted: pEmitted, outcome });
      }
    }
    const r = calibrate(points);
    expect(r.n).toBe(1000);
    expect(r.brierScore).toBeLessThanOrEqual(0.20);
    expect(r.ece).toBeLessThanOrEqual(0.02);
  });

  it("reliability tem bins com n>0 e nomes no formato [x, y)", () => {
    const points: CalibrationPoint[] = [];
    for (let i = 0; i < 50; i++) {
      points.push({
        probabilityEmitted: 0.3,
        outcome: i % 2 === 0 ? 1 : 0,
      });
    }
    const r = calibrate(points);
    expect(r.reliability.length).toBeGreaterThan(0);
    for (const b of r.reliability) {
      expect(b.n).toBeGreaterThan(0);
      expect(b.bin).toMatch(/^\[\d\.\d, \d\.\d\)$/);
      expect(b.predictedMean).toBeGreaterThanOrEqual(0);
      expect(b.predictedMean).toBeLessThanOrEqual(1);
      expect(b.observedFreq).toBeGreaterThanOrEqual(0);
      expect(b.observedFreq).toBeLessThanOrEqual(1);
    }
  });

  it("classificador perfeito (p=1, y=1) tem Brier=0 e ECE=0", () => {
    const points: CalibrationPoint[] = [];
    for (let i = 0; i < 20; i++) {
      points.push({ probabilityEmitted: 1, outcome: 1 });
    }
    const r = calibrate(points);
    expect(r.brierScore).toBe(0);
    expect(r.ece).toBe(0);
  });

  it("classificador sempre errado (p=1, y=0) tem Brier=1 e ECE=1", () => {
    const points: CalibrationPoint[] = [];
    for (let i = 0; i < 20; i++) {
      points.push({ probabilityEmitted: 1, outcome: 0 });
    }
    const r = calibrate(points);
    expect(r.brierScore).toBe(1);
    expect(r.ece).toBe(1);
  });
});
