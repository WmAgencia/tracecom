/**
 * Causal, prequential multi-horizon research engine.
 *
 * This module intentionally has no broker capability.  It operates on closed
 * candles supplied by a read-only provider and refuses a horizon finer than
 * the provider's declared native resolution.  In particular, one-minute OHLC
 * is never expanded into 30 s or 45 s outcomes.
 */
import type { MarketCandle } from "../market/model";
import { executionCostPct } from "../risk/fees";
import { settleTrade, type SettlementResult } from "../training/settlement";

/** TRACE_1M is the only active research target. Older horizon artifacts remain
 * historical evidence, but no new sub-/multi-minute study starts from here. */
export const TRACE_1M_HORIZON_SECONDS = 60 as const;
export const RESEARCH_HORIZONS_SECONDS = [TRACE_1M_HORIZON_SECONDS] as const;
/** Accepted only to preserve provider-limit tests and historical artifact
 * parsing; the active runner above schedules TRACE_1M alone. */
export type ResearchHorizonSeconds = 30 | 45 | 60 | 120 | 180 | 300;
export type ResearchStatus = "COMPLETED" | "PROVIDER_LIMITATION" | "INSUFFICIENT_DATA";
export type ResearchDirection = "BUY" | "SELL" | "WAIT";

export interface ResearchInput {
  readonly provider: string;
  /** Native (not interpolated) bar/quote resolution. */
  readonly minimumResolutionSeconds: number;
  readonly series: Readonly<Record<string, readonly MarketCandle[]>>;
  readonly maxActionable?: number;
}

export interface ResearchTrade {
  readonly tradeId: string;
  readonly ordinal: number;
  readonly phase: "ADAPTIVE" | "LOCKED_HOLDOUT";
  readonly modelVersion: string;
  readonly strategyVersion: string;
  readonly strategy: string;
  readonly timestamp: string;
  readonly expiryTimestamp: string;
  readonly symbol: string;
  readonly horizonSeconds: ResearchHorizonSeconds;
  readonly direction: Exclude<ResearchDirection, "WAIT">;
  readonly probability: number;
  readonly outcome: "WIN" | "LOSS" | "DRAW";
  /** Prices and reason retained so every reported label can be independently
   * reconciled against the canonical settlement function. */
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly settlementReason: SettlementResult["reason"];
  readonly grossReturn: number;
  readonly netReturn: number;
  readonly cost: number;
  readonly session: string;
  readonly regime: string;
  readonly dataQualityScore: number;
  readonly reasonCodes: readonly string[];
}

export interface LearningEvent {
  readonly afterActionable: number;
  readonly modelVersion: string;
  readonly selectedStrategy: string;
  readonly reason: string;
}

export interface ExperimentResult {
  readonly horizonSeconds: ResearchHorizonSeconds;
  readonly status: ResearchStatus;
  readonly reason: string | null;
  readonly provider: string;
  readonly providerMinimumResolutionSeconds: number;
  readonly maxActionable: number;
  readonly trades: readonly ResearchTrade[];
  readonly learningHistory: readonly LearningEvent[];
  readonly holdoutFrozenAt: number | null;
  readonly rawN: number;
  readonly effectiveN: number;
  readonly uniqueness: number;
}

interface Candidate {
  readonly symbol: string;
  readonly candles: readonly MarketCandle[];
  readonly index: number;
  readonly entry: MarketCandle;
  readonly exit: MarketCandle;
  readonly direction: Exclude<ResearchDirection, "WAIT">;
  readonly probability: number;
  readonly session: string;
  readonly regime: string;
  readonly quality: number;
  readonly gross: number;
}

const pct = (a: number, b: number): number => b === 0 ? 0 : (a - b) / b;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const londonHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" });
const sessionCache = new Map<number, string>();
function session(timestamp: number): string {
  const bucket = Math.floor(timestamp / 3_600_000) * 3_600_000;
  const cached = sessionCache.get(bucket); if (cached) return cached;
  const hour = Number(londonHour.formatToParts(new Date(timestamp)).find((part) => part.type === "hour")?.value ?? 0);
  const value = hour >= 8 && hour < 13 ? "LONDON" : hour >= 13 && hour < 16 ? "LONDON_NEW_YORK_OVERLAP" : hour >= 0 && hour < 8 ? "ASIA" : "NEW_YORK_OR_ROLLOVER";
  sessionCache.set(bucket, value); return value;
}

function classifyRegime(candles: readonly MarketCandle[], i: number): string {
  const start = Math.max(0, i - 20);
  const drift = pct(candles[i]!.close, candles[start]!.close);
  const returns = candles.slice(start + 1, i + 1).map((row, j) => pct(row.close, candles[start + j]!.close));
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const vol = Math.sqrt(returns.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, returns.length));
  if (vol > 0.0015) return "HIGH_VOL";
  if (Math.abs(drift) > Math.max(vol * 4, 0.0004)) return drift > 0 ? "TREND_UP" : "TREND_DOWN";
  return "RANGE";
}

function momentum(candles: readonly MarketCandle[], i: number): { direction: Exclude<ResearchDirection, "WAIT"> | null; probability: number } {
  const fast = pct(candles[i]!.close, candles[i - 5]!.close);
  const slow = pct(candles[i]!.close, candles[i - 20]!.close);
  const rows = candles.slice(i - 20, i + 1);
  const rs = rows.slice(1).map((row, j) => pct(row.close, rows[j]!.close));
  const mean = rs.reduce((a, b) => a + b, 0) / Math.max(1, rs.length);
  const vol = Math.sqrt(rs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, rs.length));
  const z = vol > 1e-10 ? (fast + slow) / (vol * Math.sqrt(10)) : 0;
  if (Math.abs(z) < 0.22) return { direction: null, probability: 0.5 };
  return { direction: z > 0 ? "BUY" : "SELL", probability: clamp(0.5 + Math.abs(Math.tanh(z)) * 0.25, 0.5, 0.75) };
}

function continuous(rows: readonly MarketCandle[], start: number, end: number): boolean {
  for (let i = start + 1; i <= end; i++) if (rows[i]!.timestamp - rows[i - 1]!.timestamp !== 60_000) return false;
  return true;
}

function candidatesFor(series: Readonly<Record<string, readonly MarketCandle[]>>, horizon: ResearchHorizonSeconds): Candidate[] {
  const bars = horizon / 60;
  const out: Candidate[] = [];
  for (const [symbol, untrusted] of Object.entries(series)) {
    const sorted = [...untrusted].sort((a, b) => a.timestamp - b.timestamp);
    const candles = sorted.filter((c, i) => i === 0 || c.timestamp > sorted[i - 1]!.timestamp);
    // Per-symbol embargo equal to the outcome horizon. This makes outcome
    // windows non-overlapping within a pair; cross-pair dependence is reported
    // as a remaining limitation rather than silently treated as independent.
    for (let i = 20; i + bars < candles.length; i += bars) {
      if (!continuous(candles, i - 20, i + bars)) continue;
      const signal = momentum(candles, i);
      if (!signal.direction) continue;
      const entry = candles[i]!; const exit = candles[i + bars]!;
      const gross = signal.direction === "BUY" ? pct(exit.close, entry.close) : pct(entry.close, exit.close);
      const quality = entry.quality === "high" && exit.quality === "high" ? 1 : entry.quality === "low" || exit.quality === "low" ? 0.4 : 0.7;
      out.push({ symbol, candles, index: i, entry, exit, direction: signal.direction, probability: signal.probability, session: session(entry.timestamp), regime: classifyRegime(candles, i), quality, gross });
    }
  }
  return out.sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.symbol.localeCompare(b.symbol));
}

type Strategy = "BASELINE" | "LONDON_TREND" | "NO_HIGH_VOL";
function accepts(strategy: Strategy, row: Candidate): boolean {
  if (strategy === "BASELINE") return true;
  if (strategy === "LONDON_TREND") return (row.session === "LONDON" || row.session === "LONDON_NEW_YORK_OVERLAP") && row.regime.startsWith("TREND");
  return row.regime !== "HIGH_VOL";
}

function selectStrategy(observed: readonly Candidate[]): { strategy: Strategy; reason: string } {
  const cost = executionCostPct({ market: "forex" }) / 100;
  const scores = (Object.keys({ BASELINE: 0, LONDON_TREND: 0, NO_HIGH_VOL: 0 }) as Strategy[]).map((strategy) => {
    const rows = observed.filter((row) => accepts(strategy, row));
    const mean = rows.length ? rows.reduce((sum, row) => sum + row.gross - cost, 0) / rows.length : -Infinity;
    return { strategy, rows, mean };
  });
  const baseline = scores[0]!;
  const best = scores.filter((x) => x.rows.length >= 50 && x.mean > baseline.mean + 0.00002).sort((a, b) => b.mean - a.mean)[0];
  return best ? { strategy: best.strategy, reason: `prequential selection: ${best.strategy} had n=${best.rows.length} and prior net mean=${best.mean.toFixed(6)}` }
    : { strategy: "BASELINE", reason: "prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate" };
}

/** Expanding, causal reliability estimate. It is deliberately modest: with
 * little support it preserves the raw score instead of inventing confidence. */
function calibrate(raw: number, observed: readonly Candidate[]): number {
  const bucket = Math.floor(raw * 20);
  const comparable = observed.filter((row) => Math.floor(row.probability * 20) === bucket);
  if (comparable.length < 20) return raw;
  const wins = comparable.filter((row) => row.gross > 0).length;
  return clamp((wins + 1) / (comparable.length + 2), 0.01, 0.99);
}

/** Pure runner: tests may inject closed candles; it never fetches or trades. */
export function runPrequentialExperiment(input: ResearchInput, horizonSeconds: ResearchHorizonSeconds): ExperimentResult {
  const maxActionable = input.maxActionable ?? 1_000;
  if (horizonSeconds < input.minimumResolutionSeconds || 60 % input.minimumResolutionSeconds !== 0) {
    return { horizonSeconds, status: "PROVIDER_LIMITATION", reason: `Provider ${input.provider} native resolution is ${input.minimumResolutionSeconds}s; it cannot certify ${horizonSeconds}s outcomes without interpolation.`, provider: input.provider, providerMinimumResolutionSeconds: input.minimumResolutionSeconds, maxActionable, trades: [], learningHistory: [], holdoutFrozenAt: null, rawN: 0, effectiveN: 0, uniqueness: 0 };
  }
  const unsampledCandidates = candidatesFor(input.series, horizonSeconds);
  // Sampling positions are chosen before any labels are inspected and spread
  // across the available provider window. This avoids filling a 1,000-trade
  // experiment with only the first few hours of a seven-day history.
  const bySymbol = new Map<string, Candidate[]>();
  for (const row of unsampledCandidates) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);
  const candidates = Array.from(bySymbol.values()).flatMap((complete) => {
    // Keep a pre-outcome reserve for abstention filters while retaining a
    // broad temporal spread. This is not outcome-selected sampling.
    const take = Math.min(1_000, complete.length);
    return Array.from({ length: take }, (_, i) => complete[Math.floor(i * (complete.length - 1) / Math.max(1, take - 1))]!);
  }).sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.symbol.localeCompare(b.symbol));
  if (!candidates.length) return { horizonSeconds, status: "INSUFFICIENT_DATA", reason: "No continuous closed one-minute windows passed the data-quality gate.", provider: input.provider, providerMinimumResolutionSeconds: input.minimumResolutionSeconds, maxActionable, trades: [], learningHistory: [], holdoutFrozenAt: null, rawN: 0, effectiveN: 0, uniqueness: 0 };
  const observed: Candidate[] = []; const pending: Candidate[] = []; const trades: ResearchTrade[] = []; const events: LearningEvent[] = [];
  let strategy: Strategy = "BASELINE"; let model = 1; let frozen: Strategy | null = null;
  let frozenCalibration: ((raw: number) => number) | null = null;
  const cost = executionCostPct({ market: "forex" }) / 100;
  for (const row of candidates) {
    while (pending.length && pending[0]!.exit.timestamp + 60_000 <= row.entry.timestamp) observed.push(pending.shift()!);
    if (trades.length > 0 && trades.length % 100 === 0 && trades.length < 800 && frozen === null) {
      const selected = selectStrategy(observed); strategy = selected.strategy; model++;
      events.push({ afterActionable: trades.length, modelVersion: `mh-v${model}`, selectedStrategy: strategy, reason: selected.reason });
    }
    if (trades.length === 800 && frozen === null) {
      frozen = strategy;
      const snapshot = [...observed];
      frozenCalibration = (raw) => calibrate(raw, snapshot);
      events.push({ afterActionable: 800, modelVersion: `mh-v${model}`, selectedStrategy: strategy, reason: "LOCKED_HOLDOUT: features, threshold, expanding calibration snapshot and strategy frozen before trade 801." });
    }
    const active = frozen ?? strategy;
    if (!accepts(active, row) || row.quality < 0.7) continue;
    const net = row.gross - cost;
    const probability = frozenCalibration ? frozenCalibration(row.probability) : calibrate(row.probability, observed);
    const entryAt = row.entry.timestamp + 60_000;
    const expiryAt = row.exit.timestamp + 60_000;
    const settlement = settleTrade({
      direction: row.direction,
      entryPrice: row.entry.close,
      exitPrice: row.exit.close,
      entryTimestamp: entryAt,
      exitTimestamp: expiryAt,
      dueTimestamp: expiryAt,
      entrySymbol: row.symbol,
      exitSymbol: row.symbol,
    });
    if (settlement.outcome === "UNKNOWN") throw new Error(`SETTLEMENT_INVARIANT_FAILED: ${settlement.reason}`);
    trades.push({ tradeId: `mh-${horizonSeconds}-${row.symbol.replace("/", "")}-${entryAt}`, ordinal: trades.length + 1, phase: frozen ? "LOCKED_HOLDOUT" : "ADAPTIVE", modelVersion: `mh-v${model}`, strategyVersion: active, strategy: active, timestamp: new Date(entryAt).toISOString(), expiryTimestamp: new Date(expiryAt).toISOString(), symbol: row.symbol, horizonSeconds, direction: row.direction, probability, outcome: settlement.outcome, entryPrice: row.entry.close, exitPrice: row.exit.close, settlementReason: settlement.reason, grossReturn: row.gross, netReturn: net, cost, session: row.session, regime: row.regime, dataQualityScore: row.quality, reasonCodes: ["CLOSED_1M_SOURCE", "ENTRY_AT_CANDLE_CLOSE", "CAUSAL_ENTRY", "HORIZON_EMBARGO", "CANONICAL_SETTLE_TRADE", "ECONOMIC_DEAD_ZONE", frozenCalibration ? "CALIBRATION_FROZEN" : "EXPANDING_CAUSAL_CALIBRATION", `STRATEGY_${active}`] });
    pending.push(row);
    if (trades.length >= maxActionable) break;
  }
  return { horizonSeconds, status: trades.length ? "COMPLETED" : "INSUFFICIENT_DATA", reason: trades.length ? "Closed-candle causal study completed; cross-asset correlation is not estimated." : "No actionable candidates passed pre-registered gates.", provider: input.provider, providerMinimumResolutionSeconds: input.minimumResolutionSeconds, maxActionable, trades, learningHistory: events, holdoutFrozenAt: frozen ? 800 : null, rawN: trades.length, effectiveN: trades.length, uniqueness: trades.length ? 1 : 0 };
}
