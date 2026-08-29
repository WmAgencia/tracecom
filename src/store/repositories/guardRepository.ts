/**
 * Repositório SQLite de GuardState (circuit breaker + cooldown + drawdown).
 *
 * Persiste o estado entre reinícios do servidor. Tabela singleton (id=1).
 * O domínio (src/fusion/guards.ts) é puro — esta camada traduz o estado
 * para colunas consultáveis (sem "documento cego").
 */
import type { GuardState } from "../../fusion/guards";
import type { Datastore } from "../db";

interface Row {
  id: number;
  consecutive_losses: number;
  cooldown_until: number | null;
  daily_loss_pct: number;
  last_loss_at: number | null;
  circuit_tripped_at: number | null;
  last_updated_day: string;
  state_json: string;
}

export class GuardRepository {
  constructor(private readonly store: Datastore) {}

  /** Retorna o estado persistido ou null se a tabela ainda não tem dados válidos. */
  load(): GuardState | null {
    const row = this.store.db
      .prepare("SELECT * FROM guard_state WHERE id = 1")
      .get() as Row | undefined;
    if (!row || !row.last_updated_day) return null;
    return {
      consecutiveLosses: row.consecutive_losses,
      cooldownUntil: row.cooldown_until,
      dailyLossPct: row.daily_loss_pct,
      lastLossAt: row.last_loss_at,
      circuitTrippedAt: row.circuit_tripped_at,
      lastUpdatedDay: row.last_updated_day,
    };
  }

  /** Persiste o estado atual (UPDATE no singleton). */
  save(state: GuardState): void {
    this.store.db
      .prepare(`
        UPDATE guard_state SET
          consecutive_losses = ?,
          cooldown_until = ?,
          daily_loss_pct = ?,
          last_loss_at = ?,
          circuit_tripped_at = ?,
          last_updated_day = ?
        WHERE id = 1
      `)
      .run(
        state.consecutiveLosses,
        state.cooldownUntil,
        state.dailyLossPct,
        state.lastLossAt,
        state.circuitTrippedAt,
        state.lastUpdatedDay,
      );
  }

  /** Reset operacional (intervenção manual) — zera tudo no dia corrente. */
  reset(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.store.db
      .prepare(`
        UPDATE guard_state SET
          consecutive_losses = 0,
          cooldown_until = NULL,
          daily_loss_pct = 0,
          last_loss_at = NULL,
          circuit_tripped_at = NULL,
          last_updated_day = ?
        WHERE id = 1
      `)
      .run(today);
  }
}