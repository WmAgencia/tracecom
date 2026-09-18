#!/usr/bin/env node
/**
 * shadow-lab-report.mjs — painel de pesquisa PROSPECTIVE SHADOW LAB (somente leitura).
 *
 * Le iq_shadow_observations + iq_trade_journal e monta o dashboard com as secoes separadas
 * BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE. Nunca escreve, nunca decide,
 * nunca mistura contrafactual com PnL do broker.
 *
 * Uso:
 *   NODE_PATH=<repo>/node_modules node scripts/shadow-lab-report.mjs [--json] [--limit 5000]
 *   (via Railway: npx --yes @railway/cli@latest run --service tracecom-live-relay --environment production -- node scripts/shadow-lab-report.mjs)
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildShadowLabDashboard, SHADOW_LAB_VERSION, PROSPECTIVE_CHECKPOINT_N } from "../relay/shadow-lab.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(SCRIPT_DIR, "..", "relay", "package.json"));
const pg = require("pg");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 5000 : 5000;

function rowToObservation(row) {
  return {
    id: row.observation_id, provenance: row.provenance, decisionSource: row.decision_source, marketKey: row.market_key,
    marketType: row.market_type, candidateId: row.candidate_id, tradeId: row.trade_id, executionId: row.execution_id,
    payout: row.payout, gateComparison: row.gate_comparison, counterfactual: row.counterfactual,
    degradation: row.degradation, h3Critic: row.h3_critic, h1Location: row.h1_location, h2Displacement: row.h2_displacement,
    currentExecution: row.current_execution, settlementBasis: row.settlement_basis,
    brokerResult: row.broker_result, brokerProfit: row.broker_profit,
    theoreticalResult: row.theoretical_result, theoreticalPnl: row.theoretical_pnl,
    createdAt: row.created_at ? Number(new Date(row.created_at)) : null,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const observations = (await client.query("SELECT * FROM iq_shadow_observations ORDER BY created_at DESC LIMIT $1", [limit])).rows.map(rowToObservation);
    const trades = (await client.query("SELECT trade_id, market_key, payout, stake, result, payload FROM iq_trade_journal WHERE result IN ('WIN','LOSS','DRAW') ORDER BY settlement_at DESC LIMIT $1", [limit])).rows.map((row) => ({
      tradeId: row.trade_id, marketKey: row.market_key, payout: row.payout, stake: row.stake, result: row.result,
      decisionSource: row.payload?.snapshot?.decisionSource ?? "HISTORICAL_UNKNOWN",
      pnl: row.result === "WIN" ? (Number(row.stake) || 0) * ((Number(row.payout) > 1 ? Number(row.payout) / 100 : Number(row.payout) || 0.85)) : row.result === "LOSS" ? -(Number(row.stake) || 0) : 0,
    }));
    const dashboard = buildShadowLabDashboard({ observations, executedTrades: trades });
    const report = { version: SHADOW_LAB_VERSION, checkpointN: PROSPECTIVE_CHECKPOINT_N, generatedAt: new Date().toISOString(), readonly: true, dashboard };
    if (asJson) { console.log(JSON.stringify(report, null, 1)); return; }
    const line = (arm, view) => {
      const summary = view.acceptedSummary ?? view;
      return `- ${arm}: N=${summary.decided ?? 0} (aceitos ${view.accepted ?? view.n ?? "?"}/${view.rejected !== undefined ? (view.accepted ?? 0) + view.rejected : view.n ?? "?"}) W/L/D=${summary.wins ?? 0}/${summary.losses ?? 0}/${summary.draws ?? 0} WR=${summary.wr ?? "—"} CI95=${summary.ci95 ? `[${summary.ci95.low},${summary.ci95.high}]` : "—"} exp=${summary.expectancyPerTrade ?? "—"} PnLnorm=${summary.normalizedPnl ?? "—"} payout=${summary.avgPayout ?? "—"} maxLossStreak=${summary.maxLossStreak ?? "—"}`;
    };
    console.log(`PROSPECTIVE SHADOW LAB ${SHADOW_LAB_VERSION} — ${report.generatedAt} (checkpoint N>=${PROSPECTIVE_CHECKPOINT_N}/braco)`);
    console.log(`Seções: BROKER_EXECUTED n=${dashboard.sections.BROKER_EXECUTED.summary.n} | COUNTERFACTUAL n=${dashboard.sections.COUNTERFACTUAL.observations} | HISTORICAL n=${dashboard.sections.HISTORICAL.observations} | PROSPECTIVE n=${dashboard.sections.PROSPECTIVE.settled}/${dashboard.sections.PROSPECTIVE.observations}`);
    console.log("");
    for (const [arm, view] of Object.entries(dashboard.arms)) console.log(line(arm, view));
    console.log("");
    console.log("Checkpoints:", JSON.stringify(dashboard.sampleSize.byArm));
    console.log("");
    console.log("NOTA: SHADOW ONLY — contrafactual NUNCA entra no PnL do broker; N pequeno nao e prova.");
  } finally { await client.end(); }
}

main().catch((error) => { console.error(JSON.stringify({ error: String(error?.message ?? error).slice(0, 300) })); process.exit(1); });
