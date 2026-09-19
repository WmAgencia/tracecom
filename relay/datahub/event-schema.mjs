/**
 * DATAHUB EVENT SCHEMA — envelope canonico de eventos do TraceCom.
 *
 * Implementacao PROPRIA (clean-room, sem codigo AGPL). Todo evento de pesquisa carrega:
 * eventId, eventType, schemaVersion, marketKey, activeId, NORMAL/OTC, serverTime, localTime,
 * availableAt, receivedAt, producer, source, provenance, accountContext e sequence/version.
 *
 * availableAt e o instante a partir do qual a informacao PODE ser usada (point-in-time).
 * Nenhum evento pode declarar disponibilidade anterior ao seu recebimento.
 */
import crypto from "node:crypto";

export const DATAHUB_SCHEMA_VERSION = "datahub-event-v1";
export const DATAHUB_EVENT_SCHEMA = "tracecom-datahub-event";

export const MARKET_TYPES = Object.freeze(["NORMAL", "OTC"]);

export const EVENT_TYPES = Object.freeze([
  "MARKET_TICK",
  "CANDLE_5S",
  "CANDLE_1M",
  "CANDLE_CONTEXT",
  "FEATURE_SNAPSHOT",
  "STRUCTURE_UPDATE",
  "REGIME_UPDATE",
  "SCENARIO_UPDATE",
  "AGENT_ANALYSIS",
  "CANDIDATE",
  "JIT_REVALIDATION",
  "EXECUTION_STATE",
  "BROKER_ACK",
  "SETTLEMENT",
  "DATA_QUALITY_UPDATE",
  "AGENT_STARTED",
  "DATA_RECEIVED",
  "ANALYSIS_STARTED",
  "ANALYSIS_COMPLETED",
  "WAITING",
  "CONFLICT",
  "RED_TEAM_REVIEW",
  "FINAL_SYNTHESIS",
  "CANCELLED",
  "ERROR",
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const SECRET_KEY_PATTERN = /(ssid|password|senha|token|secret|api[_-]?key|authorization|credential)/i;

export function isEventType(value) { return EVENT_TYPE_SET.has(String(value ?? "")); }

export function marketTypeFromKey(marketKey) {
  const text = String(marketKey ?? "");
  const suffix = text.includes(":") ? text.slice(text.lastIndexOf(":") + 1).toUpperCase() : "";
  return MARKET_TYPES.includes(suffix) ? suffix : null;
}

export function makeEvent(input = {}) {
  const localTime = finite(input.localTime) ?? Date.now();
  const receivedAt = finite(input.receivedAt) ?? localTime;
  const serverTime = finite(input.serverTime) ?? null;
  const marketKey = input.marketKey === null || input.marketKey === undefined ? null : String(input.marketKey);
  const marketType = input.marketType ?? marketTypeFromKey(marketKey);
  const sequence = finite(input.sequence);
  const producer = String(input.producer ?? "unknown");
  const stream = String(input.stream ?? producer);
  const eventType = String(input.eventType ?? "");
  const eventId = input.eventId ?? [
    DATAHUB_SCHEMA_VERSION, stream, marketKey ?? "GLOBAL", eventType, sequence ?? "na",
    crypto.createHash("sha1").update(JSON.stringify(input.payload ?? {})).digest("hex").slice(0, 10),
  ].join("|");
  return {
    schema: DATAHUB_EVENT_SCHEMA,
    schemaVersion: DATAHUB_SCHEMA_VERSION,
    eventId,
    eventType,
    marketKey,
    activeId: finite(input.activeId),
    marketType,
    serverTime,
    localTime,
    availableAt: finite(input.availableAt) ?? receivedAt,
    receivedAt,
    producer,
    source: String(input.source ?? producer),
    provenance: input.provenance ?? null,
    accountContext: input.accountContext ?? null,
    sequence,
    version: finite(input.version) ?? 1,
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
  };
}

export function validateEvent(event = {}) {
  const errors = [];
  if (!event || typeof event !== "object") return { ok: false, errors: ["EVENT_INVALID"] };
  if (event.schema !== DATAHUB_EVENT_SCHEMA) errors.push("SCHEMA_MISMATCH");
  if (event.schemaVersion !== DATAHUB_SCHEMA_VERSION) errors.push("SCHEMA_VERSION_MISMATCH");
  if (!event.eventId) errors.push("EVENT_ID_MISSING");
  if (!isEventType(event.eventType)) errors.push(`EVENT_TYPE_INVALID:${String(event.eventType)}`);
  if (event.marketKey !== null && typeof event.marketKey !== "string") errors.push("MARKET_KEY_INVALID");
  if (event.marketKey && !event.marketType) errors.push("MARKET_TYPE_MISSING");
  if (event.marketType && !MARKET_TYPES.includes(event.marketType)) errors.push(`MARKET_TYPE_INVALID:${event.marketType}`);
  if (event.marketKey && event.marketType && marketTypeFromKey(event.marketKey) && marketTypeFromKey(event.marketKey) !== event.marketType) errors.push("MARKET_TYPE_KEY_MISMATCH");
  for (const key of ["localTime", "receivedAt", "availableAt"]) {
    if (!Number.isFinite(Number(event[key]))) errors.push(`TIME_INVALID:${key}`);
  }
  if (Number.isFinite(Number(event.serverTime)) && Number(event.serverTime) > Number(event.receivedAt) + 3_600_000) errors.push("SERVER_TIME_IMPLAUSIBLE");
  if (Number(event.availableAt) < Number(event.receivedAt)) errors.push("AVAILABLE_BEFORE_RECEIVED");
  if (!event.producer) errors.push("PRODUCER_MISSING");
  if (!event.source) errors.push("SOURCE_MISSING");
  if (event.sequence !== null && event.sequence !== undefined && Number.isFinite(Number(event.sequence)) && Number(event.sequence) <= 0) errors.push("SEQUENCE_INVALID");
  if (containsSecretKey(event.payload)) errors.push("SECRETS_FORBIDDEN");
  return { ok: errors.length === 0, errors };
}

function containsSecretKey(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => containsSecretKey(entry, depth + 1));
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) return true;
    if (containsSecretKey(entry, depth + 1)) return true;
  }
  return false;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
