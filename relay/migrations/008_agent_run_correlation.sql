ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS frame_id text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS candle_id text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS decision_id text;
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs(agent_id, created_at DESC);
