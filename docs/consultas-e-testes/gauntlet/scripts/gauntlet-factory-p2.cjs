const fs = require("fs");
const P = require("./gauntlet-factory-p1.cjs");
const { A, N, N_D, eqs, stats } = P;
const t0 = Date.now();
const results = new Map(); const entries = [];
function evalStrategy(id, family, spec, vec, stage) { const d = stats(vec, 0, N_D), v = stats(vec, N_D, N); const rec = { id, family, stage, spec, disc: d, val: v, ms: Date.now() - t0 }; results.set(id, rec); entries.push(rec); return rec; }
for (const a of A) evalStrategy(a.id, a.family, a.spec, a.vec, 1);
console.log(`stage1: ${A.length} atoms em ${Date.now() - t0}ms`);
const top1 = A.filter((a) => a.family !== "baseline" && results.get(a.id).disc.n >= 40).sort((x, y) => results.get(y.id).disc.wilson_lo - results.get(x.id).disc.wilson_lo).slice(0, 20);
console.log("top5 atoms DISC: " + top1.slice(0, 5).map((a) => `${a.id} n=${results.get(a.id).disc.n} acc=${(results.get(a.id).disc.acc * 100).toFixed(1)}%`).join(" | "));
const vecStore = new Map();
for (const a of A) vecStore.set(a.id, a.vec);
let k2 = 0;
for (let i = 0; i < top1.length; i++) for (let j = i + 1; j < top1.length; j++) {
  const a = top1[i], b = top1[j];
  const vid = `and(${a.id},${b.id})`; const vv = eqs.and(a.vec, b.vec); vecStore.set(vid, vv); evalStrategy(vid, "combo-2-and", { op: "and", a: a.id, b: b.id, aSpec: a.spec, bSpec: b.spec }, vv, 2);
  const uid = `union(${a.id},${b.id})`; const uv = eqs.union(a.vec, b.vec); vecStore.set(uid, uv); evalStrategy(uid, "combo-2-union", { op: "union", a: a.id, b: b.id, aSpec: a.spec, bSpec: b.spec }, uv, 2);
  k2 += 2;
}
console.log(`stage2: ${k2} pares em ${Date.now() - t0}ms`);
const cand3 = top1.slice(0, 10); let k3 = 0;
for (let i = 0; i < cand3.length; i++) for (let j = i + 1; j < cand3.length; j++) for (let k = j + 1; k < cand3.length; k++) {
  const a = cand3[i], b = cand3[j], c2 = cand3[k];
  const vs = [a.id, b.id, c2.id];
  const v3 = eqs.vote3(a.vec, b.vec, c2.vec); const v3id = `vote3(${vs.join(";")})`; vecStore.set(v3id, v3); evalStrategy(v3id, "ensemble-3-vote", { op: "vote3", a: a.id, b: b.id, c: c2.id, specs: [a.spec, b.spec, c2.spec] }, v3, 3);
  const v3a = eqs.and(eqs.and(a.vec, b.vec), c2.vec); const a3id = `and3(${vs.join(";")})`; vecStore.set(a3id, v3a); evalStrategy(a3id, "combo-3-and", { op: "and3", a: a.id, b: b.id, c: c2.id, specs: [a.spec, b.spec, c2.spec] }, v3a, 3);
  k3 += 2;
}
console.log(`stage3: ${k3} trios em ${Date.now() - t0}ms`);
const best = entries.filter((e) => e.disc.n >= 30).sort((x, y) => y.disc.acc - x.disc.acc).slice(0, 8);
console.log("top3 geral DISC (n>=30):");
for (const e of best.slice(0, 3)) console.log(`  ${e.id} | disc: n=${e.disc.n} acc=${(e.disc.acc * 100).toFixed(1)}% | val: n=${e.val.n} acc=${(e.val.acc * 100).toFixed(1)}%`);
fs.writeFileSync("C:/tracecom-forward4/gauntlet-results-p1.json", JSON.stringify({ entries }));
const vecObj = {}; for (const [id, v] of vecStore) vecObj[id] = Array.from(v);
fs.writeFileSync("C:/tracecom-forward4/gauntlet-vectors-p1.json", JSON.stringify(vecObj));
console.log(`salvos: results=${entries.length} vectors=${vecStore.size}`);
