/**
 * Ciclo de vida de sinal para paper trading.
 *
 * A máquina é pura e imutável. Persistência e execução são adaptadores
 * separados, o que torna impossível transformar uma transição em ordem real
 * por acidente.
 */

export type SignalState = "created" | "scheduled" | "countdown" | "ready" | "executed" | "expired" | "cancelled" | "invalidated" | "evaluated";
export type TradableDecision = "BUY" | "SELL";

export interface SignalEvent {
  readonly at: number;
  readonly previousState: SignalState | null;
  readonly newState: SignalState;
  readonly reason: string | null;
}

export interface PaperSignal {
  readonly id: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: "up" | "down";
  readonly decision: TradableDecision;
  readonly countdownAt: number;
  readonly entryAt: number;
  readonly expiresAt: number;
  readonly state: SignalState;
  readonly invalidationReason: string | null;
  /** Idempotency key of the paper execution, never a broker order id. */
  readonly executionKey: string | null;
  readonly paperTradeId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly events: readonly SignalEvent[];
}

export interface CreateSignalInput {
  readonly id?: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: "up" | "down";
  readonly decision: TradableDecision;
  readonly countdownAt: number;
  readonly entryAt: number;
  readonly expiresAt: number;
  readonly now?: number;
}

export function createPaperSignal(input: CreateSignalInput): PaperSignal {
  const now = input.now ?? Date.now();
  if (!input.symbol.trim() || !input.timeframe.trim()) throw new Error("signal requires symbol and timeframe");
  if (!Number.isFinite(input.countdownAt) || !Number.isFinite(input.entryAt) || !Number.isFinite(input.expiresAt)
    || input.countdownAt > input.entryAt || input.entryAt >= input.expiresAt) {
    throw new Error("invalid signal schedule");
  }
  return {
    id: input.id ?? crypto.randomUUID(),
    symbol: input.symbol.toUpperCase(),
    timeframe: input.timeframe,
    direction: input.direction,
    decision: input.decision,
    countdownAt: input.countdownAt,
    entryAt: input.entryAt,
    expiresAt: input.expiresAt,
    state: "created",
    invalidationReason: null,
    executionKey: null,
    paperTradeId: null,
    createdAt: now,
    updatedAt: now,
    events: [{ at: now, previousState: null, newState: "created", reason: null }],
  };
}

/** Schedules a newly-created signal. Repeating this exact operation is safe. */
export function scheduleSignal(signal: PaperSignal, now: number = Date.now()): PaperSignal {
  if (signal.state === "scheduled") return signal;
  return transition(signal, "created", "scheduled", now, null);
}

/** Advances only time-driven states, while respecting expiry and invalidation. */
export function advanceSignal(signal: PaperSignal, now: number = Date.now(), invalidationReason?: string | null): PaperSignal {
  // Uma posição paper já executada deixa de ser sinal de entrada: ela só
  // pode seguir para `evaluated`, nunca expirar/cancelar/invalidate.
  if (isFinal(signal.state) || signal.state === "executed") return signal;
  if (invalidationReason?.trim()) return transition(signal, signal.state, "invalidated", now, invalidationReason.trim());
  if (now >= signal.expiresAt) return transition(signal, signal.state, "expired", now, "ENTRY_WINDOW_EXPIRED");
  if (signal.state === "scheduled" && now >= signal.countdownAt) return transition(signal, "scheduled", "countdown", now, null);
  if (signal.state === "countdown" && now >= signal.entryAt) return transition(signal, "countdown", "ready", now, null);
  return signal;
}

/** Cancels an unexecuted signal and records the human/operational reason. */
export function cancelSignal(signal: PaperSignal, reason: string, now: number = Date.now()): PaperSignal {
  if (isFinal(signal.state)) return signal;
  if (signal.state === "executed") throw new Error("executed signal cannot be cancelled");
  if (!reason.trim()) throw new Error("cancellation reason is required");
  return transition(signal, signal.state, "cancelled", now, reason.trim());
}

/** Executes a READY signal once. A repeated execution key is idempotent. */
export function executePaperSignal(signal: PaperSignal, executionKey: string, paperTradeId: string, now: number = Date.now()): PaperSignal {
  if (!executionKey.trim() || !paperTradeId.trim()) throw new Error("executionKey and paperTradeId are required");
  if (signal.state === "executed" && signal.executionKey === executionKey) return signal;
  if (signal.state !== "ready") throw new Error(`signal is not ready (${signal.state})`);
  if (now < signal.entryAt || now >= signal.expiresAt) throw new Error("signal execution is outside its entry window");
  const next = transition(signal, "ready", "executed", now, null);
  return { ...next, executionKey, paperTradeId };
}

export function evaluatePaperSignal(signal: PaperSignal, now: number = Date.now()): PaperSignal {
  if (signal.state === "evaluated") return signal;
  return transition(signal, "executed", "evaluated", now, null);
}

function transition(signal: PaperSignal, from: SignalState, to: SignalState, now: number, reason: string | null): PaperSignal {
  if (signal.state !== from) throw new Error(`invalid signal transition ${signal.state} -> ${to}`);
  return {
    ...signal,
    state: to,
    invalidationReason: to === "invalidated" ? reason : signal.invalidationReason,
    updatedAt: now,
    events: [...signal.events, { at: now, previousState: from, newState: to, reason }],
  };
}

function isFinal(state: SignalState): boolean {
  return state === "expired" || state === "cancelled" || state === "invalidated" || state === "evaluated";
}
