import { describe, expect, it } from "vitest";
import { collapseVariants, deduplicatedPairs, effectivePolicyId, type PolicyEvaluation } from "../../src/research/effective-policy";

const e = (variantId: string, groundTruthId: string, decision: string, result: string | null): PolicyEvaluation => ({ variantId, groundTruthId, decision, rawConfidence: 0.7, counterfactualResult: result });
const profileOf = (id: string) => id.split("_")[1]!.toUpperCase();

describe("effective policy collapse", () => {
  it("collapses deadline-identical variants into one effective policy", () => {
    const evals = [
      ...["d800", "d1000", "d1200"].map((d) => e(`v_conservative_${d}`, "gt1", "BUY", "WIN")),
      ...["d800", "d1000", "d1200"].map((d) => e(`v_conservative_${d}`, "gt2", "WAIT", null)),
      e("v_balanced_d800", "gt1", "BUY", "WIN"),
      e("v_balanced_d800", "gt2", "BUY", "LOSS"),
    ];
    const c = collapseVariants(evals, profileOf);
    expect(c.rawVariants).toBe(4);
    expect(c.effectivePolicies).toBe(2);
    expect(c.policies.map((p) => p.effectivePolicyId).sort()).toEqual(["policy_balanced_v1", "policy_conservative_v1"]);
    expect(c.policies.find((p) => p.profile === "CONSERVATIVE")!.variantIds).toHaveLength(3);
  });

  it("deduplicates observations to one per (groundTruth, effectivePolicy)", () => {
    const obs = [
      { groundTruthId: "g1", effectivePolicyId: effectivePolicyId("CONSERVATIVE"), result: "WIN" },
      { groundTruthId: "g1", effectivePolicyId: effectivePolicyId("CONSERVATIVE"), result: "WIN" },
      { groundTruthId: "g1", effectivePolicyId: effectivePolicyId("AGGRESSIVE"), result: "LOSS" },
    ];
    const out = deduplicatedPairs(obs);
    expect(out).toHaveLength(2);
    expect(effectivePolicyId("AGGRESSIVE")).toBe("policy_aggressive_v1");
  });
});
