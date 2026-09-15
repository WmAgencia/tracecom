const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = await c.query("SELECT COUNT(*)::int n, MAX(observed_at) AS last FROM price_observations WHERE asset_canonical='EUR/NZD' AND status='ACCEPTED' AND observed_at > now() - interval '5 minutes'");
  console.log(`eurNZD_last5min n=${r.rows[0].n} last=${r.rows[0].last.toISOString()}`);
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });