/**
 * RSI_REVERSAL_PULLBACK_V3 — estrategia UNICA (detector RSI + reversao/pullback com continuidade).
 *
 * Nasce do encerramento do comparativo STRICT V2 x PULLBACK V2, incorporando as observacoes
 * empiricas (sem overfit): candidate nasce no extremo, mas a entrada exige continuidade real
 * ate o T-5; ADX caindo = apenas enfraquecimento da tendencia antiga (STAGE 1), NAO confirmacao
 * da nova direcao (STAGE 2 exige reacao do DI novo); projecao de ~60s com EXPECTED_EXPIRY_CUSHION
 * para evitar entradas frageis; override de reversao extrema MUITO restritivo; qualidade do
 * settlement relativa ao ruido do mercado.
 *
 * Nao altera V1/V2 (modulos congelados permanecem byte a byte). Sem I/O, sem ordem: puro.
 */
import { rsiWilder, adxWilder, atrWilder } from "./feature-engine.mjs";

export const V3_ID = "RSI_REVERSAL_PULLBACK_V3";
export const RSI_V3_VERSION = "RSI_REVERSAL_PULLBACK_V3_V1";

export const RSI_V3_POLICY = Object.freeze({
  version: RSI_V3_VERSION,
  detector: "RSI14_EXTREME",
  rsiBuyThreshold: 30,
  rsiSellThreshold: 70,
  extremeBuyThreshold: 15,
  extremeSellThreshold: 85,
  extremeBuyDeep: 10,
  extremeSellDeep: 90,
  rsiBandsBuy: ["30-20", "20-15", "15-10", "<=10"],
  rsiBandsSell: ["70-80", "80-85", "85-90", ">=90"],
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  minClosedCandles5s: 60,
  horizonSeconds: 60,
  horizonCandles: 12,
  candidateMaxAgeMs: 8 * 60_000,
  candidateNeutralGraceMs: 15_000,
  neutralBandLow: 45,
  neutralBandHigh: 55,
  strongDiMargin: 8,
  adxStrong: 25,
  adxRisingSlope: 0.5,
  adxStabilizeBand: 0.15,
  spreadContractionMin: 2,
  spreadContractionRatio: 0.15,
  bandTouchPosition: 0.9,
  cushionMin: 0.25,
  cushionStrong: 0.45,
  overrideMinLeadMs: 55_000,
  overrideRsiBuys: [15, 10],
  overrideRsiSells: [85, 90],
  finalWindowMs: 5000,
  minimumSafeMarginMs: 3000,
  noTuning: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Faixas de RSI exigidas (30-20 / 20-15 / 15-10 / <=10 e 70-80 / 80-85 / 85-90 / >=90). */
export function rsiBandV3(rsi) {
  const value = num(rsi);
  if (value === null) return "NEUTRAL";
  if (value <= 10) return "<=10";
  if (value <= 15) return "15-10";
  if (value <= 20) return "20-15";
  if (value <= 30) return "30-20";
  if (value >= 90) return ">=90";
  if (value >= 85) return "85-90";
  if (value >= 80) return "80-85";
  if (value >= 70) return "70-80";
  return "NEUTRAL";
}

function bollingerAt(closes, period, mult) {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = window.reduce((acc, value) => acc + value, 0) / period;
  const deviation = Math.sqrt(window.reduce((acc, value) => acc + (value - middle) ** 2, 0) / period);
  const upper = middle + mult * deviation;
  const lower = middle - mult * deviation;
  const width = upper - lower;
  const close = closes[closes.length - 1];
  return { upper, middle, lower, width, close, position: width > 0 ? (close - lower) / width : 0.5, distanceToUpper: upper - close, distanceToLower: close - lower };
}

/** Indicadores completos (causais). Inclui campos de projecao/ruido exigidos pela V3. */
export function evaluateIndicatorsV3({ candles, now = Date.now() } = {}) {
  const policy = RSI_V3_POLICY;
  const list = Array.isArray(candles) ? candles : [];
  const closed = list.filter((candle) => num(candle?.bucketEnd) !== null && Number(candle.bucketEnd) <= Number(now) && Number.isFinite(Number(candle.close)));
  const base = {
    status: "WAIT", reason: "INSUFFICIENT_HISTORY", closedCandles: closed.length, at: num(now) ?? Date.now(),
    rsi: null, rsiPrevious: null, rsiSlope: null, rsiBand: "NEUTRAL",
    bollinger: null, dmi: null, adx: null, atr: null,
    structuralTrend: "UNKNOWN", shortHorizonDirection: "UNKNOWN", shortMomentum: null,
    velocity: null, acceleration: null, candleAnatomy: null,
    noisePerCandle: null, noiseHorizon: null, realizedVolatility: null,
    bandRiding: { upper: false, lower: false }, strongContinuation: { upper: false, lower: false }, dominantDI: null,
    rejectionUpperNow: false, rejectionLowerNow: false,
  };
  if (closed.length < policy.minClosedCandles5s) return base;
  const closes = closed.map((candle) => Number(candle.close));
  const rsi = rsiWilder(closes, 14);
  if (rsi === null) return { ...base, reason: "RSI_UNAVAILABLE" };
  const rsiPrevious = closes.length > 15 ? rsiWilder(closes.slice(0, -1), 14) : null;
  const rsiLag = closes.length > 17 ? rsiWilder(closes.slice(0, -3), 14) : null;
  const rsiSlope = rsiLag === null ? null : round((rsi - rsiLag) / 3, 4);

  const bands = bollingerAt(closes, policy.bollingerPeriod, policy.bollingerStdDev);
  const previousBand = bollingerAt(closes.slice(0, -1), policy.bollingerPeriod, policy.bollingerStdDev);
  const widthSlope = bands && previousBand ? round(bands.width - previousBand.width, 8) : null;
  const expanding = widthSlope === null ? null : widthSlope > 0;

  const adx = adxWilder(closed, 14);
  const adxLag = closed.length > 17 ? adxWilder(closed.slice(0, -3), 14) : null;
  const plusSlope = adx && adxLag ? round(adx.plusDI - adxLag.plusDI, 4) : null;
  const minusSlope = adx && adxLag ? round(adx.minusDI - adxLag.minusDI, 4) : null;
  const adxSlope = adx && adxLag ? round(adx.adx - adxLag.adx, 4) : null;
  const spread = adx ? round(adx.plusDI - adx.minusDI, 4) : null;
  const spreadLag = adxLag ? round(adxLag.plusDI - adxLag.minusDI, 4) : null;
  const spreadSlope = spread !== null && spreadLag !== null ? round(spread - spreadLag, 4) : null;

  const atr = atrWilder(closed, 14);
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const velocity = atr && atr > 0 ? round((Number(last.close) - Number(prev.close)) / atr, 4) : null;
  const prevVelocity = atr && atr > 0 && closed.length > 2 ? round((Number(prev.close) - Number(closed[closed.length - 3].close)) / atr, 4) : null;
  const acceleration = velocity !== null && prevVelocity !== null ? round(velocity - prevVelocity, 4) : null;

  const range = Number(last.high) - Number(last.low);
  const candleAnatomy = {
    bodyRatio: range > 0 ? round(Math.abs(Number(last.close) - Number(last.open)) / range, 4) : null,
    upperWick: range > 0 ? round((Number(last.high) - Math.max(Number(last.open), Number(last.close))) / range, 4) : null,
    lowerWick: range > 0 ? round((Math.min(Number(last.open), Number(last.close)) - Number(last.low)) / range, 4) : null,
  };
  const noisePerCandle = atr === null ? null : round(atr, 8);
  const noiseHorizon = atr === null ? null : round(atr * Math.sqrt(policy.horizonCandles), 8);
  const lookback = Math.min(4, closes.length - 1);
  const momentumRaw = atr && atr > 0 ? (closes[closes.length - 1] - closes[closes.length - 1 - lookback]) / atr : null;
  const shortMomentum = momentumRaw === null ? null : round(momentumRaw, 4);
  const shortHorizonDirection = shortMomentum === null || (shortMomentum > -0.05 && shortMomentum < 0.05) ? "NEUTRAL" : shortMomentum >= 0.05 ? "BULLISH" : "BEARISH";
  const returns = [];
  for (let index = Math.max(1, closes.length - 20); index < closes.length; index += 1) returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
  const meanReturn = returns.length ? returns.reduce((acc, value) => acc + value, 0) / returns.length : 0;
  const realizedVolatility = returns.length ? round(Math.sqrt(returns.reduce((acc, value) => acc + (value - meanReturn) ** 2, 0) / returns.length) * Number(last.close), 8) : null;

  const trendBase = closes[closes.length - 30] ?? closes[0];
  const epsilon = Number(last.close) * 0.00002;
  const structuralTrend = Number(last.close) > trendBase + epsilon ? "BULLISH" : Number(last.close) < trendBase - epsilon ? "BEARISH" : "NEUTRAL";

  const touchUpper = bands ? Number(last.close) >= bands.upper || bands.position >= policy.bandTouchPosition : false;
  const touchLower = bands ? Number(last.close) <= bands.lower || bands.position <= 1 - policy.bandTouchPosition : false;
  const outsideUpper = bands ? Number(last.close) > bands.upper : false;
  const outsideLower = bands ? Number(last.close) < bands.lower : false;
  const rejectionUpperNow = Boolean(previousBand && bands && Number(prev.close) > previousBand.upper && Number(last.close) <= bands.upper);
  const rejectionLowerNow = Boolean(previousBand && bands && Number(prev.close) < previousBand.lower && Number(last.close) >= bands.lower);
  const dominantDI = spread === null ? null : spread >= policy.strongDiMargin ? "PLUS" : spread <= -policy.strongDiMargin ? "MINUS" : "BALANCED";
  const adxRising = adxSlope !== null && adxSlope > policy.adxRisingSlope;
  const adxFalling = adxSlope !== null && adxSlope < -policy.adxStabilizeBand;
  const adxStabilizing = adxSlope !== null && Math.abs(adxSlope) <= policy.adxStabilizeBand;
  const bandRidingUpper = Boolean(touchUpper && adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && expanding);
  const bandRidingLower = Boolean(touchLower && adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && expanding);
  const strongContinuationUpper = Boolean(adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && minusSlope !== null && minusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding);
  const strongContinuationLower = Boolean(adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && plusSlope !== null && plusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding);

  return {
    status: rsi <= policy.rsiBuyThreshold ? "BUY_EXTREME" : rsi >= policy.rsiSellThreshold ? "SELL_EXTREME" : "NO_OPPORTUNITY",
    reason: "OK", closedCandles: closed.length, at: num(now) ?? Date.now(),
    rsi: round(rsi, 4), rsiPrevious: round(rsiPrevious, 4), rsiSlope, rsiBand: rsiBandV3(rsi),
    bollinger: bands ? {
      upper: round(bands.upper, 8), middle: round(bands.middle, 8), lower: round(bands.lower, 8),
      width: round(bands.width, 8), widthSlope, expanding, position: round(bands.position, 4), close: round(Number(last.close), 8),
      distanceToUpper: round(bands.distanceToUpper, 8), distanceToLower: round(bands.distanceToLower, 8),
      touchUpper, touchLower, outsideUpper, outsideLower,
    } : null,
    dmi: adx ? { plusDI: round(adx.plusDI, 4), minusDI: round(adx.minusDI, 4), spread, spreadSlope, plusSlope, minusSlope } : null,
    adx: adx ? { value: round(adx.adx, 4), slope: adxSlope, rising: adxRising, falling: adxFalling, stabilizing: adxStabilizing, strong: adx.adx >= policy.adxStrong } : null,
    atr: noisePerCandle,
    structuralTrend, shortHorizonDirection, shortMomentum,
    velocity, acceleration, candleAnatomy, noisePerCandle, noiseHorizon, realizedVolatility,
    bandRiding: { upper: bandRidingUpper, lower: bandRidingLower },
    strongContinuation: { upper: strongContinuationUpper, lower: strongContinuationLower },
    dominantDI, rejectionUpperNow, rejectionLowerNow,
  };
}

/* ------------------------------------------------------------------ *
 * Candidate lifecycle (freshness + continuidade)
 * ------------------------------------------------------------------ */

function snapshotV3(indicators) {
  return {
    at: indicators.at, rsi: indicators.rsi, rsiBand: indicators.rsiBand,
    bollinger: indicators.bollinger ? { position: indicators.bollinger.position, upper: indicators.bollinger.upper, lower: indicators.bollinger.lower, width: indicators.bollinger.width, expanding: indicators.bollinger.expanding } : null,
    dmi: indicators.dmi ? { plusDI: indicators.dmi.plusDI, minusDI: indicators.dmi.minusDI, spread: indicators.dmi.spread } : null,
    adx: indicators.adx ? { value: indicators.adx.value, slope: indicators.adx.slope } : null,
    structuralTrend: indicators.structuralTrend, shortHorizonDirection: indicators.shortHorizonDirection,
  };
}

export function createEpisodeV3({ indicators, at = null, expiryAt = null } = {}) {
  const policy = RSI_V3_POLICY;
  const rsi = num(indicators?.rsi);
  if (rsi === null) return null;
  const direction = rsi <= policy.rsiBuyThreshold ? "BUY" : rsi >= policy.rsiSellThreshold ? "SELL" : null;
  if (!direction) return null;
  const atMs = num(at) ?? indicators.at;
  const deep = direction === "BUY" ? rsi <= policy.extremeBuyDeep : rsi >= policy.extremeSellDeep;
  const extreme = direction === "BUY" ? rsi <= policy.extremeBuyThreshold : rsi >= policy.extremeSellThreshold;
  return {
    direction, candidateAt: atMs, candidateRsi: rsi, candidateRsiBand: rsiBandV3(rsi),
    candidatePrice: num(indicators?.bollinger?.close), candidateExpiry: num(expiryAt),
    candidateDirection: direction,
    candidateReason: `${direction === "BUY" ? "RSI_EXTREME_BUY" : "RSI_EXTREME_SELL"}_${rsiBandV3(rsi)}${deep ? "_DEEP" : extreme ? "_EXTREME" : ""}`,
    candidateIndicators: snapshotV3(indicators),
    extremeDeep: deep, extreme: extreme,
    minRsi: rsi, maxRsi: rsi,
    touchedUpper: indicators?.bollinger?.touchUpper === true, touchedLower: indicators?.bollinger?.touchLower === true,
    outsideUpper: indicators?.bollinger?.outsideUpper === true, outsideLower: indicators?.bollinger?.outsideLower === true,
    reenteredUpper: false, reenteredLower: false,
    maxPosition: num(indicators?.bollinger?.position), minPosition: num(indicators?.bollinger?.position),
    maxPlusDI: num(indicators?.dmi?.plusDI), minPlusDI: num(indicators?.dmi?.plusDI),
    maxMinusDI: num(indicators?.dmi?.minusDI), minMinusDI: num(indicators?.dmi?.minusDI),
    maxSpread: num(indicators?.dmi?.spread), minSpread: num(indicators?.dmi?.spread),
    oldDiWeakStreak: 0, newDiReactStreak: 0, neutralTicks: 0, lateralTicks: 0,
    expiryAt: num(expiryAt), carriedExpiries: 0, lastAt: atMs,
  };
}

/**
 * Atualizacao causal do episodio. Retorna { episode, event }.
 * event: CANDIDATE_CREATED | CANDIDATE_UPDATED | CANDIDATE_FLIPPED |
 *        CANDIDATE_EXPIRED_AGE | CANDIDATE_CONTINUITY_LOST_NEUTRAL |
 *        CANDIDATE_CONTINUITY_LOST_LATERAL | NO_CANDIDATE
 */
export function updateEpisodeV3({ episode = null, indicators, at = null } = {}) {
  const policy = RSI_V3_POLICY;
  const atMs = num(at) ?? indicators?.at ?? Date.now();
  const rsi = num(indicators?.rsi);
  const side = rsi === null ? null : rsi <= policy.rsiBuyThreshold ? "BUY" : rsi >= policy.rsiSellThreshold ? "SELL" : null;
  if (!episode) {
    const created = createEpisodeV3({ indicators, at: atMs, expiryAt: indicators?.targetExpiryAt ?? null });
    return created ? { episode: created, event: "CANDIDATE_CREATED" } : { episode: null, event: "NO_CANDIDATE" };
  }
  if (side !== null && side !== episode.direction) {
    const created = createEpisodeV3({ indicators, at: atMs, expiryAt: indicators?.targetExpiryAt ?? episode.candidateExpiry });
    return { episode: created, event: "CANDIDATE_FLIPPED" };
  }
  // Freshness: extremo historico NAO autoriza para sempre.
  if (atMs - episode.candidateAt > policy.candidateMaxAgeMs) return { episode: null, event: "CANDIDATE_EXPIRED_AGE" };
  // Continuidade: RSI em regiao neutra por tempo demais + mercado lateralizando = tese morreu.
  const inNeutralBand = rsi !== null && rsi >= policy.neutralBandLow && rsi <= policy.neutralBandHigh;
  episode.neutralTicks = inNeutralBand ? (episode.neutralTicks ?? 0) + 1 : 0;
  const lateral = indicators?.structuralTrend === "NEUTRAL" && indicators?.shortHorizonDirection === "NEUTRAL" && Math.abs(num(indicators?.velocity) ?? 0) < 0.1;
  episode.lateralTicks = lateral ? (episode.lateralTicks ?? 0) + 1 : 0;
  const neutralExpired = episode.neutralTicks >= 3 && atMs - episode.candidateAt > policy.candidateNeutralGraceMs;
  if (neutralExpired && episode.lateralTicks >= 2) return { episode: null, event: "CANDIDATE_CONTINUITY_LOST_LATERAL" };
  if (neutralExpired && episode.neutralTicks >= 6) return { episode: null, event: "CANDIDATE_CONTINUITY_LOST_NEUTRAL" };

  if (rsi !== null) { episode.minRsi = Math.min(episode.minRsi ?? rsi, rsi); episode.maxRsi = Math.max(episode.maxRsi ?? rsi, rsi); }
  const band = indicators?.bollinger;
  if (band) {
    if (band.touchUpper) episode.touchedUpper = true;
    if (band.touchLower) episode.touchedLower = true;
    if (band.outsideUpper) episode.outsideUpper = true;
    if (band.outsideLower) episode.outsideLower = true;
    if (episode.outsideUpper && !band.outsideUpper) episode.reenteredUpper = true;
    if (episode.outsideLower && !band.outsideLower) episode.reenteredLower = true;
    if (episode.touchedUpper && band.position < policy.bandTouchPosition) episode.reenteredUpper = true;
    if (episode.touchedLower && band.position > 1 - policy.bandTouchPosition) episode.reenteredLower = true;
    episode.maxPosition = Math.max(episode.maxPosition ?? band.position, band.position);
    episode.minPosition = Math.min(episode.minPosition ?? band.position, band.position);
  }
  const dmi = indicators?.dmi;
  if (dmi) {
    episode.maxPlusDI = Math.max(episode.maxPlusDI ?? dmi.plusDI ?? -Infinity, dmi.plusDI ?? -Infinity);
    episode.minPlusDI = Math.min(episode.minPlusDI ?? dmi.plusDI ?? Infinity, dmi.plusDI ?? Infinity);
    episode.maxMinusDI = Math.max(episode.maxMinusDI ?? dmi.minusDI ?? -Infinity, dmi.minusDI ?? -Infinity);
    episode.minMinusDI = Math.min(episode.minMinusDI ?? dmi.minusDI ?? Infinity, dmi.minusDI ?? Infinity);
    episode.maxSpread = Math.max(episode.maxSpread ?? dmi.spread ?? -Infinity, dmi.spread ?? -Infinity);
    episode.minSpread = Math.min(episode.minSpread ?? dmi.spread ?? Infinity, dmi.spread ?? Infinity);
    const oldWeak = episode.direction === "BUY" ? (dmi.minusSlope !== null && dmi.minusSlope < 0) : (dmi.plusSlope !== null && dmi.plusSlope < 0);
    const newReact = episode.direction === "BUY" ? (dmi.plusSlope !== null && dmi.plusSlope > 0) : (dmi.minusSlope !== null && dmi.minusSlope > 0);
    episode.oldDiWeakStreak = oldWeak ? (episode.oldDiWeakStreak ?? 0) + 1 : 0;
    episode.newDiReactStreak = newReact ? (episode.newDiReactStreak ?? 0) + 1 : 0;
  }
  episode.expiryAt = num(indicators?.targetExpiryAt) ?? episode.expiryAt;
  episode.lastAt = atMs;
  episode.lastIndicators = snapshotV3(indicators);
  return { episode, event: "CANDIDATE_UPDATED" };
}

/* ------------------------------------------------------------------ *
 * DMI/ADX em dois estagios (corrige ADX-caindo != nova direcao)
 * ------------------------------------------------------------------ */

function spreadContraction({ episode, indicators }) {
  const policy = RSI_V3_POLICY;
  const maxSpread = num(episode?.maxSpread);
  const spread = num(indicators?.dmi?.spread);
  if (maxSpread === null || spread === null) return { clear: false, amount: null, threshold: null };
  const threshold = Math.max(policy.spreadContractionMin, Math.abs(maxSpread) * policy.spreadContractionRatio);
  const amount = directionContraction({ direction: episode?.direction, maxSpread, spread });
  return { clear: amount >= threshold, amount: round(amount, 4), threshold: round(threshold, 4) };
}

function directionContraction({ direction, maxSpread, spread }) {
  // SELL: spread bullish (positivo) contrai na direcao de cair. BUY: spread bearish (negativo) contrai subindo.
  if (direction === "SELL") return maxSpread - spread;
  return spread - maxSpread;
}

/** STAGE 1 = tendencia antiga enfraquecendo. STAGE 2 = nova direcao emergindo. NUNCA confundir. */
export function evaluateStageV3({ indicators, episode } = {}) {
  const policy = RSI_V3_POLICY;
  if (!episode) return { direction: null, stage: "NONE", strength: "NONE", weakening: null, emerging: null, blockers: [{ code: "NO_CANDIDATE" }] };
  const direction = episode.direction;
  const sell = direction === "SELL";
  const dmi = indicators?.dmi ?? {};
  const adx = indicators?.adx ?? {};
  const contraction = spreadContraction({ episode, indicators });
  const oldDiFalling = sell ? num(dmi.plusSlope) !== null && dmi.plusSlope < 0 : num(dmi.minusSlope) !== null && dmi.minusSlope < 0;
  const newDiRising = sell ? num(dmi.minusSlope) !== null && dmi.minusSlope > 0 : num(dmi.plusSlope) !== null && dmi.plusSlope > 0;
  const diCross = sell ? num(dmi.minusDI) !== null && num(dmi.plusDI) !== null && dmi.minusDI > dmi.plusDI : num(dmi.plusDI) !== null && num(dmi.minusDI) !== null && dmi.plusDI > dmi.minusDI;
  // Reacao do DI novo so conta como "nova direcao" com respaldo da tendencia antiga perdendo forca,
  // de cruzamento ou de contracao clara do spread (evita ler forca antiga como reversao).
  const newDiReacting = newDiRising && (oldDiFalling || diCross || contraction.clear);
  const adxNotStrengthening = adx.slope === null || adx.slope === undefined || adx.slope <= policy.adxStabilizeBand;
  const adxStoppedFalling = adx.slope !== null && adxSlopeStopped(adx, policy);
  const adxRisingWithNewDi = diCross && num(adx.slope) !== null && adx.slope > policy.adxRisingSlope;
  const weakening = {
    oldDiFalling,
    spreadContracting: contraction.clear,
    adxNotStrengthening,
    oldDiWeakStreak: episode.oldDiWeakStreak ?? 0,
    contractionAmount: contraction.amount,
  };
  const emerging = {
    newDiReacting,
    newDiReactStreak: episode.newDiReactStreak ?? 0,
    diCross,
    adxStoppedFalling,
    adxRisingWithNewDi,
    adxTransition: adxStoppedFalling || adxRisingWithNewDi,
  };
  const stage1 = oldDiFalling && (contraction.clear || newDiReacting) && adxNotStrengthening;
  const stage2 = newDiReacting && (adxStoppedFalling || adxRisingWithNewDi || diCross);
  const strengths = [];
  if (diCross) strengths.push("DI_CROSS");
  if (adxRisingWithNewDi) strengths.push("ADX_RISING_NEW_DI");
  if ((episode.oldDiWeakStreak ?? 0) >= 2 && (episode.newDiReactStreak ?? 0) >= 2) strengths.push("SUSTAINED_TWO_SIDED");
  if (contraction.clear) strengths.push("SPREAD_CONTRACTION");
  const strength = strengths.includes("DI_CROSS") && strengths.includes("ADX_RISING_NEW_DI") ? "STRONG" : strengths.length >= 2 ? "CLEAR" : strengths.length === 1 ? "WEAK" : "NONE";
  const bandRidingAgainst = sell ? indicators?.bandRiding?.upper === true : indicators?.bandRiding?.lower === true;
  const strongContinuationAgainst = sell ? indicators?.strongContinuation?.upper === true : indicators?.strongContinuation?.lower === true;
  const blockers = [];
  if (bandRidingAgainst) blockers.push({ code: "BAND_RIDING_AGAINST" });
  if (strongContinuationAgainst) blockers.push({ code: "STRONG_CONTINUATION_AGAINST" });
  return {
    direction, stage: stage2 ? "NEW_DIRECTION_EMERGING" : stage1 ? "OLD_TREND_WEAKENING" : "NONE",
    strength, weakening, emerging, blockers, strengths,
    adxMeaning: stage1 && !stage2 ? "OLD_TREND_WEAKENING_ONLY" : stage2 ? "NEW_DIRECTION_EMERGING" : "INSUFFICIENT",
  };
}

function adxSlopeStopped(adx, policy) {
  if (adx.slope === null || adx.slope === undefined) return true;
  return adx.slope >= -policy.adxStabilizeBand;
}

/* ------------------------------------------------------------------ *
 * Projecao ~60s + EXPECTED_EXPIRY_CUSHION (deterministico e auditavel)
 * ------------------------------------------------------------------ */

export function projectExpiryV3({ indicators, direction, entryPrice = null } = {}) {
  const policy = RSI_V3_POLICY;
  if (!indicators || (direction !== "BUY" && direction !== "SELL")) return null;
  const atr = num(indicators.noisePerCandle) ?? num(indicators.atr);
  const price = num(entryPrice) ?? num(indicators?.bollinger?.close);
  if (atr === null || atr <= 0 || price === null) return null;
  const impulse = num(indicators.shortMomentum) ?? 0;
  const favorableImpulse = direction === "BUY" ? impulse : -impulse;
  const velocity = num(indicators.velocity) ?? 0;
  const acceleration = num(indicators.acceleration) ?? 0;
  const favorableVelocity = direction === "BUY" ? velocity : -velocity;
  const favorableAcceleration = direction === "BUY" ? acceleration : -acceleration;
  const baseUnits = clamp(0.4 + 0.6 * Math.max(0, favorableImpulse) + 0.2 * clamp(favorableAcceleration, -1, 1), policy.cushionMin * 0.5, 2.5);
  const scale = Math.sqrt(policy.horizonCandles / 3);
  const expectedDisplacement = round(atr * baseUnits * scale, 8);
  const noiseHorizon = round(atr * Math.sqrt(policy.horizonCandles), 8);
  const expectedCushionNormalized = noiseHorizon > 0 ? round(expectedDisplacement / noiseHorizon, 4) : null;
  const favorable = direction === "BUY" ? price + expectedDisplacement : price - expectedDisplacement;
  const adverse = direction === "BUY" ? price - expectedDisplacement : price + expectedDisplacement;
  return {
    projectionAt: num(indicators.at) ?? Date.now(), direction, entryPrice: round(price, 8),
    expectedDisplacement, expectedExpiryZone: { favorable: round(favorable, 8), adverse: round(adverse, 8) },
    expectedCushionNormalized, noisePerCandle: round(atr, 8), noiseHorizon,
    favorableImpulse: round(favorableImpulse, 4), favorableVelocity: round(favorableVelocity, 4),
    method: "DETERMINISTIC_ATR_CONTINUATION_V1",
    fragile: expectedCushionNormalized !== null && expectedCushionNormalized < policy.cushionMin,
    strong: expectedCushionNormalized !== null && expectedCushionNormalized >= policy.cushionStrong,
    invalidationCondition: direction === "BUY"
      ? "close volta a fechar abaixo da lower band vigente ou RSI recua para < RSI do candidate"
      : "close volta a fechar acima da upper band vigente ou RSI sobe para > RSI do candidate",
  };
}

/* ------------------------------------------------------------------ *
 * Revalidacao "primeira vista" (T-5): a tese ainda faria sentido AGORA?
 * ------------------------------------------------------------------ */

export function firstSightThesisV3({ indicators, direction } = {}) {
  const policy = RSI_V3_POLICY;
  if (!indicators || (direction !== "BUY" && direction !== "SELL")) return { valid: false, components: null, reason: "NO_DIRECTION" };
  const sell = direction === "SELL";
  const band = indicators.bollinger ?? {};
  const dmi = indicators.dmi ?? {};
  const adx = indicators.adx ?? {};
  const newDiDominant = sell ? num(dmi.minusDI) !== null && num(dmi.plusDI) !== null && dmi.minusDI > dmi.plusDI : num(dmi.plusDI) !== null && num(dmi.minusDI) !== null && dmi.plusDI > dmi.minusDI;
  const components = {
    rsiExtremeOrLeaving: sell
      ? num(indicators.rsi) >= policy.rsiSellThreshold - 5 || num(indicators.rsiPrevious) >= policy.rsiSellThreshold
      : num(indicators.rsi) <= policy.rsiBuyThreshold + 5 || num(indicators.rsiPrevious) <= policy.rsiBuyThreshold,
    rsiMovingWithDirection: sell ? num(indicators.rsiSlope) !== null && indicators.rsiSlope <= 0 : num(indicators.rsiSlope) !== null && indicators.rsiSlope >= 0,
    bandRejectionNow: sell ? (indicators.rejectionUpperNow === true || (band.touchUpper === true && band.position < policy.bandTouchPosition)) : (indicators.rejectionLowerNow === true || (band.touchLower === true && band.position > 1 - policy.bandTouchPosition)),
    bandNotRidingAgainst: sell ? indicators.bandRiding?.upper !== true : indicators.bandRiding?.lower !== true,
    oldDiFalling: sell ? num(dmi.plusSlope) !== null && dmi.plusSlope < 0 : num(dmi.minusSlope) !== null && dmi.minusSlope < 0,
    newDiReacting: sell ? num(dmi.minusSlope) !== null && dmi.minusSlope > 0 : num(dmi.plusSlope) !== null && dmi.plusSlope > 0,
    // ADX subindo COM a nova direcao dominante e tendencia nova, nao a antiga.
    adxNotStrengtheningOld: adx.slope === null || adx.slope === undefined || adx.slope <= policy.adxStabilizeBand || newDiDominant,
    shortMomentumWithDirection: sell ? indicators.shortHorizonDirection === "BEARISH" || (num(indicators.velocity) ?? 0) < 0 : indicators.shortHorizonDirection === "BULLISH" || (num(indicators.velocity) ?? 0) > 0,
    noStrongContinuationAgainst: sell ? indicators.strongContinuation?.upper !== true : indicators.strongContinuation?.lower !== true,
  };
  const hardFails = [];
  if (!components.rsiMovingWithDirection) hardFails.push("RSI_SEM_DIRECAO");
  if (!components.bandRejectionNow) hardFails.push("SEM_REJEICAO_ATUAL");
  if (!components.bandNotRidingAgainst) hardFails.push("BAND_RIDING_AGAINST");
  if (!components.newDiReacting) hardFails.push("NOVA_DIRECAO_AUSENTE");
  if (!components.adxNotStrengtheningOld) hardFails.push("ADX_FORTALECENDO_ANTIGA");
  if (!components.noStrongContinuationAgainst) hardFails.push("CONTINUACAO_FORTE");
  return { valid: hardFails.length === 0, components, hardFails, reason: hardFails.length ? hardFails.join("+") : "FIRST_SIGHT_THESIS_OK" };
}

/* ------------------------------------------------------------------ *
 * Avaliacao de entrada V3 (NORMAL_T5 / EXTREME_REVERSAL_OVERRIDE)
 * ------------------------------------------------------------------ */

export function evaluateV3Entry({ indicators, episode, window = null, at = null } = {}) {
  const policy = RSI_V3_POLICY;
  const atMs = num(at) ?? num(indicators?.at) ?? Date.now();
  if (!episode) return { strategy: V3_ID, direction: null, decision: "WAIT", accepted: false, status: "NO_CANDIDATE", reason: "SEM_EPISODIO_RSI_EXTREMO" };
  const direction = episode.direction;
  const sell = direction === "SELL";
  const stageEval = evaluateStageV3({ indicators, episode });
  const rsi = num(indicators?.rsi);
  const rsiInNeutral = rsi !== null && rsi >= policy.neutralBandLow && rsi <= policy.neutralBandHigh;
  const candidateFresh = atMs - episode.candidateAt <= policy.candidateMaxAgeMs;
  const band = indicators?.bollinger ?? {};
  const projection = projectExpiryV3({ indicators, direction, entryPrice: band.close ?? null });
  const firstSight = firstSightThesisV3({ indicators, direction });
  const rsiLeaving = sell
    ? rsi !== null && rsi < (episode.maxRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope <= 0.05)
    : rsi !== null && rsi > (episode.minRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope >= -0.05);
  const bandTouch = sell ? episode.touchedUpper === true : episode.touchedLower === true;
  const bandReentry = sell
    ? episode.reenteredUpper === true || (episode.outsideUpper === true && band.position < 1) || (band.touchUpper === true && band.position < policy.bandTouchPosition)
    : episode.reenteredLower === true || (episode.outsideLower === true && band.position > 0) || (band.touchLower === true && band.position > 1 - policy.bandTouchPosition);
  const cushionOk = projection !== null && projection.fragile !== true;
  const cushionStrong = projection !== null && projection.strong === true;
  const neutralNeedsStrong = rsiInNeutral;
  const strongConfirmation = stageEval.strength === "STRONG" || (stageEval.strength === "CLEAR" && firstSight.valid);
  const extremeEpisode = sell ? episode.candidateRsi >= policy.extremeSellThreshold : episode.candidateRsi <= policy.extremeBuyThreshold;
  const deepExtreme = sell ? episode.candidateRsi >= policy.extremeSellDeep : episode.candidateRsi <= policy.extremeBuyDeep;
  const overrideEligible = Boolean(
    extremeEpisode && stageEval.stage === "NEW_DIRECTION_EMERGING" && stageEval.strength !== "WEAK" &&
    bandReentry && rsiLeaving && cushionStrong && firstSight.valid && stageEval.blockers.length === 0 &&
    (sell ? (episode.outsideUpper === true || indicators.rejectionUpperNow === true) : (episode.outsideLower === true || indicators.rejectionLowerNow === true))
  );

  const blockers = [];
  if (!candidateFresh) blockers.push("CANDIDATE_EXPIRED");
  if (!rsiLeaving) blockers.push("RSI_NAO_SAINDO_DO_EXTREMO");
  if (!bandTouch) blockers.push("SEM_TOQUE_BOLLINGER");
  if (!bandReentry) blockers.push("SEM_REJEICAO_REENTRADA");
  if (stageEval.stage === "OLD_TREND_WEAKENING" || stageEval.stage === "NONE") blockers.push("NOVA_DIRECAO_AINDA_NAO_EMERGIU");
  for (const blocker of stageEval.blockers) blockers.push(blocker.code);
  if (projection === null) blockers.push("PROJECAO_INDISPONIVEL");
  else if (projection.fragile) blockers.push("FRAGILE_ENTRY");
  if (neutralNeedsStrong && !(strongConfirmation && cushionStrong)) blockers.push("RSI_NEUTRO_SEM_CONFIRMACAO_FORTE");
  if (rsiInNeutral && firstSight.valid !== true) blockers.push("RSI_NEUTRO_TESE_AMBIGUA");

  const accepted = blockers.length === 0;
  const overrideAllowed = Boolean(overrideEligible && window && atMs < window.entryWindowOpensAt && atMs >= window.purchaseCutoffAt - policy.overrideMinLeadMs);
  const entryMode = !accepted ? null : overrideAllowed ? "EXTREME_REVERSAL_OVERRIDE" : "NORMAL_T5";
  return {
    strategy: V3_ID, direction, decision: accepted ? direction : "WAIT", accepted,
    status: accepted ? "V3_CONFIRMED" : stageEval.blockers.length ? "V3_BLOCKED_STRONG_TREND" : "V3_WAITING_CONTINUITY",
    reason: accepted ? `V3_CONFIRMADO_${stageEval.strength}${entryMode === "EXTREME_REVERSAL_OVERRIDE" ? "_OVERRIDE" : ""}` : blockers.join("+"),
    stage: stageEval.stage, strength: stageEval.strength,
    weakening: stageEval.weakening, emerging: stageEval.emerging, strengths: stageEval.strengths,
    confirmations: { candidateFresh, rsiLeaving, bandTouch, bandReentry, rsiInNeutral, strongConfirmation, extremeEpisode, deepExtreme, overrideEligible, firstSight, cushionOk, cushionStrong, rsiBand: episode.candidateRsiBand },
    blockers, projection, firstSight, entryMode,
    candidate: { candidateAt: episode.candidateAt, candidateAgeMs: atMs - episode.candidateAt, candidateRsi: episode.candidateRsi, candidatePrice: episode.candidatePrice, candidateExpiry: episode.candidateExpiry, candidateDirection: direction, candidateReason: episode.candidateReason },
  };
}

/* ------------------------------------------------------------------ *
 * Qualidade do resultado (relativa ao ruido; nao usar pips universais)
 * ------------------------------------------------------------------ */

export function classifyOutcomeV3({ result, entryPrice, expiryPrice, direction, noiseHorizon = null } = {}) {
  const entry = num(entryPrice); const expiry = num(expiryPrice); const noise = num(noiseHorizon);
  if (entry === null || expiry === null) return { qualityClass: "UNKNOWN", actualDisplacement: null, actualCushion: null, projectionCorrect: null };
  const signed = direction === "SELL" ? entry - expiry : expiry - entry;
  const actualDisplacement = round(signed, 8);
  const actualCushion = noise !== null && noise > 0 ? round(Math.abs(signed) / noise, 4) : null;
  if (result === "DRAW") return { qualityClass: "DRAW", actualDisplacement, actualCushion, projectionCorrect: false };
  const ratio = actualCushion ?? 0;
  let qualityClass;
  if (result === "WIN") qualityClass = ratio >= 0.75 ? "STRONG_WIN" : ratio >= 0.25 ? "NORMAL_WIN" : "THIN_WIN";
  else qualityClass = ratio >= 0.75 ? "STRONG_LOSS" : ratio >= 0.25 ? "NORMAL_LOSS" : "THIN_LOSS";
  return { qualityClass, actualDisplacement, actualCushion, projectionCorrect: result === "WIN" };
}

export function rsiV3FreezeManifest() {
  return {
    schema: "rsi-reversal-pullback-v3-freeze-v1",
    version: RSI_V3_VERSION,
    frozenAtUtc: new Date().toISOString(),
    policy: RSI_V3_POLICY,
    noTuning: true,
    rules: {
      detector: "RSI14 extremo (<=30/>=70) apenas como detector; candidate NASCE no extremo",
      lifecycle: "candidate freshness + continuidade; RSI neutro/lateral por tempo demais cancela",
      stage1: "tendencia antiga enfraquecendo (DI antigo caindo, spread contraindo, ADX nao fortalecendo) mantem candidate vivo, NAO autoriza",
      stage2: "nova direcao emergindo (DI novo reagindo/subindo/cruzando + ADX para de cair/estabiliza/sobe com DI novo dominante) — sem cross obrigatorio",
      bollinger: "touch/outside + rejeicao/reentrada + afastamento; band riding/expansao contra bloqueiam",
      revalidation: "recalculo completo na janela final (T-5) com teste 'primeira vista'; sem tese atual => CANCEL",
      neutralSubmit: "RSI em 45-55 no submit exige confirmacao forte + cushion forte",
      projection: "projecao deterministica ~60s (ATR/impulso/velocidade) com EXPECTED_EXPIRY_CUSHION; fragile => WAIT",
      override: "EXTREME_REVERSAL_OVERRIDE apenas RSI<=15/>=85 (deep <=10/>=90) com confluencia excepcional; duvida => fluxo normal",
      quality: "STRONG/NORMAL/THIN WIN/LOSS relativo ao ruido (actualCushion), nao pips fixos",
      execution: "PRACTICE only, stake R$10, unico caminho agent-v3 -> requestOrder",
    },
  };
}
