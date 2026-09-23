/**
 * V3 — EXPIRATION GRID AUTHORITY (evidência real do protocolo, nao suposicao).
 *
 * Evidencia de producao (2026-09-23):
 *  - `initialization-data` turbo actives: `option.expiration_times` = [60000] (cadencia curta),
 *    `deadtime` = 30s; binary actives: [900000] (15min), deadtime 300s.
 *  - Historico da propria conta: 526 ordens turbo ACEITAS com expiration em multiplos de 60s
 *    (fora de 5min); durations observadas 31-89s. ACKs reais + brokerOrderId + settlement.
 *  - UI real: 11:24:54 -> expirations 11:26..11:30 (11:30 com TTE 5:06); 11:25:30 -> aparece 11:31 (TTE 5:30).
 *
 * Portanto a grade curta e MINUTO A MINUTO (60s) e o HOLD desejado e ~300s — coisas diferentes.
 * O candidato da V3 e a fronteira de minuto que da hold ~5min:
 *   expirationAt = ceilToMinute(brokerNow + TARGET_HOLD_MS)
 * Reproduz exatamente os dois exemplos da UI (306s e 330s de TTE).
 */
export const V3_GRID_VERSION = "v3-expiration-grid-v1";

export const EXPIRY_GRID_MS = 60_000;
export const TARGET_HOLD_MS = 300_000;
export const ENTRY_LEAD_MS = 2_000;
export const targetSendTteMs = () => TARGET_HOLD_MS + ENTRY_LEAD_MS;
export const DISCOVERY_MAX_TTE_MS = 330_000;
export const HARD_CUTOFF_TTE_MS = TARGET_HOLD_MS;

export const GRID_FAMILIES = Object.freeze({
  TURBO_MINUTE: Object.freeze({
    id: "TURBO_MINUTE",
    section: "turbo",
    instrumentType: "turbo",
    optionTypeId: 3,
    gridMs: EXPIRY_GRID_MS,
    holdMs: TARGET_HOLD_MS,
    deadtimeMs: 30_000,
    maxHoldMs: 5 * 60_000,
    evidence: "expiration_times=[60000] + 526 ACKs turbo em minutos nao-5min + UI 1-5min",
  }),
  BINARY_15M: Object.freeze({
    id: "BINARY_15M",
    section: "binary",
    instrumentType: "binary",
    optionTypeId: 1,
    gridMs: 900_000,
    holdMs: 900_000,
    deadtimeMs: 300_000,
    maxHoldMs: 900_000,
    evidence: "expiration_times=[900000] + deadtime 300s",
  }),
});

export class V3GridError extends Error {
  constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

export const ceilToGrid = (ms, gridMs = EXPIRY_GRID_MS) => {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) throw new V3GridError("INVALID_TIME", String(ms));
  return Math.ceil(value / gridMs) * gridMs;
};

export const isGridAligned = (ms, gridMs = EXPIRY_GRID_MS) => {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 && value % gridMs === 0;
};

/** Candidato V3: fronteira de minuto que entrega hold ~300s no send (~TTE 302). */
export function derivedExpirationAt(brokerNowMs, { holdMs = TARGET_HOLD_MS, gridMs = EXPIRY_GRID_MS } = {}) {
  return ceilToGrid(Number(brokerNowMs) + holdMs, gridMs);
}

/**
 * Lista de expirations curtas visiveis (contexto de UI): fronteiras de minuto em
 * (brokerNow + deadtime, brokerNow + horizonMs]. Reproduz a lista observada na IQ.
 */
export function availableShortExpirations(brokerNowMs, { deadtimeMs = 30_000, horizonMs = DISCOVERY_MAX_TTE_MS, gridMs = EXPIRY_GRID_MS } = {}) {
  const now = Number(brokerNowMs);
  if (!Number.isFinite(now) || now <= 0) return [];
  const first = ceilToGrid(now + Number(deadtimeMs) + 1, gridMs);
  const last = Math.floor((now + Number(horizonMs)) / gridMs) * gridMs;
  const out = [];
  for (let expirationAt = first; expirationAt <= last; expirationAt += gridMs) out.push(expirationAt);
  return out;
}

export function gridSnapshot(brokerNowMs, options = {}) {
  const now = Number(brokerNowMs);
  const candidate = derivedExpirationAt(now, options);
  return {
    version: V3_GRID_VERSION,
    brokerNow: now,
    gridMs: options.gridMs ?? EXPIRY_GRID_MS,
    candidateExpirationAt: candidate,
    candidateTteMs: candidate - now,
    available: availableShortExpirations(now, options).map((expirationAt) => ({ expirationAt, tteMs: expirationAt - now })),
    targetSendAt: candidate - targetSendTteMs(),
    hardCutoffAt: candidate - HARD_CUTOFF_TTE_MS,
  };
}
