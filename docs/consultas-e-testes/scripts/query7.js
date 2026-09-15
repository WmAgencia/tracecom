const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const byAsset = await c.query("SELECT asset_canonical AS asset, COUNT(*)::int n, COUNT(*) FILTER (WHERE result='WIN')::int w, COUNT(*) FILTER (WHERE result='LOSS')::int l, MAX(created_at) AS last FROM shadow_trades WHERE strategy_version='shadow-reversion-v6' GROUP BY 1 ORDER BY n DESC");
  for (const x of byAsset.rows) console.log(`v6 ${x.asset} n=${x.n} W=${x.w} L=${x.l} last=${new Date(Number(x.last)).toISOString()}`);
  const recent = await c.query("SELECT created_at, decision, result, asset_canonical, confidence FROM shadow_trades WHERE strategy_version='shadow-reversion-v6' ORDER BY created_at DESC LIMIT 8");
  for (const x of recent.rows) console.log(`recent v6: ${new Date(Number(x.created_at)).toISOString()} ${x.decision} ${x.result} ${x.asset_canonical} conf=${x.confidence}`);
  const today = await c.query("SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE result='WIN')::int w, COUNT(*) FILTER (WHERE result='LOSS')::int l FROM shadow_trades WHERE strategy_version='shadow-reversion-v6' AND created_at > $1", [Date.now() - 6 * 3600000]);
  console.log(`v6 last 6h: n=${today.rows[0].n} W=${today.rows[0].w} L=${today.rows[0].l}`);
  const exp = await c.query("SELECT target_asset, phase, valid_settled_trades, status FROM shadow_experiments ORDER BY created_at ASC LIMIT 1");
  console.log(`exp: ${exp.rows[0].target_asset} ${exp.rows[0].phase} valid=${exp.rows[0].valid_settled_trades} status=${exp.rows[0].status}`);
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });