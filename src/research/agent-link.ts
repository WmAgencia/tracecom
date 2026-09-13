/** Deterministic Decision -> AgentRuns -> Signal -> GroundTruth -> Settlement links.
 * No timestamp joins, no invented runs; missing/failed runs stay explicit. */
export const LEGACY_INCOMPLETE_AGENT_LINK = "LEGACY_INCOMPLETE_AGENT_LINK";

export type LinkRun = { agentRunId: string; agentId?: string | null; agentRole?: string | null; status: string; error?: string | null };

const SLOTS: Array<{ key: string; match: RegExp }> = [
  { key: "priceAction", match: /price.?action/i },
  { key: "momentum", match: /momentum|candle/i },
  { key: "quant", match: /quant|geometry/i },
  { key: "risk", match: /risk|contrarian/i },
  { key: "bull", match: /bull/i },
  { key: "bear", match: /bear/i },
  { key: "fusion", match: /fusion/i },
  { key: "arbiter", match: /arbiter/i },
];

export function agentRunIdsByRole(runs: LinkRun[]): Record<string, { runId: string | null; status: string; failureReason: string | null }> {
  const out: Record<string, { runId: string | null; status: string; failureReason: string | null }> = {};
  for (const slot of SLOTS) {
    const run = runs.find((r) => slot.match.test(`${r.agentId ?? ""} ${r.agentRole ?? ""}`));
    out[slot.key] = run
      ? { runId: run.agentRunId, status: run.status, failureReason: run.status === "FAILED" ? (run.error ?? "unknown") : null }
      : { runId: null, status: "MISSING", failureReason: "run_not_persisted" };
  }
  return out;
}

export function decisionLinkStatus(decisionId: unknown, runs: LinkRun[]): string {
  const canonical = typeof decisionId === "string" && decisionId.startsWith("decision_");
  return canonical && runs.length > 0 ? "COMPLETE" : LEGACY_INCOMPLETE_AGENT_LINK;
}
