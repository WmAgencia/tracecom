-- 040: INDICATOR_5M_V1 — control group de baixa complexidade (RSI/DMI-ADX/Bollinger) + observacoes.
CREATE TABLE IF NOT EXISTS iq_indicator_5m_observations (
  id text PRIMARY KEY,
  market_key text,
  market_type text,
  direction text,
  final_action text,
  status text,
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
CREATE INDEX IF NOT EXISTS idx_iq_ind5m_market ON iq_indicator_5m_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_ind5m_pending ON iq_indicator_5m_observations(market_key, target_expiry_at) WHERE settlement_basis IS NULL;
