import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";
import { RuntimeIntelligence } from "../relay/intelligence/runtime-adapter.mjs";
import { deepFreeze } from "../relay/intelligence/features.mjs";
import { operationalAllowlist, OPERATIONAL_EXECUTION_POLICY_NAME } from "../relay/execution/operational-policy.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const ACTIVE = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "ACTIVE", executable: true, strategyHash: "sha256:v2-test", statsEpoch: "2026-09-22T21:53:19.302Z" });
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
const waitFeatures = deepFreeze({ ...buyFeatures, structure: "RANGE", regime: "RANGE", rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 10, plusDi: 20, minusDi: 20, trending: false }, priceAction: { ...buyFeatures.priceAction, pullback: { active: false, direction: null, depth: null, distanceAtr: null } } });

const executions = [];
const pool = { query: async (text) => {
  const sql = String(text);
  if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }] };
  if (sql.includes("SELECT broker_result")) return { rows: executions.filter((e) => e.excludedFromStats !== true).map((e) => ({ broker_result: e.brokerResult, profit: e.profit })) };
  if (sql.includes("FROM iq_executions") && sql.includes("ORDER BY requested_at")) return { rows: executions };
  return { rows: [] };
} };

async function mkReadyIntel(features) {
  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => series });
  await intel.start(["EURUSD:OTC"]);
  intel.onClosedCandle("EURUSD:OTC", mk5s(1, series[series.length - 1].at + 5000)[0]);
  intel.registry.get("EURUSD:OTC").evaluate(features);
  return intel;
}

function mkRuntime() {
  const rt = new IqMultiRuntime({ pool, log: () => {}, executionAllowlist: operationalAllowlist(), executionPolicyName: OPERATIONAL_EXECUTION_POLICY_NAME });
  rt.now = () => NOW;
  rt.client = { serverNow: () => NOW };
  rt.connection = { connectionId: "c1" };
  rt.session = { ...rt.session, connected: true, serverTimeMs: NOW, timeValid: true };
  rt.armState.onConnected("PRACTICE");
  rt.armState.onMarketData(true);
  rt.armState.arm(50, { explicitConfirmation: true });
  rt.accountContext.context = "PRACTICE";
  const ctx = rt.markets.get("EURUSD:OTC");
  ctx.enabled = true; ctx.availability = "OPEN"; ctx.activeId = 1; ctx.payout = 90; ctx.instrumentTypes = ["turbo", "binary"];
  const calls = [];
  rt.requestOrder = async (input) => {
    calls.push(input);
    const row = {
      executionId: "E" + calls.length, idempotencyKey: input.idempotencyKey, decisionId: input.decisionId, marketKey: input.marketKey, mode: "PRACTICE",
      accountType: "PRACTICE", accountContext: "PRACTICE", brokerOrderId: "B" + calls.length, symbol: ctx.display, activeId: ctx.activeId, direction: input.direction,
      stake: 2, currency: "USD", state: "ACKNOWLEDGED", entryPrice: 1.35, brokerResult: null, profit: null, payout: 90, meta: {},
      strategyVersion: input.operational?.strategyVersion ?? null, strategyHash: input.operational?.strategyHash ?? null, statsEpoch: input.operational?.statsEpoch ?? null,
      snapshotHash: input.operational?.snapshotHash ?? null, decisionSnapshot: input.operational?.decisionSnapshot ?? null,
      testOnly: input.operational?.testOnly === true, excludedFromStats: input.operational?.excludedFromStats === true,
      requestedAt: new Date(NOW).toISOString(), expirationAt: new Date(NOW + 300_000).toISOString(),
    };
    executions.unshift(row);
    return { state: "ACKNOWLEDGED", brokerOrderId: row.brokerOrderId, executionId: row.executionId, stake: 2 };
  };
  return { rt, calls, ctx };
}

/* 1) E2E plumbing pelo caminho canonico: IQ 5s -> #ingestCandle -> #pipeClosedCandle -> RuntimeIntelligence -> dispatch -> requestOrder */
{
  const { rt, calls } = mkRuntime();
  rt.intelligenceDispatch.intelligence = await mkReadyIntel(buyFeatures);
  rt.intelligenceDispatch.strategy = ACTIVE;
  const candle = { active_id: 1, size: 5, at: Math.round((series[series.length - 1].at + 5000) / 1000), open: 1.35, high: 1.351, low: 1.349, close: 1.3505 };
  rt.ingestEvent("candle-generated", { msg: candle, receivedAt: NOW, connectionId: "c1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok("E2E: candle nativo 5s percorre o caminho unico ate requestOrder", calls.length === 1 && calls[0].horizonSeconds === 300 && calls[0].source === "intelligence:PULLBACK_4060_300_AGENTIC_V2");
  ok("E2E: operacional carrega strategyVersion/hash/statsEpoch/snapshotHash (nao PATH_TEST)", calls[0].operational?.strategyVersion === ACTIVE.version && calls[0].operational?.strategyHash === ACTIVE.strategyHash && calls[0].operational?.statsEpoch === ACTIVE.statsEpoch && typeof calls[0].operational?.snapshotHash === "string" && calls[0].operational?.testOnly === false && calls[0].operational?.excludedFromStats === false);
  ok("E2E: ordem nao e duplicada no mesmo snapshot", await (async () => { rt.ingestEvent("candle-generated", { msg: candle, receivedAt: NOW, connectionId: "c1" }); await new Promise((r) => setTimeout(r, 20)); return calls.length === 1; })());
  const history = await rt.recentExecutions(10, null, "PRACTICE");
  ok("E2E: historico le a execucao com strategyVersion/strategyHash", history.length === 1 && history[0].strategyVersion === ACTIVE.version && history[0].strategyHash === ACTIVE.strategyHash && history[0].excludedFromStats === false);
}

/* 2) WAIT nunca toca o broker pelo caminho canonico */
{
  const { rt, calls } = mkRuntime();
  rt.intelligenceDispatch.intelligence = await mkReadyIntel(waitFeatures);
  rt.intelligenceDispatch.strategy = ACTIVE;
  const candle = { active_id: 1, size: 5, at: Math.round((series[series.length - 1].at + 5000) / 1000), open: 1.35, high: 1.351, low: 1.349, close: 1.3505 };
  rt.ingestEvent("candle-generated", { msg: candle, receivedAt: NOW, connectionId: "c1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok("E2E: WAIT gera AnalysisState e zero ordem", calls.length === 0 && rt.assetIntelligence !== null);
}

/* 3) PATH_TEST: PRACTICE-only, 300s, testOnly/excludedFromStats; REAL -> DRY_RUN sem ordem */
{
  const { rt, calls } = mkRuntime();
  const order = await rt.submitPathTestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", strategyId: "AGENTIC_PATH_TEST", strategyTradeId: "pathtest:1", stake: 2 });
  ok("PATH_TEST: PRACTICE-only 300s com marcadores testOnly/excludedFromStats", calls.length === 1 && calls[0].horizonSeconds === 300 && calls[0].source === "pathtest:AGENTIC_PATH_TEST" && order.testOnly === true && order.excludedFromStats === true);
  rt.config.mode = "REAL";
  const before = calls.length;
  const dry = await rt.submitPathTestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", strategyId: "AGENTIC_PATH_TEST", strategyTradeId: "pathtest:2", stake: 2 });
  ok("PATH_TEST: em REAL nunca envia (DRY_RUN)", dry.state === "DRY_RUN" && dry.testOnly === true && calls.length === before);
  const history = await rt.recentExecutions(10, null, "PRACTICE");
  ok("PATH_TEST: excluido das estatisticas (excludedFromStats na linha)", history.some((row) => row.excludedFromStats === true));
  const stats = await rt.strategyStats(ACTIVE.version);
  ok("E2E: stats da V2 excluem PATH_TEST", stats.operations === 0 && stats.winRate === null);
}

/* 4) REAL fail-closed pelo caminho operacional (nenhuma ordem REAL) */
{
  const { rt, calls } = mkRuntime();
  rt.intelligenceDispatch.intelligence = await mkReadyIntel(buyFeatures);
  rt.intelligenceDispatch.strategy = ACTIVE;
  rt.intelligenceDispatch.accountMode = () => "REAL";
  rt.intelligenceDispatch.realArmed = () => false;
  const candle = { active_id: 1, size: 5, at: Math.round((series[series.length - 1].at + 5000) / 1000), open: 1.35, high: 1.351, low: 1.349, close: 1.3505 };
  rt.ingestEvent("candle-generated", { msg: candle, receivedAt: NOW, connectionId: "c1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok("REAL desarmado: decisao existe mas zero ordem REAL", calls.length === 0 && rt.intelligenceDispatch.status().counters.denied > 0);
}

/* 5) regressao: ingestao continua com modulos shadow desligados (timingShadow/scenarioShadow nulos) */
{
  const { rt, calls } = mkRuntime();
  rt.requestOrder = async (input) => { calls.push(input); return { state: "ACKNOWLEDGED", brokerOrderId: "B9", executionId: "E9" }; };
  let thrown = null;
  for (let i = 0; i < 6; i += 1) {
    const t = NOW + i * 5000;
    rt.now = () => t;
    rt.client = { serverNow: () => t };
    const base = 1.35 + i * 0.0001;
    try {
      rt.ingestEvent("candle-generated", { msg: { active_id: 1, size: 5, at: Math.round(t / 1000), open: base, high: base + 0.0002, low: base - 0.0002, close: base + 0.00005 }, receivedAt: t, connectionId: "c1" });
    } catch (error) { thrown = error; break; }
  }
  const ctx = rt.markets.get("EURUSD:OTC");
  ok("regressao: 6 candles processados sem excecao com shadow modules nulos", thrown === null && ctx.candles.size >= 6 && ctx.featureState?.fresh === true);
}

console.log(fail === 0 ? `E2E_PRACTICE_TESTS ALL_PASS (${pass}/${pass})` : `E2E_PRACTICE_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
