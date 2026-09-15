const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = await c.query("SELECT asset_canonical AS asset, context_validation_status AS v, status AS s, COUNT(*)::int n, MAX(observed_at) AS last FROM price_observations WHERE observed_at > now() - interval '30 minutes' GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10");
  for (const x of r.rows) console.log(`${x.asset}|${x.v}|${x.s} n=${x.n} last=${x.last.toISOString()}`);
  const s = await c.query("SELECT session_id, MAX(observed_at) AS last FROM price_observations GROUP BY session_id ORDER BY last DESC LIMIT 3");
  for (const x of s.rows) console.log(`session ${x.session_id} last=${x.last.toISOString()}`);
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });