const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
function buildSeries(rows) { const map = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = map.get(b); if (!cc) map.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...map.values()].sort((a, b) => a.start - b.start); }
function featuresOf(candles) {
  const n = candles.length;
  if (n < 31) return null;
  const closes = candles.map((x) => x.close), m = closes.length;
  let g = 0, l = 0;
  for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const vol = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  const mom120 = (closes[m - 1] - closes[m - 25]) / closes[m - 25];
  const w = candles.slice(m - 24);
  const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
  let fh = -1, fl = -1;
  for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh;
  const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const close = closes[m - 1];
  const inZone = range > 0 && close <= zHi && close >= zLo;
  return { s, vol, mom120, inZone, upSwing };
}
function decide(variant, f) {
  if (!f) return "WAIT";
  const fibOk = f.inZone && ((f.s > 0 && f.upSwing) || (f.s < 0 && !f.upSwing));
  switch (variant) {
    case "V1": return f.vol < .0009 && Math.abs(f.s) > .33 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V1+fib": return f.vol < .0009 && Math.abs(f.s) > .33 && fibOk ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V3": return f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V3+fib": return f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) && fibOk ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V6": { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; return f.vol < .0009 && deep ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; }
    case "V6+fib": { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; return f.vol < .0009 && deep && fibOk ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; }
    default: return "WAIT";
  }
}
const outcome = (side, entry, exit) => (exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const VARIANTS = ["V1", "V1+fib", "V3", "V3+fib", "V6", "V6+fib"];
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price, settlement_price FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  const groups = new Map();
  for (const t of trades) groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const results = {}; for (const v of VARIANTS) results[v] = { buy: 0, sell: 0, wait: 0, w: 0, l: 0, d: 0, u: 0 };
  let evaluated = 0, skipped = 0, noOutcome = 0;
  for (const [k, list] of keys) {
    const t = list[0]; const gk = `${t.session_id}|${t.segment_id ?? "none"}`;
    const all = obsCache.get(gk) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) { skipped += 1; continue; }
    const f = featuresOf(buildSeries(window));
    if (!f) { skipped += 1; continue; }
    evaluated += 1;
    const entry = t.reference_price !== null ? Number(t.reference_price) : null;
    const exit = t.settlement_price !== null ? Number(t.settlement_price) : null;
    if (entry === null || exit === null) noOutcome += 1;
    for (const v of VARIANTS) {
      const dec = decide(v, f);
      const r = results[v];
      if (dec === "BUY") r.buy += 1; else if (dec === "SELL") r.sell += 1; else r.wait += 1;
      if (dec !== "WAIT") {
        if (entry === null || exit === null) r.u += 1;
        else { const o = outcome(dec, entry, exit); if (o === "WIN") r.w += 1; else if (o === "LOSS") r.l += 1; else r.d += 1; }
      }
    }
  }
  console.log(`snapshots avaliados=${evaluated} skipped=${skipped} (sem preço p/ outcome=${noOutcome})`);
  console.log("variant | BUY | SELL | WAIT | W | L | D | U | dirN | WR | Wilson");
  for (const v of VARIANTS) {
    const r = results[v]; const dirN = r.w + r.l;
    console.log(`${v} | ${r.buy} | ${r.sell} | ${r.wait} | ${r.w} | ${r.l} | ${r.d} | ${r.u} | ${dirN} | ${dirN ? ((r.w / dirN) * 100).toFixed(1) : "-"}% | ${wilson(r.w, dirN) ? wilson(r.w, dirN).join("..") : "-"}`);
  }
  require("fs").writeFileSync("C:/tracecom-forward4/redo-6variants.json", JSON.stringify({ evaluated, skipped, noOutcome, results }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });