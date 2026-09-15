const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
function buildSeries(rows) { const map = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = map.get(b); if (!cc) map.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...map.values()].sort((a, b) => a.start - b.start); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function features2(candles) {
  const m = candles.length; if (m < 31) return null;
  const closes = candles.map((x) => x.close);
  let g = 0, l = 0;
  for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mv = mean(rs); const vol = Math.sqrt(mean(rs.map((x) => (x - mv) ** 2)));
  const mom120 = (closes[m - 1] - closes[m - 25]) / closes[m - 25];
  const w = candles.slice(m - 24);
  const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
  let fh = -1, fl = -1;
  for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh;
  const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const close = closes[m - 1];
  const inZone = range > 0 && close <= zHi && close >= zLo;
  // Bollinger 20/2 + z-score
  const w20 = closes.slice(-20); const sma20 = mean(w20);
  const sd20 = Math.sqrt(mean(w20.map((x) => (x - sma20) ** 2)));
  const upper = sma20 + 2 * sd20, lower = sma20 - 2 * sd20;
  const z = sd20 > 0 ? (close - sma20) / sd20 : 0;
  const percB = (upper - lower) > 0 ? (close - lower) / (upper - lower) : .5;
  // RSI(2)
  let g2 = 0, l2 = 0;
  for (let i = m - 2; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g2 += d; else l2 -= d; }
  const rsi2 = l2 === 0 ? 100 : 100 - 100 / (1 + g2 / l2);
  // EMAs
  const ema9 = m >= 9 ? (() => { const a = 2 / 10; let e = mean(closes.slice(0, 9)); for (let i = 9; i < m; i++) e = closes[i] * a + e * (1 - a); return e; })() : null;
  const ema21 = m >= 21 ? (() => { const a = 2 / 22; let e = mean(closes.slice(0, 21)); for (let i = 21; i < m; i++) e = closes[i] * a + e * (1 - a); return e; })() : null;
  // prior Donchian 20 (excl current) e swing 24 (excl current)
  const pd = candles.slice(m - 21, m - 1);
  const priorHi20 = Math.max(...pd.map((x) => x.high)), priorLo20 = Math.min(...pd.map((x) => x.low));
  const sw = candles.slice(m - 25, m - 1);
  const swHi = Math.max(...sw.map((x) => x.high)), swLo = Math.min(...sw.map((x) => x.low));
  const cur = candles[m - 1], prev = candles[m - 2];
  return { s, vol, mom120, inZone, upSwing, rsi, rsi2, z, percB, upper, lower, sma20, ema9, ema21, priorHi20, priorLo20, swHi, swLo, cur, prev, close };
}
function fibOk(f, dir) { return f.inZone && (dir === "BUY" ? f.upSwing : !f.upSwing); }
function decide(variant, f) {
  if (!f) return "WAIT";
  switch (variant) {
    case "V1": return f.vol < .0009 && Math.abs(f.s) > .33 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V1+fib": return f.vol < .0009 && Math.abs(f.s) > .33 && fibOk(f, f.s > 0 ? "BUY" : "SELL") ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V2": return f.vol < .0012 && Math.abs(f.s) > .22 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V2+fib": return f.vol < .0012 && Math.abs(f.s) > .22 && fibOk(f, f.s > 0 ? "BUY" : "SELL") ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V3": return f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V3+fib": return f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) && fibOk(f, f.s > 0 ? "BUY" : "SELL") ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
    case "V6": { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; return f.vol < .0009 && deep ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; }
    case "V6+fib": { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; return f.vol < .0009 && deep && fibOk(f, f.s > 0 ? "BUY" : "SELL") ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; }
    // ==== 6 novas técnicas ====
    case "Bollinger%B+RSI": return f.prev.close <= f.lower && f.close > f.lower && f.rsi < 35 ? "BUY" : f.prev.close >= f.upper && f.close < f.upper && f.rsi > 65 ? "SELL" : "WAIT";
    case "Bollinger%B+RSI+fib": { const d = decide("Bollinger%B+RSI", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "Bollinger-Z": return f.z <= -2 ? "BUY" : f.z >= 2 ? "SELL" : "WAIT";
    case "Bollinger-Z+fib": { const d = decide("Bollinger-Z", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "RSI2-Connors": return f.rsi2 < 10 && f.ema21 !== null && f.close > f.ema21 ? "BUY" : f.rsi2 > 90 && f.ema21 !== null && f.close < f.ema21 ? "SELL" : "WAIT";
    case "RSI2-Connors+fib": { const d = decide("RSI2-Connors", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "Turtle-Soup": return f.cur.low < f.priorLo20 && f.close > f.priorLo20 ? "BUY" : f.cur.high > f.priorHi20 && f.close < f.priorHi20 ? "SELL" : "WAIT";
    case "Turtle-Soup+fib": { const d = decide("Turtle-Soup", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "Liquidity-Sweep": return f.cur.low < f.swLo && f.close > f.swLo ? "BUY" : f.cur.high > f.swHi && f.close < f.swHi ? "SELL" : "WAIT";
    case "Liquidity-Sweep+fib": { const d = decide("Liquidity-Sweep", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    case "EMA-Pullback": return f.ema9 !== null && f.ema21 !== null && f.ema9 > f.ema21 && f.close > f.ema21 && f.cur.low <= f.ema21 * 1.0003 && f.close > f.cur.open ? "BUY" : f.ema9 !== null && f.ema21 !== null && f.ema9 < f.ema21 && f.close < f.ema21 && f.cur.high >= f.ema21 * (1 - 0.0003) && f.close < f.cur.open ? "SELL" : "WAIT";
    case "EMA-Pullback+fib": { const d = decide("EMA-Pullback", f); return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; }
    default: return "WAIT";
  }
}
const outcome = (side, entry, exit) => (exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const VARIANTS = ["V1", "V1+fib", "V2", "V2+fib", "V3", "V3+fib", "V6", "V6+fib", "Bollinger%B+RSI", "Bollinger%B+RSI+fib", "Bollinger-Z", "Bollinger-Z+fib", "RSI2-Connors", "RSI2-Connors+fib", "Turtle-Soup", "Turtle-Soup+fib", "Liquidity-Sweep", "Liquidity-Sweep+fib", "EMA-Pullback", "EMA-Pullback+fib"];
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
  let evaluated = 0, skipped = 0;
  for (const [k, list] of keys) {
    const t = list[0];
    const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) { skipped += 1; continue; }
    const f = features2(buildSeries(window));
    if (!f) { skipped += 1; continue; }
    evaluated += 1;
    const entry = t.reference_price !== null ? Number(t.reference_price) : null;
    const exit = t.settlement_price !== null ? Number(t.settlement_price) : null;
    for (const v of VARIANTS) {
      const dec = decide(v, f); const r = results[v];
      if (dec === "BUY") r.buy += 1; else if (dec === "SELL") r.sell += 1; else r.wait += 1;
      if (dec !== "WAIT") { if (entry === null || exit === null) r.u += 1; else { const o = outcome(dec, entry, exit); if (o === "WIN") r.w += 1; else if (o === "LOSS") r.l += 1; else r.d += 1; } }
    }
  }
  console.log(`avaliados=${evaluated} skipped=${skipped}`);
  console.log("variant | BUY | SELL | WAIT | W | L | D | U | dirN | WR | Wilson");
  for (const v of VARIANTS) { const r = results[v]; const dirN = r.w + r.l; console.log(`${v} | ${r.buy} | ${r.sell} | ${r.wait} | ${r.w} | ${r.l} | ${r.d} | ${r.u} | ${dirN} | ${dirN ? ((r.w / dirN) * 100).toFixed(1) : "-"}% | ${wilson(r.w, dirN) ? wilson(r.w, dirN).join("..") : "-"}`); }
  require("fs").writeFileSync("C:/tracecom-forward4/redo-6novas.json", JSON.stringify({ evaluated, skipped, results }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });