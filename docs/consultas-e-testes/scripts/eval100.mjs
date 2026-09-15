process.env.FWD4_NO_AUTOSTART = "1";
import pg from "pg";
import fs from "node:fs";
const { Client } = pg;
const { buildCandles, featuresAt, signalsFor } = await import("file:///C:/tracecom-forward4/index.mjs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000;
const STRATEGIES = ["reversion-v1-fib", "reversion-v3-fib", "reversion-v2-fib", "stochrsi-v1"];
const LABEL = { "reversion-v1-fib": "A (v1+fib)", "reversion-v3-fib": "B (v3+fib)", "reversion-v2-fib": "C (v2+fib)", "stochrsi-v1": "D (stochrsi)" };
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
const stats = (arr) => { const w = arr.filter((x) => x === "WIN").length, l = arr.filter((x) => x === "LOSS").length, d = arr.filter((x) => x === "DRAW").length; return { n: arr.length, w, l, d, wr: w + l ? +((w / (w + l)) * 100).toFixed(1) : null, ci: wilson(w, w + l) }; };
(async () => {
  await c.connect();
  const rows = (await c.query("SELECT session_id, segment_id, price_observation_id, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE status='ACCEPTED' AND asset_canonical='EUR/NZD' AND market_type='OTC' AND context_validation_status='VALID' ORDER BY observed_at ASC")).rows.map((r) => ({ s: r.session_id, g: r.segment_id, id: r.price_observation_id, v: Number(r.v), t: Number(r.t) }));
  console.log(`obs EUR/NZD = ${rows.length}`);
  const groups = new Map();
  for (const o of rows) { if (!groups.has(o.s)) groups.set(o.s, []); groups.get(o.s).push(o); }
  const collect = {}; for (const st of STRATEGIES) collect[st] = [];
  for (const group of groups.values()) {
    const candles = buildCandles(group);
    for (let i = MIN_CANDLES; i < candles.length; i++) {
      const f = featuresAt(candles, i);
      for (const st of STRATEGIES) {
        const dirs = signalsFor(f, st); if (!dirs.length) continue;
        const ref = group.filter((o) => o.t <= candles[i].start + BUCKET).pop(); if (!ref) continue;
        const rec = { t: ref.t, side: dirs[0], asset: "EUR/NZD", h45: null, h60: null };
        for (const [key, h] of [["h45", 45_000], ["h60", 60_000]]) {
          const s = group.find((o) => o.t >= ref.t + h && o.t <= ref.t + h + TOL);
          if (!s) continue;
          rec[key] = s.v === ref.v ? "DRAW" : dirs[0] === "BUY" ? (s.v > ref.v ? "WIN" : "LOSS") : (s.v < ref.v ? "WIN" : "LOSS");
        }
        collect[st].push(rec);
      }
    }
  }
  const report = {};
  for (const st of STRATEGIES) {
    const all = collect[st];
    const t45 = all.filter((x) => x.h45).sort((a, b) => b.t - a.t).slice(0, 100);
    const t60 = all.filter((x) => x.h60).sort((a, b) => b.t - a.t).slice(0, 100);
    const buy45 = t45.filter((x) => x.side === "BUY").map((x) => x.h45);
    const sell45 = t45.filter((x) => x.side === "SELL").map((x) => x.h45);
    const buy60 = t60.filter((x) => x.side === "BUY").map((x) => x.h60);
    const sell60 = t60.filter((x) => x.side === "SELL").map((x) => x.h60);
    report[st] = { totalSignals: all.length, t45: stats(t45.map((x) => x.h45)), t60: stats(t60.map((x) => x.h60)), buy45: stats(buy45), sell45: stats(sell45), buy60: stats(buy60), sell60: stats(sell60) };
    const r = report[st];
    console.log(`\n${LABEL[st]} | sinais=${r.totalSignals}`);
    console.log(`  T+45s: n=${r.t45.n} W=${r.t45.w} L=${r.t45.l} D=${r.t45.d} WR=${r.t45.wr}% IC=${r.t45.ci ? r.t45.ci.join("..") : "-"}`);
    console.log(`  T+60s: n=${r.t60.n} W=${r.t60.w} L=${r.t60.l} D=${r.t60.d} WR=${r.t60.wr}% IC=${r.t60.ci ? r.t60.ci.join("..") : "-"}`);
    console.log(`  BUY  45s: n=${r.buy45.n} W=${r.buy45.w} L=${r.buy45.l} WR=${r.buy45.wr}% | 60s: n=${r.buy60.n} W=${r.buy60.w} L=${r.buy60.l} WR=${r.buy60.wr}%`);
    console.log(`  SELL 45s: n=${r.sell45.n} W=${r.sell45.w} L=${r.sell45.l} WR=${r.sell45.wr}% | 60s: n=${r.sell60.n} W=${r.sell60.w} L=${r.sell60.l} WR=${r.sell60.wr}%`);
  }
  fs.writeFileSync(process.env.OUT_PATH || "eval100.json", JSON.stringify(report, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });