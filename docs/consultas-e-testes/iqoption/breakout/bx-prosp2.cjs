// bx-prosp2.cjs — re-avaliação prospectiva pós-fix: 6 finalistas BLIND (congelados antes da janela) + novos finalistas POST-HOC (descobertos após o bugfix; janela já vista — marcados).
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function getText(u) { const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const BX = require(OUT + "/bx-lib.cjs");
async function fetchQuotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const r = await fetch(`https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
async function fetchWindow(active, FROM0, TO0) { let to = TO0, page = 0, byN = new Map(); while (page < 120) { const q = ((await fetchQuotes(active, FROM0, to)).quotes || []).sort((a, b) => a.ts - b.ts); if (!q.length) break; for (const x of q) byN.set(x.n, x); fs.writeFileSync(`${OUT}/raw-prosp2_a${active}_p${String(page).padStart(3, "0")}.json`, JSON.stringify({ active_id: active, from: FROM0, to, count: q.length, fetched_at: new Date().toISOString(), payload: { quotes: q } })); if (q[0].ts <= FROM0 + 1000) break; to = q[0].ts - 1; page += 1; await new Promise((r) => setTimeout(r, 300)); } return [...byN.values()].sort((a, b) => a.ts - b.ts); }
(async () => {
  const blindFreeze = JSON.parse(fs.readFileSync(OUT + "/bx-finalists-freeze-blind.json", "utf8"));
  const disc = JSON.parse(fs.readFileSync(OUT + "/bx-discovery-results.json", "utf8"));
  const newSel = { BINARY: [], OTC: [] };
  for (const dsId of Object.keys(disc.datasets)) { const key = dsId.includes("BINARY") ? "BINARY" : "OTC"; const cand = disc.datasets[dsId].strategies.filter((r) => r.family !== "G0_baseline" && r.metrics.indepN >= 25 && r.metrics.signals >= 100).sort((a, b) => (b.metrics.wilsonLo ?? -1) - (a.metrics.wilsonLo ?? -1)); newSel[key] = cand.slice(0, 3); }
  const DISC_END = Date.parse("2026-09-15T17:01:18.757Z");
  const TO = Date.now() - 35 * 60 * 1000;
  console.log(`extended window: ${new Date(DISC_END + 1).toISOString()} -> ${new Date(TO).toISOString()} (${((TO - DISC_END) / 3600000).toFixed(2)}h)`);
  const runAll = await getText("https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildRows }; ")(require, __dirname);
  const out = { generated_at: new Date().toISOString(), note: "grupo BLIND = congelado 23:23:33Z antes da janela (bx-finalists-freeze-blind.json; avaliação canônica em bx-prospective-results-blind.json na janela curta). Grupo POST-HOC = selecionado APÓS bugfix do compilador; janela já havia sido vista na rodada blind — NÃO é evidência independente.", window: { from: new Date(DISC_END + 1).toISOString(), to: new Date(TO).toISOString(), hours: +((TO - DISC_END) / 3600000).toFixed(2) }, datasets: {} };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_PROSP", active: 1, discId: "IQOPTION_EURUSD_BINARY_10H", key: "BINARY" }, { id: "IQOPTION_EURUSD_OTC_PROSP", active: 76, discId: "IQOPTION_EURUSD_OTC_10H", key: "OTC" }]) {
    const ticks = await fetchWindow(ds.active, DISC_END + 1, TO);
    const cmap = new Map(), agg = new Map(); let prev = null;
    for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
    const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const base = engine.buildRows(candles); const rows = [];
    for (let k = 0; k < base.length; k++) { const i = 30 + k; const bx = BX.bxFeaturesAt(candles, i, agg); if (!bx) continue; rows.push({ t0: base[k].t0, entry: base[k].entry, l60: base[k].l60, f: { ...base[k].f, ...bx } }); }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0; for (const r of rows) { if (r.l60 === 1) up += 1; else if (r.l60 === -1) dn += 1; } const baseP = up / (up + dn);
    console.log(`\n===== ${ds.id} (extended) ticks=${ticks.length} rows=${rows.length} indep=${rows.filter((r) => r.indep).length} baseP=${(baseP * 100).toFixed(2)}%`);
    const blindIds = new Set(blindFreeze.datasets[ds.discId].map((f) => f.id));
    const per = [];
    for (const f of blindFreeze.datasets[ds.discId]) { const h = disc.datasets[ds.discId].strategies.find((r) => r.id === f.id); const spec = h ? h.spec : f.spec; const v = BX.compileBx(spec, rows); per.push({ id: f.id, hash: h ? h.hash : f.hash, group: "BLIND", spec, discovery: f.discovery, prospective: BX.metrics(v, rows, baseP) }); }
    for (const c of newSel[ds.key]) { if (blindIds.has(c.id)) continue; const v = BX.compileBx(c.spec, rows); per.push({ id: c.id, hash: c.hash, group: "POSTHOC", spec: c.spec, discovery: c.metrics, prospective: BX.metrics(v, rows, baseP) }); }
    const bbuy = new Int8Array(rows.length); bbuy.fill(1); const bsell = new Int8Array(rows.length); bsell.fill(-1);
    const baselines = { always_buy: BX.metrics(bbuy, rows, baseP), always_sell: BX.metrics(bsell, rows, baseP) };
    for (const p of per) console.log(`  [${p.group}] ${p.id} | prosp: sig=${p.prospective.signals} WR=${p.prospective.wr}% BUY ${p.prospective.buyWR}% SELL ${p.prospective.sellWR}% indep ${p.prospective.indepN}/${p.prospective.indepWR}% edge=${p.prospective.edge_pp}pp || disc WR=${p.discovery.wr}%`);
    console.log(`  baselines: buy ${baselines.always_buy.wr}% sell ${baselines.always_sell.wr}%`);
    out.datasets[ds.id] = { active: ds.active, ticks: ticks.length, candles: candles.length, rows: rows.length, indep: rows.filter((r) => r.indep).length, baseP: +(baseP * 100).toFixed(2), finalists: per, baselines };
    // persist extended dataset (replace)
    await sql(`DELETE FROM iqopt_raw_ticks WHERE dataset_id='${ds.id}';`);
    await sql(`DELETE FROM iqopt_candles_5s WHERE dataset_id='${ds.id}';`);
    const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('${ds.id}','IQ_OPTION','EUR/USD','${ds.active === 76 ? "OTC" : "BINARY"}',${ds.active === 76 ? "true" : "false"},'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
    for (let i = 0; i < tv.length; i += 3000) await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 3000).join(",")};`);
    const cv = candles.map((x, idx) => `('${ds.id}','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < candles.length && candles[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
    for (let i = 0; i < cv.length; i += 3000) await sql(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 3000).join(",")};`);
    await sql(`UPDATE iqopt_datasets SET status='READY', window_to='${new Date(candles[candles.length - 1].bucket).toISOString()}', provenance = provenance || '${JSON.stringify({ extended_at: new Date().toISOString(), rows: rows.length }).replace(/'/g, "''")}'::jsonb WHERE dataset_id='${ds.id}';`);
    console.log(`  ${ds.id} RE-READY (${ticks.length} ticks)`);
  }
  fs.writeFileSync(OUT + "/bx-prospective-results-extended.json", JSON.stringify(out, null, 1));
  console.log("DONE bx-prospective-results-extended.json");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
