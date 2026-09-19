/**
 * MOMENTUM_AGENT — RSI + trajetoria, velocity, acceleration, DI spread/slope, persistencia.
 * Estados: STRONG / BUILDING / STABLE / WEAKENING / REVERSING (+ direction).
 */
import { makeAgentOutput } from "../contracts.mjs";

export const MOMENTUM_AGENT_VERSION = "momentum-agent-v1";
export const MOMENTUM_STATES = Object.freeze(["STRONG", "BUILDING", "STABLE", "WEAKENING", "REVERSING"]);

export function analyzeMomentum({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];

  const votes = [];
  if (Number.isFinite(f.velocity)) { votes.push(Math.sign(f.velocity)); used.push("velocity"); }
  if (Number.isFinite(f.rsiSlope) && f.rsiSlope !== 0) { votes.push(Math.sign(f.rsiSlope)); used.push("rsiSlope"); }
  if (Number.isFinite(f.acceleration) && f.acceleration !== 0) { votes.push(Math.sign(f.acceleration)); used.push("acceleration"); }
  if (f.diAlignedUp === true) { votes.push(1); used.push("plusDI", "minusDI"); }
  else if (f.diAlignedUp === false) { votes.push(-1); used.push("plusDI", "minusDI"); }
  const net = votes.reduce((sum, vote) => sum + vote, 0);
  const direction = net > 0 ? "UP" : net < 0 ? "DOWN" : "FLAT";

  const available = Number.isFinite(f.velocity) || Number.isFinite(f.rsi) || Number.isFinite(f.rsiSlope);
  const velocityATR = f.velocityATR;
  const accelATR = f.accelerationATR;
  const alignedAccel = Number.isFinite(velocityATR) && Number.isFinite(accelATR) && Math.sign(accelATR) === Math.sign(velocityATR) && Math.abs(accelATR) >= 0.05;
  const divergingAccel = Number.isFinite(velocityATR) && Number.isFinite(accelATR) && Math.sign(accelATR) !== Math.sign(velocityATR) && Math.abs(accelATR) >= 0.05;
  const rsiTurningAgainst = Number.isFinite(f.rsiSlope) && Number.isFinite(velocityATR) && f.rsiSlope !== 0 && velocityATR !== 0 && Math.sign(f.rsiSlope) !== Math.sign(velocityATR);
  const strongVelocity = Number.isFinite(velocityATR) && Math.abs(velocityATR) >= 0.25;
  const persistent = Number.isFinite(f.persistence) && Math.abs(f.persistence) >= 2 && ((f.persistence > 0 && direction === "UP") || (f.persistence < 0 && direction === "DOWN"));

  let state = "STABLE";
  if (!available) { state = "STABLE"; risks.push("MOMENTUM_FEATURES_MISSING"); neutral.push("sem_velocidade_ou_rsi"); }
  else if (rsiTurningAgainst) { state = "REVERSING"; risks.push("MOMENTUM_DIVERGENCE"); }
  else if (divergingAccel) { state = "WEAKENING"; risks.push("ACCELERATION_AGAINST_VELOCITY"); }
  else if (strongVelocity && (alignedAccel || persistent) && direction !== "FLAT") state = "STRONG";
  else if (strongVelocity && direction !== "FLAT") state = "BUILDING";
  else if (!strongVelocity && (alignedAccel || persistent) && direction !== "FLAT") state = "BUILDING";
  else state = "STABLE";

  if (direction === "UP") bullish.push(`momentum_up:net=${net}`); else if (direction === "DOWN") bearish.push(`momentum_down:net=${net}`); else neutral.push("momentum_neutro");
  if (Number.isFinite(f.rsi)) neutral.push(`rsi14=${Number(f.rsi).toFixed(1)}`);
  if (Number.isFinite(f.diSpread)) neutral.push(`diSpread=${f.diSpread}`);
  if (Number.isFinite(f.rsi) && f.rsi >= 70) risks.push("RSI_EXTREMO_ALTO");
  if (Number.isFinite(f.rsi) && f.rsi <= 30) risks.push("RSI_EXTREMO_BAIXO");

  return makeAgentOutput({
    agentId: "MOMENTUM_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `momentum=${state} direcao=${direction}`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: state === "STRONG" || state === "REVERSING" ? "HIGH" : state === "BUILDING" || state === "WEAKENING" ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `velocityATR=${velocityATR} accelATR=${accelATR} rsi=${f.rsi} rsiSlope=${f.rsiSlope} persistence=${f.persistence} net=${net}`,
    availableAt: f.availableAt,
    detail: { direction, net, strength: Number.isFinite(velocityATR) ? Math.min(1, Math.abs(velocityATR) / 0.5) : null, persistence: f.persistence ?? null, alignment: { strongVelocity, alignedAccel, divergingAccel, rsiTurningAgainst, persistent } },
  });
}
