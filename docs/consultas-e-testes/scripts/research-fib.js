const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
const wilsonLow = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return +(Math.max(0, cc - h)).toFixed(3); };
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiAt = (closes, end, p = 14) => { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
function volOf(closes) { const n = closes.length; if (n <= 13) return null; const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((s, x) => s + x, 0) / rs.length; return Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / rs.length); }
function fibLevels(candles, i, W = 24) { if (i < W) return null; const w = candles.slice(i - W + 1, i + 1); const hi = Math.max(...w.map((c) => c.high)), lo = Math.min(...w.map((c) => c.low)); const range = hi - lo; if (range <= 0) return null; let hiIdx = -1, loIdx = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && hiIdx === -1) hiIdx = j; if (w[j].low === lo && loIdx === -1) loIdx = j; } const upSwing = loIdx <= hiIdx; const levels = {}; for (const r of [0.236, 0.382, 0.5, 0.618, 0.786]) levels[r] = upSwing ? hi - range * r : lo + range * r; return { hi, lo, range, upSwing, levels }; }
function willr(c, i, p = 14) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? -50 : ((hh - c[i].close) / (hh - ll)) * -100; }
function keltner(c, i, p = 20) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const closes = w.map((x) => x.close); const e = emaOver(closes, p); const atr = w.reduce((s, x) => s + (x.high - x.low), 0) / p; return { upper: e + 2 * atr, lower: e - 2 * atr }; }
function features(candles, i) {
  const closes = candles.slice(0, i + 1).map((c) => c.close);
  const n = closes.length, c = candles.slice(0, i + 1);
  const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
  let rsiSeries = []; for (let k = 0; k < 14; k++) { const r = rsiAt(closes, n - 1 - k, 14); if (r !== null) rsiSeries.push(r); }
  let stochRsi = null, stochRsiPrev = null;
  if (rsiSeries.length >= 13) { const mn = Math.min(...rsiSeries), mx = Math.max(...rsiSeries); const cur = rsiSeries[0]; stochRsi = mx === mn ? .5 : (cur - mn) / (mx - mn); const s2 = rsiSeries.slice(1); const mn2 = Math.min(...s2), mx2 = Math.max(...s2); stochRsiPrev = mx2 === mn2 ? .5 : (s2[0] - mn2) / (mx2 - mn2); }
  return { closes, n, c, ret, rsi: rsiAt(closes, n - 1, 14), rsiPrev: rsiAt(closes, n - 2, 14), mom30: ret(6), mom60: ret(12), mom120: ret(24), ema9: emaOver(closes, 9), ema21: emaOver(closes, 21), stochRsi, stochRsiPrev, willr: willr(c, i), willrPrev: willr(c, i - 1), kelt: keltner(c, i), fib: fibLevels(c, i), vol: volOf(closes), closes10: closes[n - 11] ?? null };
}
function evaluate(f) {
  const out = [];
  const revBuy = f.vol !== null && f.vol < .0009 && f.rsi !== null && (55 - f.rsi) / 45 > .33;
  const revSell = f.vol !== null && f.vol < .0009 && f.rsi !== null && (55 - f.rsi) / 45 < -.33;
  out.push({ st: "rev1-baseline", dir: revBuy ? "BUY" : revSell ? "SELL" : null });
  if (f.fib) {
    const close = f.c[f.c.length - 1].close, fb = f.fib;
    const near = (lv) => Math.abs(close - lv) / close < 0.0012;
    const buyCtx = fb.upSwing, sellCtx = !fb.upSwing;
    out.push({ st: "rev1-fib-618-v1", dir: revBuy && buyCtx && (near(fb.levels[0.618]) || near(fb.levels[0.5])) ? "BUY" : revSell && sellCtx && (near(fb.levels[0.618]) || near(fb.levels[0.5])) ? "SELL" : null });
    const zHi = Math.max(fb.levels[0.382], fb.levels[0.618]), zLo = Math.min(fb.levels[0.382], fb.levels[0.618]);
    const inZone = close <= zHi && close >= zLo;
    out.push({ st: "rev1-fib-zone-v1", dir: revBuy && buyCtx && inZone ? "BUY" : revSell && sellCtx && inZone ? "SELL" : null });
    const cur = f.c[f.c.length - 1];
    const bullConfirm = cur.close > cur.open && f.mom30 !== null && f.mom30 > 0;
    const bearConfirm = cur.close < cur.open && f.mom30 !== null && f.mom30 < 0;
    out.push({ st: "fib-bounce-v1", dir: buyCtx && inZone && bullConfirm ? "BUY" : sellCtx && inZone && bearConfirm ? "SELL" : null });
  }
  { const buy = f.stochRsi !== null && f.stochRsiPrev !== null && f.stochRsiPrev <= 0.2 && f.stochRsi > 0.2 && f.ema9 !== null && f.ema21 !== null && f.ema9 > f.ema21;
    const sell = f.stochRsi !== null && f.stochRsiPrev !== null && f.stochRsiPrev >= 0.8 && f.stochRsi < 0.8 && f.ema9 !== null && f.ema21 !== null && f.ema9 < f.ema21;
    out.push({ st: "stochrsi-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { const buy = f.willr !== null && f.willrPrev !== null && f.willrPrev <= -94 && f.willr > -94;
    const sell = f.willr !== null && f.willrPrev !== null && f.willrPrev >= -6 && f.willr < -6;
    out.push({ st: "williams-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { let buy = false, sell = false; if (f.kelt) { const a = f.c[f.c.length - 2], b = f.c[f.c.length - 1]; buy = a.close > f.kelt.upper && b.close > f.kelt.upper && f.rsi !== null && f.rsiPrev !== null && f.rsiPrev <= 50 && f.rsi > 50; sell = a.close < f.kelt.lower && b.close < f.kelt.lower && f.rsi !== null && f.rsiPrev !== null && f.rsiPrev >= 50 && f.rsi < 50; }
    out.push({ st: "keltner-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { let buy = false, sell = false; if (f.closes10 !== null && f.rsi !== null) { const rsi10 = rsiAt(f.closes, f.n - 11, 14); if (rsi10 !== null) { const curClose = f.closes[f.n - 1]; buy = curClose < f.closes10 && f.rsi > rsi10 + 1.5; sell = curClose > f.closes10 && f.rsi < rsi10 - 1.5; } }
    out.push({ st: "rsi-div-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  { let buy = false, sell = false; const cArr = f.c, n = cArr.length; if (n > 23) { const prev = cArr[n - 2], before = cArr.slice(n - 22, n - 2); const prevLow = Math.min(...before.map((x) => x.low)), prevHigh = Math.max(...before.map((x) => x.high)); const cur = cArr[n - 1]; buy = prev.low < prevLow && cur.close > prev.high; sell = prev.high > prevHigh && cur.close < prev.low; }
    out.push({ st: "turtle-soup-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  return out;
}
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
      const sigs = evaluate(f).filter((s) => s.dir);
      if (!sigs.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const s of sigs) trades.push({ st: s.st, dir: s.dir, asset: group[0].a, t: ref.t, h, result: outcome(s.dir, ref.v, settle.v) });
      }
    }
  }
  console.log(`trades=${trades.length}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];
  const names = [...new Set(trades.map((t) => t.st))];
  for (const st of names) {
    for (const h of [45_000, 60_000]) {
      const all = trades.filter((t) => t.st === st && t.h === h).sort((a, b) => b.t - a.t).slice(0, 100);
      const w = all.filter((x) => x.result === "WIN").length, l = all.filter((x) => x.result === "LOSS").length, d = all.filter((x) => x.result === "DRAW").length;
      const wr = w + l ? +((w / (w + l)) * 100).toFixed(1) : null;
      summary.push({ st, h: h / 1000, n: all.length, w, l, d, wr, ciLow: wilsonLow(w, w + l) });
      if (all.length) {
        const lines = ["strategy,asset,direction,reference_iso,horizon_s,result"];
        for (const x of [...all].sort((a, b) => a.t - b.t)) lines.push([x.st, x.asset, x.dir, new Date(x.t).toISOString(), x.h / 1000, x.result].join(","));
        fs.writeFileSync(path.join(OUT_DIR, `${st}-t${h / 1000}-last100.csv`), lines.join("\n"), "utf8");
      }
    }
  }
  summary.sort((a, b) => (b.wr ?? 0) - (a.wr ?? 0));
  for (const s of summary) console.log(`${s.st} T+${s.h}s n=${s.n} W=${s.w} L=${s.l} D=${s.d} WR=${s.wr}% CI95low=${s.ciLow}`);
  fs.writeFileSync(path.join(OUT_DIR, "research-fib-summary.json"), JSON.stringify(summary, null, 1), "utf8");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });