/**
 * V3 — AGENT TEAM: 5 specialists em paralelo -> Asset -> Consensus independente -> Final Challenge.
 * Fail-closed: qualquer timeout/erro/schema invalido => AGENT_UNAVAILABLE (nunca approval).
 */
import { specialistPayload, assetPayload, consensusBasePayload } from "./prompts.mjs";

export const V3_AGENT_TEAM_VERSION = "v3-agent-team-v1";

export const SPECIALIST_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]);

const summary = (call) => ({ role: call.role, status: call.status, reason: call.reason ?? null, latencyMs: call.latencyMs ?? null, model: call.model ?? null, schemaValid: call.schemaValid === true });

export async function runAgentCycle({ client, measurements, specialists = null, previousByRole = {}, previousAssessment = null, expiration = null, cycleNumber = null, requestIdPrefix = "v3" } = {}) {
  const result = { version: V3_AGENT_TEAM_VERSION, cycleNumber, available: false, reason: null, specialists: null, asset: null, independent: null, consensus: null, agentCalls: [], result: "CANCEL" };
  if (!client?.available) { result.reason = "AGENT_UNAVAILABLE"; return result; }
  const requestId = (role) => `${requestIdPrefix}:${cycleNumber ?? "?"}:${role}`;

  const specialistCalls = await Promise.all(SPECIALIST_ROLES.map((role) => client.call({
    role, requestId: requestId(role),
    prompt: specialistPayload({ role, measurements, previousCycle: previousByRole?.[role] ?? null, cycleNumber, expiration }),
  })));
  result.agentCalls.push(...specialistCalls.map(summary));
  if (specialistCalls.some((call) => call.status !== "OK")) { result.reason = "AGENT_UNAVAILABLE"; return result; }
  const agentSpecialists = Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, specialistCalls.find((call) => call.role === role)?.output]));

  const assetCall = await client.call({ role: "ASSET", requestId: requestId("ASSET"), prompt: assetPayload({ measurements, specialists: agentSpecialists, previousAssessment, expiration, cycleNumber }) });
  result.agentCalls.push(summary(assetCall));
  if (assetCall.status !== "OK") { result.reason = "AGENT_UNAVAILABLE"; return result; }

  const independentCall = await client.call({ role: "CONSENSUS_INDEPENDENT", requestId: requestId("CONSENSUS_INDEPENDENT"), prompt: consensusBasePayload({ measurements, specialists: agentSpecialists, expiration, cycleNumber }) });
  result.agentCalls.push(summary(independentCall));
  if (independentCall.status !== "OK") { result.reason = "AGENT_UNAVAILABLE"; return result; }

  const finalPrompt = JSON.stringify({
    cycleNumber,
    assetThesis: { scenario: assetCall.output.scenario, direction: assetCall.output.direction, state: assetCall.output.state, bestCounterCase: assetCall.output.bestCounterCase },
    independentClassification: independentCall.output,
    specialists: Object.values(agentSpecialists).map((agent) => ({ role: agent?.domainAssessment ?? null })),
  }).slice(0, 16_000);
  const finalCall = await client.call({ role: "CONSENSUS_FINAL", requestId: requestId("CONSENSUS_FINAL"), prompt: finalPrompt });
  result.agentCalls.push(summary(finalCall));
  if (finalCall.status !== "OK") { result.reason = "AGENT_UNAVAILABLE"; return result; }

  result.available = true;
  result.specialists = agentSpecialists;
  result.asset = assetCall.output;
  result.independent = independentCall.output;
  result.consensus = finalCall.output;
  result.result = finalCall.output.result;
  return result;
}

export function agentLatencyStats(agentCalls = []) {
  const byRole = {};
  for (const call of agentCalls) {
    const bucket = byRole[call.role] ?? (byRole[call.role] = { count: 0, samples: [] });
    bucket.count += 1;
    if (Number.isFinite(Number(call.latencyMs))) bucket.samples.push(Number(call.latencyMs));
  }
  const percentiles = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (fraction) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] : null);
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.length ? sorted[sorted.length - 1] : null };
  };
  return Object.fromEntries(Object.entries(byRole).map(([role, bucket]) => [role, { count: bucket.count, ...percentiles(bucket.samples) }]));
}
