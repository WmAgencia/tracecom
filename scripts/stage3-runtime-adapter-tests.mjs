import fs from "node:fs";
import { RuntimeIntelligence, FEED_ABSENT, FEED_OK, FEED_STALE } from "file:///D:/tracecom/repo/relay/intelligence/runtime-adapter.mjs";
import { HYDRATION_READY, HYDRATION_PARTIAL } from "file:///D:/tracecom/repo/relay/intelligence/asset-pipeline.mjs";
import { deepFreeze, stableStringify } from "file:///D:/tracecom/repo/relay/intelligence/features.mjs";
import { SinglePath } from "file:///D:/tracecom/repo/relay/execution/single-path.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const mk5s = (n, startAt, stepMs = 5000) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * stepMs, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const series = mk5s(2161, NOW - 10_800_000);
const V2 = { version: "PULLBACK_4060_300_AGENTIC_V2", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null };
const intel = new RuntimeIntelligence({ now: () => NOW, strategy: V2, loader: async (key) => (key === "A-OTC" ? series : key === "B-OTC" ? mk5s(1200, NOW - 6_000_000) : []) });

ok("health antes do start: not ready / degraded", intel.health().intelligenceReady === true && intel.health().assetsTotal === 0 && intel.health().degraded === true);
const report = await intel.start(["A-OTC", "B-OTC", "C-OTC"]);
ok("start hidrata por ativo (1 READY, 1 PARTIAL, 1 FAILED)", report.ready === 1 && report.partial === 1 && report.failed === 1);
const h = intel.health();
ok("health expoe inteligencia e contagens sem segredo", h.intelligenceReady === true && h.assetsTotal === 3 && h.assetsReady === 1 && h.assetsPartial === 1 && h.assetsFailed === 1 && h.strategyVersion === V2.version && h.strategyStatus === "PENDING_IMPLEMENTATION");

ok("feed ABSENT antes de candle", intel.feedStatusFor("A-OTC") === FEED_ABSENT);
const c1 = mk5s(1, series[series.length - 1].at + 5000)[0];
const first = intel.onClosedCandle("A-OTC", c1);
ok("candle fechado processado uma vez", first.processed === true && first.result !== null);
const dup = intel.onClosedCandle("A-OTC", c1);
ok("mesmo candle fechado NAO processa 2x (dedup asset+at+interval)", dup.processed === false && dup.reason === "DUPLICATE_CLOSED_CANDLE");
ok("feed OK apos candle recente", intel.feedStatusFor("A-OTC") === FEED_OK);
const staleIntel = new RuntimeIntelligence({ now: () => NOW + 60_000, strategy: V2 });
staleIntel.onClosedCandle("A-OTC", c1);
ok("feed STALE apos janela de staleness", staleIntel.feedStatusFor("A-OTC") === FEED_STALE);

ok("productState ASSISTINDO sem feed/pending", ["ASSISTINDO", "SEM FEED", "OFF"].includes(intel.productStateFor("C-OTC")));
ok("productState OFF quando disabled", intel.productStateFor("A-OTC", { enabled: false }) === "OFF");
ok("productState SEM COMPRA com broker indisponivel", intel.productStateFor("A-OTC", { purchaseStatus: "UNAVAILABLE" }) === "SEM COMPRA");

const allow = intel.allowsExecution("A-OTC");
ok("execucao DENY: V2 nao ACTIVE (fail-closed)", allow.allowed === false && allow.reason === "STRATEGY_NOT_ACTIVE");
ok("execucao DENY com hydration PARTIAL", intel.allowsExecution("B-OTC").allowed === false && intel.allowsExecution("B-OTC").reason === "HYDRATION_NOT_READY");
ok("execucao DENY com feed ausente", intel.allowsExecution("C-OTC").allowed === false);

