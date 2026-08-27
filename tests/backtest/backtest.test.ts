import { describe, expect, it } from "vitest";
import { empiricalProbability, wilsonInterval, agrestiCoullInterval, evaluateOutcome } from "../../src/backtest/probability";
import { QuantFeatureExtractor, similarityBetween, findSimilar, buildVector } from "../../src/backtest/similarity";
import { Backtester, DEFAULT_CRITERIA } from "../../src/backtest/backtest";
import type { MarketCandle, Timeframe } from "../../src/market/model";
import type { SimilarityCriteria, CandleHistorySource, SetupTarget } from "../../src/backtest/types";

function mk(ts: number, close: number, o?: number, h?: number, l?: number, v = 100): MarketCandle {
  return {
    provider: "test", symbol: "BTCUSDT", timeframe: "1m",
    open: o ?? close, high: h ?? close + 1, low: l ?? close - 1, close, volume: v,
    timestamp: ts, receivedAt: ts + 1, isClosed: true, source: "test", quality: "high",
  };
}

/** Série sintética com reaparecimento de padrões (det. para similaridade). */
function series(count: number, start = 100): MarketCandle[] {
  const out: MarketCandle[] = [];
  let t = Date.parse("2023-01-01T00:00:00Z");
  let price = start;
  const pattern = [1, 0.5, -0.2, -0.4, 0.9, 1.2, 0.3, -0.1, -0.5, 0.6]; // drift
  for (let i = 0; i < count; i++) {
    price += pattern[i % pattern.length]!;
    out.push(mk(t, price));
    t += 60_000;
  }
  return out;
}

describe("EmpiricalProbability", () => {
  it("prob = favoráveis/amostra, com CI Wilson", () => {
    const p = empiricalProbability({ favorable: 1850, sampleSize: 3000, periodStart: 1, periodEnd: 2, similarityCriteria: "w", horizon: "5", methodology: "m", outOfSample: false });
    expect(p.probability).toBeCloseTo(0.6167, 3);
    expect(p.sampleSize).toBe(3000);
    expect(p.confidenceInterval!.lower).toBeLessThan(p.confidenceInterval!.upper);
  });

  it("sem amostra → probabilidade 0 e CI null (nunca inventa)", () => {
    const p = empiricalProbability({ favorable: 0, sampleSize: 0, periodStart: 0, periodEnd: 0, similarityCriteria: "w", horizon: "h", methodology: "m", outOfSample: false });
    expect(p.probability).toBe(0);
    expect(p.confidenceInterval).toBeNull();
  });

  it("baseline é registrado e não interfere na prob.", () => {
    const p = empiricalProbability({ favorable: 10, sampleSize: 20, periodStart: 0, periodEnd: 0, similarityCriteria: "w", horizon: "h", methodology: "m", outOfSample: true, baseline: 0.3 });
    expect(p.baseline).toBe(0.3);
    expect(p.probability).toBe(0.5);
  });
});

describe("Intervalos de confiança", () => {
  it("Wilson e Agresti-Coull cobrem o valor pontual", () => {
    const w = wilsonInterval(15, 100);
    const ac = agrestiCoullInterval(15, 100);
    for (const ci of [w, ac]) {
      expect(ci.lower).toBeLessThan(0.15);
      expect(ci.upper).toBeGreaterThan(0.15);
    }
    expect(w.method).toBe("wilson");
  });
});

describe("evaluateOutcome", () => {
  it("up e movimento maior que minMovePct → hit", () => {
    const c = [mk(0, 100), mk(60_000, 101), mk(120_000, 103)];
    expect(evaluateOutcome(c, 0, { direction: "up", horizon: 2, minMovePct: 1 })).toBe("hit");
  });
  it("down esperado mas subiu → miss", () => {
    const c = [mk(0, 100), mk(60_000, 101), mk(120_000, 103)];
    expect(evaluateOutcome(c, 0, { direction: "down", horizon: 2, minMovePct: 1 })).toBe("miss");
  });
  it("variação abaixo de minMovePct → flat", () => {
    const c = [mk(0, 100), mk(60_000, 100.2), mk(120_000, 100.3)];
    expect(evaluateOutcome(c, 0, { direction: "up", horizon: 2, minMovePct: 1 })).toBe("flat");
  });
});

describe("Similarity", () => {
  it("similaridade de vetores idênticos = 1", () => {
    const a = { rsi: 55, pctFromSma: 0.02, slope: 1, atrPct: 0.004, volatility: 0.003, macdHistNorm: 0.5 };
    const sim = similarityBetween(a, a, DEFAULT_CRITERIA);
    expect(sim).toBeGreaterThanOrEqual(0.99);
  });
  it("vetores muito diferentes → similaridade baixa", () => {
    const a = { rsi: 60, pctFromSma: 0.0, slope: 0, atrPct: 0.004, volatility: 0.003, macdHistNorm: 0 };
    const b = { rsi: 20, pctFromSma: -0.05, slope: -5, atrPct: 0.01, volatility: 0.02, macdHistNorm: -2 };
    expect(similarityBetween(a, b, DEFAULT_CRITERIA)).toBeLessThan(0.6);
  });
  it("findSimilar não usa o alvo nem futuro (causal)", () => {
    const candles = series(200);
    const extractor = new QuantFeatureExtractor();
    const queryIdx = candles.length - 1;
    const q = buildVector(candles, extractor, queryIdx);
    const { matches } = findSimilar(q, candles, extractor, { ...DEFAULT_CRITERIA, similarityThreshold: 0.7 });
    for (const m of matches) expect(m.timestamp).toBeLessThan(candles[queryIdx]!.timestamp);
  });
});

describe("Backtester (determinismo + OOS + sem look-ahead)", () => {
  const target: SetupTarget = { direction: "up", horizon: 5, minMovePct: 0.5 };
  function source(candles: MarketCandle[]): CandleHistorySource {
    return { getCandles: async () => candles };
  }

  it("run produz métricas determinísticas para a mesma entrada", async () => {
    const candles = series(400);
    const bt = new Backtester();
    const a = await bt.run({ symbol: "BTCUSDT", timeframe: "1m", target, source: source(candles), oosRatio: 0.25 });
    const b = await bt.run({ symbol: "BTCUSDT", timeframe: "1m", target, source: source(candles), oosRatio: 0.25 });
    expect(a.metrics.winRate).toBeCloseTo(b.metrics.winRate, 10);
    expect(a.steps.length).toBe(b.steps.length);
  });

  it("split OOS: métricas out-of-sample computadas separadamente", async () => {
    const candles = series(500);
    const bt = new Backtester();
    const r = await bt.run({ symbol: "BTCUSDT", timeframe: "1m", target, source: source(candles), oosRatio: 0.25 });
    expect(r.split.oosRatio).toBe(0.25);
    expect(r.split.oosStartTime).toBeGreaterThan(candles[0]!.timestamp);
    expect(r.outOfSampleMetrics.totalTrades).toBeGreaterThanOrEqual(0);
  });

  it("probabilityForSetup deriva favoráveis/amostra sem inventar", async () => {
    const candles = series(300);
    const bt = new Backtester();
    const prob = await bt.probabilityForSetup({ candles, queryIndex: candles.length - 1, target, criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.7 }, oosRatio: 0.25 });
    expect(prob.sampleSize).toBeGreaterThan(0);
    expect(prob.probability).toBeGreaterThanOrEqual(0);
    expect(prob.probability).toBeLessThanOrEqual(1);
    expect(prob.favorable).toBeLessThanOrEqual(prob.sampleSize);
  });
});
