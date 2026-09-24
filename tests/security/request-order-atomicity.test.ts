/**
 * A03/A09 — ATOMICIDADE PRE-SOCKET E PERSISTENCIA FAIL-CLOSED.
 *
 * Prova, com o requestOrder ORIGINAL e um broker/pool simulados, que:
 *  - a intencao precisa ficar DURAVEL antes do socket (persist drop/falha => zero placeOrder);
 *  - a revalidacao final acontece DEPOIS do ultimo await e IMEDIATAMENTE antes do
 *    placeOrder (disarm/kill-switch/WS-drop/deadline/lock durante o persist => zero placeOrder);
 *  - o estado final fica consistente (sem posicao fantasma, sem pending orfao).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const CONNECTION_ID = "conn-atomic-1";
const FAKE_SSID = "FAKE_SSID_NEVER_LEAK_ATOMIC_1234567890";
const KEY = "EURUSD:NORMAL";
const BASE = Date.UTC(2026, 8, 23, 12, 0, 0);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createPool() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const state = { deferNextUpdate: false, dropUpdates: false, failUpdates: false, updateStarted: false };
  let releaseUpdate: (() => void) | null = null;
  const pool: Record<string, any> = {
    calls,
    state,
    releaseUpdate: () => { releaseUpdate?.(); releaseUpdate = null; },
    waitForUpdate: async () => {
      for (let index = 0; index < 400; index += 1) { if (state.updateStarted) return; await sleep(5); }
      throw new Error("UPDATE_NEVER_STARTED");
    },
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }], rowCount: 1 };
      if (sql.startsWith("UPDATE iq_executions")) {
        state.updateStarted = true;
        if (state.failUpdates) throw new Error("DB_DOWN");
        if (state.dropUpdates) return { rows: [], dropped: true, reason: "CRITICAL_QUEUE_FULL" };
        if (state.deferNextUpdate) { state.deferNextUpdate = false; await new Promise<void>((resolve) => { releaseUpdate = resolve; }); }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return pool;
}

function seedMarket(runtime: any, { activeId = 101, close = 1.1, payout = 85, candles = 5 } = {}) {
  const ctx = runtime.markets.get(KEY);
  ctx.availability = "OPEN"; ctx.activeId = activeId; ctx.payout = payout; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 2; ctx.configuredStake = 2;
  const base = Math.floor(BASE / 5_000) * 5_000;
  for (let index = 1; index <= candles; index += 1) {
    const fromSec = Math.floor((base - (candles - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: BASE + 60_000, msg: { active_id: activeId, size: 5, from: fromSec, to: fromSec + 5, open: close, high: close + 0.0001, low: close - 0.0001, close: Number((close + index * 0.00001).toFixed(6)) } });
  }
  return ctx;
}

function atomicFixture({ pool = createPool() }: { pool?: Record<string, any> | null } = {}) {
  let clockMs = BASE + 60_000;
  const runtime = new IqMultiRuntime({ pool, getSsid: () => FAKE_SSID, now: () => clockMs, log: () => {}, ackTimeoutMs: 120 }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: CONNECTION_ID, serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true, connectedAt: clockMs };
  runtime.connection = { connectionId: CONNECTION_ID, host: "ws.iqoption.com", serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: true, balanceId: 777, balance: 500, currency: "USD" }, hasReal: true, checkedAt: clockMs, type: "PRACTICE" };
  runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = null; runtime.config.defaultStake = 2;
  const sent: Array<Record<string, unknown>> = [];
  runtime.client = {
    serverNow: () => clockMs,
    placeOrder: (options: Record<string, unknown>) => {
      sent.push(options);
      queueMicrotask(() => runtime.ingestEvent("socket-option-opened", { connectionId: CONNECTION_ID, receivedAt: clockMs, msg: { id: `ORD-${sent.length}`, active_id: options.activeId, price: options.price, expired: options.expiration } }));
      return options.requestId;
    },
    getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
  };
  seedMarket(runtime);
  runtime.arm(2, { confirmation: true });
  return { runtime, pool: pool as Record<string, any>, sent, setClock: (value: number) => { clockMs = value; } };
}

const operationalOrder = (overrides: Record<string, unknown> = {}) => ({
  marketKey: KEY,
  direction: "BUY",
  stake: 1,
  horizonSeconds: 300,
  idempotencyKey: `k-atomic-${Math.random().toString(36).slice(2)}`,
  source: "intelligence:PULLBACK_4060_300_AGENTIC_V2",
  entryTiming: { candidateId: "cand-atomic-1", targetEntryAt: BASE + 60_000, targetExpiryAt: BASE + 300_000, targetExpirySec: (BASE + 300_000) / 1000, submitAt: BASE + 60_000, revalidatedAt: BASE + 60_000 },
  operational: { strategyVersion: "PULLBACK_4060_300_AGENTIC_V2", strategyHash: "sha256:test", statsEpoch: "epoch-1", snapshotHash: "snap-1", decisionSnapshot: { id: "snap-1" }, testOnly: false, excludedFromStats: false },
  ...overrides,
});

describe("A03 — interleaving durante o persist: NENHUM placeOrder", () => {
  it("Caso A: DISARM entre o persist e o socket => EXECUTION_NOT_ARMED, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(operationalOrder());
    await pool.waitForUpdate();
    runtime.disarm("TEST_INTERLEAVE");
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/EXECUTION_NOT_ARMED/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
    expect(runtime.openPositions.size).toBe(0);
  });

  it("Caso B: KILL SWITCH durante o persist => KILL_SWITCH_ENGAGED, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(operationalOrder());
    await pool.waitForUpdate();
    runtime.killSwitch.engage();
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/KILL_SWITCH_ENGAGED/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
  });

  it("Caso C: WS cai durante o persist => BROKER_NOT_READY, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(operationalOrder());
    await pool.waitForUpdate();
    runtime.session.connected = false;
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/BROKER_NOT_READY/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
  });

  it("Caso D: relogio passa do deadline durante o persist => ENTRY_WINDOW_CLOSED, zero placeOrder", async () => {
    const { runtime, pool, sent, setClock } = atomicFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(operationalOrder());
    await pool.waitForUpdate();
    setClock(BASE + 295_000);
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/ENTRY_WINDOW_CLOSED/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
  });

  it("Caso E: lock do ativo removido durante o persist => ORDER_LOCK_LOST, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.deferNextUpdate = true;
    const promise = runtime.requestOrder(operationalOrder());
    await pool.waitForUpdate();
    runtime.pendingOrders.delete(KEY);
    pool.releaseUpdate();
    await expect(promise).rejects.toThrow(/ORDER_LOCK_LOST/);
    expect(sent).toHaveLength(0);
    expect(runtime.openPositions.size).toBe(0);
  });
});

describe("A09 — persistencia fail-closed: sem intencao duravel nao existe ordem", () => {
  it("Caso F: UPDATE dropado (CRITICAL_QUEUE_FULL) => PERSISTENCE_REQUIRED_FAILED, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.dropUpdates = true;
    await expect(runtime.requestOrder(operationalOrder())).rejects.toThrow(/PERSISTENCE_REQUIRED_FAILED/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
    expect(runtime.openPositions.size).toBe(0);
  });

  it("Caso G: banco indisponivel durante o persist => PERSISTENCE_REQUIRED_FAILED, zero placeOrder", async () => {
    const { runtime, pool, sent } = atomicFixture();
    pool.state.failUpdates = true;
    await expect(runtime.requestOrder(operationalOrder())).rejects.toThrow(/PERSISTENCE_REQUIRED_FAILED/);
    expect(sent).toHaveLength(0);
    expect(runtime.pendingOrders.size).toBe(0);
    expect(runtime.openPositions.size).toBe(0);
  });

  it("Caso G2: sem pool (DB ausente) => PERSISTENCE_REQUIRED_FAILED, zero placeOrder", async () => {
    const { runtime, sent } = atomicFixture({ pool: null });
    await expect(runtime.requestOrder(operationalOrder())).rejects.toThrow(/PERSISTENCE_REQUIRED_FAILED/);
    expect(sent).toHaveLength(0);
  });

  it("Caso H: persist OK + revalidacao OK => exatamente 1 placeOrder e ACK resolve", async () => {
    const { runtime, sent } = atomicFixture();
    const result = await runtime.requestOrder(operationalOrder());
    expect(sent).toHaveLength(1);
    expect(result).toMatchObject({ duplicate: false, state: "ACKNOWLEDGED", mode: "PRACTICE" });
    expect(runtime.pendingOrders.size).toBe(0);
    expect(runtime.openPositions.size).toBe(1);
  });
});
