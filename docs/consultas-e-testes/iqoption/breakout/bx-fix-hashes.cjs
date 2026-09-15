// bx-fix-hashes.cjs — patch de hashes (bug: res entries sem hash). Recomputa sha16(spec) e valida contra bx-freeze.json.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const freeze = JSON.parse(fs.readFileSync(OUT + "/bx-freeze.json", "utf8"));
const fmap = new Map(freeze.hypotheses.map((h) => [h.id, h.hash]));
let fixed = 0, mismatch = 0;
for (const file of ["bx-discovery-results.json", "bx-finalists-freeze.json", "bx-prospective-results.json"]) {
  const j = JSON.parse(fs.readFileSync(OUT + "/" + file, "utf8"));
  const patch = (e) => { if (e && e.spec) { const h = sha16(e.spec); const fh = fmap.get(e.id); if (fh && fh !== h) { mismatch += 1; console.log(`  MISMATCH ${e.id}: freeze=${fh} recomputed=${h}`); } e.hash = h; fixed += 1; } };
  if (j.datasets) for (const dsId of Object.keys(j.datasets)) { const ds = j.datasets[dsId]; if (ds.strategies) ds.strategies.forEach(patch); if (ds.finalists) ds.finalists.forEach(patch); }
  fs.writeFileSync(OUT + "/" + file, JSON.stringify(j, null, file.includes("discovery") ? 0 : 1));
  console.log(file + " patch aplicado");
}
console.log(`hashes corrigidos=${fixed} mismatches=${mismatch} (0 mismatches = specs intactos vs freeze)`);
const fin = JSON.parse(fs.readFileSync(OUT + "/bx-finalists-freeze.json", "utf8"));
for (const dsId of Object.keys(fin.datasets)) for (const f of fin.datasets[dsId]) console.log(`${dsId} | ${f.id} | hash=${f.hash}`);
