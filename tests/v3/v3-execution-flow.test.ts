/**
 * FLUXO V3 â†’ ORDEM (separacao V3/V2):
 * - ordem via V3_CONSENSUS preserva o VENCIMENTO EXATO da opportunity e o stake R$2 configurado;
 * - sem aprovacao do Consensus (v3Approved), o fluxo nao envia nada pelo caminho V2.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as any;

const KEY = "EURUSD:NORMAL";
import { ALIGNED_BASE } from "./fixtures";
const BASE = ALIGNED_BASE;
const EXACT = ALIGNED_BASE + 300_000;
const CONNECTION_ID = "conn-v3-flow";

function harness() {
  let clockMs = BASE + 60_000;
  const pool = {
    query: async (sql: string, _params: unknown[] = []) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const runtime = new IqMultiRuntime({ pool, getSsid: () => "ssid-test", now: () => clockMs, log: () => {}, ackTimeoutMs: 120, autoExecute: true }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: CONNECTION_ID, serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true, connectedAt: clockMs };
  runtime.connection = { connectionId: CONNECTION_ID, host: "ws.iqoption.com", serverTimeMs: clockMs, clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: "USD" }, hasReal: false, checkedAt: clockMs, type: "PRACTICE" };
  runtime.config.autoExecute = true; runtime.config.globalMaxStake = 100; runtime.config.calculatedBankrollStake = null; runtime.config.defaultStake = 2;
  runtime.agentExecBinary = true;
  const sent: Array<Record<string, unknown>> = [];
  runtime.client = {
    serverNow: () => clockMs,
    placeOrder: (options: Record<string, unknown>) => { sent.push(options); return "ORD-1"; },
    getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
  };
  const ctx = runtime.markets.get(KEY);
  ctx.availability = "OPEN"; ctx.activeId = 101; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.marketType = "NORMAL"; ctx.maxStake = 100; ctx.configuredStake = 2;
  const base = Math.floor(BASE / 5_000) * 5_000;
  for (let index = 1; index <= 6; index += 1) {
    const fromSec = Math.floor((base - (6 - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: BASE + 60_000, msg: { active_id: 101, size: 5, from: fromSec, to: fromSec + 5, open: 1.1, high: 1.1001, low: 1.0999, close: Number((1.1 + index * 0.00001).toFixed(6)) } });
  }
  runtime.arm(2, { confirmation: true });
  return { runtime, sent, setClock: (value: number) => { clockMs = value; } };
}

describe("V3 â†’ ordem (separacao V3/V2)", () => {
  it("ordem V3_CONSENSUS usa o VENCIMENTO EXATO da opportunity e o stake R$2 configurado", async () => {
    const { runtime, sent } = harness();
    await runtime.requestOrder({ marketKey: KEY, direction: "BUY", stake: 2, decisionId: `${KEY}@${EXACT}`, exactExpirationAt: EXACT, source: "V3_CONSENSUS", v3Approved: true });
    expect(sent.length).toBe(1);
    expect(sent[0]!.expiration).toBe(EXACT);
    expect(sent[0]!.price).toBe(2);
  });

  it("stake do config (R$2) e usado quando nao ha override; nunca cai para R$1", async () => {
    const { runtime, sent } = harness();
    await runtime.requestOrder({ marketKey: KEY, direction: "SELL", decisionId: `${KEY}@${EXACT}`, exactExpirationAt: EXACT, source: "V3_CONSENSUS", v3Approved: true });
    expect(sent[0]!.price).toBe(2);
    expect(sent[0]!.price).not.toBe(1);
  });
});





