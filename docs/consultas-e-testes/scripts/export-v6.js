const { Client } = require("pg");
const fs = require("fs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const OUT = process.env.OUT_PATH || "v6-trades.csv";
(async () => {
  await c.connect();
  const r = await c.query("SELECT trade_id, strategy_version, asset_canonical, decision, confidence, reference_timestamp, settlement_target_at, settlement_observed_at, result, created_at FROM shadow_trades WHERE strategy_version LIKE 'shadow-reversion-v6' ORDER BY reference_timestamp ASC");
  const lines = ["trade_id,strategy_version,asset,decision,confidence,reference_timestamp_iso,settlement_target_iso,settlement_observed_iso,result,created_iso"];
  for (const x of r.rows) {
    const iso = (v) => (v === null || v === undefined ? "" : new Date(Number(v)).toISOString());
    lines.push([x.trade_id, x.strategy_version, x.asset_canonical, x.decision, x.confidence, iso(x.reference_timestamp), iso(x.settlement_target_at), iso(x.settlement_observed_at), x.result ?? "PENDING", iso(x.created_at)].join(","));
  }
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`wrote ${r.rows.length} rows to ${OUT}`);
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });