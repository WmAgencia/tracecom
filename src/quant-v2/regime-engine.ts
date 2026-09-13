import type { QuantFeatures, RegimeResult, QuantRegime } from "./types";

export const REGIME_VERSION = "quant-v2-regime-v1";
const n = (f: QuantFeatures, key: string) => f[key] ?? null;

export function classifyRegime(features: QuantFeatures): RegimeResult {
  const slope = Number(n(features, "emaSlopeMedium") ?? 0), spread = Number(n(features, "emaSpreadFastMedium") ?? 0), vol = Number(n(features, "realizedVol_60s") ?? 0), accel = Number(n(features, "priceAcceleration_60s") ?? 0), breakoutUp = Number(n(features, "breakoutUpStrength") ?? 0), breakoutDown = Number(n(features, "breakoutDownStrength") ?? 0);
  const evidence: string[] = [];
  if (vol > 0.003) { evidence.push("realizedVol_60s_high"); return { regime: "HIGH_VOLATILITY", confidence: Math.min(1, vol / .01), evidence }; }
  if (breakoutUp > 0) { evidence.push("breakoutUpStrength_positive"); return { regime: "BREAKOUT_UP", confidence: Math.min(1, Math.abs(breakoutUp) * 100), evidence }; }
  if (breakoutDown < 0) { evidence.push("breakoutDownStrength_negative"); return { regime: "BREAKOUT_DOWN", confidence: Math.min(1, Math.abs(breakoutDown) * 100), evidence }; }
  if (slope > 0 && spread > 0) { evidence.push("ema_slope_up", "ema_spread_up"); return { regime: accel < 0 ? "REVERSAL_UP" : "TREND_UP", confidence: Math.min(1, Math.abs(slope) * 100 + Math.abs(spread) * 50), evidence }; }
  if (slope < 0 && spread < 0) { evidence.push("ema_slope_down", "ema_spread_down"); return { regime: accel > 0 ? "REVERSAL_DOWN" : "TREND_DOWN", confidence: Math.min(1, Math.abs(slope) * 100 + Math.abs(spread) * 50), evidence }; }
  if (Math.abs(spread) < .0005) { evidence.push("ema_spread_compressed"); return { regime: "RANGE", confidence: .5, evidence }; }
  return { regime: "UNCERTAIN", confidence: .2, evidence: ["insufficient_regime_evidence"] };
}
