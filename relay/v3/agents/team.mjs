/**
 * V3 — AGENT TEAM v3 (DETERMINISTIC_CONSENSUS_ONLY): arquitetura final (1 chamada LLM).
 *
 * WAVE 1 (codigo, 6): RSI, DMI/ADX, Bollinger, ATR, Price Action/Estrutura e Scenario/Asset —
 *   assessments deterministicos (zero LLM) no formato exato dos schemas.
 * PREFILTER (deterministico): so candidatos fortes seguem para o LLM.
 * WAVE 2 (1 LLM): CONSENSUS FINAL (Groq) — decisor de mercado; recebe deterministic facts + 5
 *   specialists e, por ULTIMO, o bloco ASSET_THESIS_TO_CHALLENGE (anti-anchoring).
 * GATE (deterministico): APENAS contratos operacionais/seguranca; a direcao vem do Consensus LLM.
 *
 * Total: 1 chamada LLM por ciclo (vs 7 antes). Fail-closed em qualquer falha.
 */
import { consensusFinalPrompt } from "./prompts.mjs";
import { collectInputNumbers } from "./schemas.mjs";
import { buildPacketEnvelope } from "./fact-packets.mjs";
import { executionGate } from "../final-gate.mjs";
import { deterministicWave1Calls } from "../deterministic-wave1.mjs";
import { prefilterWave1 } from "../prefilter.mjs";

export const V3_AGENT_TEAM_VERSION = "v3-agent-team-v4";
export const V3_AGENT_ARCHITECTURE = "DETERMINISTIC_CONSENSUS_ONLY";

export const SPECIALIST_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]);
export const WAVE1_ROLES = Object.freeze([...SPECIALIST_ROLES, "ASSET"]);
export const CONSENSUS_ROLE = "CONSENSUS_FINAL";
export const EXPECTED_CALLS = WAVE1_ROLES.length + 1;

const TIMEOUT = Symbol("deadline");

const tokenField = (usage, key) => Number.isFinite(Number(usage?.[key])) ? Number(usage[key]) : null;

