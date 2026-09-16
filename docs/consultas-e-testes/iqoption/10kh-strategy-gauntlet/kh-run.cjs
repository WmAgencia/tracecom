// kh-run.cjs — 17 abordagens sobre 167h reais (BINARY e OTC separados). Splits cronológicos 50/20/15/15 + embargo. Freeze antes de holdout/blind.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const KHF = require(OUT + "/kh-features.cjs");
const GC = require(OUT + "/gauntlet-compile.cjs");
async function getText(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1500)); } }
const mean = KHF.mean, sd = KHF.sd;
function wilson(w, n) { if (!n) return [0, 0]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
function metricsV(v, rows, lo, hi, baseP) { let sig = 0, w = 0, l = 0, d = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, in_ = 0, curW = 0, curL = 0, maxW = 0, maxL = 0, b = 0, s2 = 0;
  for (let i = lo; i < hi; i++) { const x = v[i]; if (x === 0) continue; sig += 1; if (x === 1) b += 1; else s2 += 1; const y = rows[i].l60; if (y === null) continue; if (y === 0) { d += 1; continue; } const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { in_ += 1; if (win) iw += 1; else il += 1; } }
  const n = w + l, bn = bw + bl, sn = sw + sl, hrs = (hi - lo) * 5 / 3600;
  const baseStrategy = sig ? (b * baseP + s2 * (1 - baseP)) / sig : null;
  const wrn = n ? w / n : null; const [wl, wh] = wilson(w, n);
  return { signals: sig, sigPerHour: +(sig / hrs).toFixed(1), w, l, draws: d, wr: wrn === null ? null : +(wrn * 100).toFixed(2), buyN: b, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellN: s2, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: in_, indepWR: in_ ? +((iw / in_) * 100).toFixed(2) : null, indepW: iw, indepL: il, edge_pp: wrn !== null && baseStrategy !== null ? +((wrn - baseStrategy) * 100).toFixed(2) : null, ci95: n ? [+(wl * 100).toFixed(2), +(wh * 100).toFixed(2)] : null, wilsonLo: +(wl * 100).toFixed(2), maxWinStreak: maxW, maxLossStreak: maxL };
}
(async () => {
  // ===== 1) DADOS =====
  const ds = [];
  for (const a of [{ active: 1, id: "IQOPTION_EURUSD_BINARY_7D", otc: false }, { active: 76, id: "IQOPTION_EURUSD_OTC_7D", otc: true }]) {
    const cd = JSON.parse(fs.readFileSync(`${OUT}/kh/candles_a${a.active}.json`, "utf8")).candles;
    const agRaw = JSON.parse(fs.readFileSync(`${OUT}/kh/tickagg_a${a.active}.json`, "utf8")).agg;
    const agg = new Map(agRaw.map(([b, v]) => [b, v]));
    const rows = KHF.labelRows(KHF.computeKh(cd, agg), cd);
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    ds.push({ ...a, candles: cd, rows });
  }
  // ===== 2) PARIDADE kh x engine v2 (6 chaves das Fib) =====
  const runAll = await getText("https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildRows }; ")(require, __dirname);
  { const cd2 = ds[0].candles.slice(0, 3000); const base = engine.buildRows(cd2); const kh = KHF.computeKh(cd2, new Map()); let mism = 0, chk = 0;
    for (let k = 200; k < base.length; k += Math.max(1, Math.floor(base.length / 100))) { const b = base[k].f, h = kh[k - 10].f; for (const key of ["s", "vol12", "r24"]) if (Math.abs(b[key] - h[key]) > 1e-12) mism += 1; for (const key of ["inZone", "upSwing"]) if (b[key] !== h[key]) mism += 1; if (Math.abs(b.distSma20 - h.distSma20) > 1e-9) mism += 1; chk += 1; }
    console.log(`PARIDADE v2 x kh: ${chk} amostras, mismatches=${mism}`); if (mism > 0) throw new Error("PARIDADE FALHOU"); }
  // ===== 3) SPLITS (50/20/15/15 + embargo 24 candles) =====
  for (const d of ds) {
    const N = d.rows.length, b1 = Math.floor(N * 0.5), b2 = Math.floor(N * 0.7), b3 = Math.floor(N * 0.85), E = 24;
    for (let i = 0; i < N; i++) d.rows[i].split = i < b1 ? "TRAIN" : i < b1 + E ? "EMBARGO" : i < b2 ? "VAL" : i < b2 + E ? "EMBARGO" : i < b3 ? "HOLD" : i < b3 + E ? "EMBARGO" : "BLIND";
    d.idx = { train: [0, b1], val: [b1 + E, b2], hold: [b2 + E, b3], blind: [b3 + E, N] };
    const cnt = {}; for (const r of d.rows) cnt[r.split] = (cnt[r.split] || 0) + 1; d.cnt = cnt;
    d.baseP = {}; for (const sp of ["TRAIN", "VAL", "HOLD", "BLIND"]) { let u = 0, dn = 0; for (const r of d.rows) if (r.split === sp) { if (r.l60 === 1) u += 1; else if (r.l60 === -1) dn += 1; } d.baseP[sp] = (u + dn) > 0 ? u / (u + dn) : 0.5; }
    console.log(`${d.id}: rows=${N} splits=${JSON.stringify(cnt)} baseP=${JSON.stringify(Object.fromEntries(Object.entries(d.baseP).map(([k, v]) => [k, +(v * 100).toFixed(2)])))}`);
    d.ctx = GC.loadCtx(d.rows.map((r) => ({ split: r.split, indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
  }
  // ===== 4) FAMILIAS =====
  const H = [];
  const add = (id, fam, spec, vecFn) => H.push({ id, fam, spec, vecFn, hash: sha16(spec) });
  // F01 z-score MR
  for (const zk of ["z60", "z240"]) for (const th of [1.25, 1.5, 2, 2.5, 3]) for (const gate of ["none", "lowVol", "hurstMR"]) add(`z_${zk}_${th}_${gate}`, "F01_meanzscore", { type: "z", zk, th, gate }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (gate === "lowVol" && f.lowVol !== 1) continue; if (gate === "hurstMR" && !(f.hurst !== null && f.hurst < 0.45)) continue; const z = f[zk]; if (z <= -th) v[i] = 1; else if (z >= th) v[i] = -1; } return v; });
  // F02 exhaustion
  for (const th of [0.33, 0.44, 0.55, 0.63]) add(`ex_rsi_${th}`, "F02_exhaustion", { type: "exRsi", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.s > th) v[i] = 1; else if (f.s < -th) v[i] = -1; } return v; });
  for (const cf of [0.6, 0.75]) add(`ex_decel_${cf}`, "F02_exhaustion", { type: "exDecel", cf }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.r6 > 0 && f.accel < 0 && f.bodyContraction < cf) v[i] = -1; else if (f.r6 < 0 && f.accel > 0 && f.bodyContraction < cf) v[i] = 1; } return v; });
  for (const w of [0.55, 0.7]) add(`ex_wick_${w}`, "F02_exhaustion", { type: "exWick", w }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.wickExpansion > w && f.clv > 0.5 && f.r6 < 0) v[i] = 1; else if (f.wickExpansion > w && f.clv < -0.5 && f.r6 > 0) v[i] = -1; } return v; });
  // F03 change-point (mean shift)
  for (const k of [0.5, 0.8]) add(`cp_mean_${k}`, "F03_changepoint", { type: "cpMean", k }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; const sdv = Math.abs(f.r24) / 2 + 1e-9; const diff = (f.r3 - f.r24 / 8); if (diff > k * sdv) v[i] = 1; else if (diff < -k * sdv) v[i] = -1; } return v; });
  // F04 autocorr / runs
  for (const th of [0.15, 0.25]) { add(`ac_follow_${th}`, "F04_autocorr", { type: "acFollow", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.ac1 > th) v[i] = f.r6 > 0 ? 1 : f.r6 < 0 ? -1 : 0; else if (f.ac1 < -th) v[i] = f.r6 > 0 ? -1 : f.r6 < 0 ? 1 : 0; } return v; }); add(`ac_fade_${th}`, "F04_autocorr", { type: "acFade", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.ac1 < -th) v[i] = f.r6 > 0 ? -1 : f.r6 < 0 ? 1 : 0; } return v; }); }
  for (const n of [4, 5, 6]) add(`runs_fade_${n}`, "F04_autocorr", { type: "runsFade", n }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.runUp >= n) v[i] = -1; else if (f.runDn >= n) v[i] = 1; } return v; });
  // F05 Markov (tabela treinada SÓ no TRAIN)
  for (const th of [0.03, 0.05]) add(`mk_3_${th}`, "F05_markov", { type: "mk", L: 3, th }, (d) => { const tbl = {}; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 === null || r.l60 === 0) continue; const key = r.f.dir3; (tbl[key] = tbl[key] || { u: 0, n: 0 }); tbl[key].n += 1; if (r.l60 === 1) tbl[key].u += 1; } const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const t = tbl[d.rows[i].f.dir3]; if (!t || t.n < 300) continue; const p = t.u / t.n; if (p > 0.5 + th) v[i] = 1; else if (p < 0.5 - th) v[i] = -1; } return v; });
  // F06 microestrutura
  for (const th of [0.1, 0.2]) add(`mi_imb_${th}`, "F06_micro", { type: "miImb", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.imb === null) continue; if (f.imb > th) v[i] = 1; else if (f.imb < -th) v[i] = -1; } return v; });
  add("mi_burst_follow", "F06_micro", { type: "miBurst" }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (!f.tickBurst) continue; v[i] = f.r3 > 0 ? 1 : f.r3 < 0 ? -1 : 0; } return v; });
  // F07 entropia
  for (const th of [2.5, 2.7]) add(`en_low_${th}`, "F07_entropy", { type: "enLow", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.H < th && f.r12 > 0) v[i] = 1; else if (f.H < th && f.r12 < 0) v[i] = -1; } return v; });
  for (const th of [0.7, 0.8]) add(`en_perm_${th}`, "F07_entropy", { type: "enPerm", th }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.Hp < th && Math.abs(f.z60) > 1) v[i] = f.z60 > 0 ? -1 : 1; } return v; });
  // F08 hurst
  add("hu_mr", "F08_hurst", { type: "huMr" }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.hurst !== null && f.hurst < 0.45 && Math.abs(f.z60) > 1.25) v[i] = f.z60 > 0 ? -1 : 1; } return v; });
  add("hu_persist", "F08_hurst", { type: "huPersist" }, (d) => { const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const f = d.rows[i].f; if (f.hurst !== null && f.hurst > 0.55) v[i] = f.r24 > 0 ? 1 : f.r24 < 0 ? -1 : 0; } return v; });
  // F09 pattern mining (TRAIN)
  for (const [L, th, sup] of [[3, 0.04, 1500], [5, 0.03, 500], [10, 0.025, 300]]) add(`pt_${L}_${th}`, "F09_patterns", { type: "pt", L, th, sup }, (d) => { const tbl = {}; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 === null || r.l60 === 0) continue; const key = r.f["dir" + L]; (tbl[key] = tbl[key] || { u: 0, n: 0 }); tbl[key].n += 1; if (r.l60 === 1) tbl[key].u += 1; } const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const t = tbl[d.rows[i].f["dir" + L]]; if (!t || t.n < sup) continue; const p = t.u / t.n; if (p > 0.5 + th) v[i] = 1; else if (p < 0.5 - th) v[i] = -1; } return v; });
  // F10 regime clustering (kmeans k=6 no TRAIN)
  add("rg_cluster", "F10_regime", { type: "rg", k: 6 }, (d) => { const tr = []; for (let i = d.idx.train[0]; i < d.idx.train[1]; i += 3) tr.push(i); const feats = ["atrRatioX", "tickRate", "H", "ac1", "absr24", "spreadRatioX"]; const getF = (r) => [r.f.vol12 * 1e4, r.f.tickRate, r.f.H, r.f.ac1, Math.abs(r.f.r24) * 100, r.f.spreadRatio === null ? 1 : r.f.spreadRatio]; const X = tr.map((i) => getF(d.rows[i])); const mu = feats.map((_, k) => mean(X.map((x) => x[k]))); const sg = feats.map((_, k) => sd(X.map((x) => x[k])) || 1); const Z = (x) => x.map((v, k) => (v - mu[k]) / sg[k]); let cent = []; for (let c = 0; c < 6; c++) cent.push(Z(X[Math.floor(tr.length * (c + 0.5) / 6)])); for (let it = 0; it < 12; it++) { const sums = cent.map(() => new Array(6).fill(0)); const cnts = new Array(6).fill(0); for (const xi of X) { const z = Z(xi); let bi = 0, bd = Infinity; for (let c = 0; c < 6; c++) { let dd = 0; for (let k = 0; k < 6; k++) dd += (z[k] - cent[c][k]) ** 2; if (dd < bd) { bd = dd; bi = c; } } for (let k = 0; k < 6; k++) sums[bi][k] += z[k]; cnts[bi] += 1; } for (let c = 0; c < 6; c++) if (cnts[c] > 0) cent[c] = sums[c].map((v) => v / cnts[c]); } const clusterOf = (r) => { const z = Z(getF(r)); let bi = 0, bd = Infinity; for (let c = 0; c < 6; c++) { let dd = 0; for (let k = 0; k < 6; k++) dd += (z[k] - cent[c][k]) ** 2; if (dd < bd) { bd = dd; bi = c; } } return bi; }; const stat = {}; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 === null || r.l60 === 0) continue; const c = clusterOf(r); (stat[c] = stat[c] || { u: 0, n: 0 }); stat[c].n += 1; if (r.l60 === 1) stat[c].u += 1; } const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const r = d.rows[i]; const t = stat[clusterOf(r)]; if (!t || t.n < 1000) continue; const p = t.u / t.n; if (p > 0.52) v[i] = 1; else if (p < 0.48) v[i] = -1; } return v; });
  // F11 ML: logistic regression + GBDT stumps (TRAIN only; scaler do TRAIN)
  const MLF = ["z60", "z240", "s", "vol12", "r1", "r3", "r6", "r12", "r24", "accel", "bodyContraction", "wickExpansion", "ac1", "runDiff", "H", "Hp", "hurst", "imb", "tickRate", "spreadRatio", "distSma20", "distPH", "distPL"];
  function mlFit(d) {
    const tr = []; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 === 1 || r.l60 === -1) tr.push(i); }
    const pre = (r) => { const f = r.f; return MLF.map((k) => { let v; if (k === "runDiff") v = Math.max(-6, Math.min(6, f.runUp - f.runDn)); else if (k === "hurst") v = f.hurst === null ? 0.5 : f.hurst; else if (k === "imb") v = f.imb === null ? 0 : f.imb; else if (k === "spreadRatio") v = f.spreadRatio === null ? 1 : f.spreadRatio; else v = f[k]; return v === null ? 0 : v; }); };
    const X = tr.map((i) => pre(d.rows[i])).map((x) => x.map((v, k) => (k === 3 ? v * 1e4 : k === 18 ? v : k === 21 ? (v === null ? 0 : v) : v)));
    const mu = MLF.map((_, k) => mean(X.map((x) => x[k]))); const sg = MLF.map((_, k) => sd(X.map((x) => x[k])) || 1);
    const Z = (x) => x.map((v, k) => (v - mu[k]) / sg[k]);
    const ZX = X.map(Z); const Y = tr.map((i) => (d.rows[i].l60 === 1 ? 1 : 0));
    let w = new Array(MLF.length).fill(0), b0 = 0; const lr = 0.3, l2 = 1e-3;
    for (let it = 0; it < 250; it++) { const gw = new Array(MLF.length).fill(0); let gb = 0; for (let q = 0; q < ZX.length; q++) { let z = b0; for (let k = 0; k < w.length; k++) z += w[k] * ZX[q][k]; const p = 1 / (1 + Math.exp(-z)); const e = p - Y[q]; gb += e; for (let k = 0; k < w.length; k++) gw[k] += e * ZX[q][k]; } for (let k = 0; k < w.length; k++) w[k] -= lr * (gw[k] / ZX.length + l2 * w[k]); b0 -= lr * gb / ZX.length; }
    const prob = (r) => { const z = Z(pre(r)); let v = b0; for (let k = 0; k < w.length; k++) v += w[k] * z[k]; return 1 / (1 + Math.exp(-v)); };
    return { prob, n: tr.length };
  }
  let mlCache = null;
  for (const th of ["lo", "hi"]) add(`ml_logit_${th}`, "F11_ml", { type: "mlLogit", th }, (d) => { if (!mlCache || mlCache.d !== d) mlCache = { d, m: mlFit(d) }; const m = mlCache.m; const trScores = []; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const r = d.rows[i]; if (r.l60 === 1 || r.l60 === -1) trScores.push({ p: m.prob(r), y: r.l60 === 1 ? 1 : 0 }); }
    const pick = (prec, cov) => { let best = null; for (const t of [0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.65, 0.7, 0.75, 0.8]) { const sel = trScores.filter((s) => s.p >= t); const c = sel.length / trScores.length; if (sel.length < 100 || c < cov) continue; const pr = sel.filter((s) => s.y === 1).length / sel.length; if (pr >= prec) best = t; } return best; };
    const t = th === "hi" ? pick(0.56, 0.005) : pick(0.53, 0.02); if (t === null) return new Int8Array(d.rows.length);
    const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { const p = m.prob(d.rows[i]); if (p >= t) v[i] = 1; else if (p <= 1 - t) v[i] = -1; } return v; });
  // F12 ensemble (voto ponderado das familias no TRAIN)
  add("ens_vote", "F12_ensemble", { type: "ens", th: 3 }, (d) => { const comps = H.filter((h) => ["F01_meanzscore", "F02_exhaustion", "F03_changepoint", "F04_autocorr", "F06_micro", "F07_entropy", "F08_hurst"].includes(h.fam)); const vecs = comps.map((h) => h.vecFn(d)); const ws = comps.map((h, k) => { let w = 0, n = 0; for (let i = d.idx.train[0]; i < d.idx.train[1]; i++) { const x = vecs[k][i]; if (x === 0) continue; const y = d.rows[i].l60; if (y === 1 || y === -1) { n += 1; if (x === y) w += 1; } } const pr = n ? w / n : 0.5; return Math.max(0, pr - 0.5); }); const v = new Int8Array(d.rows.length); for (let i = 0; i < d.rows.length; i++) { let sc = 0; for (let k = 0; k < vecs.length; k++) sc += ws[k] * vecs[k][i]; if (sc >= 0.03) v[i] = 1; else if (sc <= -0.03) v[i] = -1; } return v; });
  // F13-17 Fib congeladas
  const fin = JSON.parse(fs.readFileSync(OUT + "/finalists-manifest.json", "utf8"));
  for (const f of fin.finalists) { }
  const fibSpecs = [{ id: "fib_v7and", spec: { type: "prod", id: "reversion-v7-and" } }, { id: "fib_v6", spec: { type: "prod", id: "reversion-v6-fib" } }, { id: "fib_v1", spec: { type: "prod", id: "reversion-v1-fib" } }, { id: "fib_v3", spec: { type: "prod", id: "reversion-v3-fib" } }, { id: "fib_v7relaxed", spec: { type: "prod", id: "reversion-v7-relaxed" } }];
  const frozenFreeze = JSON.parse(fs.readFileSync(OUT + "/benchmark-freeze.json", "utf8"));
  for (const fs2 of fibSpecs) { const orig = frozenFreeze.strategies.find((x) => x.strategy_id === "prod_" + (fs2.id === "fib_v7and" ? "v7and" : fs2.id === "fib_v6" ? "v6fib" : fs2.id === "fib_v1" ? "v1fib" : fs2.id === "fib_v3" ? "v3fib" : "v7relaxed")); add(fs2.id, "F13_17_fib", fs2.spec, (d) => GC.compile(fs2.spec, d.ctx), orig ? orig.hash : null); }
  // ===== 5) FREEZE (antes de avaliar) =====
  const freeze = { generated_at: new Date().toISOString(), K: H.length, hypotheses: H.map((h) => ({ id: h.id, fam: h.fam, hash: h.hash ?? sha16(h.spec), spec: h.spec })), by_family: H.reduce((m, h) => { m[h.fam] = (m[h.fam] || 0) + 1; return m; }, {}) };
  fs.writeFileSync(OUT + "/kh/kh-freeze.json", JSON.stringify(freeze, null, 1));
  console.log(`KH FREEZE: K=${H.length} ${JSON.stringify(freeze.by_family)}`);
  // ===== 6) AVALIACAO TRAIN/VAL =====
  const results = { generated_at: new Date().toISOString(), split_scheme: "50/20/15/15 + embargo24", datasets: {} };
  for (const d of ds) {
    const out = [];
    for (const h of H) { const v = h.vecFn(d); const tr = metricsV(v, d.rows, d.idx.train[0], d.idx.train[1], d.baseP.TRAIN); const va = metricsV(v, d.rows, d.idx.val[0], d.idx.val[1], d.baseP.VAL); out.push({ id: h.id, fam: h.fam, hash: h.hash ?? sha16(h.spec), spec: h.spec, train: tr, val: va }); }
    results.datasets[d.id] = out;
    // selecao pre-registrada: melhor por familia (TRAIN wilsonLo com sig>=200 e indepN>=30), mantendo se VAL nao colapsa
    const byFam = {};
    for (const r of out) { const cur = byFam[r.fam]; if (!cur || (r.train.wilsonLo > cur.train.wilsonLo)) byFam[r.fam] = r; }
    const finalists = Object.values(byFam).filter((r) => r.train.signals >= 200 && r.train.indepN >= 30 && r.val.signals >= 40 && r.val.wilsonLo >= 40).sort((a, b) => b.train.wilsonLo - a.train.wilsonLo);
    d.finalists = finalists;
    console.log(`\n=== ${d.id} ===`);
    for (const r of finalists) console.log(`  [${r.fam}] ${r.id} | train: sig=${r.train.signals} WR=${r.train.wr}% indep=${r.train.indepN}/${r.train.indepWR}% | val: sig=${r.val.signals} WR=${r.val.wr}% indep=${r.val.indepN}/${r.val.indepWR}% | hash=${(r.hash ?? "").slice(0, 12)}`);
    const w70 = out.filter((r) => r.train.wr >= 70 && r.train.signals >= 50);
    console.log(`  TRAIN >=70% (n>=50): ${w70.length ? w70.map((r) => `${r.id}(${r.train.wr}% n=${r.train.signals})`).join(" ") : "NENHUMA"}`);
  }
  const finalistsFreeze = { frozen_at: new Date().toISOString(), rule: "por dataset: melhor spec por familia (TRAIN wilsonLo, sig>=200, indepN>=30) que nao colapsa no VAL (sig>=40, wilsonLo>=40)", datasets: Object.fromEntries(ds.map((d) => [d.id, d.finalists.map((r) => ({ id: r.id, fam: r.fam, hash: r.hash ?? sha16(r.spec), spec: r.spec, train: r.train, val: r.val }))])) };
  fs.writeFileSync(OUT + "/kh/kh-finalists-freeze.json", JSON.stringify(finalistsFreeze, null, 1));
  // ===== 7) HOLDOUT (report only) + WALK-FORWARD =====
  const hw = { generated_at: new Date().toISOString(), datasets: {} };
  for (const d of ds) {
    const per = [];
    for (const f of d.finalists) { const h = H.find((x) => x.id === f.id); const v = h.vecFn(d); const ho = metricsV(v, d.rows, d.idx.hold[0], d.idx.hold[1], d.baseP.HOLD);
      // walk-forward: 7 blocos de ~24h sobre TRAIN+VAL+HOLD
      const blocks = []; const N3 = d.idx.hold[1]; const bsz = Math.floor(N3 / 7);
      for (let b = 0; b < 7; b++) { const lo = b * bsz, hi = b === 6 ? N3 : (b + 1) * bsz; let u = 0, dn = 0; for (let i = lo; i < hi; i++) { if (d.rows[i].l60 === 1) u += 1; else if (d.rows[i].l60 === -1) dn += 1; } const bp = u / (u + dn); const m = metricsV(v, d.rows, lo, hi, bp); blocks.push({ start: new Date(d.rows[lo].t0).toISOString().slice(0, 10), wr: m.wr, sig: m.signals, indepN: m.indepN }); }
      per.push({ id: f.id, fam: f.fam, hash: f.hash, train: f.train, val: f.val, holdout: ho, walk_forward: blocks });
    }
    hw.datasets[d.id] = per;
    console.log(`\n${d.id} HOLDOUT:`);
    for (const r of per) console.log(`  ${r.id} | hold: sig=${r.holdout.signals} WR=${r.holdout.wr}% indep=${r.holdout.indepN}/${r.holdout.indepWR}% | wf: ${r.walk_forward.map((b) => b.wr === null ? "-" : `${b.wr}`).join("/")}`);
  }
  fs.writeFileSync(OUT + "/kh/kh-validation-results.json", JSON.stringify({ ...results, holdout_walkforward: hw }, null, 1));
  // ===== 8) FINAL BLIND (uma vez, apos freeze) =====
  const blind = { generated_at: new Date().toISOString(), note: "FINAL BLIND aberto UMA vez apos freeze dos finalistas", datasets: {} };
  for (const d of ds) {
    const per = [];
    for (const f of d.finalists) { const h = H.find((x) => x.id === f.id); const v = h.vecFn(d); const bl = metricsV(v, d.rows, d.idx.blind[0], d.idx.blind[1], d.baseP.BLIND); per.push({ id: f.id, fam: f.fam, hash: f.hash, blind: bl, train: f.train, val: f.val, holdout: (hw.datasets[d.id].find((x) => x.id === f.id) || {}).holdout }); }
    blind.datasets[d.id] = per;
    console.log(`\n${d.id} FINAL BLIND:`);
    for (const r of per) console.log(`  ${r.id} | blind: sig=${r.blind.signals} WR=${r.blind.wr}% BUY ${r.blind.buyWR}% SELL ${r.blind.sellWR}% indep=${r.blind.indepN}/${r.blind.indepWR}% edge=${r.blind.edge_pp}pp`);
    const w70 = per.filter((r) => r.blind.wr >= 70 && r.blind.signals >= 50);
    console.log(`  BLIND >=70% (n>=50): ${w70.length ? w70.map((r) => `${r.id}(${r.blind.wr}% n=${r.blind.signals})`).join(" ") : "NENHUMA"}`);
  }
  fs.writeFileSync(OUT + "/kh/kh-blind-results.json", JSON.stringify(blind, null, 1));
  // persistir resumo no Supabase
  const summary = { K: H.length, by_family: freeze.by_family, datasets: Object.fromEntries(ds.map((d) => [d.id, { rows: d.rows.length, cnt: d.cnt, finalists: (d.finalists || []).map((r) => ({ id: r.id, train: r.train.wr, val: r.val.wr })) }])), blind: Object.fromEntries(Object.entries(blind.datasets).map(([k, v]) => [k, v.map((r) => ({ id: r.id, blind_wr: r.blind.wr, blind_sig: r.blind.signals, blind_indep: `${r.blind.indepN}/${r.blind.indepWR}` }))])) };
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('kh-17fam-2026-09-15', now(), '${JSON.stringify(summary).replace(/'/g, "''")}'::jsonb, 'kh-features.cjs + kh-run.cjs') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nKH RUN DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
