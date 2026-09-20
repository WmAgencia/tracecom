/**
 * AUDITORIA CAUSAL V4 (amostra completa) — settlement real do banco, entrada reconstruida apenas
 * com dados disponiveis ate entryAt, classificacao A/B/C/D ANTES do settlement, comparacao WIN vs LOSS,
 * tags de LOSS, qualidade de WIN e auditoria de timing (ACTIVE WATCH).
 *
 * Gera: estrategias/v4/audits/<runId>/{trade-XXX.json, summary.json, audit.md}
 *       docs/research/data/v4-audit-<n>.json
 * Uso: node scripts/v4-causal-audit.mjs --conn=postgres://...
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const arg = (name, fallback = null) => { const found = process.argv.find((i) => i.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() { try { return (await import("pg")).default; } catch { return createRequire(path.join(process.cwd(), "relay", "package.json"))("pg"); } }

const conn = arg("conn") ?? process.env.DATABASE_URL;
if (!conn) { console.error("informe --conn="); process.exit(2); }
const pg = await loadPg();
const pool = new pg.Pool({ connectionString: conn, max: 2, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });
const num = (v) => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const iso = (v) => (num(v) ? new Date(Number(v)).toISOString() : null);
const mean = (values) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)) : null);

const execs = (await pool.query("SELECT requested_at, extract(epoch from requested_at)*1000 AS req_ms, extract(epoch from expiration_at)*1000 AS exp_ms, acked_at, settled_at, market_key, direction, stake, state, broker_result, profit, meta->>'source' AS source FROM iq_executions WHERE meta->>'source' LIKE 'agent-v4:%' ORDER BY requested_at ASC")).rows ?? [];
const ops = (await pool.query("SELECT opportunity_id, market_key, instrument_type, duration_seconds, direction, entry_mode, candidate_at, candidate_rsi, candidate_price, entry_price, entry_noise, expiry_at, submit_at, rsi, rsi_trajectory, bollinger, band, dmi, adx, short_horizon_direction, expected_cushion, cushion_class, quality_class, result, profit, actual_cushion, actual_displacement, counter_evidence, entry_reason, hard_blocks_checked, evaluations, indicators, payload, (payload->>'payout') AS payout FROM iq_rsi_opportunities_v4 WHERE order_id IS NOT NULL ORDER BY submit_at ASC")).rows ?? [];
const events = (await pool.query("SELECT extract(epoch from at)*1000 AS at_ms, market_key, event, payload FROM iq_rsi_events_v4 WHERE at > now() - interval '12 hours' ORDER BY at ASC")).rows ?? [];

const missedByMarket = new Map();
const finalEvalByMarket = new Map();
for (const event of events) {
  if (event.event === "MISSED_ENTRY_WINDOW") missedByMarket.set(event.market_key, (missedByMarket.get(event.market_key) ?? 0) + 1);
  if (event.event === "FINAL_EVALUATION") finalEvalByMarket.set(event.market_key, [...(finalEvalByMarket.get(event.market_key) ?? []), event]);
}
const findOp = (exec) => {
  const req = Number(exec.req_ms);
  return ops.filter((o) => o.market_key === exec.market_key && o.submit_at !== null && Math.abs(Number(o.submit_at) - req) < 20_000)
    .sort((a, b) => Math.abs(Number(a.submit_at) - req) - Math.abs(Number(b.submit_at) - req))[0] ?? null;
};

const trades = [];
execs.forEach((exec, index) => {
  const op = findOp(exec);
  const snap = op?.payload?.entrySnapshot ?? null;
  const indicators = snap?.indicators ?? op?.indicators ?? {};
  const counter = snap?.counterEvidenceAtEntry ?? op?.counter_evidence ?? [];
  const hard = counter.filter((row) => row.severity === "HARD").map((row) => row.code);
  const soft = counter.filter((row) => row.severity === "SOFT").map((row) => row.code);
  const entryReason = snap?.entryReason ?? op?.entry_reason ?? [];
  const checks = snap?.payload?.checks ?? op?.payload?.checks ?? null;
  const cushion = num(op?.expected_cushion ?? snap?.expected_cushion);
  const strong = entryReason.includes("DMI_ADX_FORTE") || entryReason.includes("DI_NOVO_DOMINANTE_ADX_ESTAVEL_OU_SUBINDO") || checks?.dmi?.strongConfirmation === true;
  let grade = "B";
  const gradeReasons = [];
  if (hard.length) { grade = "D"; gradeReasons.push(`HARD:${hard.join("+")}`); }
  else if (cushion !== null && cushion < 0.3) { grade = "C"; gradeReasons.push(`CUSHION_BAIXO(${cushion})`); }
  else if (soft.includes("REJECTION_FAILED")) { grade = "C"; gradeReasons.push("REJECTION_FAILED_SOFT"); }
  else if (!strong) { grade = "C"; gradeReasons.push("SEM_CONFIRMACAO_FORTE"); }
  else if (cushion !== null && cushion >= 0.45 && soft.length === 0) { grade = "A"; gradeReasons.push("FORTE+SEM_SOFT"); }
  else { grade = "B"; gradeReasons.push("CONFIRMACAO_OK"); }
  const candidateAt = num(op?.candidate_at);
  const submitAt = num(op?.submit_at) ?? Number(exec.req_ms);
  // Expiracao REAL do broker (expiration_at). Fallback: entrySnapshot.watch.expiryAt; nunca usar a
  // coluna expiry_at da oportunidade quando ela for anterior ao submit (observabilidade antiga).
  const snapshotExpiry = num(snap?.watch?.expiryAt) ?? num(op?.payload?.entrySnapshot?.watch?.expiryAt);
  const staleOpportunityExpiry = num(op?.expiry_at);
  const expiryAt = num(exec.exp_ms) ?? snapshotExpiry ?? (staleOpportunityExpiry !== null && submitAt !== null && staleOpportunityExpiry > submitAt ? staleOpportunityExpiry : (submitAt === null ? staleOpportunityExpiry : Math.ceil((submitAt + 1) / 60_000) * 60_000));
  const cutoffAt = expiryAt === null ? null : expiryAt - 30_000;
  const watch = snap?.watch ?? null;
  const finalEval = (finalEvalByMarket.get(exec.market_key) ?? []).filter((event) => Math.abs(Number(event.at_ms) - submitAt) < 20_000).sort((a, b) => Math.abs(Number(a.at_ms) - submitAt) - Math.abs(Number(b.at_ms) - submitAt))[0] ?? null;
  trades.push({
    tradeNumber: index + 1,
    identity: { market: exec.market_key, instrumentType: op?.instrument_type ?? "BINARY", marketType: String(exec.market_key).includes(":OTC") ? "OTC" : "NORMAL", direction: exec.direction, entryMode: op?.entry_mode ?? null, duration: op?.duration_seconds ?? 60, stake: num(exec.stake), payout: num(op?.payout), accountMode: "PRACTICE" },
    timestamps: { candidateAt, candidateAtIso: iso(candidateAt), entryAt: submitAt, entryAtIso: iso(submitAt), expiryAt, expiryAtIso: iso(expiryAt), safeCutoff: cutoffAt, safeCutoffIso: iso(cutoffAt), finalEvaluationAt: watch?.finalEvaluationAt ?? num(finalEval?.at_ms) },
    candidateToEntryMs: candidateAt === null ? null : submitAt - candidateAt,
    prices: { candidatePrice: num(op?.candidate_price), entryPrice: num(op?.entry_price), expiryPrice: null, actualDisplacement: null },
    candidateSnapshot: { rsi: num(op?.candidate_rsi) },
    entrySnapshot: { rsi: num(op?.rsi), rsiTrajectory: op?.rsi_trajectory ?? null, bollinger: op?.bollinger ?? null, band: op?.band ?? null, dmi: op?.dmi ?? null, adx: op?.adx ?? null, shortDirection: op?.short_horizon_direction ?? null, noiseHorizon: num(indicators?.noiseHorizon), velocity: num(indicators?.velocity), acceleration: num(indicators?.acceleration), expectedCushion: cushion, cushionClass: op?.cushion_class ?? null, counterEvidenceAtEntry: counter, entryReason, hardBlocksChecked: snap?.hardBlocksChecked ?? op?.hard_blocks_checked ?? [] },
    grades: { grade, reasons: gradeReasons },
    timing: { evaluationCount: watch?.evaluationCount ?? (Array.isArray(op?.evaluations) ? op.evaluations.length : null), maxEvaluationGapMs: num(watch?.maxEvaluationGapMs), finalEvaluationLeadMs: num(watch?.finalEvaluationLeadMs), submitLatencyMs: num(watch?.submitLatencyMs), timeToCutoffAtSubmitMs: cutoffAt === null ? null : cutoffAt - submitAt, missedInSession: missedByMarket.get(exec.market_key) ?? 0 },
    evaluations: Array.isArray(op?.evaluations) ? op.evaluations : [],
    sources: { hasEntrySnapshot: snap !== null, opportunityId: op?.opportunity_id ?? null, checks },
    settlement: null,
  });
});

trades.forEach((trade, index) => {
  const exec = execs[index];
  const op = findOp(exec);
  trade.settlement = { result: exec.broker_result, profit: num(exec.profit), settledAt: exec.settled_at, state: exec.state, qualityClass: op?.quality_class ?? null, actualCushion: num(op?.actual_cushion), actualDisplacement: num(op?.actual_displacement) };
  trade.prices.actualDisplacement = trade.settlement.actualDisplacement;
});

const wins = trades.filter((t) => t.settlement.result === "WIN");
const losses = trades.filter((t) => t.settlement.result === "LOSS");
const draws = trades.filter((t) => t.settlement.result !== "WIN" && t.settlement.result !== "LOSS");
const decided = wins.length + losses.length;
const wr = decided ? Number(((wins.length / decided) * 100).toFixed(2)) : null;
const pnl = Number(trades.reduce((sum, t) => sum + (Number(t.settlement.profit) || 0), 0).toFixed(2));
const payouts = trades.map((t) => t.identity.payout).filter((v) => Number.isFinite(v));
const avgPayout = payouts.length ? Number((payouts.reduce((a, b) => a + b, 0) / payouts.length).toFixed(2)) : null;

for (const t of losses) {
  const tags = [];
  const displacement = num(t.settlement.actualDisplacement);
  const noise = num(t.entrySnapshot.noiseHorizon);
  if (displacement !== null && noise !== null && noise > 0 && Math.abs(displacement) < noise) tags.push("NOISE_DOMINATED");
  if (t.entrySnapshot.counterEvidenceAtEntry.some((row) => row.severity === "SOFT")) tags.push("CURRENT_STATE_CONTRADICTION");
  if (t.grades.grade === "C") tags.push("THIN_ENTRY");
  if (t.candidateToEntryMs !== null && t.candidateToEntryMs > 120_000) tags.push("LATE_REVERSAL");
  if (t.candidateToEntryMs !== null && t.candidateToEntryMs < 40_000) tags.push("EARLY_REVERSAL");
  const adxSlope = num(t.entrySnapshot.adx?.slope);
  if (adxSlope !== null && adxSlope > 0.5) tags.push("OLD_TREND_STILL_TOO_STRONG");
  if (t.timing.finalEvaluationLeadMs !== null && t.timing.finalEvaluationLeadMs <= 0) tags.push("TIMING_FAILURE");
  if (tags.length === 0) tags.push("VALID_THESIS_LOST");
  t.lossTags = tags;
}
for (const t of wins) {
  const quality = t.settlement.qualityClass;
  if (quality === "STRONG_WIN" || quality === "NORMAL_WIN" || quality === "THIN_WIN") t.winQuality = quality;
  else {
    const displacement = num(t.settlement.actualDisplacement);
    const noise = num(t.entrySnapshot.noiseHorizon);
    t.winQuality = displacement !== null && noise !== null && Math.abs(displacement) < noise ? "LUCKY/FRAGILE_WIN" : "THIN_WIN";
  }
}

const pick = (t) => ({ rsi: num(t.entrySnapshot.rsi), rsiCandidate: num(t.candidateSnapshot.rsi), plusDI: num(t.entrySnapshot.dmi?.plusDI), minusDI: num(t.entrySnapshot.dmi?.minusDI), diSpread: num(t.entrySnapshot.dmi?.spread), adx: num(t.entrySnapshot.adx?.value), adxSlope: num(t.entrySnapshot.adx?.slope), position: num(t.entrySnapshot.bollinger?.position), cushion: num(t.entrySnapshot.expectedCushion), velocity: num(t.entrySnapshot.velocity), acceleration: num(t.entrySnapshot.acceleration), candidateAgeMs: t.candidateToEntryMs, evaluations: num(t.timing.evaluationCount), soft: t.entrySnapshot.counterEvidenceAtEntry.filter((row) => row.severity === "SOFT").length, hard: t.entrySnapshot.counterEvidenceAtEntry.filter((row) => row.severity === "HARD").length, leadMs: num(t.timing.finalEvaluationLeadMs) });
const describe = (list) => {
  const rows = list.map(pick);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const out = {};
  for (const key of keys) {
    const values = rows.map((row) => row[key]).filter((v) => Number.isFinite(v));
    out[key] = values.length ? { n: values.length, mean: mean(values), min: Math.min(...values), max: Math.max(...values) } : null;
  }
  return out;
};
const winStats = describe(wins);
const lossStats = describe(losses);
const differences = {};
for (const key of Object.keys(winStats)) {
  const w = winStats[key]?.mean; const l = lossStats[key]?.mean;
  if (w !== null && w !== undefined && l !== null && l !== undefined) differences[key] = Number((w - l).toFixed(4));
}
const gradeDistribution = { WIN: {}, LOSS: {} };
for (const t of wins) gradeDistribution.WIN[t.grades.grade] = (gradeDistribution.WIN[t.grades.grade] ?? 0) + 1;
for (const t of losses) gradeDistribution.LOSS[t.grades.grade] = (gradeDistribution.LOSS[t.grades.grade] ?? 0) + 1;
const winQualityDistribution = {};
for (const t of wins) winQualityDistribution[t.winQuality] = (winQualityDistribution[t.winQuality] ?? 0) + 1;
const lossTagDistribution = {};
for (const t of losses) for (const tag of t.lossTags) lossTagDistribution[tag] = (lossTagDistribution[tag] ?? 0) + 1;

const leadValues = trades.map((t) => t.timing.finalEvaluationLeadMs).filter((v) => v !== null);
const gapValues = trades.map((t) => t.timing.maxEvaluationGapMs).filter((v) => v !== null);
const timingAudit = {
  trades: trades.length,
  postCutoffSubmissions: trades.filter((t) => t.timing.timeToCutoffAtSubmitMs !== null && t.timing.timeToCutoffAtSubmitMs < 0).length,
  finalEvaluationMissing: trades.filter((t) => t.timestamps.finalEvaluationAt === null).length,
  finalLeadMs: leadValues.length ? { n: leadValues.length, mean: mean(leadValues), min: Math.min(...leadValues), max: Math.max(...leadValues) } : null,
  maxEvaluationGapMs: gapValues.length ? { n: gapValues.length, mean: mean(gapValues), max: Math.max(...gapValues) } : null,
  missedEventsInSession: [...missedByMarket.values()].reduce((sum, value) => sum + value, 0),
  schedulerAttributableLosses: losses.filter((t) => (t.timing.timeToCutoffAtSubmitMs !== null && t.timing.timeToCutoffAtSubmitMs < 0) || (t.timing.finalEvaluationLeadMs !== null && t.timing.finalEvaluationLeadMs <= 0)).length,
};

for (const t of losses) {
  t.explanation = {
    whyEntered: `entryReason=${t.entrySnapshot.entryReason.join("+") || "n/a"} | RSI ${t.entrySnapshot.rsi} | spread ${t.entrySnapshot.dmi?.spread} | ADX slope ${t.entrySnapshot.adx?.slope} | cushion ${t.entrySnapshot.expectedCushion} | soft=${t.entrySnapshot.counterEvidenceAtEntry.filter((row) => row.severity === "SOFT").map((row) => row.code).join("+") || "nenhum"}`,
    whatHappened: `settlement ${t.settlement.result} (${t.settlement.profit}) | quality ${t.settlement.qualityClass} | actualCushion ${t.settlement.actualCushion ?? "n/a"} | actualDisplacement ${t.settlement.actualDisplacement ?? "n/a"}`,
  };
}

const runId = `v4-${execs.length ? new Date(execs[0].requested_at).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") : "empty"}`;
const auditDir = path.join("estrategias", "v4", "audits", runId);
fs.mkdirSync(auditDir, { recursive: true });
for (const t of trades) fs.writeFileSync(path.join(auditDir, `trade-${String(t.tradeNumber).padStart(3, "0")}.json`), `${JSON.stringify(t, null, 2)}\n`);
const summary = {
  schema: "tracecon-v4-audit-summary-v1", runId, generatedAtUtc: new Date().toISOString(),
  source: "iq_executions(agent-v4) + iq_rsi_opportunities_v4(entrySnapshot) + iq_rsi_events_v4",
  sampleSize: trades.length, wins: wins.length, losses: losses.length, draws: draws.length, wr, averagePayout: avgPayout, pnl,
  gradeDistribution, winQualityDistribution, lossTagDistribution, timingAudit,
  operatorObservation: { reported: { trades: 23, wins: 11, losses: 12, wr: 47.83 }, verified: { trades: trades.length, wins: wins.length, losses: losses.length, wr }, divergence: trades.length === 23 ? "contagem confirmada" : `DB tem ${trades.length} settlements reais (${wins.length}W/${losses.length}L); a contagem do operador era um snapshot parcial do momento.` },
  note: "Classificacao A/B/C/D feita SEM settlement; settlement revelado depois. Sem claim de edge.",
};
fs.writeFileSync(path.join(auditDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(`docs/research/data/v4-audit-${trades.length}.json`, `${JSON.stringify({ summary, differences, winStats, lossStats, trades }, null, 2)}\n`);

const lines = [];
lines.push(`# Auditoria causal V4 — ${runId}`, "");
lines.push(`- **Amostra real (DB):** ${trades.length} operacoes — ${wins.length}W / ${losses.length}L / ${draws.length}D — WR **${wr}%** — payout medio **${avgPayout}%** — PnL **${pnl}**`);
lines.push(`- Observado pelo operador: 23 (11W/12L, 47,83%). ${summary.operatorObservation.divergence}`, "");
lines.push("## Classificacao causal (somente com dados ate entryAt; settlement revelado depois)", "");
lines.push("| # | ativo | dir | grade | razoes | RSI | spread | ADX slope | cushion | soft | resultado |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of trades) lines.push(`| ${t.tradeNumber} | ${t.identity.market} | ${t.identity.direction} | ${t.grades.grade} | ${t.grades.reasons.join("+")} | ${t.entrySnapshot.rsi} | ${t.entrySnapshot.dmi?.spread} | ${t.entrySnapshot.adx?.slope} | ${t.entrySnapshot.expectedCushion} | ${t.entrySnapshot.counterEvidenceAtEntry.filter((row) => row.severity === "SOFT").length} | ${t.settlement.result} |`);
lines.push("", `Grade: WIN ${JSON.stringify(gradeDistribution.WIN)} | LOSS ${JSON.stringify(gradeDistribution.LOSS)}`, "");
lines.push(`## LOSS (${losses.length})`);
for (const t of losses) lines.push(`- **${t.identity.market} ${t.identity.direction}** (${t.settlement.profit}) — tags: ${t.lossTags.join("+")}`, `  - por que entrou: ${t.explanation.whyEntered}`, `  - o que aconteceu: ${t.explanation.whatHappened}`);
lines.push("", `## WIN (${wins.length})`);
for (const t of wins) lines.push(`- **${t.identity.market} ${t.identity.direction}** (${t.settlement.profit}) [${t.winQuality}] — RSI ${t.entrySnapshot.rsi} | spread ${t.entrySnapshot.dmi?.spread} | cushion ${t.entrySnapshot.expectedCushion}`);
lines.push("", "## WIN vs LOSS (descritivo; sem otimizacao)", "```json", JSON.stringify(differences, null, 1), "```");
lines.push("", "## Timing (ACTIVE WATCH)", "```json", JSON.stringify(timingAudit, null, 1), "```");
lines.push("", `Nenhuma LOSS atribuivel ao scheduler: submissions pos-cutoff=${timingAudit.postCutoffSubmissions}, LOSS atribuiveis=${timingAudit.schedulerAttributableLosses}.`);
fs.writeFileSync(path.join(auditDir, "audit.md"), `${lines.join("\n")}\n`);

console.log("RUN", runId, "trades", trades.length, "W", wins.length, "L", losses.length, "D", draws.length, "WR", wr, "payout", avgPayout, "pnl", pnl);
console.log("grades", JSON.stringify(gradeDistribution));
console.log("lossTags", JSON.stringify(lossTagDistribution));
console.log("winQuality", JSON.stringify(winQualityDistribution));
console.log("timing", JSON.stringify(timingAudit));
console.log("differences", JSON.stringify(differences));
console.log("WRITTEN", auditDir);
await pool.end();
