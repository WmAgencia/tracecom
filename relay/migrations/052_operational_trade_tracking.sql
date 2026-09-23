-- 052: rastreio operacional da V2 nos trades — decisao, snapshot e versao da estrategia.
-- Aditivo: preserva o historico existente (colunas nullable). PATH_TEST e marcado como
-- excluded_from_stats para nunca contaminar as estatisticas da V2.
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS strategy_version text;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS strategy_hash text;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS stats_epoch timestamptz;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS decision_snapshot jsonb;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS test_only boolean NOT NULL DEFAULT false;
ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS excluded_from_stats boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS iq_executions_strategy_version_idx ON iq_executions (strategy_version, requested_at DESC);
