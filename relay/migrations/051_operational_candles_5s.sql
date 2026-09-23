-- 051: persistencia canonica dos candles nativos 5s (IQ candle-generated) para
-- hydration cross-restart do AssetPipeline. Somente candles fechados, chave
-- unica por ativo + intervalo + timestamp. Retencao controlada pelo runtime
-- (CandleStore.prune) — nunca guarda 3h de candles dentro de snapshots/trades.
CREATE TABLE IF NOT EXISTS iq_candles_5s (
  market_key text NOT NULL,
  interval_ms integer NOT NULL DEFAULT 5000,
  at bigint NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  source text NOT NULL DEFAULT 'IQ_NATIVE_5S',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_key, interval_ms, at)
);

CREATE INDEX IF NOT EXISTS iq_candles_5s_at_idx ON iq_candles_5s (at);
