/**
 * EXPORT first-10 (V4) — DB -> arquivos JSON congelados + summary + README, com sanitizacao
 * e secret scanning obrigatorios. NUNCA envia tokens/cookies/ssids/sessao/saldo/credenciais.
 *
 * Uso:
 *   node scripts/rsi-v4-export-first10.mjs [--conn=postgres://...] [--out=estrategias/v4/first-10-trades] [--push]
 * Falha com BLOCK_GITHUB_EXPORT_SECRET_DETECTED (exit 2) se qualquer segredo for detectado.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const arg = (name, fallback = null) => { const found = process.argv.find((item) => item.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() {
  try { return (await import("pg")).default; } catch {
    const relayRequire = createRequire(path.join(process.cwd(), "relay", "package.json"));
    return relayRequire("pg");
  }
}

const SECRET_PATTERNS = [
  { code: "SSID", pattern: /ssid/i },
  { code: "TOKEN", pattern: /(bearer\s+[a-z0-9._-]{8,}|token["'\s:]+[a-z0-9._-]{8,})/i },
  { code: "AUTHORIZATION", pattern: /authorization["'\s:]/i },
  { code: "COOKIE", pattern: /cookie/i },
  { code: "PASSWORD", pattern: /password/i },
  { code: "SECRET", pattern: /(secret|api[_-]?key)["'\s:]+\S{8,}/i },
  { code: "EMAIL", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { code: "BALANCE_ID", pattern: /(user_balance_id|balance_id|balanceId)["'\s:]*\d+/i },
];
export function scanForSecrets(text) {
  const found = [];
  for (const entry of SECRET_PATTERNS) if (entry.pattern.test(String(text ?? ""))) found.push(entry.code);
  return found;
}

const packageForFile = (pkg) => JSON.stringify(pkg, null, 2);
const rootOf = (outRoot, instrument, duration) => path.join(outRoot, instrument === "BLITZ_45S" ? "blitz-45s" : "binary", duration ? `duration-${duration}s` : "");

const README = `# V4 — Primeiras 10 operacoes (auditoria externa)

Este pacote congela as 10 primeiras operacoes da RSI_REVERSAL_V4 (PRACTICE only) para auditoria.

## Como ler
- \`trade-00N.json\`: operacao individual (schema tracecon-v4-trade-v1).
- \`summary.json\`: agregados da amostra de 10 (schema tracecon-v4-summary-v1). Amostra pequena: NAO e validacao estatistica e NAO declara edge.
- \`instrumentType\`: BINARY (expiry sincronizado com o broker) ou BLITZ_45S (entrada imediata, expiry = entrada + 45s).
- \`entrySnapshot\`: snapshot IMUTAVEL no momento da ordem (indicadores, counterEvidenceAtEntry, entryReason, hardBlocksChecked).
- \`evaluations[]\`: timeline compacta entre candidate e entrada (timestamp, preco, RSI, DI, ADX, cushion, decisao, reasonCodes).
- \`qualityClass\`: STRONG_WIN/NORMAL_WIN/THIN_WIN/DRAW/THIN_LOSS/NORMAL_LOSS/STRONG_LOSS relativo ao ruido (ATR) — nao ha "pip universal".
- \`counterEvidenceAtEntry\`: HARD bloqueia; SOFT registra.
- \`timestamps\`: candidateAt -> entryAt -> expiryAt (epoch ms).
- \`cushion\`: expectedCushion = deslocamento esperado / ruido do horizonte; FRAGILE = WAIT.

## Reconstruir a decisao
1. Veja \`entrySnapshot.rsi/bollinger/dmi/adx\` no instante da ordem.
2. Confira \`hardBlocksChecked\` (nenhum HARD presente por construcao) e \`entryReason\`.
3. Percorra \`evaluations[]\` para ver como RSI/DI/ADX evoluíram desde o candidate.
4. Compare \`prices.entryPrice\` vs \`prices.expiryPrice\` e leia \`settlement\`.

Nenhum dado sensivel (ssid, token, cookies, credenciais, saldo, ids de conta) e incluido neste pacote.
`;

async function main() {
  const conn = arg("conn") ?? process.env.DATABASE_URL;
  if (!conn) { console.error("informe --conn= ou DATABASE_URL"); process.exit(2); }
  const outRoot = arg("out") ?? OUT_ROOT_DEFAULT;
  const push = process.argv.includes("--push");
  const pg = await loadPg();
  const pool = new pg.Pool({ connectionString: conn, max: 2, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });
  try {
    const trades = (await pool.query("SELECT strategy_version, instrument_type, duration_seconds, trade_number, package FROM iq_v4_export_trades ORDER BY instrument_type, duration_seconds, trade_number")).rows ?? [];
    const summaries = (await pool.query("SELECT strategy_version, instrument_type, duration_seconds, summary FROM iq_v4_export_summary")).rows ?? [];
    if (!trades.length) { console.log("NO_EXPORT_TRADES_YET"); return; }
    const files = [];
    for (const row of trades) {
      const dir = rootOf(outRoot, row.instrument_type, row.duration_seconds);
      const file = path.join(dir, `trade-${String(row.trade_number).padStart(3, "0")}.json`);
      files.push({ file, content: packageForFile(row.package) });
    }
    for (const row of summaries) {
      const dir = rootOf(outRoot, row.instrument_type, row.duration_seconds);
      files.push({ file: path.join(dir, "summary.json"), content: packageForFile(row.summary) });
      files.push({ file: path.join(dir, "README.md"), content: README });
    }
    const forbidden = [];
    for (const item of files) {
      const hits = scanForSecrets(item.content);
      if (hits.length) forbidden.push({ file: item.file, hits });
    }
    if (forbidden.length) {
      console.error("BLOCK_GITHUB_EXPORT_SECRET_DETECTED", JSON.stringify(forbidden));
      process.exitCode = 2;
      return;
    }
    for (const item of files) { fs.mkdirSync(path.dirname(item.file), { recursive: true }); fs.writeFileSync(item.file, `${item.content}\n`); }
    console.log(`EXPORT_FILES_WRITTEN ${files.length} -> ${outRoot}`);
    if (push) {
      const run = (args) => execFileSync("git", args, { stdio: "inherit" });
      run(["add", outRoot]);
      run(["commit", "-m", `data(v4-first-10): pacote de auditoria (${files.length} arquivos)`]);
      run(["push", "origin", "main"]);
      console.log("EXPORT_PUSHED");
    }
  } finally { await pool.end(); }
}

const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main().catch((error) => { console.error("EXPORT_FAIL", String(error?.message ?? error)); process.exitCode = 1; });
