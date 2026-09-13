/** Exclusive user-facing operational channel.
 *
 * 5s candles are new evidence, NOT permission to start a new operation. Only one
 * OperationalSignal may occupy the channel at a time, from lock to settlement.
 * Research/shadow decisions keep flowing and are counted, but never replace or
 * restart the displayed operation.
 */
import { settleTrade, type SettlementOutcome } from "../training/settlement.js";

export const ENTRY_COUNTDOWN_MS = 10_000;
export const CONFIRMATION_WINDOW_MS = 20_000;
export const COOLDOWN_MS = 5_000;
export const OPERATIONAL_HORIZON_SECONDS = 60;

export type ChannelStateName = "READY" | "SIGNAL_LOCKED" | "ENTRY_COUNTDOWN" | "WAITING_ENTRY_CONFIRMATION" | "POSITION_CONFIRMED" | "IN_POSITION" | "WAITING_SETTLEMENT" | "SETTLED" | "COOLDOWN" | "ENTRY_NOT_CONFIRMED" | "SIGNAL_EXPIRED" | "POSITION_DETECTION_UNCERTAIN" | "SETTLEMENT_UNKNOWN";

export type OperationalSignal = {
  signalId: string; direction: "BUY" | "SELL"; profile: string; rawConfidence: number; regime: string;
  macroTrend: string; microTrend: string; trendAlignment: string; counterTrend: boolean;
  createdAt: number; entryWindowMs: number; predictionHorizonSeconds: number; contextVersion: number | null;
  candleId: string | null; frameId: string | null; status: "ACTIVE" | "CANCELLED" | "EXPIRED" | "SETTLED";
};

export type ManualEntry = { price: number; confidence: number; source: string; timestamp: number; signalId: string };
export type ManualSettlement = { entryPrice: number; exitPrice: number | null; entryTimestamp: number; exitTimestamp: number; result: SettlementOutcome };

export type ChannelState = {
  state: ChannelStateName; signal: OperationalSignal | null; countdownEndsAt: number; confirmationDeadline: number;
  manualEntry: ManualEntry | null; settlementAt: number; settlement: ManualSettlement | null; cooldownUntil: number;
  researchDecisions: number; midTradeFlips: number; lastEffects: string[]; metrics: { operationalSignals: number; entryConfirmed: number; entryNotConfirmed: number; preEntryInvalidations: number; manualTradesSettled: number; manualWins: number; manualLosses: number; manualDraws: number; manualUnknown: number; midTradeDirectionFlips: number; withTrendSignals: number; counterTrendSignals: number };
};

export type ChannelEvent =
  | { type: "CANDIDATE"; direction: "BUY" | "SELL" | "WAIT"; profile: string; rawConfidence: number; regime: string; macroTrend: string; microTrend: string; trendAlignment: string; counterTrend: boolean; reversalEvidenceCount: number; candleId?: string | null; frameId?: string | null; contextVersion?: number | null; signalId?: string }
  | { type: "TICK" }
  | { type: "CRITICAL_INVALIDATION"; reason: string }
  | { type: "MANUAL_POSITION"; detected: boolean; direction: "BUY" | "SELL" | "UNKNOWN"; confidence: number; evidence: string[]; price: number | null; priceConfidence: number; priceSource: string }
  | { type: "SETTLEMENT"; now: number; exitPrice: number | null; exitPriceConfidence: number; exitPriceSource: string }
  | { type: "PROFILE_SWITCH"; profile: string };

export function emptyChannelState(): ChannelState {
  return { state: "READY", signal: null, countdownEndsAt: 0, confirmationDeadline: 0, manualEntry: null, settlementAt: 0, settlement: null, cooldownUntil: 0, researchDecisions: 0, midTradeFlips: 0, lastEffects: [], metrics: { operationalSignals: 0, entryConfirmed: 0, entryNotConfirmed: 0, preEntryInvalidations: 0, manualTradesSettled: 0, manualWins: 0, manualLosses: 0, manualDraws: 0, manualUnknown: 0, midTradeDirectionFlips: 0, withTrendSignals: 0, counterTrendSignals: 0 } };
}

