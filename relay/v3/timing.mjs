/**
 * V3 — EXPIRATION TARGET TIMING (autoridade de timing da V3).
 *
 * Diferenca conceitual central vs V2: a V2 usava "proximo bucket de 5 min a partir do
 * momento do sinal". A V3 preserva a EXPIRATION REAL oferecida pela IQ que originou a
 * oportunidade (~TTE 330s) e envia para ELA MESMA (~TTE 302s).
 *
 * Tres relogios distintos (nunca confundir):
 *  A) TTE do contrato (expirationAt - brokerNow)
 *  B) alvo estrategico de envio (expirationAt - TARGET_HOLD - ENTRY_LEAD)
 *  C) purchase deadline do broker (deadtime) — NAO e o nosso momento de entrada.
 *
 * Regras:
 *  - targetSendAt   = expirationAt - 302_000 ms
 *  - hardCutoffAt   = expirationAt - 300_000 ms  (TTE <= 300 => MISSED_5M_ENTRY_WINDOW)
 *  - descoberta     = expirationAt com TTE <= DISCOVERY_MAX_TTE_MS (330_000) e > hardCutoff
 *  - autoridade de tempo = broker server time (nunca Date.now local quando disponivel)
 */
export const V3_TIMING_VERSION = "v3-expiration-target-timing-v1";
export const TARGET_HOLD_SECONDS = 300;
export const TARGET_HOLD_MS = TARGET_HOLD_SECONDS * 1000;
export const ENTRY_LEAD_MS = 2_000;
export const DISCOVERY_MAX_TTE_MS = 330_000;
export const EXPIRY_ALIGNMENT_MS = 300_000;

export class V3TimingError extends Error {
  constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

export function isAlignedExpiration(expirationAtMs) {
  const value = Number(expirationAtMs);
  return Number.isFinite(value) && value > 0 && value % EXPIRY_ALIGNMENT_MS === 0;
}

const toMs = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
};

/**
 * Intencao de ordem V3: SEMPRE a expiration exata que originou a opportunity.
 * Nunca recalcula bucket, nunca arredonda, nunca troca a expiration.
 */
export function buildV3OrderIntent({ opportunity = null, brokerNow, stake = null, direction = null, balanceId = null } = {}) {
  if (!opportunity) return { ok: false, code: "OPPORTUNITY_REQUIRED" };
  const check = ExpirationTargetTiming.canSubmit({ expirationAt: opportunity.expirationAt, brokerNow, purchaseDeadlineAt: opportunity.purchaseDeadlineAt });
  if (check.ok !== true) return { ok: false, code: check.code, derived: check.derived };
  if (direction !== "BUY" && direction !== "SELL") return { ok: false, code: "DIRECTION_REQUIRED" };
  if (!isAlignedExpiration(opportunity.expirationAt)) return { ok: false, code: "EXPIRATION_NOT_ALIGNED" };
  return {
    ok: true, code: "EXACT_TARGET_READY",
    intent: {
      opportunityId: opportunity.opportunityId, marketKey: opportunity.marketKey, activeId: opportunity.activeId ?? null,
      direction, stake, exactExpirationAt: Math.round(Number(opportunity.expirationAt) / 1000),
      targetSendAt: opportunity.targetSendAt, hardStrategicCutoffAt: opportunity.hardStrategicCutoffAt,
      tteMs: check.derived?.tteMs ?? null, balanceId,
    },
  };
}

/** Guard pre-submit: qualquer expiration diferente da opportunity e DENY (G/I/J). */
export function assertExactExpirationTarget({ opportunity = null, requestedExpirationAt = null } = {}) {
  if (!opportunity) return { ok: false, code: "OPPORTUNITY_REQUIRED" };
  const requestedMs = toMs(requestedExpirationAt);
  if (requestedMs === null) return { ok: false, code: "EXPIRATION_REQUIRED" };
  if (requestedMs % EXPIRY_ALIGNMENT_MS !== 0) return { ok: false, code: "ENTRY_EXPIRATION_ALIGNMENT", requestedMs };
  if (requestedMs !== Number(opportunity.expirationAt)) return { ok: false, code: "ENTRY_EXPIRATION_MISMATCH", expected: Number(opportunity.expirationAt), requested: requestedMs };
  return { ok: true, code: "EXACT_TARGET" };
}

