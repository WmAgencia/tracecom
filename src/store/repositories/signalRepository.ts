/** Persistência SQLite para o lifecycle de paper signals e seu log append-only. */
import type { Datastore } from "../db";
import type { PaperSignal, SignalEvent, SignalState } from "../../signals/lifecycle";

interface SignalRow {
  id: string; symbol: string; timeframe: string; direction: "up" | "down"; decision: "BUY" | "SELL";
  countdown_at: number; entry_at: number; expires_at: number; state: SignalState;
  invalidation_reason: string | null; execution_key: string | null; paper_trade_id: string | null;
  created_at: number; updated_at: number;
}
interface EventRow { event_index: number; at: number; previous_state: SignalState | null; new_state: SignalState; reason: string | null; }

export class SignalRepository {
  constructor(private readonly store: Datastore) {}

  save(signal: PaperSignal): void {
    this.store.db.prepare(`
      INSERT INTO paper_signals (id,symbol,timeframe,direction,decision,countdown_at,entry_at,expires_at,state,invalidation_reason,execution_key,paper_trade_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,invalidation_reason=excluded.invalidation_reason,execution_key=excluded.execution_key,paper_trade_id=excluded.paper_trade_id,updated_at=excluded.updated_at
    `).run(signal.id, signal.symbol, signal.timeframe, signal.direction, signal.decision, signal.countdownAt, signal.entryAt, signal.expiresAt, signal.state, signal.invalidationReason, signal.executionKey, signal.paperTradeId, signal.createdAt, signal.updatedAt);
    const insertEvent = this.store.db.prepare(`INSERT OR IGNORE INTO paper_signal_events (signal_id,event_index,at,previous_state,new_state,reason) VALUES (?,?,?,?,?,?)`);
    signal.events.forEach((event, index) => insertEvent.run(signal.id, index, event.at, event.previousState, event.newState, event.reason));
  }

  find(id: string): PaperSignal | null {
    const row = this.store.db.prepare("SELECT * FROM paper_signals WHERE id = ?").get(id) as SignalRow | undefined;
    if (!row) return null;
    const events = this.store.db.prepare("SELECT event_index,at,previous_state,new_state,reason FROM paper_signal_events WHERE signal_id = ? ORDER BY event_index ASC").all(id) as unknown as EventRow[];
    return fromRow(row, events);
  }

  list(filter: { state?: SignalState; symbol?: string } = {}): PaperSignal[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.state) { clauses.push("state = ?"); values.push(filter.state); }
    if (filter.symbol) { clauses.push("symbol = ?"); values.push(filter.symbol.toUpperCase()); }
    const sql = `SELECT * FROM paper_signals${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    const rows = this.store.db.prepare(sql).all(...values) as unknown as SignalRow[];
    return rows.map((row) => {
      const events = this.store.db.prepare("SELECT event_index,at,previous_state,new_state,reason FROM paper_signal_events WHERE signal_id = ? ORDER BY event_index ASC").all(row.id) as unknown as EventRow[];
      return fromRow(row, events);
    });
  }
}

function fromRow(row: SignalRow, events: EventRow[]): PaperSignal {
  return {
    id: row.id, symbol: row.symbol, timeframe: row.timeframe, direction: row.direction, decision: row.decision,
    countdownAt: row.countdown_at, entryAt: row.entry_at, expiresAt: row.expires_at, state: row.state,
    invalidationReason: row.invalidation_reason, executionKey: row.execution_key, paperTradeId: row.paper_trade_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    events: events.map((event): SignalEvent => ({ at: event.at, previousState: event.previous_state, newState: event.new_state, reason: event.reason })),
  };
}
