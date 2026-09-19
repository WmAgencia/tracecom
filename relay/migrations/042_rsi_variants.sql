-- 042: RSI_STRICT_PULLBACK_2X2_V1 — comparativo direto STRICT vs PULLBACK (PRACTICE, 10 OTCs, 2 trades cada).
CREATE TABLE IF NOT EXISTS iq_rsi_variant_observations (
  id text PRIMARY KEY,
  experiment_id text NOT NULL DEFAULT 'RSI_STRICT_PULLBACK_2X2_V1',
  variant text NOT NULL,
  market_key text,
  market_type text,
  active_id bigint,
  status text,
  direction text,
  rsi numeric,
  rsi_band text,
  bollinger_confirmed boolean,
  dmi_confirmed boolean,
  band_riding boolean,
  strong_accel boolean,
  target_expiry_at bigint,
  purchase_cutoff_at bigint,
  safe_margin_ms integer,
  distance_to_cutoff_ms integer,
  rejection_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  settlement_basis text,
  theoretical_result text,
  theoretical_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_variants_market ON iq_rsi_variant_observations(variant, market_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_rsi_variants_pending ON iq_rsi_variant_observations(variant, market_key, target_expiry_at) WHERE settlement_basis IS NULL;
