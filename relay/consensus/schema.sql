-- CONSENSUS CORE — instrumentacao experimental (aplicar uma vez; idempotente).
CREATE TABLE IF NOT EXISTS iq_consensus_decisions (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  market_key text NOT NULL,
  snapshot_id text,
  decision text NOT NULL,
  side text,
  reason text,
  evidence_strength numeric,
  latency_ms integer,
  rsi numeric,
  rsi_state text,
  rsi_trajectory jsonb NOT NULL DEFAULT '[]'::jsonb,
  bollinger_state text,
  dmi_state text,
  pa_structure text,
  supporting jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_context text NOT NULL DEFAULT 'PRACTICE'
);
CREATE INDEX IF NOT EXISTS iq_consensus_decisions_market_at ON iq_consensus_decisions (market_key, at DESC);
CREATE INDEX IF NOT EXISTS iq_consensus_decisions_decision_at ON iq_consensus_decisions (decision, at DESC);
