/**
 * T0 ENRIQUECIDO — snapshot canonico point-in-time por marketKey (V4).
 *
 * Corrige a perda de plumbing diagnosticada na V3 (docs/research/v3-wait-diagnosis.md):
 * velocity/acceleration, swings, HH/HL/LH/LL, BOS, suporte/resistencia, range, multi-timeframe,
 * ticks e microestrutura de feed real chegam ao motor de agentes com proveniencia auditavel.
 *
 * Regras inviolaveis:
 *  - availableAt do snapshot = max(insumos reais) <= decisionAt (nunca futuro);
 *  - candle nao fechado NUNCA aparece como fechado (vai em `forming`, nunca em `closed`);
 *  - 1m/5m sao DERIVADOS de candles 5s causais (nenhum feed extra e inventado);
 *  - nao decide, nao envia ordem, nao altera G2/JIT/Quality Gate/Execution Gate;
 *  - OTC nao inventa order book/volume institucional: microestrutura usa somente ticks reais do feed.
 */
import { FEATURE_ENGINE_VERSION } from "../feature-engine.mjs";
import { STRUCTURE_VERSION, classifyStructure } from "../price-structure.mjs";
import { provenanceEntry } from "./feature-provenance.mjs";

export const T0_ENRICHED_VERSION = "t0-enriched-v1";
export const T0_ENRICHED_SCHEMA = "tracecom-t0-enriched";

export const TIMEFRAMES = Object.freeze({ entry: 5_000, structure: 60_000, context: 300_000 });

export const STRUCTURE_MIN_CANDLES = 5;
export const CONTEXT_MIN_CANDLES = 2;
export const REALIZED_VOL_WINDOW = 20;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_MULTIPLIER = 2;
export const STALE_FEATURE_MS = 20_000;

const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round = (value, digits = 6) => (value === null || value === undefined ? null : Number(Number(value).toFixed(digits)));

function stdev(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function linearSlope(values) {
  const list = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (list.length < 2) return null;
  const n = list.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = list.reduce((sum, value) => sum + value, 0);
  const sumXY = list.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  return (n * sumXY - sumX * sumY) / denominator;
}

export function normalizeCandleList(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .filter((candle) => candle && Number.isFinite(Number(candle.bucketStart)) && [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(Number(value))))
    .map((candle) => ({
      bucketStart: Number(candle.bucketStart),
      bucketEnd: Number(candle.bucketEnd ?? Number(candle.bucketStart) + TIMEFRAMES.entry),
      open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close),
      receivedAt: num(candle.receivedAt), serverTimestamp: num(candle.serverTimestamp),
      volume: num(candle.volume), marketKey: candle.marketKey ?? null, source: candle.source ?? "CANDLE_5S",
    }))
    .sort((a, b) => a.bucketStart - b.bucketStart);
}

/** Separa candles 5s fechados (bucketEnd <= asOfMs) do candle em formacao. NUNCA promove forming a closed. */
export function splitClosedCandles(candles, asOfMs) {
  const closed = [];
  let forming = null;
  for (const candle of normalizeCandleList(candles)) {
    if (candle.bucketEnd <= asOfMs) closed.push(candle);
    else if (!forming || candle.bucketStart > forming.bucketStart) forming = candle;
  }
  return { closed, forming };
}

/** Agrega candles 5s em timeframe maior; apenas buckets COMPLETOS ate asOfMs entram em `closed`. */
export function aggregateCandles(candles, tfMs, asOfMs) {
  if (!Number.isFinite(tfMs) || tfMs <= 0) return { closed: [], forming: null, count: 0 };
  const buckets = new Map();
  for (const candle of normalizeCandleList(candles)) {
    const bucketStart = Math.floor(candle.bucketStart / tfMs) * tfMs;
    const current = buckets.get(bucketStart);
    if (!current) {
      buckets.set(bucketStart, {
        bucketStart, bucketEnd: bucketStart + tfMs,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        sourceCandles: 1, lastReceivedAt: candle.receivedAt,
      });
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.sourceCandles += 1;
      current.lastReceivedAt = Math.max(current.lastReceivedAt ?? 0, candle.receivedAt ?? 0);
    }
  }
  const closed = [];
  let forming = null;
  for (const bucket of [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart)) {
    if (bucket.bucketEnd <= asOfMs) closed.push(bucket);
    else if (!forming || bucket.bucketStart > forming.bucketStart) forming = bucket;
  }
  return { closed, forming, count: closed.length };
}

