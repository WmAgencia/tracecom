const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await c.connect();
  const run = (await c.query("SELECT * FROM fwd_event_runs ORDER BY started_at DESC LIMIT 1")).rows[0];
  console.log(`monitor start: run=${run.run_id} cohort=${new Date(Number(run.start_ms)).toISOString()}`);
  let lastCp = 0;
  for (let i = 0; i < 120; i++) {
    const t = await c.query("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE price_t60 IS NOT NULL AND price_t45 IS NOT NULL)::int resolved FROM fwd_events WHERE run_id=$1", [run.run_id]);
    const obs = await c.query("SELECT COUNT(*)::int n, MAX(observed_at) AS last FROM price_observations WHERE asset_canonical='AUD/CAD' AND context_validation_status='VALID' AND status='ACCEPTED' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $1", [Number(run.start_ms)]);
    const total = t.rows[0].total, resolved = t.rows[0].resolved;
    const age = obs.rows[0].last ? ((Date.now() - obs.rows[0].last.getTime()) / 1000).toFixed(0) : "-";
    console.log(`[${new Date().toISOString().slice(11, 19)}] total=${total} resolved=${resolved}/100 obs=${obs.rows[0].n} streamAge=${age}s`);
    const cp = Math.floor(resolved / 10) * 10;
    if (cp > lastCp && cp > 0) { lastCp = cp; console.log(`*** CHECKPOINT ${cp}/100 eventos resolvidos ***`); }
    if (resolved >= 100) { console.log("*** COLETA COMPLETA: 100/100 ***"); break; }
    await sleep(60000);
  }
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });