import type { QuantComponent, QuantFeatures, QuantTarget } from "./types";

export const MODEL_VERSION = "quant-v2-classical-baseline-v1";
export function baselineModel(features: QuantFeatures): QuantComponent { const momentum = Number(features.momentum_60s ?? 0), slope = Number(features.emaSlopeMedium ?? 0), rsi = Number(features.RSI ?? 50); const score = Math.tanh(momentum * 100 + slope * 100 + (rsi - 50) / 25); const pUp = (score + 1) / 2, pDown = 1 - pUp, pNoEdge = Math.max(0, .5 - Math.abs(score) / 2); return { pUp: pUp * (1 - pNoEdge), pDown: pDown * (1 - pNoEdge), pNoEdge, confidence: Math.abs(score), version: MODEL_VERSION, sampleSize: 1 }; }
export function targetFromPrices(entry: number, settlement: number): QuantTarget { return settlement > entry ? "UP" : settlement < entry ? "DOWN" : "DRAW"; }
