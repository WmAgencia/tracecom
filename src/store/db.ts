/**
 * Datastore SQLite (node:sqlite — nativo, sem dependência de compilação).
 *
 * Cria as tabelas e fornece acesso a `DatabaseSync`. O schema relacional evita
 * dados "documento cego": cada análise possui colunas consultáveis (símbolo,
 * timeframe, direção, created_at) e o rastro de auditoria é persistido em JSON
 * (coluna trail) — com migração para destrinchar o trail em tabelas próprias
 * quando o volume exigir.
 */
import { DatabaseSync } from "./sqlite";
import type { SqliteDatabaseSync } from "./sqlite";
import type { Logger } from "../observability/logger";

export interface SqliteOptions {
  readonly path: string; // ':memory:' para testes
  readonly logger?: Logger;
}

export class Datastore {
  readonly db: SqliteDatabaseSync;

  constructor(opts: SqliteOptions) {
    if (opts.path === ":memory:") {
      this.db = new DatabaseSync(":memory:");
    } else {
      this.db = new DatabaseSync(opts.path);
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
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
    `);
  }

  close(): void {
    this.db.close();
  }
}
