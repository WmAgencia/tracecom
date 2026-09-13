CREATE TABLE IF NOT EXISTS training_sessions(id text PRIMARY KEY,status text NOT NULL DEFAULT 'ACTIVE',payload_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS training_sessions_updated_idx ON training_sessions(updated_at DESC);
