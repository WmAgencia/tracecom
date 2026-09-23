import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SUITES = Object.freeze([
  "asset-context-tests.mjs",
  "stage3-pipeline-tests.mjs",
  "stage3-wiring-tests.mjs",
  "stage3-runtime-adapter-tests.mjs",
  "stage3-feed-granularity-tests.mjs",
  "stage3-dispatch-tests.mjs",
  "stage3-hydration-tests.mjs",
  "stage3-runtime-integrity-tests.mjs",
  "stage3-broker-contract-tests.mjs",
  "stage3-strategy-hash-tests.mjs",
  "stage4-frontend-tests.mjs",
  "stage5-e2e-practice-tests.mjs",
  "binary300-tests.mjs",
  "execution-gate-tests.mjs",
  "single-path-tests.mjs",
  "agentic-tests.mjs",
  "lab6-tests.mjs",
  "invariants-check.mjs",
]);

export function runAll() {
  const results = [];
  for (const suite of SUITES) {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", suite)], { cwd: ROOT, encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").filter(Boolean);
    results.push({ suite, ok: result.status === 0, last: output[output.length - 1] ?? `exit=${result.status}` });
  }
  const smoke = spawnSync(process.execPath, [path.join(ROOT, "scripts", "stage22-smoke.mjs")], { cwd: ROOT, encoding: "utf8" });
  results.push({ suite: "stage22-smoke.mjs", ok: smoke.status === 0, last: smoke.status === 0 ? "SMOKE OK" : `exit=${smoke.status}` });
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const results = runAll();
  for (const row of results) console.log(`${row.ok ? "OK  " : "FAIL"} ${row.suite} :: ${row.last}`);
  const failed = results.filter((row) => !row.ok);
  console.log(`RUN_ALL_TESTS total=${results.length} failed=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
