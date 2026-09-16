/** FROZEN feature layer — paridade 1:1 com o motor auditado (run-all.cjs v2 / gauntlet-compile.cjs).
 *
 * Fonte da verdade: docs/consultas-e-testes/gauntlet/scripts/gauntlet-compile.cjs +
 * docs/consultas-e-testes/iqoption/scripts/run-all.cjs (featuresAt), validada por replay
 * contra sinais persistidos (V1/V2/V3 match exato, 2026-09-16).
 *
 * Regras: estritamente causal (usa somente candles[0..index]); nenhuma feature olha o futuro.
 * NÃO alterar formulas sem revalidar contra os golden tests (tests/strategies/frozen-strategies.test.ts).
 */
export const FROZEN_FEATURE_VERSION = "frozen-features-v1";
export const MIN_FROZEN_INDEX = 30;

export interface FrozenCandle {
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks?: number;
}

export interface FibonacciSnapshot {
  hi: number;
  lo: number;
  range: number;
  firstHighIndex: number;
  firstLowIndex: number;
  upSwing: boolean;
  level382: number;
  level618: number;
  zoneLow: number;
  zoneHigh: number;
  inZone: boolean;
}

export interface FrozenFeatures {
  index: number;
  bucket: number;
  close: number;
  rsi14: number;
  s: number;
  vol12: number;
  r24: number;
  fib: FibonacciSnapshot;
  pivotHighCount: number;
  pivotLowCount: number;
  structureUp: boolean;
  structureDown: boolean;
}

export type FrozenDirection = "BUY" | "SELL";

function cutlerRsi(closes: readonly number[], end: number, period: number): number | null {
  if (end - period < 0) return null;
  let gains = 0;
  let losses = 0;
  for (let k = end - period + 1; k <= end; k += 1) {
    const previous = closes[k - 1];
    const current = closes[k];
    if (previous === undefined || current === undefined) return null;
    const diff = current - previous;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

/**
 * Fibonacci 24-candle window (i-23..i), first-touch hi/lo.
 * upSwing = minimal low ocorreu antes (ou no mesmo candle) da maximal high.
 * inZone = close dentro da retração 38.2%–61.8% medida a partir do topo.
 */
export function computeFibonacciWindow(candles: readonly FrozenCandle[], index: number): FibonacciSnapshot | null {
  const start = index - 23;
  if (start < 0) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = start; j <= index; j += 1) {
    const candle = candles[j];
    if (candle === undefined) return null;
    if (candle.high > hi) hi = candle.high;
    if (candle.low < lo) lo = candle.low;
  }
  // first-touch: primeira ocorrencia do extremo dentro da janela (engine: fh/fl = primeiro indice com high/low == hi/lo)
  let firstHighIndex = -1;
  let firstLowIndex = -1;
  for (let j = start; j <= index; j += 1) {
    const candle = candles[j];
    if (candle === undefined) return null;
    if (firstHighIndex === -1 && candle.high === hi) firstHighIndex = j;
    if (firstLowIndex === -1 && candle.low === lo) firstLowIndex = j;
  }
  const range = hi - lo;
  const level382 = hi - 0.382 * range;
  const level618 = hi - 0.618 * range;
  const zoneLow = Math.min(level382, level618);
  const zoneHigh = Math.max(level382, level618);
  const close = candles[index]?.close ?? NaN;
  const upSwing = firstLowIndex <= firstHighIndex;
  const inZone = range > 0 && close <= zoneHigh && close >= zoneLow;
  return { hi, lo, range, firstHighIndex, firstLowIndex, upSwing, level382, level618, zoneLow, zoneHigh, inZone };
}

/** Fractal 2/2 pivots confirmados com 2 candles de atraso (j <= index-2), janela util de 48. */
export function computePivotStructure(candles: readonly FrozenCandle[], index: number): { pivotHighCount: number; pivotLowCount: number; structureUp: boolean; structureDown: boolean } {
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  const last = index - 2;
  for (let j = 2; j <= last; j += 1) {
    const h = candles[j]?.high;
    const l = candles[j]?.low;
    const hPrev1 = candles[j - 1]?.high;
    const hNext1 = candles[j + 1]?.high;
    const hPrev2 = candles[j - 2]?.high;
    const hNext2 = candles[j + 2]?.high;
    const lPrev1 = candles[j - 1]?.low;
    const lNext1 = candles[j + 1]?.low;
    const lPrev2 = candles[j - 2]?.low;
    const lNext2 = candles[j + 2]?.low;
    if (h === undefined || hPrev1 === undefined || hNext1 === undefined || hPrev2 === undefined || hNext2 === undefined) continue;
    if (l === undefined || lPrev1 === undefined || lNext1 === undefined || lPrev2 === undefined || lNext2 === undefined) continue;
    if (h > hPrev1 && h > hNext1 && h > hPrev2 && h > hNext2) pivotHighs.push(j);
    if (l < lPrev1 && l < lNext1 && l < lPrev2 && l < lNext2) pivotLows.push(j);
  }
  const recentHighs = pivotHighs.filter((j) => j >= index - 47);
  const recentLows = pivotLows.filter((j) => j >= index - 47);
  let structureUp = false;
  let structureDown = false;
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const h2 = candles[recentHighs[recentHighs.length - 1] as number]?.high;
    const h1 = candles[recentHighs[recentHighs.length - 2] as number]?.high;
    const l2 = candles[recentLows[recentLows.length - 1] as number]?.low;
    const l1 = candles[recentLows[recentLows.length - 2] as number]?.low;
    if (h2 !== undefined && h1 !== undefined && l2 !== undefined && l1 !== undefined) {
      if (h2 > h1 && l2 > l1) structureUp = true;
      else if (h2 < h1 && l2 < l1) structureDown = true;
    }
  }
  return { pivotHighCount: recentHighs.length, pivotLowCount: recentLows.length, structureUp, structureDown };
}

