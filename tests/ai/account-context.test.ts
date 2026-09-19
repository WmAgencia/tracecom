/**
 * TRILHA B — accountContext PRACTICE/REAL: isolamento, LOCKED/ARMED, gate REAL,
 * allowlist, auditoria e fail-closed (Fases 19–25, 36–37).
 *
 * REGRA ABSOLUTA: nenhum teste envia ordem REAL. Todos os fixtures usam client
 * fake; o gate REAL é avaliado sem executar nada, e os testes provam que o
 * caminho REAL permanece BLOCKED por padrão.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const accountModule = await import("../../relay/account-context.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");

const {
  AccountContextController,
  AccountContextError,
  evaluateRealPreflight,
  filterByAccountContext,
  stampAccountContext,
  assertSameAccountContext,
  REAL_STRATEGY_ALLOWLIST,
  REAL_ARM_CONFIRMATION_PHRASE,
  REAL_GATE_CHECK_IDS,
} = accountModule as unknown as Record<string, any>;
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const PHRASE = REAL_ARM_CONFIRMATION_PHRASE as string;
const READY_INPUT = Object.freeze({
  killSwitch: { engaged: false, executionEnabled: true },
  riskGate: "PASS",
  dataQuality: "HEALTHY",
  stake: 2,
  hardCap: 100,
  marketAllowed: true,
  idempotencyValid: true,
  accountAccessible: true,
  accountUnambiguous: true,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function controllerFixture(overrides: Record<string, unknown> = {}) {
  return new AccountContextController({ now: () => 1_000_000, hardCap: 100, realTradingEnabled: false, ...overrides }) as any;
}

function armedController(overrides: Record<string, unknown> = {}) {
  const controller = controllerFixture({ realTradingEnabled: true, ...overrides });
  controller.select("REAL");
  controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
  controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2", preflightInput: { ...READY_INPUT, strategy: "PROFESSIONAL_BRAIN_G2" } });
  return controller;
}

function runtimeFixture(overrides: Record<string, unknown> = {}) {
  const runtime = new IqMultiRuntime({ pool: null, getSsid: () => "FAKE_SSID", now: () => Date.now(), log: () => {}, ackTimeoutMs: 60, ...overrides }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-ctx-1", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true, connectedAt: Date.now() };
  runtime.connection = { connectionId: "conn-ctx-1", host: "ws.iqoption.com", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "BRL" }, real: { available: true, balanceId: 777, balance: 500, currency: "BRL" }, hasReal: true, checkedAt: Date.now(), type: "PRACTICE" };
  runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = 1;
  runtime.__sent = [];
  runtime.client = { serverNow: () => Date.now(), placeOrder: (options: Record<string, unknown>) => { runtime.__sent.push(options); return options.requestId; }, getOptions: async () => ({ response: { msg: { closed_options: [] } } }) };
  return runtime;
}

function seedMarket(runtime: any, key: string, { activeId = 101, close = 1.1, enabled = true }: { activeId?: number; close?: number; enabled?: boolean } = {}) {
  const ctx = runtime.markets.get(key);
  ctx.availability = "OPEN"; ctx.activeId = activeId; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = enabled; ctx.maxStake = 2;
  const base = Math.floor(Date.now() / 5_000) * 5_000;
  for (let index = 1; index <= 5; index += 1) {
    const fromSec = Math.floor((base - (5 - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: "conn-ctx-1", receivedAt: Date.now(), msg: { active_id: activeId, size: 5, from: fromSec, to: fromSec + 5, open: close, high: close + 0.0001, low: close - 0.0001, close: Number((close + index * 0.00001).toFixed(6)) } });
  }
  return ctx;
}

/* ------------------------------------------------------------------ *
 * Contexto e isolamento
 * ------------------------------------------------------------------ */

describe("ACCOUNT CONTEXT — seleção e estados", () => {
  it("PRACTICE é o contexto padrão e REAL nasce LOCKED (fail-closed)", () => {
    const controller = controllerFixture();
    const status = controller.status();
    expect(status.context).toBe("PRACTICE");
    expect(status.state).toBe("PRACTICE");
    expect(status.armed).toBe(false);
    expect(status.realTradingEnabled).toBe(false);
    expect(status.realExecutionEnabled).toBe(false);
  });

  it("selecionar REAL mantém LOCKED e desarmado; voltar para PRACTICE também desarma", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2", preflightInput: { ...READY_INPUT, strategy: "PROFESSIONAL_BRAIN_G2" } });
    expect(controller.status().state).toBe("REAL · ARMED");
    controller.select("PRACTICE");
    expect(controller.status().state).toBe("PRACTICE");
    expect(controller.armed).toBe(false);
    controller.select("REAL");
    expect(controller.status().state).toBe("REAL · LOCKED");
  });

  it("contexto inválido é rejeitado sem trocar de conta", () => {
    const controller = controllerFixture();
    expect(() => controller.select("DEMO")).toThrowError(/ACCOUNT_CONTEXT_INVALID/);
    expect(controller.status().context).toBe("PRACTICE");
  });

  it("conta real inacessível => LOCKED com erro honesto e nenhum saldo simulado", () => {
    const controller = controllerFixture();
    controller.select("REAL");
    controller.reportRealAccount({ available: false, error: "REAL_ACCOUNT_UNAVAILABLE" });
    const status = controller.status();
    expect(status.state).toBe("REAL · LOCKED");
    expect(status.lockedReason).toBe("REAL_ACCOUNT_UNAVAILABLE");
    expect(status.realAccount.available).toBe(false);
    expect(status.realAccount.balance).toBeNull();
  });

  it("conta real ambígua (balanceId ausente / saldo zero) => ACCOUNT_AMBIGUOUS e LOCKED", () => {
    const controller = controllerFixture();
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: null });
    expect(controller.status().lockedReason).toBe("ACCOUNT_AMBIGUOUS");
    expect(controller.accountAmbiguity).toBe(true);
  });
});

describe("ACCOUNT CONTEXT — arm REAL (confirmacao explicita)", () => {
  it("arm exige accountContext=REAL", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2" })).toThrowError(/ACCOUNT_CONTEXT_NOT_REAL/);
  });

  it("arm exige a frase literal CONFIRMAR E ARMAR REAL", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    expect(() => controller.arm({ confirmationPhrase: "OPERAR CONTA REAL", acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2" })).toThrowError(/REAL_CONFIRMATION_PHRASE_MISMATCH/);
  });

  it("arm exige acknowledge de risco", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: false, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2" })).toThrowError(/REAL_ACK_REQUIRED/);
  });

  it("arm exige saldo real resolvido no servidor", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: null, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2" })).toThrowError(/REAL_BALANCE_UNAVAILABLE/);
  });

  it("arm bloqueia stake acima do hard cap", () => {
    const controller = controllerFixture({ realTradingEnabled: true, hardCap: 100 });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 101, strategy: "PROFESSIONAL_BRAIN_G2" })).toThrowError(/REAL_MAX_STAKE_ABOVE_HARD_CAP/);
  });

  it("arm bloqueia estrategia experimental fora do allowlist", () => {
    for (const strategy of ["SCENARIO_ENGINE_V3_FROZEN", "AGENT_V4", "LATE_WINDOW_V2", "ALPHA_PACK_V1", "ML_SHADOW", "NEW_PLAYBOOKS_V1"]) {
      const controller = controllerFixture({ realTradingEnabled: true });
      controller.select("REAL");
      controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
      expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy }), strategy).toThrowError(/REAL_STRATEGY_NOT_ALLOWED/);
    }
  });

  it("arm bloqueia quando REAL_TRADING_ENABLED=false (preflight fail-closed)", () => {
    const controller = controllerFixture({ realTradingEnabled: false });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    expect(() => controller.arm({ confirmationPhrase: PHRASE, acknowledge: true, realBalance: 500, realBalanceId: 777, maxStake: 2, strategy: "PROFESSIONAL_BRAIN_G2", preflightInput: { ...READY_INPUT, strategy: "PROFESSIONAL_BRAIN_G2" } })).toThrowError(/REAL_PREFLIGHT_BLOCKED/);
    expect(controller.armed).toBe(false);
  });

  it("arm com todos os checks PASS => REAL · ARMED", () => {
    const controller = armedController();
    const status = controller.status();
    expect(status.state).toBe("REAL · ARMED");
    expect(status.armed).toBe(true);
    expect(status.realExecutionEnabled).toBe(true);
    expect(status.strategy).toBe("PROFESSIONAL_BRAIN_G2");
    expect(status.armedMaxStake).toBe(2);
    expect(status.maxRealStake).toBe(100);
  });
});

describe("REAL GATE — envio bloqueado por qualquer falha", () => {
  const send = (controller: any, overrides: Record<string, unknown> = {}) => controller.evaluateSend({ ...READY_INPUT, strategy: "PROFESSIONAL_BRAIN_G2", ...overrides });

  it("kill switch engatado bloqueia envio REAL", () => {
    const result = send(armedController(), { killSwitch: { engaged: true, executionEnabled: false } });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("kill_switch_off");
  });

  it("dataQuality degradada bloqueia envio REAL", () => {
    const result = send(armedController(), { dataQuality: "DEGRADED" });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("data_quality_healthy");
  });

  it("risk gate BLOCK bloqueia envio REAL", () => {
    const result = send(armedController(), { riskGate: "BLOCK" });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("risk_gate_pass");
  });

  it("stake acima do hard cap bloqueia envio REAL", () => {
    const result = send(armedController(), { stake: 101 });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("stake_within_hard_cap");
  });

  it("mercado não permitido bloqueia envio REAL", () => {
    const result = send(armedController(), { marketAllowed: false });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("market_allowed");
  });

  it("idempotência inválida bloqueia envio REAL", () => {
    const result = send(armedController(), { idempotencyValid: false });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("idempotency_valid");
  });

  it("ambiguidade de conta bloqueia envio REAL", () => {
    const result = send(armedController(), { accountUnambiguous: false });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("account_unambiguous");
  });

  it("conta inacessível bloqueia envio REAL", () => {
    const result = send(armedController(), { accountAccessible: false });
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("account_accessible");
  });

  it("desarmado bloqueia envio REAL mesmo com tudo pronto", () => {
    const controller = controllerFixture({ realTradingEnabled: true });
    controller.select("REAL");
    controller.reportRealAccount({ available: true, balance: 500, currency: "BRL", balanceId: 777 });
    const result = send(controller);
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain("armed");
  });

  it("preflight sem input bloqueia todos os checks obrigatórios", () => {
    const result = evaluateRealPreflight({});
    expect(result.ok).toBe(false);
    for (const id of REAL_GATE_CHECK_IDS) expect(result.blockedBy).toContain(id);
  });
});

describe("FAIL CLOSED — restart, reconnect e lock", () => {
  it("restart/deploy cria contexto LOCKED (ARMED nunca é restaurado)", () => {
    const first = armedController();
    expect(first.status().armed).toBe(true);
    const afterRestart = controllerFixture({ realTradingEnabled: true });
    expect(afterRestart.status().context).toBe("PRACTICE");
    expect(afterRestart.status().armed).toBe(false);
    expect(afterRestart.status().lockedReason).toBe("BOOT");
  });

  it("reconnect/token refresh com novo connectionId rebaixa REAL para LOCKED", () => {
    const controller = armedController();
    controller.beginSession("conn-1");
    expect(controller.status().armed).toBe(true);
    controller.beginSession("conn-2");
    expect(controller.status().armed).toBe(false);
    expect(controller.status().lockedReason).toBe("SESSION_CHANGE");
  });

  it("mesma sessão mantém ARMED (sem reconfirmação por operação)", () => {
    const controller = armedController();
    controller.beginSession("conn-1");
    controller.beginSession("conn-1");
    expect(controller.status().armed).toBe(true);
  });

  it("lock explícito (kill switch/ambiguidade) desarma e nunca re-arma sozinho", () => {
    const controller = armedController();
    controller.lock("KILL_SWITCH");
    expect(controller.status().armed).toBe(false);
    expect(controller.status().lockedReason).toBe("KILL_SWITCH");
    expect(controller.evaluateSend({ ...READY_INPUT, strategy: "PROFESSIONAL_BRAIN_G2" }).ok).toBe(false);
  });
});

describe("ALLOWLIST e isolamento de dados", () => {
  it("allowlist congelada: só PROFESSIONAL_BRAIN_G2; experimentais permanecem SHADOW", () => {
    expect(Object.isFrozen(REAL_STRATEGY_ALLOWLIST)).toBe(true);
    expect(Object.isFrozen(REAL_STRATEGY_ALLOWLIST.allowed)).toBe(true);
    expect(REAL_STRATEGY_ALLOWLIST.allowed).toEqual(["PROFESSIONAL_BRAIN_G2"]);
    for (const strategy of ["SCENARIO_ENGINE_V3_FROZEN", "AGENT_V4", "LATE_WINDOW_V2", "ALPHA_PACK_V1", "ML_SHADOW", "NEW_PLAYBOOKS_V1"]) {
      expect(REAL_STRATEGY_ALLOWLIST.shadowOnly).toContain(strategy);
      expect(REAL_STRATEGY_ALLOWLIST.allowed).not.toContain(strategy);
    }
  });

  it("entidade marcada em PRACTICE nunca atravessa para REAL (e vice-versa)", () => {
    const trade = stampAccountContext({ tradeId: "t1" }, "PRACTICE");
    expect(trade.accountContext).toBe("PRACTICE");
    expect(() => assertSameAccountContext(trade, "REAL")).toThrowError(/ACCOUNT_CONTEXT_CROSS/);
    expect(() => assertSameAccountContext({ tradeId: "sem-contexto" }, "PRACTICE")).toThrowError(/ACCOUNT_CONTEXT_CROSS/);
    const real = stampAccountContext({ tradeId: "t2" }, "REAL");
    expect(() => assertSameAccountContext(real, "PRACTICE")).toThrowError(/ACCOUNT_CONTEXT_CROSS/);
  });

  it("filterByAccountContext separa journal/PnL e rejeita contexto inválido", () => {
    const rows = [
      { id: 1, accountContext: "PRACTICE" },
      { id: 2, accountContext: "REAL" },
      { id: 3 },
    ];
    expect(filterByAccountContext(rows, "PRACTICE").map((row: any) => row.id)).toEqual([1]);
    expect(filterByAccountContext(rows, "REAL").map((row: any) => row.id)).toEqual([2]);
    expect(() => filterByAccountContext(rows, "DEMO")).toThrowError(/ACCOUNT_CONTEXT_INVALID/);
  });

  it("erro de contexto carrega code estável (AccountContextError)", () => {
    try { assertSameAccountContext({ accountContext: "PRACTICE" }, "REAL"); } catch (error: any) {
      expect(error).toBeInstanceOf(AccountContextError);
      expect(error.code).toBe("ACCOUNT_CONTEXT_CROSS");
    }
  });
});

