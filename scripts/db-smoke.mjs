import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("D:/tracecom/repo/relay/");
const pg = require("pg");
const env = fs.existsSync("D:/tracecom/repo/.env") ? fs.readFileSync("D:/tracecom/repo/.env", "utf8") : "";
const m = (process.env.DB_URL ?? "").trim() || (env.match(/^DATABASE_URL=(.+)$/m)?.[1] ?? "").trim();
const url = m ? m.replace(/^["']|["']$/g, "") : null;
if (!url) { console.log("DB_SMOKE=NO_DATABASE_URL"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  const a = await pool.query("SELECT 1 AS ok");
  const b = await pool.query("SELECT pg_database_size(current_database()) AS bytes");
  const c = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
  const d = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('trades','executions','decisions')");
  console.log(`DB_SMOKE=OK select1=${a.rows[0].ok === 1} mb=${Math.round(Number(b.rows[0].bytes) / 1048576)} tabelas=${c.rows[0].n} core=${d.rows[0].n}`);
} catch (error) {
  console.log("DB_SMOKE=FAIL " + String(error?.message ?? error).slice(0, 160));
  process.exit(1);
} finally {
  await pool.end();
}
