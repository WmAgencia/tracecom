/**
 * PROFESSIONAL_AGENT_SYSTEM_V4 — contratos base.
 *
 * SHADOW ONLY. Nenhum agente desta arvore envia ordem, altera stake/direcao/threshold/JIT/
 * Execution Gate ou o allowlist REAL. ConfidenceClass NAO e probabilidade calibrada.
 */
export const AGENTS_V4_SYSTEM_VERSION = "professional-agent-system-v4";
export const AGENTS_V4_MODE = "SHADOW_ONLY";
export const AGENT_VERSION = "agent-v4";
export const SNAPSHOT_MODEL = "t0-enriched-v1";

export const AGENT_IDS = Object.freeze([
  "MARKET_REGIME_AGENT",
  "MARKET_STRUCTURE_AGENT",
  "TREND_AGENT",
  "LOCATION_AGENT",
  "MOMENTUM_AGENT",
  "VOLATILITY_AGENT",
  "PRICE_ACTION_AGENT",
  "MICROSTRUCTURE_AGENT",
  "SCENARIO_AGENT",
  "EXECUTION_TIMING_AGENT",
  "RISK_CONTEXT_AGENT",
  "DATA_QUALITY_AGENT",
]);

export const CONFIDENCE_CLASSES = Object.freeze(["LOW", "MEDIUM", "HIGH"]);

export const AGENT_POLICY = Object.freeze({
  version: AGENTS_V4_SYSTEM_VERSION,
  mode: AGENTS_V4_MODE,
  controlsExecution: false,
  sendsOrders: false,
  promotesToReal: false,
  realAllowlistUntouched: true,
  confidenceIsProbability: false,
  estimatedWinProbability: null,
  noDumbVoting: true,
  note: "Agentes de pesquisa; a decisao V4 e observacional e nunca atravessa PRACTICE/REAL.",
});

export function validateAgentOutput(output = {}) {
  const errors = [];
  if (!AGENT_IDS.includes(output.agentId)) errors.push(`AGENT_ID_INVALID:${String(output.agentId)}`);
  if (output.agentVersion !== AGENT_VERSION) errors.push("AGENT_VERSION_MISMATCH");
  if (!output.marketKey) errors.push("MARKET_KEY_MISSING");
  if (!output.snapshotId) errors.push("SNAPSHOT_ID_MISSING");
  if (typeof output.state !== "string" || !output.state) errors.push("STATE_MISSING");
  if (typeof output.assessment !== "string" || !output.assessment) errors.push("ASSESSMENT_MISSING");
  for (const key of ["bullishEvidence", "bearishEvidence", "neutralEvidence", "riskFlags", "featuresUsed"]) {
    if (!Array.isArray(output[key])) errors.push(`${key.toUpperCase()}_NOT_ARRAY`);
  }
  if (!CONFIDENCE_CLASSES.includes(output.confidenceClass)) errors.push(`CONFIDENCE_INVALID:${String(output.confidenceClass)}`);
  if (output.dataQuality !== undefined && typeof output.dataQuality !== "string") errors.push("DATA_QUALITY_INVALID");
  if (typeof output.reasoningSummary !== "string" || !output.reasoningSummary) errors.push("REASONING_MISSING");
  if (!Number.isFinite(Number(output.availableAt))) errors.push("AVAILABLE_AT_INVALID");
  if (output.controlsExecution === true) errors.push("AGENT_MUST_NOT_CONTROL_EXECUTION");
  return { ok: errors.length === 0, errors };
}

export function makeAgentOutput({
  agentId,
  marketKey = null,
  snapshotId = null,
  state,
  assessment,
  bullishEvidence = [],
  bearishEvidence = [],
  neutralEvidence = [],
  riskFlags = [],
  featuresUsed = [],
  confidenceClass = "LOW",
  dataQuality = "UNKNOWN",
  reasoningSummary,
  availableAt = null,
  detail = null,
  version = AGENT_VERSION,
} = {}) {
  return {
    agentId,
    agentVersion: version,
    marketKey,
    snapshotId,
    state: state ?? "UNKNOWN",
    assessment: assessment ?? "indefinido",
    bullishEvidence: bullishEvidence.filter(Boolean).slice(0, 12),
    bearishEvidence: bearishEvidence.filter(Boolean).slice(0, 12),
    neutralEvidence: neutralEvidence.filter(Boolean).slice(0, 12),
    riskFlags: riskFlags.filter(Boolean).slice(0, 8),
    featuresUsed: featuresUsed.filter(Boolean),
    confidenceClass: CONFIDENCE_CLASSES.includes(confidenceClass) ? confidenceClass : "LOW",
    dataQuality,
    reasoningSummary: reasoningSummary ?? "sem_resumo",
    availableAt: Number.isFinite(Number(availableAt)) ? Number(availableAt) : Date.now(),
    detail,
    controlsExecution: false,
    estimatedWinProbability: null,
  };
}

export function confidenceFrom(counts = {}) {
  const total = Number(counts.total) || 0;
  if (total === 0) return "LOW";
  const ratio = Math.max(0, Math.min(1, Number(counts.supporting) / total));
  if (ratio >= 0.75 && total >= 4) return "HIGH";
  if (ratio >= 0.5) return "MEDIUM";
  return "LOW";
}

export function featureFreshnessClass(t0 = null) {
  const availableAt = Number(t0?.times?.availableAt);
  const decisionAt = Number(t0?.times?.decisionAt);
  if (!Number.isFinite(availableAt) || !Number.isFinite(decisionAt)) return "UNKNOWN";
  const age = Math.max(0, decisionAt - availableAt);
  if (age <= 6_000) return "HIGH";
  if (age <= 21_000) return "MEDIUM";
  return "LOW";
}
