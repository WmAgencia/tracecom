/**
 * EXECUTION_TIMING_AGENT — observa candidate age/cutoff/latency/displacement/candles/ticks/degradacao.
 *
 * NUNCA envia ordem e NAO modifica o LATE_WINDOW_V2: apenas le o contexto de timing do runtime
 * (que continua sendo o dono da janela de entrada). Estados: TOO_EARLY/OBSERVE/READY_WINDOW/TOO_LATE/UNSAFE.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const EXECUTION_TIMING_AGENT_VERSION = "execution-timing-agent-v1";
export const EXECUTION_TIMING_STATES = Object.freeze(["TOO_EARLY", "OBSERVE", "READY_WINDOW", "TOO_LATE", "UNSAFE"]);

export const TIMING_POLICY = Object.freeze({
  minLateMarginMs: 1_000,
  readyWindowMs: 1_500,
  tooEarlyMs: 5_000,
  latencyBudgetMs: 2_500,
  maxAdverseDisplacementATR: 1.0,
});

export function analyzeExecutionTiming({ features = {}, execution = null, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const risks = [];
  const used = [];

  if (!execution || !Number.isFinite(Number(execution.nowMs))) {
    return makeAgentOutput({
      agentId: "EXECUTION_TIMING_AGENT",
      marketKey: f.marketKey, snapshotId: f.snapshotId,
      state: "OBSERVE",
      assessment: "contexto_de_timing_ausente (analise sem candidato)",
      bullishEvidence: [], bearishEvidence: [],
      neutralEvidence: ["sem_candidato_para_janela"],
      riskFlags: ["EXECUTION_CONTEXT_MISSING"],
      featuresUsed: [], confidenceClass: "LOW", dataQuality,
      reasoningSummary: "Sem candidato/JIT ativo; timing nao avaliado. Late Window V2 permanece intocado.",
      availableAt: f.availableAt,
      detail: { source: "NO_CANDIDATE", lateWindowTouched: false },
    });
  }

  const nowMs = Number(execution.nowMs);
  const targetExpiryAt = Number(execution.targetExpiryAt);
  const submitAt = Number(execution.submitAt);
  const candidateAgeMs = Number.isFinite(Number(execution.candidateAgeMs)) ? Math.max(0, Number(execution.candidateAgeMs)) : null;
  const latencyMs = Number.isFinite(Number(execution.latencyMs)) ? Math.max(0, Number(execution.latencyMs)) : null;
  const cutoffMs = Number.isFinite(targetExpiryAt) ? targetExpiryAt - TIMING_POLICY.minLateMarginMs : null;
  const displacementATR = Number.isFinite(Number(execution.displacementATR)) ? Number(execution.displacementATR) : null;
  const newCandles = Number.isFinite(Number(execution.newCandlesSinceCandidate)) ? Number(execution.newCandlesSinceCandidate) : null;
  const newTicks = Number.isFinite(Number(execution.newTicksSinceCandidate)) ? Number(execution.newTicksSinceCandidate) : null;
  used.push("candidateAgeMs", "cutoffMs");

  let state;
  if (Number.isFinite(targetExpiryAt) && nowMs > targetExpiryAt) state = "UNSAFE";
  else if (cutoffMs !== null && nowMs >= cutoffMs) state = "TOO_LATE";
  else if (Number.isFinite(submitAt) && submitAt > 0 && nowMs >= submitAt - TIMING_POLICY.readyWindowMs) state = "READY_WINDOW";
  else if (candidateAgeMs !== null && candidateAgeMs < TIMING_POLICY.tooEarlyMs) state = "TOO_EARLY";
  else state = "OBSERVE";

  if (latencyMs !== null && latencyMs > TIMING_POLICY.latencyBudgetMs) risks.push("LATENCY_ABOVE_BUDGET");
  if (displacementATR !== null && Math.abs(displacementATR) > TIMING_POLICY.maxAdverseDisplacementATR) risks.push("ADVERSE_DISPLACEMENT");
  if (newCandles !== null && newCandles > 4) risks.push("MANY_NEW_CANDLES");
  if (newTicks === 0) risks.push("NO_NEW_TICKS");
  if (execution.degraded === true) risks.push("DEGRADATION_DETECTED");
  if (state === "UNSAFE") risks.push("EXPIRY_PASSED");

  return makeAgentOutput({
    agentId: "EXECUTION_TIMING_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `timing=${state} (idade=${candidateAgeMs}ms latencia=${latencyMs}ms)`,
    bullishEvidence: [], bearishEvidence: [],
    neutralEvidence: [`cutoff=${cutoffMs}`, `agora=${nowMs}`, `submitAt=${Number.isFinite(submitAt) ? submitAt : null}`],
    riskFlags: risks,
    featuresUsed: used,
    confidenceClass: state === "UNSAFE" || state === "TOO_LATE" ? "HIGH" : "MEDIUM",
    dataQuality,
    reasoningSummary: `estado=${state}; late_window_v2_untouched=true; observacao apenas, nenhuma ordem gerada.`,
    availableAt: f.availableAt,
    detail: {
      nowMs, candidateAgeMs, latencyMs, cutoffMs, submitAt: Number.isFinite(submitAt) ? submitAt : null, targetExpiryAt: Number.isFinite(targetExpiryAt) ? targetExpiryAt : null,
      displacementATR, newCandlesSinceCandidate: newCandles, newTicksSinceCandidate: newTicks,
      timingSafety: state === "READY_WINDOW" ? "SAFE" : state === "TOO_EARLY" || state === "OBSERVE" ? "OBSERVING" : "UNSAFE",
      lateWindowPolicy: "LATE_WINDOW_V2_UNTOUCHED", sendsOrders: false,
    },
  });
}
