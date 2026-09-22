import { AssetContext } from "file:///D:/tracecom/repo/relay/intelligence/asset-context.mjs";
import { computeFeatures, deepFreeze, stableStringify } from "file:///D:/tracecom/repo/relay/intelligence/features.mjs";
import { runSpecialists } from "file:///D:/tracecom/repo/relay/intelligence/specialists.mjs";
import { consensus } from "file:///D:/tracecom/repo/relay/intelligence/consensus.mjs";
import { buildDecisionSnapshot, decisionFromSnapshot } from "file:///D:/tracecom/repo/relay/intelligence/decision-snapshot.mjs";
import { SinglePath } from "file:///D:/tracecom/repo/relay/execution/single-path.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const BASE = 1_700_000_000_000;
const buildSeries = () => {
  let at = BASE; const out = [];
  const push = (price, width = 0.0005) => { out.push({ at, open: price, high: price + width, low: price - width, close: price }); at += 60_000; };
  const run = (n, from, step) => { let p = from; for (let i = 0; i < n; i += 1) { p += step; push(p); } };
  for (let i = 0; i < 4; i += 1) push(1.0000);
  run(6, 1.0000, 0.0010); run(5, 1.0060, -0.0010); run(8, 1.0010, 0.0010); run(4, 1.0090, -0.0010); run(10, 1.0050, 0.0010); run(6, 1.0150, -0.0010);
  return out;
};
const ctx = new AssetContext({ marketKey: "EURUSD-OTC" });
ctx.ingestMany(buildSeries());
const features = computeFeatures(ctx);
const specialists = runSpecialists(features);
const consensusReal = consensus(features, specialists);
console.log(`RESUMO features=${!!features} rsi=${features?.rsi?.value?.toFixed(1)} adx=${features?.dmi?.adx?.toFixed(1)} estrutura=${features?.structure} side=${consensusReal.side} blockers=${consensusReal.blockers.join(",") || "nenhum"}`);

ok("features computadas e congeladas", !!features && Object.isFrozen(features) && Object.isFrozen(features.rsi));
ok("rsi em 0..100", features.rsi.value >= 0 && features.rsi.value <= 100 && features.rsi.zone !== null);
ok("atr positivo e volRatio numerico", features.atr > 0 && Number.isFinite(features.volRatio));
ok("adx em 0..100 com DI", features.dmi.adx >= 0 && features.dmi.adx <= 100 && Number.isFinite(features.dmi.plusDi) && Number.isFinite(features.dmi.minusDi));
ok("bollinger com percentB", features.bollinger && Number.isFinite(features.bollinger.percentB));
ok("determinismo das features", stableStringify(computeFeatures(ctx)) === stableStringify(features));

ok("5 especialistas AssetContext-first", specialists.length === 5 && specialists.every((s) => s.featuresVersion === features.version && s.featuresAt === features.at));
ok("especialistas na ordem do contrato", specialists.map((s) => s.specialist).join(",") === "rsi,dmi,bollinger,atr,priceAction");
ok("saidas congeladas com contrato completo", specialists.every((s) => Object.isFrozen(s) && typeof s.domainAssessment === "string" && Array.isArray(s.supportingEvidence) && Array.isArray(s.counterEvidence) && Array.isArray(s.blockers) && typeof s.summary === "string"));
ok("consensus somente BUY/SELL/WAIT sem confidence", ["BUY", "SELL", "WAIT"].includes(consensusReal.side) && !("confidence" in consensusReal) && Object.isFrozen(consensusReal));

const buyFeatures = deepFreeze({
  marketKey: "EURUSD-OTC", version: 7, at: BASE + 42 * 60_000, candles: 43, structure: "UPTREND", regime: "UPTREND", close: 1.0060, atr: 0.0010, volRatio: 1.1,
  rsi: { value: 34.5, zone: "LOW" },
  dmi: { adx: 27, plusDi: 31, minusDi: 18, trending: true },
  bollinger: { bandwidth: 0.0012, percentB: 0.45, expanding: true },
  priceAction: { bodyRatio: 0.4, closeInRange: 0.55, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.9 }, nearestZone: null, lastBOS: { type: "BOS_UP", at: BASE + 40 * 60_000 }, lastCHoCH: null },
});
const buySpecialists = runSpecialists(buyFeatures);
const buyConsensus = consensus(buyFeatures, buySpecialists);
ok("consensus BUY no cenario uptrend+pullback+RSI baixo+DMI alta+ATR vivo", buyConsensus.side === "BUY" && buyConsensus.thesis.length >= 4);

