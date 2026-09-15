const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
function buildSeries(rows) { const map = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = map.get(b); if (!cc) map.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...map.values()].sort((a, b) => a.start - b.start); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function features(cd) {
  const m = cd.length; if (m < 31) return null;
  const closes = cd.map((x) => x.close), close = closes[m - 1];
  let g = 0, l = 0; for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mv = mean(rs), vol = Math.sqrt(mean(rs.map((x) => (x - mv) ** 2)));
  const w24 = cd.slice(m - 24); const hi = Math.max(...w24.map((x) => x.high)), lo = Math.min(...w24.map((x) => x.low));
  let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === hi && fh === -1) fh = j; if (w24[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh; const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const inZone = range > 0 && close <= zHi && close >= zLo;
  const atr = mean(cd.slice(m - 14).map((x) => x.high - x.low));
  const sma20 = mean(closes.slice(-20));
  return { s, vol, inZone, upSwing, close, atr, sma20 };
}
const fibOk = (f, dir) => f.inZone && (dir === "BUY" ? f.upSwing : !f.upSwing);
function v1fib(f) { const d = f.vol < .0009 && Math.abs(f.s) > .33 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
function atrfib(f, mult = 3) { const d = f.sma20 - f.close >= mult * f.atr ? "BUY" : f.close - f.sma20 >= mult * f.atr ? "SELL" : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
function decide(strategy, f) {
  if (!f) return "WAIT";
  switch (strategy) {
    case "v7and": { const a = atrfib(f), b = v1fib(f); return a !== "WAIT" && a === b ? a : "WAIT"; }
    case "v7or": { const a = atrfib(f), b = v1fib(f); if (a === "WAIT") return b; if (b === "WAIT") return a; return a === b ? a : "WAIT"; }
    case "v8": return atrfib(f, 1);
    case "v8all": { const d = f.close < f.sma20 ? "BUY" : f.close > f.sma20 ? "SELL" : "WAIT"; return d; }
    default: return "WAIT";
  }
}
const outcome = (side, entry, exit) => (exit === undefined || exit === null ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const STRATS = ["v7and", "v7or", "v8", "v8all"];
const NAMES = { v7and: "V7-AND (ATR+Fib ∩ V1+Fib)", v7or: "V7-OR (ATR+Fib ∪ V1+Fib)", v8: "V8 (ATR+Fib cobertura máx: dev≥1×ATR)", v8all: "V8-all (TODOS os candles: contra-SMA20)" };
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  const groups = new Map();
  for (const t of trades) groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const res = {}; for (const s of STRATS) res[s] = { buy: 0, sell: 0, wait: 0, w45: 0, l45: 0, d45: 0, w60: 0, l60: 0, d60: 0 };
  let evaluated = 0, skipped = 0;
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) { skipped += 1; continue; }
    const f = features(buildSeries(window));
    if (!f) { skipped += 1; continue; }
    evaluated += 1;
    const refT = Number(t.t0), entry = Number(t.reference_price);
    const e45 = all.find((o) => o.t >= refT + 45000 && o.t <= refT + 75000);
    const e60 = all.find((o) => o.t >= refT + 60000 && o.t <= refT + 90000);
    for (const s of STRATS) {
      const d = decide(s, f); const r = res[s];
      if (d === "BUY") r.buy += 1; else if (d === "SELL") r.sell += 1; else r.wait += 1;
      if (d !== "WAIT") {
        if (e45) { const o = outcome(d, entry, e45.v); if (o === "WIN") r.w45 += 1; else if (o === "LOSS") r.l45 += 1; else r.d45 += 1; }
        if (e60) { const o = outcome(d, entry, e60.v); if (o === "WIN") r.w60 += 1; else if (o === "LOSS") r.l60 += 1; else r.d60 += 1; }
      }
    }
  }
  console.log(`trades=${trades.length} snapshots=${keys.size} avaliados=${evaluated} skipped=${skipped}\n`);
  console.log("estratégia | BUY | SELL | WAIT | cobertura | T+45 W/L/D WR | T+60 W/L/D WR | Wilson T60");
  for (const s of STRATS) {
    const r = res[s]; const n45 = r.w45 + r.l45, n60 = r.w60 + r.l60;
    const cov = evaluated ? (((r.buy + r.sell) / evaluated) * 100).toFixed(1) : "-";
    console.log(`${NAMES[s]} | ${r.buy} | ${r.sell} | ${r.wait} | ${cov}% | ${r.w45}/${r.l45}/${r.d45} ${n45 ? ((r.w45 / n45) * 100).toFixed(1) : "-"}% | ${r.w60}/${r.l60}/${r.d60} ${n60 ? ((r.w60 / n60) * 100).toFixed(1) : "-"}% | ${wilson(r.w60, n60) ? wilson(r.w60, n60).join("..") : "-"}`);
  }
  require("fs").writeFileSync("C:/tracecom-forward4/consolidado-v7v8.json", JSON.stringify({ trades: trades.length, evaluated, skipped, res }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });