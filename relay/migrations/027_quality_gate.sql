-- 027: Fase 6.4 — Trade Quality Gate (rubrica 0-100) + Entry Location Quality + Microstructure Veto.
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS quality_gate_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS min_trade_quality_score integer NOT NULL DEFAULT 75;
