/**
 * COUNTERFACTUAL V4(31) -> V2 ORIGINAL — diagnostico (SEM otimizar; outcome apenas depois).
 * Para cada trade V4: usa o snapshot causal gravado (entrySnapshot/indicators) e pergunta a V2
 * ORIGINAL (rsi-skills-v2, congelada ) se ela entraria. A V2 NAO e alterada para isso.
 * Gera docs/research/data/v4-23-vs-v2-counterfactual.json + .md (nome historico do pedido).
 * Uso: node scripts/v4-vs-v2-counterfactual.mjs --conn=...
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
// @ts-expect-error - relay ESM sem tipagem
const skillsV2 = await import("../relay/rsi-skills-v2.mjs");

const arg = (name, fallback = null) => { const found = process.argv.find((i) => i.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() { try { return (await import("pg")).default; } catch { return createRequire(path.join(process.cwd(), "relay", "package.json"))("pg"); } }
const conn = arg("conn") ?? process.env.DATABASE_URL;
if (!conn) { console.error("informe --conn="); process.exit(2); }
const pg = await loadPg();
const pool = new pg.Pool({ connectionString: conn, max: 2, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });
const { STRICT_V2_ID, PULLBACK_V2_ID, evaluateV2 } = skillsV2;

const execs = (await pool.query("SELECT extract(epoch from requested_at)*1000 AS req_ms, market_key, direction, broker_result, profit, meta->>'source' AS source FROM iq_executions WHERE meta->>'source' LIKE 'agent-v4:%' ORDER BY requested_at ASC")).rows ?? [];
const ops = (await pool.query("SELECT market_key, candidate_at, candidate_rsi, candidate_price, indicators, payload FROM iq_rsi_opportunities_v4 WHERE order_id IS NOT NULL ORDER BY submit_at ASC")).rows ?? [];
const findOp = (exec) => ops.find((o) => o.market_key === exec.market_key && o.candidate_at !== null && Number(exec.req_ms) - Number(o.candidate_at) < 300_000) ?? null;

const totals = { total: execs.length, ENTER: 0, BLOCK: 0, WAIT: 0, NO_CANDIDATE: 0, INSUFFICIENT_DATA: 0, DIFFERENT_TIMING: 0 };
const trades = [];
for (const exec of execs) {
  const direction = exec.direction === "BUY" || exec.direction === "CALL" ? "BUY" : "SELL";
  const op = findOp(exec);
  const indicators = op?.indicators && Object.keys(op.indicators).length ? op.indicators : (op?.payload?.entrySnapshot?.indicators ?? null);
  let v2 = { decision: "INSUFFICIENT_DATA", status: null, reason: "SEM_SNAPSHOT_CAUSAL" };
  if (indicators) {
    const skill = direction === "BUY" ? STRICT_V2_ID : (Number(op?.candidate_rsi) >= 70 ? PULLBACK_V2_ID : STRICT_V2_ID);
    const episode = { direction, candidateAt: Number(op.candidate_at), candidateRsi: Number(op.candidate_rsi ?? NaN), candidatePrice: Number(op.candidate_price ?? NaN), touchedLower: direction === "BUY", touchedUpper: direction === "SELL", minPrice: Number(op.candidate_price ?? NaN), maxPrice: Number(op.candidate_price ?? NaN) };
    try {
      const result = evaluateV2({ strategy: skill, indicators, episode });
      v2 = { decision: result?.accepted ? result.decision : "WAIT", status: result?.status ?? null, reason: result?.reason ?? null, skill };
    } catch (error) { v2 = { decision: "INSUFFICIENT_DATA", status: null, reason: `V2_ERROR:${String(error?.message ?? error).slice(0, 80)}` }; }
  }
  const classification = v2.decision === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : (v2.decision === direction ? "ENTER" : (v2.reason === "NO_CANDIDATE" || v2.status === "NO_CANDIDATE" ? "NO_CANDIDATE" : "BLOCK"));
  totals[classification] += 1;
  trades.push({ market: exec.market_key, direction, v4Decision: "ENTER", v4Outcome: exec.broker_result, v4Profit: exec.profit == null ? null : Number(exec.profit), v2Decision: v2.decision, v2Status: v2.status, v2Reason: v2.reason, v2Skill: v2.skill ?? null, classification, candidateToEntryMs: op?.candidate_at ? Number(exec.req_ms) - Number(op.candidate_at) : null });
}
const report = { schema: "v4-vs-v2-counterfactual-v1", at: new Date().toISOString(), decisionUsesOutcome: false, note: "Diagnostico. V2 congelada; nenhum threshold alterado; outcome apenas apos a classificacao.", totals, trades };
fs.writeFileSync("docs/research/data/v4-23-vs-v2-counterfactual.json", `${JSON.stringify(report, null, 2)}\n`);
const lines = ["# Counterfactual V4 -> V2 ORIGINAL", "", `- trades V4: ${totals.total} | ENTER: ${totals.ENTER} | BLOCK: ${totals.BLOCK} | NO_CANDIDATE: ${totals.NO_CANDIDATE} | INSUFFICIENT_DATA: ${totals.INSUFFICIENT_DATA}`, "- V2 congelada (rsi-skills-v2); sem grid search; outcome nao usado na decisao.", "", "| ativo | dir | V4 | V2 | status | outcome V4 |", "|---|---|---|---|---|---|", ...trades.map((t) => `| ${t.market} | ${t.direction} | ENTER | ${t.v2Decision} | ${t.v2Status ?? t.v2Reason ?? "-"} | ${t.v4Outcome ?? "-"} |`)];
fs.writeFileSync("docs/research/data/v4-23-vs-v2-counterfactual.md", `${lines.join("\n")}\n`);
console.log("totals", JSON.stringify(totals));
for (const t of trades) console.log(`${t.classification.padEnd(16)} ${t.market.padEnd(12)} ${t.direction.padEnd(4)} v2=${t.v2Decision} status=${t.v2Status ?? t.v2Reason ?? "-"} v4outcome=${t.v4Outcome}`);
await pool.end();
