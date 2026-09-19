/**
 * AGENT FEATURES V4 — bundle UNICO de features derivado do T0 enriquecido.
 *
 * Os especialistas NAO recalculam RSI/ATR/ADX/Donchian/microestrutura: leem daqui.
 * Cada campo expoe valor + disponibilidade (null = insuficiente), nunca inventa dado.
 */
export const AGENT_FEATURES_VERSION = "agents-v4-features-v1";

const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function buildAgentFeatures(t0 = {}) {
  const indicators = t0?.indicators ?? {};
  const structure = t0?.structure ?? {};
  const location = t0?.location ?? {};
  const momentum = t0?.momentum ?? {};
  const compression = t0?.compression ?? {};
  const ticks = t0?.ticks ?? {};
  const candles = t0?.candles5s ?? {};
  const timeframes = t0?.timeframes ?? {};
  const events = candles?.events ?? null;
  const donchian = indicators?.donchian ?? {};
  const atr = num(indicators.atr14);
  const price = num(t0?.price?.last);
  return {
    version: AGENT_FEATURES_VERSION,
    marketKey: t0?.market?.marketKey ?? null,
    marketType: t0?.market?.marketType ?? null,
    price,
    atr,
    atrRatio: num(indicators.atrRatio),
    atrSlope: num(indicators.atrSlope),
    adx: num(indicators.adx14),
    adxSlope: num(indicators.adxSlope),
    plusDI: num(indicators.plusDI),
    minusDI: num(indicators.minusDI),
    diSpread: num(indicators.diSpread),
    diSpreadSlope: num(indicators.diSpreadSlope),
    diAlignedUp: Number.isFinite(num(indicators.plusDI)) && Number.isFinite(num(indicators.minusDI)) ? num(indicators.plusDI) > num(indicators.minusDI) : null,
    rsi: num(indicators.rsi14),
    rsiSlope: num(indicators.rsiSlope),
    velocity: num(momentum.velocity),
    acceleration: num(momentum.acceleration),
    velocityATR: atr && num(momentum.velocity) !== null ? Number((num(momentum.velocity) / atr).toFixed(4)) : null,
    accelerationATR: atr && num(momentum.acceleration) !== null ? Number((num(momentum.acceleration) / atr).toFixed(4)) : null,
    persistence: num(momentum.persistence),
    persistenceDirection: momentum.persistenceDirection ?? null,
    donchianPosition: num(donchian.position) ?? num(location.donchianPosition),
    donchianWidthATR: num(donchian.widthATR),
    distanceToUpperATR: num(location.distanceToUpperATR),
    distanceToLowerATR: num(location.distanceToLowerATR),
    overextended: location.overextended === true,
    midLocation: location.mid === true,
    structureLabel: structure.label ?? null,
    structureDetail: structure.detail ?? null,
    higherHigh: structure.higherHigh ?? null,
    higherLow: structure.higherLow ?? null,
    lowerHigh: structure.lowerHigh ?? null,
    lowerLow: structure.lowerLow ?? null,
    lastSwingType: structure.lastSwingType ?? null,
    bosUp: structure?.bos?.up === true,
    bosDown: structure?.bos?.down === true,
    bosType: structure?.bos?.type ?? null,
    bosLevel: num(structure?.bos?.level),
    resistance: num(structure.resistance),
    support: num(structure.support),
    distanceToResistanceATR: num(location.distanceToResistanceATR),
    distanceToSupportATR: num(location.distanceToSupportATR),
    rangeHigh: num(structure?.range?.high),
    rangeLow: num(structure?.range?.low),
    rangePosition: num(structure?.range?.position),
    retestUp: structure?.retest?.up === true,
    retestDown: structure?.retest?.down === true,
    failedBreakoutUp: structure?.failedStructure?.up === true,
    failedBreakoutDown: structure?.failedStructure?.down === true,
    breakoutUp: events?.breakoutUp === true,
    breakoutDown: events?.breakoutDown === true,
    pullbackUp: events?.pullbackUp === true,
    pullbackDown: events?.pullbackDown === true,
    rejectionUp: events?.rejectionUp === true,
    rejectionDown: events?.rejectionDown === true,
    compressionEvent: events?.compression === true,
    expansionEvent: events?.expansion === true,
    bodyRatio: num(candles?.candleShape?.bodyRatio),
    upperWick: num(candles?.candleShape?.upperWick),
    lowerWick: num(candles?.candleShape?.lowerWick),
    relativeRange: num(candles?.candleShape?.relativeRange),
    closeLocation: num(candles?.lastClosed?.closeLocation),
    candleDirection: candles?.lastClosed?.direction ?? null,
    streak: num(candles?.sequence?.streak),
    candleSequence: candles?.sequence?.sequence ?? null,
    realizedVol: num(indicators.realizedVol),
    bollingerWidthATR: num(indicators?.bollinger?.widthATR),
    compressionState: compression.state ?? null,
    compressed: compression.compressed === true,
    expanded: compression.expanded === true,
    structure1m: timeframes?.structure1m?.label ?? null,
    structure1mDetail: timeframes?.structure1m?.detail ?? null,
    structure1mHH: timeframes?.structure1m?.higherHigh ?? null,
    structure1mHL: timeframes?.structure1m?.higherLow ?? null,
    structure1mLH: timeframes?.structure1m?.lowerHigh ?? null,
    structure1mLL: timeframes?.structure1m?.lowerLow ?? null,
    context5m: timeframes?.context5m?.direction ?? null,
    context5mAvailable: timeframes?.context5m?.available === true,
    ticksAvailable: ticks.available === true,
    tickCount: num(ticks.count),
    tickDirection: ticks.direction ?? null,
    tickPressure: num(ticks.pressure),
    tickVelocity: num(ticks.velocity),
    tickAcceleration: num(ticks.acceleration),
    tickArrivalRate: num(ticks.arrivalRatePerSec),
    tickDirectionChanges: num(ticks.directionChanges),
    tickBursts: num(ticks.bursts),
    tickShortTermVol: num(ticks.shortTermVol),
    tickAgeMs: num(ticks?.last?.ageMs),
    decisionAt: num(t0?.times?.decisionAt),
    availableAt: num(t0?.times?.availableAt),
    snapshotId: t0?.snapshotId ?? null,
  };
}

export function describeFeatureAvailability(features = {}, paths = []) {
  const missing = [];
  for (const path of paths) {
    const value = features?.[path];
    if (value === null || value === undefined) missing.push(path);
  }
  return { missing, complete: missing.length === 0 };
}
