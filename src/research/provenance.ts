/** Formal decision provenance + structured WHY objects (pure). */
import { OPENCODE_GO_DEFAULT_MODEL } from "../ai/opencode-go";

export const THRESHOLD_VERSION = "profiles-experimental-v1";
export const CONFIG_VERSION = "engine-v2";
export const PROMPT_VERSION = "sanitized-crop-base64-v1";

export type WhyObject = { primaryReasons: string[]; supportingEvidence: string[]; opposingEvidence: string[]; rejectedAlternatives: string[]; uncertaintyFactors: string[]; riskFactors: string[] };

export type ProvenanceInput = {
  decisionId: string; sessionId?: string | null; marketEventId?: string | null; frameId?: string | null; candleId?: string | null;
  priceObservationIds?: string[]; contextVersions?: { macro?: number | null; micro?: number | null; deep?: number | null };
  agentRunIds?: string[]; bullRunId?: string | null; bearRunId?: string | null; fusionRunId?: string | null; arbiterRunId?: string | null;
  profile: string; rawScores?: Record<string, number | null>; calibratedScores?: Record<string, number | null>;
  decision: "BUY" | "SELL" | "WAIT"; directionalLean: "BUY" | "SELL" | "NONE";
  bullScore?: number | null; bearScore?: number | null; rawConfidence?: number | null; regime?: string | null;
  trendAlignment?: string | null; counterTrend?: boolean; reversalEvidence?: string[]; blockedBy?: string[];
  conflicts?: string[]; warnings?: string[]; traceId?: string | null; now?: number;
};

export function buildWhy(input: ProvenanceInput): WhyObject {
  const why: WhyObject = { primaryReasons: [], supportingEvidence: [], opposingEvidence: [], rejectedAlternatives: [], uncertaintyFactors: [], riskFactors: [] };
  const directional = input.decision === "BUY" || input.decision === "SELL";
  if (directional) why.primaryReasons.push(`${input.profile}_thresholds_satisfied`, `directional_separation=${((input.bullScore ?? 0) - (input.bearScore ?? 0)).toFixed(3)}`);
  else why.primaryReasons.push("no_profile_threshold_satisfied");
  if (input.regime) why.supportingEvidence.push(`regime=${input.regime}`);
  if (input.trendAlignment && input.trendAlignment !== "NEUTRAL") why.supportingEvidence.push(`trend_alignment=${input.trendAlignment}`);
  why.supportingEvidence.push(...(input.reversalEvidence ?? []).slice(0, 5));
  const opposite = input.directionalLean === "BUY" ? "SELL" : input.directionalLean === "SELL" ? "BUY" : null;
  if (opposite) why.rejectedAlternatives.push(`counter_side=${opposite}`, `bearScore=${(input.bearScore ?? 0).toFixed(3)}`);
  else why.rejectedAlternatives.push("no_dominant_direction");
  if (input.blockedBy?.length) why.uncertaintyFactors.push(...input.blockedBy.slice(0, 6));
  if (input.counterTrend) why.riskFactors.push("counter_trend", `reversal_evidence=${(input.reversalEvidence ?? []).length}`);
  if ((input.rawConfidence ?? 0) < .6) why.uncertaintyFactors.push(`low_raw_confidence=${(input.rawConfidence ?? 0).toFixed(2)}`);
  why.opposingEvidence.push(...(input.conflicts ?? []).slice(0, 5));
  why.riskFactors.push(...(input.warnings ?? []).slice(0, 5));
  return why;
}

export function buildDecisionProvenance(input: ProvenanceInput) {
  return {
    decisionId: input.decisionId,
    sessionId: input.sessionId ?? null,
    marketEventId: input.marketEventId ?? null,
    frameId: input.frameId ?? null,
    candleId: input.candleId ?? null,
    priceObservationIds: input.priceObservationIds ?? [],
    contextVersions: input.contextVersions ?? {},
    agentRunIds: input.agentRunIds ?? [],
    bullRunId: input.bullRunId ?? null,
    bearRunId: input.bearRunId ?? null,
    fusionRunId: input.fusionRunId ?? null,
    arbiterRunId: input.arbiterRunId ?? null,
    profile: input.profile,
    thresholdVersion: THRESHOLD_VERSION,
    configVersion: CONFIG_VERSION,
    promptVersion: PROMPT_VERSION,
    modelVersions: { vision: OPENCODE_GO_DEFAULT_MODEL, fable: OPENCODE_GO_DEFAULT_MODEL },
    rawScores: input.rawScores ?? {},
    calibratedScores: input.calibratedScores ?? {},
    decision: input.decision,
    directionalLean: input.directionalLean,
    why: buildWhy(input),
    conflicts: input.conflicts ?? [],
    warnings: input.warnings ?? [],
    traceId: input.traceId ?? null,
    createdAt: input.now ?? Date.now(),
  };
}
