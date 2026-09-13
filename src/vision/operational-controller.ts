/**
 * Transport-agnostic controller for the one visible operational paper signal.
 *
 * This deliberately has no model, provider, DOM, broker, or UI dependency.
 * It accepts an already-approved BUY/SELL and makes its lifecycle replayable:
 * a lock is immutable, settlement is delegated only to `settleTrade`, and every
 * mutation appends a monotonically ordered event suitable for SSE replay.
 */
import { settleTrade, type SettlementOutcome, type SettlementResult } from "../training/settlement.js";

export type OperationalState = "IDLE" | "SIGNAL_LOCKED" | "ENTRY_COUNTDOWN" | "WAITING_ENTRY_CONFIRMATION" | "POSITION_CONFIRMED" | "POSITION_DETECTION_UNCERTAIN" | "IN_POSITION" | "WAITING_SETTLEMENT" | "SETTLED" | "INVALIDATED";
export type OperationalDirection = "BUY" | "SELL";
export type OperationalEventType = "OPERATIONAL_SIGNAL_LOCKED" | "OPERATIONAL_ENTRY_LOCKED" | "OPERATIONAL_POSITION_CONFIRMED" | "OPERATIONAL_SETTLEMENT" | "OPERATIONAL_INVALIDATED";

export type OperationalSignal = Readonly<{
  signalId: string;
  idempotencyKey: string;
  direction: OperationalDirection;
  originSymbol: string;
  lockedAt: number;
  countdownEndsAt: number;
  entryAt: number;
  settlementAt: number;
  entryPrice: number | null;
  entryTimestamp: number | null;
  exitPrice: number | null;
  exitTimestamp: number | null;
  outcome: SettlementOutcome | null;
  settlementReason: SettlementResult["reason"] | null;
}>;

export type OperationalEvent = Readonly<{ sequence: number; at: number; type: OperationalEventType; signalId: string; state: OperationalState; payload: Record<string, unknown> }>;
export type OperationalMetrics = Readonly<{ locked: number; entries: number; settled: number; WIN: number; LOSS: number; DRAW: number; UNKNOWN: number; invalidated: number; duplicateRequests: number }>;
export type OperationalSnapshot = Readonly<{ version: 1; state: OperationalState; signal: OperationalSignal | null; events: readonly OperationalEvent[]; metrics: OperationalMetrics; nextSequence: number }>;

export type LockRequest = Readonly<{
  signalId: string;
  idempotencyKey: string;
  direction: OperationalDirection;
  originSymbol: string;
  now: number;
  countdownMs: number;
  horizonMs: number;
}>;

export type EntryRequest = Readonly<{ signalId: string; price: number | null; timestamp: number; symbol: string }>;
export type SettlementRequest = Readonly<{ signalId: string; price: number | null; timestamp: number; symbol: string }>;

const terminal = new Set<OperationalState>(["SETTLED", "INVALIDATED"]);
const emptyMetrics = (): OperationalMetrics => ({ locked: 0, entries: 0, settled: 0, WIN: 0, LOSS: 0, DRAW: 0, UNKNOWN: 0, invalidated: 0, duplicateRequests: 0 });

