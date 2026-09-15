const fs = require("fs");
const GC = require("./gauntlet-compile.cjs");
const manifest = JSON.parse(fs.readFileSync("C:/tracecom-forward4/finalists-manifest.json", "utf8"));
const all = fs.readFileSync("C:/tracecom-forward4/gauntlet-features.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows = all.filter((r) => r.split === "HOLD").sort((a, b) => a.t0 - b.t0);
const ctx = GC.loadCtx(rows);
const out = { generated_at: new Date().toISOString(), note: "POST-HOC direction-conditioned analysis of the executed holdout. Frozen strategies unchanged; no re-tuning. Compares each finalist side vs directional base rates on the SAME rows.", asset_mix_holdout: {}, period: { from: new Date(rows[0].t0).toISOString(), to: new Date(rows[rows.length - 1].t0).toISOString() }, finalists: [] };
for (const r of rows) out.asset_mix_holdout[r.asset] = (out.asset_mix_holdout[r.asset] || 0) + 1;
const sellBase = (() => { let w = 0, n = 0; for (let i = 0; i < ctx.N; i++) if (ctx.L[i] !== 0) { n += 1; if (ctx.L[i] === -1) w += 1; } return n ? w / n : null; })();
const buyBase = (() => { let w = 0, n = 0; for (let i = 0; i < ctx.N; i++) if (ctx.L[i] !== 0) { n += 1; if (ctx.L[i] === 1) w += 1; } return n ? w / n : null; })();
out.directional_base_rates = { buy_acc: +buyBase.toFixed(3), sell_acc: +sellBase.toFixed(3), n_labeled: rows.filter((r) => r.l60 === 1 || r.l60 === -1).length };
for (const f of manifest.finalists) {
  const v = GC.compile(f.spec, ctx);
  let bw = 0, bl = 0, sw = 0, sl = 0; const nB = v.filter((x) => x === 1).length, nS = v.filter((x) => x === -1).length;
  for (let i = 0; i < ctx.N; i++) { const x = v[i]; if (x === 0) continue; const y = ctx.L[i]; if (y === 0) continue; if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } }
  out.finalists.push({ id: f.id, sell_side: { n: sw + sl, acc: (sw + sl) ? +(sw / (sw + sl)).toFixed(3) : null, base: +sellBase.toFixed(3), edge_vs_base: (sw + sl) ? +((sw / (sw + sl)) - sellBase).toFixed(3) : null }, buy_side: { n: bw + bl, acc: (bw + bl) ? +(bw / (bw + bl)).toFixed(3) : null, base: +buyBase.toFixed(3), edge_vs_base: (bw + bl) ? +((bw / (bw + bl)) - buyBase).toFixed(3) : null }, sells: nS, buys: nB });
}
fs.writeFileSync("C:/tracecom-forward4/gauntlet-holdout-sidebreakdown.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
