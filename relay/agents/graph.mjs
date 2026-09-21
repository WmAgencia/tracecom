/**
 * AGENTIC GRAPH — 1 snapshot imutavel/causal -> 5 agentes especialistas (camada 1) -> consenso (camada 2).
 * Todos recebem EXATAMENTE o mesmo snapshotId. O consenso enxerga as opinioes estruturadas de todos.
 * Sem LLM no hot path: deterministico, testavel, rapido.
 */
import { analyzeRsiAgent } from "./rsi.agent.mjs";
import { analyzeBollingerAgent } from "./bollinger.agent.mjs";
import { analyzeAdxAgent } from "./adx.agent.mjs";
import { analyzeAtrAgent } from "./atr.agent.mjs";
import { analyzeFibAgent } from "./fib.agent.mjs";
import { runConsensusAgent } from "./consensus.agent.mjs";

export const AGENTIC_GRAPH_VERSION = "agentic-graph-v1";
export const AGENTIC_STRATEGY_ID = "AGENTIC_RSI_FIB_V1";
export const AGENTIC_STRATEGY_VERSION = "agentic-rsi-fib-v1";

export function runAgentGraph(snapshot) {
  const startedAt = Date.now();
  if (!snapshot) return null;
  const opinions = {
    rsi: analyzeRsiAgent(snapshot),
    bollinger: analyzeBollingerAgent(snapshot),
    adx: analyzeAdxAgent(snapshot),
    atr: analyzeAtrAgent(snapshot),
    fib: analyzeFibAgent(snapshot),
  };
  const consensus = runConsensusAgent({ snapshot, opinions });
  return { version: AGENTIC_GRAPH_VERSION, snapshotId: snapshot.snapshotId, at: snapshot.at, opinions, consensus, conversation: consensus.conversation, latencyMs: Date.now() - startedAt };
}

export function agentGraphToStrategyResult(graph) {
  if (!graph) return null;
  const { opinions, consensus } = graph;
  return {
    strategyId: AGENTIC_STRATEGY_ID, strategyVersion: AGENTIC_STRATEGY_VERSION, snapshotId: graph.snapshotId,
    opportunity: opinions.rsi.trigger === true, decision: consensus.decision, side: consensus.side,
    reason: consensus.reason, evidenceStrength: consensus.evidenceStrength,
    supportingEvidence: consensus.supportingEvidence, counterEvidence: consensus.counterEvidence,
    specialistOutputs: { graph: graph.version, opinions, consensus, conversation: graph.conversation, latencyMs: graph.latencyMs },
  };
}
