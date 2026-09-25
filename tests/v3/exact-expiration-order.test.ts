/**
 * V3 â€” ALVO EXATO DE EXPIRATION pela fronteira unica (requestOrder) com broker simulado.
 * Prova D/J/I: envia para a MESMA expiration da opportunity em TTE~302, nega desalinhadas,
 * nega TTE<=300 e nunca deixa o "proximo bucket" escolher outra expiration.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const CONNECTION_ID = "conn-v3-exact";
const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const EXP = BASE + 300_000;
const TTE302 = EXP - 302_000;
const TTE299 = EXP - 299_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pool = () => ({ query: async (sql: string) => (sql.includes("to_regclass") ? { rows: [{ table_name: "iq_executions", read_only: "off" }] } : { rows: [], rowCount: 1 }) });

function fixture() {
  let clockMs = TTE302;
  const runtime = new IqMultiRuntime({ pool: pool(), getSsid: () => "FAKE", now: () => clockMs, log: () => {}, ackTimeoutMs: 120 }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: CONNECTION_ID, serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true, connectedAt: clockMs };
  runtime.connection = { connectionId: CONNECTION_ID, host: "ws.iqoption.com", serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "BRL" }, real: { available: true, balanceId: 777, balance: 500, currency: "BRL" }, hasReal: true, checkedAt: clockMs, type: "PRACTICE" };
  runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = null; runtime.config.defaultStake = 2;
  const sent: Array<Record<string, unknown>> = [];
  runtime.client = {
    serverNow: () => clockMs,
    placeOrder: (options: Record<string, unknown>) => {
      sent.push(options);
      queueMicrotask(() => runtime.ingestEvent("socket-option-opened", { connectionId: CONNECTION_ID, receivedAt: clockMs, msg: { id: `ORD-V3-${sent.length}`, active_id: options.activeId, price: options.price, expired: options.expiration } }));
      return options.requestId;
    },
    getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
  };
  const ctx = runtime.markets.get("EURUSD:NORMAL");
  ctx.availability = "OPEN"; ctx.activeId = 76; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 2; ctx.configuredStake = 2;
  for (let index = 1; index <= 5; index += 1) {
    const fromSec = Math.floor((BASE - (5 - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: TTE302, msg: { active_id: 76, size: 5, from: fromSec, to: fromSec + 5, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1 } });
  }
  runtime.arm(2, { confirmation: true });
  return { runtime, sent, setClock: (value: number) => { clockMs = value; } };
}

const v3Order = (overrides: Record<string, unknown> = {}) => ({
  marketKey: "EURUSD:NORMAL",
  direction: "BUY",
  stake: 1,
  horizonSeconds: 300,
  exactExpirationAt: Math.round(EXP / 1000),
  idempotencyKey: `k-v3-${Math.random().toString(36).slice(2)}`,
  source: "intelligence:PULLBACK_4060_300_AGENTIC_V3",
  entryTiming: { candidateId: "cand-v3-1", targetEntryAt: EXP - 330_000, targetExpiryAt: EXP, targetExpirySec: Math.round(EXP / 1000), submitAt: TTE302, revalidatedAt: TTE302 },
  operational: {
    strategyVersion: "PULLBACK_4060_300_AGENTIC_V3", strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3", snapshotHash: "snap-v3", decisionSnapshot: { id: "snap-v3" },
    v3OpportunityId: `EURUSD:NORMAL@${new Date(EXP).toISOString()}`, v3PurchaseDeadlineAt: EXP - 30_000, testOnly: false, excludedFromStats: false,
  },
  ...overrides,
});

describe("V3 exact expiration â€” requestOrder com broker simulado", () => {
  it("envia EXATAMENTE para a expiration da opportunity em TTE=302", async () => {
    const { runtime, sent } = fixture();
    const result = await runtime.requestOrder(v3Order());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.expiration).toBe(Math.round(EXP / 1000));
    expect(result).toMatchObject({ duplicate: false, mode: "PRACTICE", state: "ACKNOWLEDGED" });
  });

  it("TTE<=300 => MISSED_5M_ENTRY_WINDOW e zero placeOrder", async () => {
    const { runtime, sent, setClock } = fixture();
    setClock(TTE299);
    await expect(runtime.requestOrder(v3Order({ entryTiming: { candidateId: "c", targetExpiryAt: EXP, targetExpirySec: Math.round(EXP / 1000), revalidatedAt: TTE299 } }))).rejects.toThrow(/MISSED_5M_ENTRY_WINDOW/);
    expect(sent).toHaveLength(0);
  });

  it("expiration desalinhada (30s/60s) => ENTRY_EXPIRATION_ALIGNMENT", async () => {
    const { runtime, sent } = fixture();
    await expect(runtime.requestOrder(v3Order({ exactExpirationAt: Math.round((EXP + 30_000) / 1000) }))).rejects.toThrow(/ENTRY_EXPIRATION_ALIGNMENT/);
    expect(sent).toHaveLength(0);
  });

  it("sem v3OpportunityId o caminho V2 volta a valer e nega o envio (autoridade V2 recusa TTE=302)", async () => {
    const { runtime, sent } = fixture();
    await expect(runtime.requestOrder(v3Order({ operational: { strategyVersion: "PULLBACK_4060_300_AGENTIC_V2", strategyHash: "sha256:v2", statsEpoch: "e", snapshotHash: null, decisionSnapshot: null, testOnly: false, excludedFromStats: false } }))).rejects.toThrow(/ENTRY_WINDOW_CLOSED|ENTRY_EXPIRATION_MISMATCH/);
    expect(sent).toHaveLength(0);
  });

  it("persiste a expiration exata na linha da execucao (auditoria)", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const spyPool = { query: async (sql: string, params: unknown[] = []) => { queries.push({ sql, params }); return sql.includes("to_regclass") ? { rows: [{ table_name: "iq_executions", read_only: "off" }] } : { rows: [], rowCount: 1 }; } };
    const runtime = new IqMultiRuntime({ pool: spyPool, getSsid: () => null, now: () => TTE302, log: () => {}, ackTimeoutMs: 100 }) as any;
    runtime.session = { connected: true, host: "h", connectionId: CONNECTION_ID, serverTimeMs: TTE302, clockSkewMs: 0, timeValid: true, connectedAt: TTE302 };
    runtime.connection = { connectionId: CONNECTION_ID };
    runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "BRL" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: TTE302, type: "PRACTICE" };
    runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = null; runtime.config.defaultStake = 2;
    runtime.client = { serverNow: () => TTE302, placeOrder: (options: Record<string, unknown>) => { queueMicrotask(() => runtime.ingestEvent("socket-option-opened", { connectionId: CONNECTION_ID, receivedAt: TTE302, msg: { id: "ORD-X", active_id: options.activeId, price: options.price, expired: options.expiration } })); return options.requestId; }, getOptions: async () => ({ response: { msg: {} } }) };
    const ctx = runtime.markets.get("EURUSD:NORMAL");
    ctx.availability = "OPEN"; ctx.activeId = 76; ctx.payout = 85; ctx.enabled = true; ctx.maxStake = 2; ctx.configuredStake = 2;
    for (let index = 1; index <= 5; index += 1) {
      const fromSec = Math.floor((BASE - (5 - index) * 5_000) / 1000);
      runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: TTE302, msg: { active_id: 76, size: 5, from: fromSec, to: fromSec + 5, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1 } });
    }
    runtime.arm(2, { confirmation: true });
    await runtime.requestOrder(v3Order());
    const update = queries.find((entry) => entry.sql.startsWith("UPDATE iq_executions"));
    expect(update).toBeTruthy();
    expect(String(update!.params[15])).toBe(new Date(EXP).toISOString());
  });
});