describe("AUDITORIA REAL", () => {
  it("trilha registra todos os campos obrigatórios por estágio", () => {
    const controller = armedController();
    controller.recordRealAttempt("SEND", {
      strategy: "PROFESSIONAL_BRAIN_G2", agentVersion: "PROFESSIONAL_BRAIN_G2", candidateId: "cand_1", decisionId: "dec_1",
      stake: 2, marketKey: "EURUSD:NORMAL", direction: "BUY", expiry: 1_700_000_060, send: true, ack: null, brokerOrderId: null, settlement: null,
    });
    controller.recordRealAttempt("ACK", { brokerOrderId: "ORD-1", ack: "ACKNOWLEDGED", send: true, marketKey: "EURUSD:NORMAL" });
    controller.recordRealAttempt("SETTLEMENT", { brokerOrderId: "ORD-1", settlement: { result: "WIN", profit: 1.7 } });
    const { audit } = controller.auditTrail(50);
    const send = audit.find((row: any) => row.event === "REAL_SEND");
    const ack = audit.find((row: any) => row.event === "REAL_ACK");
    const settlement = audit.find((row: any) => row.event === "REAL_SETTLEMENT");
    for (const record of [send, ack, settlement]) expect(record).toBeTruthy();
    expect(send).toMatchObject({ accountContext: "REAL", stage: "SEND", strategy: "PROFESSIONAL_BRAIN_G2", agentVersion: "PROFESSIONAL_BRAIN_G2", candidateId: "cand_1", decisionId: "dec_1", stake: 2, marketKey: "EURUSD:NORMAL", direction: "BUY", expiry: 1_700_000_060, send: true });
    expect(ack).toMatchObject({ brokerOrderId: "ORD-1", ack: "ACKNOWLEDGED" });
    expect(settlement).toMatchObject({ settlement: { result: "WIN", profit: 1.7 } });
  });

  it("status/auditoria nunca contém segredo (senha/ssid/token/cookie)", () => {
    const controller = armedController();
    const serialized = JSON.stringify({ status: controller.status(), audit: controller.auditTrail(50) }).toLowerCase();
    for (const forbidden of ["password", "ssid", "cookie", "authorization", "api_key", "apikey", "secret"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Runtime: isolamento por conta nas entidades e snapshots
 * ------------------------------------------------------------------ */

describe("RUNTIME — office isolado por accountContext", () => {
  it("office expõe accountContext e portfolio/journal com byContext separado", () => {
    const runtime = runtimeFixture();
    seedMarket(runtime, "EURUSD:NORMAL");
    runtime.openPositions.set("EURUSD:NORMAL", { marketKey: "EURUSD:NORMAL", accountContext: "REAL", direction: "CALL", stake: 2, entryPrice: 1.1, brokerOrderId: "R-1", openedAt: Date.now() });
    const office = runtime.office();
    expect(office.accountContext.accountContext).toBe("PRACTICE");
    expect(office.accountContext.state).toBe("PRACTICE");
    expect(office.portfolio.accountContext).toBe("PRACTICE");
    expect(office.portfolio.byContext.REAL.openPositions).toBe(1);
    expect(office.portfolio.byContext.PRACTICE.openPositions).toBe(0);
    expect(office.portfolio.openPositions).toHaveLength(0);
    expect(office.portfolio.byContext.REAL.pnl).toBe(0);
    expect(office.journal.accountContext).toBe("PRACTICE");
  });

  it("portfolioSnapshot(context) nunca mistura posições/PnL de contas diferentes", () => {
    const runtime = runtimeFixture();
    runtime.openPositions.set("EURUSD:NORMAL", { marketKey: "EURUSD:NORMAL", accountContext: "REAL", direction: "CALL", stake: 2, entryPrice: 1.1, brokerOrderId: "R-1", openedAt: Date.now() });
    const real = runtime.portfolioSnapshot("REAL");
    const practice = runtime.portfolioSnapshot("PRACTICE");
    expect(real.openPositions).toHaveLength(1);
    expect(real.openPositions[0].accountContext).toBe("REAL");
    expect(practice.openPositions).toHaveLength(0);
    expect(practice.practiceBalance).toBe(10_000);
    expect(practice.realBalance).toBe(500);
  });

  it("runtime.selectAccount(REAL) sem conta acessível mostra erro honesto e não simula saldo", () => {
    const runtime = runtimeFixture();
    runtime.account.real = { available: false, balanceId: null, balance: null, currency: null };
    const state = runtime.selectAccount("REAL");
    expect(state.context).toBe("REAL");
    expect(state.state).toBe("REAL · LOCKED");
    expect(state.realAccount.available).toBe(false);
    expect(state.realAccount.balance).toBeNull();
    expect(state.realExecutionForbidden).toBe(true);
  });

  it("runtime.realPreflight lista checks BLOCK e armReal falha sem conta real", () => {
    const runtime = runtimeFixture();
    runtime.account.real = { available: false, balanceId: null, balance: null, currency: null };
    runtime.selectAccount("REAL");
    const preflight = runtime.realPreflight();
    expect(preflight.ok).toBe(false);
    expect(preflight.state).toBe("BLOCK");
    expect(preflight.blockedBy).toContain("account_accessible");
    expect(() => runtime.armReal({ phrase: PHRASE, acknowledgeRisk: true, maxStake: 2 })).toThrow();
  });

  it("runtime.armReal com tudo pronto fica REAL · ARMED e NUNCA envia ordem", () => {
    const controller = new AccountContextController({ now: () => Date.now(), hardCap: 100, realTradingEnabled: true });
    const runtime = runtimeFixture({ accountContext: controller });
    seedMarket(runtime, "EURUSD:NORMAL");
    runtime.selectAccount("REAL");
    const state = runtime.armReal({ phrase: PHRASE, acknowledgeRisk: true, maxStake: 2 });
    expect(state.state).toBe("REAL · ARMED");
    expect(state.armed).toBe(true);
    expect(state.realExecutionForbidden).toBe(false);
    expect(state.realAccount.balance).toBe(500);
    expect(runtime.__sent).toHaveLength(0);
    const preflight = runtime.realPreflight();
    expect(preflight.ok).toBe(true);
    expect(preflight.state).toBe("PASS");
    runtime.disarmReal("TEST_TEARDOWN");
    expect(runtime.accountContextState().state).toBe("REAL · LOCKED");
    expect(runtime.__sent).toHaveLength(0);
  });

  it("ordem PRACTICE carrega accountContext=PRACTICE na posição (nunca atravessa)", async () => {
    const runtime = runtimeFixture();
    seedMarket(runtime, "EURUSD:NORMAL");
    runtime.arm(2, { confirmation: true });
    const order = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 2, horizonSeconds: 60, idempotencyKey: "k-ctx-practice" });
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    const pending = runtime.pendingOrders.get("EURUSD:NORMAL");
    expect(pending.accountContext).toBe("PRACTICE");
    runtime.ingestEvent("socket-option-opened", { connectionId: "conn-ctx-1", receivedAt: Date.now(), msg: { id: "ORD-P1", active_id: pending.activeId, price: pending.stake, expired: pending.expirationSec } });
    await order;
    expect(runtime.openPositions.get("EURUSD:NORMAL").accountContext).toBe("PRACTICE");
  });

  it("requestOrder REAL permanece BLOCKED por padrão (nenhuma ordem REAL)", async () => {
    const runtime = runtimeFixture();
    seedMarket(runtime, "EURUSD:NORMAL");
    runtime.arm(2, { confirmation: true });
    runtime.realMode.requestConfirmation({ phrase: "OPERAR CONTA REAL", acknowledgeRisk: true, realBalance: 500, realBalanceId: 777, maxStake: 2 });
    runtime.setMode("REAL");
    runtime.arm(2, { confirmation: true });
    await expect(runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 2, horizonSeconds: 60, idempotencyKey: "k-real-blocked" })).rejects.toThrowError(/REAL_GATE_BLOCKED/);
    expect(runtime.__sent).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Entrega: endpoints, UI e migration
 * ------------------------------------------------------------------ */

describe("DELIVERY — endpoints, UI e migration", () => {
  const relaySource = readFileSync(new URL("../../relay/server.mjs", import.meta.url), "utf8");
  const proxySource = readFileSync(new URL("../../api/http.ts", import.meta.url), "utf8");
  const topbarSource = readFileSync(new URL("../../src/http/public/office-v3/topbar.js", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../../src/http/public/office-v3/office-v3.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../relay/migrations/033_practice_real_account_context.sql", import.meta.url), "utf8");

  it("endpoints server-side existem no relay e no proxy Vercel", () => {
    for (const endpoint of ["/api/iq/account/context", "/api/iq/account/select", "/api/iq/real/arm", "/api/iq/real/disarm", "/api/iq/real/preflight"]) {
      expect(relaySource, `relay sem ${endpoint}`).toContain(endpoint);
      expect(proxySource, `proxy sem ${endpoint}`).toContain(endpoint);
    }
  });

  it("relay inclui accountContext em office/executions/signals/journal/audit", () => {
    expect(relaySource).toContain("wsRuntime.accountContextState()");
    expect(relaySource).toContain("wsRuntime.accountContext.context");
    expect(relaySource).toContain("recentExecutions(Number(url.searchParams.get('limit')) || 50, url.searchParams.get('marketKey') || null, url.searchParams.get('accountContext')");
  });

  it("top bar tem o seletor PRACTICE ⇄ REAL e chama os endpoints de conta", () => {
    expect(topbarSource).toContain("PRACTICE ⇄ REAL");
    expect(topbarSource).toContain("/api/iq/account/select");
    expect(topbarSource).toContain("/api/iq/real/arm");
    expect(topbarSource).toContain("/api/iq/real/disarm");
    expect(topbarSource).toContain("CONFIRMAR E ARMAR REAL");
    for (const forbidden of ["/api/iq/test-order", "/api/iq/real/confirm", "placeOrder", "submitOrder", "sendOrder"]) {
      expect(topbarSource.includes(forbidden), `proibido no topbar: ${forbidden}`).toBe(false);
    }
  });

  it("página do Office continua somente leitura (GET) e sem endpoint de ordem", () => {
    expect(pageSource).not.toContain('method: "POST"');
    for (const forbidden of ["/api/iq/test-order", "/api/iq/real/confirm", "/api/iq/mode", "placeOrder"]) {
      expect(pageSource.includes(forbidden), `proibido na página: ${forbidden}`).toBe(false);
    }
  });

  it("migration 033 adiciona account_context e a tabela iq_account_context", () => {
    expect(migration).toContain("ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS account_context");
    expect(migration).toContain("ALTER TABLE iq_audit_trail ADD COLUMN IF NOT EXISTS account_context");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS iq_account_context");
    expect(migration).toContain("real_locked boolean NOT NULL DEFAULT true");
  });
});
