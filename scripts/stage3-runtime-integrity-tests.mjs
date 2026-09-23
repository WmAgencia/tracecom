import fs from "node:fs";
import { RuntimeIntelligence } from "../relay/intelligence/runtime-adapter.mjs";
import { AssetPipeline, HYDRATION_READY, HYDRATION_PARTIAL } from "../relay/intelligence/asset-pipeline.mjs";
import { deepFreeze, stableStringify } from "../relay/intelligence/features.mjs";
import { IntelligenceDispatch } from "../relay/execution/intelligence-dispatch.mjs";
import { SinglePath } from "../relay/execution/single-path.mjs";
import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";
import { operationalAllowlist, OPERATIONAL_EXECUTION_POLICY_NAME } from "../relay/execution/operational-policy.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const ACTIVE = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "ACTIVE", executable: true, strategyHash: "sha256:v2-test" });
const mk5s = (n, startAt, stepMs = 5000) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * stepMs, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const series = mk5s(2161, NOW - 10_800_000);
const buyFeatures = deepFreeze({
  marketKey: "EURUSD:OTC", version: 9001, at: NOW, candles: 2161, structure: "UPTREND", regime: "UPTREND", close: 1.35, atr: 0.0012, volRatio: 1.05,
  rsi: { value: 34, zone: "LOW" }, dmi: { adx: 29, plusDi: 33, minusDi: 18, trending: true }, bollinger: { bandwidth: 0.0014, percentB: 0.44, expanding: true },
  priceAction: { bodyRatio: 0.45, closeInRange: 0.6, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 }, nearestZone: null, lastBOS: null, lastCHoCH: null },
});

/* 1) causalidade full-runtime com dataset real arquivado (CAUSALITY_AND_DETERMINISM_FIXTURE, 1m) */
{
  const raw = JSON.parse(fs.readFileSync(new URL("../data/real/usdcad-1m-7d.json", import.meta.url), "utf8"));
  const rows = (raw.rows ?? []).map((c) => ({ at: Number(c.timestamp), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) })).filter((c) => Number.isFinite(c.at) && Number.isFinite(c.close));
  const key = "USDCAD:CAUSALITY";
  let T = -1;
  for (let i = 300; i < rows.length - 400; i += 1) { if (rows[i].at - rows[i - 180].at === 10_800_000) { T = i; break; } }
  ok("dataset real arquivado tem janela de 3h continua para o teste causal", T > 0);
  const upToT = rows.slice(0, T + 1);
  const intelA = new RuntimeIntelligence({ now: () => rows[T].at, strategy: ACTIVE, loader: async () => upToT, hydrationOptions: { expectedIntervalMs: 60_000 } });
  const reportA = await intelA.start([key]);
  const pipeA = intelA.registry.get(key);
  const stateA = { snapshot: pipeA.ctx.snapshot(), features: pipeA.features, specialists: pipeA.specialists, consensus: pipeA.consensus, snapshotId: pipeA.lastSnapshot?.id ?? null };
  ok("causalidade: run A (somente <=T) hidrata READY com 1m e features em T", reportA.ready === 1 && pipeA.hydration === HYDRATION_READY && pipeA.features?.at === rows[T].at);
  ok("causalidade: nenhum evento/pivo do run A alem de T", pipeA.ctx.events.every((e) => e.at <= rows[T].at && e.confirmedAt <= rows[T].at) && pipeA.ctx.pivots.every((p) => p.at <= rows[T].at && p.confirmedAt <= rows[T].at));

  const intelB = new RuntimeIntelligence({ now: () => rows[T].at, strategy: ACTIVE, loader: async () => rows.slice(0, T + 1), hydrationOptions: { expectedIntervalMs: 60_000 } });
  await intelB.start([key]);
  const pipeB = intelB.registry.get(key);
  const stateBAtT = { snapshot: pipeB.ctx.snapshot(), features: pipeB.features, specialists: pipeB.specialists, consensus: pipeB.consensus, snapshotId: pipeB.lastSnapshot?.id ?? null };
  ok("causalidade: estado em T identico entre runs independentes (determinismo)", stableStringify(stateA) === stableStringify(stateBAtT));

  for (const candle of rows.slice(T + 1, T + 201)) intelB.onClosedCandle(key, candle);
  const stateBAfterFuture = { snapshot: pipeB.ctx.snapshot(), features: pipeB.features, specialists: pipeB.specialists, consensus: pipeB.consensus, snapshotId: pipeB.lastSnapshot?.id ?? null };
  ok("causalidade: candles futuros nao reescrevem o estado congelado de T", Object.isFrozen(stateBAtT.features) === true && stableStringify(stateA.features) === stableStringify(stateBAtT.features) && stateA.snapshotId === stateBAtT.snapshotId);
  ok("causalidade: estado avancou apenas para frente (novo features, at > T)", stateBAfterFuture.features !== stateBAtT.features && stateBAfterFuture.features.at > rows[T].at && pipeB.ctx.lastCandle.at > rows[T].at);
  ok("causalidade: pipeline segue READY apos o futuro", pipeB.hydration === HYDRATION_READY);
}

/* 2) falhas de startup: registry, loader, FeatureEngine, pipeline -> NOT_READY/DEGRADED + DENY + calls=0 */
{
  const mkDispatch = (intel, orders) => {
    const dispatch = new IntelligenceDispatch({ intelligence: intel, singlePath: new SinglePath({ now: () => NOW }), strategy: ACTIVE, requestOrder: orders.record, killSwitchEngaged: () => false, accountMode: "PRACTICE", realArmed: () => false, accountContext: () => null, serverTimeMs: () => NOW, now: () => NOW });
    return dispatch;
  };
  const recorder = () => { const calls = []; return { calls, record: async (input) => { calls.push(input); return { state: "ACKNOWLEDGED" }; } }; };

  const registryFail = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE });
  registryFail.registry = { hydrateAll: async () => { throw new Error("REGISTRY_DOWN"); }, status: () => [] };
  await registryFail.start(["EURUSD:OTC"]);
  const o1 = recorder();
  const s1 = await mkDispatch(registryFail, o1).dispatchOnce();

  const loaderFail = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => { throw new Error("LOADER_DOWN"); } });
  await loaderFail.start(["EURUSD:OTC"]);
  const o2 = recorder();
  const s2 = await mkDispatch(loaderFail, o2).dispatchOnce();

  const partial = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => mk5s(1200, NOW - 6_000_000) });
  await partial.start(["EURUSD:OTC"]);
  const pipePartial = partial.registry.get("EURUSD:OTC");
  const featureBefore = pipePartial.features;
  const featureResult = pipePartial.evaluate();
  const o3 = recorder();
  const s3 = await mkDispatch(partial, o3).dispatchOnce();

  ok("registry failure -> NOT_READY e DENY sem ordem", registryFail.ready === false && registryFail.health().state === "NOT_READY" && s1.reason === "INTELLIGENCE_NOT_READY" && o1.calls.length === 0);
  ok("hydration loader failure -> DEGRADED e DENY sem ordem", s2.reason === "INTELLIGENCE_DEGRADED" && loaderFail.health().assetsFailed === 1 && o2.calls.length === 0);
  ok("FeatureEngine indisponivel (PARTIAL) -> evaluate nulo, DEGRADED, DENY sem ordem", featureBefore === null && featureResult === null && s3.reason === "INTELLIGENCE_DEGRADED" && o3.calls.length === 0);
}

