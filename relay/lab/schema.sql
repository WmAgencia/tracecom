-- LAB 6 STRATEGIES — persistencia (PRACTICE-only). Idempotente.
CREATE TABLE IF NOT EXISTS iq_lab_runs (
  run_id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',
  specs_hash text NOT NULL,
  stake numeric NOT NULL DEFAULT 0,
  expiry_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_context text NOT NULL DEFAULT 'PRACTICE',
  source_run_id text,
  source_strategy text
);
CREATE TABLE IF NOT EXISTS iq_lab_strategy_state (
  run_id text NOT NULL,
  strategy_id text NOT NULL,
  settled_count integer NOT NULL DEFAULT 0,
  open_count integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  opportunities integer NOT NULL DEFAULT 0,
  waits integer NOT NULL DEFAULT 0,
  approvals integer NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, strategy_id)
);
CREATE TABLE IF NOT EXISTS iq_lab_trades (
  strategy_trade_id text PRIMARY KEY,
  run_id text NOT NULL,
  strategy_id text NOT NULL,
  strategy_version text NOT NULL,
  episode_id text,
  snapshot_id text,
  decision_id text,
  market_key text NOT NULL,
  direction text NOT NULL,
  stake numeric NOT NULL,
  payout numeric,
  requested_expiry timestamptz,
  actual_expiry timestamptz,
  candidate_at timestamptz,
  entry_at timestamptz NOT NULL DEFAULT now(),
  expiry_at timestamptz,
  decision text NOT NULL,
  reason text,
  evidence_strength numeric,
  entry_quality text,
  supporting jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter jsonb NOT NULL DEFAULT '[]'::jsonb,
  specialist_outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_id text,
  broker_order_id text,
  state text NOT NULL DEFAULT 'REQUESTED',
  excluded boolean NOT NULL DEFAULT false,
  settlement_at timestamptz,
  entry_price numeric,
  settlement_price numeric,
  result text,
  pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_lab_trades_run_strategy ON iq_lab_trades (run_id, strategy_id, entry_at DESC);
CREATE INDEX IF NOT EXISTS iq_lab_trades_state ON iq_lab_trades (state, strategy_id);
CREATE TABLE IF NOT EXISTS iq_lab_decisions (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  strategy_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  market_key text NOT NULL,
  snapshot_id text,
  decision text NOT NULL,
  side text,
  reason text,
  evidence_strength numeric,
  counter jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS iq_lab_decisions_run_strategy_at ON iq_lab_decisions (run_id, strategy_id, at DESC);
