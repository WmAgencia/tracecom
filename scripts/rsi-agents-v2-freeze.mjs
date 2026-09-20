/**
 * RSI AGENTS V2 FREEZE — hashes das skills V2, do runner V2 e do runtime.
 *
 * Uso:
 *   node scripts/rsi-agents-v2-freeze.mjs            # verifica (exit 1 se divergir)
 *   node scripts/rsi-agents-v2-freeze.mjs --write    # grava docs/research/data/rsi-agents-v2-freeze.json
 *
 * Prova: STRICT_V2/PULLBACK_V2 congeladas (noTuning), V1 intocada (referencia),
 * stakes/PRACTICE/REAL-locked e caminho unico de ordem.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/rsi-agents-v2-freeze.json";

export const RSI_V2_FREEZE_FILES = [
  "relay/rsi-skills-v2.mjs",
  "relay/rsi-agents-v2.mjs",
  "relay/rsi-agents-v2-live.mjs",
  "relay/iq-multi-runtime.mjs",
  "relay/rsi-v3-watch.mjs",
  "relay/rsi-reversal.mjs",
  "relay/rsi-variants.mjs",
  "relay/rsi-agents-5x5.mjs",
];

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

function build() {
  const files = {};
  for (const file of RSI_V2_FREEZE_FILES) files[file] = { sha256: sha256File(file), bytes: fs.statSync(path.join(ROOT, file)).size };
  return {
    schema: "rsi-agents-v2-freeze-v1",
    frozenAtUtc: new Date().toISOString(),
    sourceCommit: process.env.GIT_COMMIT ?? null,
    noTuning: true,
    strategies: { strict: "RSI_REVERSAL_STRICT_V2", pullback: "RSI_EXTREME_PULLBACK_V2" },
    policy: { practiceOnly: true, realLocked: true, stakeBrl: 10, split: "50/50 balanceado NORMAL/OTC", shadow: "skill nao atribuida nunca envia ordem", singleBrokerPath: "runtime.submitAgentV2Order -> requestOrder", autoInvert: false, sameExpiryRequired: true },
    v1Reference: { note: "V1 intocada; agentes V1 pausados na migracao", files: ["relay/rsi-reversal.mjs", "relay/rsi-variants.mjs", "relay/rsi-agents-5x5.mjs"] },
    files,
  };
}

const result = build();
const write = process.argv.includes("--write");
if (write) {
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`RSI_AGENTS_V2_FREEZE_WRITTEN ${MANIFEST_PATH}`);
  process.exit(0);
}
const current = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"));
const diverged = RSI_V2_FREEZE_FILES.filter((file) => current.files?.[file]?.sha256 !== result.files[file].sha256);
if (diverged.length) {
  console.error(`RSI_AGENTS_V2_FREEZE_DIVERGED ${diverged.join(",")}`);
  process.exit(1);
}
console.log("RSI_AGENTS_V2_FREEZE_OK");
