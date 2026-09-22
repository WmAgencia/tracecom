/**
 * CONSENSUS CORE — MarketSnapshot imutavel e causal.
 * Um unico snapshot por avaliacao; TODOS os especialistas recebem exatamente este objeto.
 * Indicadores do Feature Engine oficial: RSI Wilder 14, Bollinger 20/2, DMI/ADX 14, ATR 14.
 * Nenhum dado futuro: candles so entram se bucketEnd <= now.
 */
import { evaluateIndicatorsV2 } from "../rsi-skills-v2.mjs";
import { rsiWilder, atrWilder } from "../feature-engine.mjs";

export const CONSENSUS_VERSION = "consensus-core-v1";
const MIN_CLOSED_CANDLES = 60;
// Historico entregue aos agentes: 30 min de candles de 5s (nada alem disso entra no snapshot; nao vai ao banco).
export const RECENT_CANDLES_LIMIT = 360;
// Trajetoria do RSI: 120 amostras = 10 min (leitura de "sobe, segura no extremo, desce").
export const RSI_TRAJECTORY_SAMPLES = 120;
// Mediana do ATR normalizado: 180 amostras = 15 min.
export const ATR_MEDIAN_SAMPLES = 180;

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
  for (let i = period; i < values.length; i += 1) value = values[i] * k + value * (1 - k);
  return value;
}

function emaSeries(values, period, lastN = 3) {
  if (values.length < period + lastN) return [];
  const out = [];
  for (let end = values.length - lastN; end <= values.length; end += 1) out.push(ema(values.slice(0, end), period));
  return out;
}

function stochasticAt(candles, period = 14, dPeriod = 3) {
  if (candles.length < period + dPeriod + 1) return null;
  const series = [];
  for (let end = candles.length - dPeriod; end <= candles.length; end += 1) {
    const window = candles.slice(Math.max(0, end - period), end);
    if (window.length < period) return null;
    const highest = Math.max(...window.map((c) => Number(c.high)));
    const lowest = Math.min(...window.map((c) => Number(c.low)));
    const close = Number(candles[end - 1].close);
    series.push(highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100);
  }
  const k = series[series.length - 1];
  const d = series.slice(-dPeriod).reduce((acc, v) => acc + v, 0) / Math.min(dPeriod, series.length);
  const kLag = series.length >= 4 ? series[series.length - 4] : null;
  return { k: round(k, 4), d: round(d, 4), kLag: kLag === null ? null : round(kLag, 4), kSlope: kLag === null ? null : round(k - kLag, 4) };
}

