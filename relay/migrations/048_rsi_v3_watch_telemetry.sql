-- 048: telemetria do scheduler ACTIVE_CANDIDATE_WATCH / PRIORITY_FINAL_WATCH (somente monitoramento).
-- Nenhuma coluna altera a logica direcional; apenas observabilidade por mercado/candidate.
ALTER TABLE iq_rsi_agent_state_v3
  ADD COLUMN IF NOT EXISTS watch_mode text,
  ADD COLUMN IF NOT EXISTS watch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_count integer,
  ADD COLUMN IF NOT EXISTS last_evaluation_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_gap_ms integer,
  ADD COLUMN IF NOT EXISTS max_evaluation_gap_ms integer,
  ADD COLUMN IF NOT EXISTS time_to_expiry_ms integer,
  ADD COLUMN IF NOT EXISTS time_to_cutoff_ms integer,
  ADD COLUMN IF NOT EXISTS final_evaluation_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_evaluation_lead_ms integer,
  ADD COLUMN IF NOT EXISTS submit_latency_ms integer;
