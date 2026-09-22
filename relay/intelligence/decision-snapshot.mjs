import crypto from "node:crypto";
import { deepFreeze, stableStringify } from "./features.mjs";

export function buildDecisionSnapshot({ features, specialists, consensus: consensusResult, decidedAt, expirySeconds = 300, timing = null }) {
  if (!features) throw new Error("SNAPSHOT_FEATURES_REQUIRED");
  if (!consensusResult) throw new Error("SNAPSHOT_CONSENSUS_REQUIRED");
  if (!Number.isFinite(Number(decidedAt))) throw new Error("SNAPSHOT_DECIDED_AT_REQUIRED");
  if (Number(expirySeconds) !== 300) throw new Error("SNAPSHOT_EXPIRY_NOT_300S");
  const body = {
    marketKey: features.marketKey,
    decidedAt: Number(decidedAt),
    expirySeconds: 300,
    assetContextVersion: features.version,
    assetContextAt: features.at,
    features,
    specialists: specialists ?? [],
    consensus: consensusResult,
    timing,
  };
  const id = crypto.createHash("sha256").update(stableStringify(body)).digest("hex");
  return deepFreeze({ ...body, id });
}

export function snapshotFingerprint(snapshot) { return snapshot?.id ?? null; }

export function decisionFromSnapshot(snapshot, { strategyId, strategyVersion, strategyHash }) {
  if (!snapshot?.id) throw new Error("DECISION_SNAPSHOT_REQUIRED");
  if (snapshot.consensus.side !== "BUY" && snapshot.consensus.side !== "SELL") throw new Error("DECISION_SIDE_NOT_ACTIONABLE");
  return deepFreeze({
    marketKey: snapshot.marketKey,
    side: snapshot.consensus.side,
    strategyId: strategyId ?? null,
    strategyVersion: strategyVersion ?? null,
    strategyHash: strategyHash ?? null,
    snapshotId: snapshot.id,
    decidedAt: snapshot.decidedAt,
  });
}
