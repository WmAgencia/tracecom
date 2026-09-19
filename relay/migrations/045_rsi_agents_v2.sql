-- 045: RSI AGENTS V2 — universo dinamico + divisao 50/50 persistida + estado/episodio V2 +
-- shadow comparison (a skill nao atribuida avalia o mesmo mercado/instante e NUNCA envia ordem).
-- V1 (043/044) permanece intacto; nada e apagado.

CREATE TABLE IF NOT EXISTS iq_rsi_universe_v2 (
  snapshot_id text NOT NULL,
  market_key text NOT NULL,
  at bigint NOT NULL,
  market_type text,
  canonical text,
  active_id bigint,
  enabled boolean,
  availability text,
  payout numeric,
  candles_count int,
  feed_ready boolean,
  turbo_supported boolean,
  eligible boolean,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, market_key)
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_universe_v2_at ON iq_rsi_universe_v2(at DESC);

CREATE TABLE IF NOT EXISTS iq_rsi_agent_assignments_v2 (
  market_key text PRIMARY KEY,
  strategy text NOT NULL,
  market_type text,
  canonical text,
  active_id bigint,
  availability text NOT NULL DEFAULT 'UNKNOWN',
  pinned boolean NOT NULL DEFAULT true,
  block_reason text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_assignment_v2_strategy ON iq_rsi_agent_assignments_v2(strategy, market_type);

CREATE TABLE IF NOT EXISTS iq_rsi_agent_state_v2 (
  agent_id text PRIMARY KEY,
  market_key text NOT NULL,
  strategy text NOT NULL,
  shadow_strategy text,
  status text,
  decision text,
  wait_reason text,
  candidate_at bigint,
  revalidation_at bigint,
  submit_at bigint,
  expiry_at bigint,
  rsi numeric,
  rsi_trajectory text,
  rsi_band text,
  bollinger jsonb,
  band jsonb,
  dmi jsonb,
  adx jsonb,
  structural_trend text,
  short_horizon_direction text,
  executing_decision text,
  shadow_decision text,
  shadow_payload jsonb,
  order_id text,
  execution_id text,
  requested_stake numeric,
  effective_stake numeric,
  last_result text,
  last_pnl numeric,
  last_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_state_v2_strategy ON iq_rsi_agent_state_v2(strategy, market_key);

CREATE TABLE IF NOT EXISTS iq_rsi_shadow_opportunities_v2 (
  opportunity_id text PRIMARY KEY,
  market_key text NOT NULL,
  market_type text,
  strategy_executing text NOT NULL,
  strategy_shadow text NOT NULL,
  observed_at bigint,
  expiry_at bigint,
  executing_decision text,
  shadow_decision text,
  agreement boolean,
  executing_accepted boolean,
  shadow_accepted boolean,
  direction text,
  rsi numeric,
  rsi_band text,
  bollinger jsonb,
  dmi jsonb,
  adx jsonb,
  structural_trend text,
  short_horizon_direction text,
  tags jsonb,
  order_id text,
  execution_id text,
  effective_stake numeric,
  executing_result text,
  executing_profit numeric,
  executing_settled_at bigint,
  shadow_result text,
  shadow_profit numeric,
  shadow_settled_at bigint,
  settlement_basis text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_shadow_v2_market ON iq_rsi_shadow_opportunities_v2(market_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_shadow_v2_strategy ON iq_rsi_shadow_opportunities_v2(strategy_executing, observed_at DESC);

CREATE TABLE IF NOT EXISTS iq_rsi_events_v2 (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  market_key text,
  strategy text,
  event text,
  decision text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_events_v2_market ON iq_rsi_events_v2(market_key, at DESC);
