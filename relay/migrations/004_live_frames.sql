CREATE TABLE IF NOT EXISTS live_frames(id bigserial PRIMARY KEY,session_id text NOT NULL,frame_id text NOT NULL,payload_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS live_frames_session_frame_idx ON live_frames(session_id,frame_id);
CREATE INDEX IF NOT EXISTS live_frames_latest_idx ON live_frames(session_id,created_at DESC);
