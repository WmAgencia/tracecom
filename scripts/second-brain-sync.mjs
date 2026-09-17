/**
 * SECOND BRAIN SYNC (Fase 6.1) — ponte entre o TraceCom em producao e o vault Obsidian local.
 *
 * O relay roda na nuvem e nao alcanca o disco local; por isso o espelho e feito aqui:
 *  - PULL: le /api/iq/journal, /api/iq/hypotheses, /api/iq/supervisor e /api/iq/knowledge
 *    (via proxy publico autenticado) e escreve notas markdown no vault, sempre dentro de TraceCom/.
 *  - Nunca escreve em "00 - Core Brain" nem em "15 - Validated Knowledge" (Promotion Gate).
 *  - Idempotente: linhas de journal sao deduplicadas por tradeId; notas sao sobrescritas com o estado atual.
 *
 * Uso (na maquina do operador):
 *   node scripts/second-brain-sync.mjs               # sincroniza
 *   node scripts/second-brain-sync.mjs --dry         # mostra o que faria
 *   TRACECOM_BASE=http://localhost:3000 node scripts/second-brain-sync.mjs
 *
 * Vault: variável SECOND_BRAIN_VAULT_PATH (ou .env.local). Sem vault configurado, o script para.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = (process.env.TRACECOM_BASE || "https://tracecom.consecom.com.br").replace(/\/$/, "");
const DRY = process.argv.includes("--dry");
const PUSH = process.argv.includes("--push");
const SCOPE = "TraceCom/";
const PROTECTED = ["00 - Core Brain", "15 - Validated Knowledge"];
const LIBRARY_REPO = path.join(process.cwd(), "relay", "knowledge", "TraceCom");
const VAULT_TO_REPO_SKIP = ["00 - Core Brain", "10 - Agents", "11 - Trade Journal", "12 - Daily Reports", "14 - Hypotheses", "15 - Validated Knowledge"];

async function loadEnvLocal() {
  if (process.env.SECOND_BRAIN_VAULT_PATH) return process.env.SECOND_BRAIN_VAULT_PATH;
  for (const file of [".env.local", ".env"]) {
    const raw = await fs.readFile(path.join(process.cwd(), file), "utf8").catch(() => null);
    if (!raw) continue;
    const line = raw.split(/\r?\n/).find((row) => row.startsWith("SECOND_BRAIN_VAULT_PATH="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  }
  return null;
}

const vaultPath = await loadEnvLocal();
if (!vaultPath) {
  console.error("SECOND_BRAIN_VAULT_PATH nao configurado (defina no ambiente ou em .env.local). Nada a fazer.");
  process.exit(1);
}

const root = path.join(vaultPath, "TraceCom");
const folders = [
  "00 - Core Brain", "01 - Regimes", "02 - Setups", "03 - Indicators", "04 - Risk", "05 - Microstructure",
  "06 - Macro", "07 - Playbooks", "09 - Discipline", "10 - Agents", "11 - Trade Journal", "12 - Daily Reports",
  "13 - Books", "14 - Hypotheses", "15 - Validated Knowledge", "16 - Coverage Matrix", "99 - Sources",
];

const writes = [];
async function writeNote(relative, content, { append = false, skipIfExists = false } = {}) {
  const scoped = relative.replaceAll("\\", "/");
  if (!scoped.startsWith(SCOPE)) throw new Error(`fora do escopo: ${scoped}`);
  const inner = scoped.slice(SCOPE.length);
  if (PROTECTED.some((prefix) => inner.startsWith(prefix))) {
    writes.push({ relative: scoped, action: "BLOCKED_PROTECTED" });
    return { written: false, reason: "PROMOTION_GATE_REQUIRED" };
  }
  const absolute = path.join(root, inner);
  if (append) {
    const existing = await fs.readFile(absolute, "utf8").catch(() => "");
    const merged = existing ? `${existing.replace(/\n$/, "")}\n${content}` : content;
    writes.push({ relative: scoped, action: existing ? "APPEND" : "CREATE", bytes: Buffer.byteLength(merged) });
    if (!DRY) { await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, merged, "utf8"); }
    return { written: true, appended: Boolean(existing) };
  }
  if (skipIfExists) {
    const exists = await fs.stat(absolute).catch(() => null);
    if (exists) { writes.push({ relative: scoped, action: "KEEP" }); return { written: false, kept: true }; }
  }
  writes.push({ relative: scoped, action: "WRITE", bytes: Buffer.byteLength(content) });
  if (!DRY) { await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, content, "utf8"); }
  return { written: true };
}

async function getJson(routePath) {
  try {
    const response = await fetch(`${BASE}${routePath}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(40_000) });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: { error: String(error?.message ?? error) } };
  }
}

const at = new Date().toISOString();
const day = at.slice(0, 10);
const agentFolder = (marketKey) => String(marketKey ?? "UNKNOWN").replaceAll(":", "-").toUpperCase();
const cell = (value) => String(value ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");
const dateOf = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : at);

for (const folder of folders) {
  writes.push({ relative: `${SCOPE}${folder}/`, action: "MKDIR" });
  if (!DRY) await fs.mkdir(path.join(root, folder), { recursive: true });
}

await writeNote(`${SCOPE}README.md`, `---
title: TraceCom — Segundo Cerebro Operacional
type: entity
category: SYSTEM_CONTRACT
status: AGENT_MEMORY
availableAt: ${Date.now()}
---

# TraceCom — Segundo Cerebro Operacional (brainGeneration 2)

Este namespace e escrito e lido pelo TraceCom (agentes Trader/Critico/Professor/Supervisor).
Regras:

- Escopo: somente \`${SCOPE}\` (nada fora daqui e lido ou escrito pelos agentes).
- Protegidos (somente Promotion Gate): \`00 - Core Brain\`, \`15 - Validated Knowledge\`.
- Journal/Hipoteses/Relatorios aqui espelham o Postgres (fonte de verdade); nada e inventado.
- Metodologia: setups do Professional Brain G2. Variantes V1/V2/V3/V8 sao LEGACY_STRATEGY_AUDIT (historico, nunca decisao).
- Sincronizacao: \`node scripts/second-brain-sync.mjs\` (pull de producao para este vault).

Pastas: 10 Agents (memoria por agente), 11 Trade Journal (por dia), 12 Daily Reports,
14 Hypotheses (CANDIDATE), 15 Validated Knowledge (so apos Promotion Gate), 16 Coverage Matrix.
`, { skipIfExists: true });

/* ------------------------------------ JOURNAL + MEMORIA ------------------------------------ */
const journal = await getJson("/api/iq/journal");
const trades = Array.isArray(journal.body.recentTrades) ? journal.body.recentTrades : [];
const agents = Array.isArray(journal.body.agents) ? journal.body.agents : [];

