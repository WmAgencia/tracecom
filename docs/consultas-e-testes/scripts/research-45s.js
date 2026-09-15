const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
const wilsonLow = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return +(Math.max(0, cc - h)).toFixed(3); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiOver = (arr, p) => { if (arr.length <= p) return null; let g = 0, l = 0; for (let i = arr.length - p; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
function stochK(candles, i, p = 5) { if (i < p) return null; const w = candles.slice(i - p + 1, i + 1); const hh = Math.max(...w.map((c) => c.high)), ll = Math.min(...w.map((c) => c.low)); return hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100; }
function cci(candles, i, p = 14) { if (i < p) return null; const w = candles.slice(i - p + 1, i + 1); const tp = w.map((c) => (c.high + c.low + c.close) / 3); const sma = tp.reduce((s, x) => s + x, 0) / p; const md = tp.reduce((s, x) => s + Math.abs(x - sma), 0) / p; return md === 0 ? 0 : (tp[p - 1] - sma) / (0.015 * md); }
function bbWidth(closes) { if (closes.length < 20) return null; const w = closes.slice(-20); const m = w.reduce((s, x) => s + x, 0) / w.length; return 2 * Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / w.length); }
function features(candles, i) {
  const closes = candles.slice(0, i + 1).map((c) => c.close);
  const n = closes.length, c = candles.slice(0, i + 1);
  const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
  const ema = (p) => emaOver(closes, p);
  const k = stochK(c, i), kPrev = stochK(c, i - 1), kPrev2 = stochK(c, i - 2);
  const d = k !== null && kPrev !== null && kPrev2 !== null ? (k + kPrev + kPrev2) / 3 : null;
  const dPrev = kPrev !== null && kPrev2 !== null ? (kPrev + kPrev2 + (stochK(c, i - 3) ?? kPrev2)) / 3 : null;
  let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((s, x) => s + x, 0) / rs.length; vol = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / rs.length); }
  return { closes, n, c, ret, rsi: rsiOver(closes, 14), mom30: ret(6), mom60: ret(12), mom120: ret(24), ema5: ema(5), ema9: ema(9), ema13: ema(13), ema21: ema(21), k, d, kPrev, dPrev, cci: cci(c, i), cciPrev: cci(c, i - 1), bbw: bbWidth(closes), vol };
}
function evaluate(f) {
  const out = [];
  // 1) stoch-trend-v1 (Admiral/IG/Forex.com: Stoch(5,3,3) oversold recovery + EMA trend)
  { const buy = f.k !== null && f.d !== null && f.kPrev !== null && f.dPrev !== null && f.kPrev <= f.dPrev && f.k > f.d && f.k < 25 && f.ema9 !== null && f.ema21 !== null && f.ema9 > f.ema21;
    const sell = f.k !== null && f.d !== null && f.kPrev !== null && f.dPrev !== null && f.kPrev >= f.dPrev && f.k < f.d && f.k > 75 && f.ema9 !== null && f.ema21 !== null && f.ema9 < f.ema21;
    out.push({ st: "stoch-trend-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  // 2) pinbar-v1 (ForexFactory/binaryoptions.com: long-wick rejection at local extreme)
  { const cur = f.c[f.c.length - 1]; const body = Math.abs(cur.close - cur.open) || 1e-9; const lower = Math.min(cur.open, cur.close) - cur.low; const upper = cur.high - Math.max(cur.open, cur.close);
    const w = f.c.slice(-10); const ll = Math.min(...w.map((x) => x.low)); const hh = Math.max(...w.map((x) => x.high));
    const buy = lower >= 2 * body && upper <= 0.5 * body && cur.low <= ll + (cur.high - cur.low) * 0.2;
    const sell = upper >= 2 * body && lower <= 0.5 * body && cur.high >= hh - (cur.high - cur.low) * 0.2;
    out.push({ st: "pinbar-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  // 3) engulfing-v1 (price action: engulfing reversal after trend)
  { const a = f.c[f.c.length - 2], b = f.c[f.c.length - 1]; const aBody = Math.abs(a.close - a.open), bBody = Math.abs(b.close - b.open);
    const bullEngulf = a.close < a.open && b.close > b.open && b.close > a.open && b.open < a.close && bBody > aBody && f.mom60 !== null && f.mom60 < 0;
    const bearEngulf = a.close > a.open && b.close < b.open && b.close < a.open && b.open > a.close && bBody > aBody && f.mom60 !== null && f.mom60 > 0;
    out.push({ st: "engulfing-v1", dir: bullEngulf ? "BUY" : bearEngulf ? "SELL" : null }); }
  // 4) cci-trend-v1 (MQL5 scalpers: CCI reclaim of -100/+100 in trend)
  { const buy = f.cci !== null && f.cciPrev !== null && f.cciPrev <= -100 && f.cci > -100 && f.mom120 !== null && f.mom120 > 0;
    const sell = f.cci !== null && f.cciPrev !== null && f.cciPrev >= 100 && f.cci < 100 && f.mom120 !== null && f.mom120 < 0;
    out.push({ st: "cci-trend-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  // 5) bb-squeeze-v1 (IG/FXCM: Bollinger squeeze breakout)
  { let buy = false, sell = false; if (f.bbw !== null && f.n >= 60 && f.c.length >= 62) { const widths = []; for (let j = f.n - 40; j < f.n; j++) { const w = bbWidth(f.closes.slice(0, j)); if (w !== null) widths.push(w); } if (widths.length >= 20) { const avg = widths.reduce((s, x) => s + x, 0) / widths.length; const cur = f.c[f.c.length - 1]; const w20 = f.closes.slice(-20); const m = w20.reduce((s, x) => s + x, 0) / 20; const sd = Math.sqrt(w20.reduce((s, x) => s + (x - m) ** 2, 0) / 20); const upper = m + 2 * sd, lower = m - 2 * sd; buy = f.bbw < 0.8 * avg && cur.close > upper; sell = f.bbw < 0.8 * avg && cur.close < lower; } }
    out.push({ st: "bb-squeeze-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  // 6) ema-cross-v1 (binaryoptions.co.uk/IG: fast EMA cross with momentum)
  { const prev = emaOver(f.closes.slice(0, -1), 5), prev13 = emaOver(f.closes.slice(0, -1), 13);
    const buy = f.ema5 !== null && f.ema13 !== null && prev !== null && prev13 !== null && prev <= prev13 && f.ema5 > f.ema13 && f.mom60 !== null && f.mom60 > 0;
    const sell = f.ema5 !== null && f.ema13 !== null && prev !== null && prev13 !== null && prev >= prev13 && f.ema5 < f.ema13 && f.mom60 !== null && f.mom60 < 0;
    out.push({ st: "ema-cross-v1", dir: buy ? "BUY" : sell ? "SELL" : null }); }
  // references: deep-RSI band (v6 signal), reversion-v1 (with vol filter like the engine)
  { const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; const volOk = f.vol !== null && f.vol < .0009; out.push({ st: "ref-band-v6", dir: deep && volOk ? (s > 0 ? "BUY" : "SELL") : null }); }
  { const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const volOk = f.vol !== null && f.vol < .0009; out.push({ st: "ref-reversion-v1", dir: volOk && Math.abs(s) > .33 ? (s > 0 ? "BUY" : "SELL") : null }); }
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
  for (const [key, group] of groups) {
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
        const byT = [...all].sort((a, b) => a.t - b.t);
        for (const x of byT) lines.push([x.st, x.asset, x.dir, new Date(x.t).toISOString(), x.h / 1000, x.result].join(","));
        fs.writeFileSync(path.join(OUT_DIR, `${st}-t${h / 1000}-last100.csv`), lines.join("\n"), "utf8");
      }
    }
  }
  summary.sort((a, b) => (b.wr ?? 0) - (a.wr ?? 0));
  for (const s of summary) console.log(`${s.st} T+${s.h}s n=${s.n} W=${s.w} L=${s.l} D=${s.d} WR=${s.wr}% CI95low=${s.ciLow}`);
  fs.writeFileSync(path.join(OUT_DIR, "research-45s-summary.json"), JSON.stringify(summary, null, 1), "utf8");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });