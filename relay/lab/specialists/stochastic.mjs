/** ESPECIALISTA STOCHASTIC (lab S05) — Fast %K14 / %D SMA3. Extremo NAO e ordem; procura virada. */
export const STOCHASTIC_VERSION = "lab-stochastic-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeStochastic(snapshot) {
  const st = snapshot?.indicators?.stochastic ?? null;
  const snapshotId = snapshot?.snapshotId ?? null;
  const base = { state: "NO_DATA", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: STOCHASTIC_VERSION };
  if (!st || num(st.k) === null) return base;
  const k = num(st.k); const d = num(st.d); const kLag = num(st.kLag); const kSlope = num(st.kSlope);
  const oversold = k <= 20; const overbought = k >= 80;
  const wasOversold = kLag !== null && kLag <= 20; const wasOverbought = kLag !== null && kLag >= 80;
  const turnUp = kSlope !== null && kSlope > 0; const turnDown = kSlope !== null && kSlope < 0;
  const cross = d !== null && kLag !== null ? (k > d && kLag <= d ? "BULLISH" : k < d && kLag >= d ? "BEARISH" : null) : null;
  const state = wasOversold && turnUp ? "TURNING_FROM_OVERSOLD" : wasOverbought && turnDown ? "TURNING_FROM_OVERBOUGHT"
    : oversold ? "PERSISTENT_OVERSOLD" : overbought ? "PERSISTENT_OVERBOUGHT" : "NEUTRAL";
  const direction = state === "TURNING_FROM_OVERSOLD" ? "BULLISH" : state === "TURNING_FROM_OVERBOUGHT" ? "BEARISH" : "NEUTRAL";
  const divergenceCandidate = kLag !== null ? (k > kLag && snapshot?.indicators?.shortHorizonDirection === "BEARISH" ? "BULLISH_DIVERGENCE_CANDIDATE" : k < kLag && snapshot?.indicators?.shortHorizonDirection === "BULLISH" ? "BEARISH_DIVERGENCE_CANDIDATE" : null) : null;
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`%K ${round(k, 1)} %D ${round(d ?? 0, 1)} slope ${round(kSlope ?? 0, 3)}`];
  if (state === "TURNING_FROM_OVERSOLD") { supportingEvidence.push({ code: "STOCHASTIC_TURN_BULLISH", detail: "saiu do oversold com %K virando para cima" }); observations.push("virada de oversold"); }
  if (state === "TURNING_FROM_OVERBOUGHT") { supportingEvidence.push({ code: "STOCHASTIC_TURN_BEARISH", detail: "saiu do overbought com %K virando para baixo" }); observations.push("virada de overbought"); }
  if (cross) { supportingEvidence.push({ code: `STOCHASTIC_CROSS_${cross}`, detail: `%K cruzou %D (${cross})` }); observations.push(`cruzamento ${cross.toLowerCase()}`); }
  if (state === "PERSISTENT_OVERSOLD" || state === "PERSISTENT_OVERBOUGHT") { counterEvidence.push({ code: "STOCHASTIC_STILL_EXTREME", detail: state }); observations.push("ainda persistente no extremo"); }
  if (state === "NEUTRAL") counterEvidence.push({ code: "STOCHASTIC_SEM_VIRADA", detail: "fora de extremo ou sem virada" });
  if (divergenceCandidate) observations.push(divergenceCandidate.toLowerCase().replace(/_/g, " "));
  const strength = clamp01((state.startsWith("TURNING") ? 0.55 : 0.1) + (cross ? 0.25 : 0) + (divergenceCandidate ? 0.1 : 0));
  return { state, direction, strength: round(strength, 4), k: round(k, 4), d: round(d, 4), kSlope, cross, divergenceCandidate, supportingEvidence, counterEvidence, observations, snapshotId, version: STOCHASTIC_VERSION };
}
