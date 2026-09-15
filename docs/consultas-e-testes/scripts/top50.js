const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000, CAP = 113;
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiAt = (closes, end, p = 14) => { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
function psar(c, i) { if (i < 5) return null; let up = c[1].close > c[0].close; let sar = up ? c[0].low : c[0].high; let ep = up ? c[1].high : c[1].low; let af = 0.02; for (let k = 2; k <= i; k++) { sar = sar + af * (ep - sar); if (up) { if (c[k].low < sar) { up = false; sar = ep; ep = c[k].low; af = 0.02; } else if (c[k].high > ep) { ep = c[k].high; af = Math.min(0.2, af + 0.02); } } else { if (c[k].high > sar) { up = true; sar = ep; ep = c[k].high; af = 0.02; } else if (c[k].low < ep) { ep = c[k].low; af = Math.min(0.2, af + 0.02); } } } return { up, sar }; }
function adxSimple(c, i, p = 14) { if (i < p + 1) return null; let trSum = 0, pSum = 0, nSum = 0; for (let k = i - p + 1; k <= i; k++) { const tr = Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close)); const up = c[k].high - c[k - 1].high, dn = c[k - 1].low - c[k].low; trSum += tr; if (up > dn && up > 0) pSum += up; if (dn > up && dn > 0) nSum += dn; } if (trSum === 0) return null; const pDI = 100 * pSum / trSum, nDI = 100 * nSum / trSum; const adx = pDI + nDI === 0 ? 0 : 100 * Math.abs(pDI - nDI) / (pDI + nDI); return { adx, pDI, nDI }; }
function aroon(c, i, p = 14) { if (i < p) return null; const w = c.slice(i - p, i + 1); let hiJ = 0, loJ = 0; for (let j = 1; j <= p; j++) { if (w[j].high >= w[hiJ].high) hiJ = j; if (w[j].low <= w[loJ].low) loJ = j; } return { up: 100 * hiJ / p, down: 100 * loJ / p }; }
function haColors(c, i) { if (i < 2) return null; let hao = (c[0].open + c[0].close) / 2, hac = (c[0].open + c[0].high + c[0].low + c[0].close) / 4; let last = 0, run = 0; for (let k = 1; k <= i; k++) { const o = (hao + hac) / 2, cl = (c[k].open + c[k].high + c[k].low + c[k].close) / 4; const bull = cl >= o; if (k === 1) { last = bull ? 1 : -1; run = 1; } else if ((bull ? 1 : -1) === last) run++; else { last = bull ? 1 : -1; run = 1; } hao = o; hac = cl; } return { dir: last, run }; }
function supertrend(c, i, p = 10, mult = 3) { if (i < p + 1) return null; let up = true, st = null; let atr = 0; for (let k = 1; k <= i; k++) { const tr = Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close)); atr = k <= p ? (atr * (k - 1) + tr) / k : (atr * (p - 1) + tr) / p; const mid = (c[k].high + c[k].low) / 2; const ub = mid + mult * atr, lb = mid - mult * atr; if (st === null) st = up ? lb : ub; const prevUp = up; if (up) { if (c[k].close < st) { up = false; st = ub; } else st = Math.max(st, lb); } else { if (c[k].close > st) { up = true; st = lb; } else st = Math.min(st, ub); } if (prevUp !== up && k === i) return { up, flip: true }; } return { up, flip: false }; }
function bbOf(closes) { if (closes.length < 20) return null; const w = closes.slice(-20); const m = w.reduce((s, x) => s + x, 0) / 20, sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / 20); return { m, sd, upper: m + 2 * sd, lower: m - 2 * sd, width: 4 * sd }; }
function keltnerOf(c, i, p = 20) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); const e = emaOver(w.map((x) => x.close), p); const atr = w.reduce((s, x) => s + (x.high - x.low), 0) / p; return { upper: e + 2 * atr, lower: e - 2 * atr, mid: e }; }
function fib(z) { if (!z) return null; const { hi, lo, close, firstHi, firstLo } = z; const range = hi - lo; if (range <= 0) return null; const upSwing = firstLo <= firstHi; const lv382 = upSwing ? hi - range * .382 : lo + range * .382, lv618 = upSwing ? hi - range * .618 : lo + range * .618; const zHi = Math.max(lv382, lv618), zLo = Math.min(lv382, lv618); return { upSwing, inZone: close <= zHi && close >= zLo }; }
function swingHilo(c, i, p) { if (i < p) return null; const w = c.slice(i - p + 1, i + 1); return { hi: Math.max(...w.map((x) => x.high)), lo: Math.min(...w.map((x) => x.low)) }; }
function evaluate(F) {
  const out = []; const push = (st, dir) => out.push({ st, dir });
  const { closes: cl, n, c2, close, rsi, rsi3, s, vol, mom30, mom60, mom120, ema5, ema9, ema13, ema21, ema50, slope, macdH, macdHPrev, stochK, stochKPrev, cci, cciPrev, willr, willrPrev, srs, srsPrev, bb, kelt, fibv, twap, pivots, kijun, rnd, swing50, i } = F;
  const prev = (p, arr) => emaOver(arr.slice(0, -1), p);
  const sc = (v, k) => (v === null ? 0 : clamp(v / k, -1, 1));
  const candleUp = c2[i].close > c2[i].open, candleDn = c2[i].close < c2[i].open;
  // ===== MOMENTUM / TREND =====
  { const x = sc(mom30, .0008) * .6 + sc(mom60, .0012) * .4; push("momentum-v1", x > .25 ? "BUY" : x < -.25 ? "SELL" : null); }
  { const x = sc(slope, .0008) * .7 + sc(mom120, .002) * .3; push("trend-v1", x > .3 ? "BUY" : x < -.3 ? "SELL" : null); }
  { const p5 = prev(5, cl), p13 = prev(13, cl); push("ema-cross-5-13", ema5 !== null && ema13 !== null && p5 !== null && p13 !== null && p5 <= p13 && ema5 > ema13 && mom60 > 0 ? "BUY" : p5 !== null && p13 !== null && p5 >= p13 && ema5 < ema13 && mom60 < 0 ? "SELL" : null); }
  { const p9 = prev(9, cl), p21 = prev(21, cl); push("ema-cross-9-21", p9 !== null && p21 !== null && p9 <= p21 && ema9 > ema21 && mom60 > 0 ? "BUY" : p9 !== null && p21 !== null && p9 >= p21 && ema9 < ema21 && mom60 < 0 ? "SELL" : null); }
  { push("triple-ema-9-21-50", ema9 !== null && ema21 !== null && ema50 !== null && ema9 > ema21 && ema21 > ema50 && close > ema9 ? "BUY" : ema9 !== null && ema21 !== null && ema50 !== null && ema9 < ema21 && ema21 < ema50 && close < ema9 ? "SELL" : null); }
  { push("macd-rsi-v1", rsi !== null && rsi < 50 && macdH !== null && macdHPrev !== null && macdH > 0 && macdH > macdHPrev ? "BUY" : rsi !== null && rsi > 50 && macdH !== null && macdHPrev !== null && macdH < 0 && macdH < macdHPrev ? "SELL" : null); }
  { push("macd-hist-zero", macdH !== null && macdHPrev !== null && macdHPrev <= 0 && macdH > 0 && rsi !== null && rsi < 60 ? "BUY" : macdH !== null && macdHPrev !== null && macdHPrev >= 0 && macdH < 0 && rsi !== null && rsi > 40 ? "SELL" : null); }
  { const ad = adxSimple(c2, i); push("adx-di-14", ad && ad.adx > 20 && ad.pDI > ad.nDI && mom30 > 0 ? "BUY" : ad && ad.adx > 20 && ad.nDI > ad.pDI && mom30 < 0 ? "SELL" : null); }
  { const ps = psar(c2, i), psp = psar(c2, i - 1); push("psar-flip", ps && psp && ps.up && !psp.up ? "BUY" : ps && psp && !ps.up && psp.up ? "SELL" : null); }
  { const w = swingHilo(c2, i - 1, 20); push("donchian-break-20", w && close > w.hi && mom60 > 0 ? "BUY" : w && close < w.lo && mom60 < 0 ? "SELL" : null); }
  { const st = supertrend(c2, i); push("supertrend-flip", st && st.flip ? (st.up ? "BUY" : "SELL") : null); }
  { let buy = false, sell = false; if (kelt) { buy = c2[i - 1].close > kelt.upper && c2[i].close > kelt.upper && rsi !== null && rsi > 50; sell = c2[i - 1].close < kelt.lower && c2[i].close < kelt.lower && rsi !== null && rsi < 50; } push("keltner-breakout", buy ? "BUY" : sell ? "SELL" : null); }
  { let buy = false, sell = false; if (bb && n >= 62) { const ws = []; for (let j = n - 40; j < n; j++) { const b = bbOf(cl.slice(0, j)); if (b) ws.push(b.width); } if (ws.length >= 20) { const avg = ws.reduce((x, y) => x + y, 0) / ws.length; buy = bb.width < .8 * avg && close > bb.upper; sell = bb.width < .8 * avg && close < bb.lower; } } push("bb-squeeze-breakout", buy ? "BUY" : sell ? "SELL" : null); }
  { const hc = haColors(c2, i); push("heikin-ashi-trend", hc && hc.dir === 1 && hc.run >= 3 && ema21 !== null && close > ema21 ? "BUY" : hc && hc.dir === -1 && hc.run >= 3 && ema21 !== null && close < ema21 ? "SELL" : null); }
  { const ar = aroon(c2, i); push("aroon-14", ar && ar.up >= 70 && mom30 > 0 ? "BUY" : ar && ar.down >= 70 && mom30 < 0 ? "SELL" : null); }
  { push("vwap-trend", twap !== null && close > twap && mom30 > 0 && ema21 !== null && close > ema21 ? "BUY" : twap !== null && close < twap && mom30 < 0 && ema21 !== null && close < ema21 ? "SELL" : null); }
  // ===== REVERSAL / MEAN REVERSION =====
  { const ok = vol !== null && vol < .0009; push("reversion-v1", ok && s > .33 ? "BUY" : ok && s < -.33 ? "SELL" : null); }
  { const ok = vol !== null && vol < .0012; push("reversion-v2", ok && s > .22 ? "BUY" : ok && s < -.22 ? "SELL" : null); }
  { const ok = vol !== null && vol < .0012; push("reversion-v3", ok && s > .22 && mom120 > 0 ? "BUY" : ok && s < -.22 && mom120 < 0 ? "SELL" : null); }
  { const ok = vol !== null && vol < .0012; push("reversion-v4", ok && s > .22 && mom120 > 0 && mom30 > 0 ? "BUY" : ok && s < -.22 && mom120 < 0 && mom30 < 0 ? "SELL" : null); }
  { const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; push("reversion-band-v5", vol !== null && vol < .0009 && deep ? (s > 0 ? "BUY" : "SELL") : null); }
  { const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; push("reversion-band-v6-t45", vol !== null && vol < .0009 && deep ? (s > 0 ? "BUY" : "SELL") : null); }
  { push("reversion-v1-vwap", vol !== null && vol < .0009 && s > .33 && twap !== null && Math.abs(close - twap) / close < 0.0006 ? "BUY" : vol !== null && vol < .0009 && s < -.33 && twap !== null && Math.abs(close - twap) / close < 0.0006 ? "SELL" : null); }
  { push("reversion-v3-fib", vol !== null && vol < .0012 && fibv && fibv.inZone && ((s > .22 && mom120 > 0 && fibv.upSwing) ? "BUY" : (s < -.22 && mom120 < 0 && !fibv.upSwing) ? "SELL" : null)); }
  { push("reversion-v1-fib", vol !== null && vol < .0009 && fibv && fibv.inZone && ((s > .33 && fibv.upSwing) ? "BUY" : (s < -.33 && !fibv.upSwing) ? "SELL" : null)); }
  { push("reversion-v2-fib", vol !== null && vol < .0012 && fibv && fibv.inZone && ((s > .22 && fibv.upSwing) ? "BUY" : (s < -.22 && !fibv.upSwing) ? "SELL" : null)); }
  { push("snapback-v1", rsi3 !== null && rsi3 < 15 && mom120 > 0 ? "BUY" : rsi3 !== null && rsi3 > 85 && mom120 < 0 ? "SELL" : null); }
  { push("dual-rsi-v1", rsi3 !== null && rsi3 < 30 && rsi !== null && rsi > 45 ? "BUY" : rsi3 !== null && rsi3 > 70 && rsi !== null && rsi < 55 ? "SELL" : null); }
  { let buy = false, sell = false; if (bb) { buy = close <= bb.lower && rsi !== null && rsi < 30; sell = close >= bb.upper && rsi !== null && rsi > 70; } push("bollinger-rsi-v1", buy ? "BUY" : sell ? "SELL" : null); }
  { const r2 = rsiAt(cl, n - 1, 2); push("rsi2-connors", r2 !== null && r2 < 10 && ema21 !== null && close > ema21 ? "BUY" : r2 !== null && r2 > 90 && ema21 !== null && close < ema21 ? "SELL" : null); }
  { push("williams-94", willr !== null && willrPrev !== null && willrPrev <= -94 && willr > -94 ? "BUY" : willr !== null && willrPrev !== null && willrPrev >= -6 && willr < -6 ? "SELL" : null); }
  { const wp = prev(0, [willr ?? 0, willrPrev ?? 0]); push("williams-50-cross", willr !== null && willrPrev !== null && willrPrev <= -50 && willr > -50 && mom120 > 0 ? "BUY" : willr !== null && willrPrev !== null && willrPrev >= -50 && willr < -50 && mom120 < 0 ? "SELL" : null); }
  { push("stochrsi-v1", srs !== null && srsPrev !== null && srsPrev <= .2 && srs > .2 && ema9 !== null && ema21 !== null && ema9 > ema21 ? "BUY" : srs !== null && srsPrev !== null && srsPrev >= .8 && srs < .8 && ema9 !== null && ema21 !== null && ema9 < ema21 ? "SELL" : null); }
  { push("stoch-trend-40-60", stochK !== null && stochKPrev !== null && stochKPrev <= 40 && stochK > 40 && stochK < 60 && ema9 !== null && ema21 !== null && ema9 > ema21 ? "BUY" : stochK !== null && stochKPrev !== null && stochKPrev >= 60 && stochK < 60 && stochK > 40 && ema9 !== null && ema21 !== null && ema9 < ema21 ? "SELL" : null); }
  { push("cci-trend-reclaim", cci !== null && cciPrev !== null && cciPrev <= -100 && cci > -100 && mom120 > 0 ? "BUY" : cci !== null && cciPrev !== null && cciPrev >= 100 && cci < 100 && mom120 < 0 ? "SELL" : null); }
  { push("cci-extreme-200", cci !== null && cci < -200 ? "BUY" : cci !== null && cci > 200 ? "SELL" : null); }
  { let buy = false, sell = false; if (n >= 12 && rsi !== null) { const r10 = rsiAt(cl, n - 11, 14); if (r10 !== null) { const cur = cl[n - 1], old = cl[n - 11]; buy = cur < old && rsi > r10 + 1.5; sell = cur > old && rsi < r10 - 1.5; } } push("rsi-divergence", buy ? "BUY" : sell ? "SELL" : null); }
  { let buy = false, sell = false; if (fibv) { const w = c2.slice(i - 50, i); const buyCtx = fibv.upSwing, sellCtx = !fibv.upSwing; buy = buyCtx && fibv.inZone && candleUp && mom30 > 0; sell = sellCtx && fibv.inZone && candleDn && mom30 < 0; } push("fib-golden-bounce", buy ? "BUY" : sell ? "SELL" : null); }
  { const cur = c2[i]; const body = Math.abs(cur.close - cur.open) || 1e-9; const lower = Math.min(cur.open, cur.close) - cur.low, upper = cur.high - Math.max(cur.open, cur.close); const w = c2.slice(i - 9, i + 1); const ll = Math.min(...w.map((x) => x.low)), hh = Math.max(...w.map((x) => x.high)); push("pinbar-rejection", lower >= 2 * body && upper <= .5 * body && cur.low <= ll + (cur.high - cur.low) * .2 ? "BUY" : upper >= 2 * body && lower <= .5 * body && cur.high >= hh - (cur.high - cur.low) * .2 ? "SELL" : null); }
  { const a = c2[i - 1], b = c2[i]; const ab = Math.abs(a.close - a.open), bb2 = Math.abs(b.close - b.open); push("engulfing-reversal", a.close < a.open && b.close > b.open && b.close > a.open && b.open < a.close && bb2 > ab && mom60 < 0 ? "BUY" : a.close > a.open && b.close < b.open && b.close < a.open && b.open > a.close && bb2 > ab && mom60 > 0 ? "SELL" : null); }
  { const a = c2[i - 2], b = c2[i - 1], d2 = c2[i]; const inside = b.high <= a.high && b.low >= a.low; push("inside-bar-breakout", inside && d2.close > b.high ? "BUY" : inside && d2.close < b.low ? "SELL" : null); }
  { const a = c2[i - 2], b = c2[i - 1], d2 = c2[i]; const aBody = Math.abs(a.close - a.open), bBody = Math.abs(b.close - b.open), mid = (a.open + a.close) / 2; const morning = a.close < a.open && aBody > 0 && bBody < aBody * .5 && d2.close > d2.open && d2.close > mid; const evening = a.close > a.open && aBody > 0 && bBody < aBody * .5 && d2.close < d2.open && d2.close < mid; push("morning-evening-star", morning ? "BUY" : evening ? "SELL" : null); }
  { const a = c2[i - 2], b = c2[i - 1], d2 = c2[i]; const soldiers = a.close > a.open && b.close > b.open && d2.close > d2.open && a.close < b.close && b.close < d2.close && mom120 < 0; const crows = a.close < a.open && b.close < b.open && d2.close < d2.open && a.close > b.close && b.close > d2.close && mom120 > 0; push("soldiers-crows", soldiers ? "BUY" : crows ? "SELL" : null); }
  { let buy = false, sell = false; const n2 = c2.length; if (n2 > 23) { const p2 = c2[n2 - 2], before = c2.slice(n2 - 22, n2 - 2); const pl = Math.min(...before.map((x) => x.low)), ph = Math.max(...before.map((x) => x.high)); const cur = c2[n2 - 1]; buy = p2.low < pl && cur.close > p2.high; sell = p2.high > ph && cur.close < p2.low; } push("turtle-soup", buy ? "BUY" : sell ? "SELL" : null); }
  { if (bb && n >= 2) { const prevC = c2[i - 1].close; push("bb-lower-bounce", prevC < bb.lower && close > bb.lower ? "BUY" : prevC > bb.upper && close < bb.upper ? "SELL" : null); } else push("bb-lower-bounce", null); }
  { if (kelt) { push("keltner-reversal", close < kelt.lower && candleUp ? "BUY" : close > kelt.upper && candleDn ? "SELL" : null); } else push("keltner-reversal", null); }
  { if (pivots) { const near = (lvl) => Math.abs(close - lvl) / close < 0.0006; push("pivot-bounce", near(pivots[2]) && candleUp ? "BUY" : near(pivots[1]) && candleDn ? "SELL" : null); } else push("pivot-bounce", null); }
  { if (rnd) { push("round-number-bounce", Math.abs(close - rnd) / close < 0.0008 && candleUp ? "BUY" : Math.abs(close - rnd) / close < 0.0008 && candleDn ? "SELL" : null); } else push("round-number-bounce", null); }
  { if (kijun !== null) { push("kijun-bounce", Math.abs(close - kijun) / close < 0.0006 && candleUp && mom30 > 0 ? "BUY" : Math.abs(close - kijun) / close < 0.0006 && candleDn && mom30 < 0 ? "SELL" : null); } else push("kijun-bounce", null); }
  { if (swing50) { push("swing-rejection", c2[i].low <= swing50.lo && candleUp ? "BUY" : c2[i].high >= swing50.hi && candleDn ? "SELL" : null); } else push("swing-rejection", null); }
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
      const c2 = candles.slice(0, i + 1);
      const closes = c2.map((x) => x.close);
      const n = closes.length, close = closes[n - 1];
      const rsi = rsiAt(closes, n - 1, 14), rsi3 = rsiAt(closes, n - 1, 3);
      const s = rsi === null ? 0 : (55 - rsi) / 45;
      const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
      let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((x, y) => x + y, 0) / rs.length; vol = Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / rs.length); }
      const ema5 = emaOver(closes, 5), ema9 = emaOver(closes, 9), ema13 = emaOver(closes, 13), ema21 = emaOver(closes, 21), ema50 = emaOver(closes, 50);
      const slope = ema9 !== null && ema21 !== null ? (ema9 - ema21) / ema21 : null;
      const ema12 = emaOver(closes, 12), ema26 = emaOver(closes, 26);
      const macdH = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
      let macdHPrev = null; if (n >= 27) { const p = closes.slice(0, -1); const e12 = emaOver(p, 12), e26 = emaOver(p, 26); if (e12 !== null && e26 !== null) macdHPrev = e12 - e26; }
      const stochK = (() => { if (i < 5) return null; const w = c2.slice(i - 4, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? 50 : ((c2[i].close - ll) / (hh - ll)) * 100; })();
      const stochKPrev = (() => { if (i < 6) return null; const w = c2.slice(i - 5, i); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? 50 : ((c2[i - 1].close - ll) / (hh - ll)) * 100; })();
      const cci = (() => { if (i < 14) return null; const w = c2.slice(i - 13, i + 1); const tp = w.map((x) => (x.high + x.low + x.close) / 3); const sma = tp.reduce((a, b) => a + b, 0) / 14; const md = tp.reduce((a, b) => a + Math.abs(b - sma), 0) / 14; return md === 0 ? 0 : (tp[13] - sma) / (0.015 * md); })();
      const cciPrev = (() => { if (i < 15) return null; const w = c2.slice(i - 14, i); const tp = w.map((x) => (x.high + x.low + x.close) / 3); const sma = tp.reduce((a, b) => a + b, 0) / 14; const md = tp.reduce((a, b) => a + Math.abs(b - sma), 0) / 14; return md === 0 ? 0 : (tp[13] - sma) / (0.015 * md); })();
      const willr = (() => { if (i < 14) return null; const w = c2.slice(i - 13, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? -50 : ((hh - close) / (hh - ll)) * -100; })();
      const willrPrev = (() => { if (i < 15) return null; const w = c2.slice(i - 14, i); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? -50 : ((hh - c2[i - 1].close) / (hh - ll)) * -100; })();
      const rs = []; for (let k = 0; k < 14; k++) { const r = rsiAt(closes, n - 1 - k, 14); if (r !== null) rs.push(r); }
      let srs = null, srsPrev = null; if (rs.length >= 13) { const mn = Math.min(...rs), mx = Math.max(...rs); srs = mx === mn ? .5 : (rs[0] - mn) / (mx - mn); const s2 = rs.slice(1), mn2 = Math.min(...s2), mx2 = Math.max(...s2); srsPrev = mx2 === mn2 ? .5 : (s2[0] - mn2) / (mx2 - mn2); }
      const bb = bbOf(closes), kelt = keltnerOf(c2, i);
      let fibv = null; if (i >= 24) { const w = c2.slice(i - 23, i + 1); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low)); let fh = -1, fl = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; } fibv = fib({ hi, lo, close, firstHi: fh, firstLo: fl }); }
      const twap = n >= 60 ? closes.slice(-60).reduce((a, b) => a + b, 0) / 60 : null;
      let pivots = null; if (i >= 100) { const w = c2.slice(i - 99, i + 1); const H = Math.max(...w.map((x) => x.high)), L = Math.min(...w.map((x) => x.low)); const PP = (H + L + close) / 3; pivots = [PP, 2 * PP - L, 2 * PP - H]; }
      const kijun = i >= 26 ? (Math.max(...c2.slice(i - 25, i + 1).map((x) => x.high)) + Math.min(...c2.slice(i - 25, i + 1).map((x) => x.low))) / 2 : null;
      const rnd = Math.round(close / 0.005) * 0.005;
      const swing50 = swingHilo(c2, i, 50);
      const F = { closes, n, c2, close, rsi, rsi3, s, vol, mom30: ret(6), mom60: ret(12), mom120: ret(24), ema5, ema9, ema13, ema21, ema50, slope, macdH, macdHPrev, stochK, stochKPrev, cci, cciPrev, willr, willrPrev, srs, srsPrev, bb, kelt, fibv, twap, pivots, kijun, rnd, swing50, i };
      const sigs = evaluate(F).filter((x) => x.dir);
      if (!sigs.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const sig of sigs) trades.push({ st: sig.st, dir: sig.dir, asset: group[0].a, t: ref.t, h, result: outcome(sig.dir, ref.v, settle.v) });
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = [...new Set(trades.map((t) => t.st))];
  const allNames = [...new Set([...names, "reversion-band-v6-t45"])];
  const rowsOut = [];
  for (const st of allNames) {
    const latest = (h) => trades.filter((t) => t.st === st && t.h === h).sort((a, b) => b.t - a.t).slice(0, CAP);
    const line = { st };
    for (const h of [45_000, 60_000]) {
      const arr = latest(h);
      const w = arr.filter((x) => x.result === "WIN").length, l = arr.filter((x) => x.result === "LOSS").length, d = arr.filter((x) => x.result === "DRAW").length;
      line[`t${h / 1000}`] = { n: arr.length, w, l, d, wr: w + l ? +((w / (w + l)) * 100).toFixed(1) : null, ci: wilson(w, w + l) };
    }
    rowsOut.push(line);
  }
  rowsOut.sort((a, b) => (b.t60.wr ?? -1) - (a.t60.wr ?? -1));
  console.log("RANK | estrategia | T+60 n,W,L,D,WR | T+45 WR");
  rowsOut.forEach((r, idx) => console.log(`${idx + 1}. ${r.st} | n=${r.t60.n} W=${r.t60.w} L=${r.t60.l} D=${r.t60.d} WR=${r.t60.wr}% | T45WR=${r.t45.wr}`));
  fs.writeFileSync(path.join(OUT_DIR, "top50-summary.json"), JSON.stringify(rowsOut, null, 1), "utf8");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });