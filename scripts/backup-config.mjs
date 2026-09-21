/**
 * backup-config — protege a CONFIGURACAO que esta funcionando (nao perde tempo reconstruindo).
 *
 * Gera um zip com:
 *   - config.json        : tabelas de configuracao (SEM segredos)
 *   - manifest.md        : leitura humana do que estava ativo (modo, stakes, seguranca, janelas, runs)
 *   - env-names.txt      : apenas os NOMES das variaveis de ambiente (valores nunca saem daqui)
 *
 * NUNCA inclui: iq_mcp_config.token, iq_auth_session (ssid), TOKEN_SIGNING_SECRET, senhas.
 *
 * Uso: node scripts/backup-config.mjs [--out <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outArgIndex = process.argv.indexOf("--out");
const outDir = outArgIndex >= 0 && process.argv[outArgIndex + 1]
  ? path.resolve(process.argv[outArgIndex + 1])
  : path.join(root, "backups");

const CONNECTION = process.env.SUPABASE_DB_URL
  || "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify";

const maskToken = (value) => (value ? "••••" + String(value).slice(-4) : null);

const safeQuery = async (pool, sql) => {
  try { return (await pool.query(sql)).rows; } catch { return null; }
};

const git = (args) => {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return null; }
};

const pool = new pg.Pool({ connectionString: CONNECTION, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });

const runtimeConfig = (await safeQuery(pool, "SELECT * FROM iq_runtime_config WHERE id=1"))?.[0] ?? null;
const agentConfig = (await safeQuery(pool, "SELECT id, safety_pct, shadow_levels, updated_at FROM iq_agent_config WHERE id=1"))?.[0] ?? null;
const perfEpoch = (await safeQuery(pool, "SELECT id, perf_since FROM iq_perf_epoch WHERE id=1"))?.[0] ?? null;
const mcpConfig = (await safeQuery(pool, "SELECT id, token, updated_at FROM iq_mcp_config WHERE id=1"))?.[0] ?? null;
const labRuns = (await safeQuery(pool, "SELECT * FROM iq_lab_runs ORDER BY started_at DESC LIMIT 20")) ?? [];
const labState = (await safeQuery(pool, "SELECT * FROM iq_lab_strategy_state ORDER BY run_id, strategy_id")) ?? [];

await pool.end();

const commit = git(["rev-parse", "HEAD"]);
const tag = git(["describe", "--tags", "--abbrev=0"]);
const status = git(["status", "--porcelain"]);
const at = new Date().toISOString();

const config = {
  version: "backup-config-v1",
  at,
  git: { commit, tag, dirty: Boolean(status) },
  tables: {
    iq_runtime_config: runtimeConfig,
    iq_agent_config: agentConfig,
    iq_perf_epoch: perfEpoch,
    iq_mcp_config: mcpConfig ? { id: mcpConfig.id, configured: Boolean(mcpConfig.token), masked: maskToken(mcpConfig.token), updated_at: mcpConfig.updated_at } : null,
    iq_lab_runs: labRuns,
    iq_lab_strategy_state: labState,
  },
  envNames: ["AGENTIC_ENABLED", "AGENTIC_RUN_ID", "AGENTIC_SAFETY_PCT", "AGENTIC_SHADOW_LEVELS", "CONSENSUS_EXECUTE", "LAB6_ENABLED", "S04_50_ENABLED", "REAL_TRADING_ENABLED", "SHADOW_EXPERIMENT_DISABLED", "FROZEN_STRATEGIES_DISABLED", "IQ_MCP_TOKEN", "TOKEN_SIGNING_SECRET", "TRACECOM_LIVE_RELAY_URL", "TRACECOM_LIVE_RELAY_ADMIN_SECRET"],
};

const selection = runtimeConfig?.selection_json ?? {};
const enabledMarkets = Array.isArray(selection?.markets) ? selection.markets : (Array.isArray(selection?.activeMarketKeys) ? selection.activeMarketKeys : null);

const manifest = [
  `# Backup de configuracao — ${at}`,
  "",
  `- Git: commit \`${commit ?? "?"}\`${tag ? ` (tag \`${tag}\`)` : ""}${status ? " — ATENCAO: working tree com mudancas nao commitadas" : ""}`,
  `- Modo: **${runtimeConfig?.mode ?? "?"}** · auto_execute: **${runtimeConfig?.auto_execute === true}** · stake default: **${runtimeConfig?.default_stake ?? "?"}** · global max: **${runtimeConfig?.global_max_stake ?? "?"}**`,
  `- Seguranca (agentes): **${agentConfig?.safety_pct ?? "?"}%** · niveis A/B: **${agentConfig?.shadow_levels ?? "?"}**`,
  `- Contadores zerados desde: **${perfEpoch?.perf_since ?? "?"}**`,
  `- MCP oficial: **${mcpConfig?.token ? "configurado (" + maskToken(mcpConfig.token) + ")" : "nao configurado"}**`,
  `- Entry window (agentic): **T-34s .. T-31,5s** · filtros do consenso: **constancia (sempre), CF/ST/S (variantes A/B)**`,
  enabledMarkets ? `- Mercados ativos (${enabledMarkets.length}): ${enabledMarkets.slice(0, 40).join(", ")}${enabledMarkets.length > 40 ? ", ..." : ""}` : "- Mercados ativos: (selection_json sem lista simples)",
  "",
  "## Runs",
  ...labRuns.map((r) => `- \`${r.run_id}\` — ${r.status} · stake ${r.stake} · specs ${String(r.specs_hash ?? "").slice(0, 10)} · iniciado ${r.started_at}`),
  "",
  "## Como restaurar",
  "1. `git checkout <commit/tag>` e deploy (relay + vercel).",
  "2. Aplicar `config.json`: `node scripts/restore-config.mjs <zip> --apply` (upsert das tabelas).",
  "3. Reconfigurar envs (ver env-names.txt) no Railway e re-armar via painel (`ARM_PRACTICE`).",
  "",
  "> Segredos NUNCA entram neste backup (token MCP, ssid, TOKEN_SIGNING_SECRET, senhas).",
  "",
].join("\n");

fs.mkdirSync(outDir, { recursive: true });
const stamp = at.replace(/[:.]/g, "-");
const stageDir = path.join(outDir, `config-${stamp}`);
fs.mkdirSync(stageDir, { recursive: true });
fs.writeFileSync(path.join(stageDir, "config.json"), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(stageDir, "manifest.md"), manifest);
fs.writeFileSync(path.join(stageDir, "env-names.txt"), config.envNames.join("\n") + "\n");

const zipPath = path.join(outDir, `config-${stamp}.zip`);
try {
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: "ignore" });
} catch {
  execFileSync("tar", ["-a", "-c", "-f", zipPath, "-C", stageDir, "."], { stdio: "ignore" });
}
fs.rmSync(stageDir, { recursive: true, force: true });

console.log("BACKUP_OK " + zipPath);
console.log("COMMIT " + commit + (status ? " (dirty)" : ""));
console.log("SAFETY " + (agentConfig?.safety_pct ?? "?") + "% · LEVELS " + (agentConfig?.shadow_levels ?? "?"));
