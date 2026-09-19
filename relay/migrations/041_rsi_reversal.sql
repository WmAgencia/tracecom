-- 041: RSI_REVERSAL_CONFLUENCE_V1 — experimento separado (PRACTICE, cap 30 broker-accepted, janela T-5s).
CREATE TABLE IF NOT EXISTS iq_rsi_reversal_observations (
  id text PRIMARY KEY,
  experiment_id text NOT NULL DEFAULT 'RSI_REVERSAL_CONFLUENCE_V1',
  market_key text,
  market_type text,
  active_id bigint,
  status text,
  direction text,
  rsi numeric,
  rsi_band text,
  bollinger_confirmed boolean,
  dmi_adx_confirmed boolean,
  rejected_strong_trend boolean,
  target_expiry_at bigint,
  purchase_cutoff_at bigint,
  entry_window_opens_at bigint,
  safe_margin_ms integer,
  revalidation_at bigint,
  submit_at bigint,
  distance_to_cutoff_ms integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  settlement_basis text,
  theoretical_result text,
  theoretical_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_market ON iq_rsi_reversal_observations(market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_pending ON iq_rsi_reversal_observations(market_key, target_expiry_at) WHERE settlement_basis IS NULL;
