-- 024: Fase 5.1 — persistencia do agente APRENDIZ (mesa de laboratorio, shadow-only).
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS apprentice_json jsonb NOT NULL DEFAULT '{}'::jsonb;
