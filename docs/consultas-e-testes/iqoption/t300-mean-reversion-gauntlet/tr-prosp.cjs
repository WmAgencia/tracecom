// tr-prosp.cjs — PROSPECTIVE P3 real: novos dados pos-freeze, features completas, avalia os finalistas congelados (BINARY, T+300).
const fs = require("fs");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const L = require(OUT + "/mh-lib.cjs"); const KHF = L.KHF;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
async function sqlq(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
async function quotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const r = await fetch(`https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
(async () => {
  const freeze = JSON.parse(fs.readFileSync(OUT + "/tr/finalists-freeze.json", "utf8"));
  const START = Date.parse("2026-09-16T00:20:02Z") + 1;
  const TO = Date.now() - 35 * 60 * 1000; const hours = (TO - START) / 3600000;
  console.log(`P3: ${new Date(START).toISOString()} -> ${new Date(TO).toISOString()} (${hours.toFixed(2)}h) | freeze ${freeze.frozen_at}`);
  if (hours < 0.3) { fs.writeFileSync(OUT + "/tr/prospective-results.json", JSON.stringify({ status: "PROSPECTIVE_EVIDENCE_INSUFFICIENT", hours: +hours.toFixed(2), freeze_at: freeze.frozen_at }, null, 1)); console.log("PROSPECTIVE_EVIDENCE_INSUFFICIENT"); return; }
  const byN = new Map(); let to = TO, page = 0; const dir = `${OUT}/tr/p3raw`; fs.mkdirSync(dir, { recursive: true });
  while (page < 100) { const q = ((await quotes(1, START, to)).quotes || []).sort((a, b) => a.ts - b.ts); if (!q.length) break; fs.writeFileSync(`${dir}/p${String(page).padStart(3, "0")}.json`, JSON.stringify({ from: START, to, fetched_at: new Date().toISOString(), count: q.length, payload: { quotes: q } })); for (const x of q) byN.set(x.n, x); if (q[0].ts <= START + 2000) break; to = q[0].ts - 1; page += 1; await new Promise((x) => setTimeout(x, 120)); }
  const ticks = [...byN.values()].sort((a, b) => a.ts - b.ts);
  const cmap = new Map(), agg = new Map(); let prev = null;
  for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
  const cd = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
  const N = cd.length, C = cd.map((x) => x.close), H = cd.map((x) => x.high), Lo = cd.map((x) => x.low);
  const byB = new Map(); for (let i = 0; i < N; i++) byB.set(cd[i].bucket, i);
  const khRows = KHF.labelRows(KHF.computeKh(cd, agg), cd); const byK = new Map(); for (const r of khRows) byK.set(r.t0 - 5000, r);
  const phI = [], plI = []; for (let j = 2; j < N - 2; j++) { if (H[j] > H[j - 1] && H[j] > H[j + 1] && H[j] > H[j - 2] && H[j] > H[j + 2]) phI.push(j); if (Lo[j] < Lo[j - 1] && Lo[j] < Lo[j + 1] && Lo[j] < Lo[j - 2] && Lo[j] < Lo[j + 2]) plI.push(j); }
  const ret = (i, k) => i >= k ? (C[i] - C[i - k]) / C[i - k] : null;
  const signals = [];
  for (let i = 130; i < N; i++) {
    let m = 0; for (let j = i - 119; j <= i; j++) m += C[j]; m /= 120; let q2 = 0; for (let j = i - 119; j <= i; j++) q2 += (C[j] - m) ** 2; const z = (C[i] - m) / (Math.sqrt(q2 / 120) || 1e-12);
    if (Math.abs(z) < 2) continue; const dir = z > 0 ? -1 : 1;
    const kh = byK.get(cd[i].bucket); const f = kh ? kh.f : {};
    const si = byB.get(cd[i].bucket + 300000); const l300 = si === undefined ? null : (C[si] === C[i] ? 0 : C[si] > C[i] ? 1 : -1);
    const ph = phI.filter((j) => j <= i - 2).slice(-2), pl = plI.filter((j) => j <= i - 2).slice(-2);
    let structUp = 0, structDown = 0; if (ph.length === 2 && pl.length === 2) { const h2 = H[ph[1]], h1 = H[ph[0]], l2 = Lo[pl[1]], l1 = Lo[pl[0]]; if (h2 > h1 && l2 > l1) structUp = 1; else if (h2 < h1 && l2 < l1) structDown = 1; }
    signals.push({ t0: cd[i].bucket + 5000, entry: C[i], dir, l300, zAbs: Math.abs(z), ret30: ret(i, 6), ret60: ret(i, 12), ret90: ret(i, 18), ret180: ret(i, 36), ret300: ret(i, 60), H: f.H, Hp: f.Hp, hurst: f.hurst, structUp, structDown, fibOk: (f.inZone === 1 && ((dir === 1 && f.upSwing === 1) || (dir === -1 && f.upSwing === 0))) ? 1 : 0, inZone: f.inZone });
  }
  const dec = signals.filter((s) => s.l300 !== null && s.l300 !== 0);
  const w0 = dec.filter((s) => s.dir === s.l300).length;
  const base = { n: dec.length, w: w0, wr: dec.length ? +(w0 / dec.length * 100).toFixed(2) : null, buyN: dec.filter((s) => s.dir === 1).length, buyW: dec.filter((s) => s.dir === 1 && s.l300 === 1).length, sellN: dec.filter((s) => s.dir === -1).length, sellW: dec.filter((s) => s.dir === -1 && s.l300 === -1).length };
  const evalGate = (g, arr) => { const sel = arr.filter((s) => g.op === ">=" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] >= g.th) : g.op === "<" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] < g.th) : g.op === "fl1" ? s[g.feat] === 1 : s[g.feat] === 0); const w = sel.filter((s) => s.dir === s.l300).length; const bs = sel.filter((s) => s.dir === 1), ss = sel.filter((s) => s.dir === -1); const wb = bs.filter((s) => s.l300 === 1).length, ws = ss.filter((s) => s.l300 === -1).length; let iN = 0, last = -1e18; for (const s of sel) { if (s.t0 - last >= 300000) { iN += 1; last = s.t0; } } return { n: sel.length, w, wr: sel.length ? +(w / sel.length * 100).toFixed(2) : null, buyN: bs.length, buyWR: bs.length ? +(wb / bs.length * 100).toFixed(2) : null, sellN: ss.length, sellWR: ss.length ? +(ws / ss.length * 100).toFixed(2) : null, indepN: iN, ci95: sel.length ? (() => { const p2 = w / sel.length, zz = 1.96, dd = 1 + zz * zz / sel.length, cc = (p2 + zz * zz / (2 * sel.length)) / dd, h = zz * Math.sqrt(p2 * (1 - p2) / sel.length + zz * zz / (4 * sel.length * sel.length)) / dd; return [+(Math.max(0, cc - h) * 100).toFixed(2), +(Math.min(1, cc + h) * 100).toFixed(2)]; })() : null }; };
  const out = { generated_at: new Date().toISOString(), window: { from: new Date(cd[0].bucket).toISOString(), to: new Date(cd[cd.length - 1].bucket).toISOString(), hours: +(N * 5 / 3600).toFixed(2) }, freeze_at: freeze.frozen_at, ticks: ticks.length, candles: N, z120: { signals: signals.length, decided: dec.length }, base, finalists: [] };
  console.log(`P3: ticks=${ticks.length} candles=${N} signals=${signals.length} decididos=${dec.length} | base z120: n=${base.n} WR=${base.wr}% (BUY ${base.buyW}/${base.buyN} SELL ${base.sellW}/${base.sellN})`);
  for (const f of freeze.finalists) { const g = f.spec.parts ? f.spec.parts[0] : { feat: f.spec.feat, op: f.spec.op, th: f.spec.th }; const m = evalGate(g, dec); out.finalists.push({ id: f.id, gen: f.gen, gate: g, discovery: { train: f.train.wr, val: f.val.wr }, prospective: m }); console.log(`  ${f.id}: P3 n=${m.n} WR=${m.wr}% (${m.w}/${m.n}) BUY ${m.buyWR}% SELL ${m.sellWR}% indep ${m.indepN} ci=[${(m.ci95 || []).join("..")}] || discovery tr ${f.train.wr}% va ${f.val.wr}%`); }
  fs.writeFileSync(OUT + "/tr/prospective-results.json", JSON.stringify(out, null, 1));
  // persistir P3
  await sqlq(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('IQOPTION_EURUSD_BINARY_P3','EUR/USD','BINARY',false,'IQ_OPTION','INSERTING','${new Date(cd[0].bucket).toISOString()}','${new Date(cd[N - 1].bucket).toISOString()}','${JSON.stringify({ purpose: "z120 T300 gauntlet prospective P3", freeze_at: freeze.frozen_at }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance;`);
  const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('IQOPTION_EURUSD_BINARY_P3','IQ_OPTION','EUR/USD','BINARY',false,'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
  for (let i = 0; i < tv.length; i += 5000) await sqlq(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 5000).join(",")};`);
  const cv = cd.map((x, idx) => `('IQOPTION_EURUSD_BINARY_P3','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < N && cd[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
  for (let i = 0; i < cv.length; i += 5000) await sqlq(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 5000).join(",")};`);
  await sqlq(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3';`);
  await sqlq(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('tr-z120-prospective-2026-09-16', now(), '${JSON.stringify({ window: out.window, base: base.wr, finalists: out.finalists.map((f) => `${f.id}|${f.prospective.wr}%|n=${f.prospective.n}|indep=${f.prospective.indepN}`) }).replace(/'/g, "''")}'::jsonb, 'tr-prosp.cjs') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("TR PROSPECTIVE DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
