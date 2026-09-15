// bx-prosp.cjs — FREEZE dos finalistas (regra pré-registrada) + coleta de dados NOVOS (após a descoberta) + teste cego prospectivo.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function getText(u) { const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return await r.text(); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail " + r.status); await new Promise((x) => setTimeout(x, 1200)); } }
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const BX = require(OUT + "/bx-lib.cjs");
async function fetchQuotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const url = `https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`; const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
async function fetchWindow(active, FROM0, TO0) { let to = TO0, page = 0, byN = new Map(); while (page < 120) { const json = await fetchQuotes(active, FROM0, to); const q = (json.quotes || []).sort((a, b) => a.ts - b.ts); if (!q.length) break; for (const x of q) byN.set(x.n, x); fs.mkdirSync(OUT + "/raw-prosp", { recursive: true }); fs.writeFileSync(`${OUT}/raw-prosp/a${active}_p${String(page).padStart(3, "0")}.json`, JSON.stringify({ active_id: active, requested_from: FROM0, requested_to: to, fetched_at: new Date().toISOString(), count: q.length, payload: json })); if (q[0].ts <= FROM0 + 1000) break; to = q[0].ts - 1; page += 1; await new Promise((r) => setTimeout(r, 300)); } return [...byN.values()].sort((a, b) => a.ts - b.ts); }
(async () => {
  const disc = JSON.parse(fs.readFileSync(OUT + "/bx-discovery-results.json", "utf8"));
  const freezeSrc = JSON.parse(fs.readFileSync(OUT + "/bx-freeze.json", "utf8"));
  const specById = new Map(freezeSrc.hypotheses.map((h) => [h.id, h]));
  // REGRA PRÉ-REGISTRADA: finalistas = top3 por wilsonLo (descoberta) com indepN>=25 e signals>=100, por dataset, excl. baselines
  const finalists = { frozen_at: new Date().toISOString(), rule: "por dataset: excluir G0; exigir indepN>=25 e signals>=100 na descoberta; ordenar por wilsonLo; top 3", datasets: {} };
  for (const dsId of Object.keys(disc.datasets)) {
    const res = disc.datasets[dsId].strategies;
    const cand = res.filter((r) => r.family !== "G0_baseline" && r.metrics.indepN >= 25 && r.metrics.signals >= 100).sort((a, b) => (b.metrics.wilsonLo ?? -1) - (a.metrics.wilsonLo ?? -1));
    finalists.datasets[dsId] = cand.slice(0, 3).map((r) => ({ id: r.id, hash: r.hash, spec: r.spec, discovery: r.metrics, q: r.q }));
  }
  fs.writeFileSync(OUT + "/bx-finalists-freeze.json", JSON.stringify(finalists, null, 1));
  console.log("FREEZE FINALISTAS (" + finalists.frozen_at + "):");
  for (const dsId of Object.keys(finalists.datasets)) for (const f of finalists.datasets[dsId]) console.log(`  ${dsId} | ${f.id} | discovery WR=${f.discovery.wr}% sig=${f.discovery.signals} indep=${f.discovery.indepN}/${f.discovery.indepWR}% | hash=${f.hash}`);
  // PROSPECTIVE: janela NOVA (após a descoberta)
  const DISC_END = Date.parse("2026-09-15T17:01:18.757Z");
  const now = Date.now(); const TO = now - 35 * 60 * 1000;
  if (TO - DISC_END < 40 * 60 * 1000) throw new Error("janela prospectiva muito curta (<40min) — reexecutar mais tarde");
  console.log(`\nPROSPECTIVE window: ${new Date(DISC_END + 1).toISOString()} -> ${new Date(TO).toISOString()} (${((TO - DISC_END) / 3600000).toFixed(2)}h)`);
  const runAll = await getText("https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildRows }; ")(require, __dirname);
  const out = { generated_at: new Date().toISOString(), window: { from: new Date(DISC_END + 1).toISOString(), to: new Date(TO).toISOString(), hours: +((TO - DISC_END) / 3600000).toFixed(2) }, datasets: {}, provenance: "api.iqoption.com/v3/quotes (publico oficial), backward pagination", frozen_finalists_at: finalists.frozen_at };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_PROSP", active: 1, discId: "IQOPTION_EURUSD_BINARY_10H" }, { id: "IQOPTION_EURUSD_OTC_PROSP", active: 76, discId: "IQOPTION_EURUSD_OTC_10H" }]) {
    const ticks = await fetchWindow(ds.active, DISC_END + 1, TO);
    const md5 = crypto.createHash("md5").update(JSON.stringify(ticks.map((q) => [q.ts, q.bid, q.ask]))).digest("hex");
    // candles + tickAgg
    const cmap = new Map(); const agg = new Map(); let prev = null;
    for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
    const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const base = engine.buildRows(candles); const rows = [];
    for (let k = 0; k < base.length; k++) { const i = 30 + k; const bx = BX.bxFeaturesAt(candles, i, agg); if (!bx) continue; rows.push({ t0: base[k].t0, entry: base[k].entry, l60: base[k].l60, f: { ...base[k].f, ...bx } }); }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0; for (const r of rows) { if (r.l60 === 1) up += 1; else if (r.l60 === -1) dn += 1; }
    const baseP = up / (up + dn);
    console.log(`\n===== PROSPECTIVE ${ds.id} ===== ticks=${ticks.length} candles=${candles.length} rows=${rows.length} indep=${rows.filter((r) => r.indep).length} baseP=${(baseP * 100).toFixed(2)}% md5=${md5}`);
    const per = [];
    const evalOne = (id, h) => { const v = BX.compileBx(h.spec, rows); const m = BX.metrics(v, rows, baseP); return { id, spec: h.spec, hash: h.hash, discovery: h.discovery, prospective: m }; };
    for (const f of finalists.datasets[ds.discId]) per.push(evalOne(f.id, f));
    const bbuy = new Int8Array(rows.length); bbuy.fill(1); const bsell = new Int8Array(rows.length); bsell.fill(-1);
    const baselines = { always_buy: BX.metrics(bbuy, rows, baseP), always_sell: BX.metrics(bsell, rows, baseP) };
    for (const p of per) console.log(`  ${p.id} | prosp: sig=${p.prospective.signals} WR=${p.prospective.wr}% BUY ${p.prospective.buyWR}% SELL ${p.prospective.sellWR}% indep ${p.prospective.indepN}/${p.prospective.indepWR}% edge=${p.prospective.edge_pp}pp || disc: WR=${p.discovery.wr}% indep ${p.discovery.indepN}/${p.discovery.indepWR}%`);
    console.log(`  baselines: buy ${baselines.always_buy.wr}% sell ${baselines.always_sell.wr}%`);
    out.datasets[ds.id] = { active: ds.active, ticks: ticks.length, candles: candles.length, rows: rows.length, indep: rows.filter((r) => r.indep).length, baseP: +(baseP * 100).toFixed(2), md5, finalists: per, baselines };
    // PERSISTÊNCIA do dataset prospectivo no Supabase
    await sql(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('${ds.id}','EUR/USD','${ds.active === 76 ? "OTC" : "BINARY"}',${ds.active === 76 ? "true" : "false"},'IQ_OPTION','INSERTING','${new Date(candles[0].bucket).toISOString()}','${new Date(candles[candles.length - 1].bucket).toISOString()}','${JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", source_url: "https://api.iqoption.com/v3/quotes", purpose: "prospective holdout pos-freeze", md5_ts_bid_ask: md5 }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', provenance=EXCLUDED.provenance;`);
    const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('${ds.id}','IQ_OPTION','EUR/USD','${ds.active === 76 ? "OTC" : "BINARY"}',${ds.active === 76 ? "true" : "false"},'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
    for (let i = 0; i < tv.length; i += 3000) { await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 3000).join(",")};`); if (i % 30000 === 0) console.log(`  ticks persistidos ${Math.min(i + 3000, tv.length)}/${tv.length}`); }
    const cv = candles.map((x, idx) => `('${ds.id}','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < candles.length && candles[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
    for (let i = 0; i < cv.length; i += 3000) await sql(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 3000).join(",")};`);
    await sql(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='${ds.id}';`);
    console.log(`  persistido: ${ds.id} (ticks=${ticks.length} candles=${candles.length}) READY`);
  }
  fs.writeFileSync(OUT + "/bx-prospective-results.json", JSON.stringify(out, null, 1));
  // meta no Supabase
  const meta = { run: "bx-2026-09-15", K: disc.freeze_K, finalists: Object.fromEntries(Object.entries(finalists.datasets).map(([k, v]) => [k, v.map((f) => `${f.id}|discWR=${f.discovery.wr}|hash=${f.hash}`)])), prospective: Object.fromEntries(Object.entries(out.datasets).map(([k, v]) => [k, { hours: out.window.hours, finalists: v.finalists.map((f) => `${f.id}|prospWR=${f.prospective.wr}|sig=${f.prospective.signals}`) }])) };
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('bx-breakout-2026-09-15', now(), '${JSON.stringify(meta).replace(/'/g, "''")}'::jsonb, 'bx-lib.cjs + run-all v2 (causal)') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nDONE bx-prospective-results.json + meta Supabase");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
