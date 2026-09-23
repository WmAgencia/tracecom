-- 053: agregados diarios duraveis por estrategia/direcao.
-- A retencao de iq_executions (35 dias, runDbMaintenance) move as linhas para este agregado
-- na MESMA instrucao (DELETE ... RETURNING -> INSERT ON CONFLICT), garantindo que a serie
-- cumulativa (stats/observability) nunca perca N/W/L/D/PnL apos a poda.
CREATE TABLE IF NOT EXISTS iq_strategy_daily_aggregates (
  strategy_version text NOT NULL,
  strategy_hash text NOT NULL DEFAULT '',
  day date NOT NULL,
  direction text NOT NULL DEFAULT '',
  n integer NOT NULL DEFAULT 0,
  w integer NOT NULL DEFAULT 0,
  l integer NOT NULL DEFAULT 0,
  d integer NOT NULL DEFAULT 0,
  pnl numeric NOT NULL DEFAULT 0,
  stake_sum numeric NOT NULL DEFAULT 0,
  payout_sum numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_version, strategy_hash, day, direction)
);
CREATE INDEX IF NOT EXISTS iq_strategy_daily_aggregates_window_idx ON iq_strategy_daily_aggregates (strategy_version, day);
COMMENT ON TABLE iq_strategy_daily_aggregates IS 'Agregado diario duravel das execucoes podadas (V2 cumulativa); nunca mistura REAL/PATH_TEST/excluidos.';
