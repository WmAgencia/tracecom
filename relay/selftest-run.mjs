/** selftest-run.mjs — prova de runtime real: usa DATABASE_URL de producao (railway run) para
 * executar runTextProvider com a key ja persistida. NUNCA imprime a key. */
import pg from "pg";
import { runTextProvider } from "./opencode-go.mjs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await runTextProvider(pool, { prompt: 'Responda SOMENTE com JSON: {"status":"ok","probe":"tracecom"}', maxTokens: 64, requestId: "prod-selftest" });
  console.log(JSON.stringify({ status: result.status, model: result.model, latencyMs: result.latencyMs, requestId: result.requestId, sessionId: result.sessionId, parsed: result.parsed, reason: result.reason }));
} finally { await pool.end(); }
