const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
const wilsonLow = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return +(Math.max(0, cc - h)).toFixed(3); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiAt = (closes, end, p = 14) => { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
function stochK(c, i, p = 5) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? 50 : ((c[i].close - ll) / (hh - ll)) * 100; }
function cci(c, i, p = 14) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const tp = w.map((x) => (x.high + x.low + x.close) / 3); const sma = tp.reduce((s, x) => s + x, 0) / p; const md = tp.reduce((s, x) => s + Math.abs(x - sma), 0) / p; return md === 0 ? 0 : (tp[p - 1] - sma) / (0.015 * md); }
function willr(c, i, p = 14) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? -50 : ((hh - c[i].close) / (hh - ll)) * -100; }
function bbOf(closes) { if (closes.length < 20) return null; const w = closes.slice(-20); const m = w.reduce((s, x) => s + x, 0) / 20, sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / 20); return { m, sd, upper: m + 2 * sd, lower: m - 2 * sd, width: 4 * sd }; }
function fibLevels(c, i, W = 24) { if (i < W) return null; const w = c.slice(i - W + 1, i + 1); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low)); const range = hi - lo; if (range <= 0) return null; let hiIdx = -1, loIdx = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && hiIdx === -1) hiIdx = j; if (w[j].low === lo && loIdx === -1) loIdx = j; } const upSwing = loIdx <= hiIdx; const lv = {}; for (const r of [0.382, 0.5, 0.618]) lv[r] = upSwing ? hi - range * r : lo + range * r; const zHi = Math.max(lv[0.382], lv[0.618]), zLo = Math.min(lv[0.382], lv[0.618]); return { upSwing, inZone: c[i].close <= zHi && c[i].close >= zLo }; }
function levels(c, i, closes) {
  const close = closes[closes.length - 1];
  const out = {};
  if (i >= 100) { const w = c.slice(i - 99, i + 1); const H = Math.max(...w.map((x) => x.high)), L = Math.min(...w.map((x) => x.low)); const C = close; const PP = (H + L + C) / 3; out.pivot = [PP, 2 * PP - H, 2 * PP - L]; }
  if (closes.length >= 60) { const w = closes.slice(-60); out.twap = [w.reduce((s, x) => s + x, 0) / w.length]; }
  out.round = [Math.round(close / 0.005) * 0.005];
  if (i >= 26) { const w = c.slice(i - 25, i + 1); out.kijun = [(Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2]; }
  if (i >= 50) { const w = c.slice(i - 49, i + 1); out.swing = [Math.max(...w.map((x) => x.high)), Math.min(...w.map((x) => x.low))]; }
  if (i >= 120) { const w = c.slice(i - 119, i - 59); out.prior = [Math.max(...w.map((x) => x.high)), Math.min(...w.map((x) => x.low))]; }
  return out;
}
const nearAny = (close, arr, tol) => arr.some((lv) => Math.abs(close - lv) / close < tol);
function features(candles, i) {
  const closes = candles.slice(0, i + 1).map((x) => x.close);
  const n = closes.length, c = candles.slice(0, i + 1);
  const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
  const ema9 = emaOver(closes, 9), ema21 = emaOver(closes, 21), ema12 = emaOver(closes, 12), ema26 = emaOver(closes, 26);
  const macdHist = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
  let macdPrev = null; if (n >= 27) { const p = closes.slice(0, -1); const e12 = emaOver(p, 12), e26 = emaOver(p, 26); if (e12 !== null && e26 !== null) macdPrev = e12 - e26; }
  const rsis = []; for (let k = 0; k < 14; k++) { const r = rsiAt(closes, n - 1 - k, 14); if (r !== null) rsis.push(r); }
  let srs = null, srsPrev = null;
  if (rsis.length >= 13) { const mn = Math.min(...rsis), mx = Math.max(...rsis); srs = mx === mn ? .5 : (rsis[0] - mn) / (mx - mn); const s2 = rsis.slice(1), mn2 = Math.min(...s2), mx2 = Math.max(...s2); srsPrev = mx2 === mn2 ? .5 : (s2[0] - mn2) / (mx2 - mn2); }
  let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((s, x) => s + x, 0) / rs.length; vol = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / rs.length); }
  return { closes, n, c, close: closes[n - 1], rsi: rsiAt(closes, n - 1, 14), rsi3: rsiAt(closes, n - 1, 3), rsiPrev: rsiAt(closes, n - 2, 14), mom30: ret(6), mom60: ret(12), mom120: ret(24), slope: ema9 !== null && ema21 ? (ema9 - ema21) / ema21 : null, ema9, ema21, macdHist, macdPrev, stochK: stochK(c, i), stochKPrev: stochK(c, i - 1), cci: cci(c, i), cciPrev: cci(c, i - 1), willr: willr(c, i), willrPrev: willr(c, i - 1), srs, srsPrev, vol, bb: bbOf(closes), fib: fibLevels(c, i), lv: levels(c, i, closes) };
}
function evaluate(f) {
  const out = [];
  const s = f.rsi === null ? 0 : (55 - f.rsi) / 45;
  const sc = (v, k) => (v === null ? 0 : clamp(v / k, -1, 1));
  { const x = sc(f.mom30, .0008) * .6 + sc(f.mom60, .0012) * .4; out.push({ st: "momentum-v1", dir: x > .25 ? "BUY" : x < -.25 ? "SELL" : null }); }
  { const x = sc(f.slope, .0008) * .7 + sc(f.mom120, .002) * .3; out.push({ st: "trend-v1", dir: x > .3 ? "BUY" : x < -.3 ? "SELL" : null }); }
  { const ok = f.vol !== null && f.vol < .0009; out.push({ st: "reversion-v1", dir: ok && s > .33 ? "BUY" : ok && s < -.33 ? "SELL" : null }); }
  { const ok = f.vol !== null && f.vol < .0012; out.push({ st: "reversion-v2", dir: ok && s > .22 ? "BUY" : ok && s < -.22 ? "SELL" : null }); }
  { const ok = f.vol !== null && f.vol < .0012; const up = f.mom120 !== null && f.mom120 > 0, dn = f.mom120 !== null && f.mom120 < 0; out.push({ st: "reversion-v3", dir: ok && s > .22 && up ? "BUY" : ok && s < -.22 && dn ? "SELL" : null }); }
  { const ok = f.vol !== null && f.vol < .0012; const up = f.mom120 !== null && f.mom120 > 0, dn = f.mom120 !== null && f.mom120 < 0; const tu = f.mom30 !== null && f.mom30 > 0, td = f.mom30 !== null && f.mom30 < 0; out.push({ st: "reversion-v4", dir: ok && s > .22 && up && tu ? "BUY" : ok && s < -.22 && dn && td ? "SELL" : null }); }
  { const ok = f.vol !== null && f.vol < .0009; const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; out.push({ st: "reversion-v5", dir: ok && deep ? (s > 0 ? "BUY" : "SELL") : null }); }
  { const up = f.slope !== null && f.slope > 0, dn = f.slope !== null && f.slope < 0; const rec = f.mom30 !== null && f.mom30 > 0, drop = f.mom30 !== null && f.mom30 < 0; out.push({ st: "pullback-v1", dir: up && f.rsi !== null && f.rsi < 42 && rec ? "BUY" : dn && f.rsi !== null && f.rsi > 58 && drop ? "SELL" : null }); }
  { const tr = f.mom120 === null ? 0 : Math.sign(f.mom120); out.push({ st: "snapback-v1", dir: tr > 0 && f.rsi3 !== null && f.rsi3 < 15 ? "BUY" : tr < 0 && f.rsi3 !== null && f.rsi3 > 85 ? "SELL" : null }); }
  { out.push({ st: "dual-rsi-v1", dir: f.rsi3 !== null && f.rsi3 < 30 && f.rsi !== null && f.rsi > 45 ? "BUY" : f.rsi3 !== null && f.rsi3 > 70 && f.rsi !== null && f.rsi < 55 ? "SELL" : null }); }
  { let buy = false, sell = false; if (f.bb) { const last = f.close; buy = last <= f.bb.lower && f.rsi !== null && f.rsi < 30; sell = last >= f.bb.upper && f.rsi !== null && f.rsi > 70; } out.push({ st: "bollinger-rsi-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { const climb = f.macdHist !== null && f.macdPrev !== null && f.macdHist > f.macdPrev; const fall = f.macdHist !== null && f.macdPrev !== null && f.macdHist < f.macdPrev; out.push({ st: "macd-rsi-v1", dir: f.rsi !== null && f.rsi < 50 && f.macdHist !== null && f.macdHist > 0 && climb ? "BUY" : f.rsi !== null && f.rsi > 50 && f.macdHist !== null && f.macdHist < 0 && fall ? "SELL" : null }); }
  { const buy = f.stochK !== null && f.stochKPrev !== null && f.stochKPrev <= 40 && f.stochK > 40 && f.stochK < 60 && f.ema9 !== null && f.ema21 !== null && f.ema9 > f.ema21; const sell = f.stochK !== null && f.stochKPrev !== null && f.stochKPrev >= 60 && f.stochK < 60 && f.stochK > 40 && f.ema9 !== null && f.ema21 !== null && f.ema9 < f.ema21; out.push({ st: "stoch-trend-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { const cur = f.c[f.c.length - 1]; const body = Math.abs(cur.close - cur.open) || 1e-9; const lower = Math.min(cur.open, cur.close) - cur.low, upper = cur.high - Math.max(cur.open, cur.close); const w = f.c.slice(-10); const ll = Math.min(...w.map((x) => x.low)), hh = Math.max(...w.map((x) => x.high)); out.push({ st: "pinbar-v1", dir: lower >= 2 * body && upper <= .5 * body && cur.low <= ll + (cur.high - cur.low) * .2 ? "BUY" : upper >= 2 * body && lower <= .5 * body && cur.high >= hh - (cur.high - cur.low) * .2 ? "SELL" : null }); }
  { const a = f.c[f.c.length - 2], b = f.c[f.c.length - 1]; const ab = Math.abs(a.close - a.open), bb2 = Math.abs(b.close - b.open); const bull = a.close < a.open && b.close > b.open && b.close > a.open && b.open < a.close && bb2 > ab && f.mom60 !== null && f.mom60 < 0; const bear = a.close > a.open && b.close < b.open && b.close < a.open && b.open > a.close && bb2 > ab && f.mom60 !== null && f.mom60 > 0; out.push({ st: "engulfing-v1", dir: bull ? "BUY" : bear ? "SELL" : null }); }
  { out.push({ st: "cci-trend-v1", dir: f.cci !== null && f.cciPrev !== null && f.cciPrev <= -100 && f.cci > -100 && f.mom120 !== null && f.mom120 > 0 ? "BUY" : f.cci !== null && f.cciPrev !== null && f.cciPrev >= 100 && f.cci < 100 && f.mom120 !== null && f.mom120 < 0 ? "SELL" : null }); }
  { let buy = false, sell = false; if (f.bb && f.n >= 62) { const widths = []; for (let j = f.n - 40; j < f.n; j++) { const b2 = bbOf(f.closes.slice(0, j)); if (b2) widths.push(b2.width); } if (widths.length >= 20) { const avg = widths.reduce((s2, x) => s2 + x, 0) / widths.length; const cur = f.c[f.c.length - 1]; buy = f.bb.width < .8 * avg && cur.close > f.bb.upper; sell = f.bb.width < .8 * avg && cur.close < f.bb.lower; } } out.push({ st: "bb-squeeze-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { const p5 = emaOver(f.closes.slice(0, -1), 5), p13 = emaOver(f.closes.slice(0, -1), 13); out.push({ st: "ema-cross-v1", dir: f.ema9 !== null && f.ema21 !== null && p5 !== null && p13 !== null && p5 <= p13 && f.ema9 > f.ema21 && f.mom60 !== null && f.mom60 > 0 ? "BUY" : p5 !== null && p13 !== null && p5 >= p13 && f.ema9 < f.ema21 && f.mom60 !== null && f.mom60 < 0 ? "SELL" : null }); }
  { out.push({ st: "stochrsi-v1", dir: f.srs !== null && f.srsPrev !== null && f.srsPrev <= .2 && f.srs > .2 && f.ema9 !== null && f.ema21 !== null && f.ema9 > f.ema21 ? "BUY" : f.srs !== null && f.srsPrev !== null && f.srsPrev >= .8 && f.srs < .8 && f.ema9 !== null && f.ema21 !== null && f.ema9 < f.ema21 ? "SELL" : null }); }
  { out.push({ st: "williams-v1", dir: f.willr !== null && f.willrPrev !== null && f.willrPrev <= -94 && f.willr > -94 ? "BUY" : f.willr !== null && f.willrPrev !== null && f.willrPrev >= -6 && f.willr < -6 ? "SELL" : null }); }
  { out.push({ st: "rsi-div-v1", dir: (() => { if (f.n < 12 || f.rsi === null) return null; const r10 = rsiAt(f.closes, f.n - 11, 14); if (r10 === null) return null; const cur = f.closes[f.n - 1], old = f.closes[f.n - 11]; return cur < old && f.rsi > r10 + 1.5 ? "BUY" : cur > old && f.rsi < r10 - 1.5 ? "SELL" : null; })() }); }
  { out.push({ st: "turtle-soup-v1", dir: (() => { const a = f.c, n = a.length; if (n <= 23) return null; const prev = a[n - 2], before = a.slice(n - 22, n - 2); const pl = Math.min(...before.map((x) => x.low)), ph = Math.max(...before.map((x) => x.high)); const cur = a[n - 1]; return prev.low < pl && cur.close > prev.high ? "BUY" : prev.high > ph && cur.close < prev.low ? "SELL" : null; })() }); }
  return out;
}
const FILTERS = {
  fib: (f) => f.fib && (f.fib.upSwing && f.fib.inZone),
  pv: (f) => f.lv.pivot && nearAny(f.close, f.lv.pivot, 0.0006),
  vw: (f) => f.lv.twap && nearAny(f.close, f.lv.twap, 0.0006),
  rn: (f) => f.lv.round && nearAny(f.close, f.lv.round, 0.0008),
  kj: (f) => f.lv.kijun && nearAny(f.close, f.lv.kijun, 0.0006),
  sw: (f) => f.lv.swing && nearAny(f.close, f.lv.swing, 0.0006),
  pr: (f) => f.lv.prior && nearAny(f.close, f.lv.prior, 0.0006),
};
const outcome = (dir, entry, exit) => (exit === entry ? "DRAW" : dir === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = (await c.query("SELECT session_id, segment_id, asset_canonical, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE status='ACCEPTED' AND asset_canonical IS NOT NULL AND market_type='OTC' AND context_validation_status='VALID' ORDER BY session_id, observed_at ASC")).rows.map((r) => ({ s: r.session_id, g: r.segment_id, a: r.asset_canonical, v: Number(r.v), t: Number(r.t) }));
  console.log(`obs=${rows.length}`);
  const groups = new Map();
  for (const o of rows) { const k = `${o.s}|${o.g}|${o.a}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  const trades = [];
  for (const [, group] of groups) {
    const candles = buildCandles(group);
    if (candles.length < MIN_CANDLES + 5) continue;
    for (let i = MIN_CANDLES; i < candles.length; i++) {
      const f = features(candles, i);
      const sigs = evaluate(f).filter((x) => x.dir);
      if (!sigs.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const sig of sigs) {
          trades.push({ st: sig.st, variant: "base", dir: sig.dir, t: ref.t, h, result: outcome(sig.dir, ref.v, settle.v) });
          for (const [name, fn] of Object.entries(FILTERS)) { try { if (fn(f)) trades.push({ st: sig.st, variant: name, dir: sig.dir, t: ref.t, h, result: outcome(sig.dir, ref.v, settle.v) }); } catch { /* skip */ } }
        }
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];
  const names = [...new Set(trades.map((t) => t.st))];
  for (const st of names) for (const variant of ["base", ...Object.keys(FILTERS)]) for (const h of [45_000, 60_000]) {
    const all = trades.filter((t) => t.st === st && t.variant === variant && t.h === h).sort((a, b) => b.t - a.t).slice(0, 100);
    if (!all.length) continue;
    const w = all.filter((x) => x.result === "WIN").length, l = all.filter((x) => x.result === "LOSS").length, d = all.filter((x) => x.result === "DRAW").length;
    summary.push({ st, variant, h: h / 1000, n: all.length, w, l, d, wr: w + l ? +((w / (w + l)) * 100).toFixed(1) : null, ciLow: wilsonLow(w, w + l) });
  }
  const byKey = new Map(summary.map((r) => [`${r.st}|${r.variant}|T${r.h}`, r]));
  console.log("=== melhorias por filtro (T+60, somente base n>=50 e filtro n>=30) ===");
  for (const fname of Object.keys(FILTERS)) {
    let imp = 0, wor = 0, sumD = 0, cnt = 0; const best = [];
    for (const st of names) {
      const b = byKey.get(`${st}|base|T60`), ff = byKey.get(`${st}|${fname}|T60`);
      if (!b || !ff || b.n < 50 || ff.n < 30) continue;
      const d = +(ff.wr - b.wr).toFixed(1); sumD += d; cnt++; if (d > 0) imp++; else wor++;
      best.push({ st, base: b.wr, filt: ff.wr, n: ff.n, d });
    }
    best.sort((a, b2) => b2.d - a.d);
    console.log(`\n[${fname}] melhorou ${imp} | piorou ${wor} | delta médio ${cnt ? (sumD / cnt).toFixed(1) : "-"} (n>=30)`);
    for (const x of best.slice(0, 6)) console.log(`   ${x.st}: ${x.base}% -> ${x.filt}% (n=${x.n}, d=${x.d > 0 ? "+" : ""}${x.d})`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "filters-all-summary.json"), JSON.stringify(summary, null, 1), "utf8");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });