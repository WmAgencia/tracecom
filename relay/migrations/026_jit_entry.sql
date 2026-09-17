-- 026: Fase 6.2 — Just-in-Time entry (candidato -> janela -> revalidacao -> commit).
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS jit_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS entry_lead_ms integer NOT NULL DEFAULT 1500;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS entry_window_max_drift_ms integer NOT NULL DEFAULT 2500;
