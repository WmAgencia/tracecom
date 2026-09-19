/**
 * RSI SKILLS V2 — STRICT V2 e PULLBACK V2.
 *
 * Evolucao das skills V1 (RSI_REVERSAL_STRICT_V1 / RSI_EXTREME_PULLBACK_V1),
 * SEM alterar as V1 (rsi-variants.mjs / rsi-reversal.mjs permanecem congeladas).
 *
 * Principio central (igual ao V1): RSI e SOMENTE o detector de oportunidade.
 *   BUY  candidate: RSI <= 30
 *   SELL candidate: RSI >= 70
 * O candidate NASCE no RSI extremo (registrado em candidateAt/snapshot); a entrada
 * pode acontecer depois, enquanto o RSI estiver SAINDO do extremo e ainda pertencer
 * ao MESMO episodio de reversao. Candidate com RSI neutro NUNCA existe.
 *
 * STRICT V2  — mais rigorosa: exige Bollinger + enfraquecimento do DI antigo +
 *              reacao do DI oposto (ou contracao clara do spread) + ADX parando de
 *              fortalecer a tendencia antiga; bloqueia band riding/continuacao forte.
 * PULLBACK V2 — mais permissiva: aceita pullback curto contra a estrutura, mas
 *              bloqueia com forca continuacao (band riding + DI dominante + ADX
 *              subindo + bandas expandindo).
 *
 * Frontend/estrategia pura: sem I/O, sem ordem. A ordem vive no runner/Execution Gate.
 */

import { rsiWilder, adxWilder, atrWilder } from "./feature-engine.mjs";

export const STRICT_V2_ID = "RSI_REVERSAL_STRICT_V2";
export const PULLBACK_V2_ID = "RSI_EXTREME_PULLBACK_V2";
export const RSI_SKILLS_V2 = Object.freeze([STRICT_V2_ID, PULLBACK_V2_ID]);
export const RSI_SKILLS_V2_VERSION = "RSI_SKILLS_V2_V1";

