/**
 * V3 — LLM AGENT CLIENT (usa a abstração existente: opencode-go/DeepSeek V4.1 Flash).
 * Fail-closed: timeout/erro/JSON invalido/schema invalido => status ERROR (nunca approval).
 */
import { runTextProvider } from "../../opencode-go.mjs";
import { validateAgentOutput } from "./schemas.mjs";
import { systemPromptFor } from "./prompts.mjs";

export const V3_AGENT_CLIENT_VERSION = "v3-agent-client-v1";

/** Resgate de JSON robusto: fences, multiplos objetos balanceados e prosa ao redor.
 *  Prefere o ULTIMO objeto parseavel (o output do agente tende a vir por ultimo). */
export function extractJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const candidates = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(raw);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* continua */ }
    const starts = [];
    for (let index = 0; index < candidate.length; index += 1) if (candidate[index] === "{") starts.push(index);
    for (const start of starts.reverse()) {
      let depth = 0;
      for (let index = start; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) { try { return JSON.parse(candidate.slice(start, index + 1)); } catch { break; } }
        }
      }
    }
  }
  return null;
}

export function createLlmAgentClient({ pool = null, runner = null, now = () => Date.now(), maxTokens = 2600 } = {}) {
  const run = typeof runner === "function" ? runner : pool ? (options) => runTextProvider(pool, options) : null;
  return {
    version: V3_AGENT_CLIENT_VERSION,
    available: typeof run === "function",
    async call({ role, prompt, requestId, sessionContext = {} }) {
      const startedAt = now();
      if (typeof run !== "function") return { status: "ERROR", reason: "PROVIDER_NOT_CONFIGURED", role, latencyMs: null, model: null, output: null, schemaValid: false };
      try {
        const result = await run({ system: systemPromptFor(role), prompt, maxTokens, requestId, sessionContext });
        const latencyMs = Number.isFinite(Number(result?.latencyMs)) ? Number(result.latencyMs) : Math.max(0, now() - startedAt);
        const parsed = extractJson(result?.text) ?? result?.parsed;
        if (result?.status !== "OK" && !parsed) return { status: "ERROR", reason: result?.reason ?? "INVALID_JSON", role, latencyMs, model: result?.model ?? null, output: null, schemaValid: false, rawExcerpt: String(result?.text ?? "").slice(0, 280) };
        if (!parsed) return { status: "ERROR", reason: "INVALID_JSON", role, latencyMs, model: result?.model ?? null, output: null, schemaValid: false, rawExcerpt: String(result?.text ?? "").slice(0, 280) };
        const validation = validateAgentOutput(role, parsed);
        if (validation.ok !== true) return { status: "ERROR", reason: `SCHEMA_${validation.error}`, role, latencyMs, model: result?.model ?? null, output: null, schemaValid: false, rawExcerpt: JSON.stringify(parsed).slice(0, 280) };
        return { status: "OK", reason: null, role, latencyMs, model: result?.model ?? null, output: parsed, schemaValid: true };
      } catch (error) {
        return { status: "ERROR", reason: error?.name === "AbortError" ? "TIMEOUT" : "AGENT_ERROR", role, latencyMs: Math.max(0, now() - startedAt), model: null, output: null, schemaValid: false };
      }
    },
  };
}

/** Stub deterministico para testes (mesma interface; nunca chama rede). */
export function createScriptedAgentClient(script = {}) {
  const calls = [];
  return {
    version: "v3-agent-client-scripted",
    available: true,
    calls,
    async call({ role, requestId }) {
      calls.push({ role, requestId });
      const entry = typeof script === "function" ? script({ role, requestId }) : script[role];
      const value = typeof entry === "function" ? entry({ role, requestId }) : entry;
      if (!value) return { status: "ERROR", reason: "SCRIPT_MISSING", role, latencyMs: 1, model: "stub", output: null, schemaValid: false };
      const latencyMs = Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 1;
      if (value.sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(Number(value.sleepMs), 25)));
      if (value.status === "ERROR") return { status: "ERROR", reason: value.reason ?? "SCRIPTED_ERROR", role, latencyMs, model: "stub", output: null, schemaValid: false };
      const output = value.output ?? value;
      const validation = validateAgentOutput(role, output);
      if (validation.ok !== true) return { status: "ERROR", reason: `SCHEMA_${validation.error}`, role, latencyMs, model: "stub", output: null, schemaValid: false };
      return { status: "OK", reason: null, role, latencyMs, model: "stub", output, schemaValid: true };
    },
  };
}
