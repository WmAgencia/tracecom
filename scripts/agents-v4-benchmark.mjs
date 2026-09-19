/**
 * AGENTS V4 PERFORMANCE — mede CPU/RAM, latencia por fase, events/sec do DataHub e impacto no JIT.
 *
 * Uso: node scripts/agents-v4-benchmark.mjs [--write]
 * Saida: docs/research/data/agents-v4-performance.json
 *
 * Read-only: nenhuma ordem, nenhuma alteracao de config.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs/research/data/agents-v4-performance.json");

const hub = await import(new URL("../relay/datahub/index.mjs", import.meta.url));
const v4 = await import(new URL("../relay/agents-v4/index.mjs", import.meta.url));
const featureEngine = await import(new URL("../relay/feature-engine.mjs", import.meta.url));
const priceStructure = await import(new URL("../relay/price-structure.mjs", import.meta.url));

const BASE_MS = 1_800_000_000_000;
const CANDLE_MS = 5_000;

function candlesFor(kind) {
  const steps = 88;
  const candles = [];
  let price = 1.1;
  for (let index = 0; index < steps; index += 1) {
    const open = price;
    const phase = index % 5;
    let close;
    let amp = 0.0006;
    if (kind === "UP") close = open + 0.00012 + (phase < 3 ? amp : -amp);
    else if (kind === "DOWN") close = open - 0.00012 + (phase < 2 ? amp : -amp);
    else if (kind === "FLAT") close = open + (phase < 3 ? amp : -amp) - amp / 5;
    else if (kind === "COMPRESSION") { amp = 0.0005 * (1 - (index / steps) * 0.9); close = open + (phase % 4 < 2 ? amp : -amp); }
    else close = open + amp * (index % 7 < 3 ? 1 : index % 7 < 5 ? -1 : 0.2);
    const upWick = close >= open ? amp * 0.4 : amp * 0.15;
    const downWick = close <= open ? amp * 0.4 : amp * 0.15;
    candles.push({ bucketStart: BASE_MS + index * CANDLE_MS, bucketEnd: BASE_MS + index * CANDLE_MS + CANDLE_MS, open, high: Math.max(open, close) + upWick, low: Math.min(open, close) - downWick, close, receivedAt: BASE_MS + index * CANDLE_MS + CANDLE_MS, serverTimestamp: BASE_MS + index * CANDLE_MS });
    price = close;
  }
  return candles;
}

function buildT0(candles, marketKey = "EURUSD:OTC", marketType = "OTC", activeId = 76) {
  const decisionAt = candles[candles.length - 1].bucketStart + CANDLE_MS;
  const featureContext = featureEngine.buildFeatureContext({ candles, now: decisionAt, frameCapturedAt: decisionAt, timeframeSeconds: 5 });
  const structureFeatures = priceStructure.computeStructureFeatures(candles, candles.length - 1, { atr: featureContext.deterministicIndicators.atr14.value });
  const ticks = [];
  for (let index = 0; index < 30; index += 1) ticks.push({ price: candles[candles.length - 1].close + index * 0.000002, at: decisionAt - (30 - index) * 400, receivedAt: decisionAt - (30 - index) * 400 });
  return hub.buildT0Enriched({ marketKey, marketType, activeId, accountContext: "PRACTICE", decisionAt, price: candles[candles.length - 1].close, candles5s: candles, ticks, featureContext, structureFeatures, trajectory: { rsiSlope: 0.1, adxSlope: 0.05, diSpreadSlope: 0.02, atrSlope: 0.01, donchianDelta: 0.01, samples: 10 } });
}

const scenarios = ["UP", "DOWN", "FLAT", "COMPRESSION", "MIXED"];
const t0s = scenarios.map((kind) => buildT0(candlesFor(kind)));
const dq = hub.assessDataQuality({
  marketKey: "EURUSD:OTC", marketType: "OTC", accountContext: "PRACTICE", now: BASE_MS,
  feed: { connected: true, tickAgeMs: 400 }, candles: { count: 88 }, clock: { skewMs: 100, timeValid: true },
  marketMapping: { activeId: 76, resolved: true }, broker: { evaluated: true, connected: true, accountType: "PRACTICE" }, feature: { fresh: true, ageMs: 500 },
});
const risk = { accountContext: "PRACTICE", openPositions: 0, consecutiveLosses: 0, dailyDrawdownPct: 0, payout: 0.87, exposure: 1, stakeCap: 100, marketHealthy: true };

const engine = new v4.AgentsV4Engine();
const cpuBefore = process.cpuUsage();
const iterations = 300;
const perIteration = [];
for (let index = 0; index < iterations; index += 1) {
  const t0 = t0s[index % t0s.length];
  const started = process.hrtime.bigint();
  const result = engine.analyze({ t0, dataQualityAssessment: dq, risk });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  perIteration.push({ elapsedMs, phases: result.latency });
}
const cpuAfter = process.cpuUsage(cpuBefore);
const memory = process.memoryUsage();
const latency = hub.summarize ? hub.summarize(perIteration.map((row) => row.elapsedMs)) : null;
const phaseSummary = {};
for (const phase of ["dqMs", "specialistsMs", "scenarioMs", "synthesisMs", "redTeamMs", "committeesMs", "totalMs"]) {
  const values = perIteration.map((row) => row.phases[phase]).filter(Number.isFinite);
  phaseSummary[phase] = hub.summarize(values);
}

/* DataHub throughput */
const bus = new hub.EventBus({ now: () => Date.now() });
let delivered = 0;
bus.subscribe({ id: "fast", maxQueue: 4096, handler: () => { delivered += 1; } });
bus.subscribe({ id: "slow", maxQueue: 128, handler: () => { const start = Date.now(); while (Date.now() - start < 1) { /* 1ms busy */ } } });
const busStart = process.hrtime.bigint();
const eventsToPublish = 20_000;
for (let index = 0; index < eventsToPublish; index += 1) {
  bus.publish({
    eventType: "MARKET_TICK", marketKey: index % 2 === 0 ? "EURUSD:OTC" : "GBPUSD:OTC", marketType: "OTC",
    producer: "benchmark", source: "BENCHMARK", receivedAt: Date.now(), localTime: Date.now(),
    payload: { close: 1.1 + index * 1e-6 },
  });
}
const publishMs = Number(process.hrtime.bigint() - busStart) / 1e6;
await bus.flush();
const busStats = bus.stats();
const busSummary = {
  published: busStats.published,
  eventsPerSecond: Number(((eventsToPublish / publishMs) * 1000).toFixed(1)),
  publishMs: Number(publishMs.toFixed(2)),
  publishP95MsApprox: Number((publishMs / eventsToPublish).toFixed(6)),
  deliveredFast: busStats.perSubscriber.find((row) => row.id === "fast")?.delivered ?? null,
  droppedSlow: busStats.perSubscriber.find((row) => row.id === "slow")?.dropped ?? null,
  deliveryLatencyMs: busStats.deliveryLatencyMs,
  memoryRssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
};
void delivered;

const report = {
  schema: "agents-v4-performance-v1",
  generatedAtUtc: new Date().toISOString(),
  iterations,
  scenarios,
  latencyMs: { total: latency, phases: phaseSummary },
  cpu: { userMs: Number((cpuAfter.user / 1000).toFixed(2)), systemMs: Number((cpuAfter.system / 1000).toFixed(2)), perAnalysisMs: Number(((cpuAfter.user + cpuAfter.system) / 1000 / iterations).toFixed(3)) },
  memory: { rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)), heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)) },
  dataHub: busSummary,
  jitImpact: {
    hookCallsPerOpportunity: 2,
    maxSyncBlockMs: latency?.max ?? null,
    note: "Hook e sincrono e fail-safe; nunca awaited no caminho de decisao. Budget de pesquisa: p95 < 50ms.",
  },
  shadowOnly: true,
  controlsExecution: false,
};
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`AGENTS_V4_PERFORMANCE_WRITTEN ${OUT}`);
console.log(`latency p50=${latency?.p50} p95=${latency?.p95} p99=${latency?.p99} max=${latency?.max} ms`);
console.log(`events/sec=${busSummary.eventsPerSecond} droppedSlow=${busSummary.droppedSlow} deliveryP95=${busSummary.deliveryLatencyMs.p95}`);
console.log(`cpuPerAnalysisMs=${report.cpu.perAnalysisMs} rssMb=${report.memory.rssMb}`);
