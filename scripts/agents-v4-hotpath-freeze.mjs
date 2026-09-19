/**
 * AGENTS V4 HOTPATH FREEZE — recalcula sha256 do hot path e cruza com o freeze do V3.
 *
 * Uso:
 *   node scripts/agents-v4-hotpath-freeze.mjs            # verifica (exit 1 se divergir)
 *   node scripts/agents-v4-hotpath-freeze.mjs --write    # grava docs/research/data/agents-v4-hotpath-freeze.json
 *
 * O manifesto prova que a rodada V4 (SHADOW) nao alterou G2/Quality Gate/JIT/Execution Gate/stake.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/agents-v4-hotpath-freeze.json";
const V3_MANIFEST_PATH = "docs/research/data/scenario-engine-freeze.json";

export const HOTPATH_FILES = [
  "relay/professional-brain.mjs",
  "relay/price-structure.mjs",
  "relay/feature-engine.mjs",
  "relay/trade-quality.mjs",
  "relay/entry-timing.mjs",
  "relay/portfolio-gate.mjs",
  "relay/iqoption-connector.mjs",
  "relay/real-mode.mjs",
  "relay/account-context.mjs",
  "relay/scenario-engine.mjs",
  "relay/scenario-shadow.mjs",
  "relay/scenario-timing-intersection.mjs",
  "relay/iq-multi-runtime.mjs",
];

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

function build() {
  const files = {};
  for (const file of HOTPATH_FILES) files[file] = { sha256: sha256File(file), bytes: fs.statSync(path.join(ROOT, file)).size };
  const v3 = JSON.parse(fs.readFileSync(path.join(ROOT, V3_MANIFEST_PATH), "utf8"));
  const crossCheck = {};
  for (const [file, entry] of Object.entries(v3.files ?? {})) {
    if (!files[file]) continue;
    crossCheck[file] = { v3Sha256: entry.sha256, matchesV3Freeze: files[file].sha256 === entry.sha256 };
  }
  return {
    schema: "agents-v4-hotpath-freeze-v1",
    frozenAtUtc: new Date().toISOString(),
    sourceCommit: process.env.GIT_COMMIT ?? null,
    note: "SHADOW V4 nao altera G2/Quality Gate/JIT/Execution Gate/stake. iq-multi-runtime recebeu apenas hooks observacionais (V4/DataHub) com provas de comportamento nos testes; os demais arquivos sao byte a byte identicos ao estado pre-V4.",
    v3CrossCheck: crossCheck,
    files,
  };
}

const result = build();
const write = process.argv.includes("--write");
if (write) {
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`AGENTS_V4_HOTPATH_FREEZE_WRITTEN ${MANIFEST_PATH}`);
} else {
  if (!fs.existsSync(path.join(ROOT, MANIFEST_PATH))) {
    console.error(`AGENTS_V4_HOTPATH_FREEZE_MISSING ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"));
  let failures = 0;
  for (const file of HOTPATH_FILES) {
    const current = sha256File(file);
    if (manifest.files?.[file]?.sha256 !== current) {
      failures += 1;
      console.error(`AGENTS_V4_HOTPATH_DIVERGED ${file}`);
    }
  }
  for (const [file, check] of Object.entries(manifest.v3CrossCheck ?? {})) {
    if (check.matchesV3Freeze !== true) {
      failures += 1;
      console.error(`AGENTS_V4_V3_FREEZE_DIVERGED ${file}`);
    }
  }
  if (failures) process.exit(1);
  console.log(`AGENTS_V4_HOTPATH_FREEZE_OK files=${HOTPATH_FILES.length}`);
}
