/** Deterministic Fast Decision Path for the T+60s target.
 *
 * No LLM call happens here: the fast path consumes an incremental market
 * context (price observations, frame activity, a versioned deep-analysis
 * context) and answers the only question that matters:
 * "over EXACTLY the next 60 seconds, is settlement price above, below or
 * equal to the causal entry price?"
 *
 * Candles are evidence (5s). Visible window is context (~5m). Horizon = 60s.
 */
import { classifyRegime, type MarketRegime, type RegimeObservation, type RegimeResult } from "./regime.js";
import { DEFAULT_PROFILE, evaluateAllProfiles, PROFILE_IDS, type DirectionalEvidence, type Profile, type ProfileDecision } from "./profiles.js";
import { buildMacroContext, buildMicroContext, counterTrendEvidence, trendAlignmentFor, type MacroState, type MicroState, type TrendAlignment } from "./macro-context.js";

export const PREDICTION_HORIZON_SECONDS = 60;
export const FAST_PATH_DEADLINE_MS = 5_000;
export const DEEP_CONTEXT_FRESH_MS = 90_000;

export type FastFrame = { capturedAt: number; frameDifference?: number | null; averageLuma?: number | null };
export type DeepContext = { version: number; at: number; regime?: string | null; trend?: string | null; momentum?: string | null } | null;

export type FastInput = {
  now: number;
  prices: readonly RegimeObservation[];
  frames?: readonly FastFrame[];
  deepContext?: DeepContext;
  profile?: Profile;
  previousDecision?: string | null;
  previousLean?: string | null;
  deadlineMs?: number;
  previousMacroState?: MacroState | null;
};

export type FastResult = {
  predictionHorizonSeconds: number;
  candleSeconds: number;
  fastPathStatus: "FAST_PATH_COMPLETED" | "FAST_PATH_TIMEOUT";
  operational: boolean;
  decision: "BUY" | "SELL" | "WAIT";
  selectedProfile: Profile;
  profiles: Record<Profile, ProfileDecision>;
  directionalLean: "BUY" | "SELL" | "NONE";
  leanConfidence: number;
  rawConfidence: number;
  pBuy: number;
  pSell: number;
  pWait: number;
  probabilitySource: "EVIDENCE_MODEL";
  bullScore: number;
  bearScore: number;
  conflictScore: number;
  regime: MarketRegime;
  regimeConfidence: number;
  regimeEvidence: string[];
  deepContextVersion: number | null;
  deepAnalysisAgeMs: number | null;
  evidenceAgeMs: number | null;
  macroTrend: string;
  macroTrendConfidence: number;
  macroStructure: string;
  microTrend: string;
  microMomentum: number;
  trendAlignment: TrendAlignment;
  counterTrend: boolean;
  counterTrendReason: string | null;
  reversalEvidence: string[];
  deepFastAlignment: "ALIGNED" | "CONFLICT" | "DEEP_STALE" | "DEEP_UNAVAILABLE";
  macroState: MacroState;
  timings: { observationMs: number; regimeMs: number; bullBearMs: number; arbiterMs: number; totalMs: number };
};

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; }

export const FAST_THRESHOLDS = Object.freeze({ momentumScalePct: .05, leanEpsilon: .05, activityFloor: .005, regimeBiasCap: .3, deepBiasCap: .12 });

export function buildFastDecision(input: FastInput): FastResult {
  const started = Date.now();
  const profile: Profile = input.profile && PROFILE_IDS.includes(input.profile) ? input.profile : DEFAULT_PROFILE;
  const causalPrices = input.prices.filter((item) => Number.isFinite(item.value) && item.value > 0 && item.timestamp <= input.now).sort((a, b) => a.timestamp - b.timestamp);
  const observationMs = Date.now() - started;
  const regimeStarted = Date.now();
  const regime: RegimeResult = classifyRegime(causalPrices, input.now);
  const regimeMs = Date.now() - regimeStarted;
  const bullBearStarted = Date.now();
  const window = causalPrices.slice(-12).map((item) => item.value);
  const latest = window.length ? window[window.length - 1]! : null;
  const reference = window.length > 1 ? median(window.slice(0, -1)) : latest;
  const momentumPct = latest !== null && reference ? ((latest - reference) / reference) * 100 : 0;
  const momentumScore = clamp(momentumPct / FAST_THRESHOLDS.momentumScalePct, -1, 1);
  const activityValues = (input.frames ?? []).filter((frame) => frame.capturedAt <= input.now && Number.isFinite(Number(frame.frameDifference))).map((frame) => Number(frame.frameDifference));
  const activity = activityValues.length ? activityValues.reduce((sum, value) => sum + value, 0) / activityValues.length : 0;
  let regimeBias = 0;
  if (regime.regime === "TREND_UP") regimeBias = .25;
  else if (regime.regime === "TREND_DOWN") regimeBias = -.25;
  else if (regime.regime === "BREAKOUT") regimeBias = Math.sign(momentumScore) * .3;
  else if (regime.regime === "REVERSAL") regimeBias = -Math.sign(momentumScore) * .2;
  regimeBias = clamp(regimeBias, -FAST_THRESHOLDS.regimeBiasCap, FAST_THRESHOLDS.regimeBiasCap);
  const deepContext = input.deepContext ?? null;
  const deepAnalysisAgeMs = deepContext ? Math.max(0, input.now - deepContext.at) : null;
  let deepBias = 0;
  if (deepContext && deepAnalysisAgeMs !== null && deepAnalysisAgeMs <= DEEP_CONTEXT_FRESH_MS) {
    const trend = String(deepContext.trend ?? "").toUpperCase();
    const momentum = String(deepContext.momentum ?? "").toUpperCase();
    if (trend === "BULLISH" || trend === "UP") deepBias += .05;
    if (trend === "BEARISH" || trend === "DOWN") deepBias -= .05;
    if (momentum === "UP") deepBias += .05;
    if (momentum === "DOWN") deepBias -= .05;
    deepBias = clamp(deepBias, -FAST_THRESHOLDS.deepBiasCap, FAST_THRESHOLDS.deepBiasCap);
  }
  const macroState = buildMacroContext(causalPrices, input.now, input.previousMacroState ?? null);
  const microState: MicroState = buildMicroContext(causalPrices, input.now);
  const macroBias = clamp(macroState.trend === "UP" ? .2 : macroState.trend === "STRONG_UP" ? .3 : macroState.trend === "DOWN" ? -.2 : macroState.trend === "STRONG_DOWN" ? -.3 : 0, -.3, .3);
  const directionalScore = clamp(momentumScore * .7 + regimeBias + deepBias + macroBias, -1, 1);
  const bullScore = (directionalScore + 1) / 2;
  const bearScore = 1 - bullScore;
  const separation = Math.abs(bullScore - bearScore);
  const pWait = conflictScoreFor(separation);
  const pBuy = bullScore * (1 - pWait);
  const pSell = bearScore * (1 - pWait);
  const activityPenalty = activity < FAST_THRESHOLDS.activityFloor ? .05 : 0;
  const rawConfidence = clamp(.5 + separation * .4 - activityPenalty, .5, .9);
  const directionalLean: "BUY" | "SELL" | "NONE" = directionalScore > FAST_THRESHOLDS.leanEpsilon ? "BUY" : directionalScore < -FAST_THRESHOLDS.leanEpsilon ? "SELL" : "NONE";
  const conflictScore = clamp(1 - separation, 0, 1);
  const trendAlignment: TrendAlignment = trendAlignmentFor(directionalLean, macroState.trend);
  const reversalEvidence = trendAlignment === "COUNTER_TREND" && directionalLean !== "NONE" ? counterTrendEvidence(directionalLean, macroState.trend, microState, causalPrices, input.now) : [];
  const counterTrend = trendAlignment === "COUNTER_TREND";
  const deepFastAlignment: "ALIGNED" | "CONFLICT" | "DEEP_STALE" | "DEEP_UNAVAILABLE" = !deepContext ? "DEEP_UNAVAILABLE" : deepAnalysisAgeMs !== null && deepAnalysisAgeMs > DEEP_CONTEXT_FRESH_MS ? "DEEP_STALE" : ((String(deepContext.trend ?? "").toUpperCase() === "BULLISH" && directionalLean === "SELL") || (String(deepContext.trend ?? "").toUpperCase() === "BEARISH" && directionalLean === "BUY")) ? "CONFLICT" : "ALIGNED";
  const bullBearMs = Date.now() - bullBearStarted;
  const arbiterStarted = Date.now();
  const evidence: DirectionalEvidence = { bullScore, bearScore, directionalLean, rawConfidence, regime: regime.regime, regimeConfidence: regime.confidence, conflictScore, trendAlignment, reversalEvidenceCount: reversalEvidence.length };
  const profiles = evaluateAllProfiles(evidence);
  const decision = profiles[profile].decision;
  const arbiterMs = Date.now() - arbiterStarted;
  const totalMs = Date.now() - started;
  const deadlineMs = input.deadlineMs ?? FAST_PATH_DEADLINE_MS;
  const withinDeadline = deadlineMs > 0 && totalMs <= deadlineMs;
  const enoughEvidence = causalPrices.length >= 2;
  return {
    predictionHorizonSeconds: PREDICTION_HORIZON_SECONDS,
    candleSeconds: 5,
    fastPathStatus: withinDeadline ? "FAST_PATH_COMPLETED" : "FAST_PATH_TIMEOUT",
    operational: withinDeadline && enoughEvidence,
    decision: withinDeadline && enoughEvidence ? decision : "WAIT",
    selectedProfile: profile,
    profiles,
    directionalLean,
    leanConfidence: rawConfidence,
    rawConfidence,
    pBuy,
    pSell,
    pWait,
    probabilitySource: "EVIDENCE_MODEL",
    bullScore,
    bearScore,
    conflictScore,
    regime: regime.regime,
    regimeConfidence: regime.confidence,
    regimeEvidence: regime.evidence,
    deepContextVersion: deepContext?.version ?? null,
    deepAnalysisAgeMs,
    evidenceAgeMs: latest !== null && causalPrices.length ? input.now - causalPrices[causalPrices.length - 1]!.timestamp : null,
    macroTrend: macroState.trend,
    macroTrendConfidence: macroState.confidence,
    macroStructure: macroState.evidence.join(" · "),
    microTrend: microState.microTrend,
    microMomentum: microState.microMomentum,
    trendAlignment,
    counterTrend,
    counterTrendReason: counterTrend ? (reversalEvidence.length ? "reversal_evidence_present" : "no_reversal_evidence") : null,
    reversalEvidence,
    deepFastAlignment,
    macroState,
    timings: { observationMs, regimeMs, bullBearMs, arbiterMs, totalMs },
  };
}

function conflictScoreFor(separation: number): number { return clamp(1 - separation, 0, 1); }
