const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
function buildSeries(rows) { const map = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = map.get(b); if (!cc) map.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...map.values()].sort((a, b) => a.start - b.start); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function cciAt(cd, end, p = 14) { if (end < p) return null; const w = cd.slice(end - p + 1, end + 1); const tp = w.map((x) => (x.high + x.low + x.close) / 3); const sma = mean(tp); const md = mean(tp.map((x) => Math.abs(x - sma))); return md === 0 ? 0 : (tp[tp.length - 1] - sma) / (0.015 * md); }
function willrAt(cd, end, p = 14) { if (end < p) return null; const w = cd.slice(end - p + 1, end + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? -50 : ((hh - cd[end].close) / (hh - ll)) * -100; }
function rsiAtC(cd, end, p = 14) { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = cd[i].close - cd[i - 1].close; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function features3(cd) {
  const m = cd.length; if (m < 31) return null;
  const closes = cd.map((x) => x.close), close = closes[m - 1], cur = cd[m - 1], prev = cd[m - 2];
  const rsi = rsiAtC(cd, m - 1); const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mv = mean(rs), vol = Math.sqrt(mean(rs.map((x) => (x - mv) ** 2)));
  const mom30 = (close - closes[m - 7]) / closes[m - 7];
  const mom120 = (close - closes[m - 25]) / closes[m - 25];
  const w24 = cd.slice(m - 24); const hi = Math.max(...w24.map((x) => x.high)), lo = Math.min(...w24.map((x) => x.low));
  let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === hi && fh === -1) fh = j; if (w24[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh; const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const inZone = range > 0 && close <= zHi && close >= zLo;
  const atr = mean(cd.slice(m - 14).map((x) => x.high - x.low));
  const w20 = closes.slice(-20); const sma20 = mean(w20); const ema20 = (() => { const a = 2 / 21; let e = mean(closes.slice(0, 20)); for (let i = 20; i < m; i++) e = closes[i] * a + e * (1 - a); return e; })();
  const keltUpper = ema20 + 2 * atr, keltLower = ema20 - 2 * atr;
  const rnd = Math.round(close / 0.005) * 0.005;
  const ws = []; for (let k = 0; k < 8; k++) { const r = willrAt(cd, m - 1 - k); if (r !== null) ws.push(r); }
  const cci = cciAt(cd, m - 1), cciPrev = cciAt(cd, m - 2);
  const sw = cd.slice(m - 25, m - 1); const swHi = Math.max(...sw.map((x) => x.high)), swLo = Math.min(...sw.map((x) => x.low));
  const p20 = cd.slice(m - 21, m - 1); const lows20 = p20.map((x) => x.low), highs20 = p20.map((x) => x.high);
  let pl = 0, ph = 0; for (let j = 1; j < lows20.length; j++) { if (lows20[j] <= lows20[pl]) pl = j; if (highs20[j] >= highs20[ph]) ph = j; }
  const plIdx = m - 21 + pl, phIdx = m - 21 + ph;
  const p14 = cd.slice(m - 15, m - 1); const lows14 = p14.map((x) => x.low), highs14 = p14.map((x) => x.high);
  let l14 = 0, h14 = 0; for (let j = 1; j < lows14.length; j++) { if (lows14[j] <= lows14[l14]) l14 = j; if (highs14[j] >= highs14[h14]) h14 = j; }
  const l14Idx = m - 15 + l14, h14Idx = m - 15 + h14;
  const d1 = closes[m - 1] - closes[m - 2], d2 = closes[m - 2] - closes[m - 3], d3 = closes[m - 3] - closes[m - 4];
  let er = null; { let net = 0, sum = 0; for (let j = m - 30; j < m; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } er = sum > 0 ? Math.abs(net) / sum : null; }
  return { s, vol, mom30, mom120, inZone, upSwing, rsi, close, cur, prev, atr, sma20, keltUpper, keltLower, rnd, ws, cci, cciPrev, swHi, swLo, lows20, highs20, plIdx, phIdx, l14Idx, h14Idx, cd, m, d1, d2, d3, er };
}
function fibOk(f, dir) { return f.inZone && (dir === "BUY" ? f.upSwing : !f.upSwing); }
function decide10(variant, f) {
  if (!f) return "WAIT";
  switch (variant) {
    case "WR-Failure": { const W = f.ws; if (W.length < 4) return "WAIT"; const wPrev = W[1], wNow = W[0]; if (wPrev <= -80 && wNow > -80 && wNow > wPrev) { const earlier = W.slice(2).filter((x) => x <= -80); if (earlier.length && wPrev > Math.min(...earlier)) return "BUY"; } if (wPrev >= -20 && wNow < -20 && wNow < wPrev) { const earlier = W.slice(2).filter((x) => x >= -20); if (earlier.length && wPrev < Math.max(...earlier)) return "SELL"; } return "WAIT"; }
    case "CCI-Divergence": { const cciL = cciAt(f.cd, f.l14Idx); if (f.cur.low < f.lows20[f.plIdx - (f.m - 21)] ?? false) { } const priorLow = f.lows20[f.plIdx - (f.m - 21)]; const priorHigh = f.highs20[f.phIdx - (f.m - 21)]; if (f.cur.low < priorLow && cciL !== null && f.cci > cciL + 5) return "BUY"; const cciH = cciAt(f.cd, f.h14Idx); if (f.cur.high > priorHigh && cciH !== null && f.cci < cciH - 5) return "SELL"; return "WAIT"; }
    case "Keltner-Reentry": return f.prev.close < f.keltLower && f.close > f.keltLower ? "BUY" : f.prev.close > f.keltUpper && f.close < f.keltUpper ? "SELL" : "WAIT";
    case "Round-Reject": return f.cur.low <= f.rnd && f.close > f.rnd && f.prev.close > f.rnd ? "BUY" : f.cur.high >= f.rnd && f.close < f.rnd && f.prev.close < f.rnd ? "SELL" : "WAIT";
    case "Swing-Failure": return f.cur.low < f.swLo && f.close > f.swLo && f.close - f.swLo >= 0.15 * f.atr ? "BUY" : f.cur.high > f.swHi && f.close < f.swHi && f.swHi - f.close >= 0.15 * f.atr ? "SELL" : "WAIT";
    case "Double-Exhaustion": { const rsiPl = rsiAtC(f.cd, f.plIdx); const priorLow = f.lows20[f.plIdx - (f.m - 21)]; if (f.cur.low < priorLow && rsiPl !== null && f.rsi > rsiPl + 2) return "BUY"; const rsiPh = rsiAtC(f.cd, f.phIdx); const priorHigh = f.highs20[f.phIdx - (f.m - 21)]; if (f.cur.high > priorHigh && rsiPh !== null && f.rsi < rsiPh - 2) return "SELL"; return "WAIT"; }
    case "Velocity-Decel": return f.d1 < 0 && f.d2 < 0 && f.d3 < 0 && Math.abs(f.d1) < Math.abs(f.d2) && Math.abs(f.d2) <= Math.abs(f.d3) ? "BUY" : f.d1 > 0 && f.d2 > 0 && f.d3 > 0 && f.d1 < f.d2 && f.d2 <= f.d3 ? "SELL" : "WAIT";
    case "Accel-Exhaustion": { const shock = 3 * f.vol * Math.sqrt(6); const decel = Math.abs(f.d2) > 0 && Math.abs(f.d1) <= 0.5 * Math.abs(f.d2); if (!decel) return "WAIT"; if (f.mom30 < 0 && Math.abs(f.mom30) >= shock) return "BUY"; if (f.mom30 > 0 && Math.abs(f.mom30) >= shock) return "SELL"; return "WAIT"; }
    case "ATR-Overshoot": return f.sma20 - f.close >= 3 * f.atr ? "BUY" : f.close - f.sma20 >= 3 * f.atr ? "SELL" : "WAIT";
    case "Regime-Reversion": { const v3 = f.vol < .0012 && f.inZone && ((f.s > .22 && f.mom120 > 0 && f.upSwing) || (f.s < -.22 && f.mom120 < 0 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return f.er !== null && f.er < 0.35 ? v3 : "WAIT"; }
    default: return "WAIT";
  }
}
const outcome = (side, entry, exit) => (exit === undefined || exit === null ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const BASE = ["WR-Failure", "CCI-Divergence", "Keltner-Reentry", "Round-Reject", "Swing-Failure", "Double-Exhaustion", "Velocity-Decel", "Accel-Exhaustion", "ATR-Overshoot", "Regime-Reversion"];
const VARIANTS = [...BASE, ...BASE.map((v) => v + "+fib")];
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
  const results = {}; for (const v of VARIANTS) results[v] = { buy: 0, sell: 0, wait: 0, w45: 0, l45: 0, d45: 0, u45: 0, w60: 0, l60: 0, d60: 0, u60: 0 };
  let evaluated = 0, skipped = 0;
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) { skipped += 1; continue; }
    const cd = buildSeries(window); const f = features3(cd);
    if (!f) { skipped += 1; continue; }
    evaluated += 1;
    const refT = Number(t.t0), entry = Number(t.reference_price);
    const e45 = all.find((o) => o.t >= refT + 45000 && o.t <= refT + 75000);
    const e60 = all.find((o) => o.t >= refT + 60000 && o.t <= refT + 90000);
    for (const v of VARIANTS) {
      const withFib = v.endsWith("+fib"); const base = withFib ? v.slice(0, -4) : v;
      let dec = decide10(base, f);
      if (dec !== "WAIT" && withFib && !fibOk(f, dec)) dec = "WAIT";
      const r = results[v];
      if (dec === "BUY") r.buy += 1; else if (dec === "SELL") r.sell += 1; else r.wait += 1;
      if (dec !== "WAIT") {
        if (!e45) r.u45 += 1; else { const o = outcome(dec, entry, e45.v); if (o === "WIN") r.w45 += 1; else if (o === "LOSS") r.l45 += 1; else r.d45 += 1; }
        if (!e60) r.u60 += 1; else { const o = outcome(dec, entry, e60.v); if (o === "WIN") r.w60 += 1; else if (o === "LOSS") r.l60 += 1; else r.d60 += 1; }
      }
    }
  }
  console.log(`avaliados=${evaluated} skipped=${skipped}`);
  console.log("variant | BUY | SELL | WAIT | T45: W/L/D/U WR | T60: W/L/D/U WR | Wilson60");
  for (const v of VARIANTS) {
    const r = results[v]; const n45 = r.w45 + r.l45, n60 = r.w60 + r.l60;
    console.log(`${v} | ${r.buy} | ${r.sell} | ${r.wait} | ${r.w45}/${r.l45}/${r.d45}/${r.u45} ${n45 ? ((r.w45 / n45) * 100).toFixed(1) : "-"}% | ${r.w60}/${r.l60}/${r.d60}/${r.u60} ${n60 ? ((r.w60 / n60) * 100).toFixed(1) : "-"}% | ${wilson(r.w60, n60) ? wilson(r.w60, n60).join("..") : "-"}`);
  }
  require("fs").writeFileSync("C:/tracecom-forward4/redo-10novas.json", JSON.stringify({ evaluated, skipped, results }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });