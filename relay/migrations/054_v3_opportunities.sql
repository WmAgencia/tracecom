-- 054: V3 expiration-driven (observabilidade e log completo; nenhum segredo).
-- opportunities: uma por (market_key, expiration_at); cycles: um por candle fechado;
-- offers: expirations reais oferecidas pela IQ (initialization-data.option.expiration_times).
CREATE TABLE IF NOT EXISTS iq_v3_opportunities (
  opportunity_id text PRIMARY KEY,
  strategy_version text,
  strategy_hash text,
  market_key text NOT NULL,
  active_id integer,
  expiration_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL,
  first_seen_tte_ms integer,
  target_send_at timestamptz,
  hard_cutoff_at timestamptz,
  purchase_deadline_at timestamptz,
  payout numeric,
  buyability boolean,
  status text NOT NULL,
  final_decision jsonb,
  execution_ref jsonb,
  cycles_count integer NOT NULL DEFAULT 0,
  snapshot_hash text,
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iq_v3_opportunities_market_idx ON iq_v3_opportunities (market_key, expiration_at DESC);
CREATE INDEX IF NOT EXISTS iq_v3_opportunities_status_idx ON iq_v3_opportunities (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS iq_v3_cycles (
  id serial PRIMARY KEY,
  opportunity_id text NOT NULL REFERENCES iq_v3_opportunities(opportunity_id) ON DELETE CASCADE,
  cycle_number integer NOT NULL,
  at timestamptz NOT NULL,
  tte_ms integer,
  closed_candle_id text,
  price numeric,
  feature_snapshot_id text,
  asset_scenario text,
  asset_state text,
  consensus_result text,
  agreement text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS iq_v3_expiration_offers (
  market_key text NOT NULL,
  expiration_at timestamptz NOT NULL,
  active_id integer,
  first_seen_at timestamptz NOT NULL,
  first_seen_tte_ms integer,
  deadtime_ms integer,
  payout numeric,
  buyable boolean,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_key, expiration_at)
);
COMMENT ON TABLE iq_v3_opportunities IS 'V3 expiration-driven: oportunidade criada pela expiration REAL da IQ (~TTE 330s); observe-only.';
COMMENT ON TABLE iq_v3_cycles IS 'V3 multi-cycle: um ciclo por candle fechado com specialists/Asset/Consensus.';
COMMENT ON TABLE iq_v3_expiration_offers IS 'V3 discovery read-only das expirations oferecidas pela IQ (protocolo real).';
