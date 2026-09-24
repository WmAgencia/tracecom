/**
 * V3 — HEALTH do runtime LLM (estado visual do painel). Puro e testavel.
 *
 * Estados:
 * - READY: ativo e saudavel.
 * - STANDBY: saudavel, porem sistema desarmado (SYSTEM_INACTIVE e comportamento correto, NAO erro).
 * - DEGRADED: problema real (429 persistente, provider indisponivel, feed stale, schema/deadline excessivos, DB).
 * - OFFLINE: runtime/provider realmente indisponivel.
 * Nao e permitido trocar a string sem dados reais.
 */
export const V3_HEALTH_VERSION = "v3-health-v1";

export const V3_HEALTH_STATES = Object.freeze(["READY", "STANDBY", "DEGRADED", "OFFLINE"]);

export function computeV3Health({
  v3Enabled = true,
  agentsAvailable = false,
  systemActive = false,
  providerUnavailable = false,
  recent429 = 0,
  lastProviderError = null,
  feedReady = true,
  feedAgeMs = null,
  feedMaxAgeMs = 15_000,
  configuredMarkets = 0,
  recentSchemaErrors = 0,
  recentDeadlineAborts = 0,
  recentConsensusErrors = 0,
  recentCandleFeedBlocked = 0,
  persistCriticalError = false,
} = {}) {
  if (!v3Enabled) return { state: "OFFLINE", reason: "V3_DISABLED" };
  if (providerUnavailable) return { state: "OFFLINE", reason: "PROVIDER_UNAVAILABLE" };
  if (!agentsAvailable) return { state: "DEGRADED", reason: "PROVIDER_UNAVAILABLE" };
  if (recent429 > 0) return { state: "DEGRADED", reason: "PROVIDER_RATE_LIMIT" };
  if (lastProviderError) return { state: "DEGRADED", reason: "PROVIDER_ERROR" };
  if (recentConsensusErrors > 0) return { state: "DEGRADED", reason: "CONSENSUS_FAILING" };
  if (feedReady !== true || (Number.isFinite(Number(feedAgeMs)) && Number(feedAgeMs) > Number(feedMaxAgeMs))) return { state: "DEGRADED", reason: "FEED_STALE" };
  if (configuredMarkets > 0 && configuredMarkets === 0) return { state: "DEGRADED", reason: "NO_MARKETS" };
  if (recentSchemaErrors > 0) return { state: "DEGRADED", reason: "SCHEMA_FAILURES" };
  if (recentDeadlineAborts > 0) return { state: "DEGRADED", reason: "DEADLINE_FAILURES" };
  if (recentCandleFeedBlocked > 0) return { state: "DEGRADED", reason: "FEED_BLOCKED" };
  if (persistCriticalError) return { state: "DEGRADED", reason: "DB_CRITICAL" };
  return systemActive ? { state: "READY", reason: null } : { state: "STANDBY", reason: "SYSTEM_INACTIVE" };
}