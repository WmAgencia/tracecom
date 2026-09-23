/**
 * V3 — AGENT TEAM v2: arquitetura de DUAS ONDAS + Final Gate deterministico (default).
 *
 * WAVE A (paralelo): 5 specialists — fatos do dominio.
 * WAVE B (paralelo): Asset Agent + Consensus independente com red-team BILATERAL
 *                    (bestCaseForUp/AgainstUp/ForDown/AgainstDown), sem ver a tese do Asset.
 * FINAL GATE (deterministico): compara Asset x Consensus e usa o counter-case pre-computado
 *                    da direcao — SEM terceira chamada LLM (preserva o Final Challenge, sem anchoring).
 *
 * THREE_WAVE fica disponivel apenas para benchmark (A/B da missao 17).
 * Deadline: qualquer onda que passe do ORCAMENTO (budgetMs, duracao no mesmo dominio do relogio)
 * => AGENT_UNAVAILABLE/ANALYSIS_DEADLINE (fail-closed).
 */
import { specialistDelta, assetDelta, consensusDelta } from "./prompts.mjs";
import { collectInputNumbers } from "./schemas.mjs";
import { finalGate } from "../final-gate.mjs";

export const V3_AGENT_TEAM_VERSION = "v3-agent-team-v2";

export const SPECIALIST_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]);
const TIMEOUT = Symbol("deadline");

const summary = (call) => ({
  role: call.role, status: call.status, reason: call.reason ?? null, latencyMs: call.latencyMs ?? null, model: call.model ?? null,
  schemaValid: call.schemaValid === true, semanticValid: call.semanticValid === true,
  httpStatus: call.httpStatus ?? null, finishReason: call.finishReason ?? null,
  inputTokens: call.usage?.prompt_tokens ?? null, outputTokens: call.usage?.completion_tokens ?? null, cachedTokens: call.usage?.prompt_tokens_details?.cached_tokens ?? null,
  rawExcerpt: call.rawExcerpt ?? null,
});

async function withBudget(promise, { budgetMs = null } = {}) {
  if (budgetMs === null || budgetMs === undefined) return { timedOut: false, value: await promise };
  const remaining = Number(budgetMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return { timedOut: true, value: null };
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), Math.max(1, remaining)); timer?.unref?.(); });
  try {
    const value = await Promise.race([promise, timeout]);
    if (value === TIMEOUT) return { timedOut: true, value: null };
    return { timedOut: false, value };
  } finally { if (timer) clearTimeout(timer); }
}

