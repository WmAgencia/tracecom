const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
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
      const closes = candles.slice(0, i + 1).map((x) => x.close);
      const n = closes.length;
      const close = closes[n - 1];
      const rsi = rsiAt(closes, n - 1, 14);
      const s = rsi === null ? 0 : (55 - rsi) / 45;
      const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
      const mom120 = ret(24);
      let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((x, y) => x + y, 0) / rs.length; vol = Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / rs.length); }
      let fibDir = null;
      if (i >= 24) { const w = candles.slice(i - 23, i + 1); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low)); const range = hi - lo; if (range > 0) { let hiIdx = -1, loIdx = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && hiIdx === -1) hiIdx = j; if (w[j].low === lo && loIdx === -1) loIdx = j; } const upSwing = loIdx <= hiIdx; const lv382 = upSwing ? hi - range * .382 : lo + range * .382, lv618 = upSwing ? hi - range * .618 : lo + range * .618; const zHi = Math.max(lv382, lv618), zLo = Math.min(lv382, lv618); const inZone = close <= zHi && close >= zLo; fibDir = { upSwing, inZone, hi, lo }; } }
      const signals = [];
      const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857;
      if (vol !== null && vol < .0009 && deep) signals.push(["reversion-v6", s > 0 ? "BUY" : "SELL", null]);
      const v3ok = vol !== null && vol < .0012 && ((s > .22 && mom120 !== null && mom120 > 0) || (s < -.22 && mom120 !== null && mom120 < 0));
      if (v3ok && fibDir && fibDir.inZone) { const dir = s > 0 ? "BUY" : "SELL"; if ((dir === "BUY" && fibDir.upSwing) || (dir === "SELL" && !fibDir.upSwing)) signals.push(["reversion-v3-fib", dir, { hi: fibDir.hi, lo: fibDir.lo }]); }
      if (!signals.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const [st, dir, meta] of signals) trades.push({ st, dir, asset: group[0].a, t: ref.t, h, result: outcome(dir, ref.v, settle.v), entry: ref.v, exit: settle.v, entryIso: new Date(ref.t).toISOString(), exitIso: new Date(settle.t).toISOString(), meta });
      }
    }
  }
  await c.end();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const csv = (name, arr) => { const lines = ["strategy,asset,direction,entry_iso,entry_price,exit_iso,exit_price,horizon_s,result"]; for (const x of [...arr].sort((a, b) => a.t - b.t)) lines.push([x.st, x.asset, x.dir, x.entryIso, x.entry, x.exitIso, x.exit, x.h / 1000, x.result].join(",")); fs.writeFileSync(path.join(OUT_DIR, name), lines.join("\n"), "utf8"); };
  const report = {};
  for (const st of ["reversion-v3-fib", "reversion-v6"]) {
    for (const h of [45_000, 60_000]) {
      const all = trades.filter((x) => x.st === st && x.h === h);
      const eurnzd = all.filter((x) => x.asset === "EUR/NZD");
      report[`${st}|T+${h / 1000}|all`] = stats(all);
      report[`${st}|T+${h / 1000}|eurNzd`] = stats(eurnzd);
      const latest = h === 60_000 ? [...all].sort((a, b) => b.t - a.t).slice(0, 100) : null;
      const latestNz = h === 60_000 ? [...eurnzd].sort((a, b) => b.t - a.t).slice(0, 100) : null;
      if (h === 60_000) {
        csv(`${st}-t60-all.csv`, all);
        csv(`${st}-t60-eurnzd.csv`, eurnzd);
        report[`${st}|T+60|latest100all`] = stats(latest);
        report[`${st}|T+60|latest100eurNzd`] = stats(latestNz);
      }
    }
  }
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, "compare-report.json"), JSON.stringify(report, null, 1), "utf8");
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });