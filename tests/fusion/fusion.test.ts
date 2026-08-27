import { describe, expect, it } from "vitest";
import { FusionEngine } from "../../src/fusion/fusion";
import { assessRisk } from "../../src/fusion/risk";
import type { FusionInput } from "../../src/fusion/types";
import { empiricalProbability } from "../../src/backtest/probability";

function baseInput(overrides: Partial<FusionInput> = {}): FusionInput {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    direction: "up",
    horizon: "12 candles",
    technical: { score: 0.5, regime: "uptrend", structureTrend: "up", rsi: 60, supports: [], resistances: [] },
    probability: empiricalProbability({ favorable: 30, sampleSize: 50, periodStart: 1, periodEnd: 2, similarityCriteria: "w", horizon: "5", methodology: "m", outOfSample: false, baseline: 0.4 }),
    risk: { score: 0.2, level: "low", factors: [], unknown: false },
    context: { newsBias: null, macroBias: null, eventRisk: false },
    dataQuality: "high",
    ...overrides,
  };
}

describe("FusionEngine", () => {
  it("evidências alinhadas + edge positivo → BUY", () => {
    const r = new FusionEngine().fuse(baseInput());
    expect(r.decision).toBe("BUY");
    expect(r.direction).toBe("up");
    expect(r.factors.favorable.length).toBeGreaterThan(0);
  });

  it("técnico contra a direção + prob sem edge → WAIT (contraponto bloqueia)", () => {
    const r = new FusionEngine().fuse(baseInput({
      technical: { score: -0.6, regime: "downtrend", structureTrend: "down", rsi: 40, supports: [], resistances: [] },
      probability: empiricalProbability({ favorable: 22, sampleSize: 50, periodStart: 1, periodEnd: 2, similarityCriteria: "w", horizon: "5", methodology: "m", outOfSample: false, baseline: 0.5 }),
    }));
    expect(r.decision).toBe("WAIT");
    expect(r.blockedByCounterEvidence).toBe(true);
  });

  it("risco alto ⇒ WAIT mesmo com técnico favorável", () => {
    const r = new FusionEngine().fuse(baseInput({ risk: { score: 0.7, level: "high", factors: ["x"], unknown: false } }));
    expect(r.decision).toBe("WAIT");
  });

  it("sem amostra suficiente (prob null) ⇒ dados insuficientes → WAIT", () => {
    const r = new FusionEngine().fuse(baseInput({ probability: null }));
    expect(r.decision).toBe("WAIT");
    expect(r.dataSufficient).toBe(false);
  });

  it("prob empírica menor que baseline → contraprova e sem edge", () => {
    const r = new FusionEngine().fuse(baseInput({
      probability: empiricalProbability({ favorable: 20, sampleSize: 100, periodStart: 1, periodEnd: 2, similarityCriteria: "w", horizon: "5", methodology: "m", outOfSample: false, baseline: 0.6 }),
    }));
    // prob 0.2 << baseline 0.6 → sem edge
    expect(r.factors.counter.some((c) => c.source === "backtest")).toBe(true);
  });

  it("notícias opostas puxam para o contrário", () => {
    const r = new FusionEngine().fuse(baseInput({ context: { newsBias: "down", macroBias: null, eventRisk: false } }));
    expect(r.factors.counter.some((c) => c.source === "context")).toBe(true);
  });
});

describe("assessRisk", () => {
  it("alta volatilidade e evento → risco alto", () => {
    const r = assessRisk({ regime: "high_volatility", annualizedVolatility: 150, atrPct: 3, windowVolatility: 0.02, dataQuality: "high", eventRisk: true, hasHistoricalSupport: true });
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.level).toBe("high");
  });
  it("dados ausentes → unknown", () => {
    const r = assessRisk({ regime: null, annualizedVolatility: null, atrPct: null, windowVolatility: null, dataQuality: "unknown", eventRisk: false, hasHistoricalSupport: false });
    expect(r.unknown).toBe(true);
  });
  it("condições calmas → risco baixo", () => {
    const r = assessRisk({ regime: "range", annualizedVolatility: 20, atrPct: 0.5, windowVolatility: 0.002, dataQuality: "high", eventRisk: false, hasHistoricalSupport: true });
    expect(r.score).toBeLessThan(0.3);
    expect(r.level).toBe("low" );
  });
});
