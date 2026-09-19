/**
 * scenario-shadow-settle (TASK 3, fase 29) — liquidacao OBSERVACIONAL do backlog prospectivo.
 *
 * Liga o que ja esta liquidado causalmente pelo Prospective Shadow Lab (029) a observacao de cenario
 * (031/032) do MESMO candidato, para completar a cadeia:
 *   observacao prospectiva -> target expiry -> preco no expiry -> WIN/LOSS/DRAW.
 *
 * Invariantes:
 *   - NUNCA marca BROKER_EXECUTED (o settlement do broker continua exclusivo do runtime);
 *   - sempre CAUSAL_COUNTERFACTUAL + provenance PROSPECTIVE_SHADOW no outcome;
 *   - outcome pos-classificacao (nunca realimenta T0/classification);
 *   - idempotente (UPDATE ... WHERE outcome IS NULL);
 *   - default = DRY RUN; use --apply para escrever;
 *   - nada de estrategia, stake, direcao, ordem ou V3.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/scenario-shadow-settle.mjs            # dry-run
 *   DATABASE_URL=... node scripts/scenario-shadow-settle.mjs --apply    # grava
 *   DATABASE_URL=... node scripts/scenario-shadow-settle.mjs --json out.json
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const { Pool } = pg;
const flag = (name) => process.argv.includes(name);
function arg(name, fallback = null) {
  const hit = process.argv.find((item) => item === name || item.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit.startsWith(`${name}=`)) return hit.slice(name.length + 1);
  return process.argv[process.argv.indexOf(hit) + 1] ?? fallback;
}
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export function buildOutcome({ result, entryPrice, expiryPrice, payout, atMs }) {
  const fraction = num(payout) > 1 ? num(payout) / 100 : (num(payout) || 0.85);
  const normalizedPnl = result === "WIN" ? Number(fraction.toFixed(4)) : result === "LOSS" ? -1 : 0;
  return {
    result,
    profit: null,
    stake: null,
    payout: num(payout),
    normalizedPnl,
    entryPrice: num(entryPrice),
    expiryPrice: num(expiryPrice),
    settlementPrice: num(expiryPrice),
    settlementBasis: "CAUSAL_COUNTERFACTUAL",
    provenance: "PROSPECTIVE_SHADOW",
    at: atMs,
    outcomeUsedInClassification: false,
    feedableToClassification: false,
    postWindowDiagnosticOnly: true,
    note: "OUTCOME causal pos-classificacao (backfill contrafactual do shadow lab); nunca broker.",
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error(JSON.stringify({ error: "DATABASE_URL missing" })); process.exit(2); }
  const apply = flag("--apply");
  const outPath = arg("--json", null);
  const pool = new Pool({ connectionString: databaseUrl, ssl: /sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined });
  const report = {
    schema: "scenario-shadow-settle-v1",
    generatedAt: new Date().toISOString(),
    mode: apply ? "APPLY" : "DRY_RUN",
    settlementBasis: "CAUSAL_COUNTERFACTUAL",
    neverBroker: true,
    candidates: 0, settledWins: 0, settledLosses: 0, settledDraws: 0, updated: 0, skipped: 0,
    errors: [], warnings: [],
  };
  try {
    const rows = (await pool.query(
      `SELECT o.observation_id, o.direction, o.payout, o.target_entry_at, o.target_expiry_at,
              s.h2_displacement, s.settlement_price, s.theoretical_result, s.theoretical_pnl, s.updated_at
         FROM iq_scenario_shadow_observations o
         JOIN iq_shadow_observations s ON s.candidate_id = o.candidate_id
        WHERE (o.outcome IS NULL OR o.outcome = 'null'::jsonb)
          AND s.settlement_basis = 'CAUSAL_COUNTERFACTUAL'
          AND s.theoretical_result IN ('WIN','LOSS','DRAW')
        ORDER BY o.created_at`,
    )).rows;
    report.candidates = rows.length;
    for (const row of rows) {
      try {
        const h2 = row.h2_displacement ?? {};
        const entryPrice = num(h2.actualEntryPrice) ?? num(h2.jitPrice) ?? null;
        const expiryPrice = num(row.settlement_price);
        const result = row.theoretical_result;
        if ((entryPrice === null || expiryPrice === null) && !["WIN", "LOSS", "DRAW"].includes(result)) { report.skipped += 1; continue; }
        const outcome = buildOutcome({ result, entryPrice, expiryPrice, payout: row.payout, atMs: row.updated_at ? new Date(row.updated_at).getTime() : Date.now() });
        if (result === "WIN") report.settledWins += 1;
        else if (result === "LOSS") report.settledLosses += 1;
        else report.settledDraws += 1;
        if (apply) {
          await pool.query(
            `UPDATE iq_scenario_shadow_observations
                SET outcome=$2::jsonb, settlement_basis='CAUSAL_COUNTERFACTUAL', theoretical_result=$3, theoretical_pnl=$4, updated_at=now()
              WHERE observation_id=$1 AND (outcome IS NULL OR outcome = 'null'::jsonb) AND settlement_basis IS NULL`,
            [row.observation_id, JSON.stringify(outcome), result, row.theoretical_pnl ?? outcome.normalizedPnl],
          );
          report.updated += 1;
        }
      } catch (error) {
        report.errors.push(`${row.observation_id}: ${String(error?.message ?? error).slice(0, 160)}`);
      }
    }
    const coverage = (await pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE outcome IS NULL OR outcome = 'null'::jsonb)::int pending,
              count(*) FILTER (WHERE settlement_basis='CAUSAL_COUNTERFACTUAL')::int counterfactual,
              count(*) FILTER (WHERE settlement_basis='BROKER_EXECUTED')::int broker
         FROM iq_scenario_shadow_observations`,
    )).rows[0];
    report.coverage = coverage;
    report.warnings.push("Observacoes sem shadow-lab linkado e sem snapshot de candles persistido nao sao settlementaveis retroativamente; a coleta segue pelo runtime (settleCausal no pipeline de candles).");
  } catch (error) {
    report.errors.push(String(error?.message ?? error));
  } finally {
    await pool.end().catch(() => {});
  }
  const text = JSON.stringify(report, null, 2);
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log(JSON.stringify({ ok: report.errors.length === 0, out: outPath, ...report }));
  } else {
    console.log(text);
  }
}

main().catch((error) => { console.error(JSON.stringify({ fatal: String(error?.message ?? error) })); process.exit(1); });
