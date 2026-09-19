-- 039: PRACTICE_FOUR_WAY_3X_TEST_V1 — harness de execucao experimental (PRACTICE ONLY, DRY_RUN default).
CREATE TABLE IF NOT EXISTS iq_execution_experiments (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'DRY_RUN',
  max_total integer NOT NULL DEFAULT 12,
  min_stake_brl numeric,
  arm_phrase_hash text,
  armed_by text,
  armed_at timestamptz,
  stopped_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_experiment_strategy_state (
  experiment_id text NOT NULL REFERENCES iq_execution_experiments(id) ON DELETE CASCADE,
  strategy_id text NOT NULL,
  executed_count integer NOT NULL DEFAULT 0,
  reserved_count integer NOT NULL DEFAULT 0,
  max_executions integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS iq_experiment_executions (
  experiment_id text NOT NULL,
  strategy_id text NOT NULL,
  opportunity_id text NOT NULL,
  decision_id text,
  execution_id text,
  idempotency_key text NOT NULL,
  market_key text,
  market_type text,
  direction text,
  payout numeric,
  stake_brl numeric,
  status text NOT NULL DEFAULT 'WOULD_EXECUTE',
  broker_order_id text,
  result text,
  practice_pnl numeric,
  decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, strategy_id, opportunity_id, direction, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_iq_experiment_executions_idem ON iq_experiment_executions(experiment_id, idempotency_key);

CREATE TABLE IF NOT EXISTS iq_experiment_events (
  id bigserial PRIMARY KEY,
  experiment_id text NOT NULL,
  event_type text NOT NULL,
  strategy_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_experiment_events ON iq_experiment_events(experiment_id, created_at DESC);
