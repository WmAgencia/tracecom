/** Durable training-session domain logic.
 *
 * This module is intentionally free of transport concerns so the same rules can
 * run behind any store (PostgreSQL relay, memory fallback, tests). Outcomes are
 * only ever produced by settlement.ts#settleTrade.
 */
import { settleTrade } from "./settlement.js";
import { buildCalibration, edgeVsBreakEven, type CalibrationSample } from "../analytics/confidence-calibration.js";

export const PREDICTION_HORIZON_SECONDS = 60;
export type ProfileCounters = { decisions: number; BUY: number; SELL: number; WAIT: number };

export type TrainingDirection = "BUY" | "SELL";
export type TrainingOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";
export type TrainingStatus = "CREATED" | "ACTIVE" | "STOPPING" | "COMPLETED" | "EXPIRED" | "ERROR";

export type VirtualTrade = {
  tradeId: string; analysisId: string; symbol: string; direction: TrainingDirection;
  decisionTimestamp: number; entryTimestamp: number; entryReference: number | null;
  horizonSeconds: number; suggestedStake: number | null; confidence: number; dataQuality: number;
  features: unknown; framesHash: string | null; agentVersion: string; result: TrainingOutcome | null;
  counterfactual?: boolean; shadowKind?: string; leanConfidence?: number | null;
  entryPriceSource?: string; settlementPriceSource?: string; priceConfidence?: number | null;
  controlDecision?: string; challengerDecision?: string;
  predictionHorizonSeconds?: number; rawConfidence?: number | null; calibratedConfidence?: number | null;
  selectedProfile?: string; regime?: string | null; profileDecisions?: Record<string, { decision: string; confidence: number | null }>;
  synthetic?: boolean; payoutAtDecision?: number | null; breakEvenWinRate?: number | null;
  exitTimestamp?: number; exitReference?: number | null;
};

export type TrainingSession = {
  id: string; createdAt: number; updatedAt: number; status: TrainingStatus; persistence?: string; sessionId?: string | null;
  symbol: string | null; marketType: string | null;
  horizonSeconds: number; maxEvaluatedTrades: number; frozen: Record<string, string>;
  analyses: number; decisions: Record<"BUY" | "SELL" | "WAIT", number>;
  profiles?: Record<string, ProfileCounters>;
  trades: VirtualTrade[];
};

export type CreateTrainingInput = {
  id: string; sessionId?: string | null; symbol?: string | null; marketType?: string | null; horizonSeconds?: number; maxEvaluatedTrades?: number;
  agentVersion?: string; promptVersion?: string; featureVersion?: string; visionVersion?: string;
};

export type AnalysisInput = {
  timestamp: number; analysis: Record<string, unknown>; reference: number | null;
  referenceSource?: string | null; priceConfidence?: number | null; suggestedStake?: number | null; symbol?: string | null;
  features?: unknown; framesHash?: string | null;
  profiles?: Record<string, { decision: string; confidence: number | null }>;
  selectedProfile?: string | null; regime?: string | null; rawConfidence?: number | null; calibratedConfidence?: number | null;
  synthetic?: boolean; payoutAtDecision?: number | null; breakEvenWinRate?: number | null;
  settlementResolver?: (trade: VirtualTrade) => { value: number; source?: string; confidence?: number } | null;
};

function bounded(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}
function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function createTrainingSession(input: CreateTrainingInput): TrainingSession {
  const now = Date.now();
  const horizonSeconds = Math.max(10, Math.min(300, Number(input.horizonSeconds) || 60));
  const maxEvaluatedTrades = Math.max(1, Math.min(10_000, Number(input.maxEvaluatedTrades) || 100));
  return {
    id: input.id, sessionId: input.sessionId ?? null, createdAt: now, updatedAt: now, status: "ACTIVE", persistence: "MEMORY_FALLBACK",
    symbol: typeof input.symbol === "string" ? input.symbol.slice(0, 32) : null,
    marketType: typeof input.marketType === "string" ? input.marketType.slice(0, 20) : null,
    horizonSeconds, maxEvaluatedTrades,
    frozen: {
      agentVersion: typeof input.agentVersion === "string" ? input.agentVersion.slice(0, 64) : "FABLE_TRADER_V1",
      promptVersion: typeof input.promptVersion === "string" ? input.promptVersion.slice(0, 64) : "vision-v1",
      featureVersion: typeof input.featureVersion === "string" ? input.featureVersion.slice(0, 64) : "screen-motion-v1",
      visionVersion: typeof input.visionVersion === "string" ? input.visionVersion.slice(0, 64) : "sanitized-crop-v1",
    },
    analyses: 0, decisions: { BUY: 0, SELL: 0, WAIT: 0 }, trades: [],
  };
}

export function trainingSummary(session: TrainingSession) {
  const resolved = session.trades.filter((trade) => trade.result && trade.result !== "UNKNOWN");
  const wins = resolved.filter((trade) => trade.result === "WIN").length;
  const losses = resolved.filter((trade) => trade.result === "LOSS").length;
  const draws = resolved.filter((trade) => trade.result === "DRAW").length;
  const unknown = session.trades.filter((trade) => trade.result === "UNKNOWN").length;
  const leanTrades = session.trades.filter((trade) => trade.counterfactual === true);
  const leanResolved = leanTrades.filter((trade) => trade.result && trade.result !== "UNKNOWN");
  const leanWins = leanResolved.filter((trade) => trade.result === "WIN").length;
  const leanLosses = leanResolved.filter((trade) => trade.result === "LOSS").length;
  const leanDraws = leanResolved.filter((trade) => trade.result === "DRAW").length;
  const leanUnknown = leanTrades.filter((trade) => trade.result === "UNKNOWN").length;
  const abSummary = Object.fromEntries(["CONTROL", "CHALLENGER"].map((variant) => {
    const rows = session.trades.filter((trade) => trade.result !== null && (variant === "CONTROL" ? trade.controlDecision : trade.challengerDecision));
    const winsForVariant = rows.filter((trade) => trade.result === "WIN").length;
    const lossesForVariant = rows.filter((trade) => trade.result === "LOSS").length;
    return [variant.toLowerCase(), { count: rows.length, WIN: winsForVariant, LOSS: lossesForVariant, DRAW: rows.filter((trade) => trade.result === "DRAW").length, UNKNOWN: rows.filter((trade) => trade.result === "UNKNOWN").length, WR: winsForVariant + lossesForVariant ? winsForVariant / (winsForVariant + lossesForVariant) : null }];
  }));
  const directionalLeanBuckets = ["50-55", "55-60", "60-65", "65-70", "70-75", "75+"] as const;
  const leanBuckets = Object.fromEntries(directionalLeanBuckets.map((bucket) => [bucket, { count: 0, WIN: 0, LOSS: 0, DRAW: 0, WR: null as number | null }])) as Record<string, { count: number; WIN: number; LOSS: number; DRAW: number; WR: number | null }>;
  for (const trade of leanTrades) { const confidence = Number(trade.leanConfidence); const bucket = confidence >= .75 ? "75+" : confidence >= .70 ? "70-75" : confidence >= .65 ? "65-70" : confidence >= .60 ? "60-65" : confidence >= .55 ? "55-60" : "50-55"; const entry = leanBuckets[bucket]!; entry.count += 1; if (trade.result === "WIN") entry.WIN += 1; if (trade.result === "LOSS") entry.LOSS += 1; if (trade.result === "DRAW") entry.DRAW += 1; entry.WR = entry.WIN + entry.LOSS ? entry.WIN / (entry.WIN + entry.LOSS) : null; }
  const profileSummary = Object.fromEntries(Object.entries(session.profiles ?? {}).map(([profileId, counters]) => {
    const rows = session.trades.filter((trade) => trade.profileDecisions && trade.profileDecisions[profileId] && trade.result !== null && (trade.profileDecisions[profileId]!.decision === "BUY" || trade.profileDecisions[profileId]!.decision === "SELL"));
    const profileWins = rows.filter((trade) => trade.result === "WIN").length;
    const profileLosses = rows.filter((trade) => trade.result === "LOSS").length;
    const profileDraws = rows.filter((trade) => trade.result === "DRAW").length;
    const profileUnknown = rows.filter((trade) => trade.result === "UNKNOWN").length;
    return [profileId, { ...counters, signalRate: counters.decisions ? (counters.BUY + counters.SELL) / counters.decisions : null, evaluated: profileWins + profileLosses + profileDraws, WIN: profileWins, LOSS: profileLosses, DRAW: profileDraws, UNKNOWN: profileUnknown, coverage: counters.decisions ? (profileWins + profileLosses + profileDraws + profileUnknown) / counters.decisions : null, WR: profileWins + profileLosses ? profileWins / (profileWins + profileLosses) : null, status: "EXPERIMENTAL" }];
  }));
  const regimeBreakdown = Object.fromEntries([...new Set(session.trades.map((trade) => trade.regime ?? "UNKNOWN"))].map((regime) => {
    const rows = session.trades.filter((trade) => (trade.regime ?? "UNKNOWN") === regime && trade.result !== null);
    const regimeWins = rows.filter((trade) => trade.result === "WIN").length;
    const regimeLosses = rows.filter((trade) => trade.result === "LOSS").length;
    return [regime, { evaluated: rows.length, WIN: regimeWins, LOSS: regimeLosses, DRAW: rows.filter((trade) => trade.result === "DRAW").length, UNKNOWN: rows.filter((trade) => trade.result === "UNKNOWN").length, WR: regimeWins + regimeLosses ? regimeWins / (regimeWins + regimeLosses) : null }];
  }));
  const calibrationSamples: CalibrationSample[] = session.trades.filter((trade) => trade.result !== null).map((trade) => ({ direction: trade.direction, confidence: trade.rawConfidence ?? trade.confidence, result: trade.result, synthetic: trade.synthetic === true, regime: trade.regime ?? null, profile: trade.selectedProfile ?? null }));
  const calibration = buildCalibration(calibrationSamples);
  const payoutValues = session.trades.map((trade) => Number(trade.payoutAtDecision)).filter((value) => Number.isFinite(value) && value > 0);
  const averagePayout = payoutValues.length ? payoutValues.reduce((sum, value) => sum + value, 0) / payoutValues.length : null;
  const overallWR = wins + losses ? wins / (wins + losses) : null;
  return {
    id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, status: session.status,
    predictionHorizonSeconds: PREDICTION_HORIZON_SECONDS, profiles: profileSummary, regimeBreakdown, calibration,
    payoutAtDecision: averagePayout, edgeVsBreakEven: edgeVsBreakEven(overallWR, averagePayout),
    symbol: session.symbol, marketType: session.marketType,
    horizonSeconds: session.horizonSeconds, maxEvaluatedTrades: session.maxEvaluatedTrades,
    frozen: session.frozen, analyses: session.analyses, BUY: session.decisions.BUY, SELL: session.decisions.SELL,
    WAIT: session.decisions.WAIT, openVirtualTrades: session.trades.filter((trade) => trade.result === null).length,
    evaluatedTrades: resolved.length, WIN: wins, LOSS: losses, DRAW: draws, UNKNOWN: unknown,
    WR: resolved.length ? wins / resolved.length : null, directionalLeanTrades: leanTrades.length, directionalLeanEvaluated: leanResolved.length, directionalLeanWIN: leanWins, directionalLeanLOSS: leanLosses, directionalLeanDRAW: leanDraws, directionalLeanUNKNOWN: leanUnknown, directionalLeanWR: leanWins + leanLosses ? leanWins / (leanWins + leanLosses) : null, directionalLeanBuckets: leanBuckets, abSummary, currentAgentVersion: session.frozen.agentVersion,
    persistence: session.persistence || "MEMORY_FALLBACK", trades: session.trades.slice(-25),
  };
}

export function evaluateVirtualTrades(session: TrainingSession, timestamp: number, reference: number | null, source = "UNAVAILABLE", priceConfidence: number | null = null, resolver?: (trade: VirtualTrade) => { value: number; source?: string; confidence?: number } | null) {
  for (const trade of session.trades) {
    if (trade.result !== null || timestamp < trade.entryTimestamp + trade.horizonSeconds * 1_000) continue;
    const resolved = resolver ? resolver(trade) : null; const exitReference = resolved ? resolved.value : reference; const exitSource = resolved?.source || source; const exitConfidence = resolved?.confidence ?? priceConfidence;
    trade.exitTimestamp = timestamp;
    trade.exitReference = exitReference;
    trade.settlementPriceSource = exitReference === null ? "UNAVAILABLE" : exitSource;
    trade.priceConfidence = exitConfidence;
    if (exitReference !== null) console.info("SETTLEMENT_PRICE_LOCKED", JSON.stringify({ tradeId: trade.tradeId, price: exitReference, timestamp, source: exitSource, confidence: exitConfidence }));
    trade.result = settleTrade({ direction: trade.direction, entryPrice: trade.entryReference,
      exitPrice: exitReference, entryTimestamp: trade.entryTimestamp,
      exitTimestamp: timestamp, dueTimestamp: trade.entryTimestamp + trade.horizonSeconds * 1_000 }).outcome;
    console.info("TRADE_SETTLED", JSON.stringify({ tradeId: trade.tradeId, result: trade.result, source: trade.settlementPriceSource }));
  }
}

/** Appends one analysis to the session, creating an operational or counterfactual
 * trade under the same rules previously enforced inline in the API handler. */
export function applyTrainingAnalysis(session: TrainingSession, input: AnalysisInput): VirtualTrade | null {
  evaluateVirtualTrades(session, input.timestamp, input.reference, input.referenceSource || "UNAVAILABLE", input.priceConfidence ?? null, input.settlementResolver);
  session.analyses += 1;
  const analysis = input.analysis;
  const decision = analysis.decision === "BUY" || analysis.decision === "SELL" ? analysis.decision as TrainingDirection : "WAIT";
  const lean = analysis.directionalLean === "BUY" || analysis.directionalLean === "SELL" ? analysis.directionalLean as TrainingDirection : null;
  const counterfactualLean = decision === "WAIT" && lean !== null;
  session.decisions[decision] += 1;
  session.profiles = session.profiles ?? {};
  if (input.profiles && typeof input.profiles === "object") {
    for (const [profileId, value] of Object.entries(input.profiles)) {
      const counters = session.profiles[profileId] ??= { decisions: 0, BUY: 0, SELL: 0, WAIT: 0 };
      const profileDecision = value && typeof value === "object" && (value as Record<string, unknown>).decision === "BUY" ? "BUY" : (value as Record<string, unknown>)?.decision === "SELL" ? "SELL" : "WAIT";
      counters.decisions += 1; counters[profileDecision] += 1;
    }
  }
  const symbol = typeof input.symbol === "string" && input.symbol ? input.symbol.slice(0, 32) : session.symbol ?? "UNAVAILABLE";
  const hasOpenSameSymbol = session.trades.some((trade) => trade.result === null && trade.symbol === symbol);
  const evaluated = trainingSummary(session).evaluatedTrades;
  if ((decision !== "WAIT" || counterfactualLean) && !hasOpenSameSymbol && evaluated < session.maxEvaluatedTrades) {
    const multiAgent = analysis.multiAgent && typeof analysis.multiAgent === "object" ? analysis.multiAgent as Record<string, unknown> : {};
    const control = multiAgent.control && typeof multiAgent.control === "object" ? multiAgent.control as Record<string, unknown> : {};
    const challenger = multiAgent.challenger && typeof multiAgent.challenger === "object" ? multiAgent.challenger as Record<string, unknown> : {};
    const trade: VirtualTrade = {
      tradeId: `virtual_${input.timestamp}_${Math.random().toString(36).slice(2, 8)}`,
      analysisId: typeof analysis.analysisId === "string" ? analysis.analysisId : `analysis_${input.timestamp}`,
      symbol,
      direction: decision === "WAIT" ? lean! : decision, decisionTimestamp: input.timestamp, entryTimestamp: input.timestamp, entryReference: input.reference,
      horizonSeconds: session.horizonSeconds,
      suggestedStake: finiteOrNull(input.suggestedStake),
      confidence: bounded(analysis.confidence, 0), dataQuality: bounded(analysis.dataQuality, 0),
      features: input.features ?? null, framesHash: typeof input.framesHash === "string" ? input.framesHash.slice(0, 128) : null,
      agentVersion: session.frozen.agentVersion || "FABLE_TRADER_V1", result: null,
      counterfactual: counterfactualLean, shadowKind: counterfactualLean ? "WAIT_DIRECTIONAL_LEAN" : "DECISION",
      leanConfidence: finiteOrNull(analysis.leanConfidence),
      entryPriceSource: input.referenceSource || "UNAVAILABLE", settlementPriceSource: "UNAVAILABLE", priceConfidence: input.priceConfidence ?? null,
      controlDecision: typeof control.decision === "string" ? control.decision : decision,
      challengerDecision: typeof challenger.decision === "string" ? challenger.decision : decision,
      predictionHorizonSeconds: PREDICTION_HORIZON_SECONDS,
      rawConfidence: input.rawConfidence ?? finiteOrNull(analysis.confidence),
      calibratedConfidence: input.calibratedConfidence ?? null,
      selectedProfile: typeof input.selectedProfile === "string" ? input.selectedProfile : "BALANCED",
      regime: typeof input.regime === "string" ? input.regime : null,
      profileDecisions: input.profiles ?? undefined,
      synthetic: input.synthetic === true,
      payoutAtDecision: input.payoutAtDecision ?? null,
      breakEvenWinRate: input.breakEvenWinRate ?? null,
    };
    session.trades.push(trade);
    return trade;
  }
  return null;
}
