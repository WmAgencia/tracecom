/**
 * TREND_AGENT — BULLISH/BEARISH/NEUTRAL/UNCERTAIN + strength/persistence/weakening/maturity.
 * Direcao nunca vem de indicador isolado: exige convergencia de estrutura + forca + momentum.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const TREND_AGENT_VERSION = "trend-agent-v1";
export const TREND_STATES = Object.freeze(["BULLISH", "BEARISH", "NEUTRAL", "UNCERTAIN"]);

export function analyzeTrend({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];
  let up = 0, down = 0;

  const add = (direction, points, reason, feature) => {
    if (direction === "UP") { up += points; bullish.push(reason); } else { down += points; bearish.push(reason); }
    used.push(feature);
  };

  if (f.structureLabel === "UP") add("UP", 1.5, "estrutura5s:HH_HL", "structureLabel");
  if (f.structureLabel === "DOWN") add("DOWN", 1.5, "estrutura5s:LH_LL", "structureLabel");
  if (f.structure1m === "UP") add("UP", 1, "estrutura1m:UP", "structure1m");
  if (f.structure1m === "DOWN") add("DOWN", 1, "estrutura1m:DOWN", "structure1m");
  if (f.context5m === "UP") add("UP", 0.5, "contexto5m:UP", "context5m");
  if (f.context5m === "DOWN") add("DOWN", 0.5, "contexto5m:DOWN", "context5m");
  if (Number.isFinite(f.adx) && f.adx >= 20) {
    if (f.diAlignedUp === true) add("UP", 1.25, `adx=${Number(f.adx).toFixed(1)} (>=20) +DI dominante`, "adx");
    if (f.diAlignedUp === false) add("DOWN", 1.25, `adx=${Number(f.adx).toFixed(1)} (>=20) -DI dominante`, "adx");
  } else if (Number.isFinite(f.adx)) {
    neutral.push(`adx_fraco:${Number(f.adx).toFixed(1)}`); used.push("adx");
  }
  if (Number.isFinite(f.velocityATR)) {
    if (f.velocityATR >= 0.25) add("UP", 1, `velocity=+${f.velocityATR}ATR/candle`, "velocityATR");
    else if (f.velocityATR <= -0.25) add("DOWN", 1, `velocity=${f.velocityATR}ATR/candle`, "velocityATR");
    else neutral.push("velocity_lateral");
  }
  if (f.bosUp) add("UP", 0.5, "BOS_UP", "bosUp");
  if (f.bosDown) add("DOWN", 0.5, "BOS_DOWN", "bosDown");

  const score = Math.max(up, down);
  const direction = up >= down + 1 ? "BULLISH" : down >= up + 1 ? "BEARISH" : up === down && score >= 2 ? "NEUTRAL" : "UNCERTAIN";
  const weakening = (Number.isFinite(f.adxSlope) && f.adxSlope < -0.5) || (Number.isFinite(f.rsiSlope) && ((direction === "BULLISH" && f.rsiSlope < 0) || (direction === "BEARISH" && f.rsiSlope > 0)));
  if (weakening) risks.push("TREND_WEAKENING");
  const maturity = (() => {
    if (f.overextended && direction !== "UNCERTAIN") return "MATURE";
    if (Number.isFinite(f.persistence) && Math.abs(f.persistence) >= 4) return "EXTENDED";
    if (Number.isFinite(f.persistence) && Math.abs(f.persistence) >= 2) return "DEVELOPING";
    return "EARLY";
  })();
  const persistence = Number.isFinite(f.persistence) ? f.persistence : null;
  const strength = Math.max(0, Math.min(1, Number((score / 5.75).toFixed(3))));

  let state = direction;
  if (score < 2) state = "UNCERTAIN";
  else if (direction === "NEUTRAL") state = "NEUTRAL";
  if (!Number.isFinite(f.adx) && !Number.isFinite(f.velocityATR)) { state = "UNCERTAIN"; risks.push("TREND_FEATURES_MISSING"); }

  return makeAgentOutput({
    agentId: "TREND_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `tendencia=${state} score=${Number(score.toFixed(2))}`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: score >= 4.5 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `up=${Number(up.toFixed(2))} down=${Number(down.toFixed(2))} adx=${f.adx} di=${f.diAlignedUp} velocityATR=${f.velocityATR} weakening=${weakening}`,
    availableAt: f.availableAt,
    detail: {
      direction: up > down ? "UP" : down > up ? "DOWN" : "NONE",
      strength,
      persistence,
      weakening,
      maturity,
      adxSlope: f.adxSlope,
      rsiSlope: f.rsiSlope,
    },
  });
}