/** Snapshot imutavel de features congeladas para um candle (index). null antes do warm-up. */
export function computeFrozenFeatures(candles: readonly FrozenCandle[], index: number): FrozenFeatures | null {
  if (index < MIN_FROZEN_INDEX || index >= candles.length) return null;
  const candle = candles[index];
  if (candle === undefined) return null;
  const closes: number[] = [];
  for (let j = 0; j <= index; j += 1) {
    const c = candles[j]?.close;
    if (c === undefined) return null;
    closes.push(c);
  }
  const rsi14 = cutlerRsi(closes, index, 14);
  if (rsi14 === null) return null;
  const s = (55 - rsi14) / 45;
  const rs12: number[] = [];
  for (let j = index - 11; j <= index; j += 1) {
    const prev = closes[j - 1];
    const cur = closes[j];
    if (prev === undefined || cur === undefined) return null;
    rs12.push((cur - prev) / prev);
  }
  const mean = rs12.reduce((acc, x) => acc + x, 0) / rs12.length;
  const variance = rs12.reduce((acc, x) => acc + (x - mean) ** 2, 0) / rs12.length;
  const vol12 = Math.sqrt(variance);
  const base = closes[index - 24];
  const r24 = base === undefined || base === 0 ? null : (candle.close - base) / base;
  if (r24 === null) return null;
  const fib = computeFibonacciWindow(candles, index);
  if (fib === null) return null;
  const structure = computePivotStructure(candles, index);
  return {
    index,
    bucket: candle.bucket,
    close: candle.close,
    rsi14,
    s,
    vol12,
    r24,
    fib,
    pivotHighCount: structure.pivotHighCount,
    pivotLowCount: structure.pivotLowCount,
    structureUp: structure.structureUp,
    structureDown: structure.structureDown,
  };
}

/** fibOk exato: inZone && swing alinhado a direcao. */
export function fibOk(features: FrozenFeatures, direction: FrozenDirection): boolean {
  if (!features.fib.inZone) return false;
  return direction === "BUY" ? features.fib.upSwing : !features.fib.upSwing;
}
