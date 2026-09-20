/**
 * REAL MODE CONTROLLER — suporte tecnico ao modo REAL com protecao explicita e fail-closed.
 *
 * Nenhuma ordem REAL existe sem TODOS:
 *  - confirmacao server-side (frase literal + checkbox + acknowledge de risco);
 *  - saldo REAL visivel e resolvido no servidor (get_balances);
 *  - max stake <= hard cap;
 *  - sessao real com id/timestamp/exp) em memoria (NUNCA sobrevive a restart/reload/deploy);
 *  - autorizacao por ordem (stake <= teto da sessao real).
 * Invalida em: troca de modo, disconnect/erro de socket, ACK desconhecido, kill switch,
 * expiracao, restart/deploy. Default do sistema e PRACTICE.
 */
import crypto from "node:crypto";
import { HARD_CAP_STAKE } from "./market-universe.mjs";

export const REAL_CONFIRMATION_PHRASE = "OPERAR CONTA REAL";
export const REAL_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class RealModeError extends Error { constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; } }

export class RealModeController {
  constructor({ now = () => Date.now(), ttlMs = REAL_SESSION_TTL_MS, hardCap = HARD_CAP_STAKE } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.hardCap = hardCap;
    this.session = null;
    this.lastRevokeReason = null;
    this.audit = [];
  }

  #record(event, detail = {}) { this.audit = [{ event, at: this.now(), ...detail }, ...this.audit].slice(0, 50); }

  requestConfirmation({ phrase, acknowledgeRisk, realBalance, realBalanceId, maxStake } = {}) {
    if (String(phrase ?? "").trim().toUpperCase() !== REAL_CONFIRMATION_PHRASE) throw new RealModeError("REAL_PHRASE_MISMATCH");
    if (acknowledgeRisk !== true) throw new RealModeError("REAL_RISK_ACK_REQUIRED");
    const balance = Number(realBalance);
    if (!Number.isFinite(balance) || balance <= 0) throw new RealModeError("REAL_BALANCE_UNAVAILABLE", String(realBalance ?? ""));
    if (realBalanceId === null || realBalanceId === undefined || !Number.isFinite(Number(realBalanceId))) throw new RealModeError("REAL_BALANCE_ID_REQUIRED");
    const limit = Number(maxStake);
    if (!Number.isFinite(limit) || limit <= 0) throw new RealModeError("REAL_MAX_STAKE_INVALID");
    if (limit > this.hardCap) throw new RealModeError("REAL_MAX_STAKE_ABOVE_HARD_CAP", `${limit} > ${this.hardCap}`);
    this.session = {
      realModeSessionId: `real_${crypto.randomUUID()}`,
      confirmedAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      maxStake: limit,
      hardCap: this.hardCap,
      realBalanceSeen: balance,
      realBalanceId: Number(realBalanceId),
      phrase: REAL_CONFIRMATION_PHRASE,
    };
    this.lastRevokeReason = null;
    this.#record("REAL_MODE_CONFIRMED", { maxStake: limit, realBalanceSeen: balance });
    return this.status();
  }

  status() {
    const active = this.session !== null && this.now() < this.session?.expiresAt;
    return {
      realModeEnabled: active,
      realModeSessionId: active ? this.session?.realModeSessionId : null,
      confirmedAt: active ? this.session?.confirmedAt : null,
      expiresAt: active ? this.session?.expiresAt : null,
      maxStake: active ? this.session?.maxStake : null,
      realBalanceSeen: active ? this.session?.realBalanceSeen : null,
      lastRevokeReason: this.lastRevokeReason,
      hardCap: this.hardCap,
      phraseRequired: REAL_CONFIRMATION_PHRASE,
      audit: this.audit.slice(0, 10),
    };
  }

  authorized() { return process.env.REAL_TRADING_ENABLED === "true"; }

  authorizeOrder({ stake, marketKey } = {}) {
    if (!this.authorized()) throw new RealModeError("REAL_MODE_NOT_CONFIRMED");
    const value = Number(stake);
    if (!Number.isFinite(value) || value <= 0) throw new RealModeError("REAL_STAKE_INVALID");
    if (value > this.session?.maxStake) throw new RealModeError("REAL_SESSION_STAKE_EXCEEDED", `${value} > ${this.session?.maxStake}`);
    this.#record("REAL_ORDER_AUTHORIZED", { stake: value, marketKey: marketKey ?? null });
    return { realModeSessionId: this.session?.realModeSessionId, maxStake: this.session?.maxStake, stake: value };
  }

  revoke(reason = "MANUAL") {
    if (this.session) this.#record("REAL_MODE_REVOKED", { reason: String(reason).slice(0, 60) });
    this.session = null;
    this.lastRevokeReason = String(reason).slice(0, 60);
    return this.status();
  }
}
