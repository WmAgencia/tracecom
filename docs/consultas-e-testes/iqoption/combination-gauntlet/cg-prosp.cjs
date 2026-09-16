// cg-prosp.cjs — prospective NOVO (pos-freeze) para finalistas congelados: T+60 (1min) e T+300 (5min). Persiste tranche P1.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const KHF = require(OUT + "/kh-features.cjs");
const CGC = require(OUT + "/cg-comps.cjs");
const GC = require(OUT + "/gauntlet-compile.cjs");
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
async function quotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const r = await fetch(`https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
async function fetchWin(active, FR0, TO0) { let to = TO0, page = 0, byN = new Map(); const dir = `${OUT}/cg/p1raw_a${active}`; fs.mkdirSync(dir, { recursive: true }); while (page < 200) { const q = ((await quotes(active, FR0 + 1, to)).quotes || []).sort((a, b) => a.ts - b.ts); if (!q.length) break; fs.writeFileSync(`${dir}/p${String(page).padStart(3, "0")}.json`, JSON.stringify({ active_id: active, from: FR0 + 1, to, fetched_at: new Date().toISOString(), count: q.length, payload: { quotes: q } })); for (const x of q) byN.set(x.n, x); if (q[0].ts <= FR0 + 2000) break; to = q[0].ts - 1; page += 1; await new Promise((r) => setTimeout(r, 120)); } return { ticks: [...byN.values()].sort((a, b) => a.ts - b.ts), pages: page + 1 }; }
function evalV(v, rows, baseP, horizon) { let sg = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, iN = 0, b = 0, s2 = 0, curW = 0, curL = 0, maxW = 0, maxL = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; const y = horizon === 300 ? rows[i].l300 : rows[i].l60; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } sg += 1; if (x === 1) b += 1; else s2 += 1; const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { iN += 1; if (win) iw += 1; else il += 1; } } const n = w + l, bn = bw + bl, sn = sw + sl; const hrs = rows.length * 5 / 3600; const wrn = n ? w / n : null; const baseStrategy = sg ? (b * baseP + s2 * (1 - baseP)) / sg : null; const z = n && baseStrategy ? (w - baseStrategy * n) / Math.sqrt(n * baseStrategy * (1 - baseStrategy)) : null; const zz = 1.96, p = wrn ?? 0, dd = n ? 1 + zz * zz / n : 1, cc = (p + zz * zz / (2 * (n || 1))) / dd, h = n ? zz * Math.sqrt(p * (1 - p) / n + zz * zz / (4 * n * n)) / dd : 0; return { signals: sg, sigPerHour: +(sg / hrs).toFixed(1), w, l, draws: d, unknown: u, wr: wrn === null ? null : +(wrn * 100).toFixed(2), buyN: b, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellN: s2, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: iN, indepWR: iN ? +((iw / iN) * 100).toFixed(2) : null, edge_pp: wrn !== null && baseStrategy !== null ? +((wrn - baseStrategy) * 100).toFixed(2) : null, z: z === null ? null : +z.toFixed(2), ci95: n ? [+(Math.max(0, cc - h) * 100).toFixed(2), +(Math.min(1, cc + h) * 100).toFixed(2)] : null, maxWinStreak: maxW, maxLossStreak: maxL }; }
(async () => {
  const DISC_END = (() => { const cd = JSON.parse(fs.readFileSync(OUT + "/kh/candles_a1.json", "utf8")).candles; return cd[cd.length - 1].bucket + 5000; })();
  const TO = Date.now() - 35 * 60 * 1000;
  const hours = (TO - DISC_END) / 3600000;
  console.log(`PROSPECTIVE P1: ${new Date(DISC_END).toISOString()} -> ${new Date(TO).toISOString()} (${hours.toFixed(2)}h)`);
  if (hours < 0.25) { console.log("PROSPECTIVE_EVIDENCE_INSUFFICIENT (janela < 15min)"); fs.writeFileSync(OUT + "/cg/cg-prospective-results.json", JSON.stringify({ status: "PROSPECTIVE_EVIDENCE_INSUFFICIENT", hours: +hours.toFixed(3) }, null, 1)); return; }
  const out = { generated_at: new Date().toISOString(), tranche: "P1", window: { from: new Date(DISC_END).toISOString(), to: new Date(TO).toISOString(), hours: +hours.toFixed(2) }, note: "finalistas congelados em cg/finalists-freeze-*.json ANTES desta janela; T+60 e T+300", datasets: {} };
  for (const ds of [{ active: 1, id: "IQOPTION_EURUSD_BINARY_P1", otc: false }, { active: 76, id: "IQOPTION_EURUSD_OTC_P1", otc: true }]) {
    const { ticks, pages } = await fetchWin(ds.active, DISC_END, TO);
    if (!ticks.length) { out.datasets[ds.id] = { error: "sem ticks" }; continue; }
    const cmap = new Map(), agg = new Map(); let prev = null;
    for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
    const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const rows = KHF.labelRows(KHF.computeKh(candles, agg), candles);
    const byB = new Map(); for (let i = 0; i < candles.length; i++) byB.set(candles[i].bucket, i);
    for (const r of rows) { const si = byB.get(r.t0 - 5000 + 300000); r.l300 = si === undefined ? null : (candles[si].close === r.entry ? 0 : candles[si].close > r.entry ? 1 : -1); }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0, up3 = 0, dn3 = 0; for (const r of rows) { if (r.l60 === 1) up += 1; else if (r.l60 === -1) dn += 1; if (r.l300 === 1) up3 += 1; else if (r.l300 === -1) dn3 += 1; }
    const baseP = up / (up + dn), baseP3 = up3 / (up3 + dn3);
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "P1", indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const mk3 = JSON.parse(fs.readFileSync(`${OUT}/cg/mk3-table-${ds.otc ? "otc" : "bin"}.json`, "utf8")).table;
    const comps = CGC.buildParts(rows, ctx, mk3); const masks = CGC.buildMasks(rows);
    const frz = JSON.parse(fs.readFileSync(`${OUT}/cg/finalists-freeze-${ds.otc ? "otc" : "bin"}.json`, "utf8"));
    console.log(`\n===== P1 ${ds.id} ===== ticks=${ticks.length} candles=${candles.length} rows=${rows.length} indep=${rows.filter((r) => r.indep).length} baseP60=${(baseP * 100).toFixed(2)}% baseP300=${(baseP3 * 100).toFixed(2)}%`);
    const per = [];
    const seen = new Set();
    for (const f of frz.finalists) { if (seen.has(f.hash)) continue; seen.add(f.hash); let v; try { v = CGC.rebuildVec(f.spec, { comps, masks }, rows); } catch (e) { console.log(`  ${f.id} ERRO ${e.message}`); continue; } const m60 = evalV(v, rows, baseP, 60), m300 = evalV(v, rows, baseP3, 300); per.push({ id: f.id, gen: f.gen, hash: f.hash, spec: f.spec, discovery: f.train, val: f.val, prospective_60: m60, prospective_300: m300 }); console.log(`  [${f.gen}] ${f.id} | T+60: sig=${m60.signals} WR=${m60.wr}% (${m60.sigPerHour}/h) BUY ${m60.buyWR}% SELL ${m60.sellWR}% indep ${m60.indepN}/${m60.indepWR}% edge=${m60.edge_pp}pp | T+300: WR=${m300.wr}% sig=${m300.signals} indep ${m300.indepN}/${m300.indepWR}%`); }
    const bb = (s) => { const v = new Int8Array(rows.length); v.fill(s); return evalV(v, rows, baseP, 60); };
    const bl = { always_buy_60: bb(1), always_sell_60: bb(-1) };
    out.datasets[ds.id] = { ticks: ticks.length, pages, candles: candles.length, rows: rows.length, indep: rows.filter((r) => r.indep).length, baseP60: +(baseP * 100).toFixed(2), baseP300: +(baseP3 * 100).toFixed(2), finalists: per, baselines: bl };
    // persistir P1 no Supabase
    await sql(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('${ds.id}','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'IQ_OPTION','INSERTING','${new Date(candles[0].bucket).toISOString()}','${new Date(candles[candles.length - 1].bucket).toISOString()}','${JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", purpose: "combination-gauntlet prospective tranche P1", pages }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance;`);
    const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('${ds.id}','IQ_OPTION','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
    for (let i = 0; i < tv.length; i += 5000) await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 5000).join(",")};`);
    const cv = candles.map((x, idx) => `('${ds.id}','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < candles.length && candles[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
    for (let i = 0; i < cv.length; i += 5000) await sql(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 5000).join(",")};`);
    await sql(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='${ds.id}';`);
    console.log(`  ${ds.id} persistido READY`);
  }
  fs.writeFileSync(OUT + "/cg/cg-prospective-results.json", JSON.stringify(out, null, 1));
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('cg-combination-2026-09-16', now(), '${JSON.stringify({ tranche: "P1", hours: out.window.hours, datasets: Object.fromEntries(Object.entries(out.datasets).map(([k, v]) => [k, { ticks: v.ticks || 0, best60: (v.finalists || []).map((f) => `${f.id}|${f.prospective_60.wr}%|n=${f.prospective_60.signals}`), best300: (v.finalists || []).map((f) => `${f.id}|${f.prospective_300.wr}%|n=${f.prospective_300.signals}`) }])) }).replace(/'/g, "''")}'::jsonb, 'cg-run/cg-prosp (+cg-comps)') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nCG PROSPECTIVE DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