function candleAnatomy(candle) {
  if (!candle) return null;
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = range > 0 ? candle.high - Math.max(candle.open, candle.close) : 0;
  const lowerWick = range > 0 ? Math.min(candle.open, candle.close) - candle.low : 0;
  return {
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    range: round(range), body: round(body),
    bodyRatio: range > 0 ? round(body / range, 4) : 0,
    upperWick: range > 0 ? round(upperWick / range, 4) : 0,
    lowerWick: range > 0 ? round(lowerWick / range, 4) : 0,
    closeLocation: range > 0 ? round((candle.close - candle.low) / range, 4) : 0.5,
    direction: candle.close > candle.open ? "UP" : candle.close < candle.open ? "DOWN" : "FLAT",
  };
}

export function tickMicrostructure(ticks = [], { now = null } = {}) {
  const list = (Array.isArray(ticks) ? ticks : [])
    .filter((tick) => tick && Number.isFinite(Number(tick.price)) && Number.isFinite(Number(tick.at ?? tick.receivedAt)))
    .map((tick) => ({ price: Number(tick.price), at: Number(tick.at ?? tick.receivedAt), receivedAt: num(tick.receivedAt) ?? Number(tick.at ?? tick.receivedAt), source: tick.source ?? "FEED_TICK" }))
    .sort((a, b) => a.at - b.at);
  if (!list.length) {
    return { available: false, count: 0, windowMs: 0, direction: null, pressure: null, velocity: null, acceleration: null, arrivalRatePerSec: null, directionChanges: null, bursts: null, shortTermVol: null, avgAbsDelta: null, last: null, first: null };
  }
  const deltas = [];
  let up = 0, down = 0, flat = 0, directionChanges = 0, previousSign = 0;
  for (let index = 1; index < list.length; index += 1) {
    const delta = list[index].price - list[index - 1].price;
    deltas.push(delta);
    const sign = Math.sign(delta);
    if (sign > 0) up += 1; else if (sign < 0) down += 1; else flat += 1;
    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) directionChanges += 1;
    if (sign !== 0) previousSign = sign;
  }
  const meanAbsDelta = deltas.length ? deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length : null;
  const bursts = meanAbsDelta && meanAbsDelta > 0 ? deltas.filter((delta) => Math.abs(delta) > 1.5 * meanAbsDelta).length : 0;
  const windowMs = Math.max(1, list[list.length - 1].at - list[0].at);
  const last = list[list.length - 1];
  const first = list[0];
  const recent = list.slice(-6);
  const recentVelocity = recent.length >= 3 ? (recent[recent.length - 1].price - recent[0].price) / Math.max(1, recent[recent.length - 1].at - recent[0].at) : null;
  const prior = list.slice(-12, -6);
  const priorVelocity = prior.length >= 3 ? (prior[prior.length - 1].price - prior[0].price) / Math.max(1, prior[prior.length - 1].at - prior[0].at) : null;
  const reference = num(now) ?? last.at;
  const ageMs = Math.max(0, reference - (last.receivedAt ?? last.at));
  return {
    available: true, count: list.length, windowMs,
    direction: up > down ? "UP" : down > up ? "DOWN" : "FLAT",
    pressure: up + down + flat > 0 ? round((up - down) / (up + down + flat), 4) : null,
    velocity: round(recentVelocity, 8),
    acceleration: recentVelocity !== null && priorVelocity !== null ? round(recentVelocity - priorVelocity, 8) : null,
    arrivalRatePerSec: round((list.length / windowMs) * 1_000, 4),
    directionChanges, bursts,
    shortTermVol: round(stdev(deltas), 8),
    avgAbsDelta: round(meanAbsDelta, 8),
    upTicks: up, downTicks: down, flatTicks: flat,
    last: { price: last.price, at: last.at, receivedAt: last.receivedAt, ageMs },
    first: { price: first.price, at: first.at },
  };
}

