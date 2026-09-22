import fs from "node:fs";
import { createRequire } from "node:module";
const require2 = createRequire("D:/tracecom/repo/relay/package.json");
const { execFileSync } = require2("node:child_process");
const GIT = "C:/Users/junin/AppData/Local/Temp/opencode/tools/minigit/cmd/git.exe";
const run = (args, opts = {}) => { try { return execFileSync(GIT, args, { cwd: "D:/tracecom/repo", encoding: "utf8", ...opts }); } catch (e) { return String(e.stdout ?? e.message ?? e); } };
// 1) prova: blitz-lab sem referencias (estaticas OU dinamicas)
const refs = run(["grep", "-n", "blitz-lab"]);
console.log("REFS_BLITZ_LAB=" + JSON.stringify(refs.trim().split("\n").filter(Boolean)));
if (!refs.trim()) {
  fs.rmSync("D:/tracecom/repo/relay/blitz-lab.mjs", { force: true });
  console.log("CUT: relay/blitz-lab.mjs removido (0 referencias)");
} else {
  console.log("NAO REMOVIDO: referencias encontradas");
}
// 2) politicas da reconstrucao no AGENTS.md (item 64) - append idempotente
const agents = "D:/tracecom/repo/AGENTS.md";
const text = fs.readFileSync(agents, "utf8");
const marker = "## Reconstrucao controlada (2026-09-22)";
if (!text.includes(marker)) {
  fs.appendFileSync(agents, `\n\n${marker}\n\n- Blitz PROIBIDO no runtime (zero caminho operacional).\n- Horizonte operacional unico = 300s (nenhuma ordem com 30/45/60/150/180).\n- Uma unica estrategia operacional: familia PULLBACK_4060_300 (V2 = PULLBACK_4060_300_AGENTIC_V2).\n- Mudancas de estrategia exigem pedido explicito do operador; apos o deploy da V2: FREEZE (sem tuning durante coleta; mudanca = V3 + novo statsEpoch).\n- PULLBACK_4060_300_BASELINE nunca e apagada (archive/baseline).\n- Sem duplicacao de inteligencia PRACTICE/REAL (uma decisao; Account Router escolhe a conta no final).\n- Codigo simples: sem camada/abstracao/fallback sem justificativa; sem caminhos legacy operacionais.\n- Backups: manifest no git; snapshots zip via artifact de workflow (nunca no historico do git).\n`);
  console.log("AGENTS.md: secao de politicas adicionada");
} else {
  console.log("AGENTS.md: politicas ja presentes");
}
// 3) commit + push
run(["add", "-A"]);
console.log(run(["commit", "-m", "chore(stage2): inventario prove-first + cut relay/blitz-lab.mjs (0 refs) + politicas da reconstrucao no AGENTS.md"]).split("\n").slice(-2).join("\n"));
console.log(run(["log", "--oneline", "-1"]).trim());
