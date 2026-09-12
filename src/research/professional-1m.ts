import type { MarketCandle } from "../market/model";

export type ProfessionalPhaseId = "A" | "B" | "C" | "D" | "E";
export type EvidenceAvailability = "OBSERVED" | "NOT_AVAILABLE";
export type ProfessionalOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";

export interface ProfessionalPhaseSpec {
  readonly id: ProfessionalPhaseId;
  readonly targetActionable: number;
  readonly mode: "EXPLORE" | "CONFIRM" | "FROZEN_VALIDATE" | "FINAL_FUTURE_HOLDOUT";
  readonly signatureInputVersion: null | "V1" | "V2" | "V3" | "V4";
  readonly allowLearning: boolean;
}

export const PROFESSIONAL_1M_PHASES: readonly ProfessionalPhaseSpec[] = [
  { id: "A", targetActionable: 1_000, mode: "EXPLORE", signatureInputVersion: null, allowLearning: true },
  { id: "B", targetActionable: 1_000, mode: "CONFIRM", signatureInputVersion: "V1", allowLearning: true },
  { id: "C", targetActionable: 1_000, mode: "CONFIRM", signatureInputVersion: "V2", allowLearning: false },
  { id: "D", targetActionable: 500, mode: "FROZEN_VALIDATE", signatureInputVersion: "V3", allowLearning: false },
  { id: "E", targetActionable: 100, mode: "FINAL_FUTURE_HOLDOUT", signatureInputVersion: "V4", allowLearning: false },
] as const;

export interface FeatureEvidence {
  readonly availability: EvidenceAvailability;
  readonly present: boolean | null;
  readonly value: number | string | null;
  readonly source: "OHLC" | "DERIVED_OHLC" | "L1" | "L2" | "NEWS" | "MACRO";
  readonly asOf: number | null;
}

export interface ProfessionalContext1m {
  readonly symbol: string;
  /** First instant at which every feature in this snapshot is knowable. */
  readonly analysisAt: number;
  readonly entryPrice: number;
  readonly session: "TOKYO" | "LONDON" | "LONDON_NEW_YORK_OVERLAP" | "NEW_YORK" | "ROLLOVER";
  readonly direction: "BUY" | "SELL" | "WAIT";
  readonly rawConfidence: number;
  readonly features: Readonly<Record<string, FeatureEvidence>>;
  readonly favorableReasons: readonly string[];
  readonly contraryReasons: readonly string[];
  readonly dataLimitations: readonly string[];
}

export interface EvaluatedProfessionalTrade extends ProfessionalContext1m {
  readonly phase: ProfessionalPhaseId;
  readonly expiryAt: number;
  readonly exitPrice: number | null;
  readonly grossReturn: number | null;
  readonly cost: number | null;
  readonly netReturn: number | null;
  readonly outcome: ProfessionalOutcome;
  readonly uniqueness: number;
}

export interface WinSignature {
  readonly id: string;
  readonly clauses: readonly string[];
  readonly n: number;
  readonly effectiveN: number;
  readonly wins: number;
  readonly losses: number;
  readonly precision: number;
  readonly baseline: number;
  readonly lift: number;
  readonly oddsRatio: number;
  readonly oddsRatioAdjusted: boolean;
  readonly confidence95: readonly [number, number];
  readonly netEv: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const change = (next: number, previous: number): number => previous === 0 ? 0 : (next - previous) / previous;
const observed = (present: boolean, value: number | string, asOf: number): FeatureEvidence => ({ availability: "OBSERVED", present, value, source: "DERIVED_OHLC", asOf });
const unavailable = (source: FeatureEvidence["source"]): FeatureEvidence => ({ availability: "NOT_AVAILABLE", present: null, value: null, source, asOf: null });

function sessionAt(timestamp: number): ProfessionalContext1m["session"] {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(timestamp)).find((part) => part.type === "hour")?.value ?? 0);
  if (hour >= 3 && hour < 8) return "LONDON";
  if (hour >= 8 && hour < 12) return "LONDON_NEW_YORK_OVERLAP";
  if (hour >= 12 && hour < 17) return "NEW_YORK";
  if (hour >= 19 || hour < 3) return "TOKYO";
  return "ROLLOVER";
}

/** Builds a point-in-time snapshot from closed candles only. The current bar's
 * close is the planned entry, so analysisAt is its close timestamp, not its
 * bucket-open timestamp. No outcome candle is accepted by this function. */
export function buildProfessionalContext1m(candles: readonly MarketCandle[], index: number): ProfessionalContext1m {
  if (index < 20 || index >= candles.length) throw new Error("PROFESSIONAL_1M_LOOKBACK_UNAVAILABLE");
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const current = sorted[index]!;
  if (!current.isClosed || current.timeframe !== "1m") throw new Error("PROFESSIONAL_1M_REQUIRES_CLOSED_1M");
  const window = sorted.slice(index - 20, index + 1);
  if (window.some((c, i) => i > 0 && c.timestamp - window[i - 1]!.timestamp !== 60_000)) throw new Error("PROFESSIONAL_1M_GAP");
  const analysisAt = current.timestamp + 60_000;
  if (window.some((c) => c.timestamp + 60_000 > analysisAt)) throw new Error("PROFESSIONAL_1M_LOOKAHEAD");

  const previous = window.at(-2)!;
  const fiveAgo = window.at(-6)!;
  const tenAgo = window.at(-11)!;
  const first = window[0]!;
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const recentRanges = window.slice(-6, -1).map((c) => c.high - c.low);
  const meanRange = recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length;
  const return5 = change(current.close, fiveAgo.close);
  const return10 = change(current.close, tenAgo.close);
  const return20 = change(current.close, first.close);
  const direction = Math.abs(return5 + return20) < 0.00002 ? "WAIT" : return5 + return20 > 0 ? "BUY" : "SELL";
  const directionSign = direction === "BUY" ? 1 : direction === "SELL" ? -1 : 0;
  const efficiency = Math.abs(current.close - first.close) /
    Math.max(Number.EPSILON, window.slice(1).reduce((sum, c, i) => sum + Math.abs(c.close - window[i]!.close), 0));
  const rawConfidence = direction === "WAIT" ? 0.5 : clamp(0.5 + Math.abs(return5 + return20) / Math.max(meanRange / current.close, 1e-6) * 0.04, 0.5, 0.75);
  const higherHigh = current.high > previous.high;
  const lowerLow = current.low < previous.low;
  const bullishRejection = lowerWick / range > 0.45 && current.close > current.open;
  const bearishRejection = upperWick / range > 0.45 && current.close < current.open;
  const aligned = directionSign !== 0 && Math.sign(return5) === directionSign && Math.sign(return10) === directionSign && Math.sign(return20) === directionSign;
  const features: Record<string, FeatureEvidence> = {
    [`PAIR_${current.symbol.replace(/[^A-Z]/gi, "").toUpperCase()}`]: observed(true, current.symbol, analysisAt),
    [`SESSION_${sessionAt(analysisAt)}`]: observed(true, sessionAt(analysisAt), analysisAt),
    [`DIRECTION_${direction}`]: observed(true, direction, analysisAt),
    CANDLE_BULLISH: observed(current.close > current.open, change(current.close, current.open), analysisAt),
    CANDLE_BEARISH: observed(current.close < current.open, change(current.close, current.open), analysisAt),
    BODY_DOMINANT: observed(body / range >= 0.6, body / range, analysisAt),
    BULLISH_REJECTION: observed(bullishRejection, lowerWick / range, analysisAt),
    BEARISH_REJECTION: observed(bearishRejection, upperWick / range, analysisAt),
    INSIDE_BAR: observed(current.high < previous.high && current.low > previous.low, range, analysisAt),
    OUTSIDE_BAR: observed(higherHigh && lowerLow, range, analysisAt),
    RANGE_EXPANSION: observed(range > meanRange * 1.35, range / Math.max(meanRange, Number.EPSILON), analysisAt),
    RANGE_CONTRACTION: observed(range < meanRange * 0.7, range / Math.max(meanRange, Number.EPSILON), analysisAt),
    MOMENTUM_ALIGNED_5_10_20: observed(aligned, return5 + return10 + return20, analysisAt),
    TREND_EFFICIENT: observed(efficiency >= 0.55, efficiency, analysisAt),
    BREAKOUT_HIGH_20: observed(current.close >= Math.max(...window.slice(0, -1).map((c) => c.high)), current.close, analysisAt),
    BREAKOUT_LOW_20: observed(current.close <= Math.min(...window.slice(0, -1).map((c) => c.low)), current.close, analysisAt),
    LIQUIDITY_SWEEP_HIGH: observed(higherHigh && current.close < previous.high, current.high - previous.high, analysisAt),
    LIQUIDITY_SWEEP_LOW: observed(lowerLow && current.close > previous.low, previous.low - current.low, analysisAt),
    SPREAD_AVAILABLE: unavailable("L1"),
    MICROSTRUCTURE_AVAILABLE: unavailable("L2"),
    NEWS_POINT_IN_TIME_AVAILABLE: unavailable("NEWS"),
    MACRO_POINT_IN_TIME_AVAILABLE: unavailable("MACRO"),
  };
  const favorableReasons = Object.entries(features).filter(([, value]) => value.availability === "OBSERVED" && value.present).map(([key]) => key);
  const contraryReasons = [bullishRejection && direction === "SELL" ? "REJECTION_OPPOSES_SELL" : null, bearishRejection && direction === "BUY" ? "REJECTION_OPPOSES_BUY" : null].filter((x): x is string => Boolean(x));
  return { symbol: current.symbol, analysisAt, entryPrice: current.close, session: sessionAt(analysisAt), direction, rawConfidence, features, favorableReasons, contraryReasons, dataLimitations: ["SPREAD_NOT_AVAILABLE", "MICROSTRUCTURE_NOT_AVAILABLE", "NEWS_POINT_IN_TIME_NOT_AVAILABLE", "MACRO_POINT_IN_TIME_NOT_AVAILABLE"] };
}

export function evaluateProfessionalTrade(context: ProfessionalContext1m, outcomeCandle: MarketCandle | null, phase: ProfessionalPhaseId, cost: number | null, uniqueness = 1): EvaluatedProfessionalTrade {
  const expiryAt = context.analysisAt + 60_000;
  if (!outcomeCandle || outcomeCandle.timestamp + 60_000 !== expiryAt || !outcomeCandle.isClosed || cost === null || context.direction === "WAIT") {
    return { ...context, phase, expiryAt, exitPrice: outcomeCandle?.close ?? null, grossReturn: null, cost, netReturn: null, outcome: "UNKNOWN", uniqueness };
  }
  const grossReturn = context.direction === "BUY" ? change(outcomeCandle.close, context.entryPrice) : change(context.entryPrice, outcomeCandle.close);
  const netReturn = grossReturn - cost;
  return { ...context, phase, expiryAt, exitPrice: outcomeCandle.close, grossReturn, cost, netReturn, outcome: netReturn > 0 ? "WIN" : netReturn < 0 ? "LOSS" : "DRAW", uniqueness };
}

function wilson95(wins: number, n: number): readonly [number, number] {
  if (n <= 0) return [0, 1];
  const z = 1.959963984540054; const p = wins / n; const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

const combinations = (values: readonly string[], size: number, start = 0, prefix: readonly string[] = []): string[][] => {
  if (prefix.length === size) return [[...prefix]];
  const out: string[][] = [];
  for (let i = start; i <= values.length - (size - prefix.length); i++) out.push(...combinations(values, size, i + 1, [...prefix, values[i]!]));
  return out;
};

/** Discovery statistic. It never promotes a production signal; confirmation in
 * future phases and the separate production gate are still mandatory. */
export function mineWinSignatures(trades: readonly EvaluatedProfessionalTrade[], options: { minN?: number; maxFactors?: number; top?: number } = {}): WinSignature[] {
  const evaluated = trades.filter((t) => t.outcome === "WIN" || t.outcome === "LOSS");
  const totalWins = evaluated.filter((t) => t.outcome === "WIN").length;
  const baseline = evaluated.length ? totalWins / evaluated.length : 0;
  const featureUniverse = Array.from(new Set(evaluated.flatMap((t) => Object.entries(t.features).filter(([, v]) => v.availability === "OBSERVED" && v.present).map(([k]) => k)))).sort();
  const maxFactors = clamp(Math.floor(options.maxFactors ?? 3), 1, 5);
  const candidates = Array.from({ length: maxFactors }, (_, i) => combinations(featureUniverse, i + 1)).flat();
  const minN = options.minN ?? 30;
  const ranked: WinSignature[] = [];
  for (const clauses of candidates) {
    const present = evaluated.filter((t) => clauses.every((key) => t.features[key]?.availability === "OBSERVED" && t.features[key]?.present === true));
    if (present.length < minN) continue;
    const wins = present.filter((t) => t.outcome === "WIN").length; const losses = present.length - wins;
    const absent = evaluated.filter((t) => !present.includes(t));
    const absentWins = absent.filter((t) => t.outcome === "WIN").length; const absentLosses = absent.length - absentWins;
    const adjusted = [wins, losses, absentWins, absentLosses].some((value) => value === 0);
    const [a, b, c, d] = adjusted ? [wins + 0.5, losses + 0.5, absentWins + 0.5, absentLosses + 0.5] : [wins, losses, absentWins, absentLosses];
    const precision = wins / present.length;
    ranked.push({ id: clauses.join("&"), clauses, n: present.length, effectiveN: present.reduce((sum, t) => sum + clamp(t.uniqueness, 0, 1), 0), wins, losses, precision, baseline, lift: baseline > 0 ? precision / baseline : 0, oddsRatio: (a * d) / Math.max(Number.EPSILON, b * c), oddsRatioAdjusted: adjusted, confidence95: wilson95(wins, present.length), netEv: present.reduce((sum, t) => sum + (t.netReturn ?? 0), 0) / present.length });
  }
  return ranked.sort((a, b) => b.confidence95[0] - a.confidence95[0] || b.netEv - a.netEv || b.effectiveN - a.effectiveN || a.id.localeCompare(b.id)).slice(0, options.top ?? 20);
}

export function assertChronologicalPhaseWindows(windows: readonly { phase: ProfessionalPhaseId; from: number; to: number }[]): void {
  const expected: readonly ProfessionalPhaseId[] = ["A", "B", "C", "D", "E"];
  if (windows.length !== expected.length) throw new Error("PROFESSIONAL_1M_REQUIRES_FIVE_PHASES");
  windows.forEach((window, index) => {
    if (window.phase !== expected[index] || window.from >= window.to) throw new Error("PROFESSIONAL_1M_INVALID_PHASE_WINDOW");
    if (index > 0 && window.from <= windows[index - 1]!.to) throw new Error("PROFESSIONAL_1M_PHASE_OVERLAP");
  });
}
