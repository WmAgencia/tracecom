const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const OUT_DIR = process.env.OUT_DIR || ".";
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
const rsiAt = (closes, end, p = 14) => { if (end < p) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
function buildCandles(obs) { const m = new Map(); for (const o of obs) { const b = Math.floor(o.t / BUCKET) * BUCKET; const c = m.get(b); if (!c) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); }
const outcome = (dir, entry, exit) => (exit === entry ? "DRAW" : dir === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
const stats = (arr) => { const w = arr.filter((x) => x.result === "WIN").length, l = arr.filter((x) => x.result === "LOSS").length, d = arr.filter((x) => x.result === "DRAW").length; const n = arr.length; return { n, w, l, d, wr: w + l ? +((w / (w + l)) * 100).toFixed(1) : null, ci: wilson(w, w + l) }; };
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
      const n = closes.length, c2 = candles.slice(0, i + 1);
      const close = closes[n - 1];
      const ret = (k) => (n > k ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
      const rsi = rsiAt(closes, n - 1, 14);
      const s = rsi === null ? 0 : (55 - rsi) / 45;
      let vol = null; if (n > 13) { const rs = []; for (let j = n - 12; j < n; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]); const m = rs.reduce((x, y) => x + y, 0) / rs.length; vol = Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / rs.length); }
      // v3 base
      const mom120 = ret(24);
      const up = mom120 !== null && mom120 > 0, dn = mom120 !== null && mom120 < 0;
      const v3Buy = vol !== null && vol < .0012 && s > .22 && up;
      const v3Sell = vol !== null && vol < .0012 && s < -.22 && dn;
      // v1 base
      const v1Buy = vol !== null && vol < .0009 && s > .33;
      const v1Sell = vol !== null && vol < .0009 && s < -.33;
      // fib (direction-aware)
      let fibOk = false;
      if (i >= 24) { const w = c2.slice(i - 23, i + 1); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low)); const range = hi - lo; if (range > 0) { let hiIdx = -1, loIdx = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && hiIdx === -1) hiIdx = j; if (w[j].low === lo && loIdx === -1) loIdx = j; } const upSwing = loIdx <= hiIdx; const lv382 = upSwing ? hi - range * .382 : lo + range * .382, lv618 = upSwing ? hi - range * .618 : lo + range * .618; const zHi = Math.max(lv382, lv618), zLo = Math.min(lv382, lv618); const inZone = close <= zHi && close >= zLo; fibOk = { upSwing, inZone }; } }
      // vwap (twap60)
      let vwOk = false; if (n >= 60) { const w = closes.slice(-60); const twap = w.reduce((x, y) => x + y, 0) / w.length; vwOk = Math.abs(close - twap) / close < 0.0006; }
      const dirs = [];
      if (v3Buy && fibOk && fibOk.upSwing && fibOk.inZone) dirs.push(["reversion-v3-fib", "BUY"]);
      if (v3Sell && fibOk && !fibOk.upSwing && fibOk.inZone) dirs.push(["reversion-v3-fib", "SELL"]);
      if (v1Buy && vwOk) dirs.push(["reversion-v1-vwap", "BUY"]);
      if (v1Sell && vwOk) dirs.push(["reversion-v1-vwap", "SELL"]);
      if (!dirs.length) continue;
      const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop() ?? group[0];
      for (const h of [45_000, 60_000]) {
        const settle = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
        if (!settle) continue;
        for (const [st, dir] of dirs) trades.push({ st, dir, asset: group[0].a, t: ref.t, h, result: outcome(dir, ref.v, settle.v), entry: ref.v, exit: settle.v });
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {};
  for (const st of ["reversion-v3-fib", "reversion-v1-vwap"]) {
    for (const h of [45_000, 60_000]) {
      const all = trades.filter((x) => x.st === st && x.h === h).sort((a, b) => a.t - b.t);
      if (!all.length) continue;
      const latest = [...all].sort((a, b) => b.t - a.t).slice(0, 100);
      const mid = all[Math.floor(all.length / 2)]?.t ?? 0;
      const detail = {
        all: stats(all),
        latest100: stats(latest),
        buy: stats(all.filter((x) => x.dir === "BUY")),
        sell: stats(all.filter((x) => x.dir === "SELL")),
        firstHalf: stats(all.filter((x) => x.t < mid)),
        secondHalf: stats(all.filter((x) => x.t >= mid)),
        byAsset: {},
      };
      for (const a of ["EUR/NZD", "EUR/USD", "NZD/USD"]) { const arr = all.filter((x) => x.asset === a); if (arr.length) detail.byAsset[a] = stats(arr); }
      report[`${st}|T+${h / 1000}`] = detail;
      if (latest.length) {
        const lines = ["strategy,asset,direction,reference_iso,horizon_s,result"];
        for (const x of [...latest].sort((a, b) => a.t - b.t)) lines.push([x.st, x.asset, x.dir, new Date(x.t).toISOString(), x.h / 1000, x.result].join(","));
        fs.writeFileSync(path.join(OUT_DIR, `${st}-t${h / 1000}.csv`), lines.join("\n"), "utf8");
      }
    }
  }
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, "deep-dive-two-combos.json"), JSON.stringify(report, null, 1), "utf8");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });