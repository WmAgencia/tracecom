const { Client } = require("pg");
const url = process.env.DATABASE_URL;
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const wilsonLow = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return +(Math.max(0, cc - h)).toFixed(3); };
(async () => {
  await c.connect();
  const now = Date.now();
  const r = (await c.query("SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE result='WIN')::int w, COUNT(*) FILTER (WHERE result='LOSS')::int l, COUNT(*) FILTER (WHERE result='DRAW')::int d, COUNT(*) FILTER (WHERE result='UNKNOWN')::int u, COUNT(*) FILTER (WHERE result IS NULL)::int p, MAX(created_at) AS last FROM shadow_trades WHERE strategy_version='shadow-reversion-v6' AND asset_canonical='EUR/NZD'")).rows[0];
  const h1 = (await c.query("SELECT COUNT(*)::int n FROM shadow_trades WHERE strategy_version='shadow-reversion-v6' AND asset_canonical='EUR/NZD' AND created_at > $1", [now - 3600000])).rows[0].n;
  const settled = r.w + r.l;
  const wr = settled ? +((r.w / settled) * 100).toFixed(1) : null;
  const lastTs = Number(r.last) > 1e12 ? new Date(Number(r.last)).toISOString() : String(r.last);
  const remaining = Math.max(0, 100 - r.n);
  const etaH = h1 > 0 ? +(remaining / h1).toFixed(2) : null;
  console.log(JSON.stringify({ progress: `${r.n}/100`, W: r.w, L: r.l, D: r.d, U: r.u, P: r.p, WR: wr, CI95low: wilsonLow(r.w, settled), lastCreated: lastTs, createdLastHour: h1, remaining, etaHours: etaH, time: new Date(now).toISOString() }));
  await c.end();
})().catch((e) => { console.error("MON_ERR", e && e.message); process.exit(1); });