import type { MarketCandle } from "../market/model.js";
import { buildFeatureSnapshot } from "../quant-v2/feature-engine.js";
import { classifyRegime } from "../quant-v2/regime-engine.js";

export type MarketState = { version: string; timestamp: number; segmentId: string; horizons: Record<string, { available: boolean; candleCount: number; featureKeys: string[] }>; currentFeatures: Record<string, number | null>; regime: ReturnType<typeof classifyRegime>; dataQuality: "VALID" | "PARTIAL" | "UNAVAILABLE" };
export function buildMarketState(candles: readonly MarketCandle[], segmentId: string): MarketState { const snapshot = buildFeatureSnapshot(candles); const required = ["15s", "30s", "60s", "2m", "5m", "15m", "30m", "1h", "5h"]; const horizons = Object.fromEntries(required.map((name, i) => [name, { available: candles.length >= (i + 1) * 3, candleCount: Math.min(candles.length, (i + 1) * 3), featureKeys: Object.keys(snapshot.features) }])); return { version: "market-state-v1", timestamp: snapshot.timestamp, segmentId, horizons, currentFeatures: { ...snapshot.features }, regime: classifyRegime(snapshot.features), dataQuality: candles.length ? "VALID" : "UNAVAILABLE" }; }
