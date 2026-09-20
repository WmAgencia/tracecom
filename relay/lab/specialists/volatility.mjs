/** ESPECIALISTA VOLATILITY (lab S03) — ATR normalizado vs mediana60 (thresholds documentados na spec). */
export const VOLATILITY_VERSION = "lab-volatility-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);

export function analyzeVolatility(snapshot, { deadRatio = 0.3, noisyRatio = 2.5 } = {}) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const atrNorm = num(snapshot?.indicators?.atrNormalized);
  const median = num(snapshot?.indicators?.atrNormalizedMedian60);
  const base = { state: "NO_DATA", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: VOLATILITY_VERSION };
  if (atrNorm === null || median === null || median <= 0) return base;
  const ratio = atrNorm / median;
  const state = ratio < deadRatio ? "DEAD_MARKET" : ratio > noisyRatio ? "NOISY_MARKET" : "NORMAL";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`atr/close vs mediana60 = ${round(ratio, 3)}`];
  if (state === "DEAD_MARKET") { counterEvidence.push({ code: "VOLATILITY_DEAD_MARKET", detail: `ratio ${round(ratio, 3)} < ${deadRatio}` }); observations.push("mercado morto"); }
  if (state === "NOISY_MARKET") { counterEvidence.push({ code: "VOLATILITY_NOISY", detail: `ratio ${round(ratio, 3)} > ${noisyRatio}` }); observations.push("ruido anormal"); }
  if (state === "NORMAL") supportingEvidence.push({ code: "VOLATILITY_NORMAL", detail: `ratio ${round(ratio, 3)}` });
  return { state, direction: "NEUTRAL", strength: state === "NORMAL" ? 0.5 : 0.2, ratio: round(ratio, 4), supportingEvidence, counterEvidence, observations, snapshotId, version: VOLATILITY_VERSION };
}
