/** Sensitivity profiles. Thresholds are EXPERIMENTAL.
 *
 * A profile only changes policy/thresholds — never the underlying evidence or
 * the confidence estimate. Aggressive can still return WAIT.
 */
import type { MarketRegime } from "./regime.js";

export type Profile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export const PROFILE_IDS: readonly Profile[] = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const;
export const DEFAULT_PROFILE: Profile = "BALANCED";

export type ProfilePolicy = {
  readonly label: string;
  readonly status: "EXPERIMENTAL";
  readonly minSeparation: number;
  readonly minConfidence: number;
  readonly allowUncertainRegime: boolean;
  readonly conflictPenalty: number;
};

export const PROFILE_POLICIES: Readonly<Record<Profile, ProfilePolicy>> = Object.freeze({
  CONSERVATIVE: { label: "CONSERVATIVE", status: "EXPERIMENTAL", minSeparation: .35, minConfidence: .64, allowUncertainRegime: false, conflictPenalty: .25 },
  BALANCED: { label: "BALANCED", status: "EXPERIMENTAL", minSeparation: .22, minConfidence: .56, allowUncertainRegime: false, conflictPenalty: .15 },
  AGGRESSIVE: { label: "AGGRESSIVE", status: "EXPERIMENTAL", minSeparation: .10, minConfidence: .51, allowUncertainRegime: true, conflictPenalty: .05 },
});

export type DirectionalEvidence = {
  bullScore: number; bearScore: number; directionalLean: "BUY" | "SELL" | "NONE"; rawConfidence: number;
  regime: MarketRegime; regimeConfidence: number; conflictScore: number;
};

export type ProfileDecision = { profile: Profile; decision: "BUY" | "SELL" | "WAIT"; confidence: number; blockedBy: string[] };

export function evaluateProfile(profile: Profile, evidence: DirectionalEvidence): ProfileDecision {
  const policy = PROFILE_POLICIES[profile];
  const blockedBy: string[] = [];
  const separation = Math.abs(evidence.bullScore - evidence.bearScore);
  const noisyRegime = evidence.regime === "RANGE" || evidence.regime === "HIGH_VOLATILITY" || evidence.regime === "UNCERTAIN";
  const requiredSeparation = policy.minSeparation + (noisyRegime ? policy.conflictPenalty : 0);
  if (evidence.directionalLean === "NONE") blockedBy.push("NO_DIRECTION");
  if (separation < requiredSeparation) blockedBy.push("INSUFFICIENT_SEPARATION");
  if (evidence.rawConfidence < policy.minConfidence) blockedBy.push("INSUFFICIENT_CONFIDENCE");
  if (evidence.regime === "UNCERTAIN" && !policy.allowUncertainRegime) blockedBy.push("REGIME_UNCERTAIN");
  const decision = blockedBy.length === 0 && evidence.directionalLean !== "NONE" ? evidence.directionalLean : "WAIT";
  // Confidence never changes with the profile; it is the same underlying estimate.
  return { profile, decision, confidence: evidence.rawConfidence, blockedBy };
}

export function evaluateAllProfiles(evidence: DirectionalEvidence): Record<Profile, ProfileDecision> {
  const result = {} as Record<Profile, ProfileDecision>;
  for (const profile of PROFILE_IDS) result[profile] = evaluateProfile(profile, evidence);
  return result;
}
