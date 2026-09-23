import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { computeStrategyHash, strategyPolicy, DECISION_FILES, MANIFEST_PATH, BASELINE_DIR } from "./stage3-strategy-hash.mjs";
import { loadOperationalStrategy } from "../relay/execution/operational-strategy.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const sha256 = (value) => crypto.createHash("sha256").update(String(value).replace(/\r\n/g, "\n")).digest("hex");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const computed = computeStrategyHash({ manifest });
const again = computeStrategyHash({ manifest });

ok("hash da V2 e deterministico (2 computos identicos)", computed.strategyHash === again.strategyHash && computed.strategyHash.startsWith("sha256:"));
ok("manifesto registra exatamente o hash computado do codigo atual", manifest.strategyHash === computed.strategyHash && manifest.newStrategyHash === computed.strategyHash);
ok("status e executable coerentes (ACTIVE => true; pre-ativacao => false)", ["READY_FOR_DEPLOY", "ACTIVE"].includes(manifest.status) && (manifest.status === "ACTIVE" ? manifest.executable === true : manifest.executable === false));
ok("stats da V2 separados e zerados (N/W/L/D/PnL=0)", manifest.stats.operations === 0 && manifest.stats.wins === 0 && manifest.stats.losses === 0 && manifest.stats.draws === 0 && manifest.stats.winRate === null && manifest.statsEpoch === "2026-09-22T21:53:19.302Z");
ok("manifesto cobre 300s/5s/3h/readiness policy/specialists/consensus", manifest.operationalExpirySeconds === 300 && manifest.operationalCandleIntervalMs === 5000 && manifest.maxContextAgeMs === 10_800_000 && manifest.readinessPolicy?.gapRatioMax === 0.02 && manifest.specialists?.order?.length === 5 && manifest.consensusVersion === "consensus-v1" && manifest.decisionSnapshotVersion === "decision-snapshot-v1");
ok("manifesto referencia parent/baseline e sourceCommit do codigo", manifest.parent === "PULLBACK_4060_300_BASELINE" && manifest.parentStrategyHash === "sha256:26dceb743b3f0d88a6bea10bf8646deb836236e3a7de91702bd323289438b3dd" && typeof manifest.sourceCommit === "string" && manifest.sourceCommit.length >= 7);
ok("manifesto nao tem campo de confidence/percentual de certeza", !Object.keys(manifest).some((k) => /confidence|certeza/i.test(k)) && manifest.stats.winRate === null);

const baselineSpec = JSON.parse(fs.readFileSync(`${BASELINE_DIR}/spec.json`, "utf8"));
const baselineFile = `sha256:${sha256(fs.readFileSync(`${BASELINE_DIR}/custom-strategies.mjs`, "utf8"))}`;
ok("baseline congelada intacta (hash do arquivo == parentStrategyHash)", baselineFile === manifest.parentStrategyHash && baselineSpec.strategyHash === manifest.parentStrategyHash);

ok("hash cobre somente semantica de decisao (sem frontend/CSS/deploy/logs)", DECISION_FILES.length === 7 && DECISION_FILES.every((f) => f.startsWith("relay/intelligence/") || f === "relay/execution/binary300.mjs") && !DECISION_FILES.some((f) => /public|http|dist|css|deploy|log/i.test(f)));
ok("hash e sensivel a mudanca de policy (300s e gap policy)", computeStrategyHash({ overrides: { operationalExpirySeconds: 60 } }).strategyHash !== computed.strategyHash && computeStrategyHash({ overrides: { gapRatioMax: 0.5 } }).strategyHash !== computed.strategyHash);
ok("policy do hash reflete as constantes reais (300/5000/3h)", strategyPolicy().operationalExpirySeconds === 300 && strategyPolicy().operationalCandleIntervalMs === 5000 && strategyPolicy().maxContextAgeMs === 10_800_000);
if (manifest.frozen === true) {
  ok("freeze coerente: frozenAt presente e decisionFiles == hash atual do codigo", typeof manifest.frozenAt === "string" && manifest.frozenAt.length > 0 && JSON.stringify(manifest.decisionFiles) === JSON.stringify(computed.files) && manifest.status === "ACTIVE");
}

const strategy = loadOperationalStrategy();
ok("loader do runtime le o manifesto com hash definido e executavel coerente", ["READY_FOR_DEPLOY", "ACTIVE"].includes(strategy.status) && (strategy.status === "ACTIVE" ? strategy.executable === true : strategy.executable === false) && strategy.strategyHash === manifest.strategyHash && strategy.version === "PULLBACK_4060_300_AGENTIC_V2");

{
  const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracecom-manifest-"));
  fs.mkdirSync(path.join(deployRoot, "estrategias", "strategy-versions"), { recursive: true });
  fs.copyFileSync(MANIFEST_PATH, path.join(deployRoot, "estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V2.json"));
  const nested = loadOperationalStrategy({ rootDir: deployRoot });
  const flatRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracecom-manifest-flat-"));
  fs.copyFileSync(MANIFEST_PATH, path.join(flatRoot, "PULLBACK_4060_300_AGENTIC_V2.json"));
  const flat = loadOperationalStrategy({ rootDir: flatRoot });
  ok("loader encontra o manifesto no layout de deploy (nested e flat)", ["READY_FOR_DEPLOY", "ACTIVE"].includes(nested.status) && nested.strategyHash === manifest.strategyHash && ["READY_FOR_DEPLOY", "ACTIVE"].includes(flat.status) && flat.strategyHash === manifest.strategyHash);
  fs.rmSync(deployRoot, { recursive: true, force: true });
  fs.rmSync(flatRoot, { recursive: true, force: true });
}

console.log(fail === 0 ? `STRATEGY_HASH_TESTS ALL_PASS (${pass}/${pass})` : `STRATEGY_HASH_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
