-- 034: PROFESSIONAL_AGENT_SYSTEM_V4 (SHADOW) — observacoes prospectivas de pesquisa.
--
-- NUNCA armazena credenciais; nenhuma ordem e gerada por esta tabela.
-- Liquidacao observacional (CAUSAL_COUNTERFACTUAL / PROSPECTIVE_SHADOW) e feita por UPDATE
-- idempotente que nunca sobrescreve um outcome ja existente nem marca BROKER_EXECUTED.

CREATE TABLE IF NOT EXISTS iq_agents_v4_observations (
  observation_id text PRIMARY KEY,
  candidate_id text,
  correlation_id text,
  market_key text NOT NULL,
  market_type text,
  account_context text,
  active_id bigint,
  direction text,
  final_action text,
  data_quality text,
  regime text,
  scenario text,
  target_entry_at bigint,
  target_expiry_at bigint,
  entry_price numeric,
  payout numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  settlement_basis text,
  theoretical_result text,
  theoretical_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_market_created ON iq_agents_v4_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_type_created ON iq_agents_v4_observations(market_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_account_created ON iq_agents_v4_observations(account_context, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_action_created ON iq_agents_v4_observations(final_action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_settlement ON iq_agents_v4_observations(settlement_basis);
CREATE INDEX IF NOT EXISTS idx_iq_agents_v4_pending ON iq_agents_v4_observations(market_key, target_expiry_at) WHERE settlement_basis IS NULL;