const summary = (call) => ({
  role: call.role, status: call.status, reason: call.reason ?? null,
  latencyMs: call.latencyMs ?? null, model: call.model ?? null, provider: call.provider ?? null,
  requestId: call.requestId ?? null, opportunityId: call.opportunityId ?? null,
  sessionHash: call.sessionHash ?? null,
  startedAt: call.startedAt ?? null, finishedAt: call.finishedAt ?? null,
  httpStatus: call.httpStatus ?? null, finishReason: call.finishReason ?? null,
  schemaValid: call.schemaValid === true, semanticValid: call.semanticValid === true,
  promptTokens: call.promptTokens ?? tokenField(call.usage, "prompt_tokens"),
  cachedTokens: call.cachedTokens ?? tokenField(call.usage?.prompt_tokens_details, "cached_tokens"),
  completionTokens: call.completionTokens ?? tokenField(call.usage, "completion_tokens"),
  reasoningTokens: call.reasoningTokens ?? tokenField(call.usage?.completion_tokens_details, "reasoning_tokens"),
  totalTokens: call.totalTokens ?? tokenField(call.usage, "total_tokens"),
  payloadChars: call.payloadChars ?? null, payloadBytes: call.payloadBytes ?? null,
  groundingWarnings: Array.isArray(call.groundingWarnings) ? call.groundingWarnings.length : 0,
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
  client, measurements, specialists = null, previousPackets = {}, previousOutputs = {},
  expiration = null, cycleNumber = null, opportunityId = null, budgetMs = null,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const result = {
    version: V3_AGENT_TEAM_VERSION, architecture: V3_AGENT_ARCHITECTURE, cycleNumber, available: false, reason: null,
    specialists: null, asset: null, independent: null, consensus: null, finalGate: null, result: "CANCEL",
    agentCalls: [], factPackets: {}, nextState: null, latency: { wave1: null, wave2: null, total: null }, prefilter: null,
  };

  const timing = expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs ?? null, phase: expiration.phase ?? null, brokerNow: expiration.brokerNow ?? null } : null;
  const inputNumbers = collectInputNumbers(measurements, timing);
  const waveBudget = () => (budgetMs === null || budgetMs === undefined ? null : Math.max(0, Number(budgetMs) - (now() - startedAt)));
  const requestId = (role) => `${opportunityId ?? "v3"}:${cycleNumber ?? "?"}:${role}`;
  const callCommon = () => ({ opportunityId, budgetMs: waveBudget(), inputNumbers });

  // FACT COMPILER: 6 envelopes (FULL no 1o ciclo; DELTA nos seguintes) com fingerprint deterministico.
  const envelopes = Object.fromEntries(WAVE1_ROLES.map((role) => [role, buildPacketEnvelope({
    role, measurements, timing, cycleNumber,
    previousPacket: previousPackets?.[role] ?? null,
    previousAssessment: previousOutputs?.[role] ?? null,
  })]));
  result.factPackets = Object.fromEntries(Object.entries(envelopes).map(([role, envelope]) => [role, {
    mode: envelope.mode, fingerprint: envelope.fingerprint, previousFingerprint: envelope.previousFingerprint, chars: envelope.chars, bytes: envelope.bytes,
  }]));

  // WAVE 1 — DETERMINISTICA (codigo): 6 assessments, zero LLM.
  const wave1Start = now();
  const wave1Calls = deterministicWave1Calls(measurements);
  result.latency.wave1 = Math.max(0, now() - wave1Start);
  result.agentCalls.push(...wave1Calls);
  const outputs = Object.fromEntries(wave1Calls.map((call) => [call.role, call.output]));
  const specialistOutputs = Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, outputs[role]]));
  const asset = outputs.ASSET;

  // PREFILTER — somente candidatos fortes seguem para o CONSENSUS (LLM). Reprovar nao chama provider.
  const prefilter = prefilterWave1({ calls: wave1Calls, asset: wave1Calls.find((call) => call.role === "ASSET") ?? null });
  result.prefilter = prefilter;
  if (prefilter.pass !== true) {
    result.available = true;
    result.specialists = specialistOutputs;
    result.asset = asset;
    result.consensus = { result: "CANCEL", agreement: "INSUFFICIENT_EVIDENCE", direction: "NONE", reasons: [prefilter.reason], independentAssessment: null, assetComparison: null, blockers: [], invalidations: [], marketAmbiguities: [], supportingEvidence: [], counterEvidence: [], bestCaseForUp: [], bestCaseAgainstUp: [], bestCaseForDown: [], bestCaseAgainstDown: [] };
    result.result = "CANCEL";
    result.reason = prefilter.reason;
    result.nextState = { packets: Object.fromEntries(Object.entries(envelopes).map(([role, envelope]) => [role, envelope.packet])), outputs: { ...outputs } };
    result.latency.total = Math.max(0, now() - startedAt);
    return result;
  }
  if (!client?.available) { result.reason = "AGENT_UNAVAILABLE"; return result; }

  // WAVE 2 — UNICA chamada LLM: CONSENSUS FINAL (Groq, decisor de mercado/red-team).
  const wave2Start = now();
  const consensusCall = await withBudget(client.call({
    role: CONSENSUS_ROLE, requestId: requestId(CONSENSUS_ROLE), ...callCommon(),
    prompt: consensusFinalPrompt({ measurements, timing, cycleNumber, envelopes, specialistOutputs, asset, specialistRoles: SPECIALIST_ROLES }),
  }), { budgetMs: waveBudget() });
  result.latency.wave2 = Math.max(0, now() - wave2Start);
  if (consensusCall.timedOut || consensusCall.value?.status !== "OK") {
    if (consensusCall.value) result.agentCalls.push(summary(consensusCall.value));
    result.available = true;
    result.specialists = specialistOutputs;
    result.asset = asset;
    result.consensus = { result: "CANCEL", agreement: "INSUFFICIENT_EVIDENCE", direction: "NONE", reasons: [consensusCall.timedOut || consensusCall.value?.reason === "ANALYSIS_DEADLINE" ? "ANALYSIS_DEADLINE" : "CONSENSUS_UNAVAILABLE"], independentAssessment: null, assetComparison: null, blockers: [], invalidations: [], marketAmbiguities: [], supportingEvidence: [], counterEvidence: [], bestCaseForUp: [], bestCaseAgainstUp: [], bestCaseForDown: [], bestCaseAgainstDown: [] };
    result.result = "CANCEL";
    result.reason = consensusCall.timedOut || consensusCall.value?.reason === "ANALYSIS_DEADLINE" ? "ANALYSIS_DEADLINE" : "CONSENSUS_UNAVAILABLE";
    result.nextState = { packets: Object.fromEntries(Object.entries(envelopes).map(([role, envelope]) => [role, envelope.packet])), outputs: { ...outputs } };
    result.latency.total = Math.max(0, now() - startedAt);
    return result;
  }
  const consensusOutput = consensusCall.value.output;
  result.agentCalls.push(summary(consensusCall.value));

  // GATE deterministico: valida contratos operacionais e SEGURANCA. Nao decide mercado.
  const gate = executionGate({
    consensus: consensusOutput,
    calls: result.agentCalls,
    timing: timing ? { expirationAt: timing.expirationAt, tteMs: timing.tteMs } : null,
    opportunityId,
    latencyTotalMs: Math.max(0, now() - startedAt),
    deadlineMs: budgetMs,
    now: now(),
  });

  result.available = true;
  result.specialists = specialistOutputs;
  result.asset = asset;
  result.consensus = consensusOutput;
  result.finalGate = gate;
  result.result = gate.result;
  result.nextState = {
    packets: Object.fromEntries(Object.entries(envelopes).map(([role, envelope]) => [role, envelope.packet])),
    outputs: { ...outputs, [CONSENSUS_ROLE]: consensusOutput },
  };
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
