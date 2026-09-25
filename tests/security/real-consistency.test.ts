/**
 * A08 â€” CONSISTENCIA REAL: autoridade unica do estado efetivo + caminho REAL completo ate o
 * broker SIMULADO (nunca broker real). Prova:
 *  - identidade REAL = versao operacional congelada (nunca PROFESSIONAL_BRAIN_G2);
 *  - REAL_ORDER_SENT nao lanca ReferenceError (directionAction vs decisionAction);
 *  - revogacao/queda durante o persist => REAL_FAIL_CLOSED sem placeOrder;
 *  - status surfaces (consensusStatus/accountContextState) concordam com effectiveRealState.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const realModule = await import("../../relay/real-mode.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const accountModule = await import("../../relay/account-context.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;
const { REAL_CONFIRMATION_PHRASE } = realModule as unknown as Record<string, any>;
const { REAL_ARM_CONFIRMATION_PHRASE } = accountModule as unknown as Record<string, any>;

const V2 = "PULLBACK_4060_300_AGENTIC_V2";
const CONNECTION_ID = "conn-real-1";
const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const savedRealTrading = process.env.REAL_TRADING_ENABLED;

const durablePool = () => {
  const state = { deferNextUpdate: false, updateStarted: false };
  let releaseUpdate: (() => void) | null = null;
  return {
    state,
    releaseUpdate: () => { releaseUpdate?.(); releaseUpdate = null; },
    waitForUpdate: async () => { for (let index = 0; index < 400; index += 1) { if (state.updateStarted) return; await sleep(5); } throw new Error("UPDATE_NEVER_STARTED"); },
    query: async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }], rowCount: 1 };
      if (sql.startsWith("UPDATE iq_executions")) {
        state.updateStarted = true;
        if (state.deferNextUpdate) { state.deferNextUpdate = false; await new Promise<void>((resolve) => { releaseUpdate = resolve; }); }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
};

function seedMarket(runtime: any) {
  const ctx = runtime.markets.get("EURUSD:NORMAL");
  ctx.availability = "OPEN"; ctx.activeId = 76; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 2;
  for (let index = 1; index <= 5; index += 1) {
    const fromSec = Math.floor((BASE - (5 - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: BASE + 60_000, msg: { active_id: 76, size: 5, from: fromSec, to: fromSec + 5, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1 } });
  }
  return ctx;
}

function realFixture() {
  let clockMs = BASE + 60_000;
  const pool = durablePool();
  const runtime = new IqMultiRuntime({ pool, getSsid: () => "FAKE_SSID", now: () => clockMs, log: () => {}, ackTimeoutMs: 120 }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: CONNECTION_ID, serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true, connectedAt: clockMs };
  runtime.connection = { connectionId: CONNECTION_ID, host: "ws.iqoption.com", serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "BRL" }, real: { available: true, balanceId: 777, balance: 500, currency: "BRL" }, hasReal: true, checkedAt: clockMs, type: "PRACTICE" };
  runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = 1;
  const sent: Array<Record<string, unknown>> = [];
  runtime.client = {
    serverNow: () => clockMs,
    placeOrder: (options: Record<string, unknown>) => {
      sent.push(options);
      queueMicrotask(() => runtime.ingestEvent("socket-option-opened", { connectionId: CONNECTION_ID, receivedAt: clockMs, msg: { id: `ORD-REAL-${sent.length}`, active_id: options.activeId, price: options.price, expired: options.expiration } }));
      return options.requestId;
    },
    getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
  };
  seedMarket(runtime);
  runtime.realMode.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: true, realBalance: 500, realBalanceId: 777, maxStake: 2 });
  runtime.setMode("REAL");
  runtime.selectAccount("REAL");
  runtime.armReal({ phrase: REAL_ARM_CONFIRMATION_PHRASE, acknowledgeRisk: true, maxStake: 2 });
  return { runtime, pool, sent };
}

const realOrder = () => ({
  marketKey: "EURUSD:NORMAL",
  direction: "BUY",
  stake: 1,
  horizonSeconds: 300,
  idempotencyKey: `k-real-${Math.random().toString(36).slice(2)}`,
  source: `intelligence:${V2}`,
  entryTiming: { candidateId: "cand-real-1", targetEntryAt: BASE + 60_000, targetExpiryAt: BASE + 300_000, targetExpirySec: (BASE + 300_000) / 1000, submitAt: BASE + 60_000, revalidatedAt: BASE + 60_000 },
  operational: { strategyVersion: V2, strategyHash: "sha256:test", statsEpoch: "epoch-1", snapshotHash: "snap-real-1", decisionSnapshot: { id: "snap-real-1" }, testOnly: false, excludedFromStats: false },
});

beforeEach(() => { process.env.REAL_TRADING_ENABLED = "true"; });
afterEach(() => { if (savedRealTrading === undefined) delete process.env.REAL_TRADING_ENABLED; else process.env.REAL_TRADING_ENABLED = savedRealTrading; });

describe("A08 â€” caminho REAL completo (broker simulado)", () => {
  it("effectiveRealState ARMED e status surfaces concordam (autoridade unica)", () => {
    const { runtime } = realFixture();
    const real = runtime.effectiveRealState();
    expect(real.armed).toBe(true);
    expect(real.state).toBe("ARMED");
    expect(real.reasons).toEqual([]);
    expect(real.strategy).toBe(V2);
    expect(runtime.accountContextState().realExecutionForbidden).toBe(false);
    expect(runtime.consensusStatus().context.realState).toBe("ARMED");
    runtime.disarmReal("TEST");
    const locked = runtime.effectiveRealState();
    expect(locked.armed).toBe(false);
    expect(locked.state).toBe("LOCKED");
    expect(locked.reasons).toContain("ACCOUNT_NOT_ARMED");
    expect(runtime.accountContextState().realExecutionForbidden).toBe(true);
    expect(runtime.consensusStatus().context.realState).toBe("LOCKED");
  });

  it("ordem REAL chega ao broker SIMULADO com identidade congelada e sem ReferenceError", async () => {
    const { runtime, sent } = realFixture();
    expect(runtime.accountContext.armedMeta.strategy).toBe(V2);
    const result = await runtime.requestOrder(realOrder());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ price: 1, activeId: 76, balanceId: 777, direction: "CALL" });
    expect(result).toMatchObject({ duplicate: false, mode: "REAL", state: "ACKNOWLEDGED" });
    expect(runtime.openPositions.size).toBe(1);
  });

  it("revogacao da sessao REAL durante o persist => REAL_FAIL_CLOSED, zero placeOrder", async () => {
    const { runtime, pool, sent } = realFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(realOrder());
    await pool.waitForUpdate();
    runtime.realMode.revoke("TEST_INTERLEAVE");
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/REAL_FAIL_CLOSED/);
    expect(sent).toHaveLength(0);
    expect(runtime.openPositions.size).toBe(0);
    expect(runtime.pendingOrders.size).toBe(0);
  });

  it("REAL_TRADING_ENABLED=false bloqueia envio (zero placeOrder)", async () => {
    const { runtime, sent } = realFixture();
    delete process.env.REAL_TRADING_ENABLED;
    await expect(runtime.requestOrder(realOrder())).rejects.toThrow(/PORTFOLIO_GATE_MODE_VALID|REAL_GATE_BLOCKED|REAL_FAIL_CLOSED/);
    expect(sent).toHaveLength(0);
  });
});

