/**
 * RSI_REVERSAL_V4 — decisao LIMPA (clean-room).
 *
 * Filosofia:
 *   "O passado coloca o ativo sob observacao. O PRESENTE autoriza a ordem."
 *
 * Workflow: DETECT -> WATCH -> CONFIRM -> REVALIDATE -> ENTER/CANCEL.
 *
 * - Indicadores: reusa a matematica ja auditada (evaluateIndicatorsV3 via wrapper) — dado, nao regra.
 * - Episodio: minimo (direction, candidateAt/Price, extremos, toque na banda). Sem timers arbitrarios,
 *   sem validade ponderada de memoria. Basta continuidade logica; normalizou -> CANCEL; novo extremo -> NOVO.
 * - Bollinger: localizacao (esticou?) + rejeicao/reentrada ATUAL; band riding contra -> BLOCK.
 * - DMI/ADX: ADX nao tem direcao; ADX caindo NAO confirma reversao. Exige enfraquecimento da pressao
 *   antiga + reacao relativa do DI novo. DI cross e evidencia forte, nunca obrigatoria.
 * - counterEvidenceAtEntry: SOFT/HARD; qualquer HARD -> NO TRADE.
 * - Cushion: FRAGILE -> WAIT; NORMAL/STRONG liberam (reusa a metrica provada, sem probabilidade falsa).
 *
 * Sem I/O. Sem ordem. Puro e auditavel. Nao altera V1/V2/V3/V3.1.
 */
import { evaluateIndicatorsV3, projectExpiryV3, classifyOutcomeV3 } from "./rsi-v3.mjs";

export const V4_ID = "RSI_REVERSAL_V4";
export const RSI_V4_VERSION = "RSI_REVERSAL_V4_V1";
export const RSI_V4_STRATEGY_VERSION = "v4";

