const fs = require("fs");
const P = require("./gauntlet-factory-p1.cjs");
const GC = require("./gauntlet-compile.cjs");
const rows = P.rows, N = P.N, N_D = P.N_D, L = P.L;
const ctx = GC.loadCtx(rows);
const cands = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-candidates.json", "utf8"));
const top = cands.slice(0, 15);
const comp = (spec) => GC.compile(spec, ctx);
const evalVec = (v, lo, hi) => P.stats(v, lo, hi);
const foldBounds = [0, Math.floor(N_D * 0.25), Math.floor(N_D * 0.5), Math.floor(N_D * 0.75), N_D];
const out = { generated_at: new Date().toISOString(), folds_on_disc: foldBounds.slice(0, 5), candidates: [] };
const byAsset = {}, byHour = {}, byRegime = {}, byVol = {};
for (const r of rows) { byAsset[r.asset] = byAsset[r.asset] || []; byAsset[r.asset].push(r); const h = r.f.hour; const hb = h < 6 ? "h0-5" : h < 12 ? "h6-11" : h < 18 ? "h12-17" : "h18-23"; byHour[hb] = (byHour[hb] || 0) + 1; }
const rowIdx = { asset: {}, hour: {}, regime: {}, vol: {} };
for (let i = 0; i < N; i++) { const r = rows[i];
  (rowIdx.asset[r.asset] = rowIdx.asset[r.asset] || []).push(i);
  const h = r.f.hour; const hb = h < 6 ? "h0-5" : h < 12 ? "h6-11" : h < 18 ? "h12-17" : "h18-23"; (rowIdx.hour[hb] = rowIdx.hour[hb] || []).push(i);
  const er = r.f.er30; (rowIdx.regime[er > 0.5 ? "trend" : er < 0.35 ? "chop" : "mid"] = rowIdx.regime[er > 0.5 ? "trend" : er < 0.35 ? "chop" : "mid"] || []).push(i);
  (rowIdx.vol[r.f.vol12 < 0.0009 ? "lowVol" : "highVol"] = rowIdx.vol[r.f.vol12 < 0.0009 ? "lowVol" : "highVol"] || []).push(i);
}
const subStats = (v, idxList) => { let w = 0, l = 0, d = 0; for (const i of idxList) { const x = v[i]; if (x === 0) continue; const y = L[i]; if (y === 0) { d += 1; continue; } if (x === y) w += 1; else l += 1; } const n = w + l; return { n, w, l, d, acc: n ? +(w / n).toFixed(3) : null }; };
function ablations(spec) {
  const res = [];
  try {
    if (spec.op === "and" || spec.op === "union") { for (const side of ["aSpec", "bSpec"]) { const sv = comp(spec[side]); res.push({ ablated: side, disc: evalVec(sv, 0, N_D), val: evalVec(sv, N_D, N) }); } }
    if (spec.op === "and3" || spec.op === "vote3" || spec.op === "weighted") { for (let i = 0; i < spec.specs.length; i++) { const sv = comp(spec.specs[i]); res.push({ ablated: "comp" + i, disc: evalVec(sv, 0, N_D), val: evalVec(sv, N_D, N) }); } }
    if (spec.op === "gate" || spec.op === "gateFib") { const inner = comp(spec.innerSpec); res.push({ ablated: "gate_removed", disc: evalVec(inner, 0, N_D), val: evalVec(inner, N_D, N) }); }
    if (spec.op === "gate" && spec.innerSpec && spec.innerSpec.type === "prod") { }
  } catch (e) { res.push({ ablated: "error", msg: e.message }); }
  return res;
}
// ---- permutation corrigida (acc normalizada por shift, max-stat FW) ----
const Bper = 1000;
function permFor(vec) { const obs = evalVec(vec, 0, N_D); if (!obs.n) return null; const rnd = P.mulberry32(777); const accs = new Float64Array(Bper); let ge = 0; for (let b = 0; b < Bper; b++) { const sh = Math.floor(rnd() * N_D); let w = 0, l = 0; for (let i = 0; i < N_D; i++) { const x = vec[i]; if (x === 0) continue; const y = L[(i + sh) % N_D]; if (y === 0) continue; if (x === y) w += 1; else l += 1; } const acc = (w + l) ? w / (w + l) : 0; accs[b] = acc; if (acc >= obs.acc) ge += 1; } return { obs_acc: obs.acc, obs_n: obs.n, p_perm: (1 + ge) / (Bper + 1), accs }; }
const allAccs = [];
for (const e of top) {
  let vec, err = null; try { vec = comp(e.spec); } catch (ex) { err = ex.message; }
  if (!vec) { out.candidates.push({ id: e.id, error: err }); continue; }
  const d = evalVec(vec, 0, N_D), v = evalVec(vec, N_D, N);
  const folds = []; for (let f = 0; f < 4; f++) folds.push(subStats(vec, Array.from({ length: foldBounds[f + 1] - foldBounds[f] }, (_, j) => foldBounds[f] + j)));
  const perm = permFor(vec);
  const rec = { id: e.id, family: e.family, spec: e.spec, disc: d, val: v, indep_combined: { n: d.indep_n + v.indep_n, acc: (d.indep_n + v.indep_n) ? +((d.indep_w + v.indep_w) / (d.indep_n + v.indep_n)).toFixed(3) : null }, folds_disc: folds, fold_accs: folds.map((f) => f.acc), fold_min: Math.min(...folds.map((f) => f.acc ?? 1)), fold_spread: +(Math.max(...folds.map((f) => f.acc ?? 0)) - Math.min(...folds.map((f) => f.acc ?? 1))).toFixed(3), by_asset: {}, by_hour: {}, by_regime: {}, by_vol: {}, ablation: ablations(e.spec), perm: perm ? { p_perm: perm.p_perm, obs_acc: perm.obs_acc, obs_n: perm.obs_n } : null };
  for (const k of Object.keys(rowIdx.asset)) rec.by_asset[k] = subStats(vec, rowIdx.asset[k]);
  for (const k of Object.keys(rowIdx.hour)) rec.by_hour[k] = subStats(vec, rowIdx.hour[k]);
  for (const k of Object.keys(rowIdx.regime)) rec.by_regime[k] = subStats(vec, rowIdx.regime[k]);
  for (const k of Object.keys(rowIdx.vol)) rec.by_vol[k] = subStats(vec, rowIdx.vol[k]);
  out.candidates.push(rec);
  if (perm) allAccs.push(perm.accs);
}
let fwP = null;
if (allAccs.length) { const bestObs = Math.max(...out.candidates.filter((c) => c.perm).map((c) => c.perm.obs_acc)); let fwGe = 0; for (let b = 0; b < Bper; b++) { let mx = 0; for (const a of allAccs) mx = Math.max(mx, a[b]); if (mx >= bestObs) fwGe += 1; } fwP = { best_obs_acc: bestObs, family_wise_p: (1 + fwGe) / (Bper + 1), method: "max acc across candidates vs 1000 circular label shifts (DISC)" }; }
out.permutation_familywise = fwP;
fs.writeFileSync("C:/tracecom-forward4/gauntlet-robustness.json", JSON.stringify(out, null, 1));
console.log("robustez salva. candidatos analisados: " + out.candidates.length);
for (const c of out.candidates.slice(0, 15)) { if (c.error) { console.log(`  ${c.id} ERRO ${c.error}`); continue; } console.log(`  ${c.id} | disc ${c.disc.n}/${(c.disc.acc * 100).toFixed(1)}% | val ${c.val.n}/${(c.val.acc * 100).toFixed(1)}% | folds ${c.fold_accs.map((x) => x === null ? "-" : (x * 100).toFixed(0)).join("/")} | indep ${c.indep_combined.n}/${(c.indep_combined.acc * 100).toFixed(1)}% | p_perm ${c.perm ? c.perm.p_perm.toFixed(3) : "-"}`); }
console.log("FW permutation: " + JSON.stringify(fwP));
