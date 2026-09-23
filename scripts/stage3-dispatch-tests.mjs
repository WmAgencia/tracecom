import fs from "node:fs";
import { RuntimeIntelligence, FEED_STALE } from "../relay/intelligence/runtime-adapter.mjs";
import { deepFreeze } from "../relay/intelligence/features.mjs";
import { SinglePath } from "../relay/execution/single-path.mjs";
import { IntelligenceDispatch } from "../relay/execution/intelligence-dispatch.mjs";
import { loadOperationalStrategy } from "../relay/execution/operational-strategy.mjs";
import { nextOperationalExpiryAt } from "../relay/execution/binary300.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const ACTIVE = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "ACTIVE", executable: true, strategyHash: "sha256:v2-test" });
const PENDING = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null });
const READY_FOR_DEPLOY = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "READY_FOR_DEPLOY", executable: false, strategyHash: "sha256:v2-test" });

const mk5s = (n, startAt, stepMs = 5000) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * stepMs, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const series = mk5s(2161, NOW - 10_800_000);
const nextCandle = () => mk5s(1, series[series.length - 1].at + 5000)[0];

const featuresFor = ({ marketKey = "EURUSD:OTC", at = NOW, structure = "UPTREND", regime = null, rsiZone = "LOW", rsiValue = 34, dmi = { adx: 29, plusDi: 33, minusDi: 18, trending: true }, atr = 0.0012, volRatio = 1.05, pullback = { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 }, lastCHoCH = null, lastBOS = null } = {}) => deepFreeze({
  marketKey, version: 9001, at, candles: 2161, structure, regime: regime ?? structure, close: 1.35, atr, volRatio,
  rsi: { value: rsiValue, zone: rsiZone },
  dmi,
  bollinger: { bandwidth: 0.0014, percentB: 0.44, expanding: true },
  priceAction: { bodyRatio: 0.45, closeInRange: 0.6, direction: "UP", pullback, nearestZone: null, lastBOS, lastCHoCH },
});

const buyFeatures = featuresFor({});
const sellFeatures = featuresFor({
  structure: "DOWNTREND", rsiZone: "HIGH", rsiValue: 66,
  dmi: { adx: 29, plusDi: 18, minusDi: 33, trending: true },
  pullback: { active: true, direction: "DOWN_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 },
});

async function mkIntel({ marketKey = "EURUSD:OTC", features = buyFeatures, strategy = ACTIVE, now = () => NOW, loader = async () => series, feed = true } = {}) {
  const intel = new RuntimeIntelligence({ now, strategy, loader });
  await intel.start([marketKey]);
  if (feed) intel.onClosedCandle(marketKey, nextCandle());
  if (features) intel.registry.get(marketKey).evaluate(features);
  return intel;
}

function mkPath({ now = () => NOW, killSwitch = false, accountMode = "PRACTICE", realArmed = false, accountContext = null } = {}) {
  const state = { killSwitch, accountMode, realArmed, accountContext };
  const path = new SinglePath({ now });
  const dispatch = new IntelligenceDispatch({
    singlePath: path,
    strategy: ACTIVE,
    requestOrder: async () => ({ state: "ACKNOWLEDGED", brokerOrderId: "B1" }),
    killSwitchEngaged: () => state.killSwitch,
    accountMode: () => state.accountMode,
    realArmed: () => state.realArmed,
    accountContext: () => state.accountContext,
    serverTimeMs: () => NOW,
    now,
  });
  return { path, dispatch, state };
}

function mkOrderRecorder({ delayFor = () => 0 } = {}) {
  const calls = [];
  const completed = [];
  const record = async (input) => {
    calls.push(input);
    const delay = delayFor(input.marketKey);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    completed.push(input.marketKey);
    return { state: "ACKNOWLEDGED", brokerOrderId: `B-${calls.length}` };
  };
  return { calls, completed, record };
}

/* 1) BUY + ACTIVE + PRACTICE -> SinglePath -> requestOrder (300s, source operacional, entryTiming do bucket) */
{
  const intel = await mkIntel({});
  const { path, dispatch, state } = mkPath();
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const summary = await dispatch.dispatchOnce();
  const call = orders.calls[0];
  ok("BUY ACTIVE PRACTICE submete pelo caminho unico", summary.submitted.length === 1 && summary.submitted[0].account === "PRACTICE" && orders.calls.length === 1);
  ok("ordem operacional e 300s com source intelligence:<strategyVersion>", call?.horizonSeconds === 300 && call?.source === "intelligence:PULLBACK_4060_300_AGENTIC_V2");
  ok("entryTiming aponta para o bucket de 5 minutos (targetExpirySec)", call?.entryTiming?.targetExpirySec === nextOperationalExpiryAt(NOW) / 1000 && call?.entryTiming?.targetExpiryAt === nextOperationalExpiryAt(NOW));
  ok("idempotency/decisionId = snapshotId (dedup por snapshot)", call?.idempotencyKey === summary.submitted[0].snapshotId && call?.decisionId === summary.submitted[0].snapshotId);
  const second = await dispatch.dispatchOnce();
  ok("mesmo snapshot nao gera segunda ordem (DUPLICATE/DENY)", second.submitted.length === 0 && orders.calls.length === 1);
}

/* 2) V2 PENDING_IMPLEMENTATION / READY_FOR_DEPLOY -> DENY, requestOrder calls=0 */
{
  for (const strategy of [PENDING, READY_FOR_DEPLOY]) {
    const intel = await mkIntel({ strategy });
    const { dispatch } = mkPath();
    const orders = mkOrderRecorder();
    dispatch.intelligence = intel;
    dispatch.requestOrder = orders.record;
    dispatch.strategy = strategy;
    const summary = await dispatch.dispatchOnce();
    ok(`${strategy.status} -> DENY sem ordem`, summary.submitted.length === 0 && summary.denied.every((d) => d.code === "STRATEGY_NOT_ACTIVE") && orders.calls.length === 0);
  }
}

/* 3) WAIT nunca toca o SinglePath/requestOrder */
{
  const intel = await mkIntel({ features: featuresFor({ structure: "RANGE", rsiZone: "NEUTRAL", rsiValue: 50, dmi: { adx: 12, plusDi: 20, minusDi: 20, trending: false }, pullback: { active: false, direction: null, depth: null, distanceAtr: null } }) });
  const { dispatch } = mkPath();
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const summary = await dispatch.dispatchOnce();
  ok("WAIT -> considered=0, zero ordem (broker calls=0)", summary.considered === 0 && summary.submitted.length === 0 && orders.calls.length === 0);
}

/* 4) lock por ativo: A em voo NAO bloqueia B */
{
  const intelA = await mkIntel({ marketKey: "EURUSD:OTC" });
  const intelB = await mkIntel({ marketKey: "USDJPY:OTC", features: featuresFor({ marketKey: "USDJPY:OTC" }) });
  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE });
  intel.ready = true; intel.initialized = true;
  intel.registry = { get: (key) => (key === "EURUSD:OTC" ? intelA.registry.get("EURUSD:OTC") : intelB.registry.get("USDJPY:OTC")), status: () => [...intelA.registry.status(), ...intelB.registry.status()], actionable: () => [...intelA.registry.actionable(), ...intelB.registry.actionable()] };
  intel.decisions = () => [...intelA.decisions(), ...intelB.decisions()];
  intel.health = () => ({ state: "READY", initialized: true, intelligenceReady: true, assetsTotal: 2, assetsReady: 2, assetsPartial: 0, assetsFailed: 0, initError: null, strategyVersion: ACTIVE.version, strategyStatus: ACTIVE.status, observedIntervalMs: 5000, lastPipelineUpdateAt: NOW, lastHydrationAt: NOW, expectedIntervalMs: 5000 });
  intel.feedStatusFor = () => "OK";
  const { dispatch } = mkPath();
  const orders = mkOrderRecorder({ delayFor: (key) => (key === "EURUSD:OTC" ? 60 : 0) });
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const first = dispatch.dispatchOnce();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const bDoneWhileAInFlight = orders.completed.includes("USDJPY:OTC") && !orders.completed.includes("EURUSD:OTC") && dispatch.inFlight.has("EURUSD:OTC");
  const firstSummary = await first;
  ok("lock por ativo: EURUSD em voo nao bloqueia USDJPY", bDoneWhileAInFlight && firstSummary.submitted.some((s) => s.marketKey === "USDJPY:OTC"));
  ok("apos liberar o lock, EURUSD tambem submete (1x cada)", orders.calls.filter((c) => c.marketKey === "EURUSD:OTC").length === 1 && orders.calls.filter((c) => c.marketKey === "USDJPY:OTC").length === 1);
}

/* 5) kill-switch race: gate PASS -> killSwitch ON antes do submit -> DENY, calls=0 */
{
  const intel = await mkIntel({});
  const { path, dispatch, state } = mkPath();
  const orders = mkOrderRecorder();
  const originalEvaluate = path.evaluate.bind(path);
  let gatePassed = 0;
  path.evaluate = (input) => { const result = originalEvaluate(input); if (result.entry.allowed === true) gatePassed += 1; state.killSwitch = true; return result; };
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const summary = await dispatch.dispatchOnce();
  ok("race: gate PASS com killSwitch ligando antes do submit -> PRE_SUBMIT DENY", gatePassed === 1 && summary.submitted.length === 0 && summary.denied.some((d) => d.code === "KILL_SWITCH_ENGAGED" && d.stage === "PRE_SUBMIT"));
  ok("race: requestOrder calls=0", orders.calls.length === 0);
}

/* 6) kill-switch ja ligado -> SINGLE_PATH DENY */
{
  const intel = await mkIntel({});
  const { dispatch } = mkPath({ killSwitch: true });
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const summary = await dispatch.dispatchOnce();
  ok("killSwitch ligado -> KILL_SWITCH_ENGAGED sem ordem", summary.denied.some((d) => d.code === "KILL_SWITCH_ENGAGED") && orders.calls.length === 0);
}

/* 7) decisao velha -> DECISION_STALE (revalidation, sem recalcular especialistas) */
{
  const intel = await mkIntel({ features: featuresFor({ at: NOW - 10_000 }) });
  const { dispatch } = mkPath();
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const summary = await dispatch.dispatchOnce();
  ok("decisao com mais de 5s -> DECISION_STALE, calls=0", summary.denied.some((d) => d.code === "DECISION_STALE") && orders.calls.length === 0);
}

