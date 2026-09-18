-- 029: PROSPECTIVE SHADOW LAB — observabilidade de pesquisa (D3/D4/D5 + H1/H2/H3 + degracao + contrafactual).
--
-- Esta migration e PURAMENTE ADITIVA e nao altera nenhuma regra de decisao:
--   * iq_shadow_observations: uma linha por oportunidade observada (candidato pos-revalidacao),
--     com T0 congelado (coluna t0) e observadores SHADOW (gate current vs corrected, H1/H2/H3,
--     degradation observer, contrafactual). O T0 e protegido por trigger BEFORE UPDATE.
--   * iq_trade_market_windows: janela PRE/POST por operacao, SEMPRE diagnostic_only/feedable_to_t0=false.
--     Gerenciada pela retencao existente (scripts/db-retention.mjs, MARKET_WINDOW_RETENTION_HOURS).
--   * iq_trade_journal: colunas explicitas de origem da decisao (D3) — MANUAL_UI nunca vira traderDecision.
--
-- Nenhuma tabela de execucao/config e alterada; nenhum threshold/stake e tocado.

CREATE TABLE IF NOT EXISTS iq_shadow_observations (
  observation_id text PRIMARY KEY,
  version text NOT NULL,
  kind text NOT NULL DEFAULT 'SHADOW_OBSERVATION',
  provenance text NOT NULL DEFAULT 'PROSPECTIVE',
  decision_source text NOT NULL DEFAULT 'G2_AUTO',
  market_key text NOT NULL,
  market_type text,
  active_id integer,
  agent_id text,
  candidate_id text,
  trade_id text,
  execution_id text,
  correlation_id text,
  candidate_at timestamptz,
  decision_at timestamptz,
  jit_at timestamptz,
  send_at timestamptz,
  entry_at timestamptz,
  target_entry_at timestamptz,
  target_expiry_at timestamptz,
  payout double precision,
  t0 jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_current jsonb,
  gate_corrected_shadow jsonb,
  gate_comparison jsonb,
  h1_location jsonb,
  h2_displacement jsonb,
  h3_critic jsonb,
  degradation jsonb,
  counterfactual jsonb,
  current_execution text,
  current_execution_reason text,
  settlement_basis text,
  broker_result text,
  broker_profit double precision,
  theoretical_result text,
  theoretical_pnl double precision,
  entry_price double precision,
  settlement_price double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_shadow_obs_market ON iq_shadow_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_shadow_obs_candidate ON iq_shadow_observations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_iq_shadow_obs_execution ON iq_shadow_observations(execution_id);
CREATE INDEX IF NOT EXISTS idx_iq_shadow_obs_source ON iq_shadow_observations(decision_source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_shadow_obs_basis ON iq_shadow_observations(settlement_basis, created_at DESC);

-- T0/vereditos imutaveis: nenhum UPDATE pode reescrever o snapshot point-in-time nem os
-- observadores SHADOW. Apenas o ciclo de vida (execucao/settlement) pode ser preenchido.
CREATE OR REPLACE FUNCTION iq_shadow_observations_t0_guard() RETURNS trigger AS $guard$
BEGIN
  IF NEW.t0 IS DISTINCT FROM OLD.t0 THEN RAISE EXCEPTION 'iq_shadow_observations.t0 is immutable'; END IF;
  IF NEW.gate_current IS DISTINCT FROM OLD.gate_current THEN RAISE EXCEPTION 'iq_shadow_observations.gate_current is immutable'; END IF;
  IF NEW.gate_corrected_shadow IS DISTINCT FROM OLD.gate_corrected_shadow THEN RAISE EXCEPTION 'iq_shadow_observations.gate_corrected_shadow is immutable'; END IF;
  IF NEW.gate_comparison IS DISTINCT FROM OLD.gate_comparison THEN RAISE EXCEPTION 'iq_shadow_observations.gate_comparison is immutable'; END IF;
  IF NEW.h3_critic IS DISTINCT FROM OLD.h3_critic THEN RAISE EXCEPTION 'iq_shadow_observations.h3_critic is immutable'; END IF;
  IF NEW.degradation IS DISTINCT FROM OLD.degradation THEN RAISE EXCEPTION 'iq_shadow_observations.degradation is immutable'; END IF;
  IF NEW.decision_source IS DISTINCT FROM OLD.decision_source THEN RAISE EXCEPTION 'iq_shadow_observations.decision_source is immutable'; END IF;
  IF NEW.market_key IS DISTINCT FROM OLD.market_key THEN RAISE EXCEPTION 'iq_shadow_observations.market_key is immutable'; END IF;
  IF NEW.candidate_at IS DISTINCT FROM OLD.candidate_at THEN RAISE EXCEPTION 'iq_shadow_observations.candidate_at is immutable'; END IF;
  IF NEW.decision_at IS DISTINCT FROM OLD.decision_at THEN RAISE EXCEPTION 'iq_shadow_observations.decision_at is immutable'; END IF;
  IF NEW.jit_at IS DISTINCT FROM OLD.jit_at THEN RAISE EXCEPTION 'iq_shadow_observations.jit_at is immutable'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iq_shadow_observations_t0_immutable ON iq_shadow_observations;
CREATE TRIGGER iq_shadow_observations_t0_immutable BEFORE UPDATE ON iq_shadow_observations
  FOR EACH ROW EXECUTE FUNCTION iq_shadow_observations_t0_guard();

-- D5: janela compacta PRE/POST. diagnostic_only=true e feedable_to_t0=false sao invariantes.
CREATE TABLE IF NOT EXISTS iq_trade_market_windows (
  observation_id text NOT NULL,
  trade_id text,
  market_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PRE','POST')),
  bucket_start timestamptz NOT NULL,
  offset_seconds double precision,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  diagnostic_only boolean NOT NULL DEFAULT true,
  feedable_to_t0 boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, kind, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_iq_trade_windows_created ON iq_trade_market_windows(created_at);
CREATE INDEX IF NOT EXISTS idx_iq_trade_windows_trade ON iq_trade_market_windows(trade_id, kind);

-- D3: origem da decisao explicita no journal (payload continua sendo a fonte completa).
ALTER TABLE iq_trade_journal ADD COLUMN IF NOT EXISTS decision_source text;
ALTER TABLE iq_trade_journal ADD COLUMN IF NOT EXISTS brain_decision text;
ALTER TABLE iq_trade_journal ADD COLUMN IF NOT EXISTS manual_requested_direction text;
CREATE INDEX IF NOT EXISTS idx_iq_trade_journal_source ON iq_trade_journal(decision_source, settlement_at DESC);
