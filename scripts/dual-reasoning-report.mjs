/** Gera docs/research/data/dual-reasoning-report.{json,md} (read-only) e imprime o resumo dos checkpoints. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { DualReportService } from "../relay/dual-report-service.mjs";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "relay", "package.json"));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
try {
  const report = await new DualReportService({ pool }).build();
  fs.writeFileSync(path.join(ROOT, "docs/research/data/dual-reasoning-report.json"), `${JSON.stringify(report, null, 1)}\n`);
  const md = [];
  md.push("# DUAL_REASONING_V1_SHADOW — relatorio observacional\n");
  md.push(`- Gerado: ${report.generatedAtUtc}. Observacoes: ${report.counts.observations}; directional settled: ${report.counts.directionalSettled}; proximo checkpoint: ${report.counts.nextCheckpoint ?? "todos atingidos"}.`);
  md.push("- Experimento CONGELADO; relatorio nao altera regras. ZERO REAL.\n");
  md.push("## Mudancas de decisao (R1 -> FINAL)\n");
  md.push(`- nada mudou: ${report.change.nothing}; so A: ${report.change.onlyA}; so B: ${report.change.onlyB}; ambos: ${report.change.both}`);
  md.push(`- R1->R2 mudou: ${report.change.r1ToR2Changes}; R2->FINAL mudou: ${report.change.r2ToFinalChanges}`);
  md.push(`- causas: ${JSON.stringify(report.change.causes)}\n`);
  md.push("## Matriz A x B (FINAL) — outcome do Dual por celula\n| A | B | N | trades | cobertura | W/L | WR | CI95 | A-sozinho (cf) | B-sozinho (cf) |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const row of report.abMatrix) md.push(`| ${row.a} | ${row.b} | ${row.n} | ${row.trades} | ${row.coverage} | ${row.outcome.wins}/${row.outcome.losses} | ${row.outcome.wr === null ? "-" : (row.outcome.wr * 100).toFixed(1) + "%"} | ${row.outcome.ci95.low === null ? "-" : (row.outcome.ci95.low * 100).toFixed(1) + "-" + (row.outcome.ci95.high * 100).toFixed(1) + "%"} | ${row.aAloneCounterfactual.wr === null ? "-" : (row.aAloneCounterfactual.wr * 100).toFixed(1) + "%"} | ${row.bAloneCounterfactual.wr === null ? "-" : (row.bAloneCounterfactual.wr * 100).toFixed(1) + "%"} |`);
  md.push("\n## Structural x Short horizon\n| celula | N | trades | cobertura | W/L | WR | A-sozinho (cf) | B-sozinho (cf) |\n|---|---|---|---|---|---|---|---|");
  for (const row of report.structuralShort) md.push(`| ${row.label} | ${row.n} | ${row.trades} | ${row.coverage} | ${row.outcome.wins}/${row.outcome.losses} | ${row.outcome.wr === null ? "-" : (row.outcome.wr * 100).toFixed(1) + "%"} | ${row.aAloneCounterfactual.wr === null ? "-" : (row.aAloneCounterfactual.wr * 100).toFixed(1) + "%"} | ${row.bAloneCounterfactual.wr === null ? "-" : (row.bAloneCounterfactual.wr * 100).toFixed(1) + "%"} |`);
  md.push("\n## Thesis survival\n| categoria | N | trades | cobertura | W/L | WR | expectancy |\n|---|---|---|---|---|---|---|");
  for (const row of report.survival) md.push(`| ${row.survival} | ${row.n} | ${row.trades} | ${row.coverage} | ${row.outcome.wins}/${row.outcome.losses} | ${row.outcome.wr === null ? "-" : (row.outcome.wr * 100).toFixed(1) + "%"} | ${row.expectancy ?? "-"} |`);
  md.push("\n## Cross-examination (pre-cross vs real)\n");
  md.push(`- transicoes: ${JSON.stringify(report.crossValue.transitions)}`);
  md.push(`- pre-cross trades ${report.crossValue.preCross.trades} WR ${report.crossValue.preCross.outcome.wr}; real trades ${report.crossValue.actual.trades} WR ${report.crossValue.actual.outcome.wr}\n`);
  md.push("## Rounds / persistencia\n");
  md.push(`- tick/candle deltas: ${report.roundsValue.newTicksOrCandles}`);
  md.push(`- agreement persistence: ${JSON.stringify(report.roundsValue.agreementPersistence.map((r) => ({ key: r.key, n: r.n, wr: r.outcome.wr })))}`);
  md.push(`- A stability: ${JSON.stringify(report.roundsValue.aStability.map((r) => ({ key: r.key, n: r.n, wr: r.outcome.wr })))}`);
  md.push(`- B stability: ${JSON.stringify(report.roundsValue.bStability.map((r) => ({ key: r.key, n: r.n, wr: r.outcome.wr })))}\n`);
  md.push("## G2 vs V4 vs Dual (mesma coorte)\n");
  md.push(`- Dual: trades ${report.comparison.dual.trades} WR ${report.comparison.dual.outcome.wr} coverage ${report.comparison.dual.coverage} break-even ${report.comparison.dual.breakEven} expectancy ${report.comparison.dual.expectancy}`);
  md.push(`- V4: trades ${report.comparison.v4.trades} WR ${report.comparison.v4.outcome.wr} coverage ${report.comparison.v4.coverage}`);
  md.push(`- G2: trades ${report.comparison.g2.trades} WR ${report.comparison.g2.outcome.wr} coverage ${report.comparison.g2.coverage}`);
  md.push(`- G2 x V4 discordantes: N=${report.comparison.disagreementSubset.n}\n`);
  md.push("## Latencia (ms)\n");
  for (const [key, value] of Object.entries(report.latency)) md.push(`- ${key}: p50 ${value.p50} p95 ${value.p95} p99 ${value.p99} max ${value.max} negligivel=${value.operationallyNegligible}`);
  md.push("\n## Checkpoints\n| nivel | completo | N | W/L/D | WR | CI95 | cobertura | break-even | expectancy |\n|---|---|---|---|---|---|---|---|---|");
  for (const row of report.checkpoints) md.push(`| ${row.level} | ${row.complete ? "sim" : "nao"} | ${row.outcome.decided} | ${row.outcome.wins}/${row.outcome.losses}/${row.outcome.draws} | ${row.outcome.wr === null ? "-" : (row.outcome.wr * 100).toFixed(1) + "%"} | ${row.outcome.ci95.low === null ? "-" : (row.outcome.ci95.low * 100).toFixed(1) + "-" + (row.outcome.ci95.high * 100).toFixed(1) + "%"} | ${row.coverage} | ${row.breakEven} | ${row.expectancy} |`);
  if (report.checkpoints[0]?.answers) { md.push("\n## Respostas do checkpoint\n```\n" + JSON.stringify(report.checkpoints[0].answers, null, 1) + "\n```"); }
  fs.writeFileSync(path.join(ROOT, "docs/research/data/dual-reasoning-report.md"), md.join("\n") + "\n");
  console.log("DUAL_REPORT_WRITTEN");
  console.log(JSON.stringify({ counts: report.counts, change: report.change, latencyTotal: report.latency.total, checkpoints: report.checkpoints.map((row) => ({ level: row.level, complete: row.complete, decided: row.outcome.decided, wr: row.outcome.wr })) }, null, 1));
} catch (error) { console.error("DUAL_REPORT_FAILED", String(error?.stack ?? error).slice(0, 300)); process.exitCode = 1; } finally { await pool.end().catch(() => undefined); }
