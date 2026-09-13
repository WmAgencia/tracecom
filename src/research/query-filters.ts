/** Safe, typed query filters. No SQL, no arbitrary expressions. */
import type { DiagnosticEvent, FastDecisionSample, PositionSample, SettlementSample } from "./audit-engine.js";
import type { Evaluation } from "./replay-engine.js";

export type EvaluationQuery = { result?: "WIN" | "LOSS" | "DRAW" | "UNKNOWN"; minConfidence?: number; trendAlignment?: string; regime?: string; decision?: "BUY" | "SELL" | "WAIT"; marketEventId?: string };

export function queryEvaluations(evaluations: readonly Evaluation[], query: EvaluationQuery): Evaluation[] {
  return evaluations.filter((item) => {
    if (query.result && item.counterfactualResult !== query.result) return false;
    if (query.minConfidence !== undefined && !(item.rawConfidence >= query.minConfidence)) return false;
    if (query.trendAlignment && item.trendAlignment !== query.trendAlignment) return false;
    if (query.regime && item.regime !== query.regime) return false;
    if (query.decision && item.decision !== query.decision) return false;
    if (query.marketEventId && item.marketEventId !== query.marketEventId) return false;
    return true;
  });
}

export type SettlementQuery = { result?: string; minEntryConfidence?: number; signalId?: string };

export function querySettlements(settlements: readonly SettlementSample[], query: SettlementQuery): SettlementSample[] {
  return settlements.filter((item) => {
    if (query.result && item.result !== query.result) return false;
    if (query.signalId && item.signalId !== query.signalId) return false;
    return true;
  });
}

export type EventQuery = { eventType?: string; signalId?: string; from?: number; to?: number };

export function queryEvents(events: readonly DiagnosticEvent[], query: EventQuery): DiagnosticEvent[] {
  return events.filter((item) => {
    if (query.eventType && item.type !== query.eventType) return false;
    if (query.signalId && item.signalId !== query.signalId) return false;
    if (query.from !== undefined && item.t < query.from) return false;
    if (query.to !== undefined && item.t > query.to) return false;
    return true;
  });
}

export type PositionQuery = { hasOpenPosition?: boolean; direction?: string };

export function queryPositions(positions: readonly PositionSample[], query: PositionQuery): PositionSample[] {
  return positions.filter((item) => {
    if (query.hasOpenPosition !== undefined && (item.hasOpenPosition === true) !== query.hasOpenPosition) return false;
    if (query.direction && item.direction !== query.direction) return false;
    return true;
  });
}

export type DecisionQuery = { deepFastAlignment?: string; counterTrend?: boolean; decision?: string };

export function queryFastDecisions(decisions: readonly FastDecisionSample[], query: DecisionQuery): FastDecisionSample[] {
  return decisions.filter((item) => {
    if (query.deepFastAlignment && item.deepFastAlignment !== query.deepFastAlignment) return false;
    if (query.counterTrend !== undefined && (item.counterTrend === true) !== query.counterTrend) return false;
    if (query.decision && item.decision !== query.decision) return false;
    return true;
  });
}
