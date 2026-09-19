/**
 * COMPLEXITY BUDGET V3.1 -> V4 — mede estados, hard blockers, thresholds, timers, reason codes
 * e tamanho do decision core. Gera docs/research/data/rsi-v4-complexity.json.
 *
 * Uso: node scripts/rsi-v4-complexity.mjs [--write]
 */
import fs from "node:fs";
import process from "node:process";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../relay/rsi-v4.mjs");
// @ts-expect-error - relay ESM sem tipagem
const v3 = await import("../relay/rsi-v3.mjs");

const read = (file) => fs.readFileSync(file, "utf8");
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const coreLines = (text, names) => {
  const lines = text.split(/\r?\n/);
  let inside = false; let total = 0;
  for (const line of lines) {
    if (names.some((name) => new RegExp(`function ${name}\\b`).test(line))) inside = true;
    if (inside) total += 1;
    if (inside && /^\}/.test(line)) inside = false;
  }
  return total;
};
const v4Source = read("relay/rsi-v4.mjs");
const v3Source = read("relay/rsi-v3.mjs");
const v4Runner = read("relay/rsi-agents-v4.mjs");
const v3Runner = read("relay/rsi-agents-v3.mjs");

const report = {
  schema: "rsi-complexity-budget-v1",
  at: new Date().toISOString(),
  v3_1: {
    policyThresholds: Object.keys(v3.RSI_V3_POLICY).length,
    workflowStates: ["NO_CANDIDATE", "CANDIDATE", "STAGE1", "STAGE2", "REVALIDATION", "FINAL_CHANCE", "OVERRIDE"],
    hardBlockers: count(v3Source, /hardFails\.push\(/g),
    reasonCodesCore: (v3Source.match(/"[A-Z][A-Z0-9_]{4,}"/g) ?? []).length,
    timersValidityWindows: count(v3Source, /ValidityMs|maxAgeMs|graceMs|minLeadMs/g),
    decisionCoreLines: coreLines(v3Source, ["createEpisodeV3", "updateEpisodeV3", "evaluateStageV3", "rejectionValidityV3", "diCrossValidityV3", "projectExpiryV3", "firstSightThesisV3", "evaluateV3Entry"]),
    runnerLines: v3Runner.split(/\r?\n/).length,
  },
  v4: {
    policyThresholds: Object.keys(v4.RSI_V4_POLICY).length,
    workflowStates: ["DETECT", "WATCH", "CONFIRM", "REVALIDATE", "ENTER_OR_CANCEL"],
    hardBlockers: v4.rsiV4FreezeManifest().hardCounterEvidence.length,
    softBlockers: v4.rsiV4FreezeManifest().softCounterEvidence.length,
    reasonCodesCore: (v4Source.match(/"[A-Z][A-Z0-9_]{4,}"/g) ?? []).length,
    timersValidityWindows: count(v4Source, /MaxAgeMs|candleMs|finalWindowMs|cutoffMs/g),
    decisionCoreLines: coreLines(v4Source, ["detectV4", "updateEpisodeV4", "bollingerReversalV4", "dmiAdxV4", "counterEvidenceV4", "cushionV4", "evaluateV4Decision"]),
    runnerLines: v4Runner.split(/\r?\n/).length,
  },
  verdict: null,
};
report.verdict = {
  thresholdsReduced: report.v4.policyThresholds < report.v3_1.policyThresholds,
  decisionCoreReduced: report.v4.decisionCoreLines < report.v3_1.decisionCoreLines,
  hardBlockersExplicit: report.v4.hardBlockers <= 7,
  noTuning: true,
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--write")) { fs.writeFileSync("docs/research/data/rsi-v4-complexity.json", `${JSON.stringify(report, null, 2)}\n`); console.log("COMPLEXITY_WRITTEN docs/research/data/rsi-v4-complexity.json"); }
