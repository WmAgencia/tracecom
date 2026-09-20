/**
 * ESPECIALISTA 4 — DMI + ADX (interpretados juntos; ADX NAO da direcao).
 * INVARIANTE: OLD TREND WEAKENING != NEW TREND CONFIRMED.
 * Enfraquecimento do DI antigo sozinho NUNCA vira evidencia de reversao; exige reacao do DI oposto.
 */
export const DMI_ADX_SPECIALIST_VERSION = "consensus-dmi-adx-v1";

const num = (value) => (value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function sideAnalysis({ side, dmi, adx }) {
  const sell = side === "SELL";
  const plusDI = num(dmi?.plusDI);
  const minusDI = num(dmi?.minusDI);
  const plusSlope = num(dmi?.plusSlope);
  const minusSlope = num(dmi?.minusSlope);
  const oldSlope = sell ? plusSlope : minusSlope;
  const oppositeSlope = sell ? minusSlope : plusSlope;
  const oldDI = sell ? plusDI : minusDI;
  const oppositeDI = sell ? minusDI : plusDI;
  const oldTrendWeakening = oldSlope !== null && oldSlope < 0;
  const oppositeReacting = oppositeSlope !== null && oppositeSlope > 0;
  const newDominance = oldDI !== null && oppositeDI !== null && oppositeDI > oldDI;
  const adxSlope = num(adx?.slope);
  const adxRising = adx?.rising === true;
  const adxStrong = adx?.strong === true;

  let state = "NEUTRAL";
  if (newDominance && (adxSlope === null || adxSlope >= 0) && adxStrong) state = "NEW_TREND_STRENGTHENING";
  else if (newDominance) state = "NEW_DOMINANCE";
  else if (oldTrendWeakening && oppositeReacting) state = "TRANSITION";
  else if (oldTrendWeakening) state = "OLD_TREND_WEAKENING";
  else if (adxRising && !oldTrendWeakening) state = "OLD_TREND_STRENGTHENING";

  let evidenceReversal = 0;
  let evidenceContinuation = 0;
  if (oldTrendWeakening) evidenceReversal += 0.25;
  if (oppositeReacting) evidenceReversal += 0.3;
  if (newDominance) evidenceReversal += 0.25;
  if (state === "NEW_TREND_STRENGTHENING") evidenceReversal += 0.1;
  if (!oldTrendWeakening && adxRising) evidenceContinuation += 0.4;
  if (!oldTrendWeakening && adxStrong) evidenceContinuation += 0.25;
  if (adxRising && !oppositeReacting) evidenceContinuation += 0.2;
  if (state === "OLD_TREND_WEAKENING" && !oppositeReacting) evidenceReversal = Math.min(evidenceReversal, 0.25);

  const observations = [];
  if (oldTrendWeakening) observations.push(sell ? "plusDI_enfraquecendo" : "minusDI_enfraquecendo");
  if (oppositeReacting) observations.push(sell ? "minusDI_reagindo" : "plusDI_reagindo");
  if (newDominance) observations.push(sell ? "minusDI_assumiu_dominancia" : "plusDI_assumiu_dominancia");
  if (!oldTrendWeakening && adxRising) observations.push("tendencia_antiga_ainda_fortalecendo");
  if (state === "OLD_TREND_WEAKENING" && !oppositeReacting) observations.push("enfraquecimento_sem_reacao_do_di_oposto");

  return {
    side, state, oldDI: round(oldDI, 4), oppositeDI: round(oppositeDI, 4),
    oldSlope: round(oldSlope, 4), oppositeSlope: round(oppositeSlope, 4),
    oldTrendWeakening, oppositeReacting, newDominance,
    evidenceReversal: round(clamp01(evidenceReversal), 4), evidenceContinuation: round(clamp01(evidenceContinuation), 4),
    observations,
  };
}

export function analyzeDmiAdx(snapshot) {
  const dmi = snapshot?.indicators?.dmi ?? null;
  const adx = snapshot?.indicators?.adx ?? null;
  if (!dmi || !adx) return { dominance: null, state: "NEUTRAL", sides: { BUY: null, SELL: null }, evidenceContinuation: 0, observations: ["dmi_adx_indisponivel"], weakeningAloneIsNotConfirmation: true, version: DMI_ADX_SPECIALIST_VERSION };

  const dominance = snapshot?.indicators?.dominantDI ?? null;
  const sellSide = sideAnalysis({ side: "SELL", dmi, adx });
  const buySide = sideAnalysis({ side: "BUY", dmi, adx });
  const adxSlope = num(adx?.slope);
  const oldDominanceStrengthening = (dominance === "PLUS" && num(dmi?.plusSlope) > 0) || (dominance === "MINUS" && num(dmi?.minusSlope) > 0);
  const globalState = oldDominanceStrengthening && adx?.rising === true ? "OLD_TREND_STRENGTHENING"
    : sellSide.state === "TRANSITION" || buySide.state === "TRANSITION" ? "TRANSITION"
    : sellSide.state === "OLD_TREND_WEAKENING" || buySide.state === "OLD_TREND_WEAKENING" ? "OLD_TREND_WEAKENING"
    : "NEUTRAL";

  return {
    dominance, state: globalState, spread: round(num(dmi?.spread), 4),
    plusDI: round(num(dmi?.plusDI), 4), minusDI: round(num(dmi?.minusDI), 4),
    plusSlope: round(num(dmi?.plusSlope), 4), minusSlope: round(num(dmi?.minusSlope), 4),
    adx: { value: round(num(adx?.value), 4), slope: round(adxSlope, 4), rising: adx?.rising === true, strong: adx?.strong === true },
    sides: { BUY: buySide, SELL: sellSide },
    evidenceContinuation: round(Math.max(sellSide.evidenceContinuation, buySide.evidenceContinuation), 4),
    observations: [...new Set([...(sellSide.observations ?? []), ...(buySide.observations ?? [])])].slice(0, 8),
    weakeningAloneIsNotConfirmation: true,
    version: DMI_ADX_SPECIALIST_VERSION,
  };
}
