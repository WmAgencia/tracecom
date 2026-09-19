/**
 * ACCOUNT CONTEXT — isolamento rigoroso PRACTICE x REAL + REAL LOCKED/ARMED.
 *
 * Invariantes (fail-closed):
 *  - O contexto padrao e sempre PRACTICE; REAL nunca nasce armado.
 *  - Nenhuma ordem REAL existe sem TODOS: accountContext=REAL, REAL_TRADING_ENABLED=true,
 *    ARM explicito na sessao, killSwitch OFF, riskGate PASS, dataQuality HEALTHY,
 *    strategy ∈ REAL_STRATEGY_ALLOWLIST, stake <= hardCap, mercado permitido,
 *    idempotencia valida, conta real acessivel e sem ambiguidade.
 *  - Restart/deploy/reconnect/token refresh/troca de sessao/ambiguidade de conta =>
 *    REAL volta a LOCKED; nunca restaura REAL+ARMED automaticamente.
 *  - Nenhuma estrategia experimental ganha permissao por existir: o allowlist REAL e
 *    congelado e SCENARIO_ENGINE_V3_FROZEN/Agent V4/Late Window/alphas/ML/playbooks
 *    novos permanecem SHADOW.
 *  - Toda tentativa REAL gera trilha de auditoria com accountContext, strategy,
 *    agentVersion, candidate, decision, stake, market, direction, expiry, send,
 *    ACK, brokerOrderId e settlement (preenchidos conforme o estagio).
 *  - Nenhum segredo (senha/token/ssid/cookie) entra em status, log, evento ou doc.
 */
import crypto from "node:crypto";

export const PRACTICE = "PRACTICE";
export const REAL = "REAL";
export const ACCOUNT_CONTEXTS = Object.freeze([PRACTICE, REAL]);

export const REAL_ARM_CONFIRMATION_PHRASE = "CONFIRMAR E ARMAR REAL";
export const REAL_ACCOUNT_LABEL = "CONTA REAL";

export const REAL_ACCOUNT_CONTEXT_VERSION = "real-account-context-v1";

/** Allowlist REAL congelada. Nenhuma estrategia experimental entra aqui por existir. */
export const REAL_STRATEGY_ALLOWLIST = Object.freeze({
  version: "real-strategy-allowlist-v1",
  allowed: Object.freeze(["PROFESSIONAL_BRAIN_G2"]),
  shadowOnly: Object.freeze([
    "SCENARIO_ENGINE_V3_FROZEN",
    "AGENT_V4",
    "LATE_WINDOW_V2",
    "ALPHA_PACK_V1",
    "ML_SHADOW",
    "NEW_PLAYBOOKS_V1",
  ]),
  note: "Somente o Brain validado (G2) e elegivel; todo o resto permanece SHADOW.",
});

export const REAL_GATE_CHECK_IDS = Object.freeze([
  "account_context",
  "real_trading_enabled",
  "armed",
  "kill_switch_off",
  "risk_gate_pass",
  "data_quality_healthy",
  "strategy_allowlisted",
  "stake_within_hard_cap",
  "market_allowed",
  "idempotency_valid",
  "account_accessible",
  "account_unambiguous",
]);

export class AccountContextError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AccountContextError";
    this.code = code;
    this.detail = String(detail).slice(0, 200);
  }
}

function isContext(value) {
  return value === PRACTICE || value === REAL;
}

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

/**
 * Avaliacao PURA do gate REAL. Falha fechado: qualquer campo ausente/inesperado bloqueia.
 * Usada pelo controller e diretamente pelos testes.
 */
