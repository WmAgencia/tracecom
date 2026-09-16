/**
 * DETERMINISTIC FEATURE ENGINE — matematica causal pura (RSI/ATR/ADX/Donchian/microestrutura).
 * Fonte primaria: candles causais 5s. NUNCA usa LLM/visao. Nunca usa dados futuros.
 * Cada campo carrega source: DETERMINISTIC_CALCULATION | INSUFFICIENT_DATA.
 */
export const FEATURE_ENGINE_VERSION = "feature-engine-v1";
export const FEATURE_BUCKET_MS = 5_000;

function source(value, status = "DETERMINISTIC_CALCULATION") { return value === null ? { value: null, status: "INSUFFICIENT_DATA", source: "UNAVAILABLE" } : { value, status, source: "DETERMINISTIC_CALCULATION" }; }
export const mean = (values) => (values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : null);

/** RSI estilo Wilder (SMA seed das primeiras p variacoes + recursao). */
export function rsiWilder(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let index = 1; index <= period; index += 1) { const diff = closes[index] - closes[index - 1]; if (diff >= 0) gains += diff; else losses -= diff; }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** True Range e ATR (Wilder). */
export function atrWilder(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index], previous = candles[index - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  let atr = mean(ranges.slice(0, period)) ?? 0;
  for (let index = period; index < ranges.length; index += 1) atr = (atr * (period - 1) + ranges[index]) / period;
  return atr;
}

/** ADX(14) com +DI/-DI (Wilder). */
export function adxWilder(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index], previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  const smooth = (values) => { let acc = values.slice(0, period).reduce((sum, x) => sum + x, 0); const out = [acc]; for (let index = period; index < values.length; index += 1) { acc = acc - acc / period + values[index]; out.push(acc); } return out; };
  const trS = smooth(tr), plusS = smooth(plusDM), minusS = smooth(minusDM);
  const plusDI = [], minusDI = [], dx = [];
  for (let index = 0; index < trS.length; index += 1) {
    if (trS[index] === 0) continue;
    const p = 100 * (plusS[index] / trS[index]), m = 100 * (minusS[index] / trS[index]);
    plusDI.push(p); minusDI.push(m);
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
  }
  if (dx.length < period) return null;
  let adx = mean(dx.slice(0, period)) ?? 0;
  for (let index = period; index < dx.length; index += 1) adx = (adx * (period - 1) + dx[index]) / period;
  return { adx, plusDI: plusDI[plusDI.length - 1], minusDI: minusDI[minusDI.length - 1] };
}

/** Donchian (janela causal, inclui o candle atual). */
export function donchian(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const window = candles.slice(-period);
  const upper = Math.max(...window.map((candle) => candle.high));
  const lower = Math.min(...window.map((candle) => candle.low));
  const middle = (upper + lower) / 2;
  const close = candles[candles.length - 1].close;
  const width = upper - lower;
  return { upper, middle, lower, width, position: width > 0 ? (close - lower) / width : 0.5 };
}

export function microstructure(candles, window = 6) {
  if (!Array.isArray(candles) || candles.length < window) return null;
  const slice = candles.slice(-window);
  const bodies = slice.map((candle) => Math.abs(candle.close - candle.open));
  const ranges = slice.map((candle) => candle.high - candle.low);
  const directions = slice.map((candle) => Math.sign(candle.close - candle.open));
  const last = slice[slice.length - 1];
  const range = last.high - last.low;
  const upWick = range > 0 ? (last.high - Math.max(last.open, last.close)) / range : 0;
  const downWick = range > 0 ? (Math.min(last.open, last.close) - last.low) / range : 0;
  let streak = 0; for (let index = directions.length - 1; index >= 0; index -= 1) { if (directions[index] === 0) break; if (streak === 0 || Math.sign(streak) === directions[index]) streak += directions[index]; else break; }
  const first = slice[0].open, close = last.close;
  return { window, bodySize: mean(bodies), rangeSize: mean(ranges), directionSequence: directions.join(""), streak, returnOverWindow: first === 0 ? null : (close - first) / first, upWickRatio: upWick, downWickRatio: downWick, compression: mean(bodies) !== null && mean(bodies.slice(0, Math.floor(window / 2))) !== null ? (mean(bodies.slice(Math.floor(window / 2))) ?? 0) / (mean(bodies.slice(0, Math.floor(window / 2))) || 1) : null };
}

/** MarketAnalysisContext deterministico (sem LLM, sem futuro). */
export function buildFeatureContext({ candles, now = Date.now(), timeframeSeconds = 5, contextMinutes = 15, horizonSeconds = 60, frameCapturedAt = null, vision = null, provenanceExtra = {} } = {}) {
  const list = Array.isArray(candles) ? candles.filter((candle) => candle && Number.isFinite(candle.close)) : [];
  const closes = list.map((candle) => candle.close);
  const rsiValue = rsiWilder(closes, 14);
  const atrValue = atrWilder(list, 14);
  const adx = adxWilder(list, 14);
  const channel = donchian(list, 20);
  const recent = microstructure(list, 6);
  const price = list.length ? list[list.length - 1].close : null;
  const atrNormalized = price && atrValue !== null && price !== 0 ? atrValue / price : null;
  const context = {
    version: FEATURE_ENGINE_VERSION,
    generatedAt: now,
    market: { timeframeSeconds, contextMinutes, horizonSeconds, candleCount: list.length },
    causalPrice: { ...source(price), lastCandleCloseAt: list.length ? list[list.length - 1].start ?? null : null },
    deterministicIndicators: {
      rsi14: source(rsiValue),
      atr14: source(atrValue),
      atrNormalized: source(atrNormalized),
      adx14: adx ? source(adx.adx) : source(null),
      plusDI: adx ? source(adx.plusDI) : source(null),
      minusDI: adx ? source(adx.minusDI) : source(null),
      diSpread: adx ? source(Math.abs(adx.plusDI - adx.minusDI)) : source(null),
      donchianUpper: channel ? source(channel.upper) : source(null),
      donchianMiddle: channel ? source(channel.middle) : source(null),
      donchianLower: channel ? source(channel.lower) : source(null),
      donchianPosition: channel ? source(channel.position) : source(null),
      donchianWidthATR: channel && atrValue ? source(channel.width / atrValue) : source(null),
      distanceToUpperATR: channel && atrValue && price !== null ? source((channel.upper - price) / atrValue) : source(null),
      distanceToLowerATR: channel && atrValue && price !== null ? source((price - channel.lower) / atrValue) : source(null),
    },
    microstructure: recent ? { ...recent, source: "DETERMINISTIC_CALCULATION" } : { status: "INSUFFICIENT_DATA", source: "UNAVAILABLE" },
    visualObservation: vision ?? null,
    freshness: { frameCapturedAt, visionCompletedAt: vision?.provenance?.timestamp ?? null, observationAgeMs: frameCapturedAt ? Math.max(0, now - frameCapturedAt) : null },
    provenance: { engine: FEATURE_ENGINE_VERSION, sources: ["CAUSAL_CANDLE", "DETERMINISTIC_CALCULATION", vision ? "VISION_EXACT_TEXT|VISION_GEOMETRY" : "UNAVAILABLE"], ...provenanceExtra },
  };
  return context;
}

/** Freshness gate: decisao atrasada vira STALE_ANALYSIS/WAIT.
 * Threshold projetado do horizonte + latencia medida (nao constante arbitraria):
 * horizon=60s; Vision p95 medido 27.5s; pipeline total p95 ~35s; margem -> 50s.
 * Invariante: maxAge < horizonSeconds*1000 (nunca aceitar observacao mais velha que o proprio horizonte). */
export const MAX_OBSERVATION_AGE_MS = 50_000;
export function freshnessGate(context, maxAgeMs = MAX_OBSERVATION_AGE_MS, horizonSeconds = 60) {
  const effectiveMax = Math.max(5_000, Math.min(maxAgeMs, horizonSeconds * 1_000 - 10_000));
  const age = context?.freshness?.observationAgeMs;
  if (age === null || age === undefined) return { fresh: false, reason: "FRAME_TIMESTAMP_UNAVAILABLE" };
  if (age > effectiveMax) return { fresh: false, reason: "STALE_ANALYSIS", maxAgeMs: effectiveMax, ageMs: age };
  return { fresh: true, reason: "OK", maxAgeMs: effectiveMax, ageMs: age };
}
