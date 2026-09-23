/**
 * V3 — EXPIRATION TARGET TIMING (autoridade de timing da V3, v2 conceptual).
 *
 * Separa explicitamente:
 *  - ANALYSIS WINDOW : 300s < TTE <= 330s (investigar a opportunity com ciclos)
 *  - TARGET SEND     : ~TTE 302s (expiracao - 302s)
 *  - EXECUTION WINDOW: (300s, 302.5s] — quando o socket pode ser acionado
 *  - HARD CUTOFF     : TTE <= 300s => MISSED_5M_ENTRY_WINDOW (nunca persegue)
 *
 * A grade e MINUTO A MINUTO (60s) para a familia turbo (provado por evidencia de ACK real);
 * o HOLD desejado e ~300s — grade e hold NAO sao a mesma coisa.
 * Autoridade de tempo: broker server time.
 */
import { DISCOVERY_MAX_TTE_MS, HARD_CUTOFF_TTE_MS, TARGET_HOLD_MS, ENTRY_LEAD_MS, EXPIRY_GRID_MS, isGridAligned } from "./expiration-grid.mjs";

export const V3_TIMING_VERSION = "v3-expiration-target-timing-v2";
export const EXECUTION_TOLERANCE_MS = 500;
export const TARGET_SEND_TTE_MS = TARGET_HOLD_MS + ENTRY_LEAD_MS;

export class V3TimingError extends Error {
  constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

export { isGridAligned };
export const isAlignedExpiration = (expirationAtMs) => isGridAligned(expirationAtMs, EXPIRY_GRID_MS);

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
      purchaseDeadlineAt: Number.isFinite(Number(purchaseDeadlineAt)) && Number(purchaseDeadlineAt) > 0 ? Number(purchaseDeadlineAt) : null,
      targetHoldSeconds: Math.round(targetHoldMs / 1000),
      entryLeadMs,
    };
  }

  static phase({ tteMs, discoveryMaxTteMs = DISCOVERY_MAX_TTE_MS, targetHoldMs = TARGET_HOLD_MS } = {}) {
    const tte = Number(tteMs);
    if (!Number.isFinite(tte)) return "INVALID";
    if (tte <= targetHoldMs) return "MISSED_5M_ENTRY_WINDOW";
    if (tte > discoveryMaxTteMs) return "NOT_YET_OFFERED";
    return "OPPORTUNITY_WINDOW";
  }

  /** ANALYSIS: a opportunity pode ser investigada (primeiro ciclo FULL + ciclos subsequentes). */
  static analysis({ expirationAt, brokerNow } = {}) {
    let derived;
    try { derived = ExpirationTargetTiming.derive({ expirationAt, brokerNow }); }
    catch (error) { return { ok: false, code: error?.code ?? "TIMING_ERROR", derived: null }; }
    if (derived.tteMs > DISCOVERY_MAX_TTE_MS) return { ok: false, code: "TTE_ABOVE_ANALYSIS_WINDOW", derived };
    if (derived.tteMs <= HARD_CUTOFF_TTE_MS) return { ok: false, code: "MISSED_5M_ENTRY_WINDOW", derived };
    return { ok: true, code: "ANALYSIS_WINDOW_OPEN", derived };
  }

  /** EXECUTION: janela de socket (~302s), nunca antes do alvo e nunca depois do cutoff. */
  static execution({ expirationAt, brokerNow, purchaseDeadlineAt = null } = {}) {
    let derived;
    try { derived = ExpirationTargetTiming.derive({ expirationAt, brokerNow, purchaseDeadlineAt }); }
    catch (error) { return { ok: false, code: error?.code ?? "TIMING_ERROR", derived: null }; }
    if (derived.tteMs <= HARD_CUTOFF_TTE_MS) return { ok: false, code: "MISSED_5M_ENTRY_WINDOW", derived };
    if (derived.tteMs > TARGET_SEND_TTE_MS + EXECUTION_TOLERANCE_MS) return { ok: false, code: "BEFORE_TARGET_SEND", derived };
    if (derived.purchaseDeadlineAt !== null && derived.brokerNow >= derived.purchaseDeadlineAt) return { ok: false, code: "BROKER_PURCHASE_DEADLINE_PASSED", derived };
    return { ok: true, code: "EXECUTION_WINDOW_OPEN", derived };
  }

  static cutoffPassed({ expirationAt, brokerNow } = {}) {
    const tte = Number(expirationAt) - Number(brokerNow);
    return !Number.isFinite(tte) || tte <= HARD_CUTOFF_TTE_MS;
  }

  /** Compatibilidade: `canSubmit` agora significa EXECUTION WINDOW (nao analysis). */
  static canSubmit(options = {}) { return ExpirationTargetTiming.execution(options); }
}

const toMs = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
};

/** Intencao de ordem V3: SEMPRE a expiration exata da opportunity, nunca recalculada. */
export function buildV3OrderIntent({ opportunity = null, brokerNow, stake = null, direction = null, balanceId = null, optionTypeId = 3 } = {}) {
  if (!opportunity) return { ok: false, code: "OPPORTUNITY_REQUIRED" };
  const window = ExpirationTargetTiming.execution({ expirationAt: opportunity.expirationAt, brokerNow, purchaseDeadlineAt: opportunity.purchaseDeadlineAt });
  if (window.ok !== true) return { ok: false, code: window.code, derived: window.derived };
  if (direction !== "BUY" && direction !== "SELL") return { ok: false, code: "DIRECTION_REQUIRED" };
  if (!isAlignedExpiration(opportunity.expirationAt)) return { ok: false, code: "EXPIRATION_NOT_ALIGNED" };
  return {
    ok: true, code: "EXACT_TARGET_READY",
    intent: {
      opportunityId: opportunity.opportunityId, marketKey: opportunity.marketKey, activeId: opportunity.activeId ?? null,
      direction, stake, exactExpirationAt: Math.round(Number(opportunity.expirationAt) / 1000), optionTypeId,
      targetSendAt: opportunity.targetSendAt, hardStrategicCutoffAt: opportunity.hardStrategicCutoffAt,
      tteMs: window.derived?.tteMs ?? null, balanceId,
    },
  };
}

/** Guard pre-submit: expiration diferente da opportunity ou fora da grade de 60s => DENY. */
export function assertExactExpirationTarget({ opportunity = null, requestedExpirationAt = null, gridMs = EXPIRY_GRID_MS } = {}) {
  if (!opportunity) return { ok: false, code: "OPPORTUNITY_REQUIRED" };
  const requestedMs = toMs(requestedExpirationAt);
  if (requestedMs === null) return { ok: false, code: "EXPIRATION_REQUIRED" };
  if (!isGridAligned(requestedMs, gridMs)) return { ok: false, code: "ENTRY_EXPIRATION_ALIGNMENT", requestedMs, gridMs };
  if (requestedMs !== Number(opportunity.expirationAt)) return { ok: false, code: "ENTRY_EXPIRATION_MISMATCH", expected: Number(opportunity.expirationAt), requested: requestedMs };
  return { ok: true, code: "EXACT_TARGET" };
}