const activeStates: ReadonlyArray<ChannelStateName> = ["SIGNAL_LOCKED", "ENTRY_COUNTDOWN", "WAITING_ENTRY_CONFIRMATION", "POSITION_CONFIRMED", "IN_POSITION", "WAITING_SETTLEMENT"];

export function isChannelLocked(state: ChannelState): boolean { return activeStates.includes(state.state); }

/** Pure reducer; effects are stable log names so tests and telemetry agree. */
export function reduceChannel(state: ChannelState, event: ChannelEvent, now: number): ChannelState {
  const effects: string[] = [];
  const next: ChannelState = { ...state, metrics: { ...state.metrics }, lastEffects: effects };
  const release = (stateName: ChannelStateName) => { next.state = stateName; next.signal = null; next.manualEntry = null; next.settlementAt = 0; effects.push("OPERATION_CHANNEL_RELEASED"); };
  switch (event.type) {
    case "CANDIDATE": {
      if (state.state === "COOLDOWN") { if (now < state.cooldownUntil) { next.researchDecisions = state.researchDecisions + 1; return next; } release("READY"); }
      if (isChannelLocked(next)) {
        next.researchDecisions = state.researchDecisions + 1;
        const signal = next.signal;
        const flipped = signal && (event.direction === "BUY" || event.direction === "SELL") && event.direction !== signal.direction;
        if (flipped && (next.state === "POSITION_CONFIRMED" || next.state === "IN_POSITION" || next.state === "WAITING_SETTLEMENT")) {
          next.midTradeFlips = state.midTradeFlips + 1; next.metrics.midTradeDirectionFlips += 1;
          effects.push("MID_TRADE_DIRECTION_FLIP");
        }
        return next;
      }
      const decisive = event.direction === "BUY" || event.direction === "SELL";
      const counterTrendAllowed = !event.counterTrend || event.reversalEvidenceCount > 0;
      if (!decisive || !counterTrendAllowed) { next.researchDecisions = state.researchDecisions + 1; if (event.counterTrend && !counterTrendAllowed) effects.push("COUNTER_TREND_SIGNAL_BLOCKED"); return next; }
      const signal: OperationalSignal = { signalId: event.signalId || `op_${now}_${Math.random().toString(36).slice(2, 8)}`, direction: event.direction === "BUY" ? "BUY" : "SELL", profile: event.profile, rawConfidence: event.rawConfidence, regime: event.regime, macroTrend: event.macroTrend, microTrend: event.microTrend, trendAlignment: event.trendAlignment, counterTrend: event.counterTrend, createdAt: now, entryWindowMs: ENTRY_COUNTDOWN_MS, predictionHorizonSeconds: OPERATIONAL_HORIZON_SECONDS, contextVersion: event.contextVersion ?? null, candleId: event.candleId ?? null, frameId: event.frameId ?? null, status: "ACTIVE" };
      next.state = "ENTRY_COUNTDOWN"; next.signal = signal; next.countdownEndsAt = now + ENTRY_COUNTDOWN_MS;
      next.metrics.operationalSignals += 1;
      if (event.counterTrend) next.metrics.counterTrendSignals += 1; else next.metrics.withTrendSignals += 1;
      effects.push("OPERATIONAL_SIGNAL_CREATED", "OPERATIONAL_SIGNAL_LOCKED", "ENTRY_COUNTDOWN_STARTED");
      return next;
    }
    case "TICK": {
      if (next.state === "ENTRY_COUNTDOWN" && now >= next.countdownEndsAt) { next.state = "WAITING_ENTRY_CONFIRMATION"; next.confirmationDeadline = next.countdownEndsAt + CONFIRMATION_WINDOW_MS; effects.push("ENTRY_CONFIRMATION_WAITING"); return next; }
      if (next.state === "WAITING_ENTRY_CONFIRMATION" && now >= next.confirmationDeadline) {
        next.metrics.entryNotConfirmed += 1; if (next.signal) next.signal.status = "EXPIRED";
        effects.push("ENTRY_NOT_CONFIRMED"); next.cooldownUntil = now + COOLDOWN_MS; release("COOLDOWN"); return next;
      }
      if (next.state === "SETTLED" && now >= next.cooldownUntil) { release("READY"); return next; }
      return next;
    }
    case "CRITICAL_INVALIDATION": {
      if (next.state !== "ENTRY_COUNTDOWN" && next.state !== "SIGNAL_LOCKED") return next;
      next.metrics.preEntryInvalidations += 1; if (next.signal) next.signal.status = "CANCELLED";
      effects.push("SIGNAL_INVALIDATED_BEFORE_ENTRY"); next.cooldownUntil = now + COOLDOWN_MS; release("COOLDOWN"); return next;
    }
    case "MANUAL_POSITION": {
      if (next.state !== "WAITING_ENTRY_CONFIRMATION" && next.state !== "ENTRY_COUNTDOWN") return next;
      if (!event.detected) { next.state = "POSITION_DETECTION_UNCERTAIN"; return next; }
      const signal = next.signal;
      if (!signal) return next;
      if (event.direction !== "UNKNOWN" && event.direction !== signal.direction) { effects.push("POSITION_DIRECTION_MISMATCH"); return next; }
      if (event.price === null || event.priceConfidence < .6) { next.state = "POSITION_DETECTION_UNCERTAIN"; effects.push("MANUAL_ENTRY_PRICE_UNAVAILABLE"); return next; }
      next.state = "IN_POSITION"; next.metrics.entryConfirmed += 1;
      next.manualEntry = { price: event.price, confidence: event.priceConfidence, source: event.priceSource, timestamp: now, signalId: signal.signalId };
      next.settlementAt = now + OPERATIONAL_HORIZON_SECONDS * 1_000;
      effects.push("POSITION_CONFIRMED", "MANUAL_ENTRY_PRICE_LOCKED", "OPERATION_IN_PROGRESS");
      return next;
    }
    case "SETTLEMENT": {
      if (next.state !== "IN_POSITION" && next.state !== "WAITING_SETTLEMENT") return next;
      const signal = next.signal, entry = next.manualEntry;
      if (!signal || !entry) return next;
      if (event.now < next.settlementAt) { effects.push("SETTLEMENT_WAITING"); return next; }
      const result = settleTrade({ direction: signal.direction, entryPrice: entry.price, exitPrice: event.exitPrice, entryTimestamp: entry.timestamp, exitTimestamp: event.now, dueTimestamp: next.settlementAt });
      next.state = "SETTLED"; next.settlement = { entryPrice: entry.price, exitPrice: event.exitPrice, entryTimestamp: entry.timestamp, exitTimestamp: event.now, result: result.outcome };
      if (signal) signal.status = "SETTLED";
      next.metrics.manualTradesSettled += 1;
      if (result.outcome === "WIN") next.metrics.manualWins += 1; else if (result.outcome === "LOSS") next.metrics.manualLosses += 1; else if (result.outcome === "DRAW") next.metrics.manualDraws += 1; else next.metrics.manualUnknown += 1;
      effects.push("SETTLEMENT_PRICE_LOCKED", "TRADE_SETTLED");
      if (result.outcome === "UNKNOWN") effects.push("SETTLEMENT_UNKNOWN");
      next.cooldownUntil = event.now + COOLDOWN_MS;
      return next;
    }
    case "PROFILE_SWITCH": {
      if (isChannelLocked(next)) { effects.push("PROFILE_SWITCH_DURING_OPERATION_IGNORED"); return next; }
      effects.push("PROFILE_SWITCH_ARMED_FOR_NEXT_OPERATION");
      return next;
    }
    default: return next;
  }
}