export async function runAgentCycle({
  client, measurements, specialists = null, previousByRole = {}, previousAssessment = null,
  expiration = null, cycleNumber = null, opportunityId = null, budgetMs = null,
  architecture = "TWO_WAVE", now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const result = {
    version: V3_AGENT_TEAM_VERSION, architecture, cycleNumber, available: false, reason: null,
    specialists: null, asset: null, independent: null, consensus: null, finalGate: null, result: "CANCEL",
    agentCalls: [], latency: { waveA: null, waveB: null, total: null },
  };
  if (!client?.available) { result.reason = "AGENT_UNAVAILABLE"; return result; }

  const timing = expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs ?? null, phase: expiration.phase ?? null } : null;
  const inputNumbers = collectInputNumbers(measurements, timing);
  const waveBudget = () => (budgetMs === null || budgetMs === undefined ? null : Math.max(0, Number(budgetMs) - (now() - startedAt)));
  const requestId = (role) => `${opportunityId ?? "v3"}:${cycleNumber ?? "?"}:${role}`;
  const callCommon = () => ({ opportunityId, budgetMs: waveBudget(), inputNumbers });

  // WAVE A — 5 specialists em paralelo
  const waveAStart = now();
  const waveA = await withBudget(Promise.all(SPECIALIST_ROLES.map((role) => client.call({
    role, requestId: requestId(role), ...callCommon(),
    prompt: specialistDelta({ role, measurements, previous: previousByRole?.[role] ?? null, cycleNumber, timing }),
  }))), { budgetMs: waveBudget() });
  result.latency.waveA = Math.max(0, now() - waveAStart);
  if (waveA.timedOut) { result.reason = "ANALYSIS_DEADLINE"; return result; }
  const specialistCalls = waveA.value ?? [];
  result.agentCalls.push(...specialistCalls.map(summary));
  if (specialistCalls.some((call) => call.status !== "OK")) { result.reason = specialistCalls.some((call) => call.reason === "ANALYSIS_DEADLINE") ? "ANALYSIS_DEADLINE" : "AGENT_UNAVAILABLE"; return result; }
  const agentSpecialists = Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, specialistCalls.find((call) => call.role === role)?.output]));

  // WAVE B — Asset + Consensus independente (bilateral) em paralelo
  const waveBStart = now();
  const waveB = await withBudget(Promise.all([
    client.call({ role: "ASSET", requestId: requestId("ASSET"), ...callCommon(), prompt: assetDelta({ measurements, specialists: agentSpecialists, previousAssessment, cycleNumber, timing }) }),
    client.call({ role: "CONSENSUS_BILATERAL", requestId: requestId("CONSENSUS_BILATERAL"), ...callCommon(), prompt: consensusDelta({ measurements, specialists: agentSpecialists, cycleNumber, timing }) }),
  ]), { budgetMs: waveBudget() });
  result.latency.waveB = Math.max(0, now() - waveBStart);
  if (waveB.timedOut) { result.reason = "ANALYSIS_DEADLINE"; return result; }
  const [assetCall, consensusCall] = waveB.value ?? [];
  result.agentCalls.push(summary(assetCall), summary(consensusCall));
  if (assetCall?.status !== "OK" || consensusCall?.status !== "OK") { result.reason = [assetCall, consensusCall].some((call) => call?.reason === "ANALYSIS_DEADLINE") ? "ANALYSIS_DEADLINE" : "AGENT_UNAVAILABLE"; return result; }

  if (architecture === "THREE_WAVE") {
    const finalPrompt = JSON.stringify({ assetThesis: { scenario: assetCall.output.scenario, direction: assetCall.output.direction, state: assetCall.output.state }, independent: consensusCall.output }).slice(0, 4_000);
    const finalCall = await withBudget(client.call({ role: "CONSENSUS_FINAL", requestId: requestId("CONSENSUS_FINAL"), ...callCommon(), prompt: finalPrompt }), { budgetMs: waveBudget() });
    if (finalCall.timedOut || finalCall.value?.status !== "OK") { result.reason = finalCall.timedOut ? "ANALYSIS_DEADLINE" : "AGENT_UNAVAILABLE"; return result; }
    result.agentCalls.push(summary(finalCall.value));
    result.available = true;
    result.specialists = agentSpecialists;
    result.asset = assetCall.output;
    result.independent = consensusCall.output;
    result.consensus = { agreement: finalCall.value.output.agreement, result: finalCall.value.output.result, reasons: finalCall.value.output.reasons ?? [], bestCounterCase: finalCall.value.output.bestCounterCase ?? null, bilateral: consensusCall.output };
    result.result = finalCall.value.output.result;
    result.latency.total = Math.max(0, now() - startedAt);
    return result;
  }

  // FINAL GATE deterministico (sem terceira chamada): usa o red-team bilateral do Consensus
  const gate = finalGate({ asset: assetCall.output, consensus: consensusCall.output, timing: timing ? { tteMs: timing.tteMs } : null, now: now() });
  result.available = true;
  result.specialists = agentSpecialists;
  result.asset = assetCall.output;
  result.independent = consensusCall.output;
  result.consensus = { agreement: gate.agreement, result: gate.result, reasons: gate.reasons, challengeSteps: gate.steps, bestCounterCase: gate.counterCase, bilateral: consensusCall.output };
  result.finalGate = gate;
  result.result = gate.result;
  result.latency.total = Math.max(0, now() - startedAt);
  return result;
}

export function agentLatencyStats(agentCalls = []) {
  const byRole = {};
  for (const call of agentCalls) {
    const bucket = byRole[call.role] ?? (byRole[call.role] = { count: 0, samples: [], errors: 0, schemaValid: 0 });
    bucket.count += 1;
    if (call.status !== "OK") bucket.errors += 1;
    if (call.schemaValid === true) bucket.schemaValid += 1;
    if (Number.isFinite(Number(call.latencyMs))) bucket.samples.push(Number(call.latencyMs));
  }
  const percentiles = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (fraction) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] : null);
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.length ? sorted[sorted.length - 1] : null };
  };
  return Object.fromEntries(Object.entries(byRole).map(([role, bucket]) => [role, { count: bucket.count, errors: bucket.errors, schemaValidRate: bucket.count ? Math.round((bucket.schemaValid / bucket.count) * 1000) / 1000 : null, ...percentiles(bucket.samples) }]));
}