const sellFeatures = deepFreeze({ ...buyFeatures, structure: "DOWNTREND", regime: "DOWNTREND", rsi: { value: 66.2, zone: "HIGH" }, dmi: { adx: 26, plusDi: 18, minusDi: 30, trending: true }, priceAction: { ...buyFeatures.priceAction, direction: "DOWN", pullback: { active: true, direction: "DOWN_TREND_PULLBACK", depth: "SHALLOW", distanceAtr: 0.4 } } });
ok("consensus SELL espelhado", consensus(sellFeatures, runSpecialists(sellFeatures)).side === "SELL");

const rangeFeatures = deepFreeze({ ...buyFeatures, structure: "RANGE", regime: "RANGE", rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 14, plusDi: 22, minusDi: 21, trending: false }, priceAction: { ...buyFeatures.priceAction, pullback: { active: false, direction: null, depth: null, distanceAtr: null } } });
const rangeConsensus = consensus(rangeFeatures, runSpecialists(rangeFeatures));
ok("consensus WAIT com razoes listadas", rangeConsensus.side === "WAIT" && rangeConsensus.unsatisfied.includes("ADX_RANGE"));

const snapA = buildDecisionSnapshot({ features: buyFeatures, specialists: buySpecialists, consensus: buyConsensus, decidedAt: BASE + 42 * 60_000 });
const snapB = buildDecisionSnapshot({ features: buyFeatures, specialists: buySpecialists, consensus: buyConsensus, decidedAt: BASE + 42 * 60_000 });
ok("snapshot imutavel (deep freeze)", Object.isFrozen(snapA) && Object.isFrozen(snapA.features) && Object.isFrozen(snapA.specialists) && Object.isFrozen(snapA.consensus));
ok("snapshot hash deterministico", snapA.id === snapB.id && snapA.id.length === 64);
ok("snapshot muda quando o consensus muda", buildDecisionSnapshot({ features: buyFeatures, specialists: buySpecialists, consensus: { ...buyConsensus, side: "WAIT" }, decidedAt: BASE + 42 * 60_000 }).id !== snapA.id);
ok("snapshot rejeita expiracao != 300s", (() => { try { buildDecisionSnapshot({ features: buyFeatures, specialists: buySpecialists, consensus: buyConsensus, decidedAt: BASE, expirySeconds: 60 }); return false; } catch { return true; } })());

const decision = decisionFromSnapshot(snapA, { strategyId: "PULLBACK_4060_300", strategyVersion: "v2", strategyHash: "sha256:abc" });
ok("decision referencia o snapshot (mesma inteligencia)", decision.snapshotId === snapA.id && decision.side === "BUY" && Object.isFrozen(decision));
ok("decision rejeita WAIT", (() => { try { decisionFromSnapshot({ ...snapA, consensus: { ...buyConsensus, side: "WAIT" } }, {}); return false; } catch { return true; } })());

const WALL = 1_700_000_500_000;
const SERVER = 1_700_000_060_000;
const path = new SinglePath({ now: () => WALL });
path.timing.syncServerTime(SERVER, WALL);
const strategy = { status: "ACTIVE", executable: true, strategyHash: "sha256:abc" };
const practice = path.evaluate({ decision, strategy, accountMode: "PRACTICE" });
const real = path.evaluate({ decision, strategy, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" } });
ok("mesma ConsensusDecision/timing/fingerprint entre contas", practice.entry.allowed && real.entry.allowed && practice.entry.fingerprint === real.entry.fingerprint && practice.entry.expiryAt === real.entry.expiryAt);
ok("somente o destino difere", practice.entry.account === "PRACTICE" && real.entry.account === "REAL" && practice.route.requiresConfirmation === false && real.route.requiresConfirmation === true);
ok("nenhuma confianca percentual em nenhuma camada", !("confidence" in buyConsensus) && !("confidence" in (buySpecialists[0] ?? {})) && !("confidence" in features));

console.log(fail === 0 ? `STAGE3_PIPELINE_TESTS ALL_PASS (${pass}/${pass})` : `STAGE3_PIPELINE_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
