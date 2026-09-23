/**
 * restore-config — reaplica um backup gerado por scripts/backup-config.mjs.
 *
 * Uso:
 *   node scripts/restore-config.mjs <zip|config.json>            # dry-run (mostra o que mudaria)
 *   node scripts/restore-config.mjs <zip|config.json> --apply    # aplica (upsert das tabelas)
 *   node scripts/restore-config.mjs <zip> --apply --with-runs    # inclui iq_lab_runs/state
 *
 * NUNCA restaura segredos (nao existem no backup).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");

const input = process.argv[2];
if (!input) { console.error("uso: node scripts/restore-config.mjs <zip|config.json> [--apply] [--with-runs]"); process.exit(2); }
const apply = process.argv.includes("--apply");
const withRuns = process.argv.includes("--with-runs");

let configPath = path.resolve(input);
if (configPath.toLowerCase().endsWith(".zip")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-config-"));
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${configPath}' -DestinationPath '${tmp}' -Force`], { stdio: "ignore" });
  } catch {
    execFileSync("tar", ["-x", "-f", configPath, "-C", tmp], { stdio: "ignore" });
  }
  configPath = path.join(tmp, "config.json");
}

const backup = JSON.parse(fs.readFileSync(configPath, "utf8"));
const t = backup.tables ?? {};

const upsert = async (pool, table, row, keyColumn = "id") => {
  const cols = Object.keys(row);
  const values = cols.map((c) => row[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const updates = cols.filter((c) => c !== keyColumn).map((c) => `${c}=EXCLUDED.${c}`).join(",");
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders}) ON CONFLICT (${keyColumn}) DO UPDATE SET ${updates}`;
  if (!apply) { console.log(`  [dry-run] ${table}: upsert ${cols.length} colunas`); return; }
  await pool.query(sql, values);
  console.log(`  ${table}: aplicado`);
};

const RESTORE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
if (!RESTORE_DB_URL) { console.error("RESTORE_CONFIG_FAILED: defina SUPABASE_DB_URL (nenhuma credencial hardcoded)"); process.exit(1); }
const pool = new pg.Pool({
  connectionString: RESTORE_DB_URL,
  max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000,
});

console.log(`RESTORE ${apply ? "APLICANDO" : "DRY-RUN"} — backup de ${backup.at} (commit ${backup.git?.commit ?? "?"})`);
if (t.iq_runtime_config) await upsert(pool, "iq_runtime_config", t.iq_runtime_config);
if (t.iq_agent_config) await upsert(pool, "iq_agent_config", t.iq_agent_config);
if (t.iq_perf_epoch) await upsert(pool, "iq_perf_epoch", t.iq_perf_epoch);
if (withRuns && Array.isArray(t.iq_lab_runs)) {
  for (const run of t.iq_lab_runs) await upsert(pool, "iq_lab_runs", run, "run_id");
}
if (withRuns && Array.isArray(t.iq_lab_strategy_state)) {
  for (const state of t.iq_lab_strategy_state) {
    const cols = ["run_id", "strategy_id"];
    const others = Object.keys(state).filter((c) => !cols.includes(c));
    const values = [state.run_id, state.strategy_id, ...others.map((c) => state[c])];
    const updates = others.map((c, i) => `${c}=$${i + 3}`).join(",");
    const sql = `INSERT INTO iq_lab_strategy_state (run_id, strategy_id, ${others.join(",")}) VALUES ($1,$2,${others.map((_, i) => `$${i + 3}`).join(",")}) ON CONFLICT (run_id, strategy_id) DO UPDATE SET ${updates}`;
    if (!apply) { console.log("  [dry-run] iq_lab_strategy_state: upsert"); continue; }
    await pool.query(sql, values).catch(() => undefined);
  }
}
if (!apply) console.log("(dry-run: nada foi alterado; use --apply para aplicar)");
await pool.end();
