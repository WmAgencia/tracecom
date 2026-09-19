/**
 * RSI V4 FREEZE — hashes do core V4, runner V4, scheduler watch e runtime (hot path).
 *
 * Uso:
 *   node scripts/rsi-v4-freeze.mjs            # verifica (exit 1 se divergir)
 *   node scripts/rsi-v4-freeze.mjs --write    # grava docs/research/data/rsi-v4-freeze.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/rsi-v4-freeze.json";

export const RSI_V4_FREEZE_FILES = [
  "relay/rsi-v4.mjs",
  "relay/rsi-agents-v4.mjs",
  "relay/rsi-v3-watch.mjs",
  "relay/iq-multi-runtime.mjs",
];

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

function build() {
  const files = {};
  for (const file of RSI_V4_FREEZE_FILES) files[file] = { sha256: sha256File(file), bytes: fs.statSync(path.join(ROOT, file)).size };
  return {
    schema: "rsi-v4-freeze-v1",
    frozenAtUtc: new Date().toISOString(),
    sourceCommit: process.env.GIT_COMMIT ?? null,
    noTuning: true,
    strategy: "RSI_REVERSAL_V4",
    policy: { practiceOnly: true, realLocked: true, stakeBrl: 10, routing: "RSI_V4_ONLY", singleBrokerPath: "runtime.submitAgentV4Order -> requestOrder", instruments: ["BINARY", "BLITZ_45S"], controlsExecution: "apenas V4" },
    files,
  };
}

const result = build();
const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
const write = process.argv.includes("--write");
if (isMain && write) {
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`RSI_V4_FREEZE_WRITTEN ${MANIFEST_PATH}`);
  process.exit(0);
}
if (isMain) {
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"));
  const diverged = RSI_V4_FREEZE_FILES.filter((file) => current.files?.[file]?.sha256 !== result.files[file].sha256);
  if (diverged.length) {
    console.error(`RSI_V4_FREEZE_DIVERGED ${diverged.join(",")}`);
    process.exit(1);
  }
  console.log("RSI_V4_FREEZE_OK");
}
