/**
 * QuantEngine — fachada do motor quantitativo da Tracecon.
 *
 * Tudo é determinístico e derivado APENAS dos candles recebidos (o pipeline de
 * mercado já garante que são reais e validados). A IA não controla a matemática;
 * este motor é quem calcula indicadores, volatilidade, regime, estrutura e o
 * `technicalScore` usado na fusão de evidências.
 */
import type { MarketCandle } from "../market/model";
import type { ComputedIndicators, IndicatorConfig, QuantInput, QuantSummary, MarketRegime } from "./types";
import { smaFn } from "./math";
import { macd as macdFn, adx as adxFn } from "./trend";
import { rsi, momentum, roc, atr, bollinger, volatilitySeries, summarizeVolatility } from "./momentum";
import { vwap, levelsFromCandles, marketStructure } from "./structure";
import { detectRegime } from "./regime";

export const DEFAULT_CONFIG: IndicatorConfig = {
  smaPeriod: 20,
  emaPeriod: 20,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  atrPeriod: 14,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  adxPeriod: 14,
};

/** Extrai arrays planos a partir de candles. NUNCA inválidos/NaNs. */
function extract(candles: readonly MarketCandle[]): {
  highs: number[]; lows: number[]; closes: number[]; volumes: number[];
} {
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (const c of candles) {
    highs.push(c.high); lows.push(c.low); closes.push(c.close); volumes.push(c.volume);
  }
  return { highs, lows, closes, volumes };
}

export class QuantEngine {
  constructor(private readonly cfg: IndicatorConfig = DEFAULT_CONFIG) {}

  computeIndicators(candles: readonly MarketCandle[]): ComputedIndicators {
    const { highs, lows, closes } = extract(candles);
    const line = macdFn(closes, this.cfg.macdFast, this.cfg.macdSlow, this.cfg.macdSignal);
    const bb = bollinger(closes, this.cfg.bollingerPeriod, this.cfg.bollingerStdDev);
    return {
      sma: smaFn(closes, this.cfg.smaPeriod),
      ema: smaFn(closes, this.cfg.emaPeriod),
      rsi: rsi(closes, this.cfg.rsiPeriod),
      macd: line,
      atr: atr(highs, lows, closes, this.cfg.atrPeriod),
      bollinger: { upper: bb.upper, middle: bb.middle, lower: bb.lower },
      vwap: vwap(candles),
      adx: adxFn(highs, lows, closes, this.cfg.adxPeriod),
      momentum: momentum(closes, this.cfg.rsiPeriod),
      roc: roc(closes, this.cfg.rsiPeriod),
      volatility: volatilitySeries(closes, this.cfg.rsiPeriod),
      candleCount: candles.length,
    };
  }

  analyze(input: QuantInput): QuantSummary {
    const candles = input.candles;
    const indicators = this.computeIndicators(candles);
    const { highs, lows, closes } = extract(candles);

    const volResult = summarizeVolatility(highs, lows, closes, this.cfg.atrPeriod);

    // Regime
    const adxLast = lastNonNull(indicators.adx);
    const smaVals = indicators.sma;
    const lastSma = lastNonNull(smaVals);
    const lastClose = closes[closes.length - 1] ?? null;
    const slope = closes.length >= 2 ? (closes[closes.length - 1]! - closes[Math.max(0, closes.length - 6)]!) / (closes[Math.max(0, closes.length - 6)] || 1) : 0;
    const adxDir = adxSlope(closes, this.cfg.adxPeriod);
    const volatilityThreshold = 0.005; // ~0.5% por candle (heurística por período)
    const regimeOut = detectRegime({
      adx: adxLast,
      adxDir,
      slope,
      volatilityPct: volResult.windowVolatility,
      volatilityThreshold,
      closeAboveSma: lastClose !== null && lastSma !== null && lastClose > lastSma,
      rsiLast: lastNonNull(indicators.rsi),
    });

    // Estrutura e níveis
    const structure = marketStructure(candles, 3);
    const levels = levelsFromCandles(candles, 5);

    // technicalScore derivado de dados (−1..1)
    const technicalScore = computeTechnicalScore(indicators, structure.trend, lastClose, lastSma);

    return {
      indicators,
      volatility: volResult,
      regime: regimeOut,
      structure,
      levels,
      technicalScore,
      sampleSize: candles.length,
    };
  }

  /** Conveniência: price-only summary para o agente (contexto enxuto). */
  summarize(input: QuantInput): QuantSummary {
    return this.analyze(input);
  }
}

function adxSlope(closes: number[], period: number): number {
  const lookback = period * 2;
  if (closes.length < lookback + 1) return 0;
  const a = closes[closes.length - 1 - lookback]!;
  const b = closes[closes.length - 1]!;
  return b >= a ? 1 : -1;
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null) return v;
  }
  return null;
}

function computeTechnicalScore(
  ind: ComputedIndicators,
  trend: "up" | "down" | "sideways",
  lastClose: number | null,
  lastSma: number | null,
): number {
  let score = 0;
  const rsiLast = lastNonNull(ind.rsi);
  const macdLast = lastNonNull(ind.macd.histogram);
  const bb = ind.bollinger;
  const mid = lastNonNull(bb.middle);

  // RSI
  if (rsiLast !== null) {
    if (rsiLast > 50) score += 0.25;
    if (rsiLast < 50) score -= 0.25;
    // overbought/oversold são neutros (não impulso a favor)
    if (rsiLast < 30) score -= 0.1; // seco, potencial reversão up
    if (rsiLast > 70) score += 0.1;
  }
  // MACD
  if (macdLast !== null) {
    if (macdLast > 0) score += 0.2;
    else score -= 0.2;
  }
  // Preço vs SMA
  if (lastClose !== null && lastSma !== null) {
    score += lastClose > lastSma ? 0.2 : -0.2;
  }
  // Preço vs Bollinger mid
  if (lastClose !== null && mid !== null) {
    score += lastClose > mid ? 0.1 : -0.1;
  }
  // Estrutura
  score += trend === "up" ? 0.15 : trend === "down" ? -0.15 : 0;

  return Math.max(-1, Math.min(1, score));
}

/** Expoe o regime para conveniência. */
export function toRegimeLabel(r: MarketRegime): string {
  return r;
}
