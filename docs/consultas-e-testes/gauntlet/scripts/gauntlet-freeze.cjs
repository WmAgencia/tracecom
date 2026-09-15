const fs = require("fs"); const crypto = require("crypto");
const registry = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-registry.json", "utf8"));
const rob = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-robustness.json", "utf8"));
const byId = new Map(registry.map((e) => [e.id, e]));
const FINALISTS = [
  { id: "and(fib_ctx,stoch_r_30)", hypothesis: "Fibonacci golden zone alignment (upSwing context) + statistical oversold/overbought (Stochastic<30/>70) = structural confluence for reversion" },
  { id: "and(struct_f,macd_r)", hypothesis: "Swing structure (HH/HL or LH/LL) + MACD histogram fade = trend-with-structure reversion" },
  { id: "gate(struct_f|bullDiv)", hypothesis: "Swing structure signals traded only when causal RSI/price divergence present (bullDiv/bearDiv computed on window ending at T)" },
  { id: "gate(struct_f|expansion>1.3)", hypothesis: "Swing structure signals traded only in range-expansion regimes (recent 4-candle range vs 20-candle avg > 1.3)" },
];
const REFS = ["prod_v1fib", "prod_v3fib", "prod_v6fib", "prod_v7and", "prod_v7relaxed", "always_buy", "always_sell", "random42", "last_candle", "mom_f_0.0002", "rsi_band_0.63_0.857", "struct_f", "stoch_r_30", "fib_ctx", "macd_r", "div_r", "and(struct_f,stoch_r_30)", "and(fib_ctx,macd_r)"];
const robById = new Map(rob.candidates.map((c) => [c.id, c]));
const finalists = FINALISTS.map((f) => { const e = byId.get(f.id); if (!e) throw new Error("missing " + f.id); const rb = robById.get(f.id); return { id: f.id, spec: e.spec, hypothesis: f.hypothesis, pre_holdout: { disc: e.disc, val: e.val, folds_disc: rb ? rb.fold_accs : null, p_perm: rb && rb.perm ? rb.perm.p_perm : null, indep: rb ? rb.indep_combined : null } }; });
const references = REFS.map((id) => { const e = byId.get(id); if (!e) throw new Error("missing ref " + id); return { id, spec: e.spec, note: e.family }; });
const hash = crypto.createHash("sha256").update(JSON.stringify({ finalists: finalists.map((f) => ({ id: f.id, spec: f.spec })), references: references.map((r) => ({ id: r.id, spec: r.spec })) })).digest("hex").slice(0, 32);
const manifest = { frozen_at: new Date().toISOString(), hash, protocol: "Frozen BEFORE blind holdout; executed exactly once after this file was written; no post-holdout adjustments allowed.", selection_notes: "Selection used DISC (train criterion) and VAL (stability filter) only. HOLD (517 rows, incl. 65 independent) was NEVER used by any builder/critic script before this freeze.", finalists, references };
fs.writeFileSync("C:/tracecom-forward4/finalists-manifest.json", JSON.stringify(manifest, null, 1));
const mtPath = "C:/tracecom-forward4/gauntlet-multiple-testing.json";
const mt = JSON.parse(fs.readFileSync(mtPath, "utf8"));
mt.permutation.note_units_bug = "Initial FW calc in factory-p3 compared wins-count vs accuracy (units bug), producing 1.0; corrected in gauntlet-robustness.cjs (accuracy-normalized, max-stat) — value below is the corrected one.";
mt.permutation.family_wise_p_best_corrected = rob.permutation_familywise;
fs.writeFileSync(mtPath, JSON.stringify(mt, null, 1));
console.log("FREEZE ok. hash=" + hash);
console.log("finalists: " + finalists.map((f) => f.id).join(" | "));
console.log("refs: " + references.length);
