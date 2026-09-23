import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../relay/intelligence/features.mjs";
import { FEATURES_VERSION } from "../relay/intelligence/features.mjs";
import { SPECIALISTS_VERSION } from "../relay/intelligence/specialists.mjs";
import { CONSENSUS_VERSION } from "../relay/intelligence/consensus.mjs";
import { DECISION_SNAPSHOT_VERSION } from "../relay/intelligence/decision-snapshot.mjs";
import { ASSET_CONTEXT_WINDOW_CANDLES, MAX_CONTEXT_AGE_MS, OPERATIONAL_CANDLE_INTERVAL_MS, MIN_CONTEXT_OBSERVATIONS, GAP_FACTOR, GAP_RATIO_MAX } from "../relay/intelligence/asset-context.mjs";
import { OPERATIONAL_EXPIRY_SECONDS } from "../relay/execution/binary300.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = path.join(ROOT, "estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V2.json");
export const BASELINE_DIR = path.join(ROOT, "archive", "baseline", "PULLBACK_4060_300_BASELINE");

export const DECISION_FILES = Object.freeze([
  "relay/intelligence/asset-context.mjs",
  "relay/intelligence/features.mjs",
  "relay/intelligence/specialists.mjs",
  "relay/intelligence/consensus.mjs",
  "relay/intelligence/decision-snapshot.mjs",
  "relay/intelligence/asset-pipeline.mjs",
  "relay/execution/binary300.mjs",
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalized = (value) => String(value).replace(/\r\n/g, "\n");
const fileHash = (relative) => `sha256:${sha256(normalized(fs.readFileSync(path.join(ROOT, relative), "utf8")))}`;

export function strategyPolicy({ overrides = {} } = {}) {
  return {
    operationalExpirySeconds: OPERATIONAL_EXPIRY_SECONDS,
    operationalCandleIntervalMs: OPERATIONAL_CANDLE_INTERVAL_MS,
    maxContextAgeMs: MAX_CONTEXT_AGE_MS,
    contextWindowCandles: ASSET_CONTEXT_WINDOW_CANDLES,
    minContextObservations: MIN_CONTEXT_OBSERVATIONS,
    intervalToleranceRatio: 0.5,
    gapFactor: GAP_FACTOR,
    gapRatioMax: GAP_RATIO_MAX,
    featuresVersion: FEATURES_VERSION,
    specialistsVersion: SPECIALISTS_VERSION,
    specialists: ["rsi", "dmi", "bollinger", "atr", "priceAction"],
    consensusVersion: CONSENSUS_VERSION,
    decisionSnapshotVersion: DECISION_SNAPSHOT_VERSION,
    ...overrides,
  };
}

export function computeStrategyHash({ overrides = {}, manifest = null } = {}) {
  const source = manifest ?? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const baselineSpec = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, "spec.json"), "utf8"));
  const files = Object.fromEntries(DECISION_FILES.map((relative) => [relative, fileHash(relative)]));
  const baselineFile = `sha256:${sha256(normalized(fs.readFileSync(path.join(BASELINE_DIR, "custom-strategies.mjs"), "utf8")))}`;
  const body = {
    strategyVersion: "PULLBACK_4060_300_AGENTIC_V2",
    parent: source.parent,
    parentStrategyHash: source.parentStrategyHash,
    baselineSpecHash: `sha256:${sha256(stableStringify(baselineSpec))}`,
    baselineFileHash: baselineFile,
    policy: strategyPolicy({ overrides }),
    files,
  };
  return { strategyHash: `sha256:${sha256(stableStringify(body))}`, files, policy: body.policy, body };
}

export function updateManifest({ sourceCommit = null } = {}) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const { strategyHash, policy, files } = computeStrategyHash({ manifest });
  const next = {
    strategyVersion: "PULLBACK_4060_300_AGENTIC_V2",
    parent: manifest.parent,
    parentStrategyHash: manifest.parentStrategyHash,
    strategyHash,
    newStrategyHash: strategyHash,
    newStrategyHashNote: "hash deterministico de asset-context/features/specialists/consensus/decision-snapshot/asset-pipeline + policy 300s/5s/3h + baseline congelada; sem frontend/CSS/deploy/logs",
    sourceCommit: sourceCommit ?? manifest.sourceCommit ?? null,
    createdAt: manifest.createdAt,
    statsEpoch: manifest.statsEpoch,
    operationalExpirySeconds: policy.operationalExpirySeconds,
    operationalCandleIntervalMs: policy.operationalCandleIntervalMs,
    maxContextAgeMs: policy.maxContextAgeMs,
    readinessPolicy: {
      minContextObservations: policy.minContextObservations,
      contextWindowCandles: policy.contextWindowCandles,
      intervalToleranceRatio: policy.intervalToleranceRatio,
      gapFactor: policy.gapFactor,
      gapRatioMax: policy.gapRatioMax,
      coverageRule: "coverageMs + intervalMs >= maxContextAgeMs",
      intervalRule: "|intervalMs - expectedIntervalMs| <= expectedIntervalMs * intervalToleranceRatio",
      gapRule: "maxGapMs <= intervalMs * gapFactor && gapRatio <= gapRatioMax",
    },
    specialists: {
      version: policy.specialistsVersion,
      order: policy.specialists,
      each: "recebe AssetContext/FeatureSnapshot unico (featuresVersion/featuresAt identicos); sem recalculo por especialista",
    },
    consensusVersion: policy.consensusVersion,
    decisionSnapshotVersion: policy.decisionSnapshotVersion,
    featuresVersion: policy.featuresVersion,
    decisionFiles: files,
    stats: manifest.stats,
    runId: manifest.runId,
    status: "READY_FOR_DEPLOY",
    executable: false,
    changeDescription: manifest.changeDescription,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const sourceCommit = process.env.STRATEGY_SOURCE_COMMIT ?? null;
  const manifest = updateManifest({ sourceCommit });
  console.log(`STRATEGY_HASH=${manifest.strategyHash}`);
  console.log(`STRATEGY_STATUS=${manifest.status} executable=${manifest.executable}`);
  console.log(`DECISION_FILES=${DECISION_FILES.length}`);
}
