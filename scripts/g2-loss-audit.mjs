/**
 * G2 LOSS AUDIT (Fase 6.1) — auditoria read-only dos trades do Professional Brain G2.
 *
 * Uso:
 *   node scripts/g2-loss-audit.mjs [--data audit-g2-data.json] [--out docs/audits] [--no-vault]
 *
 * Le o dump de producao (scripts/diag-g2-audit.mjs), reconstroi o dataset t0, roda as analises,
 * o gate de critica adversarial e grava:
 *   - docs/audits/g2-loss-audit-YYYY-MM-DD.md (+ latest)
 *   - Segundo Cerebro: TraceCom/13 - Research/G2 Loss Audit - YYYY-MM-DD.md
 *   - Segundo Cerebro: TraceCom/12 - Daily Reports/G2 Audit Resumo - YYYY-MM-DD.md
 *   - TraceCom/14 - Hypotheses/*.md apenas para padroes com amostra minima (CANDIDATE)
 *
 * Nao altera nenhuma regra de trading; nao promove nada para Validated Knowledge.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildDataset, analyze, auditCritique, renderReport, MIN_SUBGROUP } from "../relay/g2-audit.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const DATA = argOf("--data", "audit-g2-data.json");
const OUT = argOf("--out", path.join("docs", "audits"));
const NO_VAULT = args.includes("--no-vault");

const raw = JSON.parse(await fs.readFile(DATA, "utf8"));
const dataset = buildDataset({ journalRows: raw.journal ?? [], executions: raw.executions ?? [], auditRows: raw.audit ?? [], now: Date.now() });
const analysis = analyze(dataset);
const critique = auditCritique(analysis, dataset);
const day = new Date().toISOString().slice(0, 10);
const meta = { base: "producao (Postgres Railway)", legacyExecutions: raw.legacy?.legacy_executions ?? null, brainGeneration: raw.brainGeneration ?? null };
const report = renderReport({ dataset, analysis, critique, meta });

/* ------------------------------------------------- gravacao repo */
await fs.mkdir(OUT, { recursive: true });
const reportPath = path.join(OUT, `g2-loss-audit-${day}.md`);
await fs.writeFile(reportPath, report, "utf8");
await fs.writeFile(path.join(OUT, "g2-loss-audit-latest.md"), report, "utf8");

/* ------------------------------------------------- Segundo Cerebro */
async function vaultRoot() {
  if (process.env.SECOND_BRAIN_VAULT_PATH) return process.env.SECOND_BRAIN_VAULT_PATH;
  for (const file of [".env.local", ".env"]) {
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    const line = content.replace(/^\uFEFF/, "").split(/\r?\n/).find((row) => row.trim().startsWith("SECOND_BRAIN_VAULT_PATH="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  }
  return null;
}
let vaultWritten = [];
if (!NO_VAULT) {
  const vault = await vaultRoot();
  if (vault) {
    const write = async (relative, content) => {
      const absolute = path.join(vault, relative.replaceAll("/", path.sep));
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      vaultWritten.push(relative);
    };
    await write(`TraceCom/13 - Research/G2 Loss Audit - ${day}.md`, report);
    const summary = [
      `---`,
      `title: G2 Audit Resumo ${day}`,
      `type: entity`,
      `category: DAILY_REPORT`,
      `status: AGENT_MEMORY`,
      `availableAt: ${Date.now()}`,
      `---`,
      ``,
      `# Resumo da auditoria G2 — ${day}`,
      ``,
      `- Trades G2 auditados: ${analysis.overall.n} (W ${analysis.overall.w} / L ${analysis.overall.l} / D ${analysis.overall.d}) · WR ${analysis.overall.wr === null ? "—" : `${(analysis.overall.wr * 100).toFixed(1)}%`}`,
      `- PnL PRACTICE: ${analysis.overall.pnl} · payout medio: ${analysis.overall.avgPayout ?? "—"}`,
      `- Veredito: ${analysis.sampleSufficient ? "PRELIMINAR (N>=30)" : `AINDA NAO HA EVIDENCIA SUFICIENTE PARA CAUSA DOMINANTE (N=${analysis.overall.n} < 30)`}`,
      `- Relatorio completo: TraceCom/13 - Research/G2 Loss Audit - ${day}.md`,
    ].join("\n");
    await write(`TraceCom/12 - Daily Reports/G2 Audit Resumo - ${day}.md`, summary);

    const reliableLosses = dataset.rows.filter((row) => row.result === "LOSS" && row.t0Reliable).length;
    const sustained = reliableLosses >= MIN_SUBGROUP
      ? analysis.topCauses.filter((cause) => cause.count >= 3 && !["NORMAL_STATISTICAL_LOSS", "UNCLASSIFIED", "INSUFFICIENT_CONTEXT"].includes(cause.cause))
      : [];
    for (const cause of sustained) {
      const id = `hyp_g2audit_${day.replaceAll("-", "")}_${cause.cause.toLowerCase()}`;
      const note = [
        `---`, `title: ${id}`, `type: entity`, `category: HYPOTHESIS`, `status: CANDIDATE_KNOWLEDGE`, `originAgent: research:g2-audit`,
        `marketKey: ${(cause.markets ?? [])[0] ?? "-"}`, `regime: -`, `setup: ${(cause.setups ?? []).join(", ") || "-"}`, `availableAt: ${Date.now()}`, `sample: ${cause.count}`, `---`, ``,
        `# ${cause.cause} aparece em ${cause.count} de ${analysis.overall.l} LOSS (amostra insuficiente: N=${analysis.overall.n}<30)`, ``,
        `- mercados: ${(cause.markets ?? []).join(", ") || "-"}`,
        `- setups: ${(cause.setups ?? []).join(", ") || "-"}`,
        `- exemplos: ${(cause.examples ?? []).join(", ") || "-"}`,
        `- regra desta fase: NAO alterar o Brain com esta amostra; validar em dados novos prospectivos.`,
      ].join("\n");
      await write(`TraceCom/14 - Hypotheses/${id}.md`, note);
    }
  }
}

const summary = {
  report: reportPath, vault: vaultWritten, legacyExecutions: meta.legacyExecutions, brainGeneration: meta.brainGeneration,
  trades: analysis.overall.n, w: analysis.overall.w, l: analysis.overall.l, d: analysis.overall.d, wr: analysis.overall.wr, pnl: analysis.overall.pnl,
  topCauses: analysis.topCauses.map((cause) => `${cause.cause}:${cause.count}`), verdict: critique.integrity.verdict, comparisons: analysis.comparisonCount,
};
console.log(JSON.stringify(summary, null, 2));
