/**
 * AGENT EVENT BUS — publica estados REAIS do sistema V4 no DataHub.
 *
 * Nada de atividade fake para UI: cada evento corresponde a um passo executado de verdade.
 * A publicacao e fail-safe: erro de bus nunca derruba a analise (nunca lanca).
 */
export const AGENT_EVENT_TYPES = Object.freeze([
  "AGENT_STARTED",
  "DATA_RECEIVED",
  "ANALYSIS_STARTED",
  "ANALYSIS_COMPLETED",
  "WAITING",
  "CONFLICT",
  "RED_TEAM_REVIEW",
  "FINAL_SYNTHESIS",
  "CANDIDATE",
  "CANCELLED",
  "ERROR",
]);

export const AGENT_EVENT_VERSION = "agent-event-bus-v1";

export function publishAgentEvent(dataHub, eventType, payload = {}, { marketKey = null, marketType = null, producer = "agents-v4", source = "agents-v4", receivedAt = null } = {}) {
  if (!dataHub || typeof dataHub.publish !== "function") return null;
  if (!AGENT_EVENT_TYPES.includes(eventType)) return null;
  try {
    return dataHub.publish({
      eventType,
      marketKey,
      marketType,
      producer,
      source,
      payload,
      receivedAt: receivedAt ?? Date.now(),
      localTime: Date.now(),
    });
  } catch {
    return null;
  }
}
