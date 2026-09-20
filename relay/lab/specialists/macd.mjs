/** ESPECIALISTA MACD (lab S02) — 12/26/9 classico. Nao e ordem; descreve momentum. */
export const MACD_VERSION = "lab-macd-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeMacd(snapshot) {
  const m = snapshot?.indicators?.macd ?? null;
  const snapshotId = snapshot?.snapshotId ?? null;
  const atr = num(snapshot?.indicators?.atr);
  const base = { state: "NO_DATA", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: MACD_VERSION };
  if (!m || num(m.macd) === null || num(m.signal) === null) return base;
  const histogram = num(m.histogram);
  const slope = num(m.histogramSlope);
  const direction = m.aboveSignal === true ? "BULLISH" : m.aboveSignal === false ? "BEARISH" : "NEUTRAL";
  const state = m.cross === "BULLISH" ? "CROSS_BULLISH" : m.cross === "BEARISH" ? "CROSS_BEARISH"
    : slope !== null && slope > 0 ? "HISTOGRAM_IMPROVING" : slope !== null && slope < 0 ? "HISTOGRAM_DECAYING" : "FLAT";
  const weakCross = histogram !== null && atr !== null && atr > 0 ? Math.abs(histogram) / atr < 0.15 : null;
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [];
  if (state === "CROSS_BULLISH") { supportingEvidence.push({ code: "MACD_CROSS_BULLISH", detail: "MACD cruzou acima da Signal" }); observations.push("macd cruzou acima da signal"); }
  if (state === "CROSS_BEARISH") { supportingEvidence.push({ code: "MACD_CROSS_BEARISH", detail: "MACD cruzou abaixo da Signal" }); observations.push("macd cruzou abaixo da signal"); }
  if (slope !== null && slope > 0) observations.push("histograma melhorando");
  if (slope !== null && slope < 0) observations.push("histograma deteriorando");
  if (weakCross === true) { counterEvidence.push({ code: "MACD_HISTOGRAM_FRACO", detail: `|hist|/atr=${round(Math.abs(histogram) / (atr || 1), 4)}` }); observations.push("cruzamento fraco vs ATR"); }
  if (m.aboveZero === true) observations.push("macd acima da linha zero");
  if (m.aboveZero === false) observations.push("macd abaixo da linha zero");
  const strength = clamp01((state === "CROSS_BULLISH" || state === "CROSS_BEARISH" ? 0.45 : 0.25) + (slope !== null ? Math.min(0.35, Math.abs(slope) / (atr || Math.abs(histogram || 1))) : 0) + (weakCross === false ? 0.2 : 0));
  return { state, direction, strength: round(strength, 4), histogram: round(histogram, 8), histogramSlope: slope, cross: m.cross ?? null, aboveSignal: m.aboveSignal ?? null, weakCross, supportingEvidence, counterEvidence, observations, snapshotId, version: MACD_VERSION };
}
