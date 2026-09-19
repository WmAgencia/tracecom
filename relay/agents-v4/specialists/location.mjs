/**
 * LOCATION_AGENT — posicao no canal/range, distancia a S/R e swings, extensao em ATR.
 * Responde "onde o preco esta", nunca "para onde vai".
 */
import { makeAgentOutput } from "../contracts.mjs";

export const LOCATION_AGENT_VERSION = "location-agent-v1";
export const LOCATION_STATES = Object.freeze(["EDGE_UPPER", "EDGE_LOWER", "OVEREXTENDED_UPPER", "OVEREXTENDED_LOWER", "MID", "UPPER_HALF", "LOWER_HALF", "UNKNOWN"]);

export function analyzeLocation({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];

  if (!Number.isFinite(f.donchianPosition)) {
    return makeAgentOutput({
      agentId: "LOCATION_AGENT", marketKey: f.marketKey, snapshotId: f.snapshotId,
      state: "UNKNOWN", assessment: "donchian_indisponivel",
      neutralEvidence: ["sem_posicao_de_canal"], riskFlags: ["LOCATION_FEATURES_MISSING"],
      featuresUsed: [], confidenceClass: "LOW", dataQuality,
      reasoningSummary: "Donchian position ausente no T0 enriquecido.",
      availableAt: f.availableAt,
      detail: { donchianPosition: null },
    });
  }

  used.push("donchianPosition", "distanceToUpperATR", "distanceToLowerATR");
  const position = f.donchianPosition;
  const overextendedUpper = Number.isFinite(f.distanceToUpperATR) && f.distanceToUpperATR < -2.5;
  const overextendedLower = Number.isFinite(f.distanceToLowerATR) && f.distanceToLowerATR < -2.5;
  let state = "UNKNOWN";
  if (overextendedUpper) state = "OVEREXTENDED_UPPER";
  else if (overextendedLower) state = "OVEREXTENDED_LOWER";
  else if (f.overextended) state = "OVEREXTENDED_UPPER";
  else if (position >= 0.85) state = "EDGE_UPPER";
  else if (position <= 0.15) state = "EDGE_LOWER";
  else if (Math.abs(position - 0.5) <= 0.15) state = "MID";
  else state = position > 0.5 ? "UPPER_HALF" : "LOWER_HALF";

  if (state === "EDGE_UPPER" || state === "OVEREXTENDED_UPPER") bearish.push(`preco_no_topo:pos=${position}`);
  if (state === "EDGE_LOWER" || state === "OVEREXTENDED_LOWER") bullish.push(`preco_no_fundo:pos=${position}`);
  if (state === "MID") neutral.push("meio_do_canal_sem_edge");
  if (state.startsWith("OVEREXTENDED")) risks.push("LOCATION_OVEREXTENDED");
  if (Number.isFinite(f.distanceToResistanceATR)) neutral.push(`dist_resistencia=${f.distanceToResistanceATR}ATR`);
  if (Number.isFinite(f.distanceToSupportATR)) neutral.push(`dist_suporte=${f.distanceToSupportATR}ATR`);

  return makeAgentOutput({
    agentId: "LOCATION_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `localizacao=${state} pos=${Number(position).toFixed(3)}`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: position <= 0.15 || position >= 0.85 || state.startsWith("OVEREXTENDED") ? "HIGH" : Math.abs(position - 0.5) <= 0.15 ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `pos=${position}; edge_sup=${position >= 0.85}; edge_inf=${position <= 0.15}; meio=${Math.abs(position - 0.5) <= 0.15}; extensao=${state.startsWith("OVEREXTENDED")}`,
    availableAt: f.availableAt,
    detail: {
      donchianPosition: position,
      zone: state,
      channelHigh: f.rangeHigh, channelLow: f.rangeLow,
      distanceToUpperATR: f.distanceToUpperATR, distanceToLowerATR: f.distanceToLowerATR,
      distanceToResistanceATR: f.distanceToResistanceATR, distanceToSupportATR: f.distanceToSupportATR,
      resistance: f.resistance, support: f.support,
      overextended: state.startsWith("OVEREXTENDED"),
      mid: state === "MID",
      edge: state === "EDGE_UPPER" || state === "EDGE_LOWER",
    },
  });
}
