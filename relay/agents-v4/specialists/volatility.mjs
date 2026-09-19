/**
 * VOLATILITY_AGENT — ATR/ATR slope/realized vol/Donchian width/Bollinger width/compression/expansion.
 * Nunca escolhe direcao.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const VOLATILITY_AGENT_VERSION = "volatility-agent-v1";
export const VOLATILITY_STATES = Object.freeze(["COMPRESSED", "NORMAL", "EXPANDING", "EXPANDED", "VOLATILE_SPIKE", "UNKNOWN"]);

export function analyzeVolatility({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const neutral = [];
  const risks = [];
  const used = ["atr", "atrRatio", "atrSlope", "realizedVol"];

  if (!Number.isFinite(f.atr) || !Number.isFinite(f.atrRatio)) {
    return makeAgentOutput({
      agentId: "VOLATILITY_AGENT", marketKey: f.marketKey, snapshotId: f.snapshotId,
      state: "UNKNOWN", assessment: "atr_indisponivel",
      neutralEvidence: ["sem_atr_no_t0"], riskFlags: ["VOLATILITY_FEATURES_MISSING"],
      featuresUsed: ["atr", "atrRatio"], confidenceClass: "LOW", dataQuality,
      reasoningSummary: "ATR/ATR ratio ausentes.",
      availableAt: f.availableAt,
      detail: { atr: null, atrRatio: null },
    });
  }

  let state = "NORMAL";
  if (f.atrRatio > 2.5) { state = "VOLATILE_SPIKE"; risks.push("ATR_RATIO_SPIKE"); }
  else if (f.expanded || f.atrRatio > 1.4) state = "EXPANDED";
  else if (f.expansionEvent && Number.isFinite(f.atrSlope) && f.atrSlope > 0) state = "EXPANDING";
  else if (f.compressed || f.atrRatio < 0.7) state = "COMPRESSED";
  else if (Number.isFinite(f.atrSlope) && f.atrSlope > 0.02 && f.atrRatio > 1.1) state = "EXPANDING";
  else state = "NORMAL";

  neutral.push(`atrRatio=${f.atrRatio}`);
  if (Number.isFinite(f.realizedVol)) neutral.push(`realizedVol=${f.realizedVol}`);
  if (Number.isFinite(f.donchianWidthATR)) neutral.push(`donchianWidthATR=${f.donchianWidthATR}`);
  if (Number.isFinite(f.bollingerWidthATR)) neutral.push(`bollingerWidthATR=${f.bollingerWidthATR}`);
  if (state !== "NORMAL" && state !== "UNKNOWN") neutral.push(`estado_volatilidade=${state}`);

  return makeAgentOutput({
    agentId: "VOLATILITY_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `volatilidade=${state} atrRatio=${f.atrRatio}`,
    bullishEvidence: [], bearishEvidence: [],
    neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used.filter((path) => f[path] !== null),
    confidenceClass: state === "VOLATILE_SPIKE" || state === "EXPANDED" || state === "COMPRESSED" ? "HIGH" : "MEDIUM",
    dataQuality,
    reasoningSummary: `ATR nao define direcao; atrRatio=${f.atrRatio} atrSlope=${f.atrSlope} compressed=${f.compressed} expanded=${f.expanded}`,
    availableAt: f.availableAt,
    detail: {
      atr: f.atr, atrRatio: f.atrRatio, atrSlope: f.atrSlope,
      realizedVol: f.realizedVol, donchianWidthATR: f.donchianWidthATR, bollingerWidthATR: f.bollingerWidthATR,
      compression: f.compressed, expansion: f.expanded, direction: "NONE",
    },
  });
}
