CREATE INDEX IF NOT EXISTS live_events_session_timestamp_idx ON live_events(session_id,event_timestamp);
CREATE INDEX IF NOT EXISTS vision_samples_session_timestamp_idx ON vision_market_samples(session_id,timestamp);
CREATE INDEX IF NOT EXISTS vision_samples_frame_hash_idx ON vision_market_samples(frame_hash);
CREATE INDEX IF NOT EXISTS live_decisions_session_decision_idx ON live_decisions(session_id,decision_id);
CREATE INDEX IF NOT EXISTS live_settlements_session_decision_idx ON live_settlements(session_id,decision_id);
CREATE INDEX IF NOT EXISTS live_access_logs_key_timestamp_idx ON live_access_logs(api_key_id,timestamp);
CREATE INDEX IF NOT EXISTS live_api_keys_validity_idx ON live_api_keys(revoked_at,expires_at);
