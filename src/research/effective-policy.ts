/** Statistical deduplication of functionally equivalent shadow variants.
 * Deadline variants that produce identical decision/result sequences collapse
 * into a single effective policy: analyses must count at most 1 observation
 * per (groundTruthId, effectivePolicyId). */
export type PolicyEvaluation = { variantId: string; groundTruthId: string; decision: string; rawConfidence: number; counterfactualResult: string | null };

export function effectivePolicyId(profile: string): string {
  return `policy_${profile.toLowerCase()}_v1`;
}

export function collapseVariants(evaluations: PolicyEvaluation[], variantProfile: (variantId: string) => string) {
  const byVariant = new Map<string, PolicyEvaluation[]>();
  for (const e of evaluations) byVariant.set(e.variantId, [...(byVariant.get(e.variantId) ?? []), e]);
  const signature = (rows: PolicyEvaluation[]) =>
    rows.slice().sort((a, b) => a.groundTruthId.localeCompare(b.groundTruthId)).map((e) => `${e.decision}:${e.rawConfidence.toFixed(6)}:${e.counterfactualResult ?? "-"}`).join("|");
  const groups = new Map<string, { signature: string; variantIds: string[]; profile: string }>();
  for (const [variantId, rows] of byVariant) {
    const sig = signature(rows);
    const existing = [...groups.values()].find((g) => g.signature === sig);
    if (existing) existing.variantIds.push(variantId);
    else groups.set(variantId, { signature: sig, variantIds: [variantId], profile: variantProfile(variantId) });
  }
  const policies = [...groups.values()].map((g) => ({ effectivePolicyId: effectivePolicyId(g.profile), profile: g.profile, variantIds: g.variantIds }));
  return { policies, rawVariants: byVariant.size, effectivePolicies: policies.length, deduplicated: policies.every((p) => p.variantIds.length === 1 || p.variantIds.length >= 1) };
}

export function deduplicatedPairs<T extends { groundTruthId: string; effectivePolicyId: string }>(observations: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const o of observations) {
    const key = `${o.groundTruthId}|${o.effectivePolicyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