export function swingStructure(structureFeatures = null) {
  const structure = structureFeatures?.structure ?? null;
  const swings = Array.isArray(structure?.swings) ? structure.swings : (Array.isArray(structureFeatures?.swings) ? structureFeatures.swings : []);
  const highs = swings.filter((swing) => swing?.type === "HIGH");
  const lows = swings.filter((swing) => swing?.type === "LOW");
  const lastHigh = highs[highs.length - 1] ?? null;
  const previousHigh = highs[highs.length - 2] ?? null;
  const lastLow = lows[lows.length - 1] ?? null;
  const previousLow = lows[lows.length - 2] ?? null;
  return {
    label: structure?.label ?? null,
    detail: structure?.detail ?? null,
    swings: swings.slice(-8).map((swing) => ({ type: swing.type, price: num(swing.price), bucketStart: num(swing.bucketStart) })),
    higherHigh: lastHigh && previousHigh ? lastHigh.price > previousHigh.price : null,
    lowerHigh: lastHigh && previousHigh ? lastHigh.price < previousHigh.price : null,
    higherLow: lastLow && previousLow ? lastLow.price > previousLow.price : null,
    lowerLow: lastLow && previousLow ? lastLow.price < previousLow.price : null,
    lastHigh: lastHigh ? { price: num(lastHigh.price), bucketStart: num(lastHigh.bucketStart) } : null,
    lastLow: lastLow ? { price: num(lastLow.price), bucketStart: num(lastLow.bucketStart) } : null,
    lastSwingType: swings.length ? swings[swings.length - 1].type : null,
  };
}

export function breakOfStructure({ closedCandles = [], swings = [], atr = null, lookback = 3 } = {}) {
  const list = closedCandles.slice(-Math.max(1, lookback));
  const lastHigh = [...swings].reverse().find((swing) => swing?.type === "HIGH") ?? null;
  const lastLow = [...swings].reverse().find((swing) => swing?.type === "LOW") ?? null;
  const buffer = atr ? 0.05 * atr : 0;
  let up = false, down = false;
  for (const candle of list) {
    if (lastHigh && candle.close > lastHigh.price + buffer) up = true;
    if (lastLow && candle.close < lastLow.price - buffer) down = true;
  }
  return {
    up, down,
    type: up && !down ? "BOS_UP" : down && !up ? "BOS_DOWN" : up && down ? "BOS_BOTH" : "NONE",
    level: up ? num(lastHigh?.price) : down ? num(lastLow?.price) : null,
    lookback,
  };
}

export function nearestLevels({ price = null, swings = [], donchian = null, atr = null } = {}) {
  const current = num(price);
  if (current === null) return { resistance: null, support: null, distanceToResistanceATR: null, distanceToSupportATR: null, source: "INSUFFICIENT_DATA" };
  const swingHighs = swings.filter((swing) => swing?.type === "HIGH" && Number.isFinite(Number(swing.price))).map((swing) => Number(swing.price));
  const swingLows = swings.filter((swing) => swing?.type === "LOW" && Number.isFinite(Number(swing.price))).map((swing) => Number(swing.price));
  const above = swingHighs.filter((level) => level > current).sort((a, b) => a - b);
  const below = swingLows.filter((level) => level < current).sort((a, b) => b - a);
  const resistance = above[0] ?? (Number.isFinite(Number(donchian?.upper)) ? Number(donchian.upper) : null);
  const support = below[0] ?? (Number.isFinite(Number(donchian?.lower)) ? Number(donchian.lower) : null);
  return {
    resistance, support,
    resistanceSource: above[0] !== undefined ? "SWING_HIGH" : resistance !== null ? "DONCHIAN_UPPER" : "NONE",
    supportSource: below[0] !== undefined ? "SWING_LOW" : support !== null ? "DONCHIAN_LOWER" : "NONE",
    distanceToResistanceATR: resistance !== null && atr ? round((resistance - current) / atr, 3) : null,
    distanceToSupportATR: support !== null && atr ? round((current - support) / atr, 3) : null,
    source: "PRICE_STRUCTURE_DERIVED",
  };
}

