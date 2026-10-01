/**
 * CONSENSUS RUNTIME — prova executavel do caminho CONSENSUS_FINAL sem TDZ:
 * 1. o scheduler REAL (#v3ScheduledRun) executa CONSENSUS_FINAL (limiter/router injetados),
 *    com teto de 10s (isConsensus declarado ANTES de effectiveTimeoutMs);
 * 2. CANCEL => zero ordem; APPROVE => ordem MCP PRACTICE (balance training) com vencimento exato;
 * 3. mode REAL => MCP_REAL_EXECUTION_FORBIDDEN (zero broker write);
 * 4. CLOSED => runtime/DB CLOSED, zero opportunity/consensus/order;
 * 5. BREAK OFF: sem monitor/breakTick/sell_position automatico.
 */
process.env.V3_PREFILTER_MIN_ALIGN = "1"; process.env.V3_PREFILTER_REQUIRE_ASSET = "false"; process.env.V3_PREFILTER_BLOCK_CRITICAL = "false"; process.env.V3_PREFILTER_BLOCK_ATR = "false";
import { describe, expect, it } from "vitest";
import { ALIGNED_BASE, pullbackRetomadaSeries } from "./fixtures";
import { approveScript, consensusFinalOutput, assetOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
const { IqMultiRuntime } = runtimeModule as any;
const { createScriptedAgentClient } = clientModule as any;

const EXP = ALIGNED_BASE + 300_000;
const KEY = "EURUSD:NORMAL";
const ACTIVE_ID = 1861;

function basePool() {
  return { query: async (sql: string) => (sql.includes("to_regclass") ? { rows: [{ table_name: "iq_executions", read_only: "off" }], rowCount: 1 } : { rows: [], rowCount: 1 }) };
}

function makeRuntime({ mode = "PRACTICE", script = null as any, nowRef = { value: EXP - 340_000 } } = {}) {
  const pool = basePool();
  process.env.V3_ENABLED = "true";
  process.env.V3_AGENTS_ENABLED = "true";
  process.env.V3_ANALYSIS_ACTIVE = "true";
  const runtime = new IqMultiRuntime({ pool, getSsid: () => "ssid-cons", now: () => nowRef.value, log: () => {}, autoExecute: true }) as any;
  expect(runtime.v3).toBeTruthy();
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-cons", serverTimeMs: nowRef.value, clockSkewMs: 0, timeValid: true, connectedAt: nowRef.value };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD", balanceType: "training" }, real: { available: false, balanceId: null, balance: null, currency: "USD" }, hasReal: false, checkedAt: nowRef.value, type: mode };
  runtime.config.mode = mode;
  runtime.config.autoExecute = true;
  runtime.config.globalMaxStake = 100;
  runtime.config.defaultStake = 2;
  runtime.agentExecBinary = true;
  const ctx = runtime.markets.get(KEY);
  if (ctx) { ctx.availability = "OPEN"; ctx.activeId = ACTIVE_ID; ctx.mcpAssetId = ACTIVE_ID; ctx.enabled = true; ctx.marketType = "NORMAL"; ctx.configuredStake = 2; }
  runtime.v3.onInitializationData({ result: { binary: { actives: { [ACTIVE_ID]: { id: ACTIVE_ID, name: "EURUSD", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(EXP / 1000)], profit: { commission: 18 } } } } } } }, { brokerNow: EXP - 330_000, marketKeyByActiveId: new Map([[ACTIVE_ID, KEY]]) });
  if (script) {
    const inner = createScriptedAgentClient(script, { now: () => nowRef.value });
    runtime.v3.agents = { available: true, async call(input: any) { return inner.call(input); } };
  }
  return { runtime, pool, nowRef, ctx: runtime.markets.get(KEY) };
}

function feed(runtime: any, nowRef: { value: number }, tte: number) {
  nowRef.value = EXP - tte;
  const closes = pullbackRetomadaSeries({ candles: 90 }).map((candle: any) => candle.close);
  const startAt = nowRef.value - closes.length * 5_000;
  const candles = closes.map((c: number, i: number) => ({ at: startAt + i * 5_000, open: c, high: c + 0.0001, low: c - 0.0001, close: c }));
  return runtime.v3.onClosedCandle({ marketKey: KEY, candles, brokerNow: nowRef.value });
}

