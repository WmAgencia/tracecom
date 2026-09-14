CREATE TABLE IF NOT EXISTS operational_sessions(session_id text PRIMARY KEY,snapshot jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
