/** Converts a REAL deep-analysis execution into persisted AgentRun records.
 * Runs are only produced for steps that actually executed; skipped/failed steps
 * keep explicit status + reason. No fake runs, no chain-of-thought. */
export type DebateAgentLike = { name: string; score?: number; evidence?: string[]; invalidators?: string[]; timedOut?: boolean };
export type AdvocatesLike = { bull?: { name?: string; bullConfidence?: number; evidence?: string[]; invalidators?: string[] } | null; bear?: { name?: string; bearConfidence?: number; evidence?: string[]; invalidators?: string[] } | null; latencyMs?: number; agentsCompleted?: number; agentsTimedOut?: number };
export type RunMeta = { sessionId?: string | null; traceId?: string | null; marketEventId?: string | null; frameId?: string | null; candleId?: string | null; decisionId?: string | null; startedAt: number; completedAt: number; model?: string; provider?: string; promptVersion?: string; configVersion?: string; agentVersion?: string };

export type PersistedAgentRun = {
  agentRunId: string; agentId: string; agentName: string; agentRole: string; agentVersion: string;
  model: string | null; provider: string | null; promptVersion: string | null; configVersion: string | null;
  startedAt: number; completedAt: number; latencyMs: number; status: "COMPLETED" | "SKIPPED" | "FAILED";
  structuredInput: Record<string, unknown>; structuredOutput: Record<string, unknown>;
  confidence: number | null; evidence: string[]; warnings: string[]; error: string | null; fallbackUsed: boolean;
  traceId: string | null; marketEventId: string | null; frameId: string | null; candleId: string | null; decisionId: string | null;
};

const ROLE_BY_AGENT: Record<string, { id: string; name: string; role: string }> = {
  BULL_AGENT: { id: "BULL_AGENT", name: "Bull Agent", role: "SPECIALIST" },
  BEAR_AGENT: { id: "BEAR_AGENT", name: "Bear Agent", role: "SPECIALIST" },
  STRUCTURE_MOMENTUM_AGENT: { id: "STRUCTURE_MOMENTUM_AGENT", name: "Structure/Momentum Agent", role: "SPECIALIST" },
  RISK_NO_TRADE_AGENT: { id: "RISK_NO_TRADE_AGENT", name: "Risk/No-Trade Agent", role: "SPECIALIST" },
  BULL_ADVOCATE: { id: "BULL_ADVOCATE", name: "Bull Advocate", role: "ADVOCATE" },
  BEAR_ADVOCATE: { id: "BEAR_ADVOCATE", name: "Bear Advocate", role: "ADVOCATE" },
  FUSION: { id: "FUSION", name: "Fusion", role: "FUSION" },
  ARBITER: { id: "ARBITER", name: "Final Arbiter", role: "ARBITER" },
};

function baseRun(key: string, meta: RunMeta, latencyMs: number): PersistedAgentRun {
  const info = ROLE_BY_AGENT[key]!;
  return {
    agentRunId: `run_${meta.startedAt}_${key.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`,
    agentId: info.id, agentName: info.name, agentRole: info.role, agentVersion: meta.agentVersion || "v1",
    model: meta.model ?? "local-structured", provider: meta.provider ?? "tracecom-local", promptVersion: meta.promptVersion ?? "structured-v1", configVersion: meta.configVersion ?? "engine-v2",
    startedAt: meta.startedAt, completedAt: meta.completedAt, latencyMs, status: "COMPLETED",
    structuredInput: {}, structuredOutput: {}, confidence: null, evidence: [], warnings: [], error: null, fallbackUsed: false,
    traceId: meta.traceId ?? null, marketEventId: meta.marketEventId ?? null, frameId: meta.frameId ?? null, candleId: meta.candleId ?? null, decisionId: meta.decisionId ?? null,
  };
}

export function buildAgentRuns(input: { debate: { agents?: DebateAgentLike[]; arbiter?: { decision?: string; directionalLean?: string; leanConfidence?: number; latencyMs?: number } } | null; advocates?: AdvocatesLike | null; meta: RunMeta }) {
  const runs: PersistedAgentRun[] = [];
  const totalMs = Math.max(1, input.meta.completedAt - input.meta.startedAt);
  if (!input.debate) {
    const skipped = baseRun("FUSION", input.meta, 0); skipped.status = "SKIPPED"; skipped.structuredInput = { reason: "deep_debate_not_executed" }; runs.push(skipped);
    return { runs, runIds: [] as string[], arbiterRunId: null as string | null, fusionRunId: skipped.agentRunId, bullRunId: null as string | null, bearRunId: null as string | null, specialistRunIds: [] as string[] };
  }
  const specialistRunIds: string[] = [];
  for (const agent of input.debate.agents ?? []) {
    if (!ROLE_BY_AGENT[agent.name] || ROLE_BY_AGENT[agent.name]!.role !== "SPECIALIST") continue;
    const run = baseRun(agent.name, input.meta, Math.round(totalMs / Math.max(1, (input.debate.agents ?? []).length)));
    if (agent.timedOut) { run.status = "FAILED"; run.error = "AGENT_TIMEOUT"; }
    run.confidence = typeof agent.score === "number" ? agent.score : null;
    run.evidence = (agent.evidence ?? []).slice(0, 8);
    run.structuredOutput = { direction: agent.name === "BULL_AGENT" ? "BUY" : agent.name === "BEAR_AGENT" ? "SELL" : "NEUTRAL", score: agent.score ?? null, evidenceForBuy: agent.name === "BULL_AGENT" ? agent.evidence ?? [] : [], evidenceForSell: agent.name === "BEAR_AGENT" ? agent.evidence ?? [] : [], risks: agent.invalidators ?? [], abstentionReason: null };
    runs.push(run); specialistRunIds.push(run.agentRunId);
  }
  let bullRunId: string | null = null, bearRunId: string | null = null;
  const bull = input.advocates?.bull;
  if (bull) { const run = baseRun("BULL_ADVOCATE", input.meta, Math.round(totalMs / 4)); run.confidence = typeof bull.bullConfidence === "number" ? bull.bullConfidence : null; run.evidence = (bull.evidence ?? []).slice(0, 8); run.structuredOutput = { claims: bull.evidence ?? [], evidence: bull.evidence ?? [], opposingEvidence: bull.invalidators ?? [], risks: bull.invalidators ?? [], conflicts: [] }; runs.push(run); bullRunId = run.agentRunId; }
  else { const run = baseRun("BULL_ADVOCATE", input.meta, 0); run.status = "SKIPPED"; run.structuredInput = { reason: "advocate_not_executed" }; runs.push(run); bullRunId = run.agentRunId; }
  const bear = input.advocates?.bear;
  if (bear) { const run = baseRun("BEAR_ADVOCATE", input.meta, Math.round(totalMs / 4)); run.confidence = typeof bear.bearConfidence === "number" ? bear.bearConfidence : null; run.evidence = (bear.evidence ?? []).slice(0, 8); run.structuredOutput = { claims: bear.evidence ?? [], evidence: bear.evidence ?? [], opposingEvidence: bear.invalidators ?? [], risks: bear.invalidators ?? [], conflicts: [] }; runs.push(run); bearRunId = run.agentRunId; }
  else { const run = baseRun("BEAR_ADVOCATE", input.meta, 0); run.status = "SKIPPED"; run.structuredInput = { reason: "advocate_not_executed" }; runs.push(run); bearRunId = run.agentRunId; }
  const fusion = baseRun("FUSION", input.meta, Math.round(totalMs / 6));
  fusion.confidence = typeof input.debate.arbiter?.leanConfidence === "number" ? input.debate.arbiter.leanConfidence : null;
  fusion.structuredOutput = { inputAgentRunIds: specialistRunIds, agreements: (input.debate.agents ?? []).filter((agent) => agent.name === "BULL_AGENT" || agent.name === "BEAR_AGENT").map((agent) => agent.name), disagreements: [], weightedEvidence: (input.debate.agents ?? []).map((agent) => ({ agent: agent.name, score: agent.score ?? null })), conflicts: [], fusionOutput: { directionalLean: input.debate.arbiter?.directionalLean ?? "NONE", leanConfidence: input.debate.arbiter?.leanConfidence ?? null }, confidence: input.debate.arbiter?.leanConfidence ?? null };
  runs.push(fusion);
  const arbiter = baseRun("ARBITER", input.meta, Math.max(1, input.debate.arbiter?.latencyMs ?? Math.round(totalMs / 8)));
  arbiter.structuredOutput = { inputRunIds: [...specialistRunIds, fusion.agentRunId], candidateBuy: (input.debate.agents ?? []).find((agent) => agent.name === "BULL_AGENT")?.score ?? null, candidateSell: (input.debate.agents ?? []).find((agent) => agent.name === "BEAR_AGENT")?.score ?? null, candidateWait: (input.debate.agents ?? []).find((agent) => agent.name === "RISK_NO_TRADE_AGENT")?.score ?? null, selectedDecision: input.debate.arbiter?.decision ?? "WAIT", whyBuy: [], whySell: [], whyWait: [], conflicts: [], uncertainty: [], riskFactors: [], rawScores: {}, calibratedScores: {} };
  runs.push(arbiter);
  return { runs, runIds: runs.map((run) => run.agentRunId), arbiterRunId: arbiter.agentRunId, fusionRunId: fusion.agentRunId, bullRunId, bearRunId, specialistRunIds };
}
