/**
 * PRICE STRUCTURE (Fase 6) — features deterministicas de price action/estrutura/regime (causais).
 *
 * Tudo aqui e matematicamente definido e usa APENAS candles ate o indice informado (nunca futuro).
 * O LLM/agente NUNCA recalcula estes valores; apenas interpreta.
 */
export const STRUCTURE_VERSION = "price-structure-v1";

export const SWING_LOOKBACK = 2;

export function findSwings(candles, index, lookback = SWING_LOOKBACK, max = 8) {
  const swings = [];
  for (let cursor = lookback; cursor <= index - lookback; cursor += 1) {
    const candle = candles[cursor];
    let isHigh = true, isLow = true;
    for (let offset = -lookback; offset <= lookback; offset += 1) {
      if (offset === 0) continue;
      const other = candles[cursor + offset];
      if (!other) continue;
      if (other.high >= candle.high) isHigh = false;
      if (other.low <= candle.low) isLow = false;
    }
    if (isHigh) swings.push({ type: "HIGH", index: cursor, price: candle.high, bucketStart: candle.bucketStart ?? candle.start });
    if (isLow) swings.push({ type: "LOW", index: cursor, price: candle.low, bucketStart: candle.bucketStart ?? candle.start });
    if (swings.length >= max * 2) swings.splice(0, swings.length - max * 2);
  }
  return swings;
}

/** Estrutura por swings: HH/HL (UP), LH/LL (DOWN) ou RANGE. */
export function classifyStructure(candles, index) {
  const swings = findSwings(candles, index);
  const highs = swings.filter((swing) => swing.type === "HIGH").slice(-2);
  const lows = swings.filter((swing) => swing.type === "LOW").slice(-2);
  if (highs.length < 2 || lows.length < 2) return { label: "RANGE", detail: "swings insuficientes", swings };
  const [h1, h2] = highs, [l1, l2] = lows;
  const higherHigh = h2.price > h1.price, higherLow = l2.price > l1.price;
  const lowerHigh = h2.price < h1.price, lowerLow = l2.price < l1.price;
  if (higherHigh && higherLow) return { label: "UP", detail: "HH+HL", swings, lastHigh: h2, lastLow: l2, firstHigh: h1, firstLow: l1 };
  if (lowerHigh && lowerLow) return { label: "DOWN", detail: "LH+LL", swings, lastHigh: h2, lastLow: l2, firstHigh: h1, firstLow: l1 };
  return { label: "RANGE", detail: "swings mistos", swings, lastHigh: h2, lastLow: l2, firstHigh: h1, firstLow: l1 };
}

