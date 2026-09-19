-- 030: LATE WINDOW TIMING POLICY (SHADOW) — LATE_WINDOW_V2 vs CURRENT_V1.
--
-- Puramente ADITIVA e observacional. NAO altera nenhuma regra de decisao, threshold, peso, stake,
-- Brain G2, Critic, Consensus ou Quality Gate. Nao envia ordem (execution = SHADOW_ONLY).
--
--   * iq_timing_policy_observations: uma linha por candidato observado pela nova politica de timing,
--     com T0 congelado (coluna t0, imutavel por trigger) e o comparativo CURRENT_V1 x LATE_WINDOW_V2:
--       - policy: janela de compra da mesma expiracao (turbo 1m: E-90s .. E-30s exclusivo), margem
--         adaptativa (ACK + persistencia DB + decisao + guarda de relogio) e deadline.
--       - current_policy / late_policy / evaluations / comparison / outcome.
--     A liquidacao do braco LATE e CAUSAL_COUNTERFACTUAL (nunca broker); o resultado do broker fica
--     em iq_executions/iq_trade_journal. Dados do Prospective Shadow Lab (029) NUNCA se misturam:
--     tabelas, IDs e versoes (timing_policy_version) sao proprios.
--   * version: string obrigatoria com o nome da politica (LATE_WINDOW_V2). CURRENT_V1 e o braco de
--     comparacao registrado no mesmo documento (current_policy_version), sem linha propria.

CREATE TABLE IF NOT EXISTS iq_timing_policy_observations (
  observation_id text PRIMARY KEY,
  version text NOT NULL,
  timing_policy_version text NOT NULL,
  current_policy_version text NOT NULL DEFAULT 'CURRENT_V1',
  kind text NOT NULL DEFAULT 'TIMING_POLICY_SHADOW',
  provenance text NOT NULL DEFAULT 'PROSPECTIVE',
  market_key text NOT NULL,
  market_type text,
  active_id integer,
  agent_id text,
  candidate_id text,
  correlation_id text,
  target_entry_at timestamptz,
  target_expiry_at timestamptz,
  window_key text NOT NULL,
  product_kind text NOT NULL DEFAULT 'turbo',
  direction text,
  payout double precision,
  t0 jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  late_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluations jsonb NOT NULL DEFAULT '[]'::jsonb,
  comparison jsonb,
  outcome text NOT NULL DEFAULT 'OBSERVING',
  outcome_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_timing_policy_market ON iq_timing_policy_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_timing_policy_candidate ON iq_timing_policy_observations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_iq_timing_policy_version ON iq_timing_policy_observations(timing_policy_version, outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_timing_policy_outcome ON iq_timing_policy_observations(outcome, created_at DESC);

-- T0 e identidade da politica sao point-in-time: nenhum UPDATE pode reescrever o snapshot congelado
-- nem a janela/margem/deadline definidas no begin. Somente o ciclo de vida (current/late/comparison/
-- outcome) evolui.
CREATE OR REPLACE FUNCTION iq_timing_policy_t0_guard() RETURNS trigger AS $guard$
BEGIN
  IF NEW.t0 IS DISTINCT FROM OLD.t0 THEN RAISE EXCEPTION 'iq_timing_policy_observations.t0 is immutable'; END IF;
  IF NEW.policy->'window' IS DISTINCT FROM OLD.policy->'window' THEN RAISE EXCEPTION 'iq_timing_policy_observations.policy.window is immutable'; END IF;
  IF NEW.policy->'deadlineAt' IS DISTINCT FROM OLD.policy->'deadlineAt' THEN RAISE EXCEPTION 'iq_timing_policy_observations.policy.deadlineAt is immutable'; END IF;
  IF NEW.timing_policy_version IS DISTINCT FROM OLD.timing_policy_version THEN RAISE EXCEPTION 'iq_timing_policy_observations.timing_policy_version is immutable'; END IF;
  IF NEW.current_policy_version IS DISTINCT FROM OLD.current_policy_version THEN RAISE EXCEPTION 'iq_timing_policy_observations.current_policy_version is immutable'; END IF;
  IF NEW.market_key IS DISTINCT FROM OLD.market_key THEN RAISE EXCEPTION 'iq_timing_policy_observations.market_key is immutable'; END IF;
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id THEN RAISE EXCEPTION 'iq_timing_policy_observations.candidate_id is immutable'; END IF;
  IF NEW.target_entry_at IS DISTINCT FROM OLD.target_entry_at THEN RAISE EXCEPTION 'iq_timing_policy_observations.target_entry_at is immutable'; END IF;
  IF NEW.target_expiry_at IS DISTINCT FROM OLD.target_expiry_at THEN RAISE EXCEPTION 'iq_timing_policy_observations.target_expiry_at is immutable'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iq_timing_policy_t0_immutable ON iq_timing_policy_observations;
CREATE TRIGGER iq_timing_policy_t0_immutable BEFORE UPDATE ON iq_timing_policy_observations
  FOR EACH ROW EXECUTE FUNCTION iq_timing_policy_t0_guard();