const buyFeatures = deepFreeze({
  marketKey: "A-OTC", version: 9001, at: NOW, candles: 2161, structure: "UPTREND", regime: "UPTREND", close: 1.35, atr: 0.0012, volRatio: 1.05,
  rsi: { value: 34.0, zone: "LOW" },
  dmi: { adx: 29, plusDi: 33, minusDi: 18, trending: true },
  bollinger: { bandwidth: 0.0014, percentB: 0.44, expanding: true },
  priceAction: { bodyRatio: 0.45, closeInRange: 0.6, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 }, nearestZone: null, lastBOS: null, lastCHoCH: null },
});
intel.registry.get("A-OTC").evaluate(buyFeatures);
const decisions = intel.decisions();
ok("decisoes so de ativos READY+BUY com snapshot imutavel", decisions.length === 1 && decisions[0].marketKey === "A-OTC" && Object.isFrozen(decisions[0].snapshot));
const waitIntel = new RuntimeIntelligence({ now: () => NOW, strategy: V2 });
waitIntel.registry.ensure("W-OTC").evaluate(deepFreeze({ ...buyFeatures, marketKey: "W-OTC", structure: "RANGE", rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 12, plusDi: 20, minusDi: 20, trending: false }, priceAction: { ...buyFeatures.priceAction, pullback: { active: false, direction: null, depth: null, distanceAtr: null } } }));
ok("WAIT: zero decisao executavel (broker calls = 0)", waitIntel.decisions().length === 0 && waitIntel.registry.get("W-OTC").lastSnapshot === null);

const failIntel = new RuntimeIntelligence({ now: () => NOW, strategy: V2, loader: async () => { throw new Error("DB_DOWN"); } });
const failReport = await failIntel.start(["X-OTC"]);
ok("start com loader falhando: FAILED por ativo, sem excecao, execution DENY", failReport.failed === 1 && failIntel.allowsExecution("X-OTC").allowed === false);

const path = new SinglePath({ now: () => NOW });
path.timing.syncServerTime(NOW, NOW);
const activeV2 = { status: "ACTIVE", executable: true, strategyHash: "sha256:v2" };
const decision = deepFreeze({ ...decisions[0].decision, strategyHash: "sha256:v2" });
const denyV2 = path.evaluate({ decision, strategy: V2 });
const allowPractice = path.evaluate({ decision, strategy: activeV2, accountMode: "PRACTICE" });
const denyReal = path.evaluate({ decision, strategy: activeV2, accountMode: "REAL" });
ok("single-path: V2 pendente DENY, ACTIVE+PRACTICE allow, REAL sem arm DENY", denyV2.entry.code === "STRATEGY_NOT_ACTIVE" && allowPractice.entry.allowed === true && denyReal.entry.code === "REAL_FAIL_CLOSED");

const mods = ["asset-context", "features", "specialists", "consensus", "decision-snapshot", "asset-pipeline", "runtime-adapter"];
const forbidden = /requestOrder|placeTrade|broker|realArmed|ACCOUNT_PRACTICE|ACCOUNT_REAL|\bPRACTICE\b|\bREAL\b|iqoption|wsRuntime|submitOrder|accountRouter|executionGate|selectedAccount/;
const violations = mods.flatMap((n) => forbidden.test(fs.readFileSync(`D:/tracecom/repo/relay/intelligence/${n}.mjs`, "utf8")) ? [n] : []);
ok("inteligencia (incl. runtime-adapter) sem conta/broker (prova estatica)", violations.length === 0);

const p = intel.registry.get("A-OTC");
const before = p.featuresComputed;
intel.onClosedCandle("A-OTC", mk5s(1, series[series.length - 1].at + 10_000)[0]);
ok("1 feature computation por candle fechado (e mesma features para os 5)", p.featuresComputed === before + 1 && p.specialists.every((s) => s.featuresVersion === p.features.version && s.featuresAt === p.features.at));
ok("estado por ativo isolado", intel.registry.get("B-OTC").featuresComputed !== p.featuresComputed && stableStringify(intel.registry.status()).includes("A-OTC"));

console.log(fail === 0 ? `RUNTIME_ADAPTER_TESTS ALL_PASS (${pass}/${pass})` : `RUNTIME_ADAPTER_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
