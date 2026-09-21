import fs from "node:fs";
/** AGENTIC RSI+FIB — testes pre-T0 (mesmo snapshot, gatilho 70/30, consenso, isolamento, PRACTICE-only). */
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { runAgentGraph, agentGraphToStrategyResult, AGENTIC_STRATEGY_ID } from "../relay/agents/graph.mjs";
import { detectConstantMove, runConsensusAgent } from "../relay/agents/consensus.agent.mjs";
import { parseSafetyLevels } from "../relay/agents/safety-shadow.mjs";
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
  const runtimeSrc = fs.readFileSync(new URL("../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
  check(10, "avaliacao roda em REAL; gasto real so com arm (dry-run desarmado)", realRunner.counters.blockedReal === 0 && runtimeSrc.includes("REAL_NOT_ARMED") && runtimeSrc.includes("realArmed"));

  const store = new LabStore({ pool, runId, specsHash: "agentic", stake: 2, cap: 50 });
  await store.ensureRun([AGENTIC_STRATEGY_ID]);
  let reserved = 0;
  for (let i = 0; i < 50; i += 1) { const row = await store.reserveSlot(AGENTIC_STRATEGY_ID); if (row) reserved += 1; }
  const extra = await store.reserveSlot(AGENTIC_STRATEGY_ID);
  check(11, "cap 50 funciona (50 reservados, 51o bloqueado)", reserved === 50 && extra === null);

  const { runConsensusAgent } = await import("../relay/agents/consensus.agent.mjs");
  const synthetic = runConsensusAgent({ snapshot, opinions: { rsi: { trigger: true, side: "SELL", rsi: 75, state: "CROSSBACK", divergence: null, failureSwing: null, crossback: true, line50Ok: true, quality: 0.6, opinion: "teste" }, bollinger: { regime: "RANGE", rejection: "UPPER", walkSide: null, position: 0.9, strength: 0.5, opinion: "teste" }, adx: { regime: "RANGE", dominance: "PLUS", adx: 18, perSide: { SELL: { oldTrendWeakening: true, oppositeReacting: true, newDominance: false, oldStrengthening: false } }, strength: 0.4, opinion: "teste" }, atr: { state: "NORMAL", climactic: false, ratio: 1, opinion: "teste" }, fib: { state: "ZONE_REACTION", direction: "BUY", inZone: ["50.0"], strength: 0.7, opinion: "teste" } } });
  check(12, "Fib com leg incompativel bloqueia a tese (semantica de reversao)", synthetic.decision === "WAIT" && synthetic.counterEvidence.some((r) => r.code === "FIB_LEG_INCOMPATIVEL"));

  const safetyLevels = [100, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10, 0];
  const safetyRuns = safetyLevels.map((level) => ({ level, decision: runAgentGraph(snapshot, { safetyPct: level }).consensus.decision }));
  const approvedAt = (level) => { const row = safetyRuns.find((r) => r.level === level); return row?.decision === "BUY" || row?.decision === "SELL"; };
  const monotonic = safetyLevels.every((level, index) => index === 0 || !approvedAt(safetyLevels[index - 1]) || approvedAt(level));
  check(13, "seguranca: aprovacao monotonica (abaixar nunca bloqueia o que ja passava)", monotonic, safetyRuns.map((r) => r.level + ":" + r.decision).join(" "));
  const zeroSafety = runAgentGraph(snapshot, { safetyPct: 0 }).consensus;
  check(14, "seguranca 0% aprova todo gatilho (tolerancia total)", zeroSafety.decision === "BUY" || zeroSafety.decision === "SELL");
  const strictSafety = runAgentGraph(snapshot, { safetyPct: 100 }).consensus;
  check(15, "seguranca 100% mantem tolerancia zero (budget 0)", strictSafety.tolerance?.budget === 0 && strictSafety.tolerance?.safetyPct === 100);

  const steadyCloses = Array.from({ length: 90 }, (_, i) => base + unit * 0.4 * (90 - i));
  const steadyCandles = makeCandles({ closes: steadyCloses });
  const steadySnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: steadyCandles, now: steadyCandles[steadyCandles.length - 1].bucketEnd });
  const steadyDet = detectConstantMove({ snapshot: steadySnap, side: "BUY", atrNormalized: unit * 0.5, adxValue: 40, adxSlope: 2 });
  check(16, "detector de constancia identifica queda constante contra tese BUY", steadyDet.constant === true, steadyDet.detail);
  const choppyDet = detectConstantMove({ snapshot: { recentCandles: neutral() }, side: "BUY", atrNormalized: unit * 0.5, adxValue: 40, adxSlope: 2 });
  check(17, "detector nao marca mercado lateral como constancia", choppyDet.constant === false, choppyDet.detail);
  const syntheticOpinions = {
    rsi: { trigger: true, side: "BUY", rsi: 27, state: "EXTREME", divergence: "BULLISH", failureSwing: null, crossback: false, quality: 0.8, line50Ok: true },
    bollinger: { regime: "RANGE", rejection: "LOWER", strength: 0.6, state: "RANGE", position: 0.2, walkSide: null },
    adx: { regime: "TREND", dominance: "MINUS", adx: 40, adxSlope: 2, perSide: { BUY: { oldStrengthening: false, oldTrendWeakening: true, oppositeReacting: false, newDominance: false }, SELL: {} } },
    atr: { state: "NORMAL", climactic: false, ratio: 1, atrNormalized: unit * 0.5, strength: 0.5 },
    fib: { direction: "BUY", state: "ZONE_REJECTION", inZone: [38.2], strength: 0.6 },
  };
  const forcedConsensus = runConsensusAgent({ snapshot: steadySnap, opinions: syntheticOpinions, safetyPct: 50 });
  check(18, "constancia contra a tese barra em qualquer nivel (veto sempre ativo)", forcedConsensus.decision === "WAIT" && String(forcedConsensus.reason).includes("MOVIMENTO_CONSTANTE_CONTRA"), String(forcedConsensus.reason).slice(0, 90));
  const nonConstantConsensus = runAgentGraph(snapshot, { safetyPct: 50 }).consensus;
  check(20, "movimento nao-constante segue aprovando (sem regressao)", nonConstantConsensus.decision === "SELL", String(nonConstantConsensus.reason).slice(0, 70));
  const flatCandles = neutral();
  const flatSnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: flatCandles, now: flatCandles[flatCandles.length - 1].bucketEnd });
  const withLast = (candle) => ({ ...flatSnap, recentCandles: [...(flatSnap.recentCandles ?? []).slice(0, -1), candle] });
  const redLast = { bucketStart: 0, bucketEnd: 0, open: 1.1, high: 1.1005, low: 1.0985, close: 1.099 };
  const greenLast = { bucketStart: 0, bucketEnd: 0, open: 1.099, high: 1.101, low: 1.0985, close: 1.1005 };
  const cfBlocked = runConsensusAgent({ snapshot: withLast(redLast), opinions: syntheticOpinions, safetyPct: 50, filters: { confirmation: true } });
  check(21, "filtro CF barra quando o ultimo candle ainda esta contra a tese", cfBlocked.decision === "WAIT" && String(cfBlocked.reason).includes("SEM_CONFIRMACAO_REVERSAO"), String(cfBlocked.reason).slice(0, 80));
  const cfOk = runConsensusAgent({ snapshot: withLast(greenLast), opinions: syntheticOpinions, safetyPct: 50, filters: { confirmation: true } });
  check(22, "filtro CF libera quando o candle ja virou na direcao da tese", cfOk.decision === "BUY", String(cfOk.reason).slice(0, 60));
  const withStoch = (k, d, kLag) => ({ ...withLast(greenLast), indicators: { ...flatSnap.indicators, stochastic: { k, d, kLag } } });
  const stBlocked = runConsensusAgent({ snapshot: withStoch(55, 50, 60), opinions: syntheticOpinions, safetyPct: 50, filters: { stochastic: true } });
  check(23, "filtro ST barra quando o stochastic nao esta no extremo", stBlocked.decision === "WAIT" && String(stBlocked.reason).includes("STOCH_SEM_EXTREMO"), String(stBlocked.reason).slice(0, 80));
  const stOk = runConsensusAgent({ snapshot: withStoch(12, 15, 8), opinions: syntheticOpinions, safetyPct: 50, filters: { stochastic: true } });
  check(24, "filtro ST libera no extremo com k virando", stOk.decision === "BUY", String(stOk.reason).slice(0, 60));
  const squeezeOpinions = { ...syntheticOpinions, bollinger: { ...syntheticOpinions.bollinger, squeeze: true, regime: "SQUEEZE", state: "SQUEEZE" } };
  const sqBlocked = runConsensusAgent({ snapshot: withLast(greenLast), opinions: squeezeOpinions, safetyPct: 50, filters: { noSqueeze: true } });
  check(25, "filtro S barra entradas durante squeeze", sqBlocked.decision === "WAIT" && String(sqBlocked.reason).includes("SQUEEZE_SEM_REVERSAO"), String(sqBlocked.reason).slice(0, 80));
  const sqOk = runConsensusAgent({ snapshot: withLast(greenLast), opinions: syntheticOpinions, safetyPct: 50, filters: { noSqueeze: true } });
  check(26, "filtro S libera fora do squeeze", sqOk.decision === "BUY", String(sqOk.reason).slice(0, 60));
  const parsedLevels = parseSafetyLevels("100,90,80,70,50,50C");
  check(19, "niveis shadow aceitam variante (50C)", parsedLevels.length === 6 && parsedLevels.some((l) => l.label === "50C" && l.variant === "C" && l.safetyPct === 50));


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