const byAgent = new Map();
for (const trade of trades) {
  const key = trade.agentId ?? `trader:${trade.marketKey}`;
  if (!byAgent.has(key)) byAgent.set(key, []);
  byAgent.get(key).push(trade);
}

for (const [agentId, rows] of byAgent) {
  const market = String(agentId).replace(/^trader:/, "");
  const folder = agentFolder(market);
  const header = "| at | trade | dir | stake | result | quality | setup | regime | contradicting |\n|---|---|---|---|---|---|---|---|---|\n";
  for (const trade of rows) {
    const tradeId = trade.tradeId ?? `${trade.settlementAt}_${trade.marketKey}`;
    const line = `| ${dateOf(trade.settlementAt)} | ${cell(tradeId)} | ${cell(trade.direction)} | ${cell(trade.stake)} | ${cell(trade.result)} | ${cell(trade.decisionQuality)} | ${cell(trade.setup)} | ${cell(trade.regime)} | ${cell((trade.contradictingEvidence ?? []).join(", ")) || "-"} |\n`;
    const file = `${SCOPE}11 - Trade Journal/${folder}/${dateOf(trade.settlementAt).slice(0, 10)}.md`;
    const absolute = path.join(root, file.slice(SCOPE.length));
    const existing = await fs.readFile(absolute, "utf8").catch(() => "");
    if (existing.includes(String(tradeId))) { writes.push({ relative: file, action: "KEEP", detail: tradeId }); continue; }
    await writeNote(file, existing ? line : `${header}${line}`, { append: true });
  }
  const stats = agents.find((row) => row.agentId === agentId)?.stats ?? null;
  if (stats) {
    const decided = (stats.wins ?? 0) + (stats.losses ?? 0) + (stats.draws ?? 0);
    const profile = `---\ntitle: ${agentId}\ntype: entity\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\nagentId: ${agentId}\navailableAt: ${Date.now()}\n---\n\n# ${agentId}\n\n- trades: ${stats.trades ?? 0}\n- W/L/D: ${stats.wins ?? 0}/${stats.losses ?? 0}/${stats.draws ?? 0}\n- WR: ${decided ? ((stats.wins / decided) * 100).toFixed(1) : "-"}%\n- PnL (PRACTICE): ${stats.pnl ?? 0}\n- decisoes boas: ${stats.goodDecisions ?? 0} - ruins: ${stats.badDecisions ?? 0}\n- GOOD_DECISION+LOSS: ${stats.goodDecisionLosses ?? 0} - BAD_DECISION+WIN: ${stats.badDecisionWins ?? 0}\n- esperas (WAIT): ${stats.waitCount ?? 0}\n`;
    await writeNote(`${SCOPE}10 - Agents/${folder}/Profile.md`, profile);
    const lessons = rows.map((trade) => trade.review?.lesson?.text).filter(Boolean).slice(-20).map((text) => `- [${day}] ${text}`).join("\n");
    if (lessons) await writeNote(`${SCOPE}10 - Agents/${folder}/Lessons.md`, `---\ntitle: Lessons ${agentId}\ntype: entity\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\n---\n\n${lessons}\n`);
    const mistakes = rows.flatMap((trade) => trade.review?.mistakes ?? []).slice(-30).map((mistake) => `- ${mistake.code}: ${mistake.detail}`).join("\n");
    if (mistakes) await writeNote(`${SCOPE}10 - Agents/${folder}/Mistakes.md`, `---\ntitle: Mistakes ${agentId}\ntype: entity\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\n---\n\n${mistakes}\n`);
  }
}

