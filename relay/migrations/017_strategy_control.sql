-- 017_strategy_control.sql — selecao operacional (MANUAL|AUTO), audit, sinais shadow congelados V1/V2/V3/V8.
-- Fonte de verdade duravel (Postgres do relay). Nao altera estrategias congeladas.

CREATE TABLE IF NOT EXISTS strategy_selection (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'MANUAL' CHECK (mode IN ('MANUAL','AUTO')),
  family text NOT NULL DEFAULT 'V3' CHECK (family IN ('V1','V2','V3','V8')),
  horizon_seconds int NOT NULL DEFAULT 60,
  entry_logic_hash text NOT NULL,
  variant_id text NOT NULL,
  reason text NOT NULL DEFAULT 'default',
  actor text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_selection_audit (
  id bigserial PRIMARY KEY,
  old_variant text,
  new_variant text NOT NULL,
  mode text NOT NULL,
  reason text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'ui',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frozen_signals (
  id bigserial PRIMARY KEY,
  session_id text,
  segment_id text,
  family text NOT NULL CHECK (family IN ('V1','V2','V3','V8')),
  horizon_seconds int NOT NULL CHECK (horizon_seconds IN (45,60,120,180,300)),
  direction text NOT NULL CHECK (direction IN ('BUY','SELL')),
  signal_bucket bigint NOT NULL,
  entry_price double precision NOT NULL,
  strategy_hash text NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  settled_outcome text CHECK (settled_outcome IN ('WIN','LOSS','DRAW','UNKNOWN')),
  settlement_price double precision,
  settlement_bucket bigint,
  settled_at timestamptz,
  settlement_attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family, horizon_seconds, signal_bucket)
);
CREATE INDEX IF NOT EXISTS frozen_signals_pending_idx ON frozen_signals (settled_outcome, signal_bucket) WHERE settled_outcome IS NULL;
CREATE INDEX IF NOT EXISTS frozen_signals_created_idx ON frozen_signals (family, horizon_seconds, created_at DESC);

CREATE TABLE IF NOT EXISTS frozen_latest_signal (
  family text NOT NULL,
  horizon_seconds int NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY','SELL')),
  signal_bucket bigint NOT NULL,
  entry_price double precision NOT NULL,
  entry_timestamp bigint NOT NULL,
  strategy_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family, horizon_seconds)
);

CREATE TABLE IF NOT EXISTS promotion_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  champion_variant text NOT NULL,
  candidate_variant text,
  candidate_since timestamptz,
  candidate_training_n int NOT NULL DEFAULT 0,
  last_decision text,
  last_decision_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_audit (
  id bigserial PRIMARY KEY,
  candidate_variant text NOT NULL,
  champion_variant text NOT NULL,
  decision text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
