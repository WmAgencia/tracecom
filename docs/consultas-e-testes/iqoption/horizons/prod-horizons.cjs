// prod-horizons.cjs — V1/V3/V6/V7-AND/V7-OR/V7-Relaxed/V8/V8-all nas 10h, horizontes T+45s, T+60s, T+300s.
// Specs historicas EXATAS (RELATORIO-V7-V8.md + benchmark-freeze): nenhuma alteracao de regra/threshold.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
async function getText(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
const GC = require(OUT + "/gauntlet-compile.cjs");
function wilson(w, n) { if (!n) return [0, 0]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
function evalH(v, rows, baseP, key) {
  let sig = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, iN = 0, b = 0, s2 = 0, mV = 0, mL = 0, cW = 0, cL = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; const y = rows[i][key]; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } sig += 1; if (x === 1) b += 1; else s2 += 1; const win = x === y; if (win) { w += 1; cW += 1; cL = 0; if (cW > mV) mV = cW; } else { l += 1; cL += 1; cW = 0; if (cL > mL) mL = cL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { iN += 1; if (win) iw += 1; else il += 1; } }
  const n = w + l, bn = bw + bl, sn = sw + sl; const wrn = n ? w / n : null; const baseStrategy = sig ? (b * baseP + s2 * (1 - baseP)) / sig : null;
  return { signals: sig, w, l, draws: d, unknown: u, wr: wrn === null ? null : +(wrn * 100).toFixed(2), buyN: b, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellN: s2, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: iN, indepWR: iN ? +((iw / iN) * 100).toFixed(2) : null, edge_pp: wrn !== null && baseStrategy !== null ? +((wrn - baseStrategy) * 100).toFixed(2) : null, ci95: n ? wilson(w, n).map((x) => +(x * 100).toFixed(2)) : null, maxWinStreak: mV, maxLossStreak: mL };
}
(async () => {
  const runAll = await getText("https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildRows }; ")(require, __dirname);
  const SPECS = [
    { id: "V1 (Fib RSI Reversal)", spec: { type: "prod", id: "reversion-v1-fib" }, hash: "70a7bfcb568bec8c" },
    { id: "V3 (Fib Trend Reversal)", spec: { type: "prod", id: "reversion-v3-fib" }, hash: "acf733a866146537" },
    { id: "V6 (Fib Deep Exhaustion)", spec: { type: "prod", id: "reversion-v6-fib" }, hash: "4acbfbe1477cff67" },
    { id: "V7-AND (Dual Exhaustion)", spec: { type: "prod", id: "reversion-v7-and" }, hash: "53173d3e4f31fb4e" },
    { id: "V7-OR (ATR3x OU V1fib)", spec: { op: "union", aSpec: { op: "gateFib", innerSpec: { type: "atr_over", m: 3 } }, bSpec: { type: "prod", id: "reversion-v1-fib" } }, hash: null },
    { id: "V7-Relaxado (ATR1x OU V1fib)", spec: { type: "prod", id: "reversion-v7-relaxed" }, hash: "853c0fb29b71ea6c" },
    { id: "V8 (ATR1x+Fib standalone)", spec: { op: "gateFib", innerSpec: { type: "atr_over", m: 1 } }, hash: null },
    { id: "V8-all (contra-SMA20)", spec: { type: "atr_over", m: 0 }, hash: null },
  ];
  const out = { generated_at: new Date().toISOString(), horizons: ["T+45s", "T+60s", "T+300s"], note: "specs historicas exatas (RELATORIO-V7-V8.md / benchmark-freeze); zero tuning; entry=close em T; settlement=close exato em T+H", datasets: {} };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", otc: false }, { id: "IQOPTION_EURUSD_OTC_10H", otc: true }]) {
    const rowsDb = []; for (let off = 0; ; off += 3000) { const p = await sql(`SELECT EXTRACT(EPOCH FROM bucket)*1000 AS b, open, high, low, close, tick_count FROM iqopt_candles_5s WHERE dataset_id='${ds.id}' ORDER BY bucket LIMIT 3000 OFFSET ${off};`); rowsDb.push(...p); if (p.length < 3000) break; }
    const cd = rowsDb.map((r) => ({ bucket: Number(r.b), open: +r.open, high: +r.high, low: +r.low, close: +r.close, n: +r.tick_count }));
    const byB = new Map(); for (let i = 0; i < cd.length; i++) byB.set(cd[i].bucket, i);
    const base = engine.buildRows(cd);
    const rows = base.map((r) => ({ ...r }));
    for (const r of rows) { for (const [key, off] of [["l45", 45000], ["l300", 300000]]) { const si = byB.get(r.t0 - 5000 + off); r[key] = si === undefined ? null : (cd[si].close === r.entry ? 0 : cd[si].close > r.entry ? 1 : -1); } }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "IQEXT", indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const baseP = {}; for (const key of ["l45", "l60", "l300"]) { let u = 0, dn = 0; for (const r of rows) { if (r[key] === 1) u += 1; else if (r[key] === -1) dn += 1; } baseP[key] = u / (u + dn); }
    console.log(`\n===== ${ds.id} (rows=${rows.length}) baseP: 45s=${(baseP.l45 * 100).toFixed(2)}% 60s=${(baseP.l60 * 100).toFixed(2)}% 300s=${(baseP.l300 * 100).toFixed(2)}% =====`);
    const res = [];
    for (const s of SPECS) {
      let v; try { v = GC.compile(s.spec, ctx); } catch (e) { console.log(`  ${s.id} COMPILE_ERR ${e.message}`); continue; }
      const rec = { id: s.id, hash: s.hash, spec: s.spec, horizons: {} };
      for (const [key, label] of [["l45", "T+45s"], ["l60", "T+60s"], ["l300", "T+300s"]]) rec.horizons[label] = evalH(v, rows, baseP[key], key);
      res.push(rec);
      const h = rec.horizons;
      console.log(`  ${s.id}`);
      console.log(`    45s: sig=${h["T+45s"].signals} WR=${h["T+45s"].wr}% (${h["T+45s"].w}W/${h["T+45s"].l}L/${h["T+45s"].draws}D) BUY ${h["T+45s"].buyWR}% SELL ${h["T+45s"].sellWR}% indep ${h["T+45s"].indepN}/${h["T+45s"].indepWR}% edge=${h["T+45s"].edge_pp}pp ci=[${(h["T+45s"].ci95 || []).join("..")}]`);
      console.log(`    60s: sig=${h["T+60s"].signals} WR=${h["T+60s"].wr}% (${h["T+60s"].w}W/${h["T+60s"].l}L/${h["T+60s"].draws}D) BUY ${h["T+60s"].buyWR}% SELL ${h["T+60s"].sellWR}% indep ${h["T+60s"].indepN}/${h["T+60s"].indepWR}% edge=${h["T+60s"].edge_pp}pp ci=[${(h["T+60s"].ci95 || []).join("..")}]`);
      console.log(`   300s: sig=${h["T+300s"].signals} WR=${h["T+300s"].wr}% (${h["T+300s"].w}W/${h["T+300s"].l}L/${h["T+300s"].draws}D) BUY ${h["T+300s"].buyWR}% SELL ${h["T+300s"].sellWR}% indep ${h["T+300s"].indepN}/${h["T+300s"].indepWR}% edge=${h["T+300s"].edge_pp}pp ci=[${(h["T+300s"].ci95 || []).join("..")}]`);
    }
    out.datasets[ds.id] = { rows: rows.length, baseP: Object.fromEntries(Object.entries(baseP).map(([k, x]) => [k, +(x * 100).toFixed(2)])), results: res };
  }
  fs.mkdirSync(OUT + "/horizons", { recursive: true });
  fs.writeFileSync(OUT + "/horizons/prod-horizons-results.json", JSON.stringify(out, null, 1));
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('prod-horizons-45-60-300-2026-09-16', now(), '${JSON.stringify({ note: "V1/V3/V6/V7AND/V7OR/V7relaxed/V8/V8all nas 10h em T+45/60/300", datasets: Object.fromEntries(Object.entries(out.datasets).map(([k, v]) => [k, v.results.map((r) => ({ id: r.id, wr45: r.horizons["T+45s"].wr, n45: r.horizons["T+45s"].signals, wr60: r.horizons["T+60s"].wr, n60: r.horizons["T+60s"].signals, wr300: r.horizons["T+300s"].wr, n300: r.horizons["T+300s"].signals }))])) }).replace(/'/g, "''")}'::jsonb, 'prod-horizons.cjs') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nDONE prod-horizons-results.json (Supabase meta ok)");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
