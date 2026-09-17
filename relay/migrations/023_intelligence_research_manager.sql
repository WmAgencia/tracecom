-- 023: Fase 5 — inteligencia global, research shadow, strategy manager e audit trail.
-- Nenhuma mudanca em estrategias congeladas; apenas estado/observabilidade persistente.

ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS research_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS manager_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS iq_strategy_reviews (
  id bigserial PRIMARY KEY,
  review_id text NOT NULL,
  market_key text NOT NULL,
  market_type text NOT NULL,
  mode text NOT NULL,
  champion text,
  challenger text,
  decision text NOT NULL,
  reason text,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_strategy_reviews_market_idx ON iq_strategy_reviews (market_key, created_at DESC);

CREATE TABLE IF NOT EXISTS iq_audit_trail (
  id bigserial PRIMARY KEY,
  correlation_id text NOT NULL,
  market_key text,
  stage text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_audit_trail_correlation_idx ON iq_audit_trail (correlation_id, id);
CREATE INDEX IF NOT EXISTS iq_audit_trail_market_idx ON iq_audit_trail (market_key, created_at DESC);
