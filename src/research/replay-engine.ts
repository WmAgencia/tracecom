/** Deterministic causal replay + variant testing.
 *
 * Thousands of evaluations over the SAME real market events are counterfactual
 * evaluations of the same ground truth — never independent market samples.
 * This module is pure: no broker access, no orders, no secrets.
 */
import { buildFastDecision } from "../engine/fast-path.js";
import { settleTrade, type SettlementOutcome } from "../training/settlement.js";
import type { AcceptedObservation } from "../vision/price-lock.js";
import { DEFAULT_PROFILE, PROFILE_IDS, type Profile } from "../engine/profiles.js";

export type ReplayEvent = {
  marketEventId: string;
  groundTruthId: string;
  at: number;
  prices: Array<{ value: number; timestamp: number; confidence?: number; accepted?: boolean; reason?: string; source?: string }>;
  frames?: Array<{ capturedAt: number; frameDifference?: number | null; averageLuma?: number | null }>;
  deepContext?: { version: number; at: number; trend?: string | null; momentum?: string | null; regime?: string | null } | null;
  groundTruth?: { entryPrice: number | null; exitPrice: number | null; dueTimestamp: number } | null;
};

export type Variant = { variantId: string; profile?: Profile; deadlineMs?: number; label?: string };

export type Evaluation = {
  evaluationId: string; variantId: string; marketEventId: string; groundTruthId: string;
  decision: "BUY" | "SELL" | "WAIT"; rawConfidence: number; regime: string; macroTrend: string; microTrend: string;
  trendAlignment: string; predictionHorizonSeconds: number; latencyMs: number; status: string;
  counterfactualResult: SettlementOutcome | null; brokerSideEffects: 0;
};

export type VariantReport = { evaluations: Evaluation[]; uniqueMarketEvents: number; uniqueGroundTruths: number; brokerSideEffects: 0; perVariant: Record<string, { evaluations: number; signals: number; wins: number; losses: number; draws: number; unknown: number }> };

/** Sanitiza a história causal: apenas observações até `at` e aceitas. */
export function causalHistory(event: ReplayEvent, limit = 12): AcceptedObservation[] {
  return event.prices.filter((sample) => Number.isFinite(sample.value) && sample.timestamp <= event.at && sample.accepted !== false).sort((a, b) => a.timestamp - b.timestamp).slice(-limit).map((sample) => ({ value: sample.value, timestamp: sample.timestamp }));
}

export function replayEvent(event: ReplayEvent, variant: Variant): Evaluation {
  const started = Date.now();
  const prices = event.prices.filter((sample) => Number.isFinite(sample.value) && sample.timestamp <= event.at);
  const fast = buildFastDecision({ now: event.at, prices, frames: event.frames ?? [], deepContext: event.deepContext ?? null, profile: variant.profile, deadlineMs: variant.deadlineMs });
  const counterfactualResult = event.groundTruth && event.groundTruth.entryPrice !== null && (fast.decision === "BUY" || fast.decision === "SELL")
    ? settleTrade({ direction: fast.decision, entryPrice: event.groundTruth.entryPrice, exitPrice: event.groundTruth.exitPrice, entryTimestamp: event.at, exitTimestamp: event.groundTruth.dueTimestamp, dueTimestamp: event.groundTruth.dueTimestamp }).outcome
    : null;
  return {
    evaluationId: `${variant.variantId}:${event.marketEventId}`, variantId: variant.variantId, marketEventId: event.marketEventId, groundTruthId: event.groundTruthId,
    decision: fast.decision, rawConfidence: fast.rawConfidence, regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend,
    trendAlignment: fast.trendAlignment, predictionHorizonSeconds: fast.predictionHorizonSeconds, latencyMs: Date.now() - started, status: fast.fastPathStatus,
    counterfactualResult, brokerSideEffects: 0,
  };
}