function bollinger(closes, period = BOLLINGER_PERIOD, multiplier = BOLLINGER_MULTIPLIER) {
  const list = closes.slice(-period);
  if (list.length < period) return null;
  const middle = list.reduce((sum, value) => sum + value, 0) / list.length;
  const deviation = stdev(list);
  if (deviation === null) return null;
  const upper = middle + multiplier * deviation;
  const lower = middle - multiplier * deviation;
  return { middle: round(middle), upper: round(upper), lower: round(lower), width: round(upper - lower), deviation: round(deviation) };
}

function structureOnAggregate(closedAggregated) {
  if (!Array.isArray(closedAggregated) || closedAggregated.length < STRUCTURE_MIN_CANDLES) {
    return { label: "INSUFFICIENT_DATA", detail: `candles<${STRUCTURE_MIN_CANDLES}`, swings: [], higherHigh: null, lowerHigh: null, higherLow: null, lowerLow: null };
  }
  const classified = classifyStructure(closedAggregated, closedAggregated.length - 1);
  const highs = (classified.swings ?? []).filter((swing) => swing.type === "HIGH");
  const lows = (classified.swings ?? []).filter((swing) => swing.type === "LOW");
  const lastHigh = highs[highs.length - 1] ?? null, previousHigh = highs[highs.length - 2] ?? null;
  const lastLow = lows[lows.length - 1] ?? null, previousLow = lows[lows.length - 2] ?? null;
  return {
    label: classified.label, detail: classified.detail,
    swings: (classified.swings ?? []).slice(-6).map((swing) => ({ type: swing.type, price: num(swing.price), bucketStart: num(swing.bucketStart) })),
    higherHigh: lastHigh && previousHigh ? lastHigh.price > previousHigh.price : null,
    lowerHigh: lastHigh && previousHigh ? lastHigh.price < previousHigh.price : null,
    higherLow: lastLow && previousLow ? lastLow.price > previousLow.price : null,
    lowerLow: lastLow && previousLow ? lastLow.price < previousLow.price : null,
  };
}

function aggregateTrend(closedAggregated) {
  const closes = closedAggregated.map((candle) => candle.close);
  if (closes.length < CONTEXT_MIN_CANDLES) return { available: false, direction: null, change: null, slope: null };
  const change = closes[closes.length - 1] - closes[0];
  const slope = linearSlope(closes);
  return { available: true, direction: change > 0 ? "UP" : change < 0 ? "DOWN" : "FLAT", change: round(change, 6), slope: round(slope, 8), candles: closes.length };
}

