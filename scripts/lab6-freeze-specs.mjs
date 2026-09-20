/**
 * LAB 6 — FREEZE dos StrategySpecs (pre-T0). Escreve specs + hash em estrategias/lab-6/<run-id>/strategy-specs/.
 * Uso: node scripts/lab6-freeze-specs.mjs [runId]
 */
import fs from "node:fs";
import path from "node:path";
import { LAB_STRATEGY_SPECS, LAB_STAKE_POLICY, LAB_EXPIRY_POLICY, LAB_SETTLEMENT_CAP, LAB_VERSION, labSpecsHash } from "../relay/lab/strategy-specs.mjs";

const runId = process.argv[2] ?? "lab6-20260920-practice";
const outDir = path.join("estrategias", "lab-6", runId, "strategy-specs");
fs.mkdirSync(outDir, { recursive: true });
const hash = labSpecsHash();
const payload = {
  schema: "lab6-strategy-specs-v1",
  version: LAB_VERSION,
  runId,
  frozenAtUtc: new Date().toISOString(),
  specsHash: hash,
  settlementCap: LAB_SETTLEMENT_CAP,
  stakePolicy: LAB_STAKE_POLICY,
  expiryPolicy: LAB_EXPIRY_POLICY,
  marketSnapshotSchema: "consensus-market-snapshot-v1 + lab-ext (ema/macd/stochastic/fib/atrNormalized)",
  noTuningRule: "Depois de T0: nenhum threshold/periodo/indicador/confirmacao/bloqueador/consensus/expiry/entry-timing pode mudar. Bug tecnico: registrar trades afetados e reavaliar amostra.",
  strategies: LAB_STRATEGY_SPECS,
};
fs.writeFileSync(path.join(outDir, "specs.json"), JSON.stringify(payload, null, 2));
fs.writeFileSync(path.join(outDir, "hash.txt"), hash + "\n");
console.log("LAB6_SPECS_FROZEN", JSON.stringify({ runId, specsHash: hash, strategies: LAB_STRATEGY_SPECS.map((s) => s.id), outDir }));
