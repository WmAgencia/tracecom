/**
 * Datastore SQLite (node:sqlite — nativo, sem dependência de compilação).
 *
 * Cria as tabelas e fornece acesso a `DatabaseSync`. O schema relacional evita
 * dados "documento cego": cada análise possui colunas consultáveis (símbolo,
 * timeframe, direção, created_at) e o rastro de auditoria é persistido em JSON
 * (coluna trail) — com migração para destrinchar o trail em tabelas próprias
 * quando o volume exigir.
 */
import { openDatabaseSync } from "./sqlite";
import type { SqliteDatabaseSync } from "./sqlite";
import type { Logger } from "../observability/logger";

export interface SqliteOptions {
  readonly path: string; // ':memory:' para testes
  readonly logger?: Logger;
}

export class Datastore {
  readonly db: SqliteDatabaseSync;
  /** false quando node:sqlite indisponível (ex.: alguns ambientes serverless). */
  readonly available: boolean;

  constructor(opts: SqliteOptions) {
    let db: SqliteDatabaseSync;
    try {
      const DatabaseSync = openDatabaseSync();
      db = opts.path === ":memory:" ? new DatabaseSync(":memory:") : new DatabaseSync(opts.path);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA foreign_keys = ON;");
      this.available = true;
    } catch {
      // Sem persistência disponível (não inventa dados; apenas não persiste).
      this.available = false;
      db = openMemoryNoop();
    }
    this.db = db;
    if (this.available) this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id          TEXT PRIMARY KEY,
        symbol      TEXT NOT NULL,
        label       TEXT NOT NULL,
        kind        TEXT NOT NULL,
        quote       TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        timeframe   TEXT NOT NULL,
        horizon     TEXT NOT NULL,
        direction   TEXT NOT NULL,
        rationale   TEXT NOT NULL,
        confidence  REAL,
        empirical_probability REAL,
        sample_size INTEGER,
        technical_score REAL,
        market_regime TEXT,
        risk_level  TEXT,
        favorable   TEXT NOT NULL,
        counter     TEXT NOT NULL,
        invalidators TEXT NOT NULL,
        sources     TEXT NOT NULL,
        quality     TEXT NOT NULL,
        incomplete  INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        model       TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        trail       TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_analyses_symbol ON analyses(symbol);
      CREATE INDEX IF NOT EXISTS idx_analyses_timeframe ON analyses(timeframe);
      CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);
      CREATE INDEX IF NOT EXISTS idx_analyses_direction ON analyses(direction);

      -- Cold store de candles históricos (dados para estatística/backtest).
      -- Separado do HOT data (em memória/variável). É dado real persistido,
      -- nunca inventado. PK (provider, symbol, timeframe, timestamp) →
      -- dedup natural e upsert idempotente. isClosed só aceita candles fechados.
      CREATE TABLE IF NOT EXISTS market_candles (
        provider   TEXT NOT NULL,
        symbol     TEXT NOT NULL,
        timeframe  TEXT NOT NULL,
        timestamp  INTEGER NOT NULL,
        open       REAL NOT NULL,
        high       REAL NOT NULL,
        low        REAL NOT NULL,
        close      REAL NOT NULL,
        volume     REAL NOT NULL,
        source     TEXT NOT NULL,
        quality    TEXT NOT NULL,
        is_closed  INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (provider, symbol, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_mc_symbol_tf ON market_candles(symbol, timeframe, timestamp);

      -- Registro de decisões (fusão) + resultado posterior para validação
      -- estatística (aprendizado). Outcome preenchido a posteriori, com dados
      -- reais — nunca inventado.
      CREATE TABLE IF NOT EXISTS decision_records (
        id          TEXT PRIMARY KEY,
        symbol      TEXT NOT NULL,
        timeframe   TEXT NOT NULL,
        direction   TEXT NOT NULL,
        decision    TEXT NOT NULL,
        horizon     INTEGER NOT NULL,
        entry_time  INTEGER NOT NULL,
        entry_price REAL,
        score       REAL NOT NULL,
        confidence  REAL NOT NULL,
        probability REAL,
        sample_size INTEGER,
        regime      TEXT,
        rationale   TEXT NOT NULL,
        outcome     TEXT NOT NULL DEFAULT 'pending',
        exit_time   INTEGER,
        exit_price  REAL,
        return_pct  REAL,
        evaluated_at INTEGER,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_symbol_tf ON decision_records(symbol, timeframe);
      CREATE INDEX IF NOT EXISTS idx_decisions_outcome ON decision_records(outcome);

      -- Shadow trades (paper trading): log do que TERIA acontecido se o sinal
      -- BUY/SELL fosse executado no momento do sinal. Avaliação posterior com
      -- candles futuros reais (causalidade preservada — nunca inventado).
      CREATE TABLE IF NOT EXISTS shadow_trades (
        id          TEXT PRIMARY KEY,
        symbol      TEXT NOT NULL,
        timeframe   TEXT NOT NULL,
        direction   TEXT NOT NULL,
        decision    TEXT NOT NULL,
        entry_time  INTEGER NOT NULL,
        entry_price REAL,
        exit_time   INTEGER,
        exit_price  REAL,
        outcome     TEXT NOT NULL DEFAULT 'pending',
        return_pct  REAL,
        confidence  REAL,
        probability REAL,
        created_at  INTEGER NOT NULL,
        evaluated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_created_at ON shadow_trades(created_at);
      CREATE INDEX IF NOT EXISTS idx_shadow_outcome ON shadow_trades(outcome);
      CREATE INDEX IF NOT EXISTS idx_shadow_symbol_tf ON shadow_trades(symbol, timeframe);

      -- Estado dos guards (circuit breaker + cooldown + drawdown diário).
      -- Singleton (id=1). Persiste entre reinícios do servidor para que
      -- cooldown e circuit breaker NÃO resetem ao subir o processo.
      CREATE TABLE IF NOT EXISTS guard_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        consecutive_losses INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER,
        daily_loss_pct REAL NOT NULL DEFAULT 0,
        last_loss_at INTEGER,
        circuit_tripped_at INTEGER,
        last_updated_day TEXT NOT NULL,
        state_json TEXT NOT NULL DEFAULT '{}'
      );
      INSERT OR IGNORE INTO guard_state (id, last_updated_day) VALUES (1, '');

      -- Pesos adaptativos do ensemble (singleton).
      CREATE TABLE IF NOT EXISTS ensemble_weights (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        weights_json TEXT NOT NULL,
        baseline_brier_json TEXT NOT NULL,
        trained_at INTEGER NOT NULL,
        sample_size INTEGER NOT NULL,
        holdout_brier REAL
      );

      -- Historico de re-treinos (auto e rollback).
      CREATE TABLE IF NOT EXISTS retrain_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trained_at INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        weights_json TEXT NOT NULL,
        holdout_brier REAL,
        deployed INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_retrain_trained_at ON retrain_history(trained_at);

      -- Metricas diarias por modelo (drift detection).
      CREATE TABLE IF NOT EXISTS model_daily_metrics (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        brier REAL,
        win_rate REAL,
        n_trades INTEGER,
        PRIMARY KEY (date, model)
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_date ON model_daily_metrics(date);

      -- Alertas de drift.
      CREATE TABLE IF NOT EXISTS drift_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        detected_at INTEGER NOT NULL,
        model TEXT NOT NULL,
        severity TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_drift_detected_at ON drift_alerts(detected_at);
    `);
  }

  close(): void {
    try { this.db.close(); } catch { /* noop */ }
  }
}

/** Noop DatabaseSync para ambientes sem node:sqlite — lança apenas se usado. */
function openMemoryNoop(): SqliteDatabaseSync {
  const noop = {
    exec(_sql: string): void { throw new Error("SQL indisponível (node:sqlite ausente)"); },
    prepare(_sql: string): never { throw new Error("SQL indisponível (node:sqlite ausente)"); },
    close(): void { /* noop */ },
  };
  return noop as unknown as SqliteDatabaseSync;
}
