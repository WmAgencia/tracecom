/**
 * V3 — EXECUTION SCHEDULER (independente da chegada de candles).
 *
 * A aprovacao acontece na ANALYSIS WINDOW; o envio e agendado para
 * targetSendAt = expirationAt - 302s (broker time). O scheduler dispara nesse alvo e
 * revalida tudo; em modo observe-only registra o disparo sem enviar ordem.
 */
export const V3_SCHEDULER_VERSION = "v3-execution-scheduler-v1";

export class ExecutionScheduler {
  constructor({ now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onFire = null, log = () => {} } = {}) {
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onFire = onFire;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.intents = new Map();
    this.counters = { scheduled: 0, fired: 0, cancelled: 0, replaced: 0, fireErrors: 0 };
  }

  /** Agenda o disparo para daqui a `targetSendAt - brokerNow` ms reais (mesma taxa de relogio). */
  schedule({ opportunityId, expirationAt, targetSendAt, hardCutoffAt, brokerNow, context = null } = {}) {
    const existing = this.intents.get(opportunityId);
    if (existing) { this.counters.replaced += 1; this.cancel(opportunityId, "REPLACED"); }
    const now = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    const delayMs = Math.max(0, Number(targetSendAt) - now);
    const intent = { opportunityId, expirationAt: Number(expirationAt), targetSendAt: Number(targetSendAt), hardCutoffAt: Number(hardCutoffAt), scheduledAt: now, localFireAt: this.now() + delayMs, context, cancelledAt: null, firedAt: null, timer: null };
    intent.timer = this.setTimer(() => { void this.#fire(intent); }, delayMs);
    intent.timer?.unref?.();
    this.intents.set(opportunityId, intent);
    this.counters.scheduled += 1;
    this.log("V3_EXECUTION_SCHEDULED", JSON.stringify({ opportunityId, delayMs, targetSendAt: intent.targetSendAt }));
    return { scheduled: true, intent: this.#publicIntent(intent) };
  }

  async #fire(intent) {
    if (intent.cancelledAt !== null) return;
    intent.firedAt = this.now();
    this.intents.delete(intent.opportunityId);
    this.counters.fired += 1;
    try { await this.onFire?.(intent); }
    catch (error) { this.counters.fireErrors += 1; this.log("V3_SCHEDULER_FIRE_ERROR", String(error?.message ?? error).slice(0, 160)); }
  }

  cancel(opportunityId, reason = "CANCELLED") {
    const intent = this.intents.get(opportunityId);
    if (!intent) return false;
    intent.cancelledAt = this.now();
    intent.cancelReason = String(reason).slice(0, 80);
    if (intent.timer) this.clearTimer(intent.timer);
    this.intents.delete(opportunityId);
    this.counters.cancelled += 1;
    this.log("V3_EXECUTION_CANCELLED", JSON.stringify({ opportunityId, reason: intent.cancelReason }));
    return true;
  }

  #publicIntent(intent) {
    const { timer, ...rest } = intent;
    return { ...rest };
  }

  pending() { return [...this.intents.values()].map((intent) => this.#publicIntent(intent)); }
  status() { return { version: V3_SCHEDULER_VERSION, pending: this.intents.size, counters: { ...this.counters }, intents: this.pending() }; }
}