function finiteTime(value: number, name: string): void { if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_${name}`); }
function copySignal(signal: OperationalSignal): OperationalSignal { return { ...signal }; }
function copyEvent(event: OperationalEvent): OperationalEvent { return { ...event, payload: { ...event.payload } }; }

/** A small in-memory state machine. Persist `snapshot()` after each mutation. */
export class OperationalController {
  private state: OperationalState = "IDLE";
  private signal: OperationalSignal | null = null;
  private events: OperationalEvent[] = [];
  private metrics: OperationalMetrics = emptyMetrics();
  private nextSequence = 1;
  private readonly idempotency = new Map<string, string>();
  private readonly listeners = new Set<(event: OperationalEvent) => void>();

  static restore(snapshot: OperationalSnapshot): OperationalController {
    if (snapshot.version !== 1 || !Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) throw new Error("invalid_operational_snapshot");
    const controller = new OperationalController();
    controller.state = snapshot.state;
    controller.signal = snapshot.signal ? copySignal(snapshot.signal) : null;
    controller.events = snapshot.events.map(copyEvent);
    controller.metrics = { ...snapshot.metrics };
    controller.nextSequence = snapshot.nextSequence;
    for (const event of controller.events) {
      const key = typeof event.payload.idempotencyKey === "string" ? event.payload.idempotencyKey : null;
      if (event.type === "OPERATIONAL_SIGNAL_LOCKED" && key) controller.idempotency.set(key, event.signalId);
    }
    controller.assertInvariant();
    return controller;
  }

  snapshot(): OperationalSnapshot {
    return { version: 1, state: this.state, signal: this.signal ? copySignal(this.signal) : null, events: this.events.map(copyEvent), metrics: { ...this.metrics }, nextSequence: this.nextSequence };
  }

  current(): Readonly<{ state: OperationalState; signal: OperationalSignal | null; metrics: OperationalMetrics }> {
    return { state: this.state, signal: this.signal ? copySignal(this.signal) : null, metrics: { ...this.metrics } };
  }

  /** Returns append-only events after a cursor; an empty cursor safely replays all. */
  replay(afterSequence = 0): readonly OperationalEvent[] { return this.events.filter((event) => event.sequence > afterSequence).map(copyEvent); }
  subscribe(listener: (event: OperationalEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  lock(request: LockRequest): OperationalSignal {
    finiteTime(request.now, "now"); finiteTime(request.countdownMs, "countdown"); finiteTime(request.horizonMs, "horizon");
    if (!request.signalId.trim() || !request.idempotencyKey.trim() || !request.originSymbol.trim()) throw new Error("invalid_signal_identity");
    const priorId = this.idempotency.get(request.idempotencyKey);
    if (priorId) {
      this.bump("duplicateRequests");
      if (!this.signal || priorId !== this.signal.signalId) throw new Error("idempotency_key_reused_for_historical_signal");
      return copySignal(this.signal);
    }
    if (this.signal && !terminal.has(this.state)) throw new Error("operational_signal_already_active");
    const entryAt = request.now + request.countdownMs;
    const signal: OperationalSignal = {
      signalId: request.signalId, idempotencyKey: request.idempotencyKey, direction: request.direction,
      originSymbol: request.originSymbol, lockedAt: request.now, countdownEndsAt: entryAt,
      entryAt, settlementAt: entryAt + request.horizonMs, entryPrice: null, entryTimestamp: null,
      exitPrice: null, exitTimestamp: null, outcome: null, settlementReason: null,
    };
    this.signal = signal; this.state = request.countdownMs > 0 ? "SIGNAL_LOCKED" : "WAITING_ENTRY_CONFIRMATION";
    this.idempotency.set(request.idempotencyKey, request.signalId); this.bump("locked");
    this.emit("OPERATIONAL_SIGNAL_LOCKED", request.now, { idempotencyKey: request.idempotencyKey, direction: request.direction, originSymbol: request.originSymbol, countdownEndsAt: entryAt, settlementAt: signal.settlementAt });
    this.assertInvariant();
    return copySignal(signal);
  }

  /** Advances clock-only stages. It never creates, reverses, or invalidates a signal. */
  tick(now: number): OperationalState {
    finiteTime(now, "now");
    if (!this.signal || terminal.has(this.state)) return this.state;
    if (this.state === "SIGNAL_LOCKED" && now >= this.signal.countdownEndsAt) this.state = "ENTRY_COUNTDOWN";
    if (this.state === "ENTRY_COUNTDOWN" && now >= this.signal.entryAt) this.state = "WAITING_ENTRY_CONFIRMATION";
    if ((this.state === "POSITION_CONFIRMED" || this.state === "IN_POSITION") && now >= this.signal.settlementAt) this.state = "WAITING_SETTLEMENT";
    this.assertInvariant();
    return this.state;
  }

  lockEntry(request: EntryRequest): OperationalSignal {
    const signal = this.require(request.signalId);
    if (signal.entryPrice !== null) return copySignal(signal);
    if (request.symbol !== signal.originSymbol) throw new Error("entry_symbol_mismatch");
    if (request.timestamp < signal.entryAt) throw new Error("entry_before_countdown");
    if (!Number.isFinite(request.price ?? NaN)) throw new Error("entry_price_unavailable");
    this.signal = { ...signal, entryPrice: request.price, entryTimestamp: request.timestamp };
    this.state = "POSITION_CONFIRMED"; this.bump("entries");
    this.emit("OPERATIONAL_ENTRY_LOCKED", request.timestamp, { price: request.price, symbol: request.symbol, entryAt: signal.entryAt });
    this.emit("OPERATIONAL_POSITION_CONFIRMED", request.timestamp, { symbol: request.symbol });
    this.assertInvariant();
    return copySignal(this.signal);
  }

  settle(request: SettlementRequest): OperationalSignal {
    const signal = this.require(request.signalId);
    if (signal.outcome !== null) return copySignal(signal);
    if (signal.entryTimestamp === null) throw new Error("cannot_settle_without_entry");
    const result = settleTrade({ direction: signal.direction, entryPrice: signal.entryPrice, exitPrice: request.price, entryTimestamp: signal.entryTimestamp, exitTimestamp: request.timestamp, dueTimestamp: signal.settlementAt, entrySymbol: signal.originSymbol, exitSymbol: request.symbol });
    this.signal = { ...signal, exitPrice: request.price, exitTimestamp: request.timestamp, outcome: result.outcome, settlementReason: result.reason };
    this.state = "SETTLED"; this.bump("settled"); this.bump(result.outcome);
    this.emit("OPERATIONAL_SETTLEMENT", request.timestamp, { price: request.price, symbol: request.symbol, outcome: result.outcome, reason: result.reason, settlementAt: signal.settlementAt });
    this.assertInvariant();
    return copySignal(this.signal);
  }

  invalidate(signalId: string, reason: string, now: number): OperationalSignal {
    const signal = this.require(signalId);
    if (terminal.has(this.state)) return copySignal(signal);
    if (signal.entryTimestamp !== null) throw new Error("cannot_invalidate_entered_signal");
    if (!reason.trim()) throw new Error("invalidation_reason_required");
    this.state = "INVALIDATED"; this.bump("invalidated"); this.emit("OPERATIONAL_INVALIDATED", now, { reason: reason.trim() });
    return copySignal(signal);
  }

  private require(signalId: string): OperationalSignal {
    if (!this.signal || this.signal.signalId !== signalId) throw new Error("unknown_operational_signal");
    return this.signal;
  }
  private bump(key: keyof OperationalMetrics | SettlementOutcome): void { this.metrics = { ...this.metrics, [key]: this.metrics[key] + 1 }; }
  private emit(type: OperationalEventType, at: number, payload: Record<string, unknown>): void {
    const signal = this.signal;
    if (!signal) throw new Error("event_without_signal");
    const event: OperationalEvent = { sequence: this.nextSequence++, at, type, signalId: signal.signalId, state: this.state, payload: { ...payload } };
    this.events.push(event); for (const listener of this.listeners) listener(copyEvent(event));
  }
  private assertInvariant(): void {
    if (this.state === "IDLE" && this.signal) throw new Error("idle_signal_invariant");
    if (!this.signal) return;
    const signal = this.signal;
    if (signal.countdownEndsAt !== signal.entryAt || signal.settlementAt <= signal.entryAt || signal.lockedAt > signal.entryAt) throw new Error("schedule_invariant");
    if (signal.outcome !== null && this.state !== "SETTLED") throw new Error("settlement_state_invariant");
    if (this.state === "SETTLED" && signal.outcome === null) throw new Error("missing_settlement_invariant");
  }
}
