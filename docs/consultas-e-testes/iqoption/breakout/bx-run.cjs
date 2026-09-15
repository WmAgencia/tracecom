// bx-run.cjs — DISCOVERY: features BX causais + grade pré-registrada de hipóteses de rompimento/estrutura
// nas 10h existentes (BINARY e OTC separados). Freeze ANTES de avaliar. BH-FDR. Pareto WR×frequência×indepN.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
async function getText(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return await r.text(); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail " + r.status); await new Promise((x) => setTimeout(x, 1200)); } }
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const BX = require(OUT + "/bx-lib.cjs");
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
function tickAggFromCombined(file) { const comb = JSON.parse(fs.readFileSync(OUT + "/" + file, "utf8")); const agg = new Map(); let prev = null; for (const t of comb.data) { const b = Math.floor(t.ts / 5000) * 5000; let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += (t.ask - t.bid); a.spreadN += 1; } const v = t.value != null ? t.value : (t.bid + t.ask) / 2; if (prev !== null) { if (v > prev) a.up += 1; else if (v < prev) a.dn += 1; } prev = v; } return agg; }
(async () => {
  const runAll = await getText("https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildRows }; ")(require, __dirname);
  // GRADE PRÉ-REGISTRADA (congelada antes de qualquer avaliação)
  const H = [];
  const add = (id, family, spec) => H.push({ id, family, spec });
  for (const N of [12, 24, 48, 96]) for (const minD of [0, 0.15, 0.3]) for (const quality of ["none", "body", "clv"]) add(`brk_${N}_${minD}_${quality}`, "A_breakout", { type: "brk", N: "N" + N, minD, quality });
  for (const minD of [0.1, 0.25]) add(`fb_${minD}`, "B_falsebreak", { type: "fb", minD });
  for (const minR2 of [0.5, 0.7]) { add(`tlbrk_${minR2}`, "A_trendline", { type: "tl", mode: "break", minR2 }); add(`tlrej_${minR2}`, "A_trendline", { type: "tl", mode: "reject", minR2 }); }
  add("bos", "C_structure", { type: "bos", kind: "bos" }); add("choch", "C_structure", { type: "bos", kind: "choch" }); add("sweep", "C_structure", { type: "bos", kind: "sweep" });
  for (const N of ["N24", "N48"]) for (const maxComp of [0.7, 0.8]) for (const needExp of [false, true]) add(`comp_${N}_${maxComp}_${needExp ? "exp" : "noexp"}`, "D_compression", { type: "comp", N, maxComp, needExp });
  add("retest_cont", "B_retest", { type: "bos", kind: "retest" });
  const baseFns = {
    brk24up: (r, i) => r[i].f.brkN24up, brk24dn: (r, i) => r[i].f.brkN24dn, brk48up: (r, i) => r[i].f.brkN48up, brk48dn: (r, i) => r[i].f.brkN48dn,
    bosUp: (r, i) => r[i].f.bosUp, bosDn: (r, i) => r[i].f.bosDn, sweepUp: (r, i) => r[i].f.sweepUp, sweepDn: (r, i) => r[i].f.sweepDn,
    fbUp: (r, i) => r[i].f.fbUp, fbDn: (r, i) => r[i].f.fbDn, retestUp: (r, i) => r[i].f.retestUp, retestDn: (r, i) => r[i].f.retestDn,
  };
  const dirMap = { brk24up: 1, brk24dn: -1, brk48up: 1, brk48dn: -1, bosUp: 1, bosDn: -1, sweepUp: -1, sweepDn: 1, fbUp: -1, fbDn: 1, retestUp: 1, retestDn: -1 };
  for (const bn of Object.keys(baseFns)) { const dir = dirMap[bn]; for (const cond of ["rsi", "mom12", "imb"]) add(`gate_${bn}_${cond}`, "F_combos", { type: "gate", baseName: bn, dir, condName: cond }); }
  add("baseline_always_buy", "G0_baseline", { type: "always", dir: 1 }); add("baseline_always_sell", "G0_baseline", { type: "always", dir: -1 });
  const freeze = { generated_at: new Date().toISOString(), engine: "bx-lib.cjs (features causais) + run-all v2 (base)", hypotheses: H.map((h) => ({ ...h, hash: sha16(h.spec) })), totals: { K: H.length, by_family: H.reduce((m, h) => { m[h.family] = (m[h.family] || 0) + 1; return m; }, {}) } };
  fs.writeFileSync(OUT + "/bx-freeze.json", JSON.stringify(freeze, null, 1));
  console.log("FREEZE BX: K=" + H.length + " " + JSON.stringify(freeze.totals.by_family));
  // DISCOVERY nos dois datasets
  const out = { generated_at: new Date().toISOString(), freeze_K: H.length, datasets: {} };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", comb: "combined_binary_1.json" }, { id: "IQOPTION_EURUSD_OTC_10H", comb: "combined_otc_76.json" }]) {
    const rowsDb = [];
    for (let off = 0; ; off += 3000) { const p = await sql(`SELECT EXTRACT(EPOCH FROM bucket)*1000 AS b, open, high, low, close, tick_count FROM iqopt_candles_5s WHERE dataset_id='${ds.id}' ORDER BY bucket LIMIT 3000 OFFSET ${off};`); rowsDb.push(...p); if (p.length < 3000) break; }
    const candles = rowsDb.map((r) => ({ bucket: Number(r.b), open: +r.open, high: +r.high, low: +r.low, close: +r.close, n: +r.tick_count }));
    const tickAgg = tickAggFromCombined(ds.comb);
    const base = engine.buildRows(candles);
    const rows = [];
    for (let k = 0; k < base.length; k++) { const i = 30 + k; const bx = BX.bxFeaturesAt(candles, i, tickAgg); if (!bx) continue; rows.push({ t0: base[k].t0, entry: base[k].entry, l60: base[k].l60, f: { ...base[k].f, ...bx } }); }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0; for (const r of rows) { if (r.l60 === 1) up += 1; else if (r.l60 === -1) dn += 1; }
    const baseP = up / (up + dn);
    // causalidade: truncamento em 25 índices (features BX)
    let causOk = true;
    for (let t = 0; t < 25; t++) { const i = 40 + Math.floor(Math.random() * (candles.length - 100)); const a = BX.bxFeaturesAt(candles, i, tickAgg), b = BX.bxFeaturesAt(candles.slice(0, i + 1), i, tickAgg); if (JSON.stringify(a) !== JSON.stringify(b)) { causOk = false; break; } }
    console.log(`${ds.id}: rows=${rows.length} indep=${rows.filter((r) => r.indep).length} baseP=${(baseP * 100).toFixed(2)}% causalidadeBX=${causOk ? "PASS" : "FAIL"}`);
    if (!causOk) throw new Error("CAUSALIDADE BX FALHOU");
    const res = [];
    for (const h of H) {
      let v;
      if (h.spec.type === "always") { v = new Int8Array(rows.length); v.fill(h.spec.dir); }
      else v = BX.compileBx(h.spec, rows);
      const m = BX.metrics(v, rows, baseP);
      const spec = { ...h.spec }; delete spec.base;
      res.push({ id: h.id, family: h.family, hash: h.hash, spec, metrics: m });
    }
    // BH-FDR por z (hipóteses não-baseline)
    const test = res.filter((r) => r.family !== "G0_baseline" && r.metrics.z !== null);
    const withP = test.map((r) => ({ r, p: 1 - normCdf(r.metrics.z) })).sort((a, b) => a.p - b.p);
    let prevQ = 1; for (let i = withP.length - 1; i >= 0; i--) { const q = Math.min(prevQ, withP[i].p * withP.length / (i + 1)); withP[i].r.q = +q.toFixed(4); prevQ = q; }
    for (const r of res) if (r.q === undefined) r.q = null;
    res.sort((a, b) => (b.metrics.wilsonLo ?? -1) - (a.metrics.wilsonLo ?? -1));
    // barras de amostra
    const bars = {}; for (const min of [50, 100, 250, 500, 1000]) { const ok = res.filter((r) => r.family !== "G0_baseline" && r.metrics.signals >= min && r.metrics.wr >= 60); bars["n>=" + min] = { comWR60: ok.length, best: ok.slice(0, 3).map((r) => `${r.id}:${r.metrics.wr}% n=${r.metrics.signals} indep=${r.metrics.indepN}/${r.metrics.indepWR}`) }; }
    out.datasets[ds.id] = { rows: rows.length, indep: rows.filter((r) => r.indep).length, baseP: +(baseP * 100).toFixed(2), K: H.length, tested: res.length, bars, pareto: res.filter((r) => r.family !== "G0_baseline" && r.metrics.indepN >= 10).map((r) => ({ id: r.id, wr: r.metrics.wr, sigPerHour: r.metrics.sigPerHour, indepN: r.metrics.indepN, indepWR: r.metrics.indepWR, wilsonLo: r.metrics.wilsonLo })), strategies: res };
    console.log(`TOP 8 por WilsonLo (indepN>=15):`);
    for (const r of res.filter((x) => x.metrics.indepN >= 15).slice(0, 8)) console.log(`  ${r.id} | sig=${r.metrics.signals} (${r.metrics.sigPerHour}/h) WR=${r.metrics.wr}% BUY ${r.metrics.buyWR}% SELL ${r.metrics.sellWR}% | indep ${r.metrics.indepN}/${r.metrics.indepWR}% | edge ${r.metrics.edge_pp}pp | q=${r.q}`);
    const w70 = res.filter((x) => x.metrics.wr >= 70 && x.metrics.signals >= 50);
    console.log(`  >=70% com n>=50: ${w70.length ? w70.map((x) => `${x.id}(${x.metrics.wr}% n=${x.metrics.signals} indep=${x.metrics.indepN})`).join(" ") : "NENHUMA"}`);
  }
  fs.writeFileSync(OUT + "/bx-discovery-results.json", JSON.stringify(out));
  console.log("DONE bx-discovery-results.json");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
