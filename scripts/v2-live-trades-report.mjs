/**
 * RELATORIO V2-LIVE — primeiras operacoes (default 20) com auditoria causal por trade.
 * Fonte: iq_executions (settlement real) + iq_rsi_opportunities_v2live (entrySnapshot imutavel) + eventos.
 * Gera: estrategias/v2/runs/<run-id>/report.md + trade-XXX.json + summary.json
 * Uso: node scripts/v2-live-trades-report.mjs --conn=... [--limit=20] [--run=id]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
const arg = (name, fallback = null) => { const found = process.argv.find((i) => i.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
async function loadPg() { try { return (await import("pg")).default; } catch { return createRequire(path.join(process.cwd(), "relay", "package.json"))("pg"); } }
const conn = arg("conn") ?? process.env.DATABASE_URL;
if (!conn) { console.error("informe --conn="); process.exit(2); }
const limit = Math.max(1, Math.min(50, Number(arg("limit")) || 20));
const pg = await loadPg();
const pool = new pg.Pool({ connectionString: conn, max: 2, ssl: /sslmode=(require|no-verify)/.test(conn) ? { rejectUnauthorized: false } : undefined });
const num = (v) => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const iso = (v) => (num(v) ? new Date(Number(v)).toISOString().replace("T", " ").slice(0, 19) + "Z" : null);

try {
  const execs = (await pool.query(`
    SELECT e.requested_at, extract(epoch from e.requested_at)*1000 AS req_ms, extract(epoch from e.expiration_at)*1000 AS exp_ms,
           e.market_key, e.direction, e.stake, e.broker_result, e.profit, e.settled_at
    FROM iq_executions e
    WHERE e.meta->>'source' LIKE 'agent-v2:%'
      AND EXISTS (SELECT 1 FROM iq_rsi_opportunities_v2live o WHERE o.market_key = e.market_key AND o.submit_at IS NOT NULL
                  AND ABS(o.submit_at::numeric - extract(epoch from e.requested_at)*1000) < 20000)
    ORDER BY e.requested_at ASC`)).rows ?? [];
  const sample = execs.slice(0, limit);
  const runId = arg("run") ?? `v2live-${execs.length ? new Date(execs[0].requested_at).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") : "empty"}`;
  const trades = [];
  for (let index = 0; index < sample.length; index += 1) {
    const exec = sample[index];
    const req = Number(exec.req_ms);
    const op = (await pool.query(`SELECT opportunity_id, agent_id, strategy_id, candidate_at, candidate_rsi, candidate_price, rsi, rsi_trajectory, bollinger, band, dmi, adx, short_horizon_direction, entry_price, entry_noise, entry_mode, evaluations, entry_reason, counter_evidence, payload, (payload->>'payout') AS payout FROM iq_rsi_opportunities_v2live WHERE market_key=$1 AND submit_at IS NOT NULL AND ABS(submit_at::numeric - $2::numeric) < 20000 ORDER BY ABS(submit_at::numeric - $2::numeric) ASC LIMIT 1`, [exec.market_key, String(req)])).rows?.[0] ?? null;
    const snap = op?.payload?.entrySnapshot ?? null;
    const indicators = snap?.indicators ?? {};
    const checks = snap?.payload?.checks ?? op?.payload?.checks ?? null;
    const evaluations = Array.isArray(op?.evaluations) ? op.evaluations : [];
    const hard = (op?.counter_evidence ?? []).filter((row) => row?.severity === "HARD").map((row) => row.code);
    const soft = (op?.counter_evidence ?? []).filter((row) => row?.severity === "SOFT").map((row) => row.code);
    const expiryAt = num(exec.exp_ms);
    const submitAt = num(op?.submit_at) ?? req;
    const noise = num(indicators?.noiseHorizon);
    const quality = (await pool.query("SELECT quality_class, actual_displacement, actual_cushion FROM iq_rsi_opportunities_v2live WHERE market_key=$1 AND submit_at IS NOT NULL ORDER BY ABS(submit_at::numeric - $2::numeric) ASC LIMIT 1", [exec.market_key, String(req)])).rows?.[0] ?? {};
    const actualDisplacement = num(quality.actual_displacement);
    const tags = [];
    if (exec.broker_result === "LOSS") {
      if (actualDisplacement !== null && noise !== null && noise > 0 && Math.abs(actualDisplacement) < noise) tags.push("NOISE_DOMINATED");
      const adxSlope = num(op?.adx?.slope);
      if (adxSlope !== null && adxSlope > 0.5) tags.push("OLD_TREND_STILL_STRONG_AT_ENTRY");
      if (soft.length) tags.push("SOFT_CONTRADICTION");
      if (evaluations.length > 0 && (evaluations[evaluations.length - 1]?.reasonCodes?.length ?? 0) === 0) tags.push("CONFIRMED_AT_ENTRY");
      tags.push("THESIS_FAILED_AFTER_ENTRY");
    } else if (exec.broker_result === "WIN") {
      const q = quality.quality_class ?? "UNKNOWN";
      tags.push(q === "STRONG_WIN" || q === "NORMAL_WIN" ? q : (actualDisplacement !== null && noise !== null && Math.abs(actualDisplacement) < noise ? "LUCKY/FRAGILE_WIN" : "THIN_WIN"));
    }
    trades.push({
      n: index + 1,
      market: exec.market_key,
      strategy: op?.strategy_id ?? (String(op?.agent_id ?? "").split(":")[0] || null),
      direction: exec.direction === "BUY" || exec.direction === "CALL" ? "BUY" : "SELL",
      requestedAt: iso(req), candidateAt: iso(op?.candidate_at), submitAt: iso(submitAt), expiryAt: iso(expiryAt),
      candidateToEntryMs: num(op?.candidate_at) === null ? null : Math.round(req - Number(op.candidate_at)),
      candidateRsi: num(op?.candidate_rsi), rsiAtEntry: num(op?.rsi), rsiTrajectory: op?.rsi_trajectory ?? null,
      bollingerPosition: num(op?.bollinger?.position), touchLower: op?.band?.touchLower ?? null, touchUpper: op?.band?.touchUpper ?? null, rejectionLowerNow: op?.band?.rejectionLowerNow ?? null, rejectionUpperNow: op?.band?.rejectionUpperNow ?? null,
      plusDI: num(op?.dmi?.plusDI), minusDI: num(op?.dmi?.minusDI), diSpread: num(op?.dmi?.spread), plusSlope: num(op?.dmi?.plusSlope), minusSlope: num(op?.dmi?.minusSlope),
      adx: num(op?.adx?.value), adxSlope: num(op?.adx?.slope), shortDirection: op?.short_horizon_direction ?? null,
      expectedCushion: num(op?.expected_cushion ?? snap?.expected_cushion), noiseHorizon: noise,
      entryReason: op?.entry_reason ?? snap?.entryReason ?? [], v2Status: checks?.status ?? snap?.checks?.status ?? null,
      counterEvidence: { hard, soft },
      evaluationsCount: evaluations.length,
      evaluationsTail: evaluations.slice(-6),
      timing: { finalEvaluationAt: iso(snap?.watch?.finalEvaluationAt), leadMs: num(snap?.watch?.finalEvaluationLeadMs), cutoffLeadMs: expiryAt !== null && submitAt !== null ? Math.round((expiryAt - 30000) - submitAt) : null, maxGapMs: num(snap?.watch?.maxEvaluationGapMs) },
      payout: num(op?.payout), stake: num(exec.stake),
      settlement: { result: exec.broker_result, profit: num(exec.profit), qualityClass: quality.quality_class ?? null, actualDisplacement, actualCushion: num(quality.actual_cushion) },
      tags,
      hasEntrySnapshot: snap !== null,
    });
  }
  const wins = trades.filter((t) => t.settlement.result === "WIN");
  const losses = trades.filter((t) => t.settlement.result === "LOSS");
  const draws = trades.length - wins.length - losses.length;
  const decided = wins.length + losses.length;
  const wr = decided ? Number(((wins.length / decided) * 100).toFixed(2)) : null;
  const pnl = Number(trades.reduce((sum, t) => sum + (Number(t.settlement.profit) || 0), 0).toFixed(2));
  const payouts = trades.map((t) => t.payout).filter((v) => Number.isFinite(v));
  const avgPayout = payouts.length ? Number((payouts.reduce((a, b) => a + b, 0) / payouts.length).toFixed(2)) : null;
  const summary = { schema: "v2live-report-v1", runId, generatedAtUtc: new Date().toISOString(), totalAvailable: execs.length, sampleSize: trades.length, wins: wins.length, losses: losses.length, draws, wr, averagePayout: avgPayout, pnl, note: "sinal bruto PRACTICE; amostra pequena; sem claim de edge." };
  const dir = path.join("estrategias", "v2", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  trades.forEach((t) => fs.writeFileSync(path.join(dir, `trade-${String(t.n).padStart(3, "0")}.json`), `${JSON.stringify(t, null, 2)}\n`));
  fs.writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [`# V2-live — primeiras ${trades.length} operacoes (${runId})`, "", `## Totais`, `- **W ${wins.length} / L ${losses.length} / D ${draws} — WR ${wr}% — payout medio ${avgPayout}% — PnL R$ ${pnl}**`, `- operacoes disponiveis: ${execs.length} (relatorio limitado as ${limit} primeiras)`, "", `## Por trade`, "| # | ativo | skill | dir | cand->entry | RSI(c->e) | DI (spread) | ADX slope | status V2 | resultado | quality | tags |", "|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const t of trades) lines.push(`| ${t.n} | ${t.market} | ${t.strategy} | ${t.direction} | ${t.candidateToEntryMs}ms | ${t.candidateRsi}->${t.rsiAtEntry} | ${t.plusDI}/${t.minusDI} (${t.diSpread}) | ${t.adxSlope} | ${t.v2Status} | ${t.settlement.result} (${t.settlement.profit}) | ${t.settlement.qualityClass} | ${t.tags.join("+")} |`);
  fs.writeFileSync(path.join(dir, "report.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify(summary));
  for (const t of trades) console.log(`#${t.n} ${t.market} ${t.strategy} ${t.direction} | cand->entry ${t.candidateToEntryMs}ms | RSI ${t.candidateRsi}->${t.rsiAtEntry} | DI ${t.plusDI}/${t.minusDI} spread ${t.diSpread} | ADXslope ${t.adxSlope} | V2 ${t.v2Status} | lead ${t.timing.leadMs}ms | ${t.settlement.result} ${t.settlement.profit} [${t.settlement.qualityClass}] tags=${t.tags.join("+") || "-"}`);
  console.log("REPORT_WRITTEN", dir);
} catch (error) { console.error("REPORT_FAIL", String(error?.message ?? error)); process.exitCode = 1; }
finally { await pool.end(); }
