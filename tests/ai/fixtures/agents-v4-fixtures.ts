/**
 * Fixtures deterministicas para DataHub/Agents V4 (sem rede, sem banco).
 * Mesmos modulos de producao: feature-engine, price-structure e datahub.
 */
// @ts-expect-error - relay ESM sem tipagem
const featureEngine = await import("../../../relay/feature-engine.mjs");
// @ts-expect-error - relay ESM sem tipagem
const priceStructure = await import("../../../relay/price-structure.mjs");
// @ts-expect-error - relay ESM sem tipagem
const datahub = await import("../../../relay/datahub/index.mjs");

export const BASE_MS = 1_800_000_000_000;
export const CANDLE_MS = 5_000;

type Candle = { bucketStart: number; bucketEnd: number; open: number; high: number; low: number; close: number; receivedAt: number; serverTimestamp: number };

export function zigzagCandles({ dir = "UP", steps = 88, start = 1.1, amp = 0.0006, step = 0.00012, baseMs = BASE_MS } = {}): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  for (let index = 0; index < steps; index += 1) {
    const open = price;
    const drift = dir === "UP" ? step : dir === "DOWN" ? -step : 0;
    const phase = index % 5;
    const wave = dir === "DOWN" ? (phase < 2 ? amp : -amp) : phase < 3 ? amp : -amp;
    const close = open + drift + wave;
    const upWick = close >= open ? amp * 0.4 : amp * 0.15;
    const downWick = close <= open ? amp * 0.4 : amp * 0.15;
    candles.push({
      bucketStart: baseMs + index * CANDLE_MS, bucketEnd: baseMs + index * CANDLE_MS + CANDLE_MS,
      open, high: Math.max(open, close) + upWick, low: Math.min(open, close) - downWick, close,
      receivedAt: baseMs + index * CANDLE_MS + CANDLE_MS, serverTimestamp: baseMs + index * CANDLE_MS,
    });
    price = close;
  }
  return candles;
}

export function rangeCandles({ cycles = 22, start = 1.1, amp = 0.0005, baseMs = BASE_MS } = {}): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  for (let index = 0; index < cycles * 4; index += 1) {
    const open = price;
    const phase = index % 4;
    const wave = phase < 2 ? amp : -amp;
    const close = open + wave;
    const upWick = close >= open ? amp * 0.35 : amp * 0.15;
    const downWick = close <= open ? amp * 0.35 : amp * 0.15;
    candles.push({
      bucketStart: baseMs + index * CANDLE_MS, bucketEnd: baseMs + index * CANDLE_MS + CANDLE_MS,
      open, high: Math.max(open, close) + upWick, low: Math.min(open, close) - downWick, close,
      receivedAt: baseMs + index * CANDLE_MS + CANDLE_MS, serverTimestamp: baseMs + index * CANDLE_MS,
    });
    price = close;
  }
  return candles;
}

export function compressionCandles({ steps = 88, start = 1.1, baseMs = BASE_MS } = {}): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  for (let index = 0; index < steps; index += 1) {
    const open = price;
    const scale = 0.0005 * (1 - (index / steps) * 0.9);
    const wave = (index % 4 < 2 ? scale : -scale) * (1 - (index / steps) * 0.7);
    const close = open + wave;
    candles.push({
      bucketStart: baseMs + index * CANDLE_MS, bucketEnd: baseMs + index * CANDLE_MS + CANDLE_MS,
      open, high: Math.max(open, close) + scale * 0.1, low: Math.min(open, close) - scale * 0.1, close,
      receivedAt: baseMs + index * CANDLE_MS + CANDLE_MS, serverTimestamp: baseMs + index * CANDLE_MS,
    });
    price = close;
  }
  return candles;
}

export function ticksFor(price: number, count = 30, baseMs = BASE_MS) {
  const ticks = [];
  for (let index = 0; index < count; index += 1) {
    ticks.push({ price: price + index * 0.000002, at: baseMs + index * 400, receivedAt: baseMs + index * 400, source: "FEED_TICK" });
  }
  return ticks;
}

export function buildEnrichedT0({
  candles,
  marketKey = "EURUSD:OTC",
  marketType = "OTC",
  activeId = 76,
  accountContext = "PRACTICE",
  decisionAt = null,
  ticks = null,
  trajectory = { rsiSlope: 0.1, adxSlope: 0.05, diSpreadSlope: 0.02, atrSlope: 0.01, donchianDelta: 0.01, samples: 10 },
  payout = 0.87,
}: any = {}) {
  const resolvedDecisionAt = decisionAt ?? candles[candles.length - 1].bucketStart + CANDLE_MS;
  const featureContext = featureEngine.buildFeatureContext({ candles, now: resolvedDecisionAt, frameCapturedAt: resolvedDecisionAt, timeframeSeconds: 5 });
  const structureFeatures = priceStructure.computeStructureFeatures(candles, candles.length - 1, { atr: featureContext.deterministicIndicators.atr14.value });
  const resolvedTicks = ticks ?? ticksFor(candles[candles.length - 1].close, 30, resolvedDecisionAt - 12_000);
  const t0 = datahub.buildT0Enriched({
    marketKey, marketType, activeId, accountContext, decisionAt: resolvedDecisionAt,
    price: candles[candles.length - 1].close, candles5s: candles, ticks: resolvedTicks,
    featureContext, structureFeatures, trajectory, payout,
  });
  return { t0, featureContext, structureFeatures, decisionAt: resolvedDecisionAt };
}

