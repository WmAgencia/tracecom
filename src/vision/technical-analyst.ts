import { buildFeatureSnapshot } from "../quant-v2/feature-engine.js";
import { quantShadowDecision } from "../quant-v2/quant-fusion.js";
import type { MarketCandle } from "../market/model.js";
import { retrieveTechnicalKnowledge } from "./knowledge-base.js";

export type TechnicalAnalystInput = { candles: readonly MarketCandle[]; marketContextId: string; segmentId: string; referencePrice: number | null; observationsAvailable: number };
export type TechnicalAnalystOutput = { decision: "BUY" | "SELL" | "WAIT"; confidence: number; horizonSeconds: 60; marketContextId: string; segmentId: string; featureVersion: string; evidence: string[]; contradictions: string[]; knowledgeReferences: string[]; shadowOnly: true };

/** Structured technical analyst. It consumes causal candles/features only and is shadow-only. */
export function analyzeTechnicalState(input: TechnicalAnalystInput): TechnicalAnalystOutput {
  if (!input.candles.length || !input.marketContextId || !input.segmentId) return { decision: "WAIT", confidence: 0, horizonSeconds: 60, marketContextId: input.marketContextId, segmentId: input.segmentId, featureVersion: "quant-v2-features-v1", evidence: ["INSUFFICIENT_CAUSAL_MARKET_STATE"], contradictions: [], knowledgeReferences: [], shadowOnly: true };
  const snapshot = buildFeatureSnapshot(input.candles); const decision = quantShadowDecision({ snapshot }); const output = decision.direction === "BUY" ? "BUY" : decision.direction === "SELL" ? "SELL" : "WAIT";
  return { decision: output, confidence: decision.calibratedConfidence ?? 0, horizonSeconds: 60, marketContextId: input.marketContextId, segmentId: input.segmentId, featureVersion: decision.featureVersion, evidence: decision.reasons, contradictions: decision.disagreement, knowledgeReferences: retrieveTechnicalKnowledge({ regime: decision.regime.regime }).map(x => x.id), shadowOnly: true };
}
