CREATE TABLE IF NOT EXISTS live_ingest_nonces(nonce text PRIMARY KEY,session_id text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS live_ingest_nonces_expiry_idx ON live_ingest_nonces(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS live_events_session_sequence_idx ON live_events(session_id,sequence_id);
