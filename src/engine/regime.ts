/** Causal market-regime classification.
 *
 * Uses only observations at or before `now`. Thresholds are EXPERIMENTAL and
 * expected to be recalibrated from settled shadow data later.
 */
export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "BREAKOUT" | "REVERSAL" | "HIGH_VOLATILITY" | "UNCERTAIN";

export type RegimeObservation = { value: number; timestamp: number };

export type RegimeResult = { regime: MarketRegime; confidence: number; evidence: string[]; timestamp: number; attributes: Record<string, number | null> };

export const REGIME_THRESHOLDS = Object.freeze({ trendSlopePct: .04, rangePct: .10, breakoutScore: 2.2, highVolPct: .08, reversalSlopePct: .05, minSamples: 3, window: 12 });

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; }
function stdev(values: number[]): number { if (values.length < 2) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)); }

export function classifyRegime(observations: readonly RegimeObservation[], now: number): RegimeResult {
  const causal = observations.filter((item) => Number.isFinite(item.value) && item.value > 0 && item.timestamp <= now).sort((a, b) => a.timestamp - b.timestamp).slice(-REGIME_THRESHOLDS.window);
  const empty: RegimeResult = { regime: "UNCERTAIN", confidence: .1, evidence: ["insufficient_causal_observations"], timestamp: now, attributes: { slopePct: null, rangePct: null, volatilityPct: null, breakoutScore: null } };
  if (causal.length < REGIME_THRESHOLDS.minSamples) return empty;
  const values = causal.map((item) => item.value);
  const base = median(values);
  const changesPct = values.slice(1).map((value, index) => ((value - values[index]!) / values[index]!) * 100);
  const half = Math.max(1, Math.floor(values.length / 2));
  const slopePct = ((values[values.length - 1]! - values[0]!) / values[0]!) * 100;
  const previousSlopePct = ((values[half - 1]! - values[0]!) / values[0]!) * 100;
  const recentSlopePct = ((values[values.length - 1]! - values[half - 1]!) / values[half - 1]!) * 100;
  const rangePct = ((Math.max(...values) - Math.min(...values)) / base) * 100;
  const volatilityPct = stdev(changesPct);
  const breakoutScore = volatilityPct > 0 ? Math.abs(values[values.length - 1]! - median(values.slice(0, -1))) / base * 100 / volatilityPct : null;
  const attributes = { slopePct, rangePct, volatilityPct, breakoutScore };
  const evidence = [`slopePct=${slopePct.toFixed(4)}`, `rangePct=${rangePct.toFixed(4)}`, `volatilityPct=${volatilityPct.toFixed(4)}`];
  const upMoves = changesPct.filter((change) => change > 0).length;
  const monotonic = changesPct.length ? Math.max(upMoves, changesPct.length - upMoves) / changesPct.length : 0;
  if (volatilityPct >= REGIME_THRESHOLDS.highVolPct) return { regime: "HIGH_VOLATILITY", confidence: .6, evidence: [...evidence, "volatility_expansion"], timestamp: now, attributes };
  if (breakoutScore !== null && breakoutScore >= REGIME_THRESHOLDS.breakoutScore && Math.abs(recentSlopePct) >= REGIME_THRESHOLDS.trendSlopePct && volatilityPct >= REGIME_THRESHOLDS.highVolPct * .5) return { regime: "BREAKOUT", confidence: .55, evidence: [...evidence, recentSlopePct > 0 ? "displacement_up" : "displacement_down"], timestamp: now, attributes };
  if (Math.sign(recentSlopePct) !== 0 && Math.sign(previousSlopePct) !== 0 && Math.sign(recentSlopePct) !== Math.sign(previousSlopePct) && Math.abs(previousSlopePct) >= REGIME_THRESHOLDS.reversalSlopePct) return { regime: "REVERSAL", confidence: .5, evidence: [...evidence, "direction_flip"], timestamp: now, attributes };
  if (Math.abs(slopePct) >= REGIME_THRESHOLDS.trendSlopePct && monotonic >= .6) return { regime: slopePct > 0 ? "TREND_UP" : "TREND_DOWN", confidence: .55 + Math.min(.25, Math.abs(slopePct)), evidence: [...evidence, `monotonic=${monotonic.toFixed(2)}`], timestamp: now, attributes };
  if (rangePct <= REGIME_THRESHOLDS.rangePct && Math.abs(slopePct) < REGIME_THRESHOLDS.trendSlopePct) return { regime: "RANGE", confidence: .45, evidence: [...evidence, "compressed_range"], timestamp: now, attributes };
  return { regime: "UNCERTAIN", confidence: .2, evidence, timestamp: now, attributes };
}