export const RSI_SKILLS_V2_POLICY = Object.freeze({
  version: RSI_SKILLS_V2_VERSION,
  detector: "RSI14_EXTREME_ONLY",
  rsiBuyThreshold: 30,
  rsiSellThreshold: 70,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  minClosedCandles5s: 60,
  episodeNeutralBuyExit: 50,
  episodeNeutralSellExit: 50,
  episodeMaxAgeMs: 30 * 60_000,
  strongDiMargin: 8,
  adxStrong: 25,
  adxRisingSlope: 0.5,
  spreadContractionMin: 2,
  spreadContractionRatio: 0.15,
  bandTouchPosition: 0.9,
  noTuning: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

/* ------------------------------------------------------------------ *
 * Indicadores (mesmos periodos congelados: RSI 14, BB 20/2, DMI/ADX 14)
 * ------------------------------------------------------------------ */

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

/**
 * Avaliacao completa e causal dos indicadores do V2 (independente do RSI estar extremo).
 * Retorna TODOS os campos exigidos pelo item 8 do pedido (candidate/submit/expiry audit).
 */
export function evaluateIndicatorsV2({ candles, now = Date.now() } = {}) {
  const policy = RSI_SKILLS_V2_POLICY;
  const list = Array.isArray(candles) ? candles : [];
  const closed = list.filter((candle) => num(candle?.bucketEnd) !== null && Number(candle.bucketEnd) <= Number(now) && Number.isFinite(Number(candle.close)));
  const base = {
    status: "WAIT", reason: "INSUFFICIENT_HISTORY", closedCandles: closed.length, at: num(now) ?? Date.now(),
    rsi: null, rsiPrevious: null, rsiSlope: null, rsiBand: null,
    bollinger: null, dmi: null, adx: null,
    structuralTrend: "UNKNOWN", shortHorizonDirection: "UNKNOWN", shortMomentum: null,
    bandRiding: { upper: false, lower: false }, dominantDI: null, strongContinuation: { upper: false, lower: false },
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

  const atr = atrWilder(closed, 14);
  const lookback = Math.min(4, closes.length - 1);
  const momentumRaw = atr && atr > 0 ? (closes[closes.length - 1] - closes[closes.length - 1 - lookback]) / atr : null;
  const shortMomentum = momentumRaw === null ? null : round(momentumRaw, 4);
  const shortHorizonDirection = shortMomentum === null || shortMomentum > -0.05 && shortMomentum < 0.05 ? "NEUTRAL" : shortMomentum >= 0.05 ? "BULLISH" : "BEARISH";

  const trendBase = closes[closes.length - 30] ?? closes[0];
  const trendLast = closes[closes.length - 1];
  const epsilon = trendLast * 0.00002;
  const structuralTrend = trendLast > trendBase + epsilon ? "BULLISH" : trendLast < trendBase - epsilon ? "BEARISH" : "NEUTRAL";

  const touchUpper = bands ? bands.close >= bands.upper || bands.position >= policy.bandTouchPosition : false;
  const touchLower = bands ? bands.close <= bands.lower || bands.position <= 1 - policy.bandTouchPosition : false;
  const outsideUpper = bands ? bands.close > bands.upper : false;
  const outsideLower = bands ? bands.close < bands.lower : false;

  const dominantDI = spread === null ? null : spread >= policy.strongDiMargin ? "PLUS" : spread <= -policy.strongDiMargin ? "MINUS" : "BALANCED";
  const adxRising = adxSlope !== null && adxSlope > policy.adxRisingSlope;
  const bandRidingUpper = Boolean(touchUpper && adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && expanding);
  const bandRidingLower = Boolean(touchLower && adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && expanding);
  const strongContinuationUpper = Boolean(adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && minusSlope !== null && minusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding);
  const strongContinuationLower = Boolean(adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && plusSlope !== null && plusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding);

  const rsiBand = rsi <= 30 ? `BUY ${rsi <= 10 ? "0-10" : rsi <= 15 ? "10-15" : rsi <= 20 ? "15-20" : "20-30"}` : rsi >= 70 ? `SELL ${rsi >= 90 ? "90-100" : rsi >= 85 ? "85-90" : rsi >= 80 ? "80-85" : "70-80"}` : "NEUTRAL";

  return {
    status: rsi <= policy.rsiBuyThreshold ? "BUY_EXTREME" : rsi >= policy.rsiSellThreshold ? "SELL_EXTREME" : "NO_OPPORTUNITY",
    reason: "OK", closedCandles: closed.length, at: num(now) ?? Date.now(),
    rsi: round(rsi, 4), rsiPrevious: round(rsiPrevious, 4), rsiSlope, rsiBand,
    bollinger: bands ? {
      upper: round(bands.upper, 8), middle: round(bands.middle, 8), lower: round(bands.lower, 8),
      width: round(bands.width, 8), widthSlope, expanding, position: round(bands.position, 4),
      close: round(bands.close, 8), distanceToUpper: round(bands.distanceToUpper, 8), distanceToLower: round(bands.distanceToLower, 8),
      touchUpper, touchLower, outsideUpper, outsideLower,
    } : null,
    dmi: adx ? { plusDI: round(adx.plusDI, 4), minusDI: round(adx.minusDI, 4), spread, plusSlope, minusSlope } : null,
    adx: adx ? { value: round(adx.adx, 4), slope: adxSlope, rising: adxRising, strong: adx.adx >= policy.adxStrong } : null,
    structuralTrend, shortHorizonDirection, shortMomentum,
    bandRiding: { upper: bandRidingUpper, lower: bandRidingLower },
    dominantDI, strongContinuation: { upper: strongContinuationUpper, lower: strongContinuationLower },
  };
}

/* ------------------------------------------------------------------ *
 * Episodios de reversao (candidateAt obrigatoriamente em RSI extremo)
 * ------------------------------------------------------------------ */

function snapshotForEpisode(ind) {
  return {
    at: ind.at, rsi: ind.rsi, rsiBand: ind.rsiBand,
    bollinger: ind.bollinger ? { position: ind.bollinger.position, upper: ind.bollinger.upper, lower: ind.bollinger.lower, width: ind.bollinger.width, expanding: ind.bollinger.expanding } : null,
    dmi: ind.dmi ? { plusDI: ind.dmi.plusDI, minusDI: ind.dmi.minusDI, spread: ind.dmi.spread } : null,
    adx: ind.adx ? { value: ind.adx.value, slope: ind.adx.slope } : null,
    structuralTrend: ind.structuralTrend, shortHorizonDirection: ind.shortHorizonDirection,
  };
}

/** Cria um episodio a partir de RSI extremo. RSI neutro nunca cria candidate. */
export function createEpisodeV2({ indicators, at = null } = {}) {
  const rsi = num(indicators?.rsi);
  if (rsi === null) return null;
  const side = rsi <= RSI_SKILLS_V2_POLICY.rsiBuyThreshold ? "BUY" : rsi >= RSI_SKILLS_V2_POLICY.rsiSellThreshold ? "SELL" : null;
  if (!side) return null;
  const atMs = num(at) ?? indicators.at;
  return {
    direction: side, candidateAt: atMs, candidateRsi: rsi, candidateRsiBand: indicators.rsiBand ?? null,
    candidateIndicators: snapshotForEpisode(indicators), candidateSpread: num(indicators?.dmi?.spread),
    candidatePlusDI: num(indicators?.dmi?.plusDI), candidateMinusDI: num(indicators?.dmi?.minusDI),
    minRsi: rsi, maxRsi: rsi,
    touchedUpper: indicators?.bollinger?.touchUpper === true, touchedLower: indicators?.bollinger?.touchLower === true,
    outsideUpper: indicators?.bollinger?.outsideUpper === true, outsideLower: indicators?.bollinger?.outsideLower === true,
    reenteredUpper: false, reenteredLower: false,
    maxPlusDI: num(indicators?.dmi?.plusDI), minPlusDI: num(indicators?.dmi?.plusDI),
    maxMinusDI: num(indicators?.dmi?.minusDI), minMinusDI: num(indicators?.dmi?.minusDI),
    maxSpread: num(indicators?.dmi?.spread), minSpread: num(indicators?.dmi?.spread),
    oppositeReactionStreak: 0, adxStoppedAt: null, lastAt: atMs,
  };
}

/**
 * Atualiza o episodio a cada candle (causal). Retorna { episode, event }.
 * event: CANDIDATE_CREATED | CANDIDATE_UPDATED | CANDIDATE_FLIPPED |
 *        EPISODE_EXPIRED_NEUTRAL | EPISODE_EXPIRED_AGE | NO_CANDIDATE
 */
export function updateEpisodeV2({ episode = null, indicators, at = null } = {}) {
  const atMs = num(at) ?? indicators?.at ?? Date.now();
  const rsi = num(indicators?.rsi);
  const policy = RSI_SKILLS_V2_POLICY;
  const side = rsi === null ? null : rsi <= policy.rsiBuyThreshold ? "BUY" : rsi >= policy.rsiSellThreshold ? "SELL" : null;
  if (!episode) {
    const created = createEpisodeV2({ indicators, at: atMs });
    return created ? { episode: created, event: "CANDIDATE_CREATED" } : { episode: null, event: "NO_CANDIDATE" };
  }
  if (side !== null && side !== episode.direction) {
    const created = createEpisodeV2({ indicators, at: atMs });
    return { episode: created, event: "CANDIDATE_FLIPPED" };
  }
  const neutralExit = episode.direction === "BUY" ? rsi !== null && rsi >= policy.episodeNeutralBuyExit : rsi !== null && rsi <= policy.episodeNeutralSellExit;
  if (neutralExit) return { episode: null, event: "EPISODE_EXPIRED_NEUTRAL" };
  if (atMs - episode.candidateAt > policy.episodeMaxAgeMs) return { episode: null, event: "EPISODE_EXPIRED_AGE" };
  if (rsi !== null) {
    episode.minRsi = Math.min(episode.minRsi ?? rsi, rsi);
    episode.maxRsi = Math.max(episode.maxRsi ?? rsi, rsi);
  }
  const band = indicators?.bollinger;
  if (band) {
    if (band.touchUpper) episode.touchedUpper = true;
    if (band.touchLower) episode.touchedLower = true;
    if (band.outsideUpper) episode.outsideUpper = true;
    if (band.outsideLower) episode.outsideLower = true;
    if (episode.outsideUpper && !band.outsideUpper) episode.reenteredUpper = true;
    if (episode.outsideLower && !band.outsideLower) episode.reenteredLower = true;
    if (episode.touchedUpper && band.position < policy.bandTouchPosition) episode.reenteredUpper = episode.reenteredUpper || true;
    if (episode.touchedLower && band.position > 1 - policy.bandTouchPosition) episode.reenteredLower = episode.reenteredLower || true;
  }
  const dmi = indicators?.dmi;
  if (dmi) {
    episode.maxPlusDI = Math.max(episode.maxPlusDI ?? dmi.plusDI ?? -Infinity, dmi.plusDI ?? -Infinity);
    episode.minPlusDI = Math.min(episode.minPlusDI ?? dmi.plusDI ?? Infinity, dmi.plusDI ?? Infinity);
    episode.maxMinusDI = Math.max(episode.maxMinusDI ?? dmi.minusDI ?? -Infinity, dmi.minusDI ?? -Infinity);
    episode.minMinusDI = Math.min(episode.minMinusDI ?? dmi.minusDI ?? Infinity, dmi.minusDI ?? Infinity);
    episode.maxSpread = Math.max(episode.maxSpread ?? dmi.spread ?? -Infinity, dmi.spread ?? -Infinity);
    episode.minSpread = Math.min(episode.minSpread ?? dmi.spread ?? Infinity, dmi.spread ?? Infinity);
    const reversing = episode.direction === "BUY"
      ? (dmi.minusSlope !== null && dmi.minusSlope < 0) && (dmi.plusSlope !== null && dmi.plusSlope > 0)
      : (dmi.plusSlope !== null && dmi.plusSlope < 0) && (dmi.minusSlope !== null && dmi.minusSlope > 0);
    episode.oppositeReactionStreak = reversing ? (episode.oppositeReactionStreak ?? 0) + 1 : 0;
  }
  episode.lastAt = atMs;
  episode.lastIndicators = snapshotForEpisode(indicators);
  return { episode, event: "CANDIDATE_UPDATED" };
}

/* ------------------------------------------------------------------ *
 * Avaliacoes STRICT V2 / PULLBACK V2
 * ------------------------------------------------------------------ */

function spreadContractionClear({ episode, indicators }) {
  const maxSpread = num(episode?.maxSpread);
  const spread = num(indicators?.dmi?.spread);
  if (maxSpread === null || spread === null) return false;
  const threshold = Math.max(RSI_SKILLS_V2_POLICY.spreadContractionMin, Math.abs(maxSpread) * RSI_SKILLS_V2_POLICY.spreadContractionRatio);
  return maxSpread - spread >= threshold;
}

function strictEvaluate({ direction, indicators, episode }) {
  const policy = RSI_SKILLS_V2_POLICY;
  if (!episode || episode.direction !== direction) return { strategy: STRICT_V2_ID, direction: null, decision: "WAIT", accepted: false, status: "NO_CANDIDATE", reason: "SEM_EPISODIO_RSI_EXTREMO" };
  const dmi = indicators.dmi ?? {};
  const adx = indicators.adx ?? {};
  const band = indicators.bollinger ?? {};
  const rsi = num(indicators.rsi);
  const sell = direction === "SELL";
  const candidateExtreme = sell ? num(episode.candidateRsi) >= policy.rsiSellThreshold : num(episode.candidateRsi) <= policy.rsiBuyThreshold;
  const turning = rsi !== null && (sell ? rsi < (episode.maxRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope <= 0.05) : rsi > (episode.minRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope >= -0.05));
  const touch = sell ? episode.touchedUpper === true : episode.touchedLower === true;
  const reentry = sell ? episode.reenteredUpper === true || (episode.outsideUpper === true && band.position < 1) : episode.reenteredLower === true || (episode.outsideLower === true && band.position > 0);
  const oldDiLosing = sell ? (dmi.plusSlope !== null && dmi.plusSlope < 0) : (dmi.minusSlope !== null && dmi.minusSlope < 0);
  const oppositeReacting = sell
    ? (dmi.minusSlope !== null && dmi.minusSlope > 0) || spreadContractionClear({ episode, indicators })
    : (dmi.plusSlope !== null && dmi.plusSlope > 0) || spreadContractionClear({ episode, indicators });
  const diFlip = sell ? (num(dmi.minusDI) !== null && num(dmi.plusDI) !== null && dmi.minusDI > dmi.plusDI) : (num(dmi.plusDI) !== null && num(dmi.minusDI) !== null && dmi.plusDI > dmi.minusDI);
  const adxStopsOldTrend = adx.slope === null || adx.slope === undefined ? true : sell ? adx.slope <= 0 || diFlip : adx.slope <= 0 || diFlip;
  const bandRidingOld = sell ? indicators.bandRiding?.upper === true : indicators.bandRiding?.lower === true;
  const strongContinuation = sell ? indicators.strongContinuation?.upper === true : indicators.strongContinuation?.lower === true;
  const dominantOld = sell ? indicators.dominantDI === "PLUS" : indicators.dominantDI === "MINUS";
  const adxRising = adx.rising === true;
  const blockStrong = (bandRidingOld && dominantOld && adxRising) || strongContinuation;
  const confirmations = { candidateExtreme, turning, touch, reentry, oldDiLosing, oppositeReacting, adxStopsOldTrend, diFlip, spreadContraction: spreadContractionClear({ episode, indicators }), oppositeReactionStreak: episode.oppositeReactionStreak ?? 0 };
  const blockers = [];
  if (!candidateExtreme) blockers.push("CANDIDATE_NAO_EXTREMO");
  if (!turning) blockers.push("RSI_NAO_SAINDO_DO_EXTREMO");
  if (!touch) blockers.push("SEM_TOQUE_BOLLINGER");
  if (!reentry) blockers.push("SEM_REJEICAO_REENTRADA");
  if (!oldDiLosing) blockers.push("DI_ANTIGO_NAO_ENFRAQUECEU");
  if (!oppositeReacting) blockers.push("DI_OPOSTO_SEM_REACAO");
  if (!adxStopsOldTrend) blockers.push("ADX_AINDA_FORTALECENDO_TENDENCIA");
  if (blockStrong) blockers.push("CONTINUACAO_FORTE_BAND_RIDING");
  const accepted = blockers.length === 0;
  const strongerConfirmation = accepted && diFlip && adx.slope !== null && adx.slope > 0;
  return {
    strategy: STRICT_V2_ID, direction, decision: accepted ? direction : "WAIT", accepted,
    status: accepted ? "STRICT_CONFIRMED" : blockStrong ? "STRICT_BLOCKED_STRONG_TREND" : "STRICT_WAITING_CONFIRMATION",
    reason: accepted ? (strongerConfirmation ? "REVERSAO_CONFIRMADA_DI_FLIP_ADX" : "REVERSAO_CONFIRMADA") : blockers.join("+"),
    confirmations, blockers, strongerConfirmation,
  };
}

function pullbackEvaluate({ direction, indicators, episode }) {
  const policy = RSI_SKILLS_V2_POLICY;
  if (!episode || episode.direction !== direction) return { strategy: PULLBACK_V2_ID, direction: null, decision: "WAIT", accepted: false, status: "NO_CANDIDATE", reason: "SEM_EPISODIO_RSI_EXTREMO" };
  const dmi = indicators.dmi ?? {};
  const adx = indicators.adx ?? {};
  const band = indicators.bollinger ?? {};
  const rsi = num(indicators.rsi);
  const sell = direction === "SELL";
  const candidateExtreme = sell ? num(episode.candidateRsi) >= policy.rsiSellThreshold : num(episode.candidateRsi) <= policy.rsiBuyThreshold;
  const rsiLeavingExtreme = rsi !== null && (sell ? rsi < (episode.maxRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope <= 0.05) : rsi > (episode.minRsi ?? rsi) && (indicators.rsiSlope === null || indicators.rsiSlope >= -0.05));
  const touch = sell ? episode.touchedUpper === true : episode.touchedLower === true;
  const rejection = sell
    ? episode.reenteredUpper === true || episode.outsideUpper === true || band.position < policy.bandTouchPosition
    : episode.reenteredLower === true || episode.outsideLower === true || band.position > 1 - policy.bandTouchPosition;
  const shortMomentum = indicators.shortHorizonDirection === (sell ? "BEARISH" : "BULLISH");
  const bandRidingOld = sell ? indicators.bandRiding?.upper === true : indicators.bandRiding?.lower === true;
  const dominantOld = sell ? indicators.dominantDI === "PLUS" : indicators.dominantDI === "MINUS";
  const adxRising = adx.rising === true;
  const adxStrong = adx.strong === true;
  const expanding = band.expanding === true;
  // Bloqueio reforcado: band riding + DI antigo dominante + ADX subindo (CADCHF-like),
  // ou dominancia antiga + ADX forte + bandas expandindo na direcao antiga (continuacao clara).
  const blockedByRiding = bandRidingOld && dominantOld && adxRising;
  const blockedByContinuation = dominantOld && adxStrong && expanding && adx.slope !== null && adx.slope >= 0;
  const blocked = blockedByRiding || blockedByContinuation;
  const confirmations = { candidateExtreme, rsiLeavingExtreme, touch, rejection, shortMomentum, structuralTrend: indicators.structuralTrend, shortHorizonDirection: indicators.shortHorizonDirection, bandRiding: bandRidingOld, dominantOld, adxRising, adxStrong, expanding };
  const blockers = [];
  if (!candidateExtreme) blockers.push("CANDIDATE_NAO_EXTREMO");
  if (!rsiLeavingExtreme) blockers.push("RSI_NAO_SAINDO_DO_EXTREMO");
  if (!touch) blockers.push("SEM_TOQUE_BOLLINGER");
  if (!rejection) blockers.push("SEM_REJEICAO_REENTRADA");
  if (!shortMomentum) blockers.push("MOMENTUM_CURTO_NAO_REAGIU");
  if (blockedByRiding) blockers.push("BAND_RIDING_DI_ADX_CONTRA");
  if (blockedByContinuation) blockers.push("CONTINUACAO_FORTE_EXPANDINDO");
  const accepted = blockers.length === 0;
  return {
    strategy: PULLBACK_V2_ID, direction, decision: accepted ? direction : "WAIT", accepted,
    status: accepted ? "PULLBACK_CONFIRMED" : blocked ? "PULLBACK_BLOCKED_STRONG_TREND" : "PULLBACK_WAITING_CONFIRMATION",
    reason: accepted ? "PULLBACK_CONFIRMADO" : blockers.join("+"),
    confirmations, blockers,
  };
}

/** Avalia a skill V2 para a direcao do episodio (ou NO_CANDIDATE sem episodio). */
export function evaluateV2({ strategy, indicators, episode } = {}) {
  if (!RSI_SKILLS_V2.includes(strategy)) throw new Error(`RSI_SKILL_V2_UNKNOWN:${strategy}`);
  const direction = episode?.direction ?? (num(indicators?.rsi) !== null && indicators.rsi <= RSI_SKILLS_V2_POLICY.rsiBuyThreshold ? "BUY" : num(indicators?.rsi) !== null && indicators.rsi >= RSI_SKILLS_V2_POLICY.rsiSellThreshold ? "SELL" : null);
  if (!direction || !episode) return { strategy, direction: null, decision: "WAIT", accepted: false, status: "NO_CANDIDATE", reason: "RSI_NEUTRO_SEM_CANDIDATE" };
  return strategy === STRICT_V2_ID ? strictEvaluate({ direction, indicators, episode }) : pullbackEvaluate({ direction, indicators, episode });
}

export function rsiSkillsV2FreezeManifest() {
  return {
    schema: "rsi-skills-v2-freeze-v1",
    version: RSI_SKILLS_V2_VERSION,
    frozenAtUtc: new Date().toISOString(),
    policy: RSI_SKILLS_V2_POLICY,
    skills: { strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID },
    noTuning: true,
    rules: {
      candidate: "RSI<=30 BUY / RSI>=70 SELL no candidateAt; entrada somente saindo do extremo no mesmo episodio",
      strict: "RSI extremo + toque/rejeicao Bollinger + DI antigo enfraquecendo + DI oposto reagindo (ou contracao clara de spread) + ADX parando de fortalecer; bloqueia band riding/continuacao forte",
      pullback: "RSI extremo + toque/rejeicao Bollinger + RSI caindo/subindo + momentum curto contrario; bloqueia band riding + DI dominante + ADX subindo/forte + bandas expandindo",
      v1Untouched: true,
    },
  };
}
