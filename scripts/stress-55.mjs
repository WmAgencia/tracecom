import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";
import { UNIVERSE, marketKey } from "../relay/market-universe.mjs";
import { CANDLE_SIZE_SECONDS } from "../relay/iqoption-ws.mjs";

export const STRESS55_VERSION = "stress-55-v1";
const BASE_MS = Date.UTC(2026, 8, 17, 12, 0, 20);
const CANDLE_MS = CANDLE_SIZE_SECONDS * 1000;
const DEFAULT_ITERATIONS = 240;
const DEFAULT_SEED_CANDLES = 60;
const PRICE_STEP = 0.00002;
const LAG_TIMER_MS = 20;
export const SUSPENDED_COUNT = 20;

export function percentile(values, fraction) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function summarize(values) {
  if (!values.length) return { count: 0, avg: null, p50: null, p95: null, p99: null, max: null };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    avg: Number((sum / values.length).toFixed(3)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: percentile(values, 1),
  };
}

function measureEventLoopLag(expectedMs = LAG_TIMER_MS) {
  return new Promise((resolve) => {
    const started = performance.now();
    setTimeout(() => { resolve(Math.max(0, performance.now() - started - expectedMs)); }, expectedMs);
  });
}

function countStates(stateByMarket) {
  const counts = {};
  for (const state of Object.values(stateByMarket)) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

function transitionCounts(before, after) {
  const transitions = {};
  for (const key of Object.keys(before)) {
    if (before[key] === after[key]) continue;
    const label = `${before[key]}->${after[key]}`;
    transitions[label] = (transitions[label] ?? 0) + 1;
  }
  return transitions;
}

export async function runStress({ iterations = DEFAULT_ITERATIONS, markets = UNIVERSE.length, seedCandles = DEFAULT_SEED_CANDLES, writeReport = false, reportPath = "stress-55-report.json", log = () => {} } = {}) {
  const limit = Math.max(1, Math.min(UNIVERSE.length, Math.floor(Number(markets) || UNIVERSE.length)));
  const totalIterations = Math.max(1, Math.floor(Number(iterations) || DEFAULT_ITERATIONS));
  const entries = UNIVERSE.slice(0, limit);
  const clock = { nowMs: BASE_MS };
  const clientCalls = { placeOrder: 0, getOptions: 0, other: 0 };
  const runtimeStartedAt = performance.now();

  let runtime = null;
  const client = {
    serverNow: () => clock.nowMs,
    placeOrder: () => { clientCalls.placeOrder += 1; throw new Error("STRESS_ORDER_FORBIDDEN"); },
    getOptions: async () => { clientCalls.getOptions += 1; return { response: { msg: { open_options: [], closed_options: [] } } }; },
    getBalances: async () => { clientCalls.other += 1; return { response: { msg: [] } }; },
    getInitializationData: async () => { clientCalls.other += 1; return { response: { msg: {} } }; },
    subscribeCandles: () => { clientCalls.other += 1; },
    unsubscribeCandles: () => { clientCalls.other += 1; },
    send: () => { clientCalls.other += 1; },
    close: () => {},
  };

  try {
    runtime = new IqMultiRuntime({ pool: null, getSsid: () => null, now: () => clock.nowMs, log, ackTimeoutMs: 150, autoExecute: false });
    runtime.session = { connected: true, host: "stress.local", connectionId: "stress-conn", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true, connectedAt: clock.nowMs };
    runtime.connection = { connectionId: "stress-conn", host: "stress.local", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true };
    runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: clock.nowMs, type: "PRACTICE" };
    runtime.client = client;
    runtime.config.autoExecute = false;

    const states = entries.map((entry, index) => {
      const key = marketKey(entry.canonical, entry.marketType);
      const ctx = runtime.markets.get(key);
      if (!ctx) throw new Error(`STRESS_UNIVERSE_KEY_MISSING:${key}`);
      ctx.enabled = true; ctx.paused = false;
      ctx.availability = "OPEN"; ctx.activeId = 1000 + index;
      ctx.payout = 85; ctx.payoutSource = "stress-fixture"; ctx.resolvedAt = clock.nowMs;
      ctx.instrumentTypes = ["binary", "turbo"]; ctx.maxStake = 100; ctx.configuredStake = 1;
      ctx.connectionHealth = { connected: true, lastMessageAt: clock.nowMs, gaps: 0 };
      return { entry, key, ctx, index, base: Number((1 + index * 0.1).toFixed(6)), cursor: null, close: 0 };
    });
    if (states.length !== limit) throw new Error(`STRESS_UNIVERSE_INCOMPLETE:${states.length}/${limit}`);
    if (runtime.activeMarketKeys().length !== limit) throw new Error(`STRESS_ACTIVE_COUNT:${runtime.activeMarketKeys().length}/${limit}`);

    const ingestDurations = [];
    const featureProxyDurations = [];
    const agentLatencySamples = [];
    const traderLatencySamples = [];
    const criticLatencySamples = [];
    const consensusLatencySamples = [];
    const iterationDurations = [];
    const eventLoopLags = [];
    const lastCorrelation = new Map();
    const counters = { seeded: 0, loopCandles: 0, decisions: 0 };

    const pushCandle = (state, bucketStart, close) => {
      const { ctx } = state;
      const fromSec = Math.floor(bucketStart / 1000);
      const open = close - PRICE_STEP / 2;
      const started = performance.now();
      runtime.ingestEvent("candle-generated", {
        connectionId: runtime.connection.connectionId,
        receivedAt: clock.nowMs,
        msg: { active_id: ctx.activeId, size: CANDLE_SIZE_SECONDS, from: fromSec, to: fromSec + CANDLE_SIZE_SECONDS, open, high: close + PRICE_STEP / 2, low: open - PRICE_STEP / 2, close, at: clock.nowMs },
      });
      const elapsed = performance.now() - started;
      ingestDurations.push(elapsed);
      const correlationId = ctx.agents?.correlationId ?? null;
      if (correlationId && lastCorrelation.get(state.key) !== correlationId) {
        lastCorrelation.set(state.key, correlationId);
        counters.decisions += 1;
        const traderMs = Number(ctx.agents?.trader?.latencyMs) || 0;
        const criticMs = Number(ctx.agents?.critic?.latencyMs) || 0;
        const consensusMs = Number(ctx.agents?.consensus?.latencyMs) || 0;
        traderLatencySamples.push(traderMs);
        criticLatencySamples.push(criticMs);
        consensusLatencySamples.push(consensusMs);
        agentLatencySamples.push(traderMs + criticMs + consensusMs);
        featureProxyDurations.push(Math.max(0, elapsed - (traderMs + criticMs + consensusMs)));
      }
      state.cursor = bucketStart;
      state.close = close;
    };

    const cpuStart = process.cpuUsage();
    const seedStartMs = Math.floor((clock.nowMs - seedCandles * CANDLE_MS) / CANDLE_MS) * CANDLE_MS;
    for (const state of states) {
      for (let index = 0; index < seedCandles; index += 1) {
        pushCandle(state, seedStartMs + index * CANDLE_MS, Number((state.base + index * PRICE_STEP).toFixed(8)));
        counters.seeded += 1;
      }
    }

    const cpuLoopStart = process.cpuUsage();
    for (let iteration = 0; iteration < totalIterations; iteration += 1) {
      clock.nowMs += 1000;
      const iterationStarted = performance.now();
      const rotation = iteration % CANDLE_SIZE_SECONDS;
      for (const state of states) {
        if (state.index % CANDLE_SIZE_SECONDS !== rotation) continue;
        pushCandle(state, state.cursor + CANDLE_MS, Number((state.close + PRICE_STEP).toFixed(8)));
        counters.loopCandles += 1;
      }
      iterationDurations.push(performance.now() - iterationStarted);
      eventLoopLags.push(await measureEventLoopLag(LAG_TIMER_MS));
    }
    const cpuLoop = process.cpuUsage(cpuLoopStart);

    const officeBefore = runtime.office();
    const statesBefore = Object.fromEntries(officeBefore.markets.map((market) => [market.marketKey, market.agentState]));

    const initData = (suspendedIndexes) => {
      const actives = {};
      for (const state of states) {
        const name = `${state.entry.canonical}${state.entry.marketType === "OTC" ? "-OTC" : "-op"}`;
        actives[String(state.ctx.activeId)] = { name, enabled: true, is_suspended: suspendedIndexes.has(state.index), option: { profit: { commission: { value: 15 } } } };
      }
      return { binary: { actives } };
    };

    runtime.resolver.ingestInitializationData(initData(new Set()));
    runtime.ingestAuxiliary({});

    const suspendIndexes = new Set(states.slice(0, Math.min(SUSPENDED_COUNT, states.length)).map((state) => state.index));
    runtime.resolver.ingestInitializationData(initData(suspendIndexes));
    runtime.ingestAuxiliary({});
    const officeSuspended = runtime.office();
    const statesSuspended = Object.fromEntries(officeSuspended.markets.map((market) => [market.marketKey, market.agentState]));

    runtime.resolver.ingestInitializationData(initData(new Set()));
    runtime.ingestAuxiliary({});
    const officeReopened = runtime.office();
    const statesReopened = Object.fromEntries(officeReopened.markets.map((market) => [market.marketKey, market.agentState]));

    const marketLatency = officeReopened.markets.map((market) => ({
      marketKey: market.marketKey,
      agentState: market.agentState,
      availability: market.availability,
      candles5s: market.candles5s,
      serverToReceived: market.latency.serverToReceived,
      normalizedToFeature: market.latency.normalizedToFeature,
      orderAck: market.latency.orderAck,
    }));
    const stageP95 = (pick) => {
      const values = marketLatency.map(pick).map((summary) => summary?.p95).filter(Number.isFinite);
      return values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3)) : null;
    };
    const agentsFromMarkets = officeReopened.markets
      .map((market) => market.agents)
      .filter(Boolean)
      .map((agents) => ({ marketKey: agents.correlationId, traderMs: agents.trader?.latencyMs ?? null, criticMs: agents.critic?.latencyMs ?? null, consensusMs: agents.consensus?.latencyMs ?? null }));
    const agentStageP95 = (key) => {
      const values = agentsFromMarkets.map((row) => Number(row[key])).filter(Number.isFinite);
      return values.length ? percentile(values, 0.95) : null;
    };
    const latencyReport = {
      iterationMs: summarize(iterationDurations),
      ingestMs: summarize(ingestDurations),
      featureEngineProxyMs: summarize(featureProxyDurations),
      agentLatencyMs: summarize(agentLatencySamples),
      agentStagesMs: { trader: summarize(traderLatencySamples), critic: summarize(criticLatencySamples), consensus: summarize(consensusLatencySamples) },
      lastEvaluationStagesMs: { traderP95: agentStageP95("traderMs"), criticP95: agentStageP95("criticMs"), consensusP95: agentStageP95("consensusMs") },
      marketStagesP95AvgMs: { serverToReceived: stageP95((row) => row.serverToReceived), normalizedToFeature: stageP95((row) => row.normalizedToFeature), orderAck: stageP95((row) => row.orderAck) },
      byMarket: marketLatency,
    };

    const probeState = states[0];
    const probeBrain = (action) => ({
      trader: {
        agent: "TRADER", action, setup: action === "WAIT" ? "NO_VALID_SETUP" : "STRESS_PROBE", trigger: action === "WAIT" ? null : "stress_probe_trigger", analysisConfidence: action === "WAIT" ? 0 : 0.6, waitReason: action === "WAIT" ? "PROBE_WAIT" : null,
        processLog: [], momentum: { rsi14: 58, acceleration: 0.001 }, strength: { adx14: 27, diSpread: 10 }, volatility: { atrRatio: 0.001 }, microstructure: { streak: 2 }, location: { zone: "MEIO_CANAL" }, structure: { label: "HH_HL" },
        supportingEvidence: [], contradictingEvidence: [], primaryRisk: null, latencyMs: 0,
      },
      critic: { agent: "CRITIC", traderAssessment: "CONFIRM", independentAction: action, contradictions: [], riskFlags: [], finalRecommendation: action, latencyMs: 0 },
      consensus: { action, status: action === "WAIT" ? "WAIT" : "CONFIRMED", reason: action === "WAIT" ? "TRADER_WAIT" : "TRADER_E_CRITIC_ALINHADOS", rules: [], analysisConfidence: action === "WAIT" ? 0 : 0.6, estimatedWinProbability: null, latencyMs: 0 },
      regime: "TREND_UP",
    });
    runtime.decisionOverride = ({ marketKey }) => probeBrain(marketKey === probeState.key ? "BUY" : "WAIT");
    clock.nowMs += 1000;
    pushCandle(probeState, probeState.cursor + CANDLE_MS, Number((probeState.close + PRICE_STEP).toFixed(8)));
    let jitProbe = { candidateCreated: false, candidateId: null, finalStatus: null, cancelReason: null };
    if (probeState.ctx.candidate) {
      jitProbe.candidateCreated = true;
      jitProbe.candidateId = probeState.ctx.candidate.id;
      clock.nowMs = probeState.ctx.candidate.submitAt + 10;
      pushCandle(probeState, probeState.cursor + CANDLE_MS, Number((probeState.close + PRICE_STEP).toFixed(8)));
      await new Promise((resolve) => setImmediate(resolve));
      const settledCandidate = probeState.ctx.lastCandidate ?? probeState.ctx.candidate;
      jitProbe.finalStatus = settledCandidate?.status ?? null;
      jitProbe.cancelReason = settledCandidate?.cancelReason ?? probeState.ctx.candidate?.lastCancelReason ?? null;
    }
    runtime.decisionOverride = null;
    const officeFinal = runtime.office();

    const signalProbes = [];
    for (let index = 0; index < Math.min(3, states.length); index += 1) {
      const probe = await runtime.simulateSignal(states[index].key, index % 2 === 0 ? "BUY" : "SELL");
      signalProbes.push({ marketKey: probe.marketKey, disposition: probe.disposition, reason: probe.reason });
    }

    const contamination = [];
    for (const state of states) {
      const { ctx } = state;
      const maxBase = state.base + PRICE_STEP * (seedCandles + totalIterations + 10);
      const minBase = state.base - 0.001;
      for (const candle of ctx.candles.values()) {
        const reasons = [];
        if (candle.marketKey !== ctx.marketKey) reasons.push(`marketKey:${candle.marketKey}`);
        if (Number(candle.activeId) !== Number(ctx.activeId)) reasons.push(`activeId:${candle.activeId}`);
        if (!String(candle.segmentId ?? "").startsWith(`${ctx.marketKey}:`)) reasons.push(`segmentId:${candle.segmentId}`);
        if (!Number.isFinite(candle.close) || candle.close < minBase || candle.close > maxBase) reasons.push(`close:${candle.close}`);
        if (reasons.length) contamination.push({ marketKey: ctx.marketKey, bucketStart: candle.bucketStart, reasons });
      }
    }

    const signalView = runtime.signals(200);
    const dispositionCounts = {};
    const signalStatsTotals = { total: 0, executed: 0, blocked: 0, expired: 0, duplicate: 0, wins: 0, losses: 0, draws: 0, settledPnl: 0 };
    for (const record of runtime.signalLog) {
      dispositionCounts[record.disposition] = (dispositionCounts[record.disposition] ?? 0) + 1;
    }
    for (const stats of Object.values(signalView.stats)) {
      signalStatsTotals.total += stats.total;
      signalStatsTotals.executed += stats.executed;
      signalStatsTotals.blocked += stats.blocked;
      signalStatsTotals.expired += stats.expired;
      signalStatsTotals.duplicate += stats.duplicate;
      signalStatsTotals.wins += stats.wins;
      signalStatsTotals.losses += stats.losses;
      signalStatsTotals.draws += stats.draws;
      signalStatsTotals.settledPnl = Number((signalStatsTotals.settledPnl + (Number(stats.settledPnl) || 0)).toFixed(4));
    }

    const ordersSent = clientCalls.placeOrder;
    const executedSignals = runtime.signalLog.filter((record) => record.disposition === "EXECUTED" || record.executionId !== null || record.brokerOrderId !== null).length;
    const positionsCreated = runtime.openPositions.size + runtime.pendingOrders.size;
    const pendingOrdersBeforeStop = runtime.pendingOrders.size;
    const openPositionsBeforeStop = runtime.openPositions.size;

    runtime.stop("STRESS_DONE");

    const cpuTotal = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const durationMs = Number((performance.now() - runtimeStartedAt).toFixed(1));

    const report = {
      harness: STRESS55_VERSION,
      ok: ordersSent === 0 && positionsCreated === 0 && executedSignals === 0 && contamination.length === 0,
      config: {
        iterations: totalIterations, markets: limit, seedCandles, candleSizeSeconds: CANDLE_SIZE_SECONDS,
        ingestsPerIteration: states.filter((state) => state.index % CANDLE_SIZE_SECONDS === 0).length,
        autoExecute: runtime.config.autoExecute, armed: runtime.armState.armed === true,
        suspendCount: suspendIndexes.size,
      },
      agentCoverage: { markets: limit, traderAgents: limit, criticAgents: limit, consensusAgents: limit, totalAgents: limit * 2 },
      marketsSeeded: states.length,
      marketsOpen: officeReopened.markets.filter((market) => market.availability === "OPEN").length,
      marketsActive: runtime.activeMarketKeys().length,
      candles: {
        seeded: counters.seeded,
        loop: counters.loopCandles,
        decisions: counters.decisions,
        bufferTotal: states.reduce((total, state) => total + state.ctx.candles.size, 0),
        bufferMin: Math.min(...states.map((state) => state.ctx.candles.size)),
        bufferMax: Math.max(...states.map((state) => state.ctx.candles.size)),
      },
      ordersSent,
      executedSignals,
      positionsCreated,
      pendingOrders: pendingOrdersBeforeStop,
      openPositions: openPositionsBeforeStop,
      placeOrderCalls: clientCalls.placeOrder,
      getOptionsCalls: clientCalls.getOptions,
      otherClientCalls: clientCalls.other,
      contamination,
      cpu: {
        totalUserMs: Number((cpuTotal.user / 1000).toFixed(1)),
        totalSystemMs: Number((cpuTotal.system / 1000).toFixed(1)),
        loopUserMs: Number((cpuLoop.user / 1000).toFixed(1)),
        loopSystemMs: Number((cpuLoop.system / 1000).toFixed(1)),
      },
      memory: {
        rssMb: Number((memory.rss / 1048576).toFixed(1)),
        heapUsedMb: Number((memory.heapUsed / 1048576).toFixed(1)),
        heapTotalMb: Number((memory.heapTotal / 1048576).toFixed(1)),
        externalMb: Number((memory.external / 1048576).toFixed(1)),
      },
      eventLoopLag: { ...summarize(eventLoopLags), timerMs: LAG_TIMER_MS },
      latency: latencyReport,
      jit: {
        candidates: officeFinal.entryTiming.scoreboard.counters.candidates,
        counters: officeFinal.entryTiming.scoreboard.counters,
        probe: jitProbe,
      },
      signals: { total: runtime.signalLog.length, last200: signalView.signals.length, dispositions: dispositionCounts, stats: signalStatsTotals, probes: signalProbes },
      availability: {
        openBefore: officeBefore.markets.filter((market) => market.availability === "OPEN").length,
        openSuspended: officeSuspended.markets.filter((market) => market.availability === "OPEN").length,
        openReopened: officeReopened.markets.filter((market) => market.availability === "OPEN").length,
        suspendedMarkets: officeSuspended.markets.filter((market) => market.availability === "SUSPENDED").map((market) => market.marketKey),
        agentStatesBefore: countStates(statesBefore),
        agentStatesSuspended: countStates(statesSuspended),
        agentStatesReopened: countStates(statesReopened),
        transitionsOnSuspend: transitionCounts(statesBefore, statesSuspended),
        transitionsOnReopen: transitionCounts(statesSuspended, statesReopened),
        positionsDuring: positionsCreated,
        pendingOrdersDuring: pendingOrdersBeforeStop,
      },
      durationMs,
      finishedAt: new Date().toISOString(),
    };

    if (writeReport) await writeFile(path.resolve(reportPath), JSON.stringify(report, null, 2), "utf8");
    return report;
  } finally {
    try { runtime?.stop("STRESS_FINALLY"); } catch { /* noop */ }
  }
}

function parseArgs(argv) {
  const options = { iterations: DEFAULT_ITERATIONS, markets: UNIVERSE.length, writeReport: true };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--iterations") options.iterations = Number(argv[index + 1]);
    else if (argv[index] === "--markets") options.markets = Number(argv[index + 1]);
    else if (argv[index] === "--no-write") options.writeReport = false;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runStress(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.ok !== true) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.stack ?? error) })}\n`);
    process.exitCode = 1;
  });
}
