const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = (await c.query("SELECT frozen_strategy_versions::text AS f FROM shadow_experiments ORDER BY created_at ASC LIMIT 1")).rows[0];
  console.log("FROZEN_JSON " + r.f);
  try { const arr = JSON.parse(r.f); for (const x of arr) console.log("finalist " + x.strategyVersion + " n=" + x.n + " wilson=" + (x.wilson !== null && x.wilson !== undefined ? x.wilson : "null")); } catch (e) { console.log("parse err " + e.message); }
  const per = (await c.query("SELECT strategy_version, COUNT(*)::int n, COUNT(*) FILTER (WHERE result='WIN')::int w, COUNT(*) FILTER (WHERE result='LOSS')::int l FROM shadow_trades WHERE experiment_id=(SELECT experiment_id FROM shadow_experiments ORDER BY created_at ASC LIMIT 1) AND phase='DISCOVERY' GROUP BY strategy_version ORDER BY n DESC")).rows;
  for (const x of per) { const wr = x.w + x.l ? +((x.w / (x.w + x.l)) * 100).toFixed(1) : null; console.log(`discovery ${x.strategy_version.replace("shadow-", "")} n=${x.n} W=${x.w} L=${x.l} wr=${wr}`); }
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });