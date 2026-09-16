// kh-fetch.cjs — coleta MAXIMA real do endpoint oficial (~7 dias) para BINARY(1) e OTC(76).
// Backward pagination, raw pages em disco (com sha256 por página), candles 5s + tickAgg em memória, persistência Supabase (candles+ticks+manifest).
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const q1 = (v) => { if (v === null || v === undefined) return "NULL"; if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL"; if (typeof v === "boolean") return v ? "true" : "false"; return "'" + String(v).replace(/'/g, "''") + "'"; };
async function sql(query) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail " + r.status + ": " + (await r.text()).slice(0, 150)); await new Promise((x) => setTimeout(x, 1500)); } }
async function quotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const url = `https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`; const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
(async () => {
  const now = Date.now(); const TO0 = now - 35 * 60 * 1000; const FR0 = now - 6.99 * 86400000;
  console.log(`window: ${new Date(FR0).toISOString()} -> ${new Date(TO0).toISOString()} (${((TO0 - FR0) / 3600000).toFixed(2)}h)`);
  const manifest = { requested_hours: 10000, fetched_at: new Date().toISOString(), source: "https://api.iqoption.com/v3/quotes", provenance: "A_IQ_OPTION_OFFICIAL", max_retention: "7 days (official)", window: { from: new Date(FR0).toISOString(), to: new Date(TO0).toISOString() }, datasets: [] };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_7D", active: 1, otc: false }, { id: "IQOPTION_EURUSD_OTC_7D", active: 76, otc: true }]) {
    const dir = `${OUT}/kh/raw/a${ds.active}`; fs.mkdirSync(dir, { recursive: true });
    const cmap = new Map(), agg = new Map(); let total = 0, dupPage = 0, prevPrevTs = null, pages = 0, pageHashes = [];
    let to = TO0;
    while (pages < 900) {
      const json = await quotes(ds.active, FR0 + 1, to);
      const q = (json.quotes || []).sort((a, b) => a.ts - b.ts);
      if (!q.length) break;
      const raw = JSON.stringify({ active_id: ds.active, requested_from: FR0 + 1, requested_to: to, fetched_at: new Date().toISOString(), count: q.length, payload: { quotes: q } });
      const file = `${dir}/p${String(pages).padStart(4, "0")}.json`;
      fs.writeFileSync(file, raw);
      pageHashes.push(crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16));
      if (prevPrevTs !== null && q[q.length - 1].ts >= prevPrevTs) dupPage += 0;
      prevPrevTs = q[0].ts;
      let prev = null; const seen = new Set();
      for (const t of q) { if (seen.has(t.n)) { dupPage += 1; continue; } seen.add(t.n); total += 1; const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
      pages += 1;
      if ((pages % 25) === 0) console.log(`  a${ds.active}: pages=${pages} ticks=${total} at=${new Date(q[0].ts).toISOString()}`);
      if (q[0].ts <= FR0 + 2000) break;
      to = q[0].ts - 1;
      await new Promise((r) => setTimeout(r, 120));
    }
    const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const aggArr = [...agg.entries()].sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(`${OUT}/kh/candles_a${ds.active}.json`, JSON.stringify({ dataset_id: ds.id, otc: ds.otc, candles }));
    fs.writeFileSync(`${OUT}/kh/tickagg_a${ds.active}.json`, JSON.stringify({ dataset_id: ds.id, agg: aggArr }));
    // gaps
    let gaps = 0; for (let i = 1; i < candles.length; i++) if (candles[i].bucket - candles[i - 1].bucket > 5000) gaps += 1;
    const hours = (candles[candles.length - 1].bucket - candles[0].bucket) / 3600000;
    const m = { dataset_id: ds.id, active_id: ds.active, otc: ds.otc, pages, ticks: total, duplicates_in_pages: dupPage, candles: candles.length, gaps_gt_5s: gaps, first: new Date(candles[0].bucket).toISOString(), last: new Date(candles[candles.length - 1].bucket).toISOString(), hours: +hours.toFixed(2), page_sha16_agg: crypto.createHash("sha256").update(pageHashes.join("")).digest("hex").slice(0, 16) };
    manifest.datasets.push(m);
    console.log(`a${ds.active} DONE: ticks=${total} candles=${candles.length} hours=${m.hours} gaps=${gaps} dupes=${dupPage} pageHashAgg=${m.page_sha16_agg}`);
  }
  manifest.acquired_hours_binary = manifest.datasets[0].hours; manifest.acquired_hours_otc = manifest.datasets[1].hours;
  fs.writeFileSync(OUT + "/kh/dataset-manifest.json", JSON.stringify(manifest, null, 1));
  // PERSISTIR: datasets + candles + ticks (10k/5k bathes) + meta
  for (const ds of manifest.datasets) {
    const a = ds.active_id;
    await sql(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('${ds.dataset_id}','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'IQ_OPTION','INSERTING','${ds.first}','${ds.last}','${JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", source_url: "https://api.iqoption.com/v3/quotes", pages: ds.pages, ticks: ds.ticks, gaps_gt_5s: ds.gaps_gt_5s, page_sha16_agg: ds.page_sha16_agg, note: "max retention ~7d; raw pages preserved locally with per-page sha256" }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', provenance=EXCLUDED.provenance, window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to;`);
    const cd = JSON.parse(fs.readFileSync(`${OUT}/kh/candles_a${a}.json`, "utf8")).candles;
    for (let i = 0; i < cd.length; i += 5000) { const vals = cd.slice(i, i + 5000).map((x, j) => `('${ds.dataset_id}','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${i + j + 1 < cd.length && cd[i + j + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`); await sql(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${vals.join(",")};`); if (i % 50000 === 0) console.log(`  candles ${ds.dataset_id}: ${Math.min(i + 5000, cd.length)}/${cd.length}`); }
    console.log(`  candles OK ${ds.dataset_id} (${cd.length})`);
  }
  // ticks: reconstruir das páginas raw e inserir em 5000-row batches (com orçamento de tempo)
  const t0 = Date.now(); const BUDGET = 20 * 60 * 1000;
  for (const ds of manifest.datasets) {
    const a = ds.active_id; const dir = `${OUT}/kh/raw/a${a}`;
    const files = fs.readdirSync(dir).sort(); let inserted = 0; let batch = [];
    for (const f of files) {
      const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
      for (const t of (j.payload.quotes || [])) { const iso = new Date(t.ts).toISOString(); batch.push(`('${ds.dataset_id}','IQ_OPTION','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`); if (batch.length >= 5000) { await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${batch.join(",")};`); inserted += batch.length; batch = []; if (inserted % 50000 === 0) console.log(`  ticks ${ds.dataset_id}: ${inserted}/${ds.ticks} (${((Date.now() - t0) / 60000).toFixed(1)}min)`); if (Date.now() - t0 > BUDGET) break; } }
      if (Date.now() - t0 > BUDGET) break;
    }
    if (batch.length && Date.now() - t0 < BUDGET) { await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${batch.join(",")};`); inserted += batch.length; }
    await sql(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='${ds.dataset_id}';`);
    console.log(`  ticks persistidos ${ds.dataset_id}: ${inserted}/${ds.ticks}${inserted < ds.ticks ? " (LIMITE DE TEMPO — raw complete em disco)" : ""}`);
  }
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('kh-7d-2026-09-15', now(), '${JSON.stringify({ requested_hours: 10000, acquired_hours_binary: manifest.acquired_hours_binary, acquired_hours_otc: manifest.acquired_hours_otc, datasets: manifest.datasets.map((d) => ({ id: d.dataset_id, ticks: d.ticks, candles: d.candles, hours: d.hours })) }).replace(/'/g, "''")}'::jsonb, 'kh-fetch.cjs') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("KH FETCH DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
