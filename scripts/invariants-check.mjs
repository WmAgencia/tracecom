import fs from "node:fs";
import crypto from "node:crypto";
import { ExecutionGate } from "../relay/execution/execution-gate.mjs";
import { SinglePath } from "../relay/execution/single-path.mjs";
import { OPERATIONAL_EXPIRY_SECONDS, assertOperationalExpiry, nextOperationalExpiryAt } from "../relay/execution/binary300.mjs";
import { operationalAllowlist, OPERATIONAL_EXECUTION_POLICY_NAME } from "../relay/execution/operational-policy.mjs";
import { RuntimeIntelligence } from "../relay/intelligence/runtime-adapter.mjs";
import { AssetPipeline, HYDRATION_PARTIAL, productState } from "../relay/intelligence/asset-pipeline.mjs";
import { OPERATIONAL_CANDLE_INTERVAL_MS } from "../relay/intelligence/asset-context.mjs";
import { runSpecialists } from "../relay/intelligence/specialists.mjs";
import { consensus } from "../relay/intelligence/consensus.mjs";
import { buildDecisionSnapshot } from "../relay/intelligence/decision-snapshot.mjs";
import { computeFeatures, deepFreeze } from "../relay/intelligence/features.mjs";

let pass = 0; let fail = 0;
const ok = (name, condition, detail = "") => { if (condition) { pass += 1; console.log(`PASS ${name}`); } else { fail += 1; console.log(`FAIL ${name}${detail ? " :: " + detail : ""}`); } };
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(String(value).replace(/\r\n/g, "\n")).digest("hex");
const NOW = 1_800_000_000_000;
const runtime = read("relay/iq-multi-runtime.mjs");
const server = read("relay/server.mjs");
const grid = read("src/http/public/grid.html");
const dispatch = read("relay/execution/intelligence-dispatch.mjs");
const manifest = JSON.parse(read("estrategias/strategy-versions/PULLBACK_4060_300_AGENTIC_V2.json"));

ok("NO_BLITZ_RUNTIME", /rsiAgentsV2BlitzEnabled: false/.test(server) && !/blitz/i.test(grid) && !/submitBlitzOrder|BlitzOrder/.test(runtime) && /rsiAgentsV2BlitzEnabled = false/.test(runtime));
ok("BINARY_ONLY_NEW_TRADES", /instrumentType: "BINARY"/.test(dispatch) && /EXPERIMENT_LEGACY_BROKER_PATH_DISABLED/.test(runtime) && /AUTO_LEGACY_BROKER_PATH_DISABLED/.test(runtime));
ok("300_ONLY", OPERATIONAL_EXPIRY_SECONDS === 300 && assertOperationalExpiry(300) === 300 && nextOperationalExpiryAt(NOW) % 300_000 === 0 && /horizonSeconds = OPERATIONAL_EXPIRY_SECONDS/.test(runtime));
const submitLines = (source) => source.split("\n").filter((line) => /(requestOrder|submitPathTestOrder|submitOperationalOrder)\(/.test(line));
ok("NO_30_45_60_150_180 (submit-capable)", submitLines(runtime).every((line) => !/horizonSeconds:\s*(30|45|60|150|180)\b/.test(line)) && submitLines(server).every((line) => !/horizonSeconds:\s*(30|45|60|150|180)\b/.test(line)) && !/durationSeconds:\s*(30|45|60|150|180)\b/.test(grid));
ok("ONE_OPERATIONAL_STRATEGY", fs.readdirSync(new URL("../estrategias/strategy-versions", import.meta.url)).filter((f) => f.endsWith(".json")).length === 1 && manifest.strategyVersion === "PULLBACK_4060_300_AGENTIC_V2");
ok("ONE_OPERATIONAL_BROKER_PATH", (runtime.match(/client\.placeOrder\(/g) ?? []).length === 1 && operationalAllowlist().filter((s) => s.startsWith("intelligence:")).length === 1 && !operationalAllowlist().some((s) => s.startsWith("lab:")) && OPERATIONAL_EXECUTION_POLICY_NAME === "OPERATIONAL_V2_PLUS_TEST_PATHS");
ok("RESEARCH_CANNOT_SUBMIT", !/requestOrder|placeOrder/.test(read("relay/research-lab/api.mjs")));
ok("STATUS_NOT_ACTIVE_DENY", new ExecutionGate({ now: () => NOW }).decide({ strategy: { status: "READY_FOR_DEPLOY", executable: false, strategyHash: manifest.strategyHash }, expirySeconds: 300 }).code === "STRATEGY_NOT_ACTIVE");
const intelligenceFiles = fs.readdirSync(new URL("../relay/intelligence", import.meta.url)).filter((f) => f.endsWith(".mjs"));
const intelligenceAccountFree = intelligenceFiles.every((f) => !/ACCOUNT_PRACTICE|ACCOUNT_REAL|\bselectedAccount\b|practiceStrategy|realStrategy|practiceConsensus|realConsensus/.test(read(`relay/intelligence/${f}`)));
ok("PRACTICE_REAL_SAME_INTELLIGENCE", intelligenceAccountFree && !/practiceStrategy|realStrategy|practiceConsensus|realConsensus/.test(dispatch));
ok("ACCOUNT_ONLY_AT_ROUTER", !/selectedAccount/.test(dispatch) && !/selectedAccount/.test(read("relay/intelligence/runtime-adapter.mjs")) && /ACCOUNT_REAL/.test(read("relay/execution/account-router.mjs")));
{
  const gate = new ExecutionGate({ now: () => NOW });
  const realDenied = gate.decide({ strategy: { status: "ACTIVE", executable: true, strategyHash: "sha256:x" }, expirySeconds: 300, accountMode: "REAL", realArmed: false });
  const realAllowed = gate.decide({ strategy: { status: "ACTIVE", executable: true, strategyHash: "sha256:x" }, expirySeconds: 300, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" } });
  ok("REAL_FAIL_CLOSED", realDenied.code === "REAL_FAIL_CLOSED" && realDenied.accountMode === null && realAllowed.allowed === true);
}
{
  const path = new SinglePath({ now: () => NOW });
  const decision = { marketKey: "EURUSD:OTC", side: "BUY", strategyId: null, strategyVersion: manifest.strategyVersion, strategyHash: manifest.strategyHash, snapshotId: "s1", decidedAt: NOW };
  const practice = path.evaluate({ decision, strategy: { status: "ACTIVE", executable: true, strategyHash: manifest.strategyHash }, accountMode: "PRACTICE", serverTimeMs: NOW });
  const real = path.evaluate({ decision, strategy: { status: "ACTIVE", executable: true, strategyHash: manifest.strategyHash }, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" }, serverTimeMs: NOW });
  ok("PARITY_PRACTICE_REAL", practice.entry.fingerprint === real.entry.fingerprint && practice.entry.expiryAt === real.entry.expiryAt && practice.entry.account === "PRACTICE" && real.entry.account === "REAL");
}
{
  const features = deepFreeze({ marketKey: "EURUSD:OTC", version: 1, at: NOW, candles: 100, structure: "UPTREND", regime: "UPTREND", close: 1.3, atr: 0.001, volRatio: 1, rsi: { value: 30, zone: "LOW" }, dmi: { adx: 25, plusDi: 30, minusDi: 15, trending: true }, bollinger: { bandwidth: 0.001, percentB: 0.4, expanding: true }, priceAction: { bodyRatio: 0.4, closeInRange: 0.5, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.8 }, nearestZone: null, lastBOS: null, lastCHoCH: null } });
  const specialists = runSpecialists(features);
  const consensusResult = consensus(features, specialists);
  const snapshot = buildDecisionSnapshot({ features, specialists, consensus: consensusResult, decidedAt: NOW });
  ok("SNAPSHOT_IMMUTABLE", Object.isFrozen(snapshot) && Object.isFrozen(snapshot.features) && Object.isFrozen(snapshot.specialists) && Object.isFrozen(snapshot.consensus));
  ok("SPECIALISTS_SAME_ASSET_CONTEXT", specialists.length === 5 && specialists.every((s) => s.featuresVersion === features.version && s.featuresAt === features.at));
  ok("NO_CONFIDENCE", !("confidence" in consensusResult) && !/confidence/i.test(read("relay/intelligence/consensus.mjs")) && !/confidence/i.test(read("relay/intelligence/decision-snapshot.mjs")));
}
{
  const baselineFile = `sha256:${sha256(read("archive/baseline/PULLBACK_4060_300_BASELINE/custom-strategies.mjs"))}`;
  ok("BASELINE_IMMUTABLE", baselineFile === manifest.parentStrategyHash && fs.existsSync(new URL("../archive/baseline/PULLBACK_4060_300_BASELINE/spec.json", import.meta.url)) && fs.existsSync(new URL("../archive/baseline/PULLBACK_4060_300_BASELINE/stats-snapshot.json", import.meta.url)));
}
{
  const pipeline = new AssetPipeline({ marketKey: "X:OTC", now: () => NOW });
  const oneMinute = Array.from({ length: 200 }, (_, i) => ({ at: NOW - 12_000_000 + i * 60_000, open: 1, high: 1.001, low: 0.999, close: 1 }));
  const hydration = pipeline.hydrate(oneMinute);
  ok("5S_INTERVAL_REQUIRED", OPERATIONAL_CANDLE_INTERVAL_MS === 5000 && hydration === HYDRATION_PARTIAL && pipeline.hydrationDetail.reason === "INTERVAL_INCOMPATIBLE");
}
{
  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: manifest });
  ok("INTELLIGENCE_READY_REQUIRES_READY_ASSET", intel.health().intelligenceReady === false && intel.health().state === "DEGRADED" && intel.health().assetsTotal === 0);
}
{
  const pipeline = new AssetPipeline({ marketKey: "W:OTC", now: () => NOW });
  pipeline.evaluate(deepFreeze({ marketKey: "W:OTC", version: 1, at: NOW, candles: 100, structure: "RANGE", regime: "RANGE", close: 1.3, atr: 0.001, volRatio: 1, rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 10, plusDi: 20, minusDi: 20, trending: false }, bollinger: { bandwidth: 0.001, percentB: 0.5, expanding: false }, priceAction: { bodyRatio: 0.4, closeInRange: 0.5, direction: "UP", pullback: { active: false, direction: null, depth: null, distanceAtr: null }, nearestZone: null, lastBOS: null, lastCHoCH: null } }));
  ok("WAIT_NEVER_CREATES_TRADE", pipeline.consensus.side === "WAIT" && pipeline.lastSnapshot === null && pipeline.isDuplicate(null) === true);
}
ok("TEST_PATH_PRACTICE_ONLY", /TEST_PATH_PRACTICE_ONLY/.test(runtime) && /submitPathTestOrder/.test(runtime) && !/submitLabPracticeOrder/.test(runtime));
ok("TEST_PATH_EXCLUDED_FROM_STATS", /entryTiming\?\.pathTest === true \? \{ strategyVersion: "PATH_TEST"/.test(runtime) && /excluded_from_stats=false/.test(runtime) && /testOnly: true, excludedFromStats: true/.test(runtime) && /entryTiming: \{ pathTest: true \}/.test(server) && /account_context='PRACTICE' AND excluded_from_stats=false/.test(runtime));
ok("PRODUCT_STATES_BACKEND", productState({ enabled: true, feedStatus: "OK", hydration: "HYDRATION_READY", consensusSide: "BUY" }) === "BUY" && productState({ enabled: true, feedStatus: "ABSENT", hydration: "HYDRATION_READY", consensusSide: "BUY" }) === "SEM FEED" && productState({ enabled: true, feedStatus: "OK", purchaseStatus: "UNAVAILABLE", hydration: "HYDRATION_READY", consensusSide: "BUY" }) === "SEM COMPRA");

console.log(fail === 0 ? `INVARIANTS ALL_PASS (${pass}/${pass})` : `INVARIANTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