export class ExpirationTargetTiming {
  constructor({ now = () => Date.now(), targetHoldMs = TARGET_HOLD_MS, entryLeadMs = ENTRY_LEAD_MS, discoveryMaxTteMs = DISCOVERY_MAX_TTE_MS } = {}) {
    this.now = now;
    this.targetHoldMs = targetHoldMs;
    this.entryLeadMs = entryLeadMs;
    this.discoveryMaxTteMs = discoveryMaxTteMs;
    this.offsetMs = null;
    this.lastSyncAt = null;
  }

  syncServerTime(serverTimeMs, atMs = this.now()) {
    const value = Number(serverTimeMs);
    if (!Number.isFinite(value) || value <= 0) throw new V3TimingError("INVALID_SERVER_TIME");
    this.offsetMs = value - atMs;
    this.lastSyncAt = atMs;
    return this.offsetMs;
  }

  hasServerTime() { return this.offsetMs !== null; }

  serverNow(atMs = this.now()) {
    if (this.offsetMs === null) throw new V3TimingError("NO_SERVER_TIME");
    return atMs + this.offsetMs;
  }

  static derive({ expirationAt, brokerNow, targetHoldMs = TARGET_HOLD_MS, entryLeadMs = ENTRY_LEAD_MS, purchaseDeadlineAt = null } = {}) {
    const expirationAtMs = Number(expirationAt);
    const nowMs = Number(brokerNow);
    if (!isAlignedExpiration(expirationAtMs)) throw new V3TimingError("EXPIRATION_NOT_ALIGNED", String(expirationAt));
    if (!Number.isFinite(nowMs) || nowMs <= 0) throw new V3TimingError("INVALID_BROKER_NOW", String(brokerNow));
    const tteMs = expirationAtMs - nowMs;
    return {
      expirationAt: expirationAtMs,
      brokerNow: nowMs,
      tteMs,
      tteSeconds: Math.round(tteMs / 1000),
      targetSendAt: expirationAtMs - targetHoldMs - entryLeadMs,
      hardStrategicCutoffAt: expirationAtMs - targetHoldMs,
      purchaseDeadlineAt: Number.isFinite(Number(purchaseDeadlineAt)) ? Number(purchaseDeadlineAt) : null,
      targetHoldSeconds: Math.round(targetHoldMs / 1000),
      entryLeadMs,
    };
  }

  /** Fase da expiration no relogio do broker. */
  static phase({ tteMs, discoveryMaxTteMs = DISCOVERY_MAX_TTE_MS, targetHoldMs = TARGET_HOLD_MS } = {}) {
    const tte = Number(tteMs);
    if (!Number.isFinite(tte)) return "INVALID";
    if (tte <= targetHoldMs) return "MISSED_5M_ENTRY_WINDOW";
    if (tte > discoveryMaxTteMs) return "NOT_YET_OFFERED";
    return "OPPORTUNITY_WINDOW";
  }

  /** Avaliacao de envio: exige brokerNow dentro de [hardCutoff, targetSendAt] e expiration alinhada. */
  static canSubmit({ expirationAt, brokerNow, purchaseDeadlineAt = null, discoveryMaxTteMs = DISCOVERY_MAX_TTE_MS } = {}) {
    let derived;
    try { derived = ExpirationTargetTiming.derive({ expirationAt, brokerNow, purchaseDeadlineAt, discoveryMaxTteMs }); }
    catch (error) { return { ok: false, code: error?.code ?? "TIMING_ERROR", derived: null }; }
    if (derived.tteMs > discoveryMaxTteMs) return { ok: false, code: "TTE_ABOVE_DISCOVERY_WINDOW", derived };
    if (derived.tteMs <= derived.targetHoldSeconds * 1000) return { ok: false, code: "MISSED_5M_ENTRY_WINDOW", derived };
    if (derived.purchaseDeadlineAt !== null && derived.brokerNow >= derived.purchaseDeadlineAt) return { ok: false, code: "BROKER_PURCHASE_DEADLINE_PASSED", derived };
    return { ok: true, code: "ENTRY_WINDOW_OPEN", derived };
  }
}
