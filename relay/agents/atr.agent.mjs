/**
 * AGENTE ATR — especialista em volatilidade (Wilder 14). Nao da direcao.
 * Normalizado vs mediana recente: mercado morto / normal / ruidoso; expansao vs compressao.
 */
export const ATR_AGENT_VERSION = "agent-atr-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeAtrAgent(snapshot, { deadRatio = 0.3, noisyRatio = 2.5 } = {}) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const atrNorm = num(snapshot?.indicators?.atrNormalized);
  const median = num(snapshot?.indicators?.atrNormalizedMedian60);
  const rsi = num(snapshot?.indicators?.rsi);
  const adx = num(snapshot?.indicators?.adx?.value);
  const adxSlope = num(snapshot?.indicators?.adx?.slope);
  const base = { agent: "ATR", version: ATR_AGENT_VERSION, snapshotId, state: "NO_DATA", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [] };
  if (atrNorm === null || median === null || median <= 0) return base;
  const ratio = atrNorm / median;
  const state = ratio < deadRatio ? "DEAD" : ratio > noisyRatio ? "NOISY" : "NORMAL";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`atr/close vs mediana60 = ${round(ratio, 3)}`];
  if (state === "DEAD") { counterEvidence.push({ code: "ATR_MERCADO_MORTO", detail: `ratio ${round(ratio, 3)} < ${deadRatio}` }); observations.push("mercado morto (sem edge para reversao)"); }
  if (state === "NOISY") { counterEvidence.push({ code: "ATR_RUIDO_ANORMAL", detail: `ratio ${round(ratio, 3)} > ${noisyRatio}` }); observations.push("volatilidade anormal"); }
  if (state === "NORMAL") supportingEvidence.push({ code: "ATR_NORMAL", detail: `ratio ${round(ratio, 3)}` });
  const climactic = ratio > 1.5 && rsi !== null && (rsi >= 70 || rsi <= 30) && adx !== null && adx >= 25 && adxSlope !== null && adxSlope > 0;
  if (climactic) { counterEvidence.push({ code: "ATR_MOVIMENTO_CLIMATICO", detail: "volatilidade expandindo com extremo + tendencia forte (risco de continuacao)" }); observations.push("movimento climatico (nao fade)"); }
  // Regime de volatilidade: TR medio recente (5 min) vs anterior (5 min) — expandindo/contraindo.
  const candles = Array.isArray(snapshot?.recentCandles) ? snapshot.recentCandles : [];
  const trAt = (list, i) => { const c = list[i]; const p = list[i - 1]; if (!c || !p) return null; const tr = Math.max(Number(c.high) - Number(c.low), Math.abs(Number(c.high) - Number(p.close)), Math.abs(Number(c.low) - Number(p.close))); return Number.isFinite(tr) ? tr : null; };
  const meanTr = (from, to) => { let s = 0; let k = 0; for (let i = Math.max(1, from); i < to; i += 1) { const tr = trAt(candles, i); if (tr !== null) { s += tr; k += 1; } } return k ? s / k : null; };
  const nCandles = candles.length;
  const recentTr = nCandles >= 30 ? meanTr(nCandles - 60, nCandles) : null;
  const priorTr = nCandles >= 70 ? meanTr(nCandles - 120, nCandles - 60) : null;
  const volRatio = recentTr !== null && priorTr !== null && priorTr > 0 ? recentTr / priorTr : null;
  const volTrend = volRatio === null ? null : volRatio > 1.25 ? "EXPANDING" : volRatio < 0.8 ? "CONTRACTING" : "STABLE";
  if (volTrend === "EXPANDING") observations.push(`volatilidade expandindo (${round(volRatio, 2)}x)`);
  if (volTrend === "CONTRACTING") observations.push(`volatilidade contraindo (${round(volRatio, 2)}x)`);
  return {
    agent: "ATR", version: ATR_AGENT_VERSION, snapshotId, state, direction: "NEUTRAL",
    ratio: round(ratio, 4), atrNormalized: round(atrNorm, 8), median60: round(median, 8), climactic, volTrend, volRatio: volRatio === null ? null : round(volRatio, 4),
    strength: round(clamp01(state === "NORMAL" ? 0.5 : 0.2), 4), supportingEvidence, counterEvidence, observations,
    opinion: state === "DEAD" ? "Mercado morto (movimento pequeno)." : state === "NOISY" ? "Volatilidade anormal." : `Volatilidade normal (${round(ratio, 2)}x mediana).`,
  };
}
