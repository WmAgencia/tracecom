/**
 * Aguarda as 20 primeiras operacoes V2-live fecharem (settlement real) e entao gera o relatorio
 * completo (trade-XXX.json + summary.json + report.md) e imprime o resultado.
 * Uso: node scripts/v2-live-wait20.mjs --conn=... [--limit=20] [--timeout-min=80] [--poll-s=60]
 */
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const arg = (name, fallback = null) => { const found = process.argv.find((i) => i.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() {
  try { return (await import("pg")).default; } catch {
    const { createRequire: cr } = await import("node:module");
    return cr(new URL("../relay/package.json", import.meta.url))("pg");
  }
}
const conn = arg("conn") ?? process.env.DATABASE_URL;
if (!conn) { console.error("informe --conn="); process.exit(2); }
const limit = Math.max(1, Math.min(20, Number(arg("limit")) || 20));
const timeoutMin = Math.max(5, Number(arg("timeout-min")) || 80);
const pollS = Math.max(20, Number(arg("poll-s")) || 60);
const pg = await loadPg();
const pool = new pg.Pool({ connectionString: conn, max: 1, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });

const COUNT_SQL = `
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE e.broker_result IS NOT NULL)::int AS settled
  FROM iq_executions e
  WHERE e.meta->>'source' LIKE 'agent-v2:%'
    AND EXISTS (SELECT 1 FROM iq_rsi_opportunities_v2live o WHERE o.market_key = e.market_key AND o.submit_at IS NOT NULL
                AND ABS(o.submit_at::numeric - extract(epoch from e.requested_at)*1000) < 20000)`;

const startedAt = Date.now();
let last = null;
try {
  for (;;) {
    const row = (await pool.query(COUNT_SQL)).rows?.[0] ?? { total: 0, settled: 0 };
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (row.total !== last) { console.log(`[wait20] ${new Date().toISOString()} total=${row.total} settled=${row.settled} (${elapsed}s)`); last = row.total; }
    if (row.total >= limit && row.settled >= limit) break;
    if (elapsed > timeoutMin * 60) {
      console.log(`[wait20] TIMEOUT ${timeoutMin}min — total=${row.total} settled=${row.settled} (sem 20 fechadas ainda)`);
      process.exitCode = 2;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollS * 1000));
  }
  if (process.exitCode !== 2) {
    console.log(`[wait20] 20 fechadas — gerando relatorio completo...`);
    execFileSync(process.execPath, ["scripts/v2-live-trades-report.mjs", `--conn=${conn}`, `--limit=${limit}`], { stdio: "inherit" });
  }
} catch (error) {
  console.error("[wait20] FAIL", String(error?.message ?? error));
  process.exitCode = 1;
} finally { await pool.end(); }
