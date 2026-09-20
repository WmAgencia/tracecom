/**
 * ESPECIALISTA 3 — BOLLINGER (20/2 do Feature Engine oficial).
 * TOUCH != REVERSAL e OUTSIDE != REVERSAL. Estados: STRETCHED | REJECTION | REENTRY | BAND_RIDING | CONTINUATION | NEUTRAL.
 */
export const BOLLINGER_SPECIALIST_VERSION = "consensus-bollinger-v1";

const num = (value) => (value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function analyzeBollinger(snapshot) {
  const band = snapshot?.indicators?.bollinger ?? null;
  const dmi = snapshot?.indicators?.dmi ?? null;
  const adx = snapshot?.indicators?.adx ?? null;
  const candles = snapshot?.recentCandles ?? [];
  const observations = [];
  if (!band) return { state: "NEUTRAL", side: null, evidenceReversal: 0, evidenceContinuation: 0, observations: ["bollinger_indisponivel"], version: BOLLINGER_SPECIALIST_VERSION };

  const last = candles[candles.length - 1] ?? null;
  const prev = candles[candles.length - 2] ?? null;
  const position = num(band.position);
  const close = num(band.close);
  const upper = num(band.upper);
  const lower = num(band.lower);
  const width = num(band.width);
  const expanding = band.expanding === true;
  const distanceUpper = width && width > 0 && close !== null && upper !== null ? (upper - close) / width : null;
  const distanceLower = width && width > 0 && close !== null && lower !== null ? (close - lower) / width : null;
  const dominant = snapshot?.indicators?.dominantDI ?? null;
  const adxRising = adx?.rising === true;
  const adxStrong = adx?.strong === true;
  const plusSlope = num(dmi?.plusSlope);
  const minusSlope = num(dmi?.minusSlope);

  const upperRejectionCandle = Boolean(last && upper !== null && Number(last.high) > upper && Number(last.close) < upper && (Number(last.high) - Math.max(Number(last.open), Number(last.close))) > (Number(last.high) - Number(last.low)) * 0.4);
  const lowerRejectionCandle = Boolean(last && lower !== null && Number(last.low) < lower && Number(last.close) > lower && (Math.min(Number(last.open), Number(last.close)) - Number(last.low)) > (Number(last.high) - Number(last.low)) * 0.4);
  const reenteredUpper = band.outsideUpper !== true && prev && Number(prev.close) > upper;
  const reenteredLower = band.outsideLower !== true && prev && Number(prev.close) < lower;

  let state = "NEUTRAL";
  let side = null;
  let evidenceReversal = 0;
  let evidenceContinuation = 0;

  if (band.outsideUpper === true) {
    state = "STRETCHED"; side = "SELL"; evidenceContinuation += 0.25;
    if (reenteredUpper) { state = "REENTRY"; evidenceReversal += 0.45; evidenceContinuation = Math.max(0, evidenceContinuation - 0.25); observations.push("preco_voltou_para_dentro_da_banda_superior"); }
  } else if (band.outsideLower === true) {
    state = "STRETCHED"; side = "BUY"; evidenceContinuation += 0.25;
    if (reenteredLower) { state = "REENTRY"; evidenceReversal += 0.45; evidenceContinuation = Math.max(0, evidenceContinuation - 0.25); observations.push("preco_voltou_para_dentro_da_banda_inferior"); }
  } else if (upperRejectionCandle) {
    state = "REJECTION"; side = "SELL"; evidenceReversal += 0.4; observations.push("rejeicao_na_banda_superior");
  } else if (lowerRejectionCandle) {
    state = "REJECTION"; side = "BUY"; evidenceReversal += 0.4; observations.push("rejeicao_na_banda_inferior");
  }

  if (band.touchUpper === true && position !== null && position >= 0.9) {
    side = side ?? "SELL";
    if (dominant === "PLUS" && plusSlope !== null && plusSlope > 0 && expanding && adxRising) {
      state = "BAND_RIDING"; evidenceContinuation = Math.max(evidenceContinuation, 0.7); observations.push("band_riding_na_superior");
    } else if (dominant === "PLUS" && plusSlope !== null && plusSlope > 0 && (adxStrong || adxRising)) {
      state = state === "NEUTRAL" ? "CONTINUATION" : state; evidenceContinuation = Math.max(evidenceContinuation, 0.5); observations.push("pressao_altista_dominante_na_banda_superior");
    }
  }
  if (band.touchLower === true && position !== null && position <= 0.1) {
    side = side ?? "BUY";
    if (dominant === "MINUS" && minusSlope !== null && minusSlope > 0 && expanding && adxRising) {
      state = "BAND_RIDING"; evidenceContinuation = Math.max(evidenceContinuation, 0.7); observations.push("band_riding_na_inferior");
    } else if (dominant === "MINUS" && minusSlope !== null && minusSlope > 0 && (adxStrong || adxRising)) {
      state = state === "NEUTRAL" ? "CONTINUATION" : state; evidenceContinuation = Math.max(evidenceContinuation, 0.5); observations.push("pressao_baixista_dominante_na_banda_inferior");
    }
  }

  if (position !== null && position >= 0.9) observations.push("preco_colado_na_banda_superior");
  if (position !== null && position <= 0.1) observations.push("preco_colado_na_banda_inferior");
  if (expanding && adxRising) observations.push("bandas_expandindo_com_adx_subindo");

  return {
    state, side, position: round(position, 4), distanceUpper: round(distanceUpper, 4), distanceLower: round(distanceLower, 4),
    expanding, upperRejectionCandle, lowerRejectionCandle, reenteredUpper, reenteredLower,
    evidenceReversal: round(clamp01(evidenceReversal), 4), evidenceContinuation: round(clamp01(evidenceContinuation), 4),
    observations: observations.slice(0, 8), version: BOLLINGER_SPECIALIST_VERSION,
  };
}
