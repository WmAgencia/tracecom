-- 025: Fase 6 — Professional Brain G2 + Journal + Supervisor + Legacy Strategy Audit.
-- V1/V2/V3/V8 deixam o runtime ATIVO; historico permanece consultavel como LEGACY_STRATEGY_AUDIT.

ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS supervisor_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS hypotheses_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS brain_generation integer NOT NULL DEFAULT 2;

-- Snapshot do que era configuracao ativa de estrategia antes da Fase 6 (auditoria historica, nunca decisao).
CREATE TABLE IF NOT EXISTS iq_legacy_strategy_audit (
  id serial PRIMARY KEY,
  market_key text NOT NULL,
  strategy text,
  strategy_variant_id text,
  source text NOT NULL DEFAULT 'FASE6_MIGRATION',
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO iq_legacy_strategy_audit(market_key, strategy, strategy_variant_id, source)
SELECT market_key, strategy, strategy_variant_id, 'FASE6_MIGRATION'
FROM iq_markets
WHERE strategy IS NOT NULL OR strategy_variant_id IS NOT NULL;

-- Runtime G2 nao le strategy/strategy_variant_id; colunas permanecem para auditoria.
UPDATE iq_markets SET strategy = NULL, strategy_variant_id = NULL
WHERE strategy IS NOT NULL OR strategy_variant_id IS NOT NULL;

-- Journal estruturado por trade (fonte de verdade; espelho no Obsidian e best effort).
CREATE TABLE IF NOT EXISTS iq_trade_journal (
  trade_id text PRIMARY KEY,
  decision_id text,
  correlation_id text,
  agent_id text,
  market_key text,
  market_type text,
  entry_at timestamptz,
  settlement_at timestamptz,
  payout double precision,
  stake double precision,
  direction text,
  result text,
  regime text,
  structure text,
  location text,
  setup text,
  trigger text,
  trader_decision jsonb,
  critic_decision jsonb,
  consensus jsonb,
  outcome text,
  decision_quality text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_trade_journal_market ON iq_trade_journal(market_key, settlement_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_trade_journal_agent ON iq_trade_journal(agent_id, settlement_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_trade_journal_quality ON iq_trade_journal(decision_quality, settlement_at DESC);
