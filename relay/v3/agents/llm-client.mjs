/**
 * V3 — LLM AGENT CLIENT v2: structured output (json_object), reasoning off, session estavel, deadline.
 * Fail-closed: JSON estrito invalido/truncado/schema/semantica => AGENT_UNAVAILABLE.
 * O resgate de JSON (fences/balanced) fica apenas como DIAGNOSTICO (rawExcerpt), nunca como sucesso no modo structured.
 */
import crypto from "node:crypto";
import { runTextProvider } from "../../opencode-go.mjs";
import { validateAgentOutput, normalizeAgentOutput } from "./schemas.mjs";
import { systemPromptFor } from "./prompts.mjs";
import { agentRequestOptions, CAPABILITIES } from "./capabilities.mjs";

export const V3_AGENT_CLIENT_VERSION = "v3-agent-client-v3";
export const V3_AGENT_PROVIDER = "openCodeGo";

const sessionHashOf = (sessionKey) => crypto.createHash("sha256").update(String(sessionKey ?? "")).digest("hex").slice(0, 12);

/** Resgate apenas diagnostico (nao promove a sucesso). */
export function rescueJsonExcerpt(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  if (start === -1) return raw.slice(0, 160);
  let depth = 0;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (char === "{") depth += 1;
    else if (char === "}") { depth -= 1; if (depth === 0) return candidate.slice(start, Math.min(index + 1, start + 200)); }
  }
  return candidate.slice(start, start + 200);
}

const DEFAULT_MAX_TOKENS_BY_ROLE = Object.freeze({ PRICE_ACTION: 768, ASSET: 768, CONSENSUS_FINAL: 1600 });

