const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000, CAP = 113;
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiAt = (closes, end, p = 14) => { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
const outcome = (dir, entry, exit) => (exit === entry ? "DRAW" : dir === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const stats = (arr) => { const w = arr.filter((x) => x.result === "WIN").length, l = arr.filter((x) => x.result === "LOSS").length, d = arr.filter((x) => x.result === "DRAW").length; return { n: arr.length, w, l, d, wr: w + l ? +((w / (w + l)) * 100).toFixed(1) : null, ci: wilson(w, w + l) }; };
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = (await c.query("SELECT session_id, segment_id, asset_canonical, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE status='ACCEPTED' AND asset_canonical IS NOT NULL AND market_type='OTC' AND context_validation_status='VALID' ORDER BY session_id, observed_at ASC")).rows.map((r) => ({ s: r.session_id, g: r.segment_id, a: r.asset_canonical, v: Number(r.v), t: Number(r.t) }));
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
      const rsi = rsiAt(closes, n - 1, 14);
      const s = rsi === null ? 0 : (55 - rsi) / 45;
      const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
      let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((x, y) => x + y, 0) / rs.length; vol = Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / rs.length); }
      const ema9 = emaOver(closes, 9), ema21 = emaOver(closes, 21);
      const mom120 = ret(24);
      // stochrsi
      const rs = []; for (let k = 0; k < 14; k++) { const r = rsiAt(closes, n - 1 - k, 14); if (r !== null) rs.push(r); }
      let srs = null, srsPrev = null; if (rs.length >= 13) { const mn = Math.min(...rs), mx = Math.max(...rs); srs = mx === mn ? .5 : (rs[0] - mn) / (mx - mn); const s2 = rs.slice(1), mn2 = Math.min(...s2), mx2 = Math.max(...s2); srsPrev = mx2 === mn2 ? .5 : (s2[0] - mn2) / (mx2 - mn2); }
      // fib
      let fibv = null; if (i >= 24) { const w = c2.slice(i - 23, i + 1); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low)); let fh = -1, fl = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; } const range = hi - lo; if (range > 0) { const upSwing = fl <= fh; const lv382 = upSwing ? hi - range * .382 : lo + range * .382, lv618 = upSwing ? hi - range * .618 : lo + range * .618; const zHi = Math.max(lv382, lv618), zLo = Math.min(lv382, lv618); fibv = { upSwing, inZone: close <= zHi && close >= zLo }; } }
      const sigs = [];
      // #1 reversion-v1-fib
      if (vol !== null && vol < .0009 && fibv && fibv.inZone) {
        if (s > .33 && fibv.upSwing) sigs.push(["reversion-v1-fib", "BUY"]);
        else if (s < -.33 && !fibv.upSwing) sigs.push(["reversion-v1-fib", "SELL"]);
      }
      // #2 reversion-v3-fib
      if (vol !== null && vol < .0012 && fibv && fibv.inZone) {
        if (s > .22 && mom120 > 0 && fibv.upSwing) sigs.push(["reversion-v3-fib", "BUY"]);
        else if (s < -.22 && mom120 < 0 && !fibv.upSwing) sigs.push(["reversion-v3-fib", "SELL"]);
      }
      // #3 reversion-v2-fib
      if (vol !== null && vol < .0012 && fibv && fibv.inZone) {
        if (s > .22 && fibv.upSwing) sigs.push(["reversion-v2-fib", "BUY"]);
        else if (s < -.22 && !fibv.upSwing) sigs.push(["reversion-v2-fib", "SELL"]);
      }
      // #5 stochrsi-v1
      if (srs !== null && srsPrev !== null) {
        if (srsPrev <= .2 && srs > .2 && ema9 !== null && ema21 !== null && ema9 > ema21) sigs.push(["stochrsi-v1", "BUY"]);
        else if (srsPrev >= .8 && srs < .8 && ema9 !== null && ema21 !== null && ema9 < ema21) sigs.push(["stochrsi-v1", "SELL"]);
      }
      if (!sigs.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const [st, dir] of sigs) trades.push({ st, dir, asset: group[0].a, t: ref.t, h, result: outcome(dir, ref.v, settle.v), entry: ref.v, exit: settle.v, entryIso: new Date(ref.t).toISOString(), exitIso: new Date(settle.t).toISOString() });
      }
    }
  }
  await c.end();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {};
  for (const st of ["reversion-v1-fib", "reversion-v3-fib", "reversion-v2-fib", "stochrsi-v1"]) {
    report[st] = {};
    for (const h of [45_000, 60_000]) {
      const all = trades.filter((x) => x.st === st && x.h === h).sort((a, b) => a.t - b.t);
      if (!all.length) continue;
      const mid = all[Math.floor(all.length / 2)]?.t ?? 0;
      const latest = [...all].sort((a, b) => b.t - a.t).slice(0, CAP);
      const d = { all: stats(all), latest113: stats(latest), buy: stats(all.filter((x) => x.dir === "BUY")), sell: stats(all.filter((x) => x.dir === "SELL")), h1: stats(all.filter((x) => x.t < mid)), h2: stats(all.filter((x) => x.t >= mid)), byAsset: {} };
      for (const a of ["EUR/NZD", "EUR/USD", "NZD/USD"]) { const arr = all.filter((x) => x.asset === a); if (arr.length) d.byAsset[a] = stats(arr); }
      report[st][`T+${h / 1000}`] = d;
      const lines = ["strategy,asset,direction,entry_iso,entry_price,exit_iso,exit_price,horizon_s,result"];
      for (const x of all) lines.push([x.st, x.asset, x.dir, x.entryIso, x.entry, x.exitIso, x.exit, x.h / 1000, x.result].join(","));
      fs.writeFileSync(path.join(OUT_DIR, `${st}-t${h / 1000}-all.csv`), lines.join("\n"), "utf8");
    }
  }
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, "four-champions.json"), JSON.stringify(report, null, 1), "utf8");
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });