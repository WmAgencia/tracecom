-- 021: multi-market (NORMAL/OTC), config global e atributos por execucao. Nunca persiste segredo.
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS market_key text;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS payout numeric;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS option_kind text;
CREATE INDEX IF NOT EXISTS iq_executions_market_key_idx ON iq_executions (market_key, requested_at DESC);
CREATE INDEX IF NOT EXISTS iq_executions_settled_at_idx ON iq_executions (settled_at DESC);

CREATE TABLE IF NOT EXISTS iq_markets (
  market_key text PRIMARY KEY,
  symbol text NOT NULL,
  display text NOT NULL,
  market_type text NOT NULL,
  canonical text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  max_stake numeric NOT NULL DEFAULT 2,
  strategy text,
  active_id integer,
  instrument_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability text NOT NULL DEFAULT 'UNKNOWN',
  payout numeric,
  payout_source text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_runtime_config (
  id integer PRIMARY KEY DEFAULT 1,
  mode text NOT NULL DEFAULT 'PRACTICE',
  global_max_stake numeric NOT NULL DEFAULT 2,
  calculated_bankroll_stake numeric NOT NULL DEFAULT 1,
  auto_execute boolean NOT NULL DEFAULT false,
  selection_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolver_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