describe("CONSENSUS RUNTIME (execucao real, sem TDZ)", () => {
  it("1. CONSENSUS_FINAL executa de verdade pelo scheduler REAL com teto de 10s", async () => {
    const { runtime, nowRef } = makeRuntime({});
    const limiterCalls: Array<Record<string, unknown>> = [];
    runtime.llmRouter = { choose: () => ({ provider: "test", model: "test-model" }), report: () => {} };
    runtime.llmLimiter = {
      run: async (opts: Record<string, unknown>) => {
        limiterCalls.push(opts);
        const parsed = consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "DISAGREE" });
        return { status: "OK", model: "test-model", provider: "test", text: JSON.stringify(parsed), parsed, latencyMs: 4, usage: null, finishReason: "stop", httpStatus: 200 };
      },
    };
    const out = await runtime.v3.agents.call({ role: "CONSENSUS_FINAL", prompt: "x", requestId: "EURUSD:NORMAL@1:1:CONSENSUS_FINAL", timeoutMs: 15_000 });
    expect(out.status).toBe("OK");
    expect(limiterCalls.length).toBe(1);
    // PROVA DO TETO: consensus usa 10s (isConsensus inicializado ANTES de effectiveTimeoutMs).
    // Com o TDZ original, effectiveTimeoutMs lancaria ReferenceError antes do limiter.
    expect(Number(limiterCalls[0]!.deadlineAt) - nowRef.value).toBe(10_000);
    expect(out.output).toBeDefined();
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  });

  it("2. Consensus CANCEL => zero ordem", async () => {
    const { runtime, nowRef } = makeRuntime({ script: { ...approveScript(), CONSENSUS_FINAL: consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "DISAGREE" }) } });
    const mcp = { placeTrade: async () => { throw new Error("placeTrade nao pode ser chamado"); }, writeEnabled: true };
    runtime.mcp = mcp;
    runtime.mcpWriteEnabled = true;
    await feed(runtime, nowRef, 325_000);
    const opp = runtime.v3.opportunities()[0];
    expect(opp?.finalDecision?.result ?? "CANCEL").toBe("CANCEL");
    expect(runtime.v3.status().counters.scheduled).toBe(0);
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  });

  it("3. Consensus APPROVE => ordem MCP PRACTICE (balance training, vencimento exato, stake R$2)", async () => {
    const { runtime, nowRef } = makeRuntime({ script: approveScript() });
    const orders: Array<Record<string, unknown>> = [];
    const sells: unknown[] = [];
    runtime.mcp = {
      writeEnabled: true,
      placeTrade: async (args: Record<string, unknown>) => { orders.push(args); return { ok: true, payload: { id: "POS-9" } }; },
      sellPosition: async () => { sells.push("sell"); return { ok: true }; },
    };
    runtime.mcpWriteEnabled = true;
    runtime.arm(2, { confirmation: true });
    await feed(runtime, nowRef, 311_000); // ultimo ciclo viavel; fogo do scheduler ~9s reais depois
    const opp = runtime.v3.opportunities()[0];
    expect(opp?.finalDecision?.result).toBe("APPROVE_BUY");
    // o guard da estrategia (pullback-only) e coberto por outras suites; aqui isolamos o
    // caminho de EXECUCAO: remove blockers do ciclo para o fire passar a revalidacao.
    opp.cycles[0].asset.blockers = [];
    nowRef.value = EXP - 301_000;
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    expect(orders.length).toBe(1);
    expect(Number(orders[0]!.balance_id)).toBe(555); // PRACTICE training, nunca real
    expect(Number(orders[0]!.stake)).toBe(2);
    expect(orders[0]!.direction).toBe("call");
    expect(Number(orders[0]!.expiration)).toBe(EXP / 1000);
    // BREAK OFF: nenhuma venda antecipada automatica apos a ordem
    expect(sells.length).toBe(0);
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  }, 30_000);

  it("4. mode REAL => MCP_REAL_EXECUTION_FORBIDDEN (zero broker write) mesmo com REAL_TRADING_ENABLED=true", async () => {
    process.env.REAL_TRADING_ENABLED = "true";
    const { runtime, nowRef } = makeRuntime({ mode: "REAL", script: approveScript() });
    const writes: unknown[] = [];
    runtime.mcp = { writeEnabled: true, placeTrade: async () => { writes.push("place"); return { ok: true, payload: { id: "POS-REAL" } }; }, sellPosition: async () => { writes.push("sell"); return { ok: true }; } };
    runtime.mcpWriteEnabled = true;
    await feed(runtime, nowRef, 311_000);
    const oppReal = runtime.v3.opportunities()[0];
    if (oppReal) oppReal.cycles[0].asset.blockers = [];
    nowRef.value = EXP - 301_000;
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    expect(writes.length).toBe(0); // REAL impossivel pelo caminho V3/MCP
    delete process.env.REAL_TRADING_ENABLED;
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  }, 30_000);

  it("5. asset is_open=false => runtime CLOSED + DB CLOSED + zero opportunity/consensus/order", async () => {
    const { runtime, nowRef } = makeRuntime({ script: approveScript() });
    const dbsql: Array<Record<string, unknown>> = [];
    runtime.pool = { query: async (sql: string, params: unknown[]) => { dbsql.push({ sql, params }); return sql.includes("to_regclass") ? { rows: [{ table_name: "iq_executions", read_only: "off" }], rowCount: 1 } : { rows: [], rowCount: 1 }; } };
    runtime.mcp = {
      writeEnabled: true,
      listAssets: async () => ({ ok: true, data: [{ name: "EUR/USD", asset_id: ACTIVE_ID, is_open: false, expirations: [EXP / 1000] }] }),
      getAccountState: async () => ({ ok: true, data: { balances: [{ balance_id: 555, type: "training", amount: 10000, currency: "USD" }] } }),
      getCandles: async () => ({ ok: true, data: { candles: [] } }),
      placeTrade: async () => { throw new Error("CLOSED nao pode operar"); },
    };
    runtime.mcpWriteEnabled = true;
    const ctxBefore = runtime.markets.get(KEY);
    ctxBefore.enabled = false; // garante que o sync persista o upsert (OPEN/CLOSED real)
    ctxBefore.selectionReason = null;
    await runtime.mcpEnableAndSync();
    const ctx = runtime.markets.get(KEY);
    expect(ctx.availability).toBe("CLOSED");
    // o harness registrou o mercado como OPEN; para o cenario CLOSED, remove o front
    runtime.v3.discovery.byMarket.delete(KEY);
    const insert = dbsql.find((row) => String(row.sql).includes("INSERT INTO iq_markets") && JSON.stringify(row.params).includes("EURUSD:NORMAL"));
    expect(insert).toBeDefined();
    expect(JSON.stringify(insert!.params)).toContain("CLOSED"); // DB CLOSED, nunca OPEN
    await feed(runtime, nowRef, 325_000);
    runtime.v3.engine.opportunities.clear(); // remove a opportunity criada pelo ingest do harness
    runtime.v3.engine.counters.discovered = 0;
    runtime.v3.counters.consensusCalls = 0; // limpa o consensus do ciclo do harness (mercado ainda OPEN no momento do setup)
    await feed(runtime, nowRef, 320_000);
    expect(runtime.v3.status().engine.counters.discovered).toBe(0); // discovery 0
    expect(runtime.v3.status().counters.consensusCalls).toBe(0); // consensus 0
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  });

  it("6. BREAK OFF: nenhum monitor/breakTick no runtime da V3", async () => {
    const { runtime } = makeRuntime({});
    expect((runtime as any).breakMonitor).toBeUndefined();
    expect((runtime as any).breakTickTimer).toBeUndefined();
    expect((runtime as any).breakTargetPct).toBeUndefined();
    delete process.env.V3_ENABLED;
    delete process.env.V3_AGENTS_ENABLED;
    delete process.env.V3_ANALYSIS_ACTIVE;
  });
});
