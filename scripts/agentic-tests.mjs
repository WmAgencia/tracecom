import fs from "node:fs";
/** AGENTIC RSI+FIB — testes pre-T0 (mesmo snapshot, gatilho 70/30, consenso, isolamento, PRACTICE-only). */
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { runAgentGraph, agentGraphToStrategyResult, AGENTIC_STRATEGY_ID } from "../relay/agents/graph.mjs";
import { detectConstantMove, runConsensusAgent } from "../relay/agents/consensus.agent.mjs";
import { analyzeCandleAgent } from "../relay/agents/candle.agent.mjs";
import { CUSTOM_STRATEGIES } from "../relay/agents/custom-strategies.mjs";
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

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "";
if (!TEST_DATABASE_URL) { console.log("SKIP: TEST_DATABASE_URL ausente (suite de integracao; nunca usa DATABASE_URL de producao)"); process.exit(0); }
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
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
  check(5, "conversa registrada (6 agentes + consenso)", graph.conversation.filter((l) => l.agent !== "CONSENSUS").length === 6 && graph.conversation.some((l) => l.agent === "CONSENSUS"));
  const g2 = runAgentGraph(snapshot);
  check(6, "consenso deterministico", g2.consensus.decision === graph.consensus.decision && g2.consensus.reason === graph.consensus.reason);
  check(7, "latencia do grafo < 50ms", graph.latencyMs < 50, `${graph.latencyMs}ms`);
  const strategyResult = agentGraphToStrategyResult(graph);
  check(8, "adaptador de estrategia (agentic) consistente", strategyResult.strategyId === AGENTIC_STRATEGY_ID && strategyResult.opportunity === true);

  const fakeRuntime = { config: { mode: "PRACTICE", defaultStake: 2 }, accountContext: { context: "PRACTICE" }, submitPathTestOrder: async () => ({ state: "ACKNOWLEDGED", brokerOrderId: "T1" }) };
  const runner = new LabRunner({ runtime: fakeRuntime, pool: null, enabled: true, runId, strategies: [AGENTIC_STRATEGY_ID], cap: 50, evaluate: (s) => [agentGraphToStrategyResult(runAgentGraph(s))].filter(Boolean) });
  runner.started = true;
  await runner.observeMarket({ snapshot, marketKey: "T:OTC", targetExpiryAt: now + 20_000, payout: 80 });
  check(9, "runner agentic usa o grafo e mantem state proprio", runner.states.size === 1 && runner.states.get(AGENTIC_STRATEGY_ID).lastDecision === graph.consensus.decision);

  const realRunner = new LabRunner({ runtime: { config: { mode: "REAL" }, accountContext: { context: "REAL" } }, pool: null, enabled: true, runId, strategies: [AGENTIC_STRATEGY_ID], cap: 50, evaluate: (s) => [agentGraphToStrategyResult(runAgentGraph(s))].filter(Boolean) });
  realRunner.started = true;
  await realRunner.observeMarket({ snapshot, marketKey: "T:OTC", targetExpiryAt: now + 20_000 });
  const runtimeSrc = fs.readFileSync(new URL("../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
  const dispatchSrc = fs.readFileSync(new URL("../relay/execution/intelligence-dispatch.mjs", import.meta.url), "utf8");
  check(10, "avaliacao roda em REAL; gasto real so com arm (dry-run desarmado)", realRunner.counters.blockedReal === 0 && runtimeSrc.includes("TEST_PATH_PRACTICE_ONLY") && dispatchSrc.includes("realArmed"));

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
  const strictConstancia = runConsensusAgent({ snapshot: steadySnap, opinions: syntheticOpinions, safetyPct: 100 });
  check(18, "constancia contra a tese barra na Seguranca 100% (rigida)", strictConstancia.decision === "WAIT" && String(strictConstancia.reason).includes("MOVIMENTO_CONSTANTE_CONTRA"), String(strictConstancia.reason).slice(0, 90));
  const relaxedConstancia = runConsensusAgent({ snapshot: steadySnap, opinions: syntheticOpinions, safetyPct: 50 });
  check(18.5, "constancia e tolerada na Seguranca 50% (fluxo validado volta a operar)", relaxedConstancia.decision === "BUY", String(relaxedConstancia.reason).slice(0, 70));
  const nonConstantConsensus = runAgentGraph(snapshot, { safetyPct: 50 }).consensus;
  check(20, "reversao contra tendencia forte nao passa (regime/expansao)", nonConstantConsensus.decision === "WAIT", String(nonConstantConsensus.reason).slice(0, 90));
  check(37, "RSI le faixa de alta (Cardwell) e marca contra", graph.opinions.rsi.regime === "BULL_RANGE" && graph.opinions.rsi.counterEvidence.some((c) => c.code === "RSI_REGIME_CONTRA_FRACA"), `regime=${graph.opinions.rsi.regime} roll=${graph.opinions.rsi.rollingOver}`);
  check(38, "ADX marca preco na direcao da tendencia contra a tese", graph.opinions.adx.perSide?.SELL?.priceTrendAgainst === true, `trend=${graph.opinions.adx.priceTrend}`);
  check(39, "ATR le volatilidade expandindo", graph.opinions.atr.volTrend === "EXPANDING", `volRatio=${graph.opinions.atr.volRatio}`);
  check(40, "candle marca reversao contra tendencia forte", graph.opinions.candle.strongTrendAgainst === true, `structure=${graph.opinions.candle.structure}`);
  const pullbackOpinions = { candle: { trend: "BULLISH", structure: "CONTINUATION" }, bollinger: { middleSlope: 0.001 }, adx: { regime: "TREND", dominance: "PLUS" }, atr: { state: "NORMAL", climactic: false }, rsi: { rsi: 28, crossback: false } };
  const pb = CUSTOM_STRATEGIES.find((s) => s.id === "PULLBACK_300");
  check(41, "pullback: compra a queda do RSI na tendencia de alta", pb.signal({ opinions: pullbackOpinions }) === "BUY");
  check(42, "pullback: nao opera contra a tendencia (rsi alto na alta nao vende)", pb.signal({ opinions: { ...pullbackOpinions, rsi: { rsi: 72 } } }) === null);
  check(43, "pullback X exige o retorno do RSI (crossback)", CUSTOM_STRATEGIES.find((s) => s.id === "PULLBACK_X300").signal({ opinions: pullbackOpinions }) === null);
  const staircaseCloses = []; let stairPx = 1.1;
  for (let leg = 0; leg < 5; leg += 1) { for (let i = 0; i < 14; i += 1) { stairPx += unit * 0.6; staircaseCloses.push(stairPx); } for (let i = 0; i < 8; i += 1) { stairPx -= unit * 0.35; staircaseCloses.push(stairPx); } }
  for (let i = 0; i < 10; i += 1) { stairPx += unit * 0.6; staircaseCloses.push(stairPx); }
  const staircaseCandles = makeCandles({ closes: staircaseCloses });
  const staircaseSnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: staircaseCandles, now: staircaseCandles[staircaseCandles.length - 1].bucketEnd });
  const staircaseOpinion = analyzeCandleAgent(staircaseSnap);
  check(44, "candle le estrutura de mercado (escada HH/HL = UP) nos 30 min", staircaseOpinion.swingStructure === "UP" && staircaseOpinion.pullbackHolding === true, `estrutura=${staircaseOpinion.swingStructure} ${staircaseOpinion.swingLabels} bos=${staircaseOpinion.bos} pullback=${staircaseOpinion.pullbackHolding}`);
  const chochOpinions = { ...pullbackOpinions, candle: { ...pullbackOpinions.candle, swingStructure: "UP", choch: "BEARISH" } };
  check(45, "pullback nao opera quando a estrutura quebrou contra (CHoCH)", CUSTOM_STRATEGIES.find((s) => s.id === "PULLBACK_300").signal({ opinions: chochOpinions }) === null);
  const tightOpinions = { candle: { swingStructure: "UP", pullbackHolding: true, choch: null }, bollinger: { middleSlope: 0.001 }, adx: { regime: "TREND", dominance: "PLUS" }, atr: { state: "NORMAL", climactic: false }, rsi: { rsi: 42, rsiMin: 38, slope: 0.3 } };
  check(46, "pullback restrito exige estrutura+pullback+dominancia+crossback", CUSTOM_STRATEGIES.find((s) => s.id === "PULLBACK_XTIGHT_300").signal({ opinions: tightOpinions }) === "BUY");
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
  check(27, "historico dos agentes limitado a 30 min (360 candles) e trajetoria RSI de 10 min", (snapshot.recentCandles ?? []).length <= 360 && (snapshot.indicators.rsiTrajectory ?? []).length === 120, `candles=${snapshot.recentCandles.length} traj=${(snapshot.indicators.rsiTrajectory ?? []).length}`);
  const hammerCloses = [...drift({ from: base, count: 76, delta: 0 }), ...drift({ from: base, count: 14, delta: -unit * 2.5 })];
  const hammerWicks = hammerCloses.map(() => ({ up: 0, down: 0 }));
  hammerWicks[hammerCloses.length - 1] = { up: 0, down: unit * 9 };
  const hammerCandles = makeCandles({ closes: hammerCloses, wicks: hammerWicks });
  const hammerSnap = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: hammerCandles, now: hammerCandles[hammerCandles.length - 1].bucketEnd });
  const candleOpinion = analyzeCandleAgent(hammerSnap);
  check(28, "agente de candles detecta rejeicao no fundo com extensao previa", candleOpinion.structure === "REVERSAL" && candleOpinion.direction === "BUY" && candleOpinion.rejection === "LOWER", `${candleOpinion.state} ${candleOpinion.structure} loc=${candleOpinion.location}`);
  const candleContra = { ...syntheticOpinions, candle: { agent: "CANDLE", structure: "CONTINUATION", direction: "SELL", state: "STRUCTURE_BEARISH", rejection: null, opinion: "teste" } };
  const strictCandle = runConsensusAgent({ snapshot: withLast(greenLast), opinions: candleContra, safetyPct: 100 });
  check(29, "candle em continuacao contra a tese bloqueia na seguranca 100%", strictCandle.decision === "WAIT" && strictCandle.counterEvidence.some((r) => r.code === "CANDLE_CONTRA"), String(strictCandle.reason).slice(0, 80));
  const relaxedCandle = runConsensusAgent({ snapshot: withLast(greenLast), opinions: candleContra, safetyPct: 50 });
  check(30, "CANDLE_CONTRA e tolerado na seguranca 50% (orcamento)", relaxedCandle.decision === "BUY", String(relaxedCandle.reason).slice(0, 60));
  const gateOpinions = { ...syntheticOpinions, candle: { agent: "CANDLE", structure: "UNCLEAR", direction: "NEUTRAL", rejection: null, opinion: "teste" } };
  const gateBlocked = runConsensusAgent({ snapshot: withLast(greenLast), opinions: gateOpinions, safetyPct: 5, filters: { candle: true } });
  check(31, "candle gate barra sem padrao de reversao (5FTC)", gateBlocked.decision === "WAIT" && gateBlocked.counterEvidence.some((r) => r.code === "CANDLE_GATE_SEM_REVERSAO"), String(gateBlocked.reason).slice(0, 80));
  const gateOkOpinions = { ...syntheticOpinions, candle: { agent: "CANDLE", structure: "REVERSAL", direction: "BUY", rejection: "LOWER", opinion: "teste" } };
  const gateOk = runConsensusAgent({ snapshot: withLast(greenLast), opinions: gateOkOpinions, safetyPct: 5, filters: { candle: true } });
  check(32, "candle gate libera com reversao a favor", gateOk.decision === "BUY", String(gateOk.reason).slice(0, 60));
  const parsed4 = parseSafetyLevels("5FTSC");
  check(33, "niveis shadow aceitam 4 letras (5FTSC)", parsed4.length === 1 && parsed4[0].label === "5FTSC" && parsed4[0].variant === "FTSC");
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
