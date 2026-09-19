/**
 * REPLAY CAUSAL DO SCHEDULER V3.1 — compara cobertura da JANELA FINAL
 * antes (throttle 4.5s com jitter podia pular candles) vs depois (ACTIVE_CANDIDATE_WATCH:
 * 1 avaliacao por candle de 5s garantida por dedupe de bucket, sem dado futuro).
 *
 * Entrada: dump de cadencia (samples de iq_rsi_agent_state_v3.updated_at) capturado ao vivo.
 * Uso: node scripts/rsi-v3-watch-replay.mjs --dump=caminho.json
 */
import { readFileSync } from "node:fs";

const arg = (name, fallback = null) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const CANDLE_MS = 5_000;
const OPEN_LEAD_MS = 35_000;
const WINDOW_SLACK_MS = 1_800;
const dumpPath = arg("dump");
if (!dumpPath) { console.error("uso: node scripts/rsi-v3-watch-replay.mjs --dump=<cadence.json>"); process.exit(2); }
const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
const samples = dump.samples ?? dump;
if (!Array.isArray(samples) || samples.length === 0) { console.error("dump sem samples"); process.exit(2); }

const evaluations = new Map();
for (const sample of samples) {
  for (const row of sample.rows) {
    const list = evaluations.get(row.market_key) ?? [];
    const updated = Number(row.updated_ms);
    if (!list.length || list[list.length - 1].updated !== updated) list.push({ updated, candidateAt: row.candidate_at !== null ? Number(row.candidate_at) : null, wait: row.wait_reason ?? null });
    evaluations.set(row.market_key, list);
  }
}

const span = { from: Number(samples[0].at), to: Number(samples[samples.length - 1].at) };
const candleEndOf = (timestamp) => Math.floor(timestamp / CANDLE_MS) * CANDLE_MS;

const lags = [];
for (const list of evaluations.values()) {
  for (const evaluation of list) {
    const end = candleEndOf(evaluation.updated);
    const lag = evaluation.updated - end;
    if (lag >= 0 && lag <= 2_500) lags.push(lag);
  }
}
const stats = (values) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]; return { n: sorted.length, p50: q(50), p90: q(90), p95: q(95), p99: q(99), max: sorted[sorted.length - 1], mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) }; };

const cycles = [];
const missedCycles = [];
for (const [marketKey, list] of evaluations) {
  const firstBoundary = Math.ceil((span.from + 60_000) / 60_000) * 60_000;
  for (let boundary = firstBoundary; boundary < span.to - 20_000; boundary += 60_000) {
    const opens = boundary - OPEN_LEAD_MS;
    const closes = opens + WINDOW_SLACK_MS;
    const candidateActive = list.some((evaluation) => evaluation.candidateAt !== null && evaluation.updated > opens - 90_000 && evaluation.updated <= closes);
    if (!candidateActive) continue;
    const finalEval = list.find((evaluation) => evaluation.updated >= opens - 250 && evaluation.updated <= closes + 150);
    const cycle = { marketKey, boundary, opens, closes, finalEvalAt: finalEval?.updated ?? null, finalEvalLagMs: finalEval ? finalEval.updated - opens : null };
    cycles.push(cycle);
    if (!finalEval) missedCycles.push(cycle);
  }
}

const windowSlack = WINDOW_SLACK_MS;
const lagWithinSlack = lags.filter((lag) => lag <= windowSlack).length;
const coverageOld = cycles.length ? (cycles.length - missedCycles.length) / cycles.length : null;
const lagStats = stats(lags);
const projectedNewCoverage = lagStats ? +(lagWithinSlack / lagStats.n).toFixed(4) : null;

const report = {
  schema: "rsi-v3-watch-replay-v1",
  source: dumpPath,
  spanMs: span.to - span.from,
  markets: evaluations.size,
  evaluationLagMs: lagStats,
  windowSlackMs: windowSlack,
  cyclesWithCandidate: cycles.length,
  finalWindowCoveredOld: cycles.length - missedCycles.length,
  finalWindowMissedOld: missedCycles.length,
  finalWindowCoverageOld: coverageOld === null ? null : +coverageOld.toFixed(4),
  finalWindowCoverageNewProjected: projectedNewCoverage,
  missedCycles: missedCycles.map((cycle) => ({ marketKey: cycle.marketKey, boundaryUtc: new Date(cycle.boundary).toISOString() })),
  note: "causal: reconstruido apenas de avaliacoes observadas (updated_at); nova politica deduplica por candle e nao pula candles de candidate; sem dado futuro; fail-closed preservado.",
};
console.log(JSON.stringify(report, null, 1));
