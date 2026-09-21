/**
 * LAB REPORT — gerado automaticamente ao completar 120/120 (ou manualmente por runId).
 * Saida: estrategias/lab-6/<run-id>/{manifest.json, strategy-specs/, trades/, reports/, raw/}
 */
import fs from "node:fs";
import path from "node:path";
import { LAB_STRATEGY_SPECS, LAB_STRATEGY_IDS, labSpecsHash, LAB_STAKE_POLICY, LAB_EXPIRY_POLICY, LAB_SETTLEMENT_CAP, LAB_VERSION } from "./strategy-specs.mjs";

const round2 = (v) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : null);
const pct = (part, total) => (total > 0 ? round2((100 * part) / total) : null);

function statsFor(allTrades) {
  const trades = allTrades.filter((t) => t.excluded !== true);
  const settled = trades.filter((t) => t.result);
  const wins = settled.filter((t) => t.result === "WIN").length;
  const losses = settled.filter((t) => t.result === "LOSS").length;
  const draws = settled.filter((t) => t.result === "DRAW").length;
  const pnl = settled.reduce((acc, t) => acc + Number(t.pnl ?? 0), 0);
  const payouts = settled.map((t) => Number(t.payout)).filter((v) => Number.isFinite(v));
  const evidence = trades.map((t) => Number(t.evidence_strength)).filter((v) => Number.isFinite(v));
  const quality = { A: 0, B: 0, C: 0 };
  for (const t of trades) if (t.entry_quality) quality[t.entry_quality] = (quality[t.entry_quality] ?? 0) + 1;
  const counterDist = {};
  for (const t of trades) for (const row of (t.counter ?? [])) counterDist[row.code] = (counterDist[row.code] ?? 0) + 1;
  const counterWin = {}; const counterLoss = {};
  for (const t of settled) { const target = t.result === "WIN" ? counterWin : t.result === "LOSS" ? counterLoss : null; if (!target) continue; for (const row of (t.counter ?? [])) target[row.code] = (target[row.code] ?? 0) + 1; }
  const times = trades.map((t) => Date.parse(t.entry_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const spanHours = times.length > 1 ? (times[times.length - 1] - times[0]) / 3600_000 : null;
  return {
    trades: trades.length, settled: settled.length, wins, losses, draws, excluded: allTrades.length - trades.length,
    wrExclDraw: pct(wins, wins + losses), wrInclDraw: pct(wins, settled.length),
    pnl: round2(pnl), avgPayout: payouts.length ? round2(payouts.reduce((a, b) => a + b, 0) / payouts.length) : null,
    avgEvidenceStrength: evidence.length ? round2(evidence.reduce((a, b) => a + b, 0) / evidence.length) : null,
    entryQuality: quality, counterDistribution: counterDist, counterWin, counterLoss,
    tradesPerHour: spanHours && spanHours > 0 ? round2(trades.length / spanHours) : null,
  };
}

export async function generateLabReport({ pool, runId, rootDir = "estrategias/lab-6" } = {}) {
  if (!pool?.query || !runId) return { ok: false, error: "MISSING_ARGS" };
  const trades = (await pool.query("SELECT * FROM iq_lab_trades WHERE run_id=$1 ORDER BY entry_at ASC", [runId])).rows ?? [];
  const states = (await pool.query("SELECT * FROM iq_lab_strategy_state WHERE run_id=$1", [runId])).rows ?? [];
  const decisions = (await pool.query("SELECT strategy_id, count(*)::int AS n, count(*) FILTER (WHERE decision='WAIT')::int AS waits, count(*) FILTER (WHERE decision IN ('BUY','SELL'))::int AS approvals FROM iq_lab_decisions WHERE run_id=$1 GROUP BY 1", [runId])).rows ?? [];
  const outDir = path.join(rootDir, runId);
  for (const sub of ["strategy-specs", "trades", "reports", "raw"]) fs.mkdirSync(path.join(outDir, sub), { recursive: true });

  const manifest = {
    runId, labVersion: LAB_VERSION, specsHash: labSpecsHash(), generatedAtUtc: new Date().toISOString(),
    settlementCap: LAB_SETTLEMENT_CAP, stakePolicy: LAB_STAKE_POLICY, expiryPolicy: LAB_EXPIRY_POLICY,
    strategies: LAB_STRATEGY_IDS, totalTrades: trades.length,
    status: states.every((s) => s.complete) && states.length === LAB_STRATEGY_IDS.length ? "COMPLETE" : "RUNNING",
    disclaimer: "Amostra exploratoria (20 settlements por estrategia). NAO declarar vencedor, edge ou probabilidade de vitoria.",
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, "strategy-specs", "specs.json"), JSON.stringify({ version: LAB_VERSION, specsHash: labSpecsHash(), strategies: LAB_STRATEGY_SPECS }, null, 2));
  fs.writeFileSync(path.join(outDir, "raw", "trades.json"), JSON.stringify(trades, null, 2));

  const perStrategy = {};
  for (const spec of LAB_STRATEGY_SPECS) {
    const own = trades.filter((t) => t.strategy_id === spec.id);
    const st = states.find((s) => s.strategy_id === spec.id) ?? null;
    const dec = decisions.find((d) => d.strategy_id === spec.id) ?? { n: 0, waits: 0, approvals: 0 };
    const stats = statsFor(own);
    perStrategy[spec.id] = {
      ...stats,
      settledCounter: st?.settled_count ?? stats.settled, openCounter: st?.open_count ?? 0, complete: st?.complete ?? false,
      opportunities: dec.n, waits: dec.waits, approvals: dec.approvals, approvalRate: dec.n ? round2((100 * dec.approvals) / dec.n) : null,
    };
    fs.writeFileSync(path.join(outDir, "trades", `${spec.id}.json`), JSON.stringify(own, null, 2));
    const lines = [
      `# ${spec.id} — relatorio (run ${runId})`, "",
      `- Trades: **${stats.trades}** (settled ${stats.settled}) · W ${stats.wins} / L ${stats.losses} / D ${stats.draws}`,
      `- WR (excl. draw): **${stats.wrExclDraw ?? "n/a"}%** · WR (incl. draw): ${stats.wrInclDraw ?? "n/a"}%`,
      `- PnL: **${stats.pnl ?? "n/a"}** · payout medio ${stats.avgPayout ?? "n/a"} · stake fixo ${LAB_STAKE_POLICY.fixedStake}`,
      `- Oportunidades: ${dec.n} · WAITs: ${dec.waits} · aprovacoes: ${dec.approvals} (${perStrategy[spec.id].approvalRate ?? "n/a"}%) · trades/h ${stats.tradesPerHour ?? "n/a"}`,
      `- Evidence strength media: ${stats.avgEvidenceStrength ?? "n/a"} · Entry quality A/B/C: ${stats.entryQuality.A}/${stats.entryQuality.B}/${stats.entryQuality.C}`,
      "", "## Distribuicao de counterEvidence (todos os trades)",
      ...Object.entries(stats.counterDistribution).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
      "", "## CounterEvidence WIN vs LOSS",
      `- WIN: ${JSON.stringify(stats.counterWin)}`, `- LOSS: ${JSON.stringify(stats.counterLoss)}`,
      "", "## Trades",
      ...own.map((t, i) => `${String(i + 1).padStart(2, "0")}. ${t.market_key} ${t.direction} ${t.result ?? "OPEN"} ${t.pnl ?? ""} (${String(t.entry_at).slice(11, 19)}) quality=${t.entry_quality ?? "-"}`),
      "", "> Sem claim de edge; amostra pequena. Settlement nunca reescreve a justificativa pre-entry.",
    ];
    fs.writeFileSync(path.join(outDir, "reports", `${spec.id}.md`), lines.join("\n"));
  }

  const s01 = trades.filter((t) => t.strategy_id === "S01_RSI_REVERSAL");
  const s06 = trades.filter((t) => t.strategy_id === "S06_RSI_FIBONACCI_REVERSAL");
  const overlapKeys = new Set(s01.map((t) => `${t.market_key}|${String(t.entry_at).slice(0, 16)}`));
  const overlap = s06.filter((t) => overlapKeys.has(`${t.market_key}|${String(t.entry_at).slice(0, 16)}`)).length;
  const comparative = [
    `# LAB 6 — comparativo (run ${runId})`, "",
    "| Strategy | Trades | W | L | D | WR(excl) | WR(incl) | PnL | AvgPayout | Opps | WAIT rate | Trades/h | AvgEvid | Quality A/B/C |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...LAB_STRATEGY_IDS.map((id) => { const s = perStrategy[id]; const waitRate = s.opportunities ? round2((100 * s.waits) / s.opportunities) : null; return `| ${id} | ${s.trades} | ${s.wins} | ${s.losses} | ${s.draws} | ${s.wrExclDraw ?? "-"} | ${s.wrInclDraw ?? "-"} | ${s.pnl ?? "-"} | ${s.avgPayout ?? "-"} | ${s.opportunities} | ${waitRate ?? "-"}% | ${s.tradesPerHour ?? "-"} | ${s.avgEvidenceStrength ?? "-"} | ${s.entryQuality.A}/${s.entryQuality.B}/${s.entryQuality.C} |`; }),
    "", `## S01 vs S06 (Fibonacci adicionou valor?)`,
    `- S01 trades: ${s01.length} · S06 trades: ${s06.length} · overlap mesmo ativo/minuto: ${overlap}`,
    "", "> Relatorio descritivo. 20 settlements/estrategia = amostra exploratoria. Nenhuma conclusao de edge.",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "reports", "comparative.md"), comparative);
  return { ok: true, outDir, totalTrades: trades.length };
}
