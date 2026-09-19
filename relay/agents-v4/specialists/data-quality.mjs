/**
 * DATA_QUALITY_AGENT — versao contrato-v4 do avaliador do DataHub.
 * UNSAFE implica NO_TRADE no sistema V4.
 */
import { makeAgentOutput } from "../contracts.mjs";
import { assessDataQuality, DATA_QUALITY_AGENT_VERSION } from "../../datahub/data-quality-agent.mjs";

export function analyzeDataQuality({ features = {}, assessment = null, input = null } = {}) {
  const evaluated = assessment ?? (input ? assessDataQuality(input) : null);
  if (!evaluated) {
    return makeAgentOutput({
      agentId: "DATA_QUALITY_AGENT",
      marketKey: features.marketKey, snapshotId: features.snapshotId,
      state: "UNSAFE",
      assessment: "avaliacao_de_dados_ausente",
      neutralEvidence: [], riskFlags: ["DATA_QUALITY_UNAVAILABLE"], featuresUsed: [],
      confidenceClass: "HIGH", dataQuality: "UNKNOWN",
      reasoningSummary: "Sem avaliacao de dados: postura conservadora, NO_TRADE.",
      availableAt: features.availableAt,
      version: DATA_QUALITY_AGENT_VERSION,
      detail: { noTrade: true },
    });
  }
  const failed = evaluated.checks.filter((row) => !row.ok);
  return makeAgentOutput({
    agentId: "DATA_QUALITY_AGENT",
    marketKey: features.marketKey ?? evaluated.marketKey, snapshotId: features.snapshotId,
    state: evaluated.state,
    assessment: evaluated.assessment,
    bullishEvidence: [], bearishEvidence: [],
    neutralEvidence: evaluated.checks.filter((row) => row.ok).map((row) => `ok:${row.id}`),
    riskFlags: evaluated.unsafeReasons.length ? evaluated.unsafeReasons : evaluated.degradedReasons,
    featuresUsed: ["feed", "candles", "clock", "marketMapping", "feature"],
    confidenceClass: "HIGH",
    dataQuality: evaluated.state,
    reasoningSummary: `data_quality=${evaluated.state}; falhas=${failed.map((row) => row.id).join("|") || "nenhuma"}; noTrade=${evaluated.state === "UNSAFE"}`,
    availableAt: features.availableAt ?? evaluated.availableAt,
    version: DATA_QUALITY_AGENT_VERSION,
    detail: { state: evaluated.state, noTrade: evaluated.state === "UNSAFE", unsafeReasons: evaluated.unsafeReasons, degradedReasons: evaluated.degradedReasons, thresholds: evaluated.thresholds },
  });
}
