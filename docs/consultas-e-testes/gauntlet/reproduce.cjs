// Reproduction script: reruns the entire gauntlet pipeline deterministically.
// Requires: DATABASE_URL env (Supabase, SELECT only), NODE_PATH with pg module.
// Usage (PowerShell): $env:PATH='C:\tracecom-tools\node;'+$env:PATH; $env:NODE_PATH='C:\tracecom-forward4\node_modules'; node reproduce.cjs
const { execFileSync } = require("child_process");
const node = process.execPath;
const dir = __dirname + "/scripts";
const steps = ["gauntlet-dataset.cjs", "gauntlet-features.cjs", "gauntlet-factory-p2.cjs", "gauntlet-factory-p3.cjs", "gauntlet-robustness.cjs", "gauntlet-freeze.cjs", "gauntlet-holdout.cjs", "gauntlet-holdout-sidebreakdown.cjs"];
for (const s of steps) { console.log("=== RUN " + s); execFileSync(node, [dir + "/" + s], { stdio: "inherit", cwd: "C:/tracecom-forward4" }); }
console.log("DONE. Expected: 6878 trades / 3212 snapshots / 2592 eligible / 977 strategies / freeze hash 2a49fb3e2b80ee87331fb2edf318d0d2 / holdout n=517");
