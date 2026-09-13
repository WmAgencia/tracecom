import type { MarketCandle } from "../market/model";

export type QuantDirection = "BUY" | "SELL" | "NO_EDGE";
export type QuantTarget = "UP" | "DOWN" | "DRAW";
export type QuantRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "REVERSAL_UP" | "REVERSAL_DOWN" | "BREAKOUT_UP" | "BREAKOUT_DOWN" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "UNCERTAIN";
export type FeatureValue = number | null;

export type QuantFeatures = Readonly<Record<string, FeatureValue>>;
export type FeatureSnapshot = { timestamp: number; features: QuantFeatures; featureVersion: string };
export type SimilarNeighbor = { groundTruthId: string; timestamp: number; distance: number; direction: QuantTarget; resultAtT60: QuantTarget };
export type SimilarPatternResult = { neighborCount: number; neighbors: SimilarNeighbor[]; upCount: number; downCount: number; drawCount: number; pUpNeighborhood: number | null; pDownNeighborhood: number | null; meanDistance: number | null; medianDistance: number | null; confidenceFromNeighborhood: number | null };
export type RegimeResult = { regime: QuantRegime; secondaryRegime?: QuantRegime; confidence: number; evidence: string[] };
export type QuantComponent = { pUp: number | null; pDown: number | null; pNoEdge: number | null; confidence: number | null; version: string; sampleSize: number };
export type QuantDecision = { quantDecisionId: string; decisionTimestamp: number; direction: QuantDirection; pUp: number | null; pDown: number | null; pNoEdge: number | null; calibratedConfidence: number | null; regime: RegimeResult; components: { supervised: QuantComponent; neighborhood: QuantComponent; online: QuantComponent; regime: QuantComponent }; disagreement: string[]; reasons: string[]; featureVersion: string; modelVersion: string; calibrationVersion: string; regimeVersion: string; policyVersion: string; shadowOnly: true };

export type QuantEvent = { groundTruthId: string; timestamp: number; candles: readonly MarketCandle[]; entryPrice: number; settlementPrice?: number | null; target?: QuantTarget | null; decisionTimestamp?: number };
