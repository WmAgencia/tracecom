/**
 * Diag (read-only) — dump dos dados de producao para a auditoria G2.
 * Uso: railway run --service tracecom-live-relay --environment production -- node scripts/diag-g2-audit.mjs
 * Saida: audit-g2-data.json (raiz do repo). Nenhum segredo e impresso.
 */
import { Pool } from "pg";
import fs from "node:fs/promises";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const out = { at: new Date().toISOString(), brainGeneration: null, journal: [], executions: [], audit: [], legacy: {}, errors: [] };
try {
  const config = await pool.query("SELECT brain_generation FROM iq_runtime_config WHERE id=1");
  out.brainGeneration = config.rows[0]?.brain_generation ?? null;

  const journal = await pool.query("SELECT * FROM iq_trade_journal ORDER BY settlement_at ASC NULLS LAST");
  out.journal = journal.rows;

  const executions = await pool.query(
    `SELECT execution_id, decision_id, broker_order_id, symbol, active_id, direction, stake, currency, state, entry_price, broker_result, causal_result, settlement_mismatch, profit, meta, requested_at, acked_at, settled_at, expiration_at
     FROM iq_executions
     WHERE meta->>'strategySource' = 'PROFESSIONAL_BRAIN_G2' OR decision_id LIKE 'auto_%' OR decision_id LIKE 'diagnostic_%'
     ORDER BY requested_at ASC`);
  out.executions = executions.rows;

  const legacy = await pool.query(
    `SELECT count(*)::int AS legacy_executions FROM iq_executions WHERE NOT (meta->>'strategySource' = 'PROFESSIONAL_BRAIN_G2' OR decision_id LIKE 'auto_%' OR decision_id LIKE 'diagnostic_%')`);
  out.legacy = legacy.rows[0] ?? {};

  const audit = await pool.query(
    "SELECT correlation_id, market_key, stage, detail, created_at FROM iq_audit_trail WHERE stage NOT IN ('AGENTS') ORDER BY id DESC LIMIT 4000");
  out.audit = audit.rows.reverse();
} catch (error) {
  out.errors.push(String(error?.code ?? error?.message ?? error).slice(0, 200));
}
await fs.writeFile("audit-g2-data.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ ok: out.errors.length === 0, journal: out.journal.length, executions: out.executions.length, audit: out.audit.length, legacy: out.legacy, errors: out.errors }));
await pool.end();