/* ------------------------------------ DAILY REPORT ------------------------------------ */
const daily = journal.body.daily ?? null;
if (daily) {
  const report = `---\ntitle: Daily Report ${daily.date ?? day}\ntype: entity\ncategory: DAILY_REPORT\nstatus: AGENT_MEMORY\navailableAt: ${Date.now()}\nsmallSampleWarning: ${daily.smallSampleWarning ? "true" : "false"}\n---\n\n# Relatorio diario ${daily.date ?? day}\n\n- trades: ${daily.trades ?? 0} - W/L/D: ${daily.wins ?? 0}/${daily.losses ?? 0}/${daily.draws ?? 0} - WR: ${daily.winRate ?? "-"}\n- payout medio: ${daily.avgPayout ?? "-"} - PnL PRACTICE: ${daily.practicePnl ?? 0}\n- WAITs: ${daily.waits ?? 0} - decisoes boas: ${daily.goodDecisions ?? 0} - ruins: ${daily.badDecisions ?? 0}\n- GOOD_DECISION+LOSS: ${daily.goodDecisionLosses ?? 0} - BAD_DECISION+WIN: ${daily.badDecisionWins ?? 0}\n${daily.smallSampleWarning ? `- ATENCAO: ${daily.smallSampleWarning}\n` : ""}\n## Por mercado\n${Object.entries(daily.byMarket ?? {}).map(([key, value]) => `- ${key}: ${value.trades} trades - W ${value.wins} L ${value.losses}`).join("\n") || "- sem trades"}\n\n## Por setup\n${Object.entries(daily.bySetup ?? {}).map(([key, value]) => `- ${key}: ${value.trades} trades`).join("\n") || "- sem trades"}\n\n## Licoes\n${(daily.lessons ?? []).slice(0, 10).map((lesson) => `- ${lesson}`).join("\n") || "- sem licoes"}\n`;
  await writeNote(`${SCOPE}12 - Daily Reports/${daily.date ?? day}.md`, report);
}

/* ------------------------------------ HIPOTESES ------------------------------------ */
const hypotheses = await getJson("/api/iq/hypotheses");
for (const item of Array.isArray(hypotheses.body.items) ? hypotheses.body.items : []) {
  const note = `---\ntitle: ${item.id}\ntype: entity\ncategory: HYPOTHESIS\nstatus: ${item.state === "PROMOTED" ? "VALIDATED_KNOWLEDGE" : "CANDIDATE_KNOWLEDGE"}\noriginAgent: ${item.originAgent ?? "-"}\nmarketKey: ${item.marketKey ?? "-"}\nregime: ${item.regime ?? "-"}\nsetup: ${item.setup ?? "-"}\navailableAt: ${item.availableAt ?? Date.now()}\nsample: ${item.sample ?? 0}\n---\n\n# ${item.statement}\n\n- estado: ${item.state}\n- efeito observado: ${item.observedEffect ?? "-"}\n- amostra inicial: ${item.sample ?? 0}\n- mercados: ${(item.markets ?? []).join(", ") || "-"}\n- prospectivo: ${JSON.stringify(item.prospective ?? {})}\n`;
  await writeNote(`${SCOPE}14 - Hypotheses/${item.id}.md`, note);
}

/* ------------------------------------ SUPERVISOR ------------------------------------ */
const supervisor = await getJson("/api/iq/supervisor");
const reviews = Array.isArray(supervisor.body.reviews) ? supervisor.body.reviews : [];
const byMarket = new Map();
for (const review of reviews) {
  if (!byMarket.has(review.marketKey)) byMarket.set(review.marketKey, []);
  byMarket.get(review.marketKey).push(review);
}
for (const [marketKey, rows] of byMarket) {
  const lines = rows.map((review) => `- [${dateOf(review.at).slice(0, 10)}] ${review.status}: ${(review.reasons ?? []).map((reason) => reason.replaceAll("_", " ").toLowerCase()).join(", ") || "sem alertas"}`).join("\n");
  await writeNote(`${SCOPE}10 - Agents/${agentFolder(marketKey)}/Supervisor.md`, `---\ntitle: Supervisor ${marketKey}\ntype: entity\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\ndiscipline: reviewer recommends, never changes methodology\n---\n\n${lines || "- Nenhuma revisao registrada."}\n`);
}

