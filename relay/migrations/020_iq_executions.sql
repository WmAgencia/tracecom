-- 020: execucoes PRACTICE na IQ Option (WS). Historico auditavel; nenhum segredo (nunca SSID).
CREATE TABLE IF NOT EXISTS iq_executions (
  id serial PRIMARY KEY,
  execution_id text NOT NULL UNIQUE,
  idempotency_key text UNIQUE,
  decision_id text,
  connection_id text,
  account_type text NOT NULL DEFAULT 'PRACTICE',
  broker_order_id text,
  symbol text NOT NULL,
  active_id integer,
  direction text NOT NULL,
  stake numeric NOT NULL,
  currency text,
  state text NOT NULL,
  request_id text,
  expiration_at timestamptz,
  entry_price numeric,
  broker_result text,
  causal_result text,
  settlement_mismatch boolean NOT NULL DEFAULT false,
  profit numeric,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  acked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_executions_requested_at_idx ON iq_executions (requested_at DESC);
CREATE INDEX IF NOT EXISTS iq_executions_state_idx ON iq_executions (state);