export const RSI_V4_POLICY = Object.freeze({
  version: RSI_V4_VERSION,
  detector: "RSI14_EXTREME",
  rsiBuyThreshold: 30,
  rsiSellThreshold: 70,
  neutralLow: 45,
  neutralHigh: 55,
  minClosedCandles5s: 60,
  candidateMaxAgeMs: 8 * 60_000,
  candleMs: 5_000,
  // Bollinger (localizacao + rejeicao atual)
  bandZonePosition: 0.15,
  bandTouchPosition: 0.9,
  // DMI/ADX
  adxRisingSlope: 0.5,
  adxStabilizeFloor: -0.15,
  shortMomentumMin: 0.5,
  // cushion (valores ja provados: 0,25 / 0,45)
  cushionNormal: 0.25,
  cushionStrong: 0.45,
  // binary (expiry sincronizado com o broker)
  horizonSeconds: 60,
  finalWindowMs: 5_000,
  minimumSafeMarginMs: 3_000,
  turbCutoffMs: 30_000,
  // blitz (novo instrumento; somente se descoberto/suportado)
  blitzDurationSeconds: 45,
  // seguranca
  routing: "RSI_V4_ONLY",
  practiceOnly: true,
  realLocked: true,
  stakeBrl: 10,
  noTuning: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 6) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

/** Indicadores = matematica auditada (mesmo dado da V3). Regras V4 sao independentes. */
export function evaluateIndicatorsV4(args = {}) {
  const indicators = evaluateIndicatorsV3(args);
  return { ...indicators, strategy: V4_ID, policyVersion: RSI_V4_VERSION };
}

/* ------------------------------- DETECT ------------------------------- */

export function detectV4({ indicators } = {}) {
  const rsi = num(indicators?.rsi);
  if (rsi === null) return { direction: null, reason: "RSI_UNAVAILABLE" };
  if (rsi <= RSI_V4_POLICY.rsiBuyThreshold) return { direction: "BUY", reason: `RSI_EXTREME_BUY_${RSI_V4_POLICY.rsiBuyThreshold}` };
  if (rsi >= RSI_V4_POLICY.rsiSellThreshold) return { direction: "SELL", reason: `RSI_EXTREME_SELL_${RSI_V4_POLICY.rsiSellThreshold}` };
  return { direction: null, reason: "RSI_NEUTRAL" };
}

function touchedBand({ indicators, direction }) {
  const bollinger = indicators?.bollinger ?? null;
  if (direction === "BUY") return bollinger ? (bollinger.touchLower === true || bollinger.outsideLower === true || (num(bollinger.position) ?? 1) <= 0.1) : false;
  return bollinger ? (bollinger.touchUpper === true || bollinger.outsideUpper === true || (num(bollinger.position) ?? 0) >= 0.9) : false;
}

/* --------------------------- WATCH (episodio minimo) --------------------------- */

export function updateEpisodeV4({ episode = null, indicators, at = null } = {}) {
  const atMs = num(at) ?? num(indicators?.at) ?? Date.now();
  const close = num(indicators?.bollinger?.close) ?? num(indicators?.price);
  const rsi = num(indicators?.rsi);
  const detected = detectV4({ indicators });

  if (!episode) {
    if (!detected.direction) return { episode: null, event: "NO_CANDIDATE" };
    const created = {
      direction: detected.direction, candidateAt: atMs, candidateRsi: rsi, candidatePrice: close,
      candidateReason: detected.reason,
      touchedLower: false, touchedUpper: false, reentered: false,
      minPrice: close, maxPrice: close,
    };
    if (detected.direction === "BUY") created.touchedLower = touchedBand({ indicators, direction: "BUY" });
    else created.touchedUpper = touchedBand({ indicators, direction: "SELL" });
    return { episode: created, event: "CANDIDATE_CREATED" };
  }

  const expired = atMs - episode.candidateAt > RSI_V4_POLICY.candidateMaxAgeMs;
  if (expired) return { episode: null, event: "CANDIDATE_EXPIRED_AGE" };

  if (detected.direction && detected.direction !== episode.direction) {
    const flipped = { ...episode, direction: detected.direction, candidateAt: atMs, candidateRsi: rsi, candidatePrice: close, candidateReason: detected.reason, touchedLower: false, touchedUpper: false, reentered: false, minPrice: close, maxPrice: close };
    if (detected.direction === "BUY") flipped.touchedLower = touchedBand({ indicators, direction: "BUY" });
    else flipped.touchedUpper = touchedBand({ indicators, direction: "SELL" });
    return { episode: flipped, event: "CANDIDATE_FLIPPED" };
  }

  // Continuidade logica: normalizou completamente -> CANCEL (nova condicao extrema cria NOVO episodio).
  const middle = num(indicators?.bollinger?.middle);
  if (episode.direction === "BUY" && rsi !== null && rsi >= RSI_V4_POLICY.neutralHigh && middle !== null && close !== null && close >= middle) {
    return { episode: null, event: "CANDIDATE_ENDED_NORMALIZED" };
  }
  if (episode.direction === "SELL" && rsi !== null && rsi <= RSI_V4_POLICY.neutralLow && middle !== null && close !== null && close <= middle) {
    return { episode: null, event: "CANDIDATE_ENDED_NORMALIZED" };
  }

  const next = { ...episode };
  if (episode.direction === "BUY" && touchedBand({ indicators, direction: "BUY" })) next.touchedLower = true;
  if (episode.direction === "SELL" && touchedBand({ indicators, direction: "SELL" })) next.touchedUpper = true;
  if (close !== null) {
    next.minPrice = episode.minPrice === null ? close : Math.min(episode.minPrice, close);
    next.maxPrice = episode.maxPrice === null ? close : Math.max(episode.maxPrice, close);
  }
  return { episode: next, event: "CANDIDATE_CONTINUED" };
}

/* ------------------------------- CONFIRM ------------------------------- */

/** Bollinger: esticou (contexto) + rejeicao/reentrada ATUAL + sem band riding contra. */
export function bollingerReversalV4({ indicators, direction, episode = null } = {}) {
  const bollinger = indicators?.bollinger ?? null;
  const checks = {};
  if (!bollinger) return { ok: false, checks, reason: "BOLLINGER_UNAVAILABLE", reasonCodes: ["BOLLINGER_UNAVAILABLE"] };
  const position = num(bollinger.position);
  const outside = direction === "BUY" ? bollinger.outsideLower === true : bollinger.outsideUpper === true;
  const rejectionNow = direction === "BUY" ? indicators?.rejectionLowerNow === true : indicators?.rejectionUpperNow === true;
  const bandRiding = direction === "BUY" ? indicators?.bandRiding?.lower === true : indicators?.bandRiding?.upper === true;
  const strongContinuation = direction === "BUY" ? indicators?.strongContinuation?.lower === true : indicators?.strongContinuation?.upper === true;
  const stretched = direction === "BUY"
    ? (episode?.touchedLower === true || touchedBand({ indicators, direction: "BUY" }) || (position !== null && position <= RSI_V4_POLICY.bandZonePosition))
    : (episode?.touchedUpper === true || touchedBand({ indicators, direction: "SELL" }) || (position !== null && position >= 1 - RSI_V4_POLICY.bandZonePosition));
  checks.stretched = stretched;
  checks.reenteredInside = outside !== true;
  checks.rejectionNow = rejectionNow;
  checks.movedOffZone = position !== null && (direction === "BUY" ? position >= RSI_V4_POLICY.bandZonePosition : position <= 1 - RSI_V4_POLICY.bandZonePosition);
  checks.bandRidingAgainst = bandRiding === true;
  checks.strongContinuationAgainst = strongContinuation === true;
  const ok = checks.stretched && checks.reenteredInside && (checks.rejectionNow || checks.movedOffZone) && !checks.bandRidingAgainst && !checks.strongContinuationAgainst;
  const reasonCodes = [];
  if (!checks.stretched) reasonCodes.push("BOLLINGER_NAO_ESTICOU");
  if (!checks.reenteredInside) reasonCodes.push("PRECO_FORA_DA_BANDA");
  if (!checks.rejectionNow && !checks.movedOffZone) reasonCodes.push("REJEICAO_AUSENTE");
  if (checks.bandRidingAgainst) reasonCodes.push("BAND_RIDING");
  if (checks.strongContinuationAgainst) reasonCodes.push("STRONG_CONTINUATION");
  return { ok, checks, reason: ok ? "REVERSAO_BOLLINGER_OK" : reasonCodes[0], reasonCodes };
}

/** DMI/ADX: antiga enfraquecendo + nova reagindo; ADX nao tem direcao; ADX caindo nao confirma sozinho. */
export function dmiAdxV4({ indicators, direction } = {}) {
  const dmi = indicators?.dmi ?? null;
  const adx = indicators?.adx ?? null;
  const checks = {};
  if (!dmi || !adx) return { ok: false, checks, reason: "DMI_ADX_UNAVAILABLE", reasonCodes: ["DMI_ADX_UNAVAILABLE"] };
  const oldDI = direction === "BUY" ? num(dmi.minusDI) : num(dmi.plusDI);
  const newDI = direction === "BUY" ? num(dmi.plusDI) : num(dmi.minusDI);
  const oldSlope = direction === "BUY" ? num(dmi.minusSlope) : num(dmi.plusSlope);
  const newSlope = direction === "BUY" ? num(dmi.plusSlope) : num(dmi.minusSlope);
  const adxSlope = num(adx.slope);
  checks.oldWeakening = oldSlope !== null && oldSlope < 0;
  checks.newReacting = (newSlope !== null && newSlope > 0) || (oldDI !== null && newDI !== null && newDI > oldDI);
  checks.newDominant = oldDI !== null && newDI !== null && newDI > oldDI;
  checks.adxRising = adxSlope !== null && adxSlope > RSI_V4_POLICY.adxRisingSlope;
  checks.adxStabilized = adxSlope !== null && adxSlope >= RSI_V4_POLICY.adxStabilizeFloor;
  checks.oldStillDominant = oldDI !== null && newDI !== null && oldDI >= newDI;
  checks.adxSupportingOld = checks.adxRising === true && checks.oldStillDominant === true;
  checks.strongConfirmation = checks.newDominant === true && checks.adxStabilized === true;
  const ok = checks.oldWeakening === true && checks.newReacting === true && checks.adxSupportingOld !== true;
  const reasonCodes = [];
  if (!checks.oldWeakening) reasonCodes.push("ANTIGA_NAO_ENFRAQUECEU");
  if (!checks.newReacting) reasonCodes.push("DI_NOVO_SEM_REACAO");
  if (checks.adxSupportingOld) reasonCodes.push("ADX_SUPORTANDO_ANTIGA");
  return { ok, checks, reason: ok ? (checks.strongConfirmation ? "DMI_ADX_FORTE" : "DMI_ADX_OK") : reasonCodes[0], reasonCodes };
}

/** Cushion: margem esperada vs ruido recente. FRAGILE => WAIT. */
export function cushionV4({ indicators, direction, entryPrice = null } = {}) {
  const projection = projectExpiryV3({ indicators, direction, entryPrice });
  const normalized = projection?.expectedCushionNormalized ?? null;
  if (normalized === null) return { normalized: null, class: "UNKNOWN", fragile: true, strong: false, projection };
  if (normalized < RSI_V4_POLICY.cushionNormal) return { normalized, class: "FRAGILE", fragile: true, strong: false, projection };
  if (normalized >= RSI_V4_POLICY.cushionStrong) return { normalized, class: "STRONG", fragile: false, strong: true, projection };
  return { normalized, class: "NORMAL", fragile: false, strong: false, projection };
}

/**
 * Counter-evidence explicita no momento da entrada: SOFT (registra) e HARD (bloqueia).
 * Nao conta indicadores: classifica contradicoes logicas contra a direcao da tese.
 */
export function counterEvidenceV4({ indicators, direction, episode = null, cushion = null } = {}) {
  const evidence = [];
  const push = (code, severity, detail = null) => evidence.push({ code, severity, detail });
  const dmi = indicators?.dmi ?? null;
  const adx = indicators?.adx ?? null;
  const rsi = num(indicators?.rsi);
  const rsiSlope = num(indicators?.rsiSlope);
  const velocity = num(indicators?.velocity);
  const momentum = num(indicators?.shortMomentum);
  const shortDirection = indicators?.shortHorizonDirection ?? "UNKNOWN";
  const middle = num(indicators?.bollinger?.middle);
  const close = num(indicators?.bollinger?.close);
  const noise = num(indicators?.noiseHorizon);
  const bandRidingAgainst = direction === "BUY" ? indicators?.bandRiding?.lower === true : indicators?.bandRiding?.upper === true;
  const strongAgainst = direction === "BUY" ? indicators?.strongContinuation?.lower === true : indicators?.strongContinuation?.upper === true;

  if (rsi !== null) {
    if (direction === "BUY" && rsiSlope !== null && rsiSlope < -0.5) push("RSI_REACCELERATING_AGAINST", "SOFT", { rsi, rsiSlope });
    if (direction === "SELL" && rsiSlope !== null && rsiSlope > 0.5) push("RSI_REACCELERATING_AGAINST", "SOFT", { rsi, rsiSlope });
  }
  if (dmi) {
    const oldDI = direction === "BUY" ? num(dmi.minusDI) : num(dmi.plusDI);
    const newDI = direction === "BUY" ? num(dmi.plusDI) : num(dmi.minusDI);
    const newSlope = direction === "BUY" ? num(dmi.plusSlope) : num(dmi.minusSlope);
    if (oldDI !== null && newDI !== null && oldDI > newDI) push("OLD_DI_STILL_DOMINANT", "HARD", { oldDI, newDI });
    if (newSlope !== null && newSlope < 0) push("OPPOSITE_DI_ACCELERATING", "SOFT", { newSlope });
  }
  if (adx) {
    const adxSlope = num(adx.slope);
    const dmiChecks = dmiAdxV4({ indicators, direction }).checks ?? {};
    if (adxSlope !== null && adxSlope > RSI_V4_POLICY.adxRisingSlope && dmiChecks.oldStillDominant === true) push("ADX_SUPPORTING_OLD_DIRECTION", "HARD", { adxSlope });
    if (adxSlope !== null && adxSlope < -0.5) push("ADX_FALLING_CONTEXT_ONLY", "SOFT", { adxSlope });
  }
  if (bandRidingAgainst) push("BAND_RIDING", "HARD");
  if (strongAgainst) push("STRONG_OPPOSITE_CANDLE", "HARD");
  if (shortDirection === "BEARISH" && direction === "BUY" && momentum !== null && momentum <= -RSI_V4_POLICY.shortMomentumMin) push("MOMENTUM_AGAINST", "HARD", { momentum });
  if (shortDirection === "BULLISH" && direction === "SELL" && momentum !== null && momentum >= RSI_V4_POLICY.shortMomentumMin) push("MOMENTUM_AGAINST", "HARD", { momentum });
  if (velocity !== null && direction === "BUY" && velocity <= -RSI_V4_POLICY.shortMomentumMin) push("VELOCITY_AGAINST", "SOFT", { velocity });
  if (velocity !== null && direction === "SELL" && velocity >= RSI_V4_POLICY.shortMomentumMin) push("VELOCITY_AGAINST", "SOFT", { velocity });
  if (episode && close !== null && noise !== null) {
    const invalidated = direction === "BUY"
      ? close < (episode.minPrice ?? close) - RSI_V4_POLICY.cushionNormal * noise
      : close > (episode.maxPrice ?? close) + RSI_V4_POLICY.cushionNormal * noise;
    if (invalidated) push("PRICE_STRUCTURE_INVALIDATED", "HARD", { close, minPrice: episode.minPrice, maxPrice: episode.maxPrice, noise });
  }
  const movedOffZone = middle !== null && close !== null && (direction === "BUY" ? close < middle : close > middle);
  if (!movedOffZone) push("REJECTION_FAILED", "SOFT", { close, middle });
  if (cushion?.fragile === true) push("CUSHION_TOO_SMALL", "HARD", { normalized: cushion.normalized });
  const hard = evidence.filter((row) => row.severity === "HARD");
  return { evidence, hard, soft: evidence.filter((row) => row.severity === "SOFT"), blocked: hard.length > 0 };
}

/**
 * DECISAO V4 (presente autoriza):
 * "Se eu abrisse este grafico AGORA, sem conhecer o candidate, entraria nessa direcao?"
 * A resposta e construida SOMENTE do snapshot atual + direcao/continuidade do episodio.
 */
export function evaluateV4Decision({ indicators, episode = null } = {}) {
  const direction = episode?.direction ?? null;
  if (!direction) return { accepted: false, direction: "WAIT", reason: "NO_CANDIDATE", reasonCodes: ["NO_CANDIDATE"], checks: {}, counterEvidence: [], entryReason: [], cushion: null, hardBlocksChecked: [] };
  const bollinger = bollingerReversalV4({ indicators, direction, episode });
  const dmi = dmiAdxV4({ indicators, direction });
  const cushion = cushionV4({ indicators, direction, entryPrice: num(indicators?.bollinger?.close) });
  const counter = counterEvidenceV4({ indicators, direction, episode, cushion });
  const reasonCodes = [...bollinger.reasonCodes, ...dmi.reasonCodes];
  const accepted = bollinger.ok === true && dmi.ok === true && counter.blocked !== true && cushion.fragile !== true;
  if (cushion.fragile === true && !counter.hard.some((row) => row.code === "CUSHION_TOO_SMALL")) reasonCodes.push("CUSHION_TOO_SMALL");
  const entryReason = [];
  if (bollinger.ok) entryReason.push(bollinger.reason);
  if (dmi.ok) entryReason.push(dmi.reason);
  if (dmi.checks?.strongConfirmation === true) entryReason.push("DI_NOVO_DOMINANTE_ADX_ESTAVEL_OU_SUBINDO");
  if (counter.soft.length === 0) entryReason.push("SEM_CONTRA_EVIDENCIA_SOFT");
  return {
    accepted, direction: accepted ? direction : "WAIT",
    reason: accepted ? `V4_ENTRY_OK:${entryReason.join("+")}` : (counter.hard[0]?.code ?? reasonCodes[0] ?? "WAIT"),
    reasonCodes: counter.blocked ? counter.hard.map((row) => row.code) : reasonCodes,
    checks: { bollinger: bollinger.checks, dmi: dmi.checks, cushion: { class: cushion.class, normalized: cushion.normalized } },
    counterEvidence: counter.evidence, entryReason, cushion,
    hardBlocksChecked: ["OLD_DI_STILL_DOMINANT", "ADX_SUPPORTING_OLD_DIRECTION", "BAND_RIDING", "STRONG_OPPOSITE_CANDLE", "MOMENTUM_AGAINST", "PRICE_STRUCTURE_INVALIDATED", "CUSHION_TOO_SMALL"],
  };
}

export function classifyOutcomeV4({ result, entryPrice, expiryPrice, direction, noiseHorizon = null } = {}) {
  return classifyOutcomeV3({ result, entryPrice, expiryPrice, direction, noiseHorizon });
}

export function rsiV4FreezeManifest() {
  return {
    schema: "rsi-v4-freeze-v1",
    id: V4_ID,
    version: RSI_V4_VERSION,
    policy: RSI_V4_POLICY,
    workflow: ["DETECT", "WATCH", "CONFIRM", "REVALIDATE", "ENTER_OR_CANCEL"],
    principle: "passado coloca sob observacao; presente autoriza",
    hardCounterEvidence: ["OLD_DI_STILL_DOMINANT", "ADX_SUPPORTING_OLD_DIRECTION", "BAND_RIDING", "STRONG_OPPOSITE_CANDLE", "MOMENTUM_AGAINST", "PRICE_STRUCTURE_INVALIDATED", "CUSHION_TOO_SMALL"],
    softCounterEvidence: ["RSI_REACCELERATING_AGAINST", "OPPOSITE_DI_ACCELERATING", "ADX_FALLING_CONTEXT_ONLY", "VELOCITY_AGAINST", "REJECTION_FAILED"],
    noTuning: true,
  };
}
