/**
 * V3 — PROVIDER CAPABILITIES (matriz MEDIDA contra o OpenCode Go real; nao documentacao de terceiros).
 *
 * Evidencia (probe read-only 2026-09-23, modelo deepseek-v4.1-flash):
 *  - x-opencode-session OBRIGATORIO (sem header => HTTP 400 MissingSessionID).
 *  - response_format {"type":"json_object"} => HTTP 200 JSON valido.
 *  - response_format {"type":"json_schema",...} => HTTP 400 (NAO suportado).
 *  - temperature: 0 aceito.
 *  - reasoning_effort "none" aceito: reasoning_tokens=0 e resposta de 9 tokens (latencia ~1.7s).
 *  - usage.prompt_tokens_details.cached_tokens exposto (sem cache real no deepseek-v4.1-flash:
 *    mesma sessao/prefixo repetido => cached_tokens=0; glm-5.x mostrou 10).
 *  - max_tokens pequeno com reasoning ligado => finish_reason=length e content=null (truncamento).
 *  - Modelos disponiveis no catalogo: deepseek-v4-flash, deepseek-v4.1-flash, deepseek-v4-pro,
 *    glm-5.1, glm-5.2, deepseek-v4-flash-vision-exp (benchmark-only; operacional segue o .1-flash).
 */
export const V3_CAPABILITIES_VERSION = "v3-provider-capabilities-v1";

export const CAPABILITIES = Object.freeze({
  jsonObject: true,
  jsonSchema: false,
  temperature: true,
  reasoningEffortNone: true,
  usageMetadata: true,
  cachedTokens: true,
  sessionHeader: true,
  finishReason: true,
  truncationIsFailure: true,
  evidence: {
    jsonObject: "probe: HTTP 200 + JSON parseavel",
    jsonSchema: "probe: HTTP 400 invalid_request_error",
    reasoningNone: "probe: reasoning_tokens=0, completion_tokens=9, latencyMs~1736",
    cachedTokens: "probe: cached_tokens=0 no deepseek-v4.1-flash (sem reaproveitamento por sessao)",
  },
});

/** Opcoes de request dos agentes V3: JSON estruturado + sem reasoning + temperatura 0. */
export function agentRequestOptions({ maxTokens = 512 } = {}) {
  return {
    temperature: 0,
    responseFormat: CAPABILITIES.jsonObject ? { type: "json_object" } : null,
    reasoningEffort: CAPABILITIES.reasoningEffortNone ? "none" : null,
    maxTokens: Math.max(128, Math.min(4096, Number(maxTokens) || 512)),
  };
}

export const ALTERNATIVE_MODELS_BENCHMARK_ONLY = Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.1", "glm-5.2"]);
