-- 043: RSI AGENTS 5x5 — 10 agentes normais do runtime (5 STRICT + 5 PULLBACK) em OTCs fixos, assignment persistida.
CREATE TABLE IF NOT EXISTS iq_rsi_agent_assignments (
  market_key text PRIMARY KEY,
  strategy text NOT NULL,
  active_id bigint,
  canonical text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  availability text NOT NULL DEFAULT 'UNKNOWN',
  substituted_from text,
  substitution_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS iq_rsi_agent_state (
  agent_id text PRIMARY KEY,
  market_key text NOT NULL,
  strategy text NOT NULL,
  status text,
  decision text,
  wait_reason text,
  rsi numeric,
  rsi_band text,
  bollinger_state jsonb,
  dmi jsonb,
  adx jsonb,
  structural_trend text,
  short_horizon_direction text,
  candidate_at bigint,
  revalidation_at bigint,
  submit_at bigint,
  last_reason text,
  position jsonb,
  last_result text,
  last_pnl numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_agents_strategy ON iq_rsi_agent_state(strategy, market_key);
