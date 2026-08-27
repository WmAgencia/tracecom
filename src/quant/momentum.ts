/**
 * Momentum e volatilidade: RSI, momentum, ROC, ATR, Bollinger, volatilidade
 * histórica. Determinísticos; consomem séries planas.
 */
import type { Series, VolatilityResult } from "./types";
import { rsi as rsiFn, atr as atrFn, stdDev, sma as smaFn } from "./math";

export function rsi(values: readonly number[], period: number): Series {
  return rsiFn(values, period);
}

/** Momentum = close[i] - close[i-period]. */
export function momentum(values: readonly number[], period: number): Series {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) out.push(i >= period ? values[i]! - values[i - period]! : null);
  return out;
}

/** ROC % = (close[i]/close[i-period] - 1) * 100. */
export function roc(values: readonly number[], period: number): Series {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const prev = values[i - period];
    out.push(i >= period && prev !== undefined && prev !== 0 ? ((values[i]! / prev) - 1) * 100 : null);
  }
  return out;
}

export function atr(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): Series {
  return atrFn(highs, lows, closes, period);
}

export interface BollingerResult {
  readonly upper: Series;
  readonly middle: Series;
  readonly lower: Series;
}

export function bollinger(values: readonly number[], period: number, numStdDev = 2): BollingerResult {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const mid = slice.reduce((s, v) => s + v, 0) / period;
    const sd = stdDev(slice);
    middle.push(mid);
    upper.push(mid + numStdDev * sd);
    lower.push(mid - numStdDev * sd);
  }
  return { upper, middle, lower };
}

/**
 * Volatilidade histórica (30/period) a partir dos retornos logarítmicos.
 * Gera séries de std dev móvel da janela. `annualization` opcional.
 */
export function volatilitySeries(values: readonly number[], period: number): Series {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev === 0) { returns.push(0); continue; }
    returns.push(Math.log(values[i]! / prev));
  }
  const out: (number | null)[] = [null]; // index 0 sem retorno
  for (let i = 0; i < returns.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    const slice = returns.slice(i - period + 1, i + 1);
    out.push(stdDev(slice));
  }
  return out;
}

/**
 * Resumo de volatilidade para um conjunto de candles: volatilidade da janela,
 * anualizada (assume ~365d), range realizado (ATR/preço) e ATR.
 */
export function summarizeVolatility(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14,
): VolatilityResult {
  const sampleSize = closes.length;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev === 0) continue;
    returns.push(Math.log(closes[i]! / prev));
  }
  const win = Math.min(period, returns.length || 1);
  const used = returns.slice(-win);
  const windowVol = used.length ? stdDev(used) : 0;
  const annualized = windowVol * Math.sqrt(365 * 24 * 6); // ~ padrão de barras por ano para timeframe genérico
  const atrVals = atrFn(highs, lows, closes, period);
  const lastAtr = atrVals[atrVals.length - 1];
  const lastClose = closes[closes.length - 1];
  return {
    windowVolatility: windowVol,
    annualized,
    realizedRange: lastClose ? ((lastAtr ?? 0) / lastClose) : 0,
    sampleSize,
    atr: lastAtr ?? null,
    atrPct: lastClose && lastAtr ? (lastAtr / lastClose) * 100 : null,
  };
}

/** SMA simples reutilizada (para composição). */
export function sma(values: readonly number[], period: number): Series {
  return smaFn(values, period);
}
