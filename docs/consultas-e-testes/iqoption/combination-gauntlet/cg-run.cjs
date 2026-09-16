// cg-run.cjs — CROSS-FAMILY COMBINATION GAUNTLET. Componentes REAIS dos gauntlets anteriores; geracoes G1..G4; freeze; prospective NOVO (T+60 e T+300).
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
function wilson(w, n) { if (!n) return [0, 0]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
function evalVec(v, rows, lo, hi, baseP, horizon) {
  let sig = 0, w = 0, l = 0, d = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, iN = 0, b = 0, s2 = 0, curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (let i = lo; i < hi; i++) { const x = v[i]; if (x === 0) continue; const y = horizon === 300 ? rows[i].l300 : rows[i].l60; if (y === null || y === 0) continue; sig += 1; if (x === 1) b += 1; else s2 += 1; const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { iN += 1; if (win) iw += 1; else il += 1; } }
  const n = w + l, bn = bw + bl, sn = sw + sl, hrs = (hi - lo) * 5 / 3600; const wrn = n ? w / n : null;
  const baseStrategy = sig ? (b * baseP + s2 * (1 - baseP)) / sig : null; const [wl] = wilson(w, n);
  return { signals: sig, sigPerHour: +(sig / hrs).toFixed(1), w, l, draws: d, wr: wrn === null ? null : +(wrn * 100).toFixed(2), buyN: b, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellN: s2, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: iN, indepWR: iN ? +((iw / iN) * 100).toFixed(2) : null, indepW: iw, edge_pp: wrn !== null && baseStrategy !== null ? +((wrn - baseStrategy) * 100).toFixed(2) : null, wilsonLo: +(wl * 100).toFixed(2), ci95: n ? wilson(w, n).map((x) => +(x * 100).toFixed(2)) : null, maxWinStreak: maxW, maxLossStreak: maxL };
}
const AGREE = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = a[i] !== 0 && a[i] === b[i] ? a[i] : 0; return v; };
const UNI = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; v[i] = x === 0 ? y : y === 0 ? x : x === y ? x : 0; } return v; };
const CONFIRM = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = b[i] !== 0 ? a[i] : 0; return v; };
const GATE = (a, m) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = m[i] ? a[i] : 0; return v; };
const AGREE3 = (a, b, c) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) { v[i] = a[i] !== 0 && a[i] === b[i] && a[i] === c[i] ? a[i] : 0; } return v; };
(async () => {
  const dsAll = [];
  for (const a of [{ active: 1, id: "IQOPTION_EURUSD_BINARY_7D", otc: false }, { active: 76, id: "IQOPTION_EURUSD_OTC_7D", otc: true }]) {
    const cd = JSON.parse(fs.readFileSync(`${OUT}/kh/candles_a${a.active}.json`, "utf8")).candles;
    const agg = new Map(JSON.parse(fs.readFileSync(`${OUT}/kh/tickagg_a${a.active}.json`, "utf8")).agg);
    const rows = KHF.labelRows(KHF.computeKh(cd, agg), cd);
    const byB = new Map(); for (let i = 0; i < cd.length; i++) byB.set(cd[i].bucket, i);
    for (const r of rows) { const si = byB.get(r.t0 - 5000 + 300000); r.l300 = si === undefined ? null : (cd[si].close === r.entry ? 0 : cd[si].close > r.entry ? 1 : -1); }
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    dsAll.push({ ...a, cd, rows });
  }
  const finalOut = { generated_at: new Date().toISOString() };
  for (const d of dsAll) {
    const N = d.rows.length, E = 24, b1 = Math.floor(N * 0.6), b2 = Math.floor(N * 0.8);
    for (let i = 0; i < N; i++) d.rows[i].split = i < b1 ? "TRAIN" : i < b1 + E ? "E" : i < b2 ? "VAL" : i < b2 + E ? "E" : "HOLD";
    d.idx = { train: [0, b1], val: [b1 + E, b2], hold: [b2 + E, N] };
    d.baseP = {}; for (const sp of ["TRAIN", "VAL", "HOLD"]) { let u = 0, dn = 0; for (const r of d.rows) if (r.split === sp) { if (r.l60 === 1) u += 1; else if (r.l60 === -1) dn += 1; } d.baseP[sp] = (u + dn) ? u / (u + dn) : 0.5; }
    d.ctx = GC.loadCtx(d.rows.map((r) => ({ split: r.split, indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const F = (i) => d.rows[i].f;
    // ===== G0 COMPONENTES (implementacoes reais dos gauntlets) =====
    const comps = {};
    const mk = (fn) => { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = fn(i); return v; };
    comps.tlbrk70 = mk((i) => F(i).tlb70up ? 1 : F(i).tlb70dn ? -1 : 0);
    comps.tlbrk50 = mk((i) => F(i).tlb50up ? 1 : F(i).tlb50dn ? -1 : 0);
    comps.fb25 = mk((i) => F(i).fb25up ? -1 : F(i).fb25dn ? 1 : 0);
    comps.v7relaxed = GC.compile({ type: "prod", id: "reversion-v7-relaxed" }, d.ctx);
    comps.v7and = GC.compile({ type: "prod", id: "reversion-v7-and" }, d.ctx);
    comps.v1 = GC.compile({ type: "prod", id: "reversion-v1-fib" }, d.ctx);
    comps.v3 = GC.compile({ type: "prod", id: "reversion-v3-fib" }, d.ctx);
    comps.v6 = GC.compile({ type: "prod", id: "reversion-v6-fib" }, d.ctx);
    comps.z240 = mk((i) => { const f = F(i); if (f.lowVol !== 1) return 0; if (f.z240 <= -2.5) return 1; if (f.z240 >= 2.5) return -1; return 0; });
    comps.exrsi = mk((i) => { const s = F(i).s; return s > 0.33 ? 1 : s < -0.33 ? -1 : 0; });
    comps.cp = mk((i) => { const f = F(i); const sdv = Math.abs(f.r24) / 2 + 1e-9; const diff = f.r3 - f.r24 / 8; return diff > 0.5 * sdv ? 1 : diff < -0.5 * sdv ? -1 : 0; });
    comps.acfade = mk((i) => { const f = F(i); if (f.ac1 < -0.25) return f.r6 > 0 ? -1 : f.r6 < 0 ? 1 : 0; return 0; });
    comps.miimb = mk((i) => { const f = F(i); if (f.imb === null) return 0; return f.imb > 0.1 ? 1 : f.imb < -0.1 ? -1 : 0; });
    comps.enperm = mk((i) => { const f = F(i); if (f.Hp < 0.8 && Math.abs(f.z60) > 1) return f.z60 > 0 ? -1 : 1; return 0; });
    comps.humr = mk((i) => { const f = F(i); if (f.hurst !== null && f.hurst < 0.45 && Math.abs(f.z60) > 1.25) return f.z60 > 0 ? -1 : 1; return 0; });
    { const tbl = {}; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 !== 1 && r.l60 !== -1) continue; const k = r.f.dir3; (tbl[k] = tbl[k] || { u: 0, n: 0 }); tbl[k].n += 1; if (r.l60 === 1) tbl[k].u += 1; } comps.mk3 = mk((i) => { const t = tbl[F(i).dir3]; if (!t || t.n < 300) return 0; const p = t.u / t.n; return p > 0.54 ? 1 : p < 0.46 ? -1 : 0; }); fs.writeFileSync(`${OUT}/cg/mk3-table-${d.otc ? "otc" : "bin"}.json`, JSON.stringify({ frozen_at: new Date().toISOString(), table: tbl })); }
    const masks = {};
    masks.enlow = mk((i) => F(i).H < 2.7 ? 1 : 0);
    masks.hurstMR = mk((i) => (F(i).hurst !== null && F(i).hurst < 0.45) ? 1 : 0);
    masks.cpActive = mk((i) => { const f = F(i); const sdv = Math.abs(f.r24) / 2 + 1e-9; return Math.abs(f.r3 - f.r24 / 8) > 0.8 * sdv ? 1 : 0; });
    masks.burst = mk((i) => F(i).tickBurst ? 1 : 0);
    masks.h11_18 = mk((i) => (F(i).hour >= 11 && F(i).hour < 18) ? 1 : 0);
    masks.lowvol = mk((i) => F(i).lowVol === 1 ? 1 : 0);
    // ===== G1: pares + gates (freeze ANTES de avaliar) =====
    const g1 = []; const cnames = Object.keys(comps), mnames = Object.keys(masks);
    for (let i = 0; i < cnames.length; i++) for (let j = i + 1; j < cnames.length; j++) { for (const op of ["AND", "OR", "CONFIRM"]) g1.push({ id: `G1_${op}_${cnames[i]}_${cnames[j]}`, gen: "G1", op, a: cnames[i], b: cnames[j], spec: { op, a: cnames[i], b: cnames[j] } }); }
    for (const c of cnames) for (const m of mnames) g1.push({ id: `G1_GATE_${c}_${m}`, gen: "G1", op: "GATE", a: c, m, spec: { op: "GATE", a: c, m } });
    for (const g of g1) g.hash = sha16(g.spec);
    fs.writeFileSync(`${OUT}/cg/g1-freeze-${d.otc ? "otc" : "bin"}.json`, JSON.stringify({ frozen_at: new Date().toISOString(), K: g1.length, hypotheses: g1.map((g) => ({ id: g.id, op: g.op, spec: g.spec, hash: g.hash })) }, null, 1));
    const vecOf = (g) => { const A = comps[g.a]; if (g.op === "AND") return AGREE(A, comps[g.b]); if (g.op === "OR") return UNI(A, comps[g.b]); if (g.op === "CONFIRM") return CONFIRM(A, comps[g.b]); return GATE(A, masks[g.m]); };
    const evalAll = (list) => list.map((g) => { const v = vecOf(g); const tr = evalVec(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60); const va = evalVec(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60); return { ...g, train: tr, val: va, v }; });
    let r1 = evalAll(g1);
    const bh = (list) => { const test = list.filter((r) => r.train.wilsonLo !== undefined && r.train.w > 0); const withP = test.map((r) => ({ r, p: r.train.wr === null ? 1 : 1 - normCdf((r.train.w - 0.5 * (r.train.w + r.train.l)) / Math.max(1e-9, Math.sqrt(0.25 * (r.train.w + r.train.l)))) })).sort((a, b) => a.p - b.p); let pq = 1; for (let i = withP.length - 1; i >= 0; i--) { const q = Math.min(pq, withP[i].p * withP.length / (i + 1)); withP[i].r.q = +q.toFixed(4); pq = q; } for (const r of list) if (r.q === undefined) r.q = null; };
    bh(r1);
    const scoreRule = (r) => r.train.signals >= 300 && r.train.indepN >= 40 && r.val.signals >= 60 && r.val.wr !== null && r.val.wr >= 47;
    const s1 = r1.filter(scoreRule).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0));
    console.log(`\n===== ${d.id} =====`);
    console.log(`G1: K=${g1.length} | sobreviventes=${s1.length} | top5: ` + s1.slice(0, 5).map((r) => `${r.id} tr=${r.train.wr}%(n=${r.train.signals},i=${r.train.indepN}/${r.train.indepWR}) va=${r.val.wr}%`).join(" | "));
    const usedComps = new Set(); const topComps = []; for (const r of s1) { for (const c of [r.a, r.m].filter(Boolean)) if (!usedComps.has(c) && comps[c]) { usedComps.add(c); topComps.push(c); } if (topComps.length >= 9) break; }
    // ===== G2: trios =====
    const g2 = [];
    for (let i = 0; i < topComps.length; i++) for (let j = i + 1; j < topComps.length; j++) for (let k = j + 1; k < topComps.length; k++) g2.push({ id: `G2_AND3_${topComps[i]}_${topComps[j]}_${topComps[k]}`, gen: "G2", op: "AND3", comps: [topComps[i], topComps[j], topComps[k]], spec: { op: "AND3", comps: [topComps[i], topComps[j], topComps[k]] } });
    for (const r of s1.slice(0, 10)) for (const m of mnames) { if (r.m === m) continue; g2.push({ id: `${r.id}+${m}`, gen: "G2", op: "GATE2", parent: r.id, m, spec: { op: "GATE2", parent: r.spec, m } }); }
    for (const g of g2) g.hash = sha16(g.spec);
    fs.writeFileSync(`${OUT}/cg/g2-freeze-${d.otc ? "otc" : "bin"}.json`, JSON.stringify({ frozen_at: new Date().toISOString(), K: g2.length, topComps, hypotheses: g2.map((g) => ({ id: g.id, op: g.op, spec: g.spec, hash: g.hash })) }, null, 1));
    const vecG2 = (g) => { if (g.op === "AND3") return AGREE3(comps[g.comps[0]], comps[g.comps[1]], comps[g.comps[2]]); const parent = r1.find((x) => x.id === g.parent); return GATE(parent.v, masks[g.m]); };
    let r2 = g2.map((g) => { const v = vecG2(g); return { ...g, v, train: evalVec(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60), val: evalVec(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60) }; });
    bh(r2);
    const s2 = r2.filter(scoreRule).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0));
    console.log(`G2: K=${g2.length} | sobreviventes=${s2.length} | top5: ` + s2.slice(0, 5).map((r) => `${r.id} tr=${r.train.wr}%(n=${r.train.signals}) va=${r.val.wr}%`).join(" | "));
    // ===== G3: quartetos (sobreviventes G2 + gate extra) =====
    const g3 = []; for (const r of s2.slice(0, 6)) for (const m of mnames) { if (r.m === m) continue; g3.push({ id: `G3_${r.id}+${m}`, gen: "G3", op: "GATE3", parent: r.id, m, spec: { op: "GATE3", parent: r.spec, m } }); }
    for (const g of g3) g.hash = sha16(g.spec);
    fs.writeFileSync(`${OUT}/cg/g3-freeze-${d.otc ? "otc" : "bin"}.json`, JSON.stringify({ frozen_at: new Date().toISOString(), K: g3.length, hypotheses: g3.map((g) => ({ id: g.id, op: g.op, spec: g.spec, hash: g.hash })) }, null, 1));
    let r3 = g3.map((g) => { const parent = r2.find((x) => x.id === g.parent); const v = GATE(parent.v, masks[g.m]); return { ...g, v, train: evalVec(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60), val: evalVec(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60) }; });
    bh(r3);
    const s3 = r3.filter(scoreRule).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0));
    console.log(`G3: K=${g3.length} | sobreviventes=${s3.length}`);
    // ===== G4: meta-labeling (logistic sobre sinais da base) + regime switch =====
    const metaBase = (s3[0] || s2[0] || s1[0]);
    let meta = null;
    if (metaBase) {
      const trIdx = []; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { if (metaBase.v[i] !== 0 && (d.rows[i].l60 === 1 || d.rows[i].l60 === -1)) trIdx.push(i); }
      const feats = (i) => { const f = F(i); return [metaBase.v[i], Math.abs(f.imb ?? 0), f.H, f.Hp, f.hurst ?? 0.5, Math.abs(f.r3 - f.r24 / 8), f.vol12 * 1e4, f.tickRate, f.z60, f.r6 * 100, f.spreadRatio ?? 1, f.hour / 24]; };
      const X = trIdx.map(feats); const mu = feats(trIdx[0]).map((_, k) => X.reduce((s, x) => s + x[k], 0) / X.length); const sg = feats(trIdx[0]).map((_, k) => Math.sqrt(X.reduce((s, x) => s + (x[k] - mu[k]) ** 2, 0) / X.length) || 1);
      let w = new Array(mu.length).fill(0), b0 = 0; const lr = 0.4;
      for (let it = 0; it < 200; it++) { const gw = new Array(w.length).fill(0); let gb = 0; for (let q = 0; q < X.length; q++) { let z = b0; for (let k = 0; k < w.length; k++) z += w[k] * ((X[q][k] - mu[k]) / sg[k]); const p = 1 / (1 + Math.exp(-z)); const e = p - (d.rows[trIdx[q]].l60 === 1 ? 1 : 0); gb += e; for (let k = 0; k < w.length; k++) gw[k] += e * ((X[q][k] - mu[k]) / sg[k]); } for (let k = 0; k < w.length; k++) w[k] -= lr * gw[k] / X.length; b0 -= lr * gb / X.length; }
      const prob = (i) => { const x = feats(i); let z = b0; for (let k = 0; k < w.length; k++) z += w[k] * ((x[k] - mu[k]) / sg[k]); return 1 / (1 + Math.exp(-z)); };
      let bestT = null; for (const t of [0.5, 0.52, 0.54, 0.56, 0.58, 0.6]) { const sel = trIdx.filter((i) => prob(i) >= t); if (sel.length < 150) continue; const pr = sel.filter((i) => metaBase.v[i] === d.rows[i].l60).length / sel.length; if (pr >= 0.55) bestT = t; }
      const v = new Int8Array(N);
      if (bestT !== null) for (let i = 0; i < N; i++) if (metaBase.v[i] !== 0 && prob(i) >= bestT) v[i] = metaBase.v[i];
      meta = { id: `G4_META_${metaBase.id}`, gen: "G4", op: "META", base: metaBase.id, baseSpec: metaBase.spec ?? { single: metaBase.a }, threshold: bestT, weights: { w, b0, mu, sg }, feats: ["dir", "absImb", "H", "Hp", "hurst", "cpDiff", "vol12x1e4", "tickRate", "z60", "r6x100", "spreadRatio", "hour/24"], hash: sha16({ op: "META", base: metaBase.id, threshold: bestT }), v, train: evalVec(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60), val: evalVec(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60) };
      console.log(`G4 meta: base=${metaBase.id} thr=${bestT} tr=${meta.train.wr}% n=${meta.train.signals} va=${meta.val.wr}% n=${meta.val.signals}`);
    }
    // Regime switch: hurstMR -> z240 ; hurst>0.55 -> exrsi ; H>2.85 -> WAIT ; else -> miimb
    { const v = new Int8Array(N); for (let i = 0; i < N; i++) { const f = F(i); if (f.H > 2.85) continue; if (f.hurst !== null && f.hurst < 0.45) v[i] = comps.z240[i]; else if (f.hurst !== null && f.hurst > 0.55) v[i] = comps.exrsi[i]; else v[i] = comps.miimb[i]; } const rs = { id: "G4_RS_hurst_entropy", gen: "G4", op: "REGIME_SWITCH", hash: sha16({ op: "REGIME_SWITCH", arch: "hurstMR->z240; persist->exrsi; H>2.85 WAIT; else miimb" }), v, train: evalVec(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60), val: evalVec(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60) }; console.log(`G4 RS: tr=${rs.train.wr}% n=${rs.train.signals} va=${rs.val.wr}% n=${rs.val.signals}`); d.rs = rs; }
    // ===== selection + freeze =====
    const cands = [...s1.slice(0, 2).map((r) => ({ ...r, gen: r.gen })), ...s2.slice(0, 2), ...s3.slice(0, 1), ...(meta && meta.train.signals >= 100 ? [meta] : []), d.rs];
    const fibBest = ["v7relaxed", "v7and", "v1", "v3", "v6"].map((c) => ({ id: "G0_" + c, gen: "G0", op: "SINGLE", a: c, v: comps[c], train: evalVec(comps[c], d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60), val: evalVec(comps[c], d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL, 60), hash: sha16({ single: c }) })).sort((a, b) => b.train.wilsonLo - a.train.wilsonLo)[0];
    cands.push(fibBest);
    const finalists = cands.map((r) => ({ id: r.id, gen: r.gen, op: r.op, hash: r.hash, spec: r.spec ? r.spec : r.op === "META" ? { op: "META", base: r.base, baseSpec: r.baseSpec, threshold: r.threshold, weights: r.weights, feats: r.feats } : r.op === "REGIME_SWITCH" ? { op: "REGIME_SWITCH", arch: "hurstMR->z240;persist->exrsi;Hgt2.85 WAIT;else miimb" } : { single: r.a }, train: r.train, val: r.val }));
    d.finalists = finalists; d.vecs = new Map(cands.map((r) => [r.id, r.v]));
    fs.writeFileSync(`${OUT}/cg/finalists-freeze-${d.otc ? "otc" : "bin"}.json`, JSON.stringify({ frozen_at: new Date().toISOString(), market: d.id, finalists: finalists.map((f) => ({ ...f, componentVectors: "runtime" })) }, null, 1));
    // ===== ablation (TRAIN+VAL) =====
    const abl = [];
    for (const r of cands) { if (!r.spec || !["AND", "OR", "CONFIRM", "AND3", "GATE2", "GATE3"].includes(r.op)) continue; const vWithout = (() => { if (r.op === "AND3") { const cs = r.comps; return [AGREE(cs[1], cs[2]), AGREE(cs[0], cs[2]), AGREE(cs[0], cs[1])]; } if (r.op === "GATE2" || r.op === "GATE3") { const parentR = [...r1, ...r2].find((x) => x.id === r.parent); return [parentR.v]; } if (r.op === "AND") return [comps[r.b]]; if (r.op === "OR" || r.op === "CONFIRM") return [comps[r.b]]; return []; })();
      const base = evalVec(r.v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60);
      const without = vWithout.map((vv) => evalVec(vv, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60).wr);
      // counterfactual: destruir informacao do componente A (shuffle)
      const shuffled = (() => { if (r.op === "AND3") return null; const A = comps[r.a]; if (!A) return null; const s = new Int8Array(A.length); const off = 7777; for (let i = 0; i < A.length; i++) s[i] = A[(i + off) % A.length]; return evalVec(r.op === "AND" ? AGREE(s, comps[r.b]) : r.op === "OR" ? UNI(s, comps[r.b]) : CONFIRM(s, comps[r.b]), d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN, 60).wr; })();
      abl.push({ id: r.id, base_wr: base.wr, without_components_wr: without, counterfactual_shuffle_wr: shuffled }); }
    d.abl = abl;
    finalOut[d.id] = { finalists, abl, g1K: g1.length, g2K: g2.length, g3K: g3.length, survivors: { g1: s1.length, g2: s2.length, g3: s3.length }, topG1: s1.slice(0, 10).map((r) => ({ id: r.id, train: r.train, val: r.val, q: r.q })), topG2: s2.slice(0, 5).map((r) => ({ id: r.id, train: r.train, val: r.val, q: r.q })), topG3: s3.slice(0, 3).map((r) => ({ id: r.id, train: r.train, val: r.val, q: r.q })), meta: meta ? { id: meta.id, base: meta.base, threshold: meta.threshold, train: meta.train, val: meta.val } : null, rs: { id: d.rs.id, train: d.rs.train, val: d.rs.val }, correlation: null };
  }
  fs.mkdirSync(OUT + "/cg", { recursive: true });
  fs.writeFileSync(OUT + "/cg/cg-discovery-results.json", JSON.stringify(finalOut, null, 1));
  console.log("\nDISCOVERY DONE (cg-discovery-results.json)");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
