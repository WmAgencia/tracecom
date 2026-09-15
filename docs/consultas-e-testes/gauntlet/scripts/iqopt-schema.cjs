const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SQL = [
  `CREATE TABLE IF NOT EXISTS iqopt_datasets (
    dataset_id text PRIMARY KEY,
    instrument text NOT NULL,
    contract_type text NOT NULL,
    otc boolean NOT NULL DEFAULT false,
    source text NOT NULL DEFAULT 'IQ_OPTION',
    status text NOT NULL DEFAULT 'COLLECTING',
    window_from timestamptz,
    window_to timestamptz,
    provenance jsonb,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS iqopt_raw_ticks (
    id bigserial PRIMARY KEY,
    dataset_id text NOT NULL,
    source text NOT NULL DEFAULT 'IQ_OPTION',
    instrument text NOT NULL,
    contract_type text NOT NULL,
    otc boolean NOT NULL,
    ts timestamptz NOT NULL,
    bid double precision,
    ask double precision,
    mid double precision,
    raw_price double precision,
    source_timestamp timestamptz,
    received_at timestamptz,
    ingested_at timestamptz DEFAULT now(),
    provenance jsonb,
    raw jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS iqopt_raw_ticks_ds_ts ON iqopt_raw_ticks (dataset_id, ts)`,
  `CREATE TABLE IF NOT EXISTS iqopt_candles_5s (
    dataset_id text NOT NULL,
    bucket timestamptz NOT NULL,
    open double precision, high double precision, low double precision, close double precision,
    tick_count int NOT NULL,
    gap boolean NOT NULL DEFAULT false,
    mid_close double precision,
    PRIMARY KEY (dataset_id, bucket)
  )`,
  `CREATE TABLE IF NOT EXISTS iqopt_decisions (
    id bigserial PRIMARY KEY,
    dataset_id text NOT NULL,
    strategy_id text NOT NULL,
    t0_ms bigint NOT NULL,
    entry_price double precision,
    decision text NOT NULL,
    result text,
    buy_side text, sell_side text,
    features_snapshot jsonb,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS iqopt_decisions_ds_strategy ON iqopt_decisions (dataset_id, strategy_id)`,
];
(async () => {
  await c.connect();
  for (const s of SQL) { await c.query(s); console.log("OK: " + s.split("\n")[0].slice(0, 60)); }
  const t = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'iqopt%' ORDER BY 1`)).rows.map((r) => r.tablename);
  console.log("tabelas iqopt_*: " + t.join(", "));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });
