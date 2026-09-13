/** Macro (≈15m visible) and micro (≈30–90s) context, always causal.
 *
 * The three time concepts stay separate and explicit:
 *   CANDLE_TIMEFRAME_SECONDS   = 5
 *   VISIBLE_WINDOW_SECONDS     = 900  (macro context, ~180 x 5s candles)
 *   PREDICTION_HORIZON_SECONDS = 60   (trade expiration)
 */
export const CANDLE_TIMEFRAME_SECONDS = 5;
export const VISIBLE_WINDOW_SECONDS = 900;
export const PREDICTION_HORIZON_SECONDS = 60;

export type MacroTrend = "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN" | "UNCERTAIN";
export type MicroTrend = "UP" | "SIDEWAYS" | "DOWN" | "REVERSAL_UP" | "REVERSAL_DOWN" | "UNCERTAIN";
export type TrendAlignment = "WITH_TREND" | "COUNTER_TREND" | "NEUTRAL";

export type ContextObservation = { value: number; timestamp: number };
export type MacroState = { trend: MacroTrend; confidence: number; pending: MacroTrend; pendingCount: number; updatedAt: number; transitions: number; evidence: string[] };
export type MicroState = { microTrend: MicroTrend; microMomentum: number; evidence: string[] };

export const MACRO_THRESHOLDS = Object.freeze({ strongSlopePct: .12, slopePct: .04, rangePct: .18, monotonicStrong: .65, monotonic: .55, confirmations: 3, escapeSlopePct: .30, windowSeconds: 900, minSamples: 6 });
export const MICRO_THRESHOLDS = Object.freeze({ windowSeconds: 90, recentSeconds: 15, reversalSlopePct: .02, momentumScalePct: .05, minSamples: 4 });

const EMPTY_MACRO: MacroState = { trend: "UNCERTAIN", confidence: .1, pending: "UNCERTAIN", pendingCount: 0, updatedAt: 0, transitions: 0, evidence: ["insufficient_causal_observations"] };

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function slopePct(values: number[]): number { return values.length > 1 ? ((values[values.length - 1]! - values[0]!) / values[0]!) * 100 : 0; }

function classifyMacroRaw(values: number[]): { trend: MacroTrend; confidence: number; evidence: string[] } {
  const slope = slopePct(values);
  const range = ((Math.max(...values) - Math.min(...values)) / median(values)) * 100;
  const changes = values.slice(1).map((value, index) => value - values[index]!);
  const ups = changes.filter((change) => change > 0).length;
  const monotonic = changes.length ? Math.max(ups, changes.length - ups) / changes.length : 0;
  const evidence = [`slopePct=${slope.toFixed(4)}`, `rangePct=${range.toFixed(4)}`, `monotonic=${monotonic.toFixed(2)}`];
  if (slope >= MACRO_THRESHOLDS.strongSlopePct && monotonic >= MACRO_THRESHOLDS.monotonicStrong) return { trend: "STRONG_UP", confidence: .75, evidence };
  if (slope <= -MACRO_THRESHOLDS.strongSlopePct && monotonic >= MACRO_THRESHOLDS.monotonicStrong) return { trend: "STRONG_DOWN", confidence: .75, evidence };
  if (slope >= MACRO_THRESHOLDS.slopePct && monotonic >= MACRO_THRESHOLDS.monotonic) return { trend: "UP", confidence: .6, evidence };
  if (slope <= -MACRO_THRESHOLDS.slopePct && monotonic >= MACRO_THRESHOLDS.monotonic) return { trend: "DOWN", confidence: .6, evidence };
  if (range <= MACRO_THRESHOLDS.rangePct) return { trend: "SIDEWAYS", confidence: .5, evidence };
  return { trend: "UNCERTAIN", confidence: .25, evidence };
}

/** Macro requires persistence: a single noisy reading can request a change but
 * only `confirmations` consecutive readings (or an extreme escape) commit it. */
export function buildMacroContext(observations: readonly ContextObservation[], now: number, previous: MacroState | null = null): MacroState {
  const causal = observations.filter((item) => Number.isFinite(item.value) && item.value > 0 && item.timestamp <= now && now - item.timestamp <= MACRO_THRESHOLDS.windowSeconds * 1_000).sort((a, b) => a.timestamp - b.timestamp);
  if (causal.length < MACRO_THRESHOLDS.minSamples) return previous ? { ...previous, updatedAt: now } : { ...EMPTY_MACRO, updatedAt: now };
  const values = causal.map((item) => item.value);
  const raw = classifyMacroRaw(values);
  if (!previous || previous.trend === "UNCERTAIN" || previous.trend === raw.trend) return { trend: raw.trend, confidence: raw.confidence, pending: raw.trend, pendingCount: 0, updatedAt: now, transitions: previous?.transitions ?? 0, evidence: raw.evidence };
  const extreme = Math.abs(slopePct(values.slice(-Math.min(values.length, 12)))) >= MACRO_THRESHOLDS.escapeSlopePct;
  const pendingCount = (previous.pending === raw.trend ? previous.pendingCount : 0) + 1;
  if (pendingCount >= MACRO_THRESHOLDS.confirmations || extreme) return { trend: raw.trend, confidence: raw.confidence, pending: raw.trend, pendingCount: 0, updatedAt: now, transitions: (previous.transitions ?? 0) + 1, evidence: [...raw.evidence, extreme ? "extreme_escape" : "hysteresis_confirmed"] };
  return { ...previous, pending: raw.trend, pendingCount, updatedAt: now, evidence: [...raw.evidence, "pending_macro_change"] };
}

export function buildMicroContext(observations: readonly ContextObservation[], now: number): MicroState {
  const causal = observations.filter((item) => Number.isFinite(item.value) && item.value > 0 && item.timestamp <= now && now - item.timestamp <= MICRO_THRESHOLDS.windowSeconds * 1_000).sort((a, b) => a.timestamp - b.timestamp);
  if (causal.length < MICRO_THRESHOLDS.minSamples) return { microTrend: "UNCERTAIN", microMomentum: 0, evidence: ["insufficient_micro_observations"] };
  const values = causal.map((item) => item.value);
  const recentCount = Math.max(2, Math.floor(values.length / 3));
  const recent = values.slice(-recentCount);
  const prior = values.slice(Math.max(0, values.length - 2 * recentCount), values.length - recentCount + 1);
  const recentSlope = slopePct(recent);
  const priorSlope = slopePct(prior);
  const momentum = clamp(recentSlope / MICRO_THRESHOLDS.momentumScalePct, -1, 1);
  const evidence = [`recentSlopePct=${recentSlope.toFixed(4)}`, `priorSlopePct=${priorSlope.toFixed(4)}`, `momentum=${momentum.toFixed(2)}`];
  if (Math.sign(recentSlope) !== 0 && Math.sign(priorSlope) !== 0 && Math.sign(recentSlope) !== Math.sign(priorSlope) && Math.abs(recentSlope) >= MICRO_THRESHOLDS.reversalSlopePct) return { microTrend: recentSlope > 0 ? "REVERSAL_UP" : "REVERSAL_DOWN", microMomentum: momentum, evidence };
  if (recentSlope >= MICRO_THRESHOLDS.reversalSlopePct / 2) return { microTrend: "UP", microMomentum: momentum, evidence };
  if (recentSlope <= -MICRO_THRESHOLDS.reversalSlopePct / 2) return { microTrend: "DOWN", microMomentum: momentum, evidence };
  return { microTrend: "SIDEWAYS", microMomentum: momentum, evidence };
}

export function trendAlignmentFor(direction: "BUY" | "SELL" | "NONE", macro: MacroTrend): TrendAlignment {
  if (direction === "NONE") return "NEUTRAL";
  const bullish = macro === "UP" || macro === "STRONG_UP";
  const bearish = macro === "DOWN" || macro === "STRONG_DOWN";
  if (!bullish && !bearish) return "NEUTRAL";
  const withTrend = direction === "BUY" ? bullish : bearish;
  return withTrend ? "WITH_TREND" : "COUNTER_TREND";
}

export function counterTrendEvidence(direction: "BUY" | "SELL", macro: MacroTrend, micro: MicroState, observations: readonly ContextObservation[], now: number): string[] {
  const evidence: string[] = [];
  const values = observations.filter((item) => Number.isFinite(item.value) && item.timestamp <= now).sort((a, b) => a.timestamp - b.timestamp).map((item) => item.value);
  if (!values.length) return evidence;
  const macroMedian = median(values);
  const latest = values[values.length - 1]!;
  if (direction === "BUY") {
    if (micro.microTrend === "REVERSAL_UP") evidence.push("micro_reversal_up");
    if (latest > macroMedian) evidence.push("structure_break_above_macro_median");
    if (micro.microMomentum > .3) evidence.push("momentum_recovery");
  } else {
    if (micro.microTrend === "REVERSAL_DOWN") evidence.push("micro_reversal_down");
    if (latest < macroMedian) evidence.push("structure_break_below_macro_median");
    if (micro.microMomentum < -.3) evidence.push("momentum_decay");
  }
  return evidence;
}
