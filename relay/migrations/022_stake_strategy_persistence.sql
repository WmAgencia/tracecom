-- 022: persistencia de VALOR POR OPERACAO (configured stake) e VARIANTE DE ESTRATEGIA por mercado + revisoes anti-race.
-- Nunca altera logica de estrategia; apenas configuracao persistente e observavel.

ALTER TABLE iq_markets ADD COLUMN IF NOT EXISTS configured_stake numeric;
ALTER TABLE iq_markets ADD COLUMN IF NOT EXISTS strategy_variant_id text;
ALTER TABLE iq_markets ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS default_stake numeric;
ALTER TABLE iq_runtime_config ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

-- Migracao de semantica: o antigo max_stake (valor escolhido pelo operador) vira configured_stake;
-- max_stake passa a ser teto de seguranca do agente (default = hard cap 100).
UPDATE iq_markets SET configured_stake = COALESCE(configured_stake, max_stake, 1) WHERE configured_stake IS NULL;
UPDATE iq_markets SET max_stake = 100 WHERE max_stake IS NULL OR max_stake < configured_stake;

-- Variante congelada explicita por mercado (family-horizon valido).
UPDATE iq_markets SET strategy_variant_id = CASE
  WHEN strategy = 'V1' THEN 'V1-300'
  WHEN strategy = 'V8' THEN 'V8-60'
  WHEN strategy = 'V2' THEN 'V2-60'
  WHEN strategy = 'V3' THEN 'V3-60'
  ELSE 'V3-60'
END WHERE strategy_variant_id IS NULL;

-- Config global: default_stake herda o valor que o operador escolheu; global_max_stake vira teto de seguranca.
UPDATE iq_runtime_config SET default_stake = COALESCE(default_stake, global_max_stake, calculated_bankroll_stake, 1) WHERE default_stake IS NULL;
UPDATE iq_runtime_config SET global_max_stake = 100 WHERE global_max_stake IS NULL OR global_max_stake < default_stake;
