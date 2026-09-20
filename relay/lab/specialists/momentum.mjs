/** ESPECIALISTA MOMENTUM (lab S04) — RSI como CONTEXTO secundario (nao gatilho 73/28 desta estrategia). */
export const MOMENTUM_VERSION = "lab-momentum-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeMomentum(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const rsi = num(snapshot?.indicators?.rsi);
  const slope = num(snapshot?.indicators?.rsiSlope);
  const trajectory = (snapshot?.indicators?.rsiTrajectory ?? []).map((v) => num(v)).filter((v) => v !== null);
  const base = { state: "NO_DATA", direction: "NEUTRAL", strength: 0, acceleratingIntoExtreme: false, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: MOMENTUM_VERSION };
  if (rsi === null) return base;
  const peak = trajectory.length ? Math.max(...trajectory) : rsi;
  const trough = trajectory.length ? Math.min(...trajectory) : rsi;
  const acceleratingSell = rsi >= 70 && slope !== null && slope > 0.5;
  const acceleratingBuy = rsi <= 30 && slope !== null && slope < -0.5;
  const turningFromSell = peak >= 70 && rsi < peak && slope !== null && slope <= 0.05;
  const turningFromBuy = trough <= 30 && rsi > trough && slope !== null && slope >= -0.05;
  const state = acceleratingSell || acceleratingBuy ? "MOMENTUM_ACCELERATING"
    : turningFromSell || turningFromBuy ? "MOMENTUM_TURNING"
    : Math.abs(slope ?? 0) <= 0.05 ? "MOMENTUM_FLAT" : "MOMENTUM_DRIFTING";
  const direction = turningFromSell ? "BEARISH" : turningFromBuy ? "BULLISH" : acceleratingSell ? "BEARISH" : acceleratingBuy ? "BULLISH" : "NEUTRAL";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`rsi ${round(rsi, 1)} slope ${round(slope, 3)}`];
  if (state === "MOMENTUM_TURNING") { supportingEvidence.push({ code: "MOMENTUM_TURNING", detail: `retornando do extremo (pico ${round(peak, 1)} / vale ${round(trough, 1)})` }); observations.push("momentum virando do extremo"); }
  if (state === "MOMENTUM_ACCELERATING") { counterEvidence.push({ code: "MOMENTUM_ACELERANDO_CONTRA", detail: "rsi ainda acelerando para o extremo" }); observations.push("momentum acelerando"); }
  if (state === "MOMENTUM_FLAT") observations.push("momentum lateral");
  const strength = clamp01(state === "MOMENTUM_TURNING" ? 0.6 : state === "MOMENTUM_ACCELERATING" ? 0.5 : 0.2);
  return { state, direction, strength: round(strength, 4), rsi: round(rsi, 4), slope, acceleratingIntoExtreme: acceleratingSell || acceleratingBuy, supportingEvidence, counterEvidence, observations, snapshotId, version: MOMENTUM_VERSION };
}
