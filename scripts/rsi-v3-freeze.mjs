/**
 * RSI V3 FREEZE — hashes da skill V3, runner V3, runtime e referencias congeladas (V1/V2).
 *
 * Uso:
 *   node scripts/rsi-v3-freeze.mjs            # verifica (exit 1 se divergir)
 *   node scripts/rsi-v3-freeze.mjs --write    # grava docs/research/data/rsi-v3-freeze.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/rsi-v3-freeze.json";

export const RSI_V3_FREEZE_FILES = [
  "relay/rsi-v3.mjs",
  "relay/rsi-agents-v3.mjs",
  "relay/iq-multi-runtime.mjs",
  "relay/rsi-skills-v2.mjs",
  "relay/rsi-agents-v2.mjs",
  "relay/rsi-reversal.mjs",
  "relay/rsi-variants.mjs",
  "relay/rsi-agents-5x5.mjs",
];

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

function build() {
  const files = {};
  for (const file of RSI_V3_FREEZE_FILES) files[file] = { sha256: sha256File(file), bytes: fs.statSync(path.join(ROOT, file)).size };
  return {
    schema: "rsi-v3-freeze-v1",
    frozenAtUtc: new Date().toISOString(),
    sourceCommit: process.env.GIT_COMMIT ?? null,
    noTuning: true,
    strategy: "RSI_REVERSAL_PULLBACK_V3",
    policy: { practiceOnly: true, realLocked: true, stakeBrl: 10, routing: "RSI_V3_ONLY", singleBrokerPath: "runtime.submitAgentV3Order -> requestOrder", shadowV2: true, controlsExecution: "apenas V3" },
    references: { v1: ["relay/rsi-reversal.mjs", "relay/rsi-variants.mjs", "relay/rsi-agents-5x5.mjs"], v2: ["relay/rsi-skills-v2.mjs", "relay/rsi-agents-v2.mjs"] },
    files,
  };
}

const result = build();
const write = process.argv.includes("--write");
if (write) {
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`RSI_V3_FREEZE_WRITTEN ${MANIFEST_PATH}`);
  process.exit(0);
}
const current = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"));
const diverged = RSI_V3_FREEZE_FILES.filter((file) => current.files?.[file]?.sha256 !== result.files[file].sha256);
if (diverged.length) {
  console.error(`RSI_V3_FREEZE_DIVERGED ${diverged.join(",")}`);
  process.exit(1);
}
console.log("RSI_V3_FREEZE_OK");