export async function runVariants(events: readonly ReplayEvent[], variants: readonly Variant[], options: { concurrency?: number } = {}): Promise<VariantReport> {
  const limit = Math.max(1, Math.min(32, options.concurrency ?? 8));
  const queue = [...events];
  const evaluations: Evaluation[] = [];
  async function worker() {
    for (;;) {
      const next = queue.shift(); if (!next) return;
      for (const variant of variants) evaluations.push(replayEvent(next, variant));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, queue.length)) }, () => worker()));
  const perVariant: VariantReport["perVariant"] = {};
  for (const evaluation of evaluations) {
    const row = perVariant[evaluation.variantId] ??= { evaluations: 0, signals: 0, wins: 0, losses: 0, draws: 0, unknown: 0 };
    row.evaluations += 1;
    if (evaluation.decision === "BUY" || evaluation.decision === "SELL") row.signals += 1;
    if (evaluation.counterfactualResult === "WIN") row.wins += 1; else if (evaluation.counterfactualResult === "LOSS") row.losses += 1; else if (evaluation.counterfactualResult === "DRAW") row.draws += 1; else if (evaluation.counterfactualResult === "UNKNOWN") row.unknown += 1;
  }
  return { evaluations, uniqueMarketEvents: new Set(evaluations.map((item) => item.marketEventId)).size, uniqueGroundTruths: new Set(evaluations.map((item) => item.groundTruthId)).size, brokerSideEffects: 0, perVariant };
}

export type ComparisonReport = { eventsCompared: number; agreements: number; disagreements: number; aWins: number; bWins: number; bothWins: number; bothLosses: number; draws: number; unknown: number; aSignalRate: number; bSignalRate: number; aWR: number | null; bWR: number | null };

export function compareVariants(a: readonly Evaluation[], b: readonly Evaluation[]): ComparisonReport {
  const byEventA = new Map(a.map((item) => [item.marketEventId, item]));
  const byEventB = new Map(b.map((item) => [item.marketEventId, item]));
  const events = [...new Set([...byEventA.keys(), ...byEventB.keys()])];
  const report: ComparisonReport = { eventsCompared: events.length, agreements: 0, disagreements: 0, aWins: 0, bWins: 0, bothWins: 0, bothLosses: 0, draws: 0, unknown: 0, aSignalRate: 0, bSignalRate: 0, aWR: null, bWR: null };
  let aSignals = 0, bSignals = 0, aWins = 0, aLosses = 0, bWins = 0, bLosses = 0;
  for (const eventId of events) {
    const left = byEventA.get(eventId), right = byEventB.get(eventId);
    if (left && right) { if (left.decision === right.decision) report.agreements += 1; else report.disagreements += 1; }
    if (left && (left.decision === "BUY" || left.decision === "SELL")) { aSignals += 1; if (left.counterfactualResult === "WIN") { aWins += 1; report.aWins += 1; } else if (left.counterfactualResult === "LOSS") { aLosses += 1; } }
    if (right && (right.decision === "BUY" || right.decision === "SELL")) { bSignals += 1; if (right.counterfactualResult === "WIN") { bWins += 1; report.bWins += 1; } else if (right.counterfactualResult === "LOSS") { bLosses += 1; } }
    if (left?.counterfactualResult === "WIN" && right?.counterfactualResult === "WIN") report.bothWins += 1;
    if (left?.counterfactualResult === "LOSS" && right?.counterfactualResult === "LOSS") report.bothLosses += 1;
    if (left?.counterfactualResult === "DRAW" || right?.counterfactualResult === "DRAW") report.draws += 1;
    if (left?.counterfactualResult === "UNKNOWN" || right?.counterfactualResult === "UNKNOWN") report.unknown += 1;
  }
  report.aSignalRate = events.length ? aSignals / events.length : 0;
  report.bSignalRate = events.length ? bSignals / events.length : 0;
  report.aWR = aWins + aLosses ? aWins / (aWins + aLosses) : null;
  report.bWR = bWins + bLosses ? bWins / (bWins + bLosses) : null;
  return report;
}

export const DEFAULT_VARIANTS: Variant[] = PROFILE_IDS.map((profile) => ({ variantId: profile.toLowerCase(), profile: profile === DEFAULT_PROFILE ? DEFAULT_PROFILE : profile }));

export function buildDiagnosticCropSample(frame: { dataUrl?: string | null; width?: number; height?: number; frameId?: string; capturedAt?: number } | null | undefined) {
  if (!frame || typeof frame.dataUrl !== "string" || !frame.dataUrl.startsWith("data:image/")) return null;
  return { frameId: frame.frameId ?? null, capturedAt: frame.capturedAt ?? null, width: frame.width ?? null, height: frame.height ?? null, sanitized: true as const, note: "crop-only: full desktop is never exported" };
}