export function buildT0Enriched({
  marketKey = null,
  marketType = null,
  activeId = null,
  accountContext = null,
  decisionAt = Date.now(),
  price = null,
  candles5s = [],
  ticks = [],
  featureContext = null,
  structureFeatures = null,
  trajectory = null,
  payout = null,
  marketMeta = {},
  snapshotId = null,
} = {}) {
  const asOfMs = num(decisionAt) ?? Date.now();
  const { closed, forming } = splitClosedCandles(candles5s, asOfMs);
  const lastClosed = closed[closed.length - 1] ?? null;
  const lastClosedEnd = lastClosed?.bucketEnd ?? null;
  const indicators = featureContext?.deterministicIndicators ?? {};
  const valueOf = (entry) => num(entry?.value);
  const donchian = {
    upper: valueOf(indicators.donchianUpper), middle: valueOf(indicators.donchianMiddle), lower: valueOf(indicators.donchianLower),
    width: valueOf(indicators.donchianUpper) !== null && valueOf(indicators.donchianLower) !== null ? round(valueOf(indicators.donchianUpper) - valueOf(indicators.donchianLower)) : null,
    position: valueOf(indicators.donchianPosition),
    widthATR: valueOf(indicators.donchianWidthATR),
  };
  const atr = valueOf(indicators.atr14);
  const closes = closed.map((candle) => candle.close);
  const returns = [];
  for (let index = Math.max(1, closes.length - REALIZED_VOL_WINDOW); index < closes.length; index += 1) returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
  const realizedVol = stdev(returns);
  const bollingerBands = bollinger(closes);
  const structure = swingStructure(structureFeatures);
  const bos = breakOfStructure({ closedCandles: closed, swings: structure.swings, atr });
  const levels = nearestLevels({ price: price ?? lastClosed?.close ?? null, swings: structure.swings, donchian, atr });
  const tickStats = tickMicrostructure(ticks, { now: asOfMs });
  const anatomy = candleAnatomy(lastClosed);
  const sequence = (() => {
    const directions = closed.slice(-6).map((candle) => Math.sign(candle.close - candle.open));
    let streak = 0;
    for (let index = directions.length - 1; index >= 0; index -= 1) {
      if (directions[index] === 0) break;
      if (streak === 0 || Math.sign(streak) === directions[index]) streak += directions[index];
      else break;
    }
    return { sequence: directions.map((sign) => (sign > 0 ? "U" : sign < 0 ? "D" : "F")).join(""), streak };
  })();
  const aggregate1m = aggregateCandles(candles5s, TIMEFRAMES.structure, asOfMs);
  const aggregate5m = aggregateCandles(candles5s, TIMEFRAMES.context, asOfMs);
  const structure1m = structureOnAggregate(aggregate1m.closed);
  const context5m = aggregateTrend(aggregate5m.closed);
  const last1mClosedEnd = aggregate1m.closed[aggregate1m.closed.length - 1]?.bucketEnd ?? null;
  const last5mClosedEnd = aggregate5m.closed[aggregate5m.closed.length - 1]?.bucketEnd ?? null;
  const tickAvailableAt = tickStats.available ? tickStats.last.receivedAt : null;
  const snapshotAvailableAt = Math.max(...[lastClosedEnd, last1mClosedEnd, last5mClosedEnd, tickAvailableAt, num(featureContext?.generatedAt)].filter((value) => Number.isFinite(value)), 0) || null;
  const velocity = structureFeatures?.velocity ?? { velocity: null, priorVelocity: null, acceleration: null };
  const volatility = structureFeatures?.volatility ?? { atr, atrRatio: null, compression: null, expansion: null };
  const events = structureFeatures?.events ?? null;
  const compression = {
    atrRatio: num(volatility.atrRatio),
    donchianWidthATR: donchian.widthATR,
    bollingerWidthATR: bollingerBands && atr ? round(bollingerBands.width / atr, 4) : null,
    compressed: volatility.compression === true || (num(volatility.atrRatio) !== null && num(volatility.atrRatio) < 0.7),
    expanded: volatility.expansion === true || (num(volatility.atrRatio) !== null && num(volatility.atrRatio) > 1.4),
  };
  compression.state = compression.compressed ? "COMPRESSED" : compression.expanded ? "EXPANDED" : "NORMAL";
  const rsi = valueOf(indicators.rsi14);
  const persistenceBase = sequence.streak;
  const momentum = {
    rsi14: rsi,
    rsiSlope: num(trajectory?.rsiSlope),
    velocity: num(velocity.velocity),
    priorVelocity: num(velocity.priorVelocity),
    acceleration: num(velocity.acceleration),
    diSpread: valueOf(indicators.diSpread),
    diSpreadSlope: num(trajectory?.diSpreadSlope),
    persistence: persistenceBase,
    persistenceDirection: persistenceBase > 0 ? "UP" : persistenceBase < 0 ? "DOWN" : "FLAT",
  };
  const priceValue = num(price) ?? num(lastClosed?.close) ?? tickStats.last?.price ?? null;
  const range = structureFeatures?.location ?? null;
  const location = {
    zone: range?.zone ?? null,
    donchianPosition: donchian.position,
    distanceToUpperATR: valueOf(indicators.distanceToUpperATR),
    distanceToLowerATR: valueOf(indicators.distanceToLowerATR),
    channelHigh: num(range?.channelHigh) ?? donchian.upper,
    channelLow: num(range?.channelLow) ?? donchian.lower,
    resistance: levels.resistance,
    support: levels.support,
    distanceToResistanceATR: levels.distanceToResistanceATR,
    distanceToSupportATR: levels.distanceToSupportATR,
    overextended: (() => {
      const up = valueOf(indicators.distanceToUpperATR), down = valueOf(indicators.distanceToLowerATR);
      if (up === null && down === null) return null;
      return (up !== null && up < -2.5) || (down !== null && down < -2.5);
    })(),
    mid: donchian.position !== null ? Math.abs(donchian.position - 0.5) <= 0.15 : null,
  };
  const calculatedAt = asOfMs;
  const provenance = {
    "price.last": provenanceEntry({ value: priceValue, source: "CANDLE_5S", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd ?? tickAvailableAt }),
    "ticks.microstructure": provenanceEntry({ value: tickStats.available ? tickStats.count : null, source: "TICK_RING", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: tickAvailableAt }),
    "indicators.rsi14": provenanceEntry({ value: rsi, source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "indicators.adx14": provenanceEntry({ value: valueOf(indicators.adx14), source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "indicators.atr14": provenanceEntry({ value: atr, source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "indicators.plusDI": provenanceEntry({ value: valueOf(indicators.plusDI), source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "indicators.minusDI": provenanceEntry({ value: valueOf(indicators.minusDI), source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "indicators.donchian": provenanceEntry({ value: donchian.position, source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "structure.label": provenanceEntry({ value: structure.label, source: "PRICE_STRUCTURE", producer: "price-structure-v1", formulaVersion: STRUCTURE_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "structure.bos": provenanceEntry({ value: bos.type, source: "PRICE_STRUCTURE", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "structure.hhHl": provenanceEntry({ value: structure.higherHigh, source: "PRICE_STRUCTURE", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "structure.supportResistance": provenanceEntry({ value: levels.resistance ?? levels.support, source: "PRICE_STRUCTURE", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "timeframes.structure1m": provenanceEntry({ value: structure1m.label, source: "CANDLE_5S_DERIVED", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: last1mClosedEnd }),
    "timeframes.context5m": provenanceEntry({ value: context5m.direction, source: "CANDLE_5S_DERIVED", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: last5mClosedEnd }),
    "indicators.realizedVol": provenanceEntry({ value: round(realizedVol, 8), source: "DETERMINISTIC_CALCULATION", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "indicators.bollinger": provenanceEntry({ value: bollingerBands ? bollingerBands.width : null, source: "DETERMINISTIC_CALCULATION", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "volatility.compression": provenanceEntry({ value: compression.state, source: "DETERMINISTIC_CALCULATION", producer: "t0-enriched-v1", formulaVersion: T0_ENRICHED_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "momentum.velocity": provenanceEntry({ value: momentum.velocity, source: "PRICE_STRUCTURE", producer: "price-structure-v1", formulaVersion: STRUCTURE_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "momentum.acceleration": provenanceEntry({ value: momentum.acceleration, source: "PRICE_STRUCTURE", producer: "price-structure-v1", formulaVersion: STRUCTURE_VERSION, calculatedAt, availableAt: lastClosedEnd }),
    "location.distanceToUpperATR": provenanceEntry({ value: location.distanceToUpperATR, source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
    "location.distanceToLowerATR": provenanceEntry({ value: location.distanceToLowerATR, source: "FEATURE_ENGINE", producer: "feature-engine-v1", formulaVersion: FEATURE_ENGINE_VERSION, calculatedAt: num(featureContext?.generatedAt) ?? calculatedAt, availableAt: lastClosedEnd }),
  };
  return Object.freeze({
    schema: T0_ENRICHED_SCHEMA,
    version: T0_ENRICHED_VERSION,
    snapshotId: snapshotId ?? `${marketKey ?? "UNKNOWN"}:${asOfMs}`,
    market: { marketKey, marketType, activeId: num(activeId), accountContext, payout: num(payout), ...marketMeta },
    times: {
      decisionAt: asOfMs,
      calculatedAt,
      availableAt: snapshotAvailableAt,
      lastClosedCandleEnd: lastClosedEnd,
      lastTickReceivedAt: tickAvailableAt,
      featureContextGeneratedAt: num(featureContext?.generatedAt),
    },
    price: {
      last: priceValue,
      source: num(price) !== null ? "RUNTIME_LAST" : lastClosed ? "CANDLE_5S_CLOSE" : tickStats.available ? "TICK_RING_LAST" : "UNAVAILABLE",
      lastTick: tickStats.last,
    },
    ticks: tickStats,
    candles5s: {
      closedCount: closed.length,
      lastClosed: anatomy,
      forming: forming ? { bucketStart: forming.bucketStart, bucketEnd: forming.bucketEnd, closed: false, open: forming.open, high: forming.high, low: forming.low, close: forming.close, ageMs: Math.max(0, asOfMs - (forming.receivedAt ?? asOfMs)) } : null,
      sequence,
      events,
      candleShape: structureFeatures?.candleShape ?? null,
    },
    timeframes: {
      entry: { timeframeMs: TIMEFRAMES.entry, closedCount: closed.length },
      structure1m: { timeframeMs: TIMEFRAMES.structure, closedCount: aggregate1m.closed.length, forming: aggregate1m.forming ? { bucketStart: aggregate1m.forming.bucketStart, close: aggregate1m.forming.close, closed: false } : null, ...structure1m },
      context5m: { timeframeMs: TIMEFRAMES.context, closedCount: aggregate5m.closed.length, ...context5m },
    },
    indicators: {
      rsi14: rsi,
      rsiSlope: num(trajectory?.rsiSlope),
      atr14: atr,
      atrRatio: num(volatility.atrRatio),
      atrSlope: num(trajectory?.atrSlope),
      adx14: valueOf(indicators.adx14),
      adxSlope: num(trajectory?.adxSlope),
      plusDI: valueOf(indicators.plusDI),
      minusDI: valueOf(indicators.minusDI),
      diSpread: valueOf(indicators.diSpread),
      diSpreadSlope: num(trajectory?.diSpreadSlope),
      donchian,
      realizedVol: round(realizedVol, 8),
      bollinger: bollingerBands ? { ...bollingerBands, widthATR: atr ? round(bollingerBands.width / atr, 4) : null } : null,
    },
    structure: {
      ...structure,
      bos,
      range: { high: donchian.upper, low: donchian.lower, position: donchian.position },
      breakoutLevel: bos.level,
      retest: events ? { up: events.retestUp === true, down: events.retestDown === true } : null,
      failedStructure: events ? { up: events.failedBreakoutUp === true, down: events.failedBreakoutDown === true } : null,
    },
    compression,
    location,
    momentum,
    trajectory: trajectory ?? null,
    featureProvenance: provenance,
    flags: {
      shadowOnly: true,
      controlsExecution: false,
      otcSyntheticVolume: false,
      formingCandleExcluded: forming !== null,
    },
  });
}

/** Lista (path -> estado) de todas as features com proveniencia, para cobertura/auditoria. */
export function collectFeatureStates(t0 = {}) {
  const rows = [];
  for (const [path, entry] of Object.entries(t0?.featureProvenance ?? {})) {
    const value = entry?.value;
    const available = value !== null && value !== undefined && entry?.status !== "INSUFFICIENT_DATA";
    const ageMs = Number.isFinite(Number(t0?.times?.decisionAt)) && Number.isFinite(Number(entry?.availableAt)) ? Math.max(0, Number(t0.times.decisionAt) - Number(entry.availableAt)) : null;
    rows.push({ path, value, available, stale: available && ageMs !== null && ageMs > STALE_FEATURE_MS, ageMs, source: entry?.source ?? null, producer: entry?.producer ?? null });
  }
  return rows;
}

/** Guarda de leakage: encontra referencias temporais posteriores a decisionAt (alvos agendados sao permitidos). */
export function findFutureReferences(value, asOfMs, path = "t0", found = [], depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((entry, index) => findFutureReferences(entry, asOfMs, `${path}[${index}]`, found, depth + 1)); return found; }
  const TIME_KEYS = new Set(["bucketStart", "bucketEnd", "receivedAt", "at", "calculatedAt", "availableAt", "serverTimestamp", "lastClosedCandleEnd", "lastTickReceivedAt", "featureContextGeneratedAt", "decisionAt"]);
  for (const [key, entry] of Object.entries(value)) {
    if (TIME_KEYS.has(key) && Number.isFinite(Number(entry)) && Number(entry) > Number(asOfMs)) found.push(`${path}.${key}=${entry}>${asOfMs}`);
    findFutureReferences(entry, asOfMs, `${path}.${key}`, found, depth + 1);
  }
  return found;
}