export function createLlmAgentClient({ pool = null, runner = null, now = () => Date.now(), maxTokens = 512, maxTokensByRole = null, activityCheck = null } = {}) {
  const run = typeof runner === "function" ? runner : pool ? (options) => runTextProvider(pool, options) : null;
  const gate = typeof activityCheck === "function" ? activityCheck : null;
  const gateActive = () => gate === null || gate() === true;
  const baseOptions = agentRequestOptions({ maxTokens });
  const tokensFor = (role) => {
    const configured = maxTokensByRole?.[role] ?? DEFAULT_MAX_TOKENS_BY_ROLE[role];
    return Number.isFinite(Number(configured)) ? Number(configured) : baseOptions.maxTokens;
  };
  return {
    version: V3_AGENT_CLIENT_VERSION,
    available: typeof run === "function",
    capabilities: CAPABILITIES,
    async call({ role, prompt, requestId, opportunityId = null, budgetMs = null, timeoutMs = null, inputNumbers = null, sessionContext = {} }) {
      const startedAtMs = now();
      const base = {
        role, requestId, opportunityId, provider: V3_AGENT_PROVIDER, model: null, output: null, schemaValid: false, semanticValid: false,
        usage: null, finishReason: null, httpStatus: null,
        startedAt: new Date(startedAtMs).toISOString(), finishedAt: null, startedAtMs, finishedAtMs: null,
        payloadChars: typeof prompt === "string" ? prompt.length : null, payloadBytes: typeof prompt === "string" ? Buffer.byteLength(prompt, "utf8") : null,
        sessionHash: null,
      };
      const finish = (call) => { const finishedAtMs = now(); return { ...call, finishedAt: new Date(finishedAtMs).toISOString(), finishedAtMs }; };
      if (typeof run !== "function") return finish({ ...base, status: "ERROR", reason: "PROVIDER_NOT_CONFIGURED", latencyMs: null });
      const hasBudget = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0;
      if (hasBudget && Number(budgetMs) <= 500) return finish({ ...base, status: "ERROR", reason: "ANALYSIS_DEADLINE", latencyMs: Math.max(0, now() - startedAtMs) });
      const effectiveTimeout = hasBudget ? Math.min(Number(timeoutMs) > 0 ? Number(timeoutMs) : Number(budgetMs), Number(budgetMs)) : (Number(timeoutMs) > 0 ? Number(timeoutMs) : null);
      const sessionKey = opportunityId ? `v3:${opportunityId}:${role}` : (sessionContext.sessionKey ?? requestId);
      const withSession = { ...base, sessionHash: sessionHashOf(sessionKey) };
      // ECONOMIA: gate imediatamente antes de cada request ao provider. Sistema inativo => ZERO chamadas.
      if (gateActive() !== true) return finish({ ...withSession, status: "ERROR", reason: "SYSTEM_INACTIVE", latencyMs: Math.max(0, now() - startedAtMs) });
      try {
        const result = await run({
          system: systemPromptFor(role), prompt, maxTokens: tokensFor(role), requestId,
          sessionContext: { ...sessionContext, sessionKey },
          temperature: baseOptions.temperature, responseFormat: baseOptions.responseFormat, reasoningEffort: baseOptions.reasoningEffort,
          timeoutMs: effectiveTimeout,
        });
        const latencyMs = Number.isFinite(Number(result?.latencyMs)) ? Number(result.latencyMs) : Math.max(0, now() - startedAtMs);
        const usage = result?.usage ?? null;
        // ECONOMIA: resposta in-flight apos sistema ficar inativo => DESCARTADA (nunca alimenta consenso/aprovacao).
        if (gateActive() !== true) return finish({ ...withSession, status: "ERROR", reason: "INACTIVE_INVALIDATED", latencyMs: Math.max(0, now() - startedAtMs) });
        const common = {
          ...withSession, latencyMs, queueWaitMs: Number.isFinite(Number(result?.queueWaitMs)) ? Number(result.queueWaitMs) : null, model: result?.model ?? null, provider: result?.provider ?? V3_AGENT_PROVIDER, usage, finishReason: result?.finishReason ?? null, httpStatus: result?.httpStatus ?? null,
          promptTokens: Number.isFinite(Number(usage?.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
          cachedTokens: Number.isFinite(Number(usage?.prompt_tokens_details?.cached_tokens)) ? Number(usage.prompt_tokens_details.cached_tokens) : null,
          completionTokens: Number.isFinite(Number(usage?.completion_tokens)) ? Number(usage.completion_tokens) : null,
          reasoningTokens: Number.isFinite(Number(usage?.completion_tokens_details?.reasoning_tokens)) ? Number(usage.completion_tokens_details.reasoning_tokens) : null,
          totalTokens: Number.isFinite(Number(usage?.total_tokens)) ? Number(usage.total_tokens) : null,
        };
        if (result?.reason === "TIMEOUT" && hasBudget) return finish({ ...common, status: "ERROR", reason: "ANALYSIS_DEADLINE" });
        if (result?.status !== "OK") return finish({ ...common, status: "ERROR", reason: result?.reason ?? "PROVIDER_ERROR", rawExcerpt: rescueJsonExcerpt(result?.text) });
        if (result?.finishReason === "length" && CAPABILITIES.truncationIsFailure) return finish({ ...common, status: "ERROR", reason: "TRUNCATED", rawExcerpt: rescueJsonExcerpt(result?.text) });
        // Structured mode: EXIGE JSON estrito (parse do provider ou do proprio texto).
        let parsed = result?.parsed ?? null;
        if (!parsed && typeof result?.text === "string") { try { parsed = JSON.parse(result.text); } catch { parsed = null; } }
        if (!parsed) return finish({ ...common, status: "ERROR", reason: "INVALID_JSON", rawExcerpt: rescueJsonExcerpt(result?.text) });
        parsed = normalizeAgentOutput(role, parsed);
        const validation = validateAgentOutput(role, parsed, { inputNumbers });
        if (validation.ok !== true) return finish({ ...common, status: "ERROR", reason: `SCHEMA_${validation.error}${validation.token ? `(${validation.token})` : ""}`, output: null, rawExcerpt: JSON.stringify(parsed).slice(0, 400) });
        return finish({ ...common, status: "OK", reason: null, output: parsed, schemaValid: true, semanticValid: true, groundingWarnings: validation.groundingWarnings ?? [] });
      } catch (error) {
        return finish({ ...withSession, status: "ERROR", reason: error?.name === "AbortError" ? "TIMEOUT" : "AGENT_ERROR", latencyMs: Math.max(0, now() - startedAtMs) });
      }
    },
  };
}

/** Stub deterministico para testes (mesma interface; nunca chama rede). `now` deve ser o mesmo
 *  relogio do runtime sob teste (broker time), senao deadlines divergem. */
export function createScriptedAgentClient(script = {}, { now = () => Date.now() } = {}) {
  const calls = [];
  return {
    version: "v3-agent-client-scripted",
    available: true,
    calls,
    async call({ role, requestId, opportunityId = null, budgetMs = null, inputNumbers = null }) {
      calls.push({ role, requestId, opportunityId });
      if (Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0 && Number(budgetMs) <= 500) return { status: "ERROR", reason: "ANALYSIS_DEADLINE", role, latencyMs: 0, model: "stub", output: null, schemaValid: false, semanticValid: false, usage: null, finishReason: null, httpStatus: null };
      const entry = typeof script === "function" ? script({ role, requestId, opportunityId }) : script[role];
      const value = typeof entry === "function" ? entry({ role, requestId, opportunityId }) : entry;
      if (!value) return { status: "ERROR", reason: "SCRIPT_MISSING", role, latencyMs: 1, model: "stub", output: null, schemaValid: false, semanticValid: false, usage: null, finishReason: null, httpStatus: null };
      const latencyMs = Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 1;
      if (value.sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(Number(value.sleepMs), 50)));
      if (value.status === "ERROR") return { status: "ERROR", reason: value.reason ?? "SCRIPTED_ERROR", role, latencyMs, model: "stub", output: null, schemaValid: false, semanticValid: false, usage: value.usage ?? null, finishReason: value.finishReason ?? null, httpStatus: value.httpStatus ?? null };
      const output = normalizeAgentOutput(role, value.output ?? value);
      const validation = validateAgentOutput(role, output, { inputNumbers });
      if (validation.ok !== true) return { status: "ERROR", reason: `SCHEMA_${validation.error}`, role, latencyMs, model: "stub", output: null, schemaValid: false, semanticValid: false, usage: null, finishReason: null, httpStatus: null };
      return { status: "OK", reason: null, role, latencyMs, model: "stub", output, schemaValid: true, semanticValid: true, groundingWarnings: validation.groundingWarnings ?? [], usage: value.usage ?? { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, finishReason: value.finishReason ?? "stop", httpStatus: 200 };
    },
  };
}