/* 3) wiring real do runtime: uma RuntimeIntelligence, um dispatch, um requestOrder */
{
  const pool = { query: async () => ({ rows: [] }) };
  const rt = new IqMultiRuntime({ pool, log: () => {}, executionAllowlist: operationalAllowlist(), executionPolicyName: OPERATIONAL_EXECUTION_POLICY_NAME });
  const status = rt.intelligenceStatus();
  ok("runtime instancia UMA RuntimeIntelligence com manifesto da V2 (status/executavel coerentes)", status.assetIntelligence.initialized === true && status.strategy.version === "PULLBACK_4060_300_AGENTIC_V2" && ["READY_FOR_DEPLOY", "ACTIVE"].includes(status.strategy.status) && (status.strategy.status === "ACTIVE" ? status.strategy.executable === true : status.strategy.executable === false));
  ok("runtime expoe dispatch wired + candleStore canonico 5s", status.dispatch.wired === true && status.candleStore.ready === true && status.candleStore.intervalMs === 5000);
  ok("health inicial: DEGRADED (0 assets) e execucao DENY", status.assetIntelligence.state === "DEGRADED" && status.assetIntelligence.intelligenceReady === false && rt.intelligenceDispatch.dispatchOnce !== undefined);

  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => series });
  await intel.start(["EURUSD:OTC"]);
  intel.onClosedCandle("EURUSD:OTC", mk5s(1, series[series.length - 1].at + 5000)[0]);
  intel.registry.get("EURUSD:OTC").evaluate(buyFeatures);
  const calls = [];
  rt.requestOrder = async (input) => { calls.push(input); return { state: "ACKNOWLEDGED", brokerOrderId: "RT1" }; };
  rt.intelligenceDispatch.intelligence = intel;
  rt.intelligenceDispatch.strategy = ACTIVE;
  rt.intelligenceDispatch.marketStateFor = () => ({ tradable: true, purchaseStatus: "AVAILABLE" });
  const summary = await rt.pumpIntelligenceDecisions();
  ok("runtime.pump -> dispatch -> SinglePath -> requestOrder (fronteira unica)", summary?.submitted?.length === 1 && calls.length === 1 && calls[0].horizonSeconds === 300 && calls[0].source === "intelligence:PULLBACK_4060_300_AGENTIC_V2");

  const routing = rt.executionRoutingStatus();
  const operational = routing.sources.find((s) => s.source.startsWith("intelligence:"));
  const legacyExperiment = routing.sources.find((s) => s.source.startsWith("experiment:"));
  ok("roteamento: fonte operacional permitida; experimentos legados bloqueados", operational?.canReachRequestOrder === true && legacyExperiment?.canReachRequestOrder === false);
  ok("roteamento: politica nova (OPERATIONAL_V2_PLUS_TEST_PATHS) e killSwitch default ligado", routing.policy === OPERATIONAL_EXECUTION_POLICY_NAME && routing.killSwitchExecutionEnabled === true && routing.realLocked === true);
  const serverSrc = fs.readFileSync(new URL("../relay/server.mjs", import.meta.url), "utf8");
  ok("server usa a MESMA politica (fonte unica) sem entradas Blitz/lab legadas", serverSrc.includes("operationalAllowlist()") && serverSrc.includes("OPERATIONAL_EXECUTION_POLICY_NAME") && !/AGENTIC_BLITZ|lab:AGENTIC_RSI_FIB/.test(serverSrc));
}

/* 4) submit legado renomeado: PATH_TEST e PRACTICE-only/300s/testOnly; nenhuma semantica LAB */
{
  const rtSrc = fs.readFileSync(new URL("../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
  ok("submitLabPracticeOrder removido; submitPathTestOrder e o unico submit de teste", !/submitLabPracticeOrder/.test(rtSrc) && /submitPathTestOrder/.test(rtSrc));
  ok("PATH_TEST: PRACTICE-only + 300s + testOnly/excludedFromStats", /TEST_PATH_PRACTICE_ONLY/.test(rtSrc) && /testOnly: true, excludedFromStats: true/.test(rtSrc) && /OPERATIONAL_EXPIRY_SECONDS/.test(rtSrc));
}

console.log(fail === 0 ? `RUNTIME_INTEGRITY_TESTS ALL_PASS (${pass}/${pass})` : `RUNTIME_INTEGRITY_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