/* ------------------------------------ COVERAGE / BIBLIOTECA ------------------------------------ */
const knowledge = await getJson("/api/iq/knowledge");
const secondBrain = knowledge.body.secondBrain ?? {};
await writeNote(`${SCOPE}16 - Coverage Matrix/LIBRARY_STATUS.md`, `---\ntitle: Biblioteca de Conhecimento (runtime)\ntype: entity\ncategory: COVERAGE\nstatus: SOURCE_KNOWLEDGE\navailableAt: ${Date.now()}\n---\n\n- notas indexadas: ${knowledge.body.notes ?? 0}\n- versao: ${knowledge.body.knowledgeVersion ?? "-"}\n- escopo: ${knowledge.body.scope ?? SCOPE}\n- segundo cerebro (runtime): ${secondBrain.mode ?? "OFFLINE"}\n- categorias: ${Object.entries(knowledge.body.categories ?? {}).map(([key, value]) => `${key} ${value}`).join(" - ") || "-"}\n\nObservacao: a biblioteca curada vive no repositorio (\`relay/knowledge/TraceCom/\`); este arquivo e apenas o espelho de status.\n`);

/* ------------------------------------ BIBLIOTECA: SEED (repo -> vault) ------------------------------------ */
async function seedLibrary() {
  const walk = async (dir, relative) => {
    const rows = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const row of rows) {
      const inner = relative ? `${relative}/${row.name}` : row.name;
      if (row.isDirectory()) { await walk(path.join(dir, row.name), inner); continue; }
      if (!row.name.endsWith(".md")) continue;
      const target = path.join(root, inner);
      const exists = await fs.stat(target).catch(() => null);
      if (exists) continue;
      const content = await fs.readFile(path.join(dir, row.name), "utf8").catch(() => null);
      if (content === null) continue;
      writes.push({ relative: `${SCOPE}${inner}`, action: "SEED", bytes: Buffer.byteLength(content) });
      if (!DRY) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, "utf8"); }
    }
  };
  await walk(LIBRARY_REPO, "");
}

/* ------------------------------------ BIBLIOTECA: PUSH (vault -> repo) ------------------------------------ */
async function pushLibrary() {
  const pushed = [];
  const walk = async (dir, relative) => {
    const rows = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const row of rows) {
      const inner = relative ? `${relative}/${row.name}` : row.name;
      if (row.isDirectory()) {
        if (!relative && VAULT_TO_REPO_SKIP.includes(row.name)) continue;
        await walk(path.join(dir, row.name), inner);
        continue;
      }
      if (!row.name.endsWith(".md")) continue;
      if (!relative && (row.name === "README.md" || row.name.startsWith("_"))) continue;
      if (row.name.startsWith("_") || row.name === "LIBRARY_STATUS.md") continue;
      const vaultContent = await fs.readFile(path.join(dir, row.name), "utf8").catch(() => null);
      if (vaultContent === null) continue;
      const repoTarget = path.join(LIBRARY_REPO, relative, row.name);
      const repoContent = await fs.readFile(repoTarget, "utf8").catch(() => null);
      if (repoContent === vaultContent) continue;
      pushed.push({ relative: `${SCOPE}${inner}`, action: repoContent === null ? "PUSH_NEW" : "PUSH_EDIT", bytes: Buffer.byteLength(vaultContent) });
      if (!DRY) { await fs.mkdir(path.dirname(repoTarget), { recursive: true }); await fs.writeFile(repoTarget, vaultContent, "utf8"); }
    }
  };
  await walk(root, "");
  return pushed;
}

await seedLibrary();
const pushed = PUSH ? await pushLibrary() : [];
for (const row of pushed) writes.push(row);

const summary = { base: BASE, vault: root, dry: DRY, push: PUSH, at, notes: writes.filter((row) => row.action === "WRITE").length, appends: writes.filter((row) => row.action === "APPEND").length, kept: writes.filter((row) => row.action === "KEEP").length, seeded: writes.filter((row) => row.action === "SEED").length, pushed: pushed.length, protectedBlocked: writes.filter((row) => row.action === "BLOCKED_PROTECTED").length, trades: trades.length, hypotheses: (hypotheses.body.items ?? []).length, reviews: reviews.length };
console.log(JSON.stringify({ ...summary, writes }, null, 2));
