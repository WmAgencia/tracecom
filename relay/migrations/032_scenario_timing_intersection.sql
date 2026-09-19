-- 032: SCENARIO x TIMING INTERSECTION (camada OBSERVACIONAL separada) — aditiva.
--
-- 1) Versionamento explicito do motor de cenarios (TASK 4): `scenario_engine_version` persistido por
--    observacao (SCENARIO_ENGINE_V3 quando o motor real esta ativo; valor do fail-safe quando nao).
--    A serie de timing continua em coluna PROPRIA e independente: G2+CURRENT_JIT, G2+LATE_WINDOW_V2,
--    V3+CURRENT_JIT, V3+LATE_WINDOW_V2 comparaveis sem misturar amostras.
-- 2) `timing_policy_version` deixa de ser NOT NULL: o scenario-shadow NAO conhece politica de timing;
--    o label e opaco/fornecido pelo chamador/intersecao (cada lado produz seu proprio estado).
-- 3) `iq_scenario_timing_intersections`: comparacao somente-leitura scenario x timing (dado analitico;
--    nunca votacao e nunca controle). Nenhuma tabela existente e alterada em comportamento.
--
-- Retencao: scripts/db-retention.mjs (SCENARIO_SHADOW_RETENTION_HOURS, default 168 h).

ALTER TABLE iq_scenario_shadow_observations ADD COLUMN IF NOT EXISTS scenario_engine_version text NOT NULL DEFAULT 'SCENARIO_ENGINE_V3';
ALTER TABLE iq_scenario_shadow_observations ALTER COLUMN timing_policy_version DROP NOT NULL;
ALTER TABLE iq_scenario_shadow_observations ALTER COLUMN timing_policy_version SET DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_engine_version ON iq_scenario_shadow_observations(scenario_engine_version, timing_policy_version, created_at DESC);

-- Imutabilidade da versao do motor (aditiva ao guard da 031; nunca sobrescrita).
CREATE OR REPLACE FUNCTION iq_scenario_shadow_engine_guard() RETURNS trigger AS $guard$
BEGIN
  IF NEW.scenario_engine_version IS DISTINCT FROM OLD.scenario_engine_version THEN
    RAISE EXCEPTION 'iq_scenario_shadow_observations.scenario_engine_version is immutable';
  END IF;
  RETURN NEW;
END
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iq_scenario_shadow_engine_immutable ON iq_scenario_shadow_observations;
CREATE TRIGGER iq_scenario_shadow_engine_immutable BEFORE UPDATE ON iq_scenario_shadow_observations
  FOR EACH ROW EXECUTE FUNCTION iq_scenario_shadow_engine_guard();

CREATE TABLE IF NOT EXISTS iq_scenario_timing_intersections (
  intersection_id text PRIMARY KEY,
  version text NOT NULL DEFAULT 'scenario-timing-intersection-v1',
  kind text NOT NULL DEFAULT 'SCENARIO_TIMING_INTERSECTION',
  market_key text NOT NULL,
  market_type text,
  candidate_id text,
  correlation_id text,
  execution_id text,
  scenario_observation_id text,
  timing_observation_id text,
  scenario_policy_version text,
  scenario_engine_version text,
  timing_policy_version text,
  current_policy_version text,
  scenario_at_candidate jsonb,
  scenario_at_late_deadline jsonb,
  scenario_final_action text,
  late_deadline_at timestamptz,
  late_outcome text,
  late_verdict text,
  late_valid_at_deadline boolean,
  intersection_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  verdict text,
  direction_agreement boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_scenario_timing_intersections_market ON iq_scenario_timing_intersections(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_timing_intersections_candidate ON iq_scenario_timing_intersections(candidate_id);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_timing_intersections_verdict ON iq_scenario_timing_intersections(verdict, created_at DESC);
