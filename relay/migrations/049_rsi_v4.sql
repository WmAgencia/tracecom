-- 049: RSI_REVERSAL_V4 — registry de instrumentos (MESAS), universo/estado/oportunidades/eventos V4
-- e pacote first-10 para export auditavel. Nunca persiste segredos. DDL idempotente.

-- Registry de instrumentos descobertos (BINARY agora; BLITZ apenas se o broker suportar e for descoberto).
CREATE TABLE IF NOT EXISTS iq_rsi_instruments (
  market_key text NOT NULL,
  instrument_type text NOT NULL DEFAULT 'BINARY',
  duration_seconds integer NOT NULL DEFAULT 60,
  market_type text,
  canonical text,
  active_id integer,
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'UNKNOWN',
  payout numeric,
  source text NOT NULL DEFAULT 'BROKER_DISCOVERY',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(market_key, instrument_type, duration_seconds)
);
CREATE INDEX IF NOT EXISTS iq_rsi_instruments_enabled_idx ON iq_rsi_instruments(enabled, instrument_type);

CREATE TABLE IF NOT EXISTS iq_rsi_universe_v4 (
  snapshot_id text NOT NULL,
  market_key text NOT NULL,
  instrument_type text NOT NULL DEFAULT 'BINARY',
  at bigint NOT NULL,
  market_type text,
  canonical text,
  active_id integer,
  enabled boolean,
  availability text,
  payout numeric,
  duration_seconds integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(snapshot_id, market_key, instrument_type)
);

CREATE TABLE IF NOT EXISTS iq_rsi_agent_assignments_v4 (
  market_key text PRIMARY KEY,
  agent_id text,
  strategy text NOT NULL,
  market_type text,
  instrument_types text[] NOT NULL DEFAULT '{}',
  canonical text,
  active_id integer,
  availability text,
  enabled boolean NOT NULL DEFAULT false,
  block_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_rsi_agent_state_v4 (
  agent_id text PRIMARY KEY,
  market_key text NOT NULL,
  instrument_type text NOT NULL DEFAULT 'BINARY',
  duration_seconds integer,
  strategy text NOT NULL,
  status text,
  decision text,
  wait_reason text,
  candidate_at bigint,
  candidate_age_ms bigint,
  candidate_rsi numeric,
  candidate_price numeric,
  revalidation_at bigint,
  submit_at bigint,
  expiry_at bigint,
  entry_mode text,
  rsi numeric,
  rsi_trajectory text,
  rsi_band text,
  bollinger jsonb,
  band jsonb,
  dmi jsonb,
  adx jsonb,
  expected_cushion numeric,
  cushion_class text,
  counter_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  entry_reason jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_id text,
  execution_id text,
  requested_stake numeric,
  effective_stake numeric,
  last_result text,
  last_pnl numeric,
  quality_class text,
  last_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  watch_mode text,
  watch_started_at timestamptz,
  priority_started_at timestamptz,
  evaluation_count integer,
  last_evaluation_at timestamptz,
  evaluation_gap_ms integer,
  max_evaluation_gap_ms integer,
  time_to_expiry_ms integer,
  time_to_cutoff_ms integer,
  final_evaluation_at timestamptz,
  final_evaluation_lead_ms integer,
  submit_latency_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_rsi_opportunities_v4 (
  opportunity_id text PRIMARY KEY,
  market_key text NOT NULL,
  market_type text,
  instrument_type text NOT NULL DEFAULT 'BINARY',
  duration_seconds integer,
  agent_id text,
  strategy_id text NOT NULL,
  strategy_version text NOT NULL DEFAULT 'v4',
  observed_at bigint,
  candidate_at bigint,
  candidate_age_ms bigint,
  candidate_rsi numeric,
  candidate_price numeric,
  direction text,
  entry_mode text,
  decision text,
  accepted boolean NOT NULL DEFAULT false,
  rsi numeric,
  rsi_trajectory text,
  bollinger jsonb,
  band jsonb,
  dmi jsonb,
  adx jsonb,
  structural_trend text,
  short_horizon_direction text,
  projection jsonb,
  expected_cushion numeric,
  cushion_class text,
  order_id text,
  execution_id text,
  effective_stake numeric,
  entry_price numeric,
  entry_noise numeric,
  expiry_at bigint,
  expiry_price numeric,
  result text,
  profit numeric,
  actual_displacement numeric,
  actual_cushion numeric,
  quality_class text,
  settlement_basis text,
  counter_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  entry_reason jsonb NOT NULL DEFAULT '[]'::jsonb,
  hard_blocks_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluations jsonb NOT NULL DEFAULT '[]'::jsonb,
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revalidation_at bigint,
  submit_at bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_rsi_opportunities_v4_market_idx ON iq_rsi_opportunities_v4(market_key, instrument_type, candidate_at DESC);

CREATE TABLE IF NOT EXISTS iq_rsi_events_v4 (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  market_key text,
  instrument_type text,
  agent_id text,
  strategy_id text,
  event text NOT NULL,
  decision text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS iq_rsi_events_v4_at_idx ON iq_rsi_events_v4(at DESC);

CREATE TABLE IF NOT EXISTS iq_v4_export_trades (
  strategy_version text NOT NULL,
  instrument_type text NOT NULL,
  duration_seconds integer NOT NULL,
  trade_number integer NOT NULL,
  package jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(strategy_version, instrument_type, duration_seconds, trade_number)
);

CREATE TABLE IF NOT EXISTS iq_v4_export_summary (
  strategy_version text NOT NULL,
  instrument_type text NOT NULL,
  duration_seconds integer NOT NULL,
  summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(strategy_version, instrument_type, duration_seconds)
);