function swingFibContext(candles, atr) {
  const list = candles.slice(-80);
  const pivot = 3;
  let lastHigh = null; let lastLow = null;
  for (let i = pivot; i < list.length - pivot; i += 1) {
    const window = list.slice(i - pivot, i + pivot + 1);
    const high = Number(list[i].high); const low = Number(list[i].low);
    if (high === Math.max(...window.map((c) => Number(c.high)))) lastHigh = { index: i, price: high, at: Number(list[i].bucketEnd), confirmedAt: Number(list[i + pivot].bucketEnd) };
    if (low === Math.min(...window.map((c) => Number(c.low)))) lastLow = { index: i, price: low, at: Number(list[i].bucketEnd), confirmedAt: Number(list[i + pivot].bucketEnd) };
  }
  if (!lastHigh || !lastLow || lastHigh.index === lastLow.index) return null;
  const bullishLeg = lastLow.index < lastHigh.index;
  const a = bullishLeg ? lastLow : lastHigh;
  const b = bullishLeg ? lastHigh : lastLow;
  const span = b.price - a.price;
  if (!Number.isFinite(span) || span === 0) return null;
  const levels = { "23.6": b.price - span * 0.236, "38.2": b.price - span * 0.382, "50.0": b.price - span * 0.5, "61.8": b.price - span * 0.618 };
  const tolerance = atr && atr > 0 ? round(atr * 0.5, 8) : round(Math.abs(span) * 0.02, 8);
  return {
    direction: bullishLeg ? "BULLISH_LEG" : "BEARISH_LEG",
    anchorA: { price: round(a.price, 8), at: a.at, confirmedAt: a.confirmedAt, type: bullishLeg ? "SWING_LOW" : "SWING_HIGH" },
    anchorB: { price: round(b.price, 8), at: b.at, confirmedAt: b.confirmedAt, type: bullishLeg ? "SWING_HIGH" : "SWING_LOW" },
    levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, round(v, 8)])),
    tolerance, episodeId: `fib:${a.at}:${b.at}`,
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export function buildMarketSnapshot({ marketKey, marketType = null, candles = [], now = Date.now(), payout = null, targetExpiryAt = null, livePrice = null } = {}) {
  const at = num(now) ?? Date.now();
  const list = (Array.isArray(candles) ? candles : []).filter((candle) => Number.isFinite(Number(candle?.close)) && Number.isFinite(Number(candle?.bucketEnd)) && Number(candle.bucketEnd) <= at);
  const indicators = evaluateIndicatorsV2({ candles: list, now: at });
  if (indicators.closedCandles < MIN_CLOSED_CANDLES) return null;

  const recent = list.slice(-RECENT_CANDLES_LIMIT).map((candle) => ({
    bucketStart: num(candle.bucketStart), bucketEnd: num(candle.bucketEnd),
    open: num(candle.open), high: num(candle.high), low: num(candle.low), close: num(candle.close),
  }));
  const closes = list.map((candle) => Number(candle.close));
  const trajectory = [];
  for (let back = RSI_TRAJECTORY_SAMPLES - 1; back >= 0; back -= 1) {
    const slice = closes.slice(0, closes.length - back);
    const value = slice.length > 15 ? rsiWilder(slice, 14) : null;
    trajectory.push(value === null ? null : round(value, 4));
  }
  const atr = atrWilder(list, 14);
  const ema9Series = emaSeries(closes, 9, 3);
  const ema21Series = emaSeries(closes, 21, 3);
  const ema9 = ema9Series.length ? ema9Series[ema9Series.length - 1] : null;
  const ema21 = ema21Series.length ? ema21Series[ema21Series.length - 1] : null;
  const ema9Slope = ema9Series.length >= 2 && ema9Series[0] !== null ? round(ema9Series[ema9Series.length - 1] - ema9Series[0], 8) : null;
  const ema21Slope = ema21Series.length >= 2 && ema21Series[0] !== null ? round(ema21Series[ema21Series.length - 1] - ema21Series[0], 8) : null;
  const macdSeries = [];
  for (let end = closes.length - 3; end <= closes.length; end += 1) {
    const slice = closes.slice(0, end);
    const fast = ema(slice, 12); const slow = ema(slice, 26);
    macdSeries.push(fast === null || slow === null ? null : fast - slow);
  }
  const macdValid = macdSeries.filter((v) => v !== null);
  const macdSignal = macdValid.length >= 9 ? ema(macdValid, 9) : null;
  const macd = macdValid.length ? macdValid[macdValid.length - 1] : null;
  const histogram = macd !== null && macdSignal !== null ? macd - macdSignal : null;
  const histogramLag = macdValid.length >= 4 && macdSignal !== null ? macdValid[macdValid.length - 4] - (ema(macdValid.slice(0, -3), 9) ?? macdSignal) : null;
  const macdPrev = macdValid.length >= 2 ? macdValid[macdValid.length - 2] : null;
  const stoch = stochasticAt(list, 14, 3);
  const swingFib = swingFibContext(list, atr);
  const atrNormalized = atr !== null && closes.length ? atr / closes[closes.length - 1] : null;
  const atrNormSamples = [];
  for (let i = 1; i <= Math.min(ATR_MEDIAN_SAMPLES, list.length - 15); i += 1) { const a = atrWilder(list.slice(0, list.length - i), 14); if (a !== null) atrNormSamples.push(a / Number(list[list.length - i - 1]?.close ?? closes[closes.length - 1])); }
  atrNormSamples.sort((x, y) => x - y);
  const atrNormalizedMedian60 = atrNormSamples.length ? atrNormSamples[Math.floor(atrNormSamples.length / 2)] : null;
  const last = recent[recent.length - 1] ?? null;

  return deepFreeze({
    schema: "consensus-market-snapshot-v1",
    version: CONSENSUS_VERSION,
    snapshotId: `${marketKey}|${last?.bucketEnd ?? "na"}`,
    marketKey, marketType, payout, targetExpiryAt,
    at, bucketEnd: last?.bucketEnd ?? null,
    ohlc: last ? { open: last.open, high: last.high, low: last.low, close: last.close } : null,
    livePrice: num(livePrice) === null ? null : round(num(livePrice), 8),
    recentCandles: recent,
    indicators: {
      rsi: indicators.rsi, rsiPrevious: indicators.rsiPrevious, rsiSlope: indicators.rsiSlope, rsiTrajectory: trajectory,
      bollinger: indicators.bollinger, dmi: indicators.dmi, adx: indicators.adx,
      structuralTrend: indicators.structuralTrend, shortHorizonDirection: indicators.shortHorizonDirection, shortMomentum: indicators.shortMomentum,
      bandRiding: indicators.bandRiding, dominantDI: indicators.dominantDI, strongContinuation: indicators.strongContinuation,
      atr: atr === null ? null : round(atr, 8),
      ema: { fast: ema9 === null ? null : round(ema9, 8), slow: ema21 === null ? null : round(ema21, 8), spread: ema9 !== null && ema21 !== null ? round(ema9 - ema21, 8) : null, fastSlope: ema9Slope, slowSlope: ema21Slope, alignment: ema9 === null || ema21 === null ? null : ema9 > ema21 ? "BULLISH" : ema9 < ema21 ? "BEARISH" : "FLAT" },
      macd: { macd: macd === null ? null : round(macd, 8), signal: macdSignal === null ? null : round(macdSignal, 8), histogram: histogram === null ? null : round(histogram, 8), histogramSlope: histogram !== null && histogramLag !== null ? round(histogram - histogramLag, 8) : null, cross: macd === null || macdSignal === null || macdPrev === null ? null : macd > macdSignal && macdPrev <= macdSignal ? "BULLISH" : macd < macdSignal && macdPrev >= macdSignal ? "BEARISH" : null, aboveSignal: macd !== null && macdSignal !== null ? macd > macdSignal : null, aboveZero: macd !== null ? macd > 0 : null },
      stochastic: stoch,
      fib: swingFib,
      atrNormalized: atrNormalized === null ? null : round(atrNormalized, 10),
      atrNormalizedMedian60: atrNormalizedMedian60 === null ? null : round(atrNormalizedMedian60, 10),
    },
    provenance: {
      producer: "consensus-snapshot", version: CONSENSUS_VERSION, source: "IQ_WS_CANDLES_5S",
      calculatedAt: at, availableAt: last?.bucketEnd ?? null, closedCandles: indicators.closedCandles,
    },
  });
}
