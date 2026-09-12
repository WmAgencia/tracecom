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
        -- Provider/clock snapshots do momento da decisão (para auditoria).
        provider_id TEXT,
        model_version TEXT,
        feature_version TEXT,
        outcome     TEXT NOT NULL DEFAULT 'pending',
        exit_time   INTEGER,
        exit_price  REAL,
        return_pct  REAL,
        evaluated_at INTEGER,
        -- Idempotência + diagnóstico do scheduler (P-R).
        evaluation_attempts INTEGER NOT NULL DEFAULT 0,
        last_evaluation_error TEXT,
        evaluation_locked    INTEGER NOT NULL DEFAULT 0,
        -- P-T: custos reais descontados em produção.
        gross_return_pct REAL,
        cost_pct          REAL,
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
        evaluated_at INTEGER,
        evaluation_attempts INTEGER NOT NULL DEFAULT 0,
        last_evaluation_error TEXT,
        evaluation_locked    INTEGER NOT NULL DEFAULT 0,
        gross_return_pct REAL,
        cost_pct          REAL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_created_at ON shadow_trades(created_at);
      CREATE INDEX IF NOT EXISTS idx_shadow_outcome ON shadow_trades(outcome);
      CREATE INDEX IF NOT EXISTS idx_shadow_symbol_tf ON shadow_trades(symbol, timeframe);

      -- Sinais paper com máquina de estados explícita. A tabela de eventos é
      -- append-only e permite auditar cancelamento, invalidação e execução.
      CREATE TABLE IF NOT EXISTS paper_signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        direction TEXT NOT NULL,
        decision TEXT NOT NULL,
        countdown_at INTEGER NOT NULL,
        entry_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        invalidation_reason TEXT,
        execution_key TEXT UNIQUE,
        paper_trade_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paper_signals_state ON paper_signals(state, entry_at);
      CREATE INDEX IF NOT EXISTS idx_paper_signals_symbol ON paper_signals(symbol, created_at);
      CREATE TABLE IF NOT EXISTS paper_signal_events (
        signal_id TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        at INTEGER NOT NULL,
        previous_state TEXT,
        new_state TEXT NOT NULL,
        reason TEXT,
        PRIMARY KEY(signal_id, event_index),
        FOREIGN KEY(signal_id) REFERENCES paper_signals(id) ON DELETE CASCADE
      );

      -- Migração: colunas opcionais para stop-loss e cooldown aplicadas
      -- DEPOIS do db.exec principal com try/catch (SQLite < 3.35 não tem
      -- ADD COLUMN IF NOT EXISTS). Ver abaixo deste template.

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

      -- TRACE_1M official prospective ledger. These tables are immutable by
      -- design: corrections are new events, never destructive rewrites.
      CREATE TABLE IF NOT EXISTS trace1m_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        observed_at INTEGER NOT NULL,
        provider_timestamp INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        pair TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_role TEXT NOT NULL CHECK(provider_role IN ('PRIMARY','FALLBACK')),
        bid REAL NOT NULL,
        ask REAL NOT NULL,
        mid REAL NOT NULL,
        spread REAL NOT NULL,
        spread_pips REAL NOT NULL,
        quote_age_ms INTEGER NOT NULL,
        quality_score REAL NOT NULL,
        data_quality TEXT NOT NULL,
        session TEXT NOT NULL,
        model_version TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trace1m_snapshots_time ON trace1m_snapshots(pair, observed_at);

      CREATE TABLE IF NOT EXISTS trace1m_decisions (
        trade_id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL UNIQUE,
        pair TEXT NOT NULL,
        analysis_timestamp INTEGER NOT NULL,
        planned_entry_timestamp INTEGER NOT NULL,
        actual_entry_timestamp INTEGER,
        expiry_timestamp INTEGER,
        research_decision TEXT NOT NULL CHECK(research_decision IN ('BUY','SELL','WAIT')),
        production_decision TEXT NOT NULL CHECK(production_decision IN ('BUY','SELL','WAIT')),
        wait_reason TEXT,
        entry_bid REAL,
        entry_ask REAL,
        model_version TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(snapshot_id) REFERENCES trace1m_snapshots(snapshot_id)
      );
      CREATE INDEX IF NOT EXISTS idx_trace1m_decisions_time ON trace1m_decisions(analysis_timestamp);

      CREATE TABLE IF NOT EXISTS trace1m_outcomes (
        outcome_id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL UNIQUE,
        exit_timestamp INTEGER NOT NULL,
        exit_bid REAL NOT NULL,
        exit_ask REAL NOT NULL,
        gross_return REAL NOT NULL,
        cost_return REAL NOT NULL,
        net_return REAL NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('WIN','LOSS')),
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(trade_id) REFERENCES trace1m_decisions(trade_id)
      );

      CREATE TABLE IF NOT EXISTS trace1m_audit_events (
        event_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trace1m_audit_entity ON trace1m_audit_events(entity_id, occurred_at);

      CREATE TRIGGER IF NOT EXISTS trace1m_snapshots_no_update BEFORE UPDATE ON trace1m_snapshots BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_snapshots_no_delete BEFORE DELETE ON trace1m_snapshots BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_decisions_no_update BEFORE UPDATE ON trace1m_decisions BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_decisions_no_delete BEFORE DELETE ON trace1m_decisions BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_outcomes_no_update BEFORE UPDATE ON trace1m_outcomes BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_outcomes_no_delete BEFORE DELETE ON trace1m_outcomes BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_audit_no_update BEFORE UPDATE ON trace1m_audit_events BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trace1m_audit_no_delete BEFORE DELETE ON trace1m_audit_events BEGIN SELECT RAISE(ABORT, 'trace1m append-only'); END;
    `);

    // Migração: colunas opcionais para stop-loss e cooldown em shadow_trades.
    // SQLite < 3.35 não tem `ADD COLUMN IF NOT EXISTS`, então fazemos try/catch
    // por statement. Idempotente: falha silenciosa se coluna já existe.
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN stop_loss_pct REAL"); } catch { /* coluna já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN cooldown_minutes INTEGER"); } catch { /* coluna já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN stop_loss_triggered_at INTEGER"); } catch { /* coluna já existe */ }

    // P-R: colunas para rastreabilidade e idempotência do scheduler de outcomes.
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN provider_id TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN model_version TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN feature_version TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN evaluation_attempts INTEGER NOT NULL DEFAULT 0"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN last_evaluation_error TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN evaluation_locked INTEGER NOT NULL DEFAULT 0"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN gross_return_pct REAL"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN cost_pct REAL"); } catch { /* já existe */ }
    // P-A (B2): Platt-scaled probability aprendida por (symbol, timeframe, regime).
    try { this.db.exec("ALTER TABLE decision_records ADD COLUMN probability_calibrated REAL"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN provider_id TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN evaluation_attempts INTEGER NOT NULL DEFAULT 0"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN last_evaluation_error TEXT"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN evaluation_locked INTEGER NOT NULL DEFAULT 0"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN gross_return_pct REAL"); } catch { /* já existe */ }
    try { this.db.exec("ALTER TABLE shadow_trades ADD COLUMN cost_pct REAL"); } catch { /* já existe */ }
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
