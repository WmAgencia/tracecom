/**
 * deploy:prod — deploy verificado SEM secrets no script (usa CLIs ja autenticadas localmente).
 * Passos: preflight -> typecheck -> testes do lab -> build -> railway up -> vercel --prod -> smoke.
 * Flags: --skip-tests, --skip-relay, --skip-vercel, --dry.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const RELAY_DEPLOY_DIR = process.env.TRACECOM_RELAY_DEPLOY_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Temp", "opencode", "relay-deploy", "relay");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const flags = new Set(process.argv.slice(2));
const dry = flags.has("--dry");

function run(command, args, { cwd = ROOT, shell = false } = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  if (dry) return "";
  return execFileSync(command, args, { cwd, stdio: "inherit", shell });
}

// PREFLIGHT
run("git", ["status", "-sb"]);
run("git", ["log", "--oneline", "-1"]);

// TESTS + BUILD
if (!flags.has("--skip-tests")) {
  run(npm, ["run", "typecheck"]);
  run(npm, ["test", "--", "tests/research/quant-lab.test.ts", "tests/research/agents-v4-hotpath-freeze.test.ts", "tests/ai/agents-v4-runtime-hook.test.ts"]);
}
run(npm, ["run", "build"]);

// RELAY (copia apenas os arquivos do relay para o diretorio linkado ao Railway)
if (!flags.has("--skip-relay")) {
  if (!fs.existsSync(RELAY_DEPLOY_DIR)) {
    console.error(`RELAY_DEPLOY_DIR ausente: ${RELAY_DEPLOY_DIR} (defina TRACECOM_RELAY_DEPLOY_DIR)`);
    process.exit(1);
  }
  const sync = ["relay/iq-multi-runtime.mjs", "relay/server.mjs", "relay/research-worker.mjs"];
  for (const dir of ["datahub", "agents-v4", "research-lab", "migrations"]) {
    fs.mkdirSync(path.join(RELAY_DEPLOY_DIR, dir), { recursive: true });
    fs.cpSync(path.join(ROOT, "relay", dir), path.join(RELAY_DEPLOY_DIR, dir), { recursive: true });
  }
  for (const file of sync) fs.copyFileSync(path.join(ROOT, file), path.join(RELAY_DEPLOY_DIR, path.basename(file)));
  run("npx", ["@railway/cli", "up", "-d", "-s", "tracecom-live-relay"], { cwd: RELAY_DEPLOY_DIR, shell: process.platform === "win32" });
}

// VERCEL
if (!flags.has("--skip-vercel")) run("npx", ["vercel", "--prod", "--yes"], { shell: process.platform === "win32" });

// SMOKE
run("node", ["scripts/research-smoke.mjs"]);
console.log("\ndeploy:prod concluido (smoke acima deve estar todo OK).");
