// freeze-p2.cjs — FREEZE de V1@T+45s (BINARY) e V8@T+60s (OTC) + tranche prospectiva NOVA P2 (pos-freeze) + avaliacao cega.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const KHF = require(OUT + "/kh-features.cjs");
const GC = require(OUT + "/gauntlet-compile.cjs");
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
async function quotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const r = await fetch(`https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
async function fetchWin(active, FR0, TO0) { let to = TO0, page = 0, byN = new Map(); const dir = `${OUT}/p2raw_a${active}`; fs.mkdirSync(dir, { recursive: true }); while (page < 300) { const q = ((await quotes(active, FR0 + 1, to)).quotes || []).sort((a, b) => a.ts - b.ts); if (!q.length) break; fs.writeFileSync(`${dir}/p${String(page).padStart(3, "0")}.json`, JSON.stringify({ active_id: active, from: FR0 + 1, to, fetched_at: new Date().toISOString(), count: q.length, payload: { quotes: q } })); for (const x of q) byN.set(x.n, x); if (q[0].ts <= FR0 + 2000) break; to = q[0].ts - 1; page += 1; await new Promise((r) => setTimeout(r, 120)); } return { ticks: [...byN.values()].sort((a, b) => a.ts - b.ts), pages: page + 1 }; }
function wilson(w, n) { if (!n) return [0, 0]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
function evalH(v, rows, baseP, key) { let sig = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, iN = 0, b = 0, s2 = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; const y = rows[i][key]; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } sig += 1; if (x === 1) b += 1; else s2 += 1; const win = x === y; if (win) w += 1; else l += 1; if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { iN += 1; if (win) iw += 1; else il += 1; } } const n = w + l, bn = bw + bl, sn = sw + sl; const wrn = n ? w / n : null; const baseStrategy = sig ? (b * baseP + s2 * (1 - baseP)) / sig : null; return { signals: sig, w, l, draws: d, unknown: u, wr: wrn === null ? null : +(wrn * 100).toFixed(2), buyNWR: `${bn}/${bn ? +((bw / bn) * 100).toFixed(1) : "-"}`, sellNWR: `${sn}/${sn ? +((sw / sn) * 100).toFixed(1) : "-"}`, indepN: iN, indepWR: iN ? +((iw / iN) * 100).toFixed(2) : null, edge_pp: wrn !== null && baseStrategy !== null ? +((wrn - baseStrategy) * 100).toFixed(2) : null, ci95: n ? wilson(w, n).map((x) => +(x * 100).toFixed(2)) : null };
}
(async () => {
  // ===== 1) FREEZE (antes de qualquer dado novo) =====
  const SPEC_V1 = { type: "prod", id: "reversion-v1-fib" };
  const SPEC_V8 = { op: "gateFib", innerSpec: { type: "atr_over", m: 1 } };
  const freeze = {
    frozen_at: new Date().toISOString(),
    rule: "Promocao SOMENTE com WR prospectivo >= 70% (com n e indepN reportados). Nenhum ajuste pos-freeze.",
    hypotheses: [
      { id: "H1_V1_at_T45s", strategy: "V1 (Fib RSI Reversal)", market: "BINARY", horizon_s: 45, spec: SPEC_V1, hash: sha16(SPEC_V1), discovery: { wr: 63.77, n: 138, base: 52.36, indepN: 6 } },
      { id: "H2_V8_at_T60s", strategy: "V8 (ATR1x+Fib)", market: "OTC", horizon_s: 60, spec: SPEC_V8, hash: sha16(SPEC_V8), discovery: { wr: 54.07, n: 135, base: 48.91, indepN: 5 } },
    ],
    secondary_reads: ["H1 tambem no OTC", "H2 tambem no BINARY", "mesmas estrategias em T+60/T+45/T+300 para contexto"],
  };
  fs.writeFileSync(OUT + "/horizons/finalists-freeze-p2.json", JSON.stringify(freeze, null, 1));
  console.log(`FREEZE: ${freeze.frozen_at} | hashes: V1=${freeze.hypotheses[0].hash} V8=${freeze.hypotheses[1].hash}`);
  // ===== 2) P2: dados NOVOS (apos P1 que terminou 2026-09-16T00:01:33Z) =====
  const P1_END = Date.parse("2026-09-16T00:01:33Z");
  const TO = Date.now() - 35 * 60 * 1000;
  const hours = (TO - P1_END) / 3600000;
  console.log(`P2 window: ${new Date(P1_END + 1).toISOString()} -> ${new Date(TO).toISOString()} (${hours.toFixed(2)}h)`);
  if (hours < 0.2) { console.log("PROSPECTIVE_EVIDENCE_INSUFFICIENT"); fs.writeFileSync(OUT + "/horizons/freeze-p2-results.json", JSON.stringify({ status: "PROSPECTIVE_EVIDENCE_INSUFFICIENT", hours: +hours.toFixed(2) }, null, 1)); return; }
  const out = { generated_at: new Date().toISOString(), tranche: "P2", window: { from: new Date(P1_END + 1).toISOString(), to: new Date(TO).toISOString(), hours: +hours.toFixed(2) }, freeze_at: freeze.frozen_at, datasets: {} };
  for (const ds of [{ active: 1, id: "IQOPTION_EURUSD_BINARY_P2", otc: false }, { active: 76, id: "IQOPTION_EURUSD_OTC_P2", otc: true }]) {
    const { ticks, pages } = await fetchWin(ds.active, P1_END, TO);
    if (!ticks.length) { out.datasets[ds.id] = { error: "sem ticks" }; continue; }
    const cmap = new Map(), agg = new Map(); let prev = null;
    for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
    const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const rows = KHF.labelRows(KHF.computeKh(candles, agg), candles);
    const byB = new Map(); for (let i = 0; i < candles.length; i++) byB.set(candles[i].bucket, i);
    for (const r of rows) { for (const [key, off] of [["l45", 45000], ["l300", 300000]]) { const si = byB.get(r.t0 - 5000 + off); r[key] = si === undefined ? null : (candles[si].close === r.entry ? 0 : candles[si].close > r.entry ? 1 : -1); } }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "P2", indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const baseP = {}; for (const key of ["l45", "l60", "l300"]) { let u = 0, dn = 0; for (const r of rows) { if (r[key] === 1) u += 1; else if (r[key] === -1) dn += 1; } baseP[key] = u / (u + dn); }
    const v1 = GC.compile(SPEC_V1, ctx), v8 = GC.compile(SPEC_V8, ctx);
    const per = [];
    for (const h of freeze.hypotheses) { const v = h.strategy.startsWith("V1") ? v1 : v8; const rec = { id: h.id, market: h.market, horizon: "T+" + h.horizon_s + "s", frozen_hash: h.hash, hash_recomputed: sha16(h.spec), discovery: h.discovery, prospective: evalH(v, rows, baseP["l" + h.horizon_s], "l" + h.horizon_s) }; per.push(rec); }
    // leituras secundárias
    const sec = [
      { id: "V1@T45s(binary-spec) em OTC", v: v1, key: "l45" }, { id: "V1@T60s", v: v1, key: "l60" }, { id: "V1@T300s", v: v1, key: "l300" },
      { id: "V8@T60s", v: v8, key: "l60" }, { id: "V8@T45s", v: v8, key: "l45" }, { id: "V8@T300s", v: v8, key: "l300" },
    ];
    const secondary = sec.map((s) => ({ id: s.id, horizon: s.key, ...evalH(s.v, rows, baseP[s.key], s.key) }));
    console.log(`\n===== P2 ${ds.id} ===== ticks=${ticks.length} candles=${candles.length} rows=${rows.length} indep=${rows.filter((r) => r.indep).length} baseP=${JSON.stringify(Object.fromEntries(Object.entries(baseP).map(([k, x]) => [k, +(x * 100).toFixed(2)])))}`);
    for (const p of per) console.log(`  [FROZEN] ${p.id} (${p.market}) | ${p.horizon}: sig=${p.prospective.signals} WR=${p.prospective.wr}% (${p.prospective.w}W/${p.prospective.l}L/${p.prospective.draws}D) BUY ${p.prospective.buyNWR}% SELL ${p.prospective.sellNWR}% indep ${p.prospective.indepN}/${p.prospective.indepWR}% edge=${p.prospective.edge_pp}pp ci=[${(p.prospective.ci95 || []).join("..")}]`);
    for (const s of secondary) console.log(`  [sec] ${s.id} (${s.horizon}): sig=${s.signals} WR=${s.wr}% indep ${s.indepN}/${s.indepWR}%`);
    out.datasets[ds.id] = { ticks: ticks.length, pages, candles: candles.length, rows: rows.length, baseP: Object.fromEntries(Object.entries(baseP).map(([k, x]) => [k, +(x * 100).toFixed(2)])), frozen: per, secondary };
    // persistir P2
    await sql(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('${ds.id}','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'IQ_OPTION','INSERTING','${new Date(candles[0].bucket).toISOString()}','${new Date(candles[candles.length - 1].bucket).toISOString()}','${JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", purpose: "P2 prospective (frozen V1@45s/V8@60s)", pages, freeze_at: freeze.frozen_at }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance;`);
    const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('${ds.id}','IQ_OPTION','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc},'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
    for (let i = 0; i < tv.length; i += 5000) await sql(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 5000).join(",")};`);
    const cv = candles.map((x, idx) => `('${ds.id}','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < candles.length && candles[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
    for (let i = 0; i < cv.length; i += 5000) await sql(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 5000).join(",")};`);
    await sql(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='${ds.id}';`);
    console.log(`  ${ds.id} READY (${ticks.length} ticks persistidos)`);
  }
  fs.writeFileSync(OUT + "/horizons/freeze-p2-results.json", JSON.stringify(out, null, 1));
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('p2-frozen-v1-45s-v8-60s-2026-09-16', now(), '${JSON.stringify({ freeze_at: freeze.frozen_at, window: out.window, results: Object.fromEntries(Object.entries(out.datasets).map(([k, v]) => [k, (v.frozen || []).map((x) => `${x.id}|${x.horizon}|WR=${x.prospective.wr}%|n=${x.prospective.signals}`)])) }).replace(/'/g, "''")}'::jsonb, 'freeze-p2.cjs (kh-features + gauntlet-compile)') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nFREEZE-P2 DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
