// benchmark.cjs — avaliação COMPLETA de todas as estratégias existentes do projeto contra o dataset IQ Option 10h.
// - Engine: run-all.cjs v2 (causal, do GitHub) — extraída e executada sem modificação.
// - Dados: iqopt_candles_5s no Supabase (Management API; token via env SUPABASE_ACCESS_TOKEN).
// - Freeze: hash por spec ANTES da avaliação (write benchmark-freeze.json).
// - Grupos: G1 produção (prod_* + finalistas + v2fib), G2 hipóteses pré-existentes (977 do gauntlet), G3 combos exploratórios novos (pares mecânicos + BH-FDR).
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("SUPABASE_ACCESS_TOKEN ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const GH = "https://raw.githubusercontent.com/WmAgencia/tracecom/main";
async function getText(url) { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return await r.text(); }
async function getJson(url) { return JSON.parse(await getText(url)); }
async function sql(query) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }); if (r.ok) return await r.json(); const b = await r.text(); if (a === 2) throw new Error("SQL fail " + r.status + ": " + b.slice(0, 200)); await new Promise((x) => setTimeout(x, 1200)); } }
function sha16(s) { return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16); }
(async () => {
  // 1) engine v2 (frozen, causal) extraída do run-all.cjs publicado
  const runAll = await getText(GH + "/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const cut = runAll.indexOf("(async () => {");
  if (cut < 0) throw new Error("run-all.cjs sem IIFE esperado");
  const prefix = runAll.slice(0, cut);
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildCandles, buildRows, featuresAt }; ")(require, __dirname);
  console.log("engine v2 carregada (run-all.cjs publicado)");
  // 2) dados do Supabase
  const datasets = [];
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", otc: false, active: 1 }, { id: "IQOPTION_EURUSD_OTC_10H", otc: true, active: 76 }]) {
    const rows = [];
    for (let off = 0; ; off += 3000) {
      const part = await sql(`SELECT EXTRACT(EPOCH FROM bucket)*1000 AS bucket_ms, open, high, low, close, tick_count FROM iqopt_candles_5s WHERE dataset_id='${ds.id}' ORDER BY bucket LIMIT 3000 OFFSET ${off};`);
      rows.push(...part);
      if (part.length < 3000) break;
    }
    const candles = rows.map((r) => ({ bucket: Number(r.bucket_ms), open: +r.open, high: +r.high, low: +r.low, close: +r.close, n: +r.tick_count }));
    console.log(`${ds.id}: candles=${candles.length}`);
    const fr = engine.buildRows(candles);
    // 3) teste de causalidade (truncamento)
    let ok = true, checked = 0;
    for (let t = 0; t < 50; t++) {
      const i = 30 + Math.floor(Math.random() * (candles.length - 60));
      const a = engine.featuresAt(candles, i);
      const b = engine.featuresAt(candles.slice(0, i + 1), i);
      if (JSON.stringify(a) !== JSON.stringify(b)) { ok = false; break; }
      checked += 1;
    }
    console.log(`  causalidade (truncamento): ${ok ? "PASS" : "FAIL"} (${checked}/50)`);
    if (!ok) throw new Error("CAUSALIDADE FALHOU — abortar");
    // indep 90s
    let last = -1e18;
    for (const r of fr) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0, draw = 0, unk = 0;
    for (const r of fr) { if (r.l60 === null) unk += 1; else if (r.l60 === 0) draw += 1; else if (r.l60 === 1) up += 1; else dn += 1; }
    datasets.push({ ...ds, rows: fr, baseP: up / (up + dn), counts: { up, dn, draw, unk, total: fr.length, indep: fr.filter((r) => r.indep).length } });
  }
  // 4) inventário
  const searchLog = (await getText(GH + "/docs/consultas-e-testes/gauntlet/search-log.jsonl")).trim().split("\n").map((l) => JSON.parse(l));
  const manifest = await getJson(GH + "/docs/consultas-e-testes/gauntlet/finalists-manifest.json");
  let trace1m = "INCOMPATIVEL: extension/local-engine.js é engine realtime de página (1m, browser-bound); não é função pura executável sobre candles históricos — documentado, não testado.";
  try { const le = await getText(GH + "/extension/local-engine.js"); if (/\bdecide\w*\s*\(/.test(le) === false) trace1m = "INCOMPATIVEL: local-engine.js sem função de decisão pura exportável (realtime/page-bound)."; } catch { }
  const defs = new Map();
  const addDef = (id, group, family, spec) => { const h = sha16(JSON.stringify(spec)); if (!defs.has(h)) defs.set(h, { strategy_id: id, group, family, spec, hash: h }); return h; };
  for (const e of searchLog) { const g = e.family === "production" ? "G1_producao" : (e.family === "baseline" ? "G0_baseline" : "G2_pre_existente"); addDef(e.id, g, e.family, e.spec); }
  for (const f of manifest.finalists) addDef("finalist:" + f.id, "G1_producao", "finalist", f.spec);
  addDef("prod_v2fib", "G1_producao", "production", { op: "gateFib", innerSpec: { type: "rsi_vol", t: 0.22, v: 0.0012 } });
  const all = [...defs.values()];
  const freeze = { generated_at: new Date().toISOString(), engine: "run-all.cjs v2 causal (GitHub, extraída sem modificação)", data_source: "Supabase iqopt_candles_5s (persistido e verificado por critic v2)", hash_rule: "sha256(JSON.stringify(spec)).slice(0,16)", trace1m, totals: { unique_specs: all.length, by_group: all.reduce((m, d) => { m[d.group] = (m[d.group] || 0) + 1; return m; }, {}) }, strategies: all };
  fs.writeFileSync(OUT + "/benchmark-freeze.json", JSON.stringify(freeze, null, 1));
  console.log("FREEZE: " + JSON.stringify(freeze.totals));
  // 5) avaliação G0/G1/G2
  const GC = require(OUT + "/gauntlet-compile.cjs");
  function metrics(v, rows, baseP) {
    let sig = 0, b = 0, s = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, in_ = 0;
    let curW = 0, curL = 0, maxW = 0, maxL = 0;
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; sig += 1; if (x === 1) b += 1; else s += 1; const y = rows[i].l60; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { in_ += 1; if (win) iw += 1; else il += 1; } }
    const n = w + l; const wr = n ? w / n : null; const bn = bw + bl, sn = sw + sl;
    const baseStrategy = sig ? (b * baseP + s * (1 - baseP)) / sig : null;
    const edge = n && baseStrategy !== null ? wr - baseStrategy : null;
    let ci = null, z = null;
    if (n >= 20 && baseStrategy !== null) { const p = wr, se = Math.sqrt(p * (1 - p) / n); ci = [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)]; z = (w - baseStrategy * n) / Math.sqrt(n * baseStrategy * (1 - baseStrategy)); }
    const ev = {}; for (const po of [0.7, 0.75, 0.8, 0.85, 0.9]) ev[String(po)] = wr === null ? null : +(wr * po - (1 - wr)).toFixed(4);
    return { signals: sig, buyN: b, sellN: s, w, l, draws: d, unknown: u, wr_no_draws: wr === null ? null : +(wr * 100).toFixed(2), wr_total: sig ? +((w / sig) * 100).toFixed(2) : null, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, freq: +(sig / rows.length).toFixed(4), baseStrategy: baseStrategy === null ? null : +(baseStrategy * 100).toFixed(2), edge_pp: edge === null ? null : +(edge * 100).toFixed(2), ci95: ci ? ci.map((x) => +(x * 100).toFixed(2)) : null, z, indep_n: in_, indep_wr: in_ ? +((iw / in_) * 100).toFixed(2) : null, max_win_streak: maxW, max_loss_streak: maxL, expectancy: ev, breakeven_wr: Object.fromEntries([0.7, 0.75, 0.8, 0.85, 0.9].map((po) => [String(po), +((1 / (1 + po)) * 100).toFixed(2)])) };
  }
  const results = { generated_at: new Date().toISOString(), freeze_totals: freeze.totals, datasets: {} };
  for (const ds of datasets) {
    const ctx = GC.loadCtx(ds.rows.map((r) => ({ split: "IQEXT", indep: r.indep, asset: ds.otc ? "EUR/USD/OTC" : "EUR/USD", t0: r.t0, l60: r.l60, f: r.f })));
    const arr = []; let invalid = 0;
    for (const defn of all) {
      if (defn.group === "G0_baseline") continue;
      let v; try { v = GC.compile(defn.spec, ctx); } catch (e) { invalid += 1; arr.push({ ...defn, invalid: true, error: e.message }); continue; }
      arr.push({ ...defn, metrics: metrics(v, ds.rows, ds.baseP) });
    }
    arr.sort((a, b) => (b.metrics ? (b.metrics.z ?? -99) : -99) - (a.metrics ? (a.metrics.z ?? -99) : -99));
    results.datasets[ds.id] = { base_market_p_up: +(ds.baseP * 100).toFixed(2), counts: ds.counts, tested: arr.length, invalid, strategies: arr };
    console.log(`\n=== ${ds.id} | base up=${(ds.baseP * 100).toFixed(2)}% | testadas=${arr.length} | invalidas=${invalid}`);
    console.log("TOP 12 por z-score (n>=50):");
    for (const e of arr.filter((x) => x.metrics && x.metrics.w + x.metrics.l >= 50).slice(0, 12)) {
      const m = e.metrics; console.log(`  z=${m.z === null ? "-" : m.z.toFixed(2)} | ${e.strategy_id} | sig=${m.signals} W=${m.w} L=${m.l} WR=${m.wr_no_draws}% (base ${m.baseStrategy}%, edge ${m.edge_pp}pp) BUY ${m.buyWR}% SELL ${m.sellWR}%`);
    }
    console.log("  (grupos: " + JSON.stringify(all.reduce((mm, d) => { mm[d.group] = (mm[d.group] || 0) + 1; return mm; }, {})) + ")");
  }
  // 6) combos exploratórios novos (G3): pares entre átomos com >=100 sinais em pelo menos um dataset
  const atomSpecs = all.filter((d) => d.group === "G2_pre_existente" && ["reversion", "trend", "momentum", "volatility", "regime", "price-action", "structure", "fibonacci", "support-resistance", "divergence"].includes(d.family));
  const activeAtomIds = new Set();
  for (const dsId of Object.keys(results.datasets)) { const arr = results.datasets[dsId].strategies; for (const a of atomSpecs) { const r = arr.find((x) => x.hash === a.hash); if (r && r.metrics && r.metrics.signals >= 100) activeAtomIds.add(a.hash); } }
  const atoms = atomSpecs.filter((a) => activeAtomIds.has(a.hash));
  console.log(`\nG3 combos: ${atoms.length} átomos ativos (>=100 sinais em algum dataset)`);
  const comboDefs = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    comboDefs.push({ strategy_id: `and(${atoms[i].strategy_id},${atoms[j].strategy_id})`, group: "G3_exploratorio", family: "combo-2-and", spec: { op: "and", aSpec: atoms[i].spec, bSpec: atoms[j].spec } });
    comboDefs.push({ strategy_id: `union(${atoms[i].strategy_id},${atoms[j].strategy_id})`, group: "G3_exploratorio", family: "combo-2-union", spec: { op: "union", aSpec: atoms[i].spec, bSpec: atoms[j].spec } });
  }
  const comboFreeze = { generated_at: new Date().toISOString(), criterion: "átomos com >=100 sinais em >=1 dataset (mecânico, registrado)", atoms: atoms.length, hypotheses: comboDefs.length, defs: comboDefs.map((d) => ({ ...d, hash: sha16(JSON.stringify(d.spec)) })) };
  fs.writeFileSync(OUT + "/benchmark-combos-freeze.json", JSON.stringify(comboFreeze, null, 1));
  console.log(`G3: ${comboDefs.length} hipóteses geradas (freeze salvo antes de avaliar)`);
  const comboResults = { generated_at: new Date().toISOString(), hypotheses: comboDefs.length, datasets: {} };
  const phiInv = (p) => Math.sqrt(2) * erfInv(2 * p - 1);
  function erfInv(x) { const a = 0.147; const l = Math.log(1 - x * x); const t1 = 2 / (Math.PI * a) + l / 2; return Math.sign(x) * Math.sqrt(Math.sqrt(t1 * t1 - l / a) - t1); }
  for (const ds of datasets) {
    const ctx = GC.loadCtx(ds.rows.map((r) => ({ split: "IQEXT", indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const arr = [];
    for (const d of comboDefs) { let v; try { v = GC.compile(d.spec, ctx); } catch (e) { continue; } const m = metrics(v, ds.rows, ds.baseP); arr.push({ ...d, hash: sha16(JSON.stringify(d.spec)), metrics: m }); }
    // BH-FDR sobre p unilateral (z)
    const withZ = arr.filter((x) => x.metrics.z !== null);
    const withP = withZ.map((x) => ({ x, p: 1 - normCdf(x.metrics.z) })).sort((a, b) => a.p - b.p);
    const mK = withP.length; let prevQ = 1;
    for (let i = mK - 1; i >= 0; i--) { const q = Math.min(prevQ, withP[i].p * mK / (i + 1)); withP[i].x.q = +q.toFixed(4); prevQ = q; }
    for (const x of arr) if (x.q === undefined) x.q = null;
    arr.sort((a, b) => (b.metrics.z ?? -99) - (a.metrics.z ?? -99));
    const survivors = arr.filter((x) => x.q !== null && x.q <= 0.1 && x.metrics.w + x.metrics.l >= 100);
    comboResults.datasets[ds.id] = { K: arr.length, q10_survivors_n100: survivors.length, survivors: survivors.slice(0, 20), top50: arr.slice(0, 50) };
    console.log(`${ds.id}: G3 K=${arr.length} sobreviventes q<=0.1 & n>=100: ${survivors.length}`);
    for (const sv of survivors.slice(0, 6)) console.log(`  q=${sv.q} | ${sv.strategy_id} | sig=${sv.metrics.signals} WR=${sv.metrics.wr_no_draws}% edge=${sv.metrics.edge_pp}pp z=${sv.metrics.z.toFixed(2)}`);
  }
  function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  fs.writeFileSync(OUT + "/benchmark-results.json", JSON.stringify(results));
  fs.writeFileSync(OUT + "/benchmark-combos-results.json", JSON.stringify(comboResults));
  console.log("\nartefatos locais: benchmark-freeze.json, benchmark-results.json, benchmark-combos-freeze.json, benchmark-combos-results.json");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
