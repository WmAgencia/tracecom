/**
 * V3 — DETERMINISTIC MEASUREMENTS (scripts puros; nenhum LLM; nada de futuro).
 *
 * Cada funcao recebe SOMENTE candles ja fechados (o chamador nunca passa o candle em
 * formacao) e devolve medicoes com proveniencia. Pivots so existem depois de confirmados
 * (k candles posteriores), garantindo causalidade: rodar com dados truncados em T produz
 * exatamente o mesmo resultado ate T.
 */
import { rsi, dmiAdx, bollinger } from "../intelligence/features.mjs";
import { computeAtr } from "../intelligence/asset-context.mjs";

export const V3_MEASUREMENTS_VERSION = "v3-measurements-v1";

const round = (value, digits = 4) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const zoneOf = (value) => (value === null ? null : value < 30 ? "OVERSOLD" : value > 70 ? "OVERBOUGHT" : value < 40 ? "LOW" : value > 60 ? "HIGH" : "NEUTRAL");

/** RSI causal em cada candle fechado (mesma matematica do features.mjs). */
export function rsiSeries(candles, period = 14) {
  const closes = candles.map((candle) => candle.close);
  const out = [];
  for (let index = period; index < closes.length; index += 1) out.push(rsi(closes.slice(0, index + 1), period));
  return out;
}

/** Pivots causais: pivot em i confirmado apenas quando existem k candles posteriores. */
export function causalPivots(candles, k = 2) {
  const highs = []; const lows = [];
  for (let index = k; index < candles.length - k; index += 1) {
    const candle = candles[index];
    let isHigh = true; let isLow = true;
    for (let offset = 1; offset <= k; offset += 1) {
      if (!(candle.high > candles[index - offset].high && candle.high > candles[index + offset].high)) isHigh = false;
      if (!(candle.low < candles[index - offset].low && candle.low < candles[index + offset].low)) isLow = false;
    }
    if (isHigh) highs.push({ index, at: candle.at, price: candle.high, confirmedAt: candles[index + k].at });
    if (isLow) lows.push({ index, at: candle.at, price: candle.low, confirmedAt: candles[index + k].at });
  }
  return { highs, lows };
}

export function measureRsiTrajectory(candles, { period = 14, lookback = 6, pivotK = 2 } = {}) {
  const series = rsiSeries(candles, period);
  if (!series.length) return null;
  const value = series[series.length - 1];
  const window = series.slice(-lookback);
  const slope = window.length >= 2 ? round((window[window.length - 1] - window[0]) / (window.length - 1), 3) : null;
  const prevSlope = window.length >= 3 ? round((window[window.length - 2] - window[0]) / (window.length - 2), 3) : null;
  const acceleration = slope !== null && prevSlope !== null ? round(slope - prevSlope, 3) : null;
  const lastCandleIndex = candles.length - 1;
  const crossback = (() => {
    const lastTwo = series.slice(-3);
    for (let index = lastTwo.length - 1; index >= 1; index -= 1) {
      const before = lastTwo[index - 1]; const after = lastTwo[index];
      if (before < 50 && after >= 50) return { direction: "UP", atIndex: lastCandleIndex - (lastTwo.length - 1 - index), from: round(before, 2), to: round(after, 2) };
      if (before > 50 && after <= 50) return { direction: "DOWN", atIndex: lastCandleIndex - (lastTwo.length - 1 - index), from: round(before, 2), to: round(after, 2) };
    }
    return null;
  })();
  const persistence = (() => {
    let count = 0; const side = value >= 50 ? "ABOVE_50" : "BELOW_50";
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if ((series[index] >= 50 ? "ABOVE_50" : "BELOW_50") !== side) break;
      count += 1;
    }
    return { side, candles: count };
  })();
  const pivots = causalPivots(candles, pivotK);
  const rsiAt = (candleIndex) => {
    const seriesIndex = candleIndex - period;
    return seriesIndex >= 0 && seriesIndex < series.length ? series[seriesIndex] : null;
  };
  const divergence = (() => {
    const highs = pivots.highs.slice(-2); const lows = pivots.lows.slice(-2);
    const facts = [];
    if (highs.length === 2) {
      const [first, second] = highs;
      const rsiFirst = rsiAt(first.index); const rsiSecond = rsiAt(second.index);
      if (rsiFirst !== null && rsiSecond !== null) {
        if (second.price > first.price && rsiSecond < rsiFirst) facts.push({ type: "REGULAR_BEARISH", priceFrom: round(first.price), priceTo: round(second.price), rsiFrom: round(rsiFirst, 2), rsiTo: round(rsiSecond, 2) });
        if (second.price < first.price && rsiSecond > rsiFirst) facts.push({ type: "HIDDEN_BEARISH", priceFrom: round(first.price), priceTo: round(second.price), rsiFrom: round(rsiFirst, 2), rsiTo: round(rsiSecond, 2) });
      }
    }
    if (lows.length === 2) {
      const [first, second] = lows;
      const rsiFirst = rsiAt(first.index); const rsiSecond = rsiAt(second.index);
      if (rsiFirst !== null && rsiSecond !== null) {
        if (second.price < first.price && rsiSecond > rsiFirst) facts.push({ type: "REGULAR_BULLISH", priceFrom: round(first.price), priceTo: round(second.price), rsiFrom: round(rsiFirst, 2), rsiTo: round(rsiSecond, 2) });
        if (second.price > first.price && rsiSecond < rsiFirst) facts.push({ type: "HIDDEN_BULLISH", priceFrom: round(first.price), priceTo: round(second.price), rsiFrom: round(rsiFirst, 2), rsiTo: round(rsiSecond, 2) });
      }
    }
    return facts;
  })();
  const failureSwing = (() => {
    // PADRAO COMPLETO (estrito): extremo -> rally -> retrace ALEM do extremo -> recuperacao alem do rally.
    // Recuperacao simples NAO e failure swing (isso e crossback/momentum, tratado separadamente).
    const tail = series.slice(-60);
    const scan = (extremeTest, rallyTest, retraceTest, recoverTest) => {
      for (let e = 0; e < tail.length - 3; e += 1) {
        if (!extremeTest(tail[e])) continue;
        let bounce = -1;
        for (let i = e + 1; i < tail.length - 2; i += 1) { if (rallyTest(tail[i], tail[e])) { bounce = i; break; } }
        if (bounce === -1) continue;
        let retrace = -1;
        for (let i = bounce + 1; i < tail.length - 1; i += 1) { if (retraceTest(tail[i], tail[e])) { retrace = i; break; } }
        if (retrace === -1) continue;
        for (let i = retrace + 1; i < tail.length; i += 1) {
          if (recoverTest(tail[i], tail[e])) return { extreme: round(tail[e], 2), retraceTo: round(Math.min(...tail.slice(e, retrace + 1)), 2), recoverAt: round(tail[i], 2) };
        }
      }
      return null;
    };
    const bear = scan((v) => v >= 70, (v, x) => v < x - 5, (v, x) => v > x + 5, (v, x) => v < x - 5);
    if (bear) return { ...bear, type: "BEARISH_FAILURE_SWING" };
    const bull = scan((v) => v <= 30, (v, x) => v > x + 5, (v, x) => v < x - 5, (v, x) => v > x + 5);
    if (bull) return { ...bull, type: "BULLISH_FAILURE_SWING" };
    return null;
  })();
  return {
    value: round(value, 2), zone: zoneOf(value), slope, acceleration, crossback, persistence, failureSwing,
    momentum: slope === null ? "UNKNOWN" : slope > 0.5 ? "RECOVERING" : slope < -0.5 ? "DETERIORATING" : "FLAT",
    divergence,
    measurements: { period, lookback, series: series.slice(-8).map((item) => round(item, 2)) },
  };
}

export function measureDmiPressure(candles, { period = 14, lookback = 5 } = {}) {
  if (candles.length < period + lookback + 2) return null;
  const current = dmiAdx(candles, period);
  const previous = dmiAdx(candles.slice(0, -lookback), period);
  const spread = current.plusDi !== null && current.minusDi !== null ? round(current.plusDi - current.minusDi, 2) : null;
  const previousSpread = previous.plusDi !== null && previous.minusDi !== null ? round(previous.plusDi - previous.minusDi, 2) : null;
  const adxSlope = current.adx !== null && previous.adx !== null ? round(current.adx - previous.adx, 2) : null;
  const pressureChange = spread !== null && previousSpread !== null ? round(spread - previousSpread, 2) : null;
  return {
    adx: round(current.adx, 2), adxSlope, plusDi: round(current.plusDi, 2), minusDi: round(current.minusDi, 2), spread,
    strength: current.adx === null ? "UNKNOWN" : current.adx >= 25 ? "STRONG" : current.adx >= 20 ? "DEVELOPING" : "WEAK",
    trendState: adxSlope === null ? "UNKNOWN" : adxSlope > 0.5 ? "STRENGTHENING" : adxSlope < -0.5 ? "WEAKENING" : "FLAT",
    dominance: spread === null ? "UNKNOWN" : spread > 3 ? "PLUS" : spread < -3 ? "MINUS" : "BALANCED",
    takeover: previousSpread !== null && spread !== null && Math.sign(spread) !== Math.sign(previousSpread) && Math.abs(spread) > 3 ? (spread > 0 ? "PLUS_TOOK_OVER" : "MINUS_TOOK_OVER") : null,
    pressureChange,
    measurements: { period, lookback, previousAdx: round(previous.adx, 2), previousSpread },
  };
}

export function measureBollingerContext(candles, { period = 20, mult = 2, lookback = 5 } = {}) {
  const closes = candles.map((candle) => candle.close);
  if (closes.length < period + lookback + 1) return null;
  const current = bollinger(closes, period, mult);
  const previous = bollinger(closes.slice(0, -lookback), period, mult);
  const close = closes[closes.length - 1];
  const last = candles[candles.length - 1];
  const bandwidths = [];
  for (let index = period; index <= closes.length; index += 1) bandwidths.push(bollinger(closes.slice(0, index), period, mult)?.bandwidth ?? null);
  const valid = bandwidths.filter((value) => value !== null);
  const bandwidthPercentile = valid.length ? valid.filter((value) => value <= current.bandwidth).length / valid.length : null;
  const midlineSlope = current && previous ? round(current.mid - previous.mid, 5) : null;
  const bandWalk = current ? (close > current.upper ? "ABOVE_UPPER" : close < current.lower ? "BELOW_LOWER" : close > current.mid + (current.upper - current.mid) * 0.75 ? "UPPER_HALF" : close < current.mid - (current.mid - current.lower) * 0.75 ? "LOWER_HALF" : "MID") : null;
  const previousPercentB = previous ? (closes[closes.length - 1 - lookback] - previous.lower) / (previous.upper - previous.lower || 1e-12) : null;
  const reentry = previousPercentB !== null && current ? (previousPercentB > 1 && current.percentB <= 1) || (previousPercentB < 0 && current.percentB >= 0) : false;
  const rejection = current ? (last.high > current.upper && last.close < current.upper) || (last.low < current.lower && last.close > current.lower) : false;
  const expanding = current && previous ? current.bandwidth > previous.bandwidth : null;
  // CONTRATO DE LEITURA: expoe o LADO de cada evento (reentrada/rejeicao) para o interpretador.
  const reentryFromAbove = previousPercentB !== null && current ? previousPercentB > 1 && current.percentB <= 1 : false;
  const reentryFromBelow = previousPercentB !== null && current ? previousPercentB < 0 && current.percentB >= 0 : false;
  const rejectionFromAbove = current ? last.high > current.upper && last.close < current.upper : false;
  const rejectionFromBelow = current ? last.low < current.lower && last.close > current.lower : false;
  return {
    percentB: round(current?.percentB, 3), bandwidth: round(current?.bandwidth, 5), midline: round(current?.mid, 5), midlineSlope,
    bandWalk, reentry, rejection, reentryFromAbove, reentryFromBelow, rejectionFromAbove, rejectionFromBelow,
    expansion: expanding === null ? "UNKNOWN" : expanding ? "EXPANDING" : "CONTRACTING",
    squeeze: bandwidthPercentile !== null && bandwidthPercentile <= 0.2 ? "SQUEEZE" : bandwidthPercentile !== null && bandwidthPercentile >= 0.8 ? "EXPANDED" : "NORMAL",
    measurements: { period, mult, lookback, bandwidthPercentile: round(bandwidthPercentile, 3), previousPercentB: round(previousPercentB, 3) },
  };
}

export function measureAtrContext(candles, { period = 14, shortPeriod = 5, impulseLookback = 10 } = {}) {
  if (candles.length < period + 2) return null;
  const atr = computeAtr(candles, period);
  const atrShort = computeAtr(candles, shortPeriod);
  const last = candles[candles.length - 1];
  const close = last.close;
  const range = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  const wick = range - body;
  const netMove = candles.length > impulseLookback ? close - candles[candles.length - 1 - impulseLookback].close : null;
  const normalizedRange = atr ? round(range / atr, 3) : null;
  const normalizedImpulse = atr && netMove !== null ? round(Math.abs(netMove) / atr, 3) : null;
  const normalizedPullback = (() => {
    if (!atr) return null;
    const window = candles.slice(-impulseLookback - 1);
    const high = Math.max(...window.map((candle) => candle.high));
    const low = Math.min(...window.map((candle) => candle.low));
    const extreme = Math.abs(high - close) < Math.abs(close - low) ? high : low;
    return round(Math.abs(close - extreme) / atr, 3);
  })();
  const volRatio = atr && atrShort ? round(atrShort / atr, 3) : null;
  const regime = volRatio === null ? "UNKNOWN" : volRatio > 1.6 ? "ABNORMAL_EXPANSION" : volRatio > 1.15 ? "VOLATILITY_EXPANSION" : volRatio < 0.7 ? "LOW_INFORMATION_VOLATILITY" : "VOLATILITY_COMPATIBLE";
  return {
    atr: round(atr, 5), atrPct: atr && close ? round(atr / close, 5) : null, volRatio, regime,
    normalizedRange, normalizedImpulse, normalizedPullback,
    wickNormalization: atr ? round(wick / atr, 3) : null,
    assessment: regime === "VOLATILITY_COMPATIBLE" || regime === "VOLATILITY_EXPANSION" ? "VOLATILITY_COMPATIBLE" : regime,
    measurements: { period, shortPeriod, impulseLookback, range: round(range, 5), netMove: round(netMove, 5) },
  };
}

export function measureStructure(candles, { pivotK = 2, zoneLookback = 60 } = {}) {
  if (candles.length < pivotK * 2 + 4) return null;
  const pivots = causalPivots(candles, pivotK);
  const highs = pivots.highs.slice(-4); const lows = pivots.lows.slice(-4);
  const swingLegs = [];
  for (let index = 1; index < highs.length; index += 1) swingLegs.push({ kind: "HIGH", from: highs[index - 1].price, to: highs[index].price, label: highs[index].price > highs[index - 1].price ? "HH" : highs[index].price < highs[index - 1].price ? "LH" : "EQ" });
  for (let index = 1; index < lows.length; index += 1) swingLegs.push({ kind: "LOW", from: lows[index - 1].price, to: lows[index].price, label: lows[index].price > lows[index - 1].price ? "HL" : lows[index].price < lows[index - 1].price ? "LL" : "EQ" });
  const lastHigh = highs[highs.length - 1] ?? null; const lastLow = lows[lows.length - 1] ?? null;
  const priorHigh = highs[highs.length - 2] ?? null; const priorLow = lows[lows.length - 2] ?? null;
  const close = candles[candles.length - 1].close;
  const trend = (() => {
    const hh = lastHigh && priorHigh ? lastHigh.price > priorHigh.price : null;
    const hl = lastLow && priorLow ? lastLow.price > priorLow.price : null;
    const lh = lastHigh && priorHigh ? lastHigh.price < priorHigh.price : null;
    const ll = lastLow && priorLow ? lastLow.price < priorLow.price : null;
    if (hh === true && hl === true) return "UPTREND";
    if (lh === true && ll === true) return "DOWNTREND";
    if ((hh === true && ll === true) || (lh === true && hl === true)) return "TRANSITION";
    return "RANGE";
  })();
  const lastBOS = lastHigh && close > lastHigh.price ? { type: "BULLISH_BOS", level: round(lastHigh.price), at: lastHigh.at } : lastLow && close < lastLow.price ? { type: "BEARISH_BOS", level: round(lastLow.price), at: lastLow.at } : null;
  const lastCHoCH = (() => {
    if (trend === "UPTREND" && lastLow && close < lastLow.price) return { type: "BEARISH_CHOCH", level: round(lastLow.price), at: lastLow.at };
    if (trend === "DOWNTREND" && lastHigh && close > lastHigh.price) return { type: "BULLISH_CHOCH", level: round(lastHigh.price), at: lastHigh.at };
    return null;
  })();
  const window = candles.slice(-zoneLookback);
  const zones = [
    { type: "SUPPORT", kind: "SWING_LOW", price: round(lastLow?.price ?? Math.min(...window.map((candle) => candle.low))) },
    { type: "RESISTANCE", kind: "SWING_HIGH", price: round(lastHigh?.price ?? Math.max(...window.map((candle) => candle.high))) },
  ];
  return {
    trend, swingLegs: swingLegs.slice(-6), lastHigh: lastHigh ? { price: round(lastHigh.price), at: lastHigh.at } : null, lastLow: lastLow ? { price: round(lastLow.price), at: lastLow.at } : null,
    lastBOS, lastCHoCH, zones,
    pivotCount: { highs: pivots.highs.length, lows: pivots.lows.length },
    measurements: { pivotK, zoneLookback, close: round(close) },
  };
}

export function measurePullback(candles, { pivotK = 2, atrPeriod = 14 } = {}) {
  const structure = measureStructure(candles, { pivotK });
  if (!structure || !structure.lastHigh || !structure.lastLow) return null;
  const atr = computeAtr(candles, atrPeriod);
  const close = candles[candles.length - 1].close;
  const trend = structure.trend;
  const depthOf = (distanceAtr) => (distanceAtr === null ? null : distanceAtr <= 0.5 ? "SHALLOW" : distanceAtr <= 1.5 ? "NORMAL" : "DEEP");
  if (trend === "UPTREND") {
    const extreme = structure.lastHigh.price;
    // Preco ACIMA do ultimo topo confirmado e extensao/BOS, nao pullback (retracao exige close < extremo).
    if (close >= extreme) return { active: false, direction: null, depth: "SHALLOW", distanceAtr: 0, referenceExtreme: round(extreme), structureTrend: trend, state: "AT_OR_ABOVE_PRIOR_HIGH" };
    const distanceAtr = atr ? round((extreme - close) / atr, 3) : null;
    const depth = depthOf(distanceAtr);
    return { active: depth !== "SHALLOW", direction: "UP_TREND_PULLBACK", depth, distanceAtr, referenceExtreme: round(extreme), structureTrend: trend };
  }
  if (trend === "DOWNTREND") {
    const extreme = structure.lastLow.price;
    if (close <= extreme) return { active: false, direction: null, depth: "SHALLOW", distanceAtr: 0, referenceExtreme: round(extreme), structureTrend: trend, state: "AT_OR_BELOW_PRIOR_LOW" };
    const distanceAtr = atr ? round((close - extreme) / atr, 3) : null;
    const depth = depthOf(distanceAtr);
    return { active: depth !== "SHALLOW", direction: "DOWN_TREND_PULLBACK", depth, distanceAtr, referenceExtreme: round(extreme), structureTrend: trend };
  }
  return { active: false, direction: null, depth: null, distanceAtr: null, referenceExtreme: null, structureTrend: trend };
}

export function measureZoneDistanceAtr(candles, { pivotK = 2, atrPeriod = 14 } = {}) {
  const structure = measureStructure(candles, { pivotK });
  const atr = computeAtr(candles, atrPeriod);
  if (!structure || !atr) return null;
  const close = candles[candles.length - 1].close;
  return structure.zones.map((zone) => ({ ...zone, distance: round(Math.abs(close - zone.price), 5), distanceAtr: round(Math.abs(close - zone.price) / atr, 3), side: close >= zone.price ? "ABOVE" : "BELOW" }));
}

export function measureImpulse(candles, { lookback = 10, atrPeriod = 14 } = {}) {
  if (candles.length < lookback + 2) return null;
  const atr = computeAtr(candles, atrPeriod);
  const window = candles.slice(-lookback);
  const net = window[window.length - 1].close - window[0].close;
  let sameDirection = 0; let direction = null;
  for (const candle of window) {
    const current = candle.close >= candle.open ? "UP" : "DOWN";
    if (direction === null || direction === current) sameDirection += 1;
    direction = current;
  }
  const lastThree = window.slice(-3);
  const lastLeg = lastThree.map((candle) => Math.abs(candle.close - candle.open));
  const decelerating = lastLeg.length === 3 && lastLeg[2] < lastLeg[1] && lastLeg[1] < lastLeg[0];
  return {
    direction: net >= 0 ? "UP" : "DOWN", netMove: round(net, 5), normalized: atr ? round(Math.abs(net) / atr, 3) : null,
    candles: lookback, consecutiveDirection: sameDirection, decelerating,
    classification: atr && Math.abs(net) / atr >= 1.5 ? "IMPULSE" : atr && Math.abs(net) / atr <= 0.5 ? "COILED" : "BALANCED",
  };
}

export function measureMicroPriceAction(candles, { streakLookback = 5 } = {}) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const range = last.high - last.low || 1e-12;
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  let streak = 0; const side = last.close >= last.open ? "UP" : "DOWN";
  for (let index = candles.length - 1; index >= Math.max(0, candles.length - streakLookback); index -= 1) {
    const candleSide = candles[index].close >= candles[index].open ? "UP" : "DOWN";
    if (candleSide !== side) break;
    streak += 1;
  }
  return {
    bodyRatio: round(Math.abs(last.close - last.open) / range, 3), closeInRange: round((last.close - last.low) / range, 3),
    upperWickRatio: round(upperWick / range, 3), lowerWickRatio: round(lowerWick / range, 3),
    direction: side, streak,
    character: Math.abs(last.close - last.open) / range > 0.6 ? "DECISIVE" : Math.abs(last.close - last.open) / range < 0.25 ? "INDECISIVE" : "MIXED",
  };
}

export function measureBreakoutRetest(candles, { pivotK = 2, lookback = 30 } = {}) {
  if (candles.length < lookback) return null;
  const structure = measureStructure(candles, { pivotK });
  if (!structure?.lastHigh || !structure?.lastLow) return null;
  const recent = candles.slice(-lookback);
  const close = recent[recent.length - 1].close;
  const resistance = structure.lastHigh.price; const support = structure.lastLow.price;
  const closedAbove = recent.filter((candle) => candle.close > resistance).length;
  const closedBelow = recent.filter((candle) => candle.close < support).length;
  const breakout = close > resistance && closedAbove >= 2;
  const breakdown = close < support && closedBelow >= 2;
  const retest = (() => {
    if (!breakout) return false;
    const last = recent[recent.length - 1];
    return last.low <= resistance && last.close > resistance;
  })();
  const failed = (() => {
    const prior = recent.slice(0, -1);
    const brokeAbove = prior.some((candle) => candle.close > resistance);
    const brokeBelow = prior.some((candle) => candle.close < support);
    if (brokeAbove && close < resistance) return { type: "FAILED_BREAKOUT", level: round(resistance) };
    if (brokeBelow && close > support) return { type: "FAILED_BREAKDOWN", level: round(support) };
    return null;
  })();
  return { breakout, breakdown, retest, failed, resistance: round(resistance), support: round(support), measurements: { lookback, closedAbove, closedBelow } };
}

/** Snapshot completo do ciclo: todas as medicoes deterministicas + identidade do candle fechado. */
export function measureAll(candles, { marketKey = null, cycleNumber = null } = {}) {
  if (!Array.isArray(candles) || candles.length < 40) return null;
  const last = candles[candles.length - 1];
  return {
    version: V3_MEASUREMENTS_VERSION,
    marketKey,
    cycleNumber,
    closedCandleAt: last.at,
    closedCandleId: `${marketKey ?? "?"}:${last.at}`,
    closedCandle: { at: last.at, open: round(last.open, 6), high: round(last.high, 6), low: round(last.low, 6), close: round(last.close, 6) },
    rsi: measureRsiTrajectory(candles),
    dmi: measureDmiPressure(candles),
    bollinger: measureBollingerContext(candles),
    atr: measureAtrContext(candles),
    structure: measureStructure(candles),
    pullback: measurePullback(candles),
    zoneDistance: measureZoneDistanceAtr(candles),
    impulse: measureImpulse(candles),
    micro: measureMicroPriceAction(candles),
    breakoutRetest: measureBreakoutRetest(candles),
  };
}
