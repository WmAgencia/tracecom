/**
 * ESPECIALISTA 2 — RSI (detector de oportunidade; NUNCA autoriza ordem).
 * Regra experimental: RSI >= 73 => oportunidade SELL; RSI <= 28 => oportunidade BUY.
 * Reporta trajetoria: EXTREME_AND_ACCELERATING | EXTREME_PERSISTENT | TURNING_FROM_EXTREME | NORMALIZING | NEUTRAL.
 */
export const RSI_SPECIALIST_VERSION = "consensus-rsi-v1";
export const RSI_OPPORTUNITY = Object.freeze({ sellMin: 73, buyMax: 28 });

const num = (value) => (value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

export function analyzeRsi(snapshot) {
  const rsi = num(snapshot?.indicators?.rsi);
  const slope = num(snapshot?.indicators?.rsiSlope);
  const trajectory = (snapshot?.indicators?.rsiTrajectory ?? []).map((v) => num(v));
  const observations = [];
  if (rsi === null) return { opportunity: false, side: null, state: "NEUTRAL", rsi: null, trajectory, slope: null, extremeReached: false, extremePersistence: 0, turning: false, returnFromExtreme: null, observations: ["rsi_indisponivel"], version: RSI_SPECIALIST_VERSION };

  const valid = trajectory.filter((v) => v !== null);
  const extremeReached = valid.some((v) => v >= RSI_OPPORTUNITY.sellMin || v <= RSI_OPPORTUNITY.buyMax) || rsi >= RSI_OPPORTUNITY.sellMin || rsi <= RSI_OPPORTUNITY.buyMax;
  const sellOpportunity = rsi >= RSI_OPPORTUNITY.sellMin;
  const buyOpportunity = rsi <= RSI_OPPORTUNITY.buyMax;
  const side = sellOpportunity ? "SELL" : buyOpportunity ? "BUY" : null;

  let extremePersistence = 0;
  for (let i = valid.length - 1; i >= 0; i -= 1) { if (valid[i] >= RSI_OPPORTUNITY.sellMin || valid[i] <= RSI_OPPORTUNITY.buyMax) extremePersistence += 1; else break; }

  const peak = valid.length ? Math.max(...valid) : rsi;
  const trough = valid.length ? Math.min(...valid) : rsi;
  const cameFromSell = peak >= RSI_OPPORTUNITY.sellMin;
  const cameFromBuy = trough <= RSI_OPPORTUNITY.buyMax;
  const turningFromSell = cameFromSell && rsi < peak && slope !== null && slope <= 0.05;
  const turningFromBuy = cameFromBuy && rsi > trough && slope !== null && slope >= -0.05;
  const acceleratingSell = sellOpportunity && slope !== null && slope > 0.05;
  const acceleratingBuy = buyOpportunity && slope !== null && slope < -0.05;

  let state = "NEUTRAL";
  if (acceleratingSell || acceleratingBuy) state = "EXTREME_AND_ACCELERATING";
  else if (sellOpportunity || buyOpportunity) state = "EXTREME_PERSISTENT";
  else if (turningFromSell || turningFromBuy) state = "TURNING_FROM_EXTREME";
  else if (extremeReached) state = "NORMALIZING";

  const returnFromExtreme = turningFromSell ? round(peak - rsi, 4) : turningFromBuy ? round(rsi - trough, 4) : null;
  if (state === "EXTREME_AND_ACCELERATING") observations.push("rsi_acelerando_para_o_extremo");
  if (state === "EXTREME_PERSISTENT") observations.push("rsi_persistente_no_extremo");
  if (state === "TURNING_FROM_EXTREME") observations.push("rsi_retornando_do_extremo");
  if (state === "NORMALIZING") observations.push("rsi_normalizando");

  return {
    opportunity: side !== null, side, state, rsi: round(rsi, 4), trajectory,
    slope: round(slope, 4), extremeReached, extremePersistence,
    turning: state === "TURNING_FROM_EXTREME", returnFromExtreme,
    peak: round(peak, 4), trough: round(trough, 4), observations, version: RSI_SPECIALIST_VERSION,
  };
}
