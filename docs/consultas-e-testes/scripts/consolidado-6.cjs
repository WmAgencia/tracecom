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
  const mom120 = (close - closes[m - 25]) / closes[m - 25];
  const w24 = cd.slice(m - 24); const hi = Math.max(...w24.map((x) => x.high)), lo = Math.min(...w24.map((x) => x.low));
  let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === hi && fh === -1) fh = j; if (w24[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh; const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const inZone = range > 0 && close <= zHi && close >= zLo;
  const atr = mean(cd.slice(m - 14).map((x) => x.high - x.low));
  const sma20 = mean(closes.slice(-20));
  let er = null; { let net = 0, sum = 0; for (let j = m - 30; j < m; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } er = sum > 0 ? Math.abs(net) / sum : null; }
  return { s, vol, mom120, inZone, upSwing, close, atr, sma20, er };
}
const fibOk = (f, dir) => f.inZone && (dir === "BUY" ? f.upSwing : !f.upSwing);
function decide(strategy, f) {
  if (!f) return "WAIT";
  switch (strategy) {
    case "v1fib": { const d = f.vol < .0009 && Math.abs(f.s) > .33 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "v2fib": { const d = f.vol < .0012 && Math.abs(f.s) > .22 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "v3fib": { const d = f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "v6fib": { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; const d = f.vol < .0009 && deep ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "atrfib": { const dev = f.close - f.sma20; const d = f.sma20 - f.close >= 3 * f.atr ? "BUY" : f.close - f.sma20 >= 3 * f.atr ? "SELL" : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "regime": { const v3 = f.vol < .0012 && ((f.s > .22 && f.mom120 > 0 && f.upSwing) || (f.s < -.22 && f.mom120 < 0 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; const ok = v3 !== "WAIT" && f.inZone; return ok && f.er !== null && f.er < 0.35 ? v3 : "WAIT"; }
    default: return "WAIT";
  }
}
const outcome = (side, entry, exit) => (exit === undefined || exit === null ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const STRATS = ["v1fib", "v2fib", "v3fib", "v6fib", "atrfib", "regime"];
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  console.log(`trades guardados carregados: ${trades.length}`);
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  console.log(`snapshots únicos: ${keys.size}`);
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
  const NAMES = { v1fib: "V1+Fib (BALANCEADO)", v2fib: "V2+Fib (AGRESSIVO)", v3fib: "V3+Fib (AGRESSIVO)", v6fib: "V6+Fib (CONSERVADOR)", atrfib: "ATR-Overshoot+Fib (EXPERIMENTAL)", regime: "Regime-Reversion (EXPERIMENTAL)" };
  console.log(`avaliados=${evaluated} skipped=${skipped}\n`);
  console.log("estratégia | BUY | SELL | WAIT | T+45 W/L/D WR | T+60 W/L/D WR | Wilson T60");
  for (const s of STRATS) {
    const r = res[s]; const n45 = r.w45 + r.l45, n60 = r.w60 + r.l60;
    console.log(`${NAMES[s]} | ${r.buy} | ${r.sell} | ${r.wait} | ${r.w45}/${r.l45}/${r.d45} ${n45 ? ((r.w45 / n45) * 100).toFixed(1) : "-"}% | ${r.w60}/${r.l60}/${r.d60} ${n60 ? ((r.w60 / n60) * 100).toFixed(1) : "-"}% | ${wilson(r.w60, n60) ? wilson(r.w60, n60).join("..") : "-"}`);
  }
  require("fs").writeFileSync("C:/tracecom-forward4/consolidado-6.json", JSON.stringify({ trades: trades.length, snapshots: keys.size, evaluated, skipped, res }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });