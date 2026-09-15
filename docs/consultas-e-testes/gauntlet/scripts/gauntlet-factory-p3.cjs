const fs = require("fs");
const P = require("./gauntlet-factory-p1.cjs");
const GC = require("./gauntlet-compile.cjs");
const { N, N_D, L, B, eqs, stats, mk, mulberry32 } = P;
const ctx = GC.loadCtx(P.rows);
const t0 = Date.now();
const entries = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-results-p1.json", "utf8")).entries;
const results = new Map(); for (const e of entries) results.set(e.id, e);
const vecObj = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-vectors-p1.json", "utf8"));
const vecStore = new Map(); for (const id of Object.keys(vecObj)) vecStore.set(id, Int8Array.from(vecObj[id]));
function evalStrategy(id, family, spec, vec, stage) { const d = stats(vec, 0, N_D), v = stats(vec, N_D, N); const rec = { id, family, stage, spec, disc: d, val: v, ms: Date.now() - t0 }; results.set(id, rec); entries.push(rec); vecStore.set(id, vec); return rec; }
const top1 = P.A.filter((a) => a.family !== "baseline" && results.get(a.id).disc.n >= 40).sort((x, y) => results.get(y.id).disc.wilson_lo - results.get(x.id).disc.wilson_lo).slice(0, 20);
// STAGE 4: gates
let k4 = 0;
for (const a of top1.slice(0, 12)) for (const cname of Object.keys(P.conds)) { const v = eqs.gate(a.vec, P.conds[cname]); evalStrategy(`gate(${a.id}|${cname})`, "gated", { op: "gate", a: a.id, cond: cname, innerSpec: a.spec }, v, 4); k4 += 1; }
for (const a of top1.slice(0, 12)) { const v = ctx.gateFibOk(a.vec); evalStrategy(`gate(${a.id}|fibOk)`, "gated-fib", { op: "gateFib", a: a.id, innerSpec: a.spec }, v, 4); k4 += 1; }
console.log(`stage4: ${k4} gates em ${Date.now() - t0}ms`);
// STAGE 5: refinamento de parametros vizinhos (singles)
const singles = entries.filter((e) => e.stage === 1 && !["baseline", "production"].includes(e.family) && e.disc.n >= 40 && e.val.n >= 10).sort((x, y) => Math.min(y.disc.wilson_lo, y.val.wilson_lo) - Math.min(x.disc.wilson_lo, x.val.wilson_lo)).slice(0, 12);
const neigh = (spec) => { const out = []; const T = spec.type; const add = (s, tag) => out.push({ spec: s, tag }); if (T === "rsi_s" || T === "rsi_vol") { for (const dt of [-0.055, 0.055]) add({ ...spec, t: +(spec.t + dt).toFixed(3) }, `t${dt > 0 ? "+" : ""}${dt}`); } else if (T === "rsi_band") { add({ ...spec, lo: +(spec.lo - 0.05).toFixed(3) }, "lo-0.05"); add({ ...spec, hi: +(spec.hi + 0.05).toFixed(3) }, "hi+0.05"); add({ ...spec, lo: +(spec.lo + 0.05).toFixed(3), hi: +(spec.hi - 0.05).toFixed(3) }, "narrow"); } else if (T === "atr_over") { for (const dm of [-0.25, 0.25]) add({ ...spec, m: +(spec.m + dm).toFixed(2) }, `m${dm}`); } else if (T === "mom_follow" || T === "mom_revert") { add({ ...spec, t: +(spec.t * 1.5).toFixed(7) }, "t*1.5"); add({ ...spec, t: +(spec.t / 1.5).toFixed(7) }, "t/1.5"); } else if (T === "bb_rev") { for (const dt of [-0.05, 0.05]) add({ ...spec, t: +(spec.t + dt).toFixed(2) }, `t${dt}`); } else if (T === "stoch_rev" || T === "stoch_follow") { for (const dt of [-5, 5]) add({ ...spec, t: spec.t + dt }, `t${dt}`); } else if (T === "streak_rev" || T === "streak_follow") { for (const dk of [-1, 1]) if (spec.k + dk >= 2) add({ ...spec, k: spec.k + dk }, `k${dk}`); } else if (T === "er_follow" || T === "er_rev" || T === "er_chop_rev") { for (const dt of [-0.05, 0.05]) add({ ...spec, t: +(spec.t + dt).toFixed(2) }, `t${dt}`); } return out; };
let k5 = 0;
for (const e of singles) { for (const nb of neigh(e.spec)) { try { const v = GC.compile(nb.spec, ctx); evalStrategy(`refine(${e.id}|${nb.tag})`, "refined", nb.spec, v, 5); k5 += 1; } catch (err) { console.log("refine err " + e.id + " " + err.message); } } }
console.log(`stage5: ${k5} refinamentos`);
// STAGE 6: ensembles ponderados (top 6 atoms, subsets de 4)
const top6 = top1.slice(0, 6); let k6 = 0;
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c2 = b + 1; c2 < 6; c2++) for (let d = c2 + 1; d < 6; d++) {
  const sub = [top6[a], top6[b], top6[c2], top6[d]];
  const ws = sub.map((x) => Math.max(0.01, results.get(x.id).disc.acc - 0.5));
  for (const thr of [0.5, 0.75]) { try { const spec = { op: "weighted", specs: sub.map((x) => x.spec), weights: ws, thr }; const v = GC.compile(spec, ctx); evalStrategy(`w4(${sub.map((x) => x.id).join(";")}|thr${thr})`, "ensemble-4-weighted", spec, v, 6); k6 += 1; } catch (err) { } }
}
console.log(`stage6: ${k6} ensembles ponderados`);
console.log(`TOTAL avaliadas: ${entries.length} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// ---- p-valores + BH ----
const phi = (z) => { const x = 1 / (1 + 0.3275911 * Math.abs(z)); let e = 1 - ((((1.061405429 * x - 1.453152027) * x + 1.421413741) * x - 0.284496736) * x + 0.254829592) * x * Math.exp(-z * z); return 0.5 * (1 + (z >= 0 ? e : -e)); };
for (const e of entries) { if (e.disc.n >= 20) { const z = (e.disc.w - 0.5 * e.disc.n) / Math.sqrt(0.25 * e.disc.n); e.disc.p = 1 - phi(z); } else e.disc.p = 1; }
const tested = entries.filter((e) => e.disc.n >= 20 && !["baseline", "production"].includes(e.family));
const sorted = [...tested].sort((a, b) => a.disc.p - b.disc.p); let prevQ = 1;
for (let i = sorted.length - 1; i >= 0; i--) { const q = Math.min(prevQ, sorted[i].disc.p * sorted.length / (i + 1)); sorted[i].disc.q = q; prevQ = q; }
const qCount = (q) => sorted.filter((e) => e.disc.q <= q).length;
console.log(`FDR: K_testadas=${tested.length} | q<=0.05: ${qCount(0.05)} | q<=0.10: ${qCount(0.1)} | q<=0.20: ${qCount(0.2)}`);
// ---- candidatos ----
const mkReason = (e) => { if (e.family === "baseline") return "baseline"; if (e.family === "production") return "production-reference"; if (e.disc.n < 30) return "insufficient_signals_disc"; if (e.disc.acc < 0.55) return "acc_disc_below_0.55"; if (e.val.n < 8) return "insufficient_signals_val"; if (e.val.acc < 0.52) return "acc_val_below_0.52"; if (Math.abs(e.disc.acc - e.val.acc) > 0.25) return "unstable_disc_val_gap"; return "candidate"; };
for (const e of entries) { e.status = mkReason(e); e.elimination_reason = e.status === "candidate" || e.status.startsWith("baseline") || e.status.startsWith("production") ? null : e.status; }
const cands = entries.filter((e) => e.status === "candidate").sort((x, y) => Math.min(y.disc.wilson_lo, y.val.wilson_lo) - Math.min(x.disc.wilson_lo, x.val.wilson_lo));
console.log(`candidatos: ${cands.length}`);
for (const e of cands.slice(0, 10)) console.log(`  ${e.id} | disc n=${e.disc.n} acc=${(e.disc.acc * 100).toFixed(1)}% | val n=${e.val.n} acc=${(e.val.acc * 100).toFixed(1)}% | indep n=${e.disc.indep_n + e.val.indep_n} acc=${((e.disc.indep_w + e.val.indep_w) / Math.max(1, e.disc.indep_n + e.val.indep_n) * 100).toFixed(1)}%`);
// ---- coverage x accuracy (consenso dos top6) ----
const top6ids = top6.map((x) => x.id);
const covOut = [];
for (const e of cands.slice(0, 12)) { const vec = vecStore.get(e.id); if (!vec) continue; const cons = new Int8Array(N); for (const tid of top6ids) { if (tid === e.id) continue; const tv = vecStore.get(tid); for (let i = 0; i < N; i++) if (tv[i] !== 0 && tv[i] === vec[i]) cons[i] += 1; } const idx = []; for (let i = 0; i < N_D; i++) if (vec[i] !== 0 && L[i] !== 0) idx.push(i); idx.sort((a, b) => cons[b] - cons[a] || a - b); const curve = {}; for (const cvg of [1, 0.75, 0.5, 0.25, 0.1, 0.05, 0.01]) { const take = Math.max(1, Math.round(idx.length * cvg)); let w = 0, n = 0; for (let j = 0; j < take; j++) { const i = idx[j]; if (vec[i] === L[i]) w += 1; n += 1; } curve[String(cvg)] = { n, w, acc: n ? +(w / n).toFixed(3) : null }; } covOut.push({ id: e.id, disc_signals: idx.length, curve }); }
// ---- permutacao (circular shift, DISC) ----
const Bper = 1000; const perms = []; const cand12 = cands.slice(0, 12);
for (const e of cand12) { const vec = vecStore.get(e.id); const obsW = e.disc.w, obsN = e.disc.n; let ge = 0; const rnd = mulberry32(1234); const maxArr = new Float64Array(Bper); for (let b = 0; b < Bper; b++) { const sh = Math.floor(rnd() * N_D); let w = 0; for (let i = 0; i < N_D; i++) { const x = vec[i]; if (x === 0) continue; const j = (i + sh) % N_D; const y = L[j]; if (y !== 0 && x === y) w += 1; } maxArr[b] = w; if (w >= obsW) ge += 1; } perms.push({ id: e.id, obsW, obsN, p_perm: (1 + ge) / (Bper + 1), perms_max: maxArr }); }
const bestPerm = perms[0]; const nCand = cand12.length; const fwMax = new Float64Array(Bper); for (let b = 0; b < Bper; b++) { let mx = 0; for (const pr of perms) mx = Math.max(mx, pr.perms_max[b]); fwMax[b] = mx; }
const bestObs = Math.max(...perms.map((p) => p.obsW / Math.max(1, p.obsN))); let fwGe = 0; for (let b = 0; b < Bper; b++) if (fwMax[b] / Math.max(1, bestPerm.obsN) >= bestObs) fwGe += 1;
const permSummary = { permutations: Bper, method: "circular time-shift of labels (DISC), preserves autocorrelation; null acc >= observed", per_candidate: perms.map((p) => ({ id: p.id, p_perm: p.p_perm })), family_wise_p_best: (1 + fwGe) / (Bper + 1) };
// ---- escritas ----
const wl = entries.map((e) => JSON.stringify(e)).join("\n");
fs.writeFileSync("C:/tracecom-forward4/gauntlet-search-log.jsonl", wl);
const baselineTbl = entries.filter((e) => e.family === "baseline" || e.family === "production").map((e) => ({ id: e.id, family: e.family, disc: e.disc, val: e.val }));
fs.writeFileSync("C:/tracecom-forward4/gauntlet-baselines.json", JSON.stringify(baselineTbl, null, 1));
fs.writeFileSync("C:/tracecom-forward4/gauntlet-candidates.json", JSON.stringify(cands, null, 1));
fs.writeFileSync("C:/tracecom-forward4/gauntlet-coverage-accuracy.json", JSON.stringify(covOut, null, 1));
fs.writeFileSync("C:/tracecom-forward4/gauntlet-multiple-testing.json", JSON.stringify({ K_tested: tested.length, q05: qCount(0.05), q10: qCount(0.1), q20: qCount(0.2), expected_false_at_q10: +(0.1 * qCount(0.1)).toFixed(1), permutation: permSummary }, null, 1));
fs.writeFileSync("C:/tracecom-forward4/gauntlet-registry.json", JSON.stringify(entries.map((e) => ({ id: e.id, family: e.family, stage: e.stage, spec: e.spec, disc: e.disc, val: e.val, status: e.status, elimination_reason: e.elimination_reason }))));
console.log("artefatos escritos. candidatos=" + cands.length + " | registry=" + entries.length);
console.log("perm (top por p_perm): " + JSON.stringify(permSummary.per_candidate.slice(0, 5)));
console.log("family-wise p (melhor): " + permSummary.family_wise_p_best);
