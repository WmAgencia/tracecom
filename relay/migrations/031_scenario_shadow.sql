-- 031: SCENARIO SHADOW + CRITIC INDEPENDENTE (Agente B) — SCENARIO_ENGINE_V3_SHADOW vs CURRENT_G2.
--
-- Puramente ADITIVA e observacional. NAO altera Brain G2, estrategia, setups, threshold 75, pesos do
-- Quality Gate, regras do Critic atual, Consensus, stake, JIT nem Execution Gate. NAO envia ordem
-- (execution = SHADOW_ONLY). Series versionadas SEPARADAS:
--   * scenario_policy_version = SCENARIO_ENGINE_V3_SHADOW (esta tabela);
--   * current_policy_version  = CURRENT_G2 (o que o G2 decidiu, registrado sem alteracao);
--   * timing_policy_version   = LATE_WINDOW_V2 | CURRENT_V1 (coluna propria, nunca misturada).
--
--   * iq_scenario_shadow_observations: uma linha por oportunidade observada, com:
--       - t0 jsonb IMUTAVEL point-in-time (sanitizado; sem POST/settlement/result/futuro);
--       - critic_freeze jsonb IMUTAVEL: FASE 1 do Critic independente (hash + timestamp), computada
--         ANTES de ver a conclusao do Trader; comparison/divergence registram a FASE 2;
--       - persistence jsonb + colunas scenario_at_candidate/revalidation1/revalidation2/final_entry,
--         scenario_changed/scenario_change_count, playbook_at_candidate/playbook_at_entry;
--       - stages/transitions append-only; outcome pos-classificacao (OUTCOME nunca realimenta T0).
--     Os dados do Prospective Shadow Lab (029) e do timing (030) NUNCA se misturam: tabelas,
--     IDs e versoes proprios.
--
-- Retencao: scripts/db-retention.mjs (SCENARIO_SHADOW_RETENTION_HOURS, default 168 h).

CREATE TABLE IF NOT EXISTS iq_scenario_shadow_observations (
  observation_id text PRIMARY KEY,
  version text NOT NULL,
  scenario_policy_version text NOT NULL DEFAULT 'SCENARIO_ENGINE_V3_SHADOW',
  current_policy_version text NOT NULL DEFAULT 'CURRENT_G2',
  timing_policy_version text NOT NULL DEFAULT 'LATE_WINDOW_V2',
  kind text NOT NULL DEFAULT 'SCENARIO_SHADOW_OBSERVATION',
  provenance text NOT NULL DEFAULT 'PROSPECTIVE',
  market_key text NOT NULL,
  market_type text,
  active_id integer,
  agent_id text,
  candidate_id text,
  correlation_id text,
  execution_id text,
  trade_id text,
  candidate_at timestamptz,
  decision_at timestamptz,
  jit_at timestamptz,
  final_entry_at timestamptz,
  target_entry_at timestamptz,
  target_expiry_at timestamptz,
  direction text,
  payout double precision,
  t0 jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_decision jsonb,
  scenario_decision jsonb,
  trader_scenario jsonb,
  critic_scenario jsonb,
  critic_freeze jsonb,
  comparison jsonb,
  agreement boolean,
  divergence jsonb,
  persistence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ablation jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario_at_candidate text,
  scenario_at_revalidation1 text,
  scenario_at_revalidation2 text,
  scenario_at_final_entry text,
  scenario_changed boolean NOT NULL DEFAULT false,
  scenario_change_count integer NOT NULL DEFAULT 0,
  playbook_at_candidate text,
  playbook_at_entry text,
  final_action text,
  reasons_for_wait jsonb NOT NULL DEFAULT '[]'::jsonb,
  t0_integrity jsonb,
  engine_info jsonb,
  outcome jsonb,
  settlement_basis text,
  broker_result text,
  broker_profit double precision,
  theoretical_result text,
  theoretical_pnl double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_market ON iq_scenario_shadow_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_candidate ON iq_scenario_shadow_observations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_execution ON iq_scenario_shadow_observations(execution_id);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_version ON iq_scenario_shadow_observations(scenario_policy_version, timing_policy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_basis ON iq_scenario_shadow_observations(settlement_basis, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_scenario_shadow_final_action ON iq_scenario_shadow_observations(final_action, created_at DESC);

-- Imutabilidade de T0, identidade e da FASE 1 do Critic (congelada ANTES do Trader). Apenas o
-- ciclo de vida (persistence/stages/stages/outcome/settlement) pode evoluir.
CREATE OR REPLACE FUNCTION iq_scenario_shadow_t0_guard() RETURNS trigger AS $guard$
BEGIN
  IF NEW.t0 IS DISTINCT FROM OLD.t0 THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.t0 is immutable'; END IF;
  IF NEW.critic_freeze IS DISTINCT FROM OLD.critic_freeze THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.critic_freeze is immutable'; END IF;
  IF NEW.scenario_policy_version IS DISTINCT FROM OLD.scenario_policy_version THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.scenario_policy_version is immutable'; END IF;
  IF NEW.current_policy_version IS DISTINCT FROM OLD.current_policy_version THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.current_policy_version is immutable'; END IF;
  IF NEW.market_key IS DISTINCT FROM OLD.market_key THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.market_key is immutable'; END IF;
  IF NEW.market_type IS DISTINCT FROM OLD.market_type THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.market_type is immutable'; END IF;
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.candidate_id is immutable'; END IF;
  IF NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.correlation_id is immutable'; END IF;
  IF NEW.candidate_at IS DISTINCT FROM OLD.candidate_at THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.candidate_at is immutable'; END IF;
  IF NEW.decision_at IS DISTINCT FROM OLD.decision_at THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.decision_at is immutable'; END IF;
  IF NEW.jit_at IS DISTINCT FROM OLD.jit_at THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.jit_at is immutable'; END IF;
  IF NEW.target_entry_at IS DISTINCT FROM OLD.target_entry_at THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.target_entry_at is immutable'; END IF;
  IF NEW.target_expiry_at IS DISTINCT FROM OLD.target_expiry_at THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.target_expiry_at is immutable'; END IF;
  IF NEW.direction IS DISTINCT FROM OLD.direction THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.direction is immutable'; END IF;
  IF NEW.timing_policy_version IS DISTINCT FROM OLD.timing_policy_version THEN RAISE EXCEPTION 'iq_scenario_shadow_observations.timing_policy_version is immutable'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iq_scenario_shadow_t0_immutable ON iq_scenario_shadow_observations;
CREATE TRIGGER iq_scenario_shadow_t0_immutable BEFORE UPDATE ON iq_scenario_shadow_observations
  FOR EACH ROW EXECUTE FUNCTION iq_scenario_shadow_t0_guard();