/* 8) REAL fail-closed sem arm; com arm roteia REAL com MESMO fingerprint do PRACTICE */
{
  const intel = await mkIntel({});
  const { dispatch } = mkPath({ accountMode: "REAL", realArmed: false });
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  const denied = await dispatch.dispatchOnce();
  ok("REAL sem arm -> REAL_FAIL_CLOSED, calls=0", denied.denied.some((d) => d.code === "REAL_FAIL_CLOSED") && orders.calls.length === 0);

  const decision = intel.decisions()[0].decision;
  const practice = mkPath({ accountMode: "PRACTICE" });
  const real = mkPath({ accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" } });
  const practiceEntry = practice.path.evaluate({ decision, strategy: ACTIVE, accountMode: "PRACTICE", serverTimeMs: NOW });
  const realEntry = real.path.evaluate({ decision, strategy: ACTIVE, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" }, serverTimeMs: NOW });
  ok("paridade PRACTICE/REAL: mesma decisao -> mesmo fingerprint/expiracao", practiceEntry.entry.allowed === true && realEntry.entry.allowed === true && practiceEntry.entry.fingerprint === realEntry.entry.fingerprint && practiceEntry.entry.expiryAt === realEntry.entry.expiryAt && practiceEntry.entry.account === "PRACTICE" && realEntry.entry.account === "REAL");
}

/* 9) readiness: PENDING/PARTIAL/FAILED -> DENY; INTERVAL_INCOMPATIBLE -> DENY; FUTURE_CANDLES -> DENY */
{
  const pending = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE });
  const { dispatch: d1 } = mkPath();
  const o1 = mkOrderRecorder();
  d1.intelligence = pending; d1.requestOrder = o1.record;
  const s1 = await d1.dispatchOnce();

  const partialIntel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => mk5s(1200, NOW - 6_000_000) });
  await partialIntel.start(["EURUSD:OTC"]);
  partialIntel.onClosedCandle("EURUSD:OTC", nextCandle());
  partialIntel.registry.get("EURUSD:OTC").evaluate(buyFeatures);
  const { dispatch: d2 } = mkPath();
  const o2 = mkOrderRecorder();
  d2.intelligence = partialIntel; d2.requestOrder = o2.record;
  const s2 = await d2.dispatchOnce();

  const failedIntel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => { throw new Error("DB_DOWN"); } });
  await failedIntel.start(["EURUSD:OTC"]);
  const { dispatch: d3 } = mkPath();
  const o3 = mkOrderRecorder();
  d3.intelligence = failedIntel; d3.requestOrder = o3.record;
  const s3 = await d3.dispatchOnce();

  const incompatible = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => mk5s(200, NOW - 12_000_000, 60_000) });
  await incompatible.start(["EURUSD:OTC"]);
  const { dispatch: d4 } = mkPath();
  const o4 = mkOrderRecorder();
  d4.intelligence = incompatible; d4.requestOrder = o4.record;
  const s4 = await d4.dispatchOnce();

  const future = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => mk5s(2161, NOW + 600_000) });
  await future.start(["EURUSD:OTC"]);
  const { dispatch: d5 } = mkPath();
  const o5 = mkOrderRecorder();
  d5.intelligence = future; d5.requestOrder = o5.record;
  const s5 = await d5.dispatchOnce();

  ok("PENDING/PARTIAL/FAILED -> DENY sem ordem", s1.reason === "INTELLIGENCE_DEGRADED" && s2.reason === "INTELLIGENCE_DEGRADED" && s3.reason === "INTELLIGENCE_DEGRADED" && o1.calls.length + o2.calls.length + o3.calls.length === 0);
  ok("INTERVAL_INCOMPATIBLE e FUTURE_CANDLES -> DENY sem ordem", s4.reason === "INTELLIGENCE_DEGRADED" && s5.reason === "INTELLIGENCE_DEGRADED" && o4.calls.length + o5.calls.length === 0);
}

/* 10) feed STALE -> DENY; SEM COMPRA -> DENY */
{
  const intel = await mkIntel({});
  const { dispatch } = mkPath();
  const orders = mkOrderRecorder();
  dispatch.intelligence = intel;
  dispatch.requestOrder = orders.record;
  dispatch.intelligence.feedStatusFor = () => FEED_STALE;
  const stale = await dispatch.dispatchOnce();
  ok("feed STALE -> FEED_NOT_OK, calls=0", stale.denied.some((d) => d.code === "FEED_NOT_OK") && orders.calls.length === 0);

  dispatch.intelligence.feedStatusFor = () => "OK";
  dispatch.marketStateFor = () => ({ tradable: true, purchaseStatus: "UNAVAILABLE" });
  const noBuy = await dispatch.dispatchOnce();
  ok("SEM COMPRA -> BROKER_PURCHASE_UNAVAILABLE, calls=0", noBuy.denied.some((d) => d.code === "BROKER_PURCHASE_UNAVAILABLE") && orders.calls.length === 0);
}

