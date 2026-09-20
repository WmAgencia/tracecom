/** ESPECIALISTA PULLBACK (lab S03) — detecta retracao contra a tendencia e a RETOMADA (nao antecipa). */
export const PULLBACK_VERSION = "lab-pullback-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzePullback(snapshot, emaTrend) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const candles = (snapshot?.recentCandles ?? []).slice(-8);
  const e = snapshot?.indicators?.ema ?? null;
  const base = { state: "NO_CONTEXT", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: PULLBACK_VERSION };
  if (candles.length < 5 || !e || !emaTrend || emaTrend.direction === "NEUTRAL") return base;
  const bullish = emaTrend.direction === "BULLISH";
  const fast = num(e.fast); const slow = num(e.slow);
  const last = candles[candles.length - 1]; const prev = candles[candles.length - 2];
  const lastBull = Number(last.close) > Number(last.open); const lastBear = Number(last.close) < Number(last.open);
  const prevBull = Number(prev.close) > Number(prev.open); const prevBear = Number(prev.close) < Number(prev.open);
  const retraceCandles = candles.slice(0, -2).filter((c) => bullish ? Number(c.close) < Number(c.open) : Number(c.close) > Number(c.open)).length;
  const hadPullback = retraceCandles >= 2;
  const brokeSlow = bullish ? Number(last.close) < slow : Number(last.close) > slow;
  const resumed = bullish ? (lastBull || prevBull) && Number(last.close) > Number(prev.close) && Number(last.close) > fast
    : (lastBear || prevBear) && Number(last.close) < Number(prev.close) && Number(last.close) < fast;
  const state = brokeSlow ? "TREND_BREAK_SLOW_EMA" : !hadPullback ? "NO_PULLBACK" : resumed ? (bullish ? "RESUMPTION_BULLISH" : "RESUMPTION_BEARISH") : "PULLBACK_IN_PROGRESS";
  const direction = state === "RESUMPTION_BULLISH" ? "BULLISH" : state === "RESUMPTION_BEARISH" ? "BEARISH" : "NEUTRAL";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [];
  if (hadPullback) observations.push(`retracao de ${retraceCandles} candles contra a tendencia`);
  if (state === "RESUMPTION_BULLISH" || state === "RESUMPTION_BEARISH") { supportingEvidence.push({ code: "PULLBACK_RESUMPTION", detail: `${state}` }); observations.push("retomada da tendencia apos pullback"); }
  if (state === "PULLBACK_IN_PROGRESS") { counterEvidence.push({ code: "PULLBACK_SEM_RETOMADA", detail: "pullback ainda em andamento" }); observations.push("sem confirmacao de retomada"); }
  if (state === "TREND_BREAK_SLOW_EMA") { counterEvidence.push({ code: "TREND_BREAK_SLOW_EMA", detail: "preco perdeu a EMA lenta" }); observations.push("tendencia rompeu a EMA lenta"); }
  if (!hadPullback && state !== "TREND_BREAK_SLOW_EMA") counterEvidence.push({ code: "SEM_PULLBACK", detail: "sem retracao clara" });
  const strength = clamp01(state.startsWith("RESUMPTION") ? 0.6 + Math.min(0.3, retraceCandles * 0.1) : state === "PULLBACK_IN_PROGRESS" ? 0.3 : 0.1);
  return { state, direction, strength: round(strength, 4), retraceCandles, supportingEvidence, counterEvidence, observations, snapshotId, version: PULLBACK_VERSION };
}
