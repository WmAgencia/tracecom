/**
 * CRYPTO REGIME DETECTOR (CRYPTO_REGIME_V1) — 100% em codigo, zero LLM.
 * Classifica o mercado 24/7 em:
 *   TREND_UP | TREND_DOWN | RANGE | HIGH_VOLATILITY | LOW_VOLATILITY | TRANSITION | NO_TRADE
 * Evidencias: ADX, DMI(+/-), ATR + ATR percentile, EMA slopes (20/50), Bollinger width,
 * estrutura HH/HL/LH/LL, expansao/contracao de volatilidade, momentum.
 */
export const CRYPTO_REGIME_VERSION = "crypto-regime-detector-v1";

export const REGIMES = Object.freeze(["TREND_UP", "TREND_DOWN", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION", "NO_TRADE"]);

export function ema(values, period) {
  const k = 2 / (period + 1);
  let out = [];
  let prev = null;
  for (const v of values) {
    prev = prev === null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

/** ADX + DMI (Wilder). Retorna arrays alinhados ao ultimo candle disponivel. */
export function computeAdxDmi(candles, period = 14) {
  const n = candles.length;
  const plus = new Array(n).fill(0);
  const minus = new Array(n).fill(0);
  const trs = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plus[i] = up > down && up > 0 ? up : 0;
    minus[i] = down > up && down > 0 ? down : 0;
    trs[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
  }
  const smooth = (arr) => {
    let sum = 0;
    for (let i = 1; i <= period; i += 1) sum += arr[i];
    const out = new Array(n).fill(null);
    out[period] = sum;
    for (let i = period + 1; i < n; i += 1) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const trS = smooth(trs);
  const plusS = smooth(plus);
  const minusS = smooth(minus);
  const dx = new Array(n).fill(null);
  const adxRaw = new Array(n).fill(null);
  for (let i = period; i < n; i += 1) {
    const denom = trS[i] || 1;
    const pdi = (100 * plusS[i]) / denom;
    const mdi = (100 * minusS[i]) / denom;
    dx[i] = (100 * Math.abs(pdi - mdi)) / (pdi + mdi || 1);
  }
  for (let i = period * 2 - 1; i < n; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += dx[j] ?? 0;
    adxRaw[i] = sum / period;
  }
  const last = n - 1;
  const trSLast = trS[last] || 1;
  const plusDi = (100 * plusS[last]) / trSLast;
  const minusDi = (100 * minusS[last]) / trSLast;
  return { adx: Number(adxRaw[last]?.toFixed(2)) ?? null, plusDi: Number(plusDi.toFixed(2)), minusDi: Number(minusDi.toFixed(2)), dominance: plusDi >= minusDi ? "PLUS" : "MINUS" };
}

/** ATR (Wilder) + percentile vs a propria serie (janela). */
export function computeAtr(candles, period = 14, window = 100) {
  const n = candles.length;
  const trs = [];
  for (let i = 1; i < n; i += 1) trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  let atr = null;
  let prev = null;
  for (const tr of trs) {
    prev = prev === null ? tr : (prev * (period - 1) + tr) / period;
  }
  atr = prev;
  const recent = trs.slice(Math.max(0, trs.length - window));
  const sorted = recent.slice().sort((a, b) => a - b);
  const lastTr = trs.length ? trs[trs.length - 1] : 0;
  const atrValue = Number(atr ?? 0);
  // percentile da ULTIMA TR contra a janela (responsivo a expansao/contracao recente)
  const percentile = sorted.length ? (sorted.filter((t) => t <= lastTr).length / sorted.length) * 100 : null;
  return { atr: Number(atrValue.toFixed(8)), percentile: Number(percentile?.toFixed(1)) ?? null, expansion: lastTr > atrValue * 1.5, contraction: lastTr < atrValue * 0.5, lastAtr: Number(lastTr.toFixed(8)) };
}

/** Bollinger (20, 2): largura normalizada + posicao. */
export function computeBollinger(candles, period = 20, mult = 2) {
  const closes = candles.map((c) => c.close);
  const mid = sma(closes, period);
  const n = closes.length;
  let width = null;
  let percentB = null;
  const last = n - 1;
  const midLast = mid[last];
  if (midLast !== null && midLast > 0) {
    let sum = 0;
    for (let j = last - period + 1; j <= last; j += 1) sum += (closes[j] - midLast) ** 2;
    const sd = Math.sqrt(sum / period);
    const upper = midLast + mult * sd;
    const lower = midLast - mult * sd;
    width = (upper - lower) / midLast;
    percentB = (closes[last] - lower) / (upper - lower || 1);
  }
  return { width: width === null ? null : Number(width.toFixed(6)), percentB: percentB === null ? null : Number(percentB.toFixed(3)) };
}

export function computeEmaSlopes(candles, fast = 20, slow = 50) {
  const closes = candles.map((c) => c.close);
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const n = closes.length;
  const last = n - 1;
  const fastNow = fastEma[last];
  const slowNow = slowEma[last];
  const fastPrev = fastEma[Math.max(0, last - 5)];
  const slowPrev = slowEma[Math.max(0, last - 5)];
  return {
    fastNow, slowNow,
    fastSlope: fastNow - fastPrev,
    slowSlope: slowNow - slowPrev,
    bullish: fastNow > slowNow && fastNow - fastPrev > 0,
    bearish: fastNow < slowNow && fastNow - slowPrev < 0,
    crossoverBullish: fastPrev <= slowPrev && fastNow > slowNow,
    crossoverBearish: fastPrev >= slowPrev && fastNow < slowNow,
  };
}

/** Estrutura de mercado: HH/HL/LH/LL (swings de 5 candles). */
export function computeStructure(candles, swingWindow = 5) {
  const n = candles.length;
  const highs = [];
  const lows = [];
  for (let i = swingWindow; i < n - swingWindow; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - swingWindow; j <= i + swingWindow; j += 1) {
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ at: candles[i].at, price: candles[i].high });
    if (isLow) lows.push({ at: candles[i].at, price: candles[i].low });
  }
  const lastHighs = highs.slice(-4);
  const lastLows = lows.slice(-4);
  const hh = lastHighs.length >= 2 && lastHighs[lastHighs.length - 1].price > lastHighs[lastHighs.length - 2].price;
  const hl = lastLows.length >= 2 && lastLows[lastLows.length - 1].price > lastLows[lastLows.length - 2].price;
  const lh = lastHighs.length >= 2 && lastHighs[lastHighs.length - 1].price < lastHighs[lastHighs.length - 2].price;
  const ll = lastLows.length >= 2 && lastLows[lastLows.length - 1].price < lastLows[lastLows.length - 2].price;
  const lastHigh = lastHighs.length ? lastHighs[lastHighs.length - 1].price : null;
  const lastLow = lastLows.length ? lastLows[lastLows.length - 1].price : null;
  const recentHigh = lastHighs.length ? Math.max(...lastHighs.map((h) => h.price)) : null;
  const recentLow = lastLows.length ? Math.min(...lastLows.map((l) => l.price)) : null;
  return { hh, hl, lh, ll, lastHigh, lastLow, recentHigh, recentLow, uptrend: hh && hl, downtrend: lh && ll, mixed: (hh || hl) && (lh || ll) };
}

/** RSI (14, Wilder). */
export function computeRsi(candles, period = 14) {
  const n = candles.length;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period && i < n; i += 1) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < n; i += 1) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  const last = candles[n - 1].close;
  const prev = candles[n - 2]?.close ?? last;
  return { rsi: Number(rsi.toFixed(2)), slope: Number((last - prev).toFixed(8)), zone: rsi >= 70 ? "OVERBOUGHT" : rsi <= 30 ? "OVERSOLD" : "NEUTRAL", crossbackUp: rsi > 50, crossbackDown: rsi < 50 };
}

/** Detector de regime final: consolida as evidencias em UM regime por symbol. */
export function detectRegime(candles, { atrHighPct = 90, atrLowPct = 10, adxTrend = 25, adxRange = 20 } = {}) {
  if (!Array.isArray(candles) || candles.length < 60) return { regime: "NO_TRADE", reason: "INSUFFICIENT_DATA", evidence: null };
  const adx = computeAdxDmi(candles);
  const atr = computeAtr(candles);
  const boll = computeBollinger(candles);
  const emas = computeEmaSlopes(candles);
  const structure = computeStructure(candles);
  const rsi = computeRsi(candles);
  const evidence = { adx: adx.adx, plusDi: adx.plusDi, minusDi: adx.minusDi, dominance: adx.dominance, atr: atr.atr, atrPercentile: atr.percentile, atrExpansion: atr.expansion, atrContraction: atr.contraction, bollingerWidth: boll.width, bollingerPercentB: boll.percentB, emaFastSlope: Number(emas.fastSlope?.toFixed(8)) ?? null, emaSlowSlope: Number(emas.slowSlope?.toFixed(8)) ?? null, emaBullish: emas.bullish, emaBearish: emas.bearish, structure: { hh: structure.hh, hl: structure.hl, lh: structure.lh, ll: structure.ll, uptrend: structure.uptrend, downtrend: structure.downtrend, mixed: structure.mixed }, rsi: rsi.rsi, rsiZone: rsi.zone };

  // VOLATILIDADE EXTREMA (sustentada ou em expansao) + estrutura desorganizada => NO_TRADE.
  if (atr.percentile !== null && atr.percentile >= atrHighPct && structure.mixed) {
    return { regime: "NO_TRADE", reason: "HIGH_VOLATILITY_DISORGANIZED", evidence };
  }
  if (atr.percentile !== null && atr.percentile >= atrHighPct) {
    return { regime: "HIGH_VOLATILITY", reason: "VOLATILITY_EXPANSION", evidence };
  }
  if (atr.percentile !== null && atr.percentile <= atrLowPct) {
    return { regime: "LOW_VOLATILITY", reason: "VOLATILITY_CONTRACTION", evidence };
  }
  // TREND: ADX forte + estrutura + EMAs alinhadas.
  const trendUp = adx.adx !== null && adx.adx >= adxTrend && adx.dominance === "PLUS" && (structure.uptrend || emas.bullish) && !structure.mixed;
  const trendDown = adx.adx !== null && adx.adx >= adxTrend && adx.dominance === "MINUS" && (structure.downtrend || emas.bearish) && !structure.mixed;
  if (trendUp) return { regime: "TREND_UP", reason: "ADX_PLUS_STRUCTURE", evidence };
  if (trendDown) return { regime: "TREND_DOWN", reason: "ADX_MINUS_STRUCTURE", evidence };
  // RANGE: ADX fraco + Bollinger estreito.
  if (adx.adx !== null && adx.adx < adxRange && boll.width !== null && boll.width < 0.08) {
    return { regime: "RANGE", reason: "LOW_ADX_NARROW_BOLLINGER", evidence };
  }
  // TRANSICAO: ADX intermediario ou sinais conflitantes.
  if (adx.adx !== null && adx.adx >= adxRange && adx.adx < adxTrend) {
    return { regime: "TRANSITION", reason: "ADX_INTERMEDIATE", evidence };
  }
  return { regime: "NO_TRADE", reason: "INCONCLUSIVE", evidence };
}