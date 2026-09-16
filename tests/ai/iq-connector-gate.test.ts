/** Adversarial — hard cap R$100, ARM/DISARM, moeda, execution gate (WAIT nunca opera). */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const connector = await import("../../relay/iqoption-connector.mjs");
const { ConnectorError, ExecutionArmState, IdempotencyStore, KillSwitch, MAX_PRACTICE_STAKE_BRL, executionGate, resolveStakeLimit } = connector as unknown as Record<string, any>;

const runtime = (overrides: Record<string, unknown> = {}) => ({ userLimitBrl: 20, idempotency: new IdempotencyStore(), killSwitch: new KillSwitch(), expectedAsset: "EUR/USD", ...overrides });
const request = (overrides: Record<string, unknown> = {}) => ({ action: "BUY", stake: 5, decisionId: "d1", asset: "EUR/USD", horizonSeconds: 60, decisionAgeMs: 1_000, marketOpen: true, idempotencyKey: `k-${Math.random().toString(36).slice(2, 8)}`, ...overrides });

describe("HARD CAP R$100 — configuracao nunca excede, payload adulterado nunca passa", () => {
  it("MAX_PRACTICE_STAKE_BRL = 100 e clamp de limite do usuario", () => {
    expect(MAX_PRACTICE_STAKE_BRL).toBe(100);
    expect(resolveStakeLimit(10_000)).toMatchObject({ userLimitBrl: 100, effective: 100 });
    expect(resolveStakeLimit(50)).toMatchObject({ userLimitBrl: 50, effective: 50 });
  });
  it("stake acima do hard cap no gate → rejeitado (mesmo armed)", () => {
    const armState = new ExecutionArmState();
    armState.onConnected("PRACTICE"); armState.onMarketData(true); armState.arm(100, { explicitConfirmation: true });
    let thrown: unknown = null; try { executionGate(request({ stake: 101 }), runtime({ armState, userLimitBrl: 100 })); } catch (error) { thrown = error; }
    expect(String((thrown as { message?: string })?.message ?? "")).toMatch(/USER_LIMIT_EXCEEDED|STAKE_CAP_EXCEEDED/);
  });
});

describe("MOEDA — nunca converte em silencio", () => {
  it("broker em USD sem FX → CURRENCY_LIMIT_UNRESOLVED; com FX explicito → efetivo convertido", () => {
    expect(() => resolveStakeLimit(50, { brokerCurrency: "USD" })).toThrowError(/CURRENCY_LIMIT_UNRESOLVED/);
    expect(resolveStakeLimit(50, { brokerCurrency: "USD", fxToBrokerCurrency: 0.2 })).toMatchObject({ effective: 10, rate: 0.2 });
  });
});

describe("ARM/DISARM — conectar nao e operar", () => {
  it("pre-condicoes + confirmacao explicita + auto-disarm", () => {
    const armState = new ExecutionArmState();
    expect(() => armState.arm(20, { explicitConfirmation: true })).toThrowError(/ARM_PRECONDITIONS_NOT_MET/);
    armState.onConnected("PRACTICE");
    expect(() => armState.arm(20, { explicitConfirmation: true })).toThrowError(/ARM_PRECONDITIONS_NOT_MET/);
    armState.onMarketData(true);
    expect(() => armState.arm(20, {})).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED/);
    expect(armState.arm(20, { explicitConfirmation: true })).toMatchObject({ armed: true, state: "ARMED" });
    expect(() => executionGate(request(), runtime({ armState }))).not.toThrow();
    armState.onMarketData(false);
    expect(armState.snapshot()).toMatchObject({ armed: false, disarmReason: "MARKET_DATA_UNHEALTHY" });
    expect(() => executionGate(request(), runtime({ armState }))).toThrowError(/EXECUTION_NOT_ARMED/);
    expect(armState.onDisconnected()).toMatchObject({ state: "DISCONNECTED", armed: false, connectedAccountType: null });
  });
  it("conta REAL nunca arma nem executa", () => {
    const armState = new ExecutionArmState();
    expect(() => armState.onConnected("REAL")).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
  });
});

describe("EXECUTION GATE — WAIT/UNAVAILABLE/STALE nunca criam ordem", () => {
  const armed = () => { const armState = new ExecutionArmState(); armState.onConnected("PRACTICE"); armState.onMarketData(true); armState.arm(20, { explicitConfirmation: true }); return armState; };
  it("WAIT, UNAVAILABLE e STALE bloqueados; BUY→CALL e SELL→PUT aceitos", () => {
    const armState = armed();
    expect(() => executionGate(request({ action: "WAIT" }), runtime({ armState }))).toThrowError(/WAIT_NEVER_EXECUTES/);
    expect(() => executionGate(request({ action: "UNAVAILABLE" }), runtime({ armState }))).toThrowError(/DECISION_NOT_EXECUTABLE/);
    expect(() => executionGate(request({ action: "STALE" }), runtime({ armState }))).toThrowError(/DECISION_NOT_EXECUTABLE/);
    expect(executionGate(request({ action: "BUY" }), runtime({ armState })).direction).toBe("CALL");
    expect(executionGate(request({ action: "SELL" }), runtime({ armState })).direction).toBe("PUT");
  });
  it("limite do usuario, stale decision e idempotencia no gate", () => {
    const armState = armed();
    expect(() => executionGate(request({ stake: 50 }), runtime({ armState }))).toThrowError(/USER_LIMIT_EXCEEDED/);
    expect(() => executionGate(request({ decisionAgeMs: 60_000 }), runtime({ armState }))).toThrowError(/STALE_DECISION/);
    const ctx = runtime({ armState });
    const key = request({ idempotencyKey: "same-key" });
    expect(executionGate(key, ctx).duplicate).toBe(false);
    expect(executionGate(key, ctx).duplicate).toBe(true);
  });
});