/** Conjunto completo de features de estrutura/localizacao/eventos (causal). */
export function computeStructureFeatures(candles, index) {
  const list = Array.isArray(candles) ? candles.slice(0, index + 1) : [];
  if (list.length < 30) return null;
  const candle = list[list.length - 1];
  const closes = list.map((row) => row.close);
  const atr = averageRange(list, 14);
  if (!atr) return null;
  const structure = classifyStructure(list, list.length - 1);

  // localizacao (canal 20 causal)
  const window = list.slice(-20);
  const channelHigh = Math.max(...window.map((row) => row.high));
  const channelLow = Math.min(...window.map((row) => row.low));
  const channelWidth = Math.max(1e-9, channelHigh - channelLow);
  const position = (candle.close - channelLow) / channelWidth;
  const zone = position > 0.8 ? "AT_TOP" : position < 0.2 ? "AT_BOTTOM" : position > 0.55 ? "UPPER_HALF" : position < 0.45 ? "LOWER_HALF" : "MID";
  const previousWindow = list.slice(-21, -1);
  const previousHigh = Math.max(...previousWindow.map((row) => row.high));
  const previousLow = Math.min(...previousWindow.map((row) => row.low));

  // eventos
  const breakoutUp = candle.close > previousHigh + 0.05 * atr;
  const breakoutDown = candle.close < previousLow - 0.05 * atr;
  const piercedUp = candle.high > previousHigh + 0.1 * atr && candle.close <= previousHigh;
  const piercedDown = candle.low < previousLow - 0.1 * atr && candle.close >= previousLow;
  const failedBreakoutUp = piercedUp;
  const failedBreakoutDown = piercedDown;
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = range > 0 ? (candle.high - Math.max(candle.open, candle.close)) / range : 0;
  const lowerWick = range > 0 ? (Math.min(candle.open, candle.close) - candle.low) / range : 0;
  const rejectionUp = upperWick > 0.55 && candle.close < candle.open;
  const rejectionDown = lowerWick > 0.55 && candle.close > candle.open;

  // retest / pullback (usa eventos recentes)
  let retestUp = false, retestDown = false, pullbackUp = false, pullbackDown = false;
  for (let cursor = Math.max(1, list.length - 8); cursor < list.length; cursor += 1) {
    const prior = list[cursor - 1];
    if (prior.close > previousHigh && Math.abs(candle.close - prior.close) < 0.6 * atr && candle.low <= prior.close + 0.3 * atr) retestUp = true;
    if (prior.close < previousLow && Math.abs(candle.close - prior.close) < 0.6 * atr && candle.high >= prior.close - 0.3 * atr) retestDown = true;
  }
  if (structure.label === "UP" && structure.lastLow) pullbackUp = candle.close > structure.lastLow.price && candle.close < structure.lastHigh?.price;
  if (structure.label === "DOWN" && structure.lastHigh) pullbackDown = candle.close < structure.lastHigh.price && candle.close > structure.lastLow?.price;

  // volatilidade relativa
  const atrHistory = [];
  for (let cursor = Math.max(15, list.length - 21); cursor < list.length - 1; cursor += 1) { const value = averageRange(list.slice(0, cursor + 1), 14); if (value) atrHistory.push(value); }
  const atrBaseline = atrHistory.length ? atrHistory.reduce((sum, value) => sum + value, 0) / atrHistory.length : atr;
  const atrRatio = atrBaseline > 0 ? atr / atrBaseline : 1;
  const compression = atrRatio < 0.7;
  const expansion = atrRatio > 1.4;

  // velocidade/aceleracao (movimento por candle)
  const recent3 = closes.slice(-3), prior3 = closes.slice(-6, -3);
  const velocity = recent3.length === 3 && prior3.length === 3 ? (recent3[2] - recent3[0]) / 3 : 0;
  const priorVelocity = prior3.length === 3 ? (prior3[2] - prior3[0]) / 3 : 0;
  const acceleration = velocity - priorVelocity;

  return {
    version: STRUCTURE_VERSION,
    at: candle.bucketStart ?? candle.start ?? null,
    structure,
    location: { zone, donchianPosition: Number(position.toFixed(4)), channelHigh, channelLow, distanceToUpperATR: Number(((channelHigh - candle.close) / atr).toFixed(3)), distanceToLowerATR: Number(((candle.close - channelLow) / atr).toFixed(3)) },
    events: { breakoutUp, breakoutDown, failedBreakoutUp, failedBreakoutDown, retestUp, retestDown, pullbackUp, pullbackDown, rejectionUp, rejectionDown, compression, expansion },
    candleShape: { bodyRatio: range > 0 ? Number((body / range).toFixed(3)) : 0, upperWick: Number(upperWick.toFixed(3)), lowerWick: Number(lowerWick.toFixed(3)), relativeRange: Number((range / atr).toFixed(3)) },
    velocity: { velocity: Number(velocity.toFixed(6)), priorVelocity: Number(priorVelocity.toFixed(6)), acceleration: Number(acceleration.toFixed(6)) },
    volatility: { atr, atrRatio: Number(atrRatio.toFixed(3)), compression, expansion },
    swings: structure.swings.slice(-6).map((swing) => ({ type: swing.type, price: swing.price, bucketStart: swing.bucketStart })),
  };
}

export function averageRange(candles, period) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const current = slice[index], previous = slice[index - 1];
    sum += Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
  }
  return sum / period;
}

/** Regime explicito (usa features do Feature Engine + estrutura). */
export function classifyRegime({ features, structureFeatures, context }) {
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const plusDI = context?.deterministicIndicators?.plusDI?.value ?? null;
  const minusDI = context?.deterministicIndicators?.minusDI?.value ?? null;
  const atrRatio = structureFeatures?.volatility?.atrRatio ?? 1;
  const label = structureFeatures?.structure?.label ?? "RANGE";
  const diAlignedUp = plusDI !== null && minusDI !== null && plusDI > minusDI;
  const diAlignedDown = plusDI !== null && minusDI !== null && minusDI > plusDI;
  const strongAdx = adx !== null && adx >= 20;
  if (atrRatio > 2.5 || (structureFeatures?.candleShape?.upperWick > 0.45 && structureFeatures?.candleShape?.lowerWick > 0.45)) return "CHAOTIC";
  if (structureFeatures?.volatility?.expansion && !strongAdx && label === "RANGE") return "EXPANSION";
  if (structureFeatures?.volatility?.compression) return "COMPRESSION";
  if (strongAdx && label === "UP" && diAlignedUp) return "TREND_UP";
  if (strongAdx && label === "DOWN" && diAlignedDown) return "TREND_DOWN";
  if (strongAdx && label === "RANGE") return "TRANSITION";
  if (adx !== null && adx < 15 && label === "RANGE") return "RANGE";
  if (adx !== null && adx < 20 && label !== "RANGE") return "TRANSITION";
  return "UNCLEAR";
}