/* 11) fixtures de consenso: RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE -> WAIT; TREND_RESUMING UP/DOWN -> elegivel */
{
  const fixtures = [
    ["RANGE", featuresFor({ structure: "RANGE", rsiZone: "NEUTRAL", rsiValue: 50, dmi: { adx: 12, plusDi: 20, minusDi: 20, trending: false }, pullback: { active: false, direction: null, depth: null, distanceAtr: null } }), "WAIT"],
    ["TRANSITION", featuresFor({ structure: "RANGE", regime: "TRANSITION", rsiZone: "NEUTRAL", rsiValue: 52, dmi: { adx: 15, plusDi: 22, minusDi: 20, trending: false }, pullback: { active: false, direction: null, depth: null, distanceAtr: null } }), "WAIT"],
    ["REVERSAL_RISK", featuresFor({ lastCHoCH: { type: "CHOCH_DOWN", at: NOW - 60_000, price: 1.34 } }), "WAIT"],
    ["PULLBACK_ACTIVE", featuresFor({ rsiZone: "NEUTRAL", rsiValue: 52 }), "WAIT"],
    ["TREND_RESUMING_UP", buyFeatures, "BUY"],
    ["TREND_RESUMING_DOWN", sellFeatures, "SELL"],
  ];
  let allOk = true;
  for (const [name, features, expected] of fixtures) {
    const intel = await mkIntel({ features });
    const pipeline = intel.registry.get("EURUSD:OTC");
    const side = pipeline.consensus?.side ?? null;
    const decisions = intel.decisions();
    const eligible = decisions.length === 1 && decisions[0].decision.side === expected;
    if (side !== expected || (expected === "WAIT" && decisions.length !== 0) || (expected !== "WAIT" && !eligible)) { allOk = false; console.log(`  fixture ${name}: expected=${expected} side=${side} decisions=${decisions.length}`); }
  }
  ok("fixtures RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE=WAIT e TREND_RESUMING UP/DOWN elegiveis", allOk);
}

/* 12) manifesto real carrega fail-closed e nao esta ACTIVE */
{
  const strategy = loadOperationalStrategy();
  ok("manifesto real da V2 carrega com status/executavel coerentes", strategy.version === "PULLBACK_4060_300_AGENTIC_V2" && ["READY_FOR_DEPLOY", "ACTIVE"].includes(strategy.status) && (strategy.status === "ACTIVE" ? strategy.executable === true : strategy.executable === false));
  const bad = loadOperationalStrategy({ manifestPath: "estrategias/strategy-versions/NAO_EXISTE.json" });
  ok("manifesto invalido -> UNAVAILABLE, executable=false", bad.status === "UNAVAILABLE" && bad.executable === false && bad.strategyHash === null);
  const { path } = mkPath();
  const denied = path.evaluate({ decision: { side: "BUY", marketKey: "EURUSD:OTC", snapshotId: "s", decidedAt: NOW, strategyHash: null }, strategy: bad, serverTimeMs: NOW });
  ok("manifesto invalido -> STRATEGY_NOT_ACTIVE (sem ordem)", denied.entry.allowed === false && denied.entry.code === "STRATEGY_NOT_ACTIVE");
}

/* 13) prova estatica: dispatch nao seleciona conta, nao recalcula especialistas, nao tem confidence */
{
  const src = fs.readFileSync(new URL("../relay/execution/intelligence-dispatch.mjs", import.meta.url), "utf8");
  const runtimeSrc = fs.readFileSync(new URL("../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
  ok("dispatch nao seleciona conta (AccountRouter decide)", !/selectedAccount|practiceStrategy|realStrategy|practiceConsensus|realConsensus/.test(src));
  ok("dispatch nao recalcula especialistas/consensus (consome decisao pronta)", !/runSpecialists|consensus\(|computeFeatures/.test(src));
  ok("sem confidence percentual em nenhuma camada nova", !/confidence|certeza/i.test(src) && !/confidence|certeza/i.test(fs.readFileSync(new URL("../relay/execution/operational-strategy.mjs", import.meta.url), "utf8")) && !/confidence|certeza/i.test(fs.readFileSync(new URL("../relay/intelligence/decision-snapshot.mjs", import.meta.url), "utf8")));
  ok("agentExpirySeconds removido do runtime (autoridade unica = OPERATIONAL_EXPIRY_SECONDS)", !/agentExpirySeconds/.test(runtimeSrc) && /OPERATIONAL_EXPIRY_SECONDS/.test(runtimeSrc));
}

console.log(fail === 0 ? `DISPATCH_TESTS ALL_PASS (${pass}/${pass})` : `DISPATCH_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