export function dataQualityInput(t0: any, overrides: any = {}) {
  return {
    marketKey: t0.market.marketKey,
    marketType: t0.market.marketType,
    accountContext: t0.market.accountContext,
    now: t0.times.decisionAt,
    feed: { connected: true, tickAgeMs: 400 },
    candles: { count: t0.candles5s.closedCount, duplicates: 0, reorder: 0, missingBuckets: 0 },
    clock: { skewMs: 100, timeValid: true },
    marketMapping: { activeId: t0.market.activeId, resolved: true },
    broker: { evaluated: true, connected: true, accountType: t0.market.accountContext },
    feature: { fresh: true, ageMs: 500 },
    ...overrides,
  };
}

export function healthyDataQuality(t0: any) {
  return datahub.assessDataQuality(dataQualityInput(t0));
}

/** Bundle de features base (tudo indisponivel) para testes unitarios de especialistas. */
export function featureBundle(overrides: any = {}) {
  const base = {
    version: "agents-v4-features-v1",
    marketKey: "EURUSD:OTC", marketType: "OTC",
    price: 1.1, atr: 0.001, atrRatio: 1, atrSlope: 0, adx: null, adxSlope: null,
    plusDI: null, minusDI: null, diSpread: null, diSpreadSlope: null, diAlignedUp: null,
    rsi: 50, rsiSlope: 0, velocity: 0, acceleration: 0, velocityATR: 0, accelerationATR: 0,
    persistence: 0, persistenceDirection: "FLAT",
    donchianPosition: 0.5, donchianWidthATR: 3,
    distanceToUpperATR: 1.5, distanceToLowerATR: 1.5, overextended: false, midLocation: true,
    structureLabel: "RANGE", structureDetail: "swings mistos",
    higherHigh: null, higherLow: null, lowerHigh: null, lowerLow: null, lastSwingType: null,
    bosUp: false, bosDown: false, bosType: "NONE", bosLevel: null,
    resistance: null, support: null, distanceToResistanceATR: null, distanceToSupportATR: null,
    rangeHigh: null, rangeLow: null, rangePosition: null,
    retestUp: false, retestDown: false, failedBreakoutUp: false, failedBreakoutDown: false,
    breakoutUp: false, breakoutDown: false, pullbackUp: false, pullbackDown: false,
    rejectionUp: false, rejectionDown: false, compressionEvent: false, expansionEvent: false,
    bodyRatio: 0.5, upperWick: 0.25, lowerWick: 0.25, relativeRange: 1, closeLocation: 0.5, candleDirection: "FLAT",
    streak: 0, candleSequence: "FFFF", realizedVol: 0.0001, bollingerWidthATR: 3,
    compressionState: "NORMAL", compressed: false, expanded: false,
    structure1m: "RANGE", structure1mDetail: null, structure1mHH: null, structure1mHL: null, structure1mLH: null, structure1mLL: null,
    context5m: null, context5mAvailable: false,
    ticksAvailable: true, tickCount: 30, tickDirection: "FLAT", tickPressure: 0, tickVelocity: 0, tickAcceleration: 0,
    tickArrivalRate: 2, tickDirectionChanges: 5, tickBursts: 0, tickShortTermVol: 0.00001, tickAgeMs: 400,
    decisionAt: BASE_MS, availableAt: BASE_MS - 1_000, snapshotId: "snap-test",
  };
  return { ...base, ...overrides };
}

export function trendFeatures({ direction = "UP", adx = 28, momentum = "UP" } = {}) {
  const bullish = direction === "UP";
  return featureBundle({
    structureLabel: bullish ? "UP" : "DOWN",
    structure1m: bullish ? "UP" : "DOWN",
    context5m: bullish ? "UP" : "DOWN",
    adx, diAlignedUp: bullish,
    plusDI: bullish ? 30 : 12, minusDI: bullish ? 12 : 30, diSpread: 18,
    velocity: bullish ? 0.0008 : -0.0008, acceleration: bullish ? 0.0002 : -0.0002,
    velocityATR: bullish ? 0.8 : -0.8, accelerationATR: bullish ? 0.2 : -0.2,
    rsi: bullish ? 62 : 38, rsiSlope: bullish ? 0.4 : -0.4, persistence: bullish ? 3 : -3, persistenceDirection: bullish ? "UP" : "DOWN",
    bosUp: bullish, bosDown: !bullish, bosType: bullish ? "BOS_UP" : "BOS_DOWN",
    higherHigh: bullish, higherLow: bullish, lowerHigh: !bullish, lowerLow: !bullish,
    structure1mHH: bullish, structure1mHL: bullish, structure1mLH: !bullish, structure1mLL: !bullish,
    donchianPosition: bullish ? 0.72 : 0.28, distanceToUpperATR: bullish ? 0.8 : 2.2, distanceToLowerATR: bullish ? 2.2 : 0.8, midLocation: false,
    closeLocation: bullish ? 0.8 : 0.2, candleDirection: bullish ? "UP" : "DOWN", bodyRatio: 0.6, streak: bullish ? 2 : -2,
    tickDirection: momentum, tickPressure: bullish ? 0.4 : -0.4, tickVelocity: bullish ? 0.000001 : -0.000001,
  });
}
