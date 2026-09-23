import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStrategyHash, MANIFEST_PATH } from "./stage3-strategy-hash.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FREEZE_PATH = path.join(ROOT, "estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V2.freeze.json");

export const NO_TUNING_RULE = "Depois da ativacao/freeze: nenhum threshold, periodo, indicador, definicao de feature, regra de especialista, regra de consensus, semantica de AssetContext, policy de readiness/gap, intervalo (5s) ou horizonte (300s) pode mudar. Auto-tuning/self-modification/adaptive thresholds/martingale/loss recovery proibidos.";
export const V3_RULE = "Qualquer mudanca estrategica = PULLBACK_4060_300_AGENTIC_V3 + novo strategyHash + novo statsEpoch + estatisticas separadas; nunca editar a V2 em silencio.";
export const OPERATIONAL_MUTABLE = ["health", "logs", "infra fixes", "frontend bug fixes", "monitoring", "safe deploy changes"];

export function freezeV2({ frozenAt = new Date().toISOString() } = {}) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.status !== "ACTIVE") throw new Error(`FREEZE_REQUIRES_ACTIVE status=${manifest.status}`);
  if (!manifest.strategyHash) throw new Error("FREEZE_REQUIRES_STRATEGY_HASH");
  const computed = computeStrategyHash({ manifest });
  if (computed.strategyHash !== manifest.strategyHash) {
    throw new Error(`FREEZE_HASH_DRIFT manifesto=${manifest.strategyHash} computado=${computed.strategyHash}`);
  }
  if (manifest.frozen !== true) {
    manifest.frozen = true;
    manifest.frozenAt = frozenAt;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  }
  const payload = {
    schema: "tracecom-strategy-freeze-v1",
    strategyVersion: manifest.strategyVersion,
    status: manifest.status,
    frozen: true,
    parent: manifest.parent,
    parentStrategyHash: manifest.parentStrategyHash,
    strategyHash: manifest.strategyHash,
    sourceCommit: manifest.sourceCommit,
    statsEpoch: manifest.statsEpoch,
    frozenAtUtc: manifest.frozenAt,
    decisionFiles: computed.files,
    decisionOutput: "BUY|SELL|WAIT (sem confidence)",
    accountPolicy: "PRACTICE/REAL usam a MESMA inteligencia; a conta e escolhida somente no AccountRouter; REAL fail-closed e desarmado (realArmed=false apos todo deploy/restart).",
    contextWindow: "3h time-based (MAX_CONTEXT_AGE_MS=10800000; ~2160 candles de 5s)",
    operationalExpirySeconds: manifest.operationalExpirySeconds,
    operationalCandleIntervalMs: manifest.operationalCandleIntervalMs,
    maxContextAgeMs: manifest.maxContextAgeMs,
    readinessPolicy: manifest.readinessPolicy,
    specialists: manifest.specialists,
    consensusVersion: manifest.consensusVersion,
    decisionSnapshotVersion: manifest.decisionSnapshotVersion,
    noConfidenceRule: "Consensus nao produz percentual de confianca; decisao e somente BUY/SELL/WAIT.",
    noTuningRule: NO_TUNING_RULE,
    v3Rule: V3_RULE,
    operationalMutable: OPERATIONAL_MUTABLE,
  };
  fs.writeFileSync(FREEZE_PATH, JSON.stringify(payload, null, 2) + "\n");
  return { strategyHash: manifest.strategyHash, frozenAt: manifest.frozenAt, freezePath: FREEZE_PATH };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const result = freezeV2({ frozenAt: process.env.FREEZE_AT ?? undefined });
  console.log(`V2_FROZEN strategyHash=${result.strategyHash} frozenAt=${result.frozenAt} file=${path.relative(ROOT, result.freezePath)}`);
}