export function evaluateRealPreflight(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const killSwitch = source.killSwitch && typeof source.killSwitch === "object" ? source.killSwitch : null;
  const killSwitchOff = killSwitch !== null && killSwitch.engaged !== true && killSwitch.executionEnabled === true;
  const checks = [
    { id: "account_context", ok: source.accountContext === REAL, detail: source.accountContext ?? null },
    { id: "real_trading_enabled", ok: source.realTradingEnabled === true, detail: source.realTradingEnabled === true },
    { id: "armed", ok: source.armed === true, detail: source.armed === true },
    { id: "kill_switch_off", ok: killSwitchOff, detail: killSwitch ? { engaged: killSwitch.engaged ?? null, executionEnabled: killSwitch.executionEnabled ?? null } : null },
    { id: "risk_gate_pass", ok: source.riskGate === "PASS", detail: source.riskGate ?? null },
    { id: "data_quality_healthy", ok: source.dataQuality === "HEALTHY", detail: source.dataQuality ?? null },
    { id: "strategy_allowlisted", ok: REAL_STRATEGY_ALLOWLIST.allowed.includes(source.strategy), detail: source.strategy ?? null },
    { id: "stake_within_hard_cap", ok: finitePositive(source.stake) && finitePositive(source.hardCap) && Number(source.stake) <= Number(source.hardCap), detail: { stake: source.stake ?? null, hardCap: source.hardCap ?? null } },
    { id: "market_allowed", ok: source.marketAllowed === true, detail: source.marketAllowed === true },
    { id: "idempotency_valid", ok: source.idempotencyValid === true, detail: source.idempotencyValid === true },
    { id: "account_accessible", ok: source.accountAccessible === true, detail: source.accountAccessible === true },
    { id: "account_unambiguous", ok: source.accountUnambiguous === true, detail: source.accountUnambiguous === true },
  ];
  const blockedBy = checks.filter((check) => check.ok !== true).map((check) => check.id);
  return { version: REAL_ACCOUNT_CONTEXT_VERSION, ok: blockedBy.length === 0, state: blockedBy.length === 0 ? "PASS" : "BLOCK", blockedBy, checks };
}

/* ------------------------------------------------------------------ *
 * Isolamento por accountContext — helpers puros e testaveis
 * ------------------------------------------------------------------ */

export function stampAccountContext(entity, context) {
  if (!isContext(context)) throw new AccountContextError("ACCOUNT_CONTEXT_INVALID", String(context ?? ""));
  if (!entity || typeof entity !== "object") throw new AccountContextError("ACCOUNT_CONTEXT_ENTITY_INVALID");
  entity.accountContext = context;
  return entity;
}

export function assertSameAccountContext(entity, context) {
  const found = entity?.accountContext ?? null;
  if (!isContext(found) || found !== context) throw new AccountContextError("ACCOUNT_CONTEXT_CROSS", `${String(found)} != ${String(context)}`);
  return entity;
}

export function filterByAccountContext(rows, context) {
  if (!isContext(context)) throw new AccountContextError("ACCOUNT_CONTEXT_INVALID", String(context ?? ""));
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.accountContext === context);
}

function maskId(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.length > 4 ? `***${text.slice(-4)}` : null;
}

/**
 * Controller in-memory do contexto de conta. NUNCA persiste ARMED: restart/deploy cria
 * instancia LOCKED, e invalidacoes de sessao rebaixam para LOCKED.
 */
export class AccountContextController {
  constructor({
    now = () => Date.now(),
    hardCap = 100,
    realTradingEnabled = false,
    sessionId = null,
    maxRealStake = null,
    maxExposure = null,
    maxPositions = 1,
    allowlist = REAL_STRATEGY_ALLOWLIST,
  } = {}) {
    this.now = now;
    this.hardCap = finitePositive(hardCap) ? Number(hardCap) : 100;
    this.realTradingEnabled = realTradingEnabled === true;
    this.sessionId = sessionId ?? `acct_${crypto.randomUUID()}`;
    this.bootingAt = this.now();
    this.allowlist = allowlist ?? REAL_STRATEGY_ALLOWLIST;
    this.context = PRACTICE;
    this.armed = false;
    this.armedMeta = null;
    this.lockedReason = "BOOT";
    this.connectionId = null;
    this.realAccount = { available: false, balance: null, currency: null, checkedAt: null, readOnly: true, error: null };
    this.accountAmbiguity = false;
    this.maxRealStake = finitePositive(maxRealStake) ? Math.min(Number(maxRealStake), this.hardCap) : this.hardCap;
    this.maxExposure = finitePositive(maxExposure) ? Math.min(Number(maxExposure), this.hardCap) : this.hardCap;
    this.maxPositions = Number.isFinite(Number(maxPositions)) && Number(maxPositions) >= 1 ? Math.floor(Number(maxPositions)) : 1;
    this.audit = [];
    this.lastPreflight = null;
    this.#audit("ACCOUNT_CONTEXT_BOOT", { context: this.context, locked: true, reason: this.lockedReason });
  }

