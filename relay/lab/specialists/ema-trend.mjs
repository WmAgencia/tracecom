/** ESPECIALISTA EMA/TREND (lab S03) — EMA 9/21 (hipotese experimental de curto prazo; nao universal). */
export const EMA_TREND_VERSION = "lab-ema-trend-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeEmaTrend(snapshot) {
  const e = snapshot?.indicators?.ema ?? null;
  const snapshotId = snapshot?.snapshotId ?? null;
  const atr = num(snapshot?.indicators?.atr);
  const close = num(snapshot?.ohlc?.close);
  const base = { state: "NO_DATA", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: EMA_TREND_VERSION };
  if (!e || num(e.fast) === null || num(e.slow) === null) return base;
  const fastSlope = num(e.fastSlope);
  const slowSlope = num(e.slowSlope);
  const spread = num(e.spread);
  const alignment = e.alignment;
  const slopeCoherent = alignment === "BULLISH" ? fastSlope !== null && slowSlope !== null && fastSlope > 0 && slowSlope > 0
    : alignment === "BEARISH" ? fastSlope !== null && slowSlope !== null && fastSlope < 0 && slowSlope < 0 : false;
  const state = alignment === "BULLISH" && slopeCoherent ? "ALIGNED_BULLISH" : alignment === "BEARISH" && slopeCoherent ? "ALIGNED_BEARISH"
    : alignment === "BULLISH" || alignment === "BEARISH" ? "MIXED_SLOPES" : "FLAT";
  const direction = state === "ALIGNED_BULLISH" ? "BULLISH" : state === "ALIGNED_BEARISH" ? "BEARISH" : "NEUTRAL";
  const spreadNorm = spread !== null && atr !== null && atr > 0 ? Math.abs(spread) / atr : null;
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [];
  if (state === "ALIGNED_BULLISH") { supportingEvidence.push({ code: "EMA_ALIGNED_BULLISH", detail: "EMA9>EMA21 com ambas inclinadas para cima" }); observations.push("tendencia EMA alinhada de alta"); }
  if (state === "ALIGNED_BEARISH") { supportingEvidence.push({ code: "EMA_ALIGNED_BEARISH", detail: "EMA9<EMA21 com ambas inclinadas para baixo" }); observations.push("tendencia EMA alinhada de baixa"); }
  if (state === "MIXED_SLOPES") counterEvidence.push({ code: "EMA_SLOPES_DIVERGENTES", detail: "alinhamento sem inclinacao coerente" });
  if (spreadNorm !== null) observations.push(`spread/atr=${round(spreadNorm, 3)}`);
  if (close !== null && num(e.fast) !== null) observations.push(close > num(e.fast) ? "preco acima da EMA rapida" : "preco abaixo da EMA rapida");
  const strength = clamp01((state === "ALIGNED_BULLISH" || state === "ALIGNED_BEARISH" ? 0.5 : 0.15) + (spreadNorm !== null ? Math.min(0.5, spreadNorm / 2) : 0));
  return { state, direction, strength: round(strength, 4), fast: round(num(e.fast), 8), slow: round(num(e.slow), 8), spreadNorm: round(spreadNorm, 4), fastSlope, slowSlope, supportingEvidence, counterEvidence, observations, snapshotId, version: EMA_TREND_VERSION };
}
