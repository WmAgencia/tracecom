/**
 * Counterfactual V3 -> V4 (SEM usar outcome para decidir).
 *
 * Para cada trade V3 executado: reconstroi o snapshot no momento da entrada a partir do banco,
 * roda a decisao V4 (current-state) e classifica:
 *   SAME_ENTRY | V4_BLOCKED | V4_DIFFERENT_TIMING | INSUFFICIENT_DATA
 * O resultado do broker (WIN/LOSS) so aparece depois, apenas para auditoria.
 *
 * Uso: node scripts/rsi-v4-counterfactual.mjs [--conn=postgres://...] [--write]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../relay/rsi-v4.mjs");

const arg = (name, fallback = null) => { const found = process.argv.find((item) => item.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() {
  try { return (await import("pg")).default; } catch {
    const relayRequire = createRequire(path.join(process.cwd(), "relay", "package.json"));
    return relayRequire("pg");
  }
}

async function main() {
  const conn = arg("conn") ?? process.env.DATABASE_URL;
  if (!conn) { console.error("informe --conn= ou DATABASE_URL"); process.exit(2); }
  const write = process.argv.includes("--write");
  const pg = await loadPg();
  const pool = new pg.Pool({ connectionString: conn, max: 2, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });
const out = { schema: "rsi-v4-counterfactual-v1", at: new Date().toISOString(), decisionUsesOutcome: false, totals: {}, trades: [] };
try {
  const rows = (await pool.query(`
    SELECT e.requested_at, extract(epoch from e.requested_at)*1000 AS req_ms, e.market_key, e.direction, e.broker_result, e.profit,
           o.opportunity_id, o.candidate_at, o.candidate_rsi, o.candidate_price, o.entry_mode, o.rsi, o.short_horizon_direction,
           o.indicators, o.dmi, o.adx, o.bollinger, o.entry_price, o.entry_noise, o.payload
    FROM iq_executions e
    LEFT JOIN LATERAL (
      SELECT * FROM iq_rsi_opportunities_v3 o
      WHERE o.market_key = e.market_key AND o.submit_at IS NOT NULL
        AND ABS(o.submit_at::numeric - extract(epoch from e.requested_at)*1000) < 15000
      ORDER BY ABS(o.submit_at::numeric - extract(epoch from e.requested_at)*1000) ASC LIMIT 1
    ) o ON true
    WHERE e.meta->>'source' LIKE 'agent-v3:%'
    ORDER BY e.requested_at ASC`)).rows ?? [];
  const totals = { total: rows.length, SAME_ENTRY: 0, V4_BLOCKED: 0, V4_DIFFERENT_TIMING: 0, INSUFFICIENT_DATA: 0 };
  for (const row of rows) {
    const direction = row.direction === "BUY" || row.direction === "CALL" ? "BUY" : "SELL";
    const indicators = row.indicators && typeof row.indicators === "object" && Object.keys(row.indicators).length ? { ...row.indicators } : null;
    let classification = "INSUFFICIENT_DATA";
    let decision = null;
    if (indicators) {
      const bollinger = indicators.bollinger ?? row.bollinger ?? null;
      const position = Number(bollinger?.position);
      const candidateRsi = Number(row.candidate_rsi ?? NaN);
      const candidateExtreme = Number.isFinite(candidateRsi) && (direction === "BUY" ? candidateRsi <= 30 : candidateRsi >= 70);
      // A V3 nao persiste o snapshot de nascimento; o candidate nasceu em extremo (RSI), logo o toque
      // na banda no nascimento e assumido pelo proprio detector. Marcamos a suposicao explicitamente.
      const touchedLower = direction === "BUY" && (candidateExtreme || bollinger?.touchLower === true || bollinger?.outsideLower === true || position <= 0.1);
      const touchedUpper = direction === "SELL" && (candidateExtreme || bollinger?.touchUpper === true || bollinger?.outsideUpper === true || position >= 0.9);
      const episode = { direction, candidateAt: Number(row.candidate_at ?? row.req_ms), candidateRsi, candidatePrice: Number(row.candidate_price ?? NaN), touchedLower, touchedUpper, minPrice: Number(row.candidate_price ?? indicators?.bollinger?.close ?? NaN), maxPrice: Number(row.candidate_price ?? indicators?.bollinger?.close ?? NaN) };
      decision = v4.evaluateV4Decision({ indicators, episode });
      if (decision.accepted) classification = row.entry_mode === "NORMAL_T5" || row.entry_mode == null ? "SAME_ENTRY" : "V4_DIFFERENT_TIMING";
      else classification = "V4_BLOCKED";
    }
    totals[classification] += 1;
    out.trades.push({
      market: row.market_key, direction, v3EntryMode: row.entry_mode ?? null, v3Outcome: row.broker_result, v3Profit: row.profit == null ? null : Number(row.profit),
      v3Decision: "ENTER", v4Decision: decision ? (decision.accepted ? decision.direction : "WAIT") : "INSUFFICIENT_DATA",
      classification,
      v4Reason: decision?.reason ?? "NO_INDICATORS_SNAPSHOT",
      v4HardBlocks: decision ? decision.counterEvidence.filter((item) => item.severity === "HARD").map((item) => item.code) : [],
      v4SoftBlocks: decision ? decision.counterEvidence.filter((item) => item.severity === "SOFT").map((item) => item.code) : [],
      cushionClass: decision?.cushion?.class ?? null,
      candidateToEntryMs: row.candidate_at ? Number(row.req_ms) - Number(row.candidate_at) : null,
    });
  }
  out.totals = totals;
  console.log("totals:", JSON.stringify(totals));
  for (const trade of out.trades) console.log(`${trade.classification.padEnd(19)} ${trade.market.padEnd(12)} ${trade.direction.padEnd(4)} v3=${trade.v3Outcome ?? "-"} v4=${trade.v4Decision} reason=${trade.v4Reason} hard=${trade.v4HardBlocks.join("+") || "-"}`);
  if (write) { fs.writeFileSync("docs/research/data/rsi-v4-counterfactual.json", `${JSON.stringify(out, null, 2)}\n`); console.log("COUNTERFACTUAL_WRITTEN docs/research/data/rsi-v4-counterfactual.json"); }
} catch (error) {
  console.error("COUNTERFACTUAL_FAIL", String(error?.message ?? error));
  process.exitCode = 1;
} finally { await pool.end(); }
}

const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main().catch((error) => { console.error("COUNTERFACTUAL_FAIL", String(error?.message ?? error)); process.exitCode = 1; });

