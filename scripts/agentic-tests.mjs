/** AGENTIC RSI+FIB — testes pre-T0 (mesmo snapshot, gatilho 70/30, consenso, isolamento, PRACTICE-only). */
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { runAgentGraph, agentGraphToStrategyResult, AGENTIC_STRATEGY_ID } from "../relay/agents/graph.mjs";
import { LabRunner } from "../relay/lab/runner.mjs";
import { LabStore } from "../relay/lab/store.mjs";

const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, name, ok: ok === true }); console.log(`${ok ? "PASS" : "FAIL"} ${String(id).padStart(2, "0")} ${name}${detail ? " :: " + detail : ""}`); };

const STEP_MS = 5000; const START_MS = Date.parse("2026-09-20T12:00:00Z"); const base = 1.1; const unit = 0.00008;
function drift({ from, count, delta }) { const out = []; for (let i = 0; i < count; i += 1) out.push(from + delta * (i + 1)); return out; }
function makeCandles({ closes, wicks = [] }) { return closes.map((close, index) => { const open = index === 0 ? close : closes[index - 1]; const wick = wicks[index] ?? { up: 0, down: 0 }; const bucketEnd = START_MS + (index + 1) * STEP_MS; return { bucketStart: bucketEnd - STEP_MS, bucketEnd, open, high: Math.max(open, close) + (wick.up ?? 0), low: Math.min(open, close) - (wick.down ?? 0), close }; }); }
function sellReversal() {
  const closes = [...drift({ from: base, count: 70, delta: unit * 0.15 })];
  const start = closes[closes.length - 1];
  for (let i = 0; i < 16; i += 1) closes.push(start + unit * (i + 1) * 1.2);
  const peak = closes[closes.length - 1];
  closes.push(peak - unit * 0.5, peak - unit * 0.9, peak - unit * 1.3, peak - unit * 1.6);
  const wicks = closes.map(() => ({ up: 0, down: 0 }));
  wicks[closes.length - 1] = { up: unit * 9, down: 0 };
  return makeCandles({ closes, wicks });
}
function neutral() { const closes = []; for (let i = 0; i < 90; i += 1) closes.push(base + (i % 2 === 0 ? unit * 0.3 : -unit * 0.3)); return makeCandles({ closes }); }

const pool = new pg.Pool({ connectionString: "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify", max: 2, ssl: { rejectUnauthorized: false } });
const runId = `agentic-tests-${Date.now()}`;

try {
  const candles = sellReversal();
  const now = candles[candles.length - 1].bucketEnd;
  const snapshot = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles, now });
  const graph = runAgentGraph(snapshot);

  check(1, "todos os agentes usam o MESMO snapshotId", graph.opinions.rsi.snapshotId === snapshot.snapshotId && Object.values(graph.opinions).every((o) => o.snapshotId === snapshot.snapshotId));
  check(2, "gatilho RSI 70/30 dispara oportunidade", graph.opinions.rsi.trigger === true && graph.opinions.rsi.side === "SELL", `rsi=${graph.opinions.rsi.rsi} state=${graph.opinions.rsi.state}`);
  const neutralSnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: neutral(), now: neutral()[89].bucketEnd });
  const neutralGraph = runAgentGraph(neutralSnap);
  check(3, "sem toque 70/30 nao ha oportunidade", neutralGraph.opinions.rsi.trigger === false);
  const future = { bucketStart: now + STEP_MS, bucketEnd: now + STEP_MS, open: 9, high: 9, low: 9, close: 9 };
  const leakSnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: [...candles, future], now });
  check(4, "sem future leak (snapshot causal)", (leakSnap.recentCandles ?? []).every((c) => c.bucketEnd <= now));
  check(5, "conversa registrada (5 agentes + consenso)", graph.conversation.filter((l) => l.agent !== "CONSENSUS").length === 5 && graph.conversation.some((l) => l.agent === "CONSENSUS"));
  const g2 = runAgentGraph(snapshot);
  check(6, "consenso deterministico", g2.consensus.decision === graph.consensus.decision && g2.consensus.reason === graph.consensus.reason);
  check(7, "latencia do grafo < 50ms", graph.latencyMs < 50, `${graph.latencyMs}ms`);
  const strategyResult = agentGraphToStrategyResult(graph);
  check(8, "adaptador de estrategia (agentic) consistente", strategyResult.strategyId === AGENTIC_STRATEGY_ID && strategyResult.opportunity === true);

  const fakeRuntime = { config: { mode: "PRACTICE", defaultStake: 2 }, accountContext: { context: "PRACTICE" }, submitLabPracticeOrder: async () => ({ state: "ACKNOWLEDGED", brokerOrderId: "T1" }) };
  const runner = new LabRunner({ runtime: fakeRuntime, pool: null, enabled: true, runId, strategies: [AGENTIC_STRATEGY_ID], cap: 50, evaluate: (s) => [agentGraphToStrategyResult(runAgentGraph(s))].filter(Boolean) });
  runner.started = true;
  await runner.observeMarket({ snapshot, marketKey: "T:OTC", targetExpiryAt: now + 20_000, payout: 80 });
  check(9, "runner agentic usa o grafo e mantem state proprio", runner.states.size === 1 && runner.states.get(AGENTIC_STRATEGY_ID).lastDecision === graph.consensus.decision);

  const realRunner = new LabRunner({ runtime: { config: { mode: "REAL" }, accountContext: { context: "REAL" } }, pool: null, enabled: true, runId, strategies: [AGENTIC_STRATEGY_ID], cap: 50, evaluate: (s) => [agentGraphToStrategyResult(runAgentGraph(s))].filter(Boolean) });
  realRunner.started = true;
  await realRunner.observeMarket({ snapshot, marketKey: "T:OTC", targetExpiryAt: now + 20_000 });
  check(10, "PRACTICE-only bloqueia REAL (agentic)", realRunner.counters.blockedReal === 1 && realRunner.counters.submits === 0);

  const store = new LabStore({ pool, runId, specsHash: "agentic", stake: 2, cap: 50 });
  await store.ensureRun([AGENTIC_STRATEGY_ID]);
  let reserved = 0;
  for (let i = 0; i < 50; i += 1) { const row = await store.reserveSlot(AGENTIC_STRATEGY_ID); if (row) reserved += 1; }
  const extra = await store.reserveSlot(AGENTIC_STRATEGY_ID);
  check(11, "cap 50 funciona (50 reservados, 51o bloqueado)", reserved === 50 && extra === null);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nAGENTIC_TESTS ${failed.length === 0 ? "ALL_PASS" : "FAILURES=" + failed.length} (${results.length - failed.length}/${results.length})`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error("AGENTIC_TESTS_ERROR", String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await pool.query("DELETE FROM iq_lab_decisions WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_trades WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_strategy_state WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_runs WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.end();
}