  #audit(event, detail = {}) {
    const record = { event, at: this.now(), sessionId: this.sessionId, ...detail };
    this.audit = [record, ...this.audit].slice(0, 400);
    return record;
  }

  auditTrail(limit = 50) {
    const bounded = Math.max(1, Math.min(400, Number(limit) || 50));
    return { audit: this.audit.slice(0, bounded), total: this.audit.length };
  }

  get state() {
    return this.context === REAL ? (this.armed ? "REAL · ARMED" : "REAL · LOCKED") : "PRACTICE";
  }

  isRealArmed() {
    return this.context === REAL && this.armed === true && this.realTradingEnabled === true;
  }

  status() {
    return {
      version: REAL_ACCOUNT_CONTEXT_VERSION,
      context: this.context,
      state: this.state,
      accountContext: this.context,
      armed: this.armed,
      realTradingEnabled: this.realTradingEnabled,
      realExecutionEnabled: this.isRealArmed(),
      lockedReason: this.armed ? null : this.lockedReason,
      sessionId: this.sessionId,
      connectionId: this.connectionId,
      hardCap: this.hardCap,
      maxRealStake: this.maxRealStake,
      maxExposure: this.maxExposure,
      maxPositions: this.maxPositions,
      strategy: this.armedMeta?.strategy ?? null,
      armedAt: this.armedMeta?.at ?? null,
      armedMaxStake: this.armedMeta?.maxStake ?? null,
      autoStatus: this.armedMeta?.autoStatus ?? null,
      realAccount: { ...this.realAccount, balanceIdMasked: this.realAccount.balanceIdMasked ?? null, balanceId: undefined },
      accountAmbiguity: this.accountAmbiguity,
      allowlist: this.allowlist,
      shadowOnly: this.allowlist.shadowOnly,
      lastPreflight: this.lastPreflight,
      isolation: { practice: true, real: true, crossContextBlocked: true },
    };
  }

  /** Selecao de contexto (PRACTICE/REAL). Selecionar REAL nunca arma; trocar para PRACTICE desarma. */
  select(context) {
    if (!isContext(context)) throw new AccountContextError("ACCOUNT_CONTEXT_INVALID", String(context ?? ""));
    if (context === this.context) return this.status();
    if (context === REAL) {
      this.#lockInternal("CONTEXT_SELECTED_REAL");
      this.context = REAL;
      if (!this.realAccount.available) this.lockedReason = this.realAccount.error ?? "REAL_ACCOUNT_UNAVAILABLE";
      this.#audit("ACCOUNT_CONTEXT_SELECTED", { context: REAL, locked: true });
    } else {
      this.context = PRACTICE;
      if (this.armed) this.#audit("REAL_LOCKED", { reason: "CONTEXT_SWITCH_TO_PRACTICE" });
      this.armed = false;
      this.armedMeta = null;
      this.lockedReason = "CONTEXT_PRACTICE";
      this.#audit("ACCOUNT_CONTEXT_SELECTED", { context: PRACTICE });
    }
    this.#emitSafe("ACCOUNT_CONTEXT_SELECTED", { context: this.context, state: this.state });
    return this.status();
  }

  /** Nova conexao/handshake (reconnect/token refresh). Sessao diferente => REAL LOCKED. */
  beginSession(connectionId) {
    const next = connectionId === null || connectionId === undefined ? null : String(connectionId);
    const changed = this.connectionId !== null && next !== null && this.connectionId !== next;
    this.connectionId = next;
    if (changed && (this.armed || this.context === REAL)) this.lock("SESSION_CHANGE");
    return this.status();
  }

  /** Leitura server-side da conta real (somente leitura). Nunca simula saldo. */
  reportRealAccount(snapshot) {
    if (!snapshot || snapshot.available !== true) {
      this.realAccount = { available: false, balance: null, currency: null, checkedAt: this.now(), readOnly: true, error: String(snapshot?.error ?? "REAL_ACCOUNT_UNAVAILABLE").slice(0, 80) };
      if (this.context === REAL) this.lock("REAL_ACCOUNT_UNAVAILABLE");
      return this.status();
    }
    const balance = Number(snapshot.balance);
    const balanceId = snapshot.balanceId;
    const ambiguous = !finitePositive(balanceId) || !Number.isFinite(balance) || balance <= 0;
    this.realAccount = {
      available: !ambiguous,
      balance: Number.isFinite(balance) ? balance : null,
      currency: typeof snapshot.currency === "string" ? snapshot.currency : null,
      balanceIdMasked: maskId(balanceId),
      checkedAt: this.now(),
      readOnly: true,
      error: ambiguous ? "REAL_ACCOUNT_AMBIGUOUS" : null,
    };
    this.accountAmbiguity = ambiguous;
    if (ambiguous && this.context === REAL) this.lock("ACCOUNT_AMBIGUOUS");
    return this.status();
  }

  /**
   * Arma REAL. Exige frase literal, acknowledge, saldo real resolvido no servidor,
   * stake <= hardCap, strategy no allowlist e preflight (com armed=true) PASS.
   */
  arm({ confirmationPhrase, acknowledge, realBalance, realBalanceId, maxStake, strategy, autoStatus = false, preflightInput = null, actor = "ui" } = {}) {
    if (this.context !== REAL) throw new AccountContextError("ACCOUNT_CONTEXT_NOT_REAL", this.context);
    if (String(confirmationPhrase ?? "").trim().toUpperCase() !== REAL_ARM_CONFIRMATION_PHRASE) throw new AccountContextError("REAL_CONFIRMATION_PHRASE_MISMATCH");
    if (acknowledge !== true) throw new AccountContextError("REAL_ACK_REQUIRED");
    if (this.accountAmbiguity || !this.realAccount.available) throw new AccountContextError("REAL_ACCOUNT_UNAVAILABLE", this.realAccount.error ?? "");
    const balance = Number(realBalance);
    if (!Number.isFinite(balance) || balance <= 0) throw new AccountContextError("REAL_BALANCE_UNAVAILABLE", String(realBalance ?? ""));
    if (!finitePositive(realBalanceId)) throw new AccountContextError("REAL_BALANCE_ID_REQUIRED");
    const limit = Number(maxStake);
    if (!finitePositive(limit)) throw new AccountContextError("REAL_MAX_STAKE_INVALID", String(maxStake ?? ""));
    if (limit > this.hardCap) throw new AccountContextError("REAL_MAX_STAKE_ABOVE_HARD_CAP", `${limit} > ${this.hardCap}`);
    if (!this.allowlist.allowed.includes(strategy)) throw new AccountContextError("REAL_STRATEGY_NOT_ALLOWED", String(strategy ?? ""));
    const preflight = this.preflight(preflightInput ?? {}, { audit: false, armedOverride: true });
    if (!preflight.ok) {
      this.#audit("REAL_ARM_BLOCKED", { blockedBy: preflight.blockedBy });
      throw new AccountContextError("REAL_PREFLIGHT_BLOCKED", preflight.blockedBy.join(","));
    }
    this.armed = true;
    this.armedMeta = {
      at: this.now(),
      sessionId: this.sessionId,
      strategy,
      maxStake: limit,
      realBalanceSeen: balance,
      realBalanceIdMasked: maskId(realBalanceId),
      maxExposure: this.maxExposure,
      maxPositions: this.maxPositions,
      autoStatus: autoStatus === true,
      actor: String(actor).slice(0, 40),
    };
    this.lockedReason = null;
    this.#audit("REAL_ARMED", { strategy, maxStake: limit, realBalanceSeen: balance, autoStatus: autoStatus === true, maxExposure: this.maxExposure, maxPositions: this.maxPositions });
    this.#emitSafe("REAL_ARMED", { strategy, maxStake: limit, autoStatus: autoStatus === true });
    return this.status();
  }

  disarm(reason = "MANUAL") {
    if (this.armed) this.#audit("REAL_DISARMED", { reason: String(reason).slice(0, 60) });
    this.armed = false;
    this.armedMeta = null;
    this.lockedReason = String(reason).slice(0, 60);
    this.#emitSafe("REAL_DISARMED", { reason: this.lockedReason });
    return this.status();
  }

  /** Invalida (fail-closed): usado em restart/deploy/reconnect/token refresh/ambiguidade. */
  lock(reason = "LOCKED") {
    return this.disarm(reason);
  }

  #lockInternal(reason) {
    if (this.armed) this.#audit("REAL_LOCKED", { reason });
    this.armed = false;
    this.armedMeta = null;
    this.lockedReason = reason;
  }

  #emitSafe(event, payload) {
    try { this.onEvent?.(event, payload); } catch { /* observabilidade nunca derruba o gate */ }
  }

  preflight(input = {}, { audit = true, armedOverride = null } = {}) {
    const merged = {
      accountContext: this.context,
      realTradingEnabled: this.realTradingEnabled,
      armed: this.armed,
      ...input,
    };
    if (armedOverride !== null) merged.armed = armedOverride === true;
    const result = evaluateRealPreflight(merged);
    this.lastPreflight = { ...result, at: this.now() };
    if (audit && !result.ok) this.#audit("REAL_PREFLIGHT_BLOCKED", { blockedBy: result.blockedBy, strategy: merged.strategy ?? null, stake: merged.stake ?? null });
    return result;
  }

  /**
   * Unico choke-point para envio REAL. Sempre audita a tentativa (TASK 6).
   */
  evaluateSend(input = {}, { audit = true } = {}) {
    const merged = {
      accountContext: this.context,
      realTradingEnabled: this.realTradingEnabled,
      armed: this.armed === true,
      ...input,
    };
    const result = evaluateRealPreflight(merged);
    return result;
  }

  /** Auditoria de estagio REAL (candidate/decision/send/ACK/settlement) — trilha completa. */
  recordRealAttempt(stage, detail = {}) {
    const record = {
      stage: String(stage).slice(0, 40),
      accountContext: REAL,
      strategy: detail.strategy ?? this.armedMeta?.strategy ?? null,
      agentVersion: detail.agentVersion ?? null,
      candidateId: detail.candidateId ?? null,
      decisionId: detail.decisionId ?? null,
      stake: detail.stake ?? null,
      marketKey: detail.marketKey ?? null,
      direction: detail.direction ?? null,
      expiry: detail.expiry ?? null,
      send: detail.send === true,
      ack: detail.ack ?? null,
      brokerOrderId: detail.brokerOrderId ?? null,
      settlement: detail.settlement ?? null,
      detail,
    };
    this.#audit(`REAL_${record.stage}`, record);
    this.#emitSafe("REAL_AUDIT", record);
    return record;
  }
}
