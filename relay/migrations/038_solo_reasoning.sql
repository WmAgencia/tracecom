-- 038: SOLO_REASONING_V1_SHADOW — observacoes prospectivas do controle de simplicidade (SHADOW ONLY).
CREATE TABLE IF NOT EXISTS iq_solo_reasoning_observations (
  id text PRIMARY KEY,
  candidate_id text,
  correlation_id text,
  market_key text,
  market_type text,
  account_context text,
  primary_scenario text,
  initial_action text,
  initial_direction text,
  thesis_survival text,
  refutation_strength text,
  final_action text,
  direction text,
  target_entry_at bigint,
  target_expiry_at bigint,
  payout numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  settlement_basis text,
  theoretical_result text,
  theoretical_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_solo_market ON iq_solo_reasoning_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_solo_scenario ON iq_solo_reasoning_observations(primary_scenario, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_solo_survival ON iq_solo_reasoning_observations(thesis_survival, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_solo_pending ON iq_solo_reasoning_observations(market_key, target_expiry_at) WHERE settlement_basis IS NULL;
