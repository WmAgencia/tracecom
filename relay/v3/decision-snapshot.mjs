/**
 * V3 — DECISION SNAPSHOT imutavel (deep-freeze + hash SHA256).
 * Settlement NUNCA altera analise: o snapshot e a prova do que foi visto/decidido.
 */
import crypto from "node:crypto";
import { stableStringify, deepFreeze } from "../intelligence/features.mjs";

export const V3_SNAPSHOT_VERSION = "v3-decision-snapshot-v1";

export function buildV3DecisionSnapshot({ strategy = null, opportunity, cycles = null, asset, consensus, specialists, measurements, finalDecision, timing } = {}) {
  if (!opportunity) throw new Error("OPPORTUNITY_REQUIRED");
  const cycleList = cycles ?? opportunity.cycles ?? [];
  const snapshot = {
    version: V3_SNAPSHOT_VERSION,
    strategy: strategy ? { strategyVersion: strategy.version ?? null, strategyHash: strategy.strategyHash ?? null, statsEpoch: strategy.statsEpoch ?? null, status: strategy.status ?? null, executable: strategy.executable === true } : null,
    opportunityId: opportunity.opportunityId,
    marketKey: opportunity.marketKey,
    activeId: opportunity.activeId ?? null,
    expirationAt: opportunity.expirationAt,
    firstSeenAt: opportunity.firstSeenAt,
    firstSeenTteMs: opportunity.firstSeenTteMs,
    finalTteMs: timing?.tteMs ?? null,
    targetSendAt: opportunity.targetSendAt,
    hardStrategicCutoffAt: opportunity.hardStrategicCutoffAt,
    purchaseDeadlineAt: opportunity.purchaseDeadlineAt ?? null,
    payout: opportunity.payout ?? null,
    cyclesCount: cycleList.length,
    cycleHistory: cycleList.map((cycle) => ({
      cycleNumber: cycle.cycleNumber, at: cycle.at ?? null, tteMs: cycle.tteMs ?? null, closedCandleId: cycle.closedCandleId ?? null,
      price: cycle.price ?? null, featureSnapshotId: cycle.featureSnapshotId ?? null,
      specialistStates: cycle.specialistStates ?? null, assetScenario: cycle.assetScenario ?? null, assetState: cycle.assetState ?? null,
      consensusResult: cycle.consensusResult ?? null, agreement: cycle.agreement ?? null, changedSincePreviousCycle: cycle.changedSincePreviousCycle ?? null,
    })),
    measurements: measurements ?? null,
    specialists: specialists ?? null,
    asset: asset ? { scenario: asset.scenario, state: asset.state, direction: asset.direction, reasoningSummary: asset.reasoningSummary, bestCounterCase: asset.bestCounterCase } : null,
    consensus: consensus ? { independent: consensus.independent, agreement: consensus.agreement, result: consensus.result, challenge: consensus.challenge } : null,
    finalDecision,
  canonicalDirection: finalDecision?.direction ?? null,
    createdAt: Date.now(),
  };
  const hash = `sha256:${crypto.createHash("sha256").update(stableStringify(snapshot)).digest("hex")}`;
  return deepFreeze({ ...snapshot, snapshotHash: hash });
}
