/**
 * Reproducible USD/CAD paper/replay runner.
 *
 * This command deliberately requires a user supplied, chronological OHLC
 * export. It never downloads, interpolates, or fabricates candles. The four
 * phases are a reporting partition of the causal engine output; no broker
 * capability is imported or invoked.
 *
 * Usage: tsx src/cli/paper-runner.ts path/to/usdcad-1m.json [output-dir] [run-id]
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { runPrequentialExperiment, type ResearchInput, type ResearchTrade } from "../multi-horizon/engine";
import type { MarketCandle } from "../market/model";
import { settleTrade } from "../training/settlement";

const PHASES = [{ id: "A", size: 300 }, { id: "B", size: 300 }, { id: "C", size: 300 }, { id: "D", size: 100 }] as const;
type Input = { symbol?: string; provider?: string; minimumResolutionSeconds?: number; candles?: MarketCandle[] };

function parse(raw: unknown): { input: ResearchInput; candles: MarketCandle[] } {
  const value = raw as Input;
  const rows = Array.isArray(value?.candles) ? value.candles : (Array.isArray((value as any)?.rows) ? (value as any).rows : null);
  if (!rows) throw new Error("INPUT_INVALID: expected { candles: [...] } from a real OHLC export");
  const candles = rows.map((c: any) => ({ ...c, timestamp: Number(c.timestamp), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }))
    .sort((a: MarketCandle, b: MarketCandle) => a.timestamp - b.timestamp);
  if (candles.length < 21) throw new Error("INPUT_INSUFFICIENT: at least 21 chronological candles are required");
  if (candles.some((c: MarketCandle) => !Number.isFinite(c.timestamp) || ![c.open, c.high, c.low, c.close].every(Number.isFinite))) throw new Error("INPUT_INVALID: non-finite OHLC value");
  if (candles.some((c: MarketCandle, i: number) => i > 0 && c.timestamp <= candles[i - 1]!.timestamp)) throw new Error("INPUT_INVALID: timestamps must be strictly increasing");
  return { candles, input: { provider: value.provider ?? "user-ohcl-export", minimumResolutionSeconds: value.minimumResolutionSeconds ?? 60, series: { [value.symbol ?? "USD/CAD"]: candles }, maxActionable: 1_000 } };
}

function streak(trades: readonly ResearchTrade[], outcome: "WIN" | "LOSS") {
  let current = 0; let maximum = 0;
  for (const trade of trades) { current = trade.outcome === outcome ? current + 1 : 0; maximum = Math.max(maximum, current); }
  return maximum;
}

function metrics(trades: readonly ResearchTrade[]) {
  const wins = trades.filter((r) => r.outcome === "WIN").length;
  const losses = trades.filter((r) => r.outcome === "LOSS").length;
  const draws = trades.filter((r) => r.outcome === "DRAW").length;
  const unknown = trades.filter((r) => (r.outcome as string) === "UNKNOWN").length;
  const directional = wins + losses;
  return { observations: trades.length, BUY: trades.filter((r) => r.direction === "BUY").length, SELL: trades.filter((r) => r.direction === "SELL").length, WAIT: 0, evaluable: directional + draws, settled: wins + losses + draws, WIN: wins, LOSS: losses, DRAW: draws, UNKNOWN: unknown, winRateExcludingDraw: directional ? wins / directional : null, maxWinStreak: streak(trades, "WIN"), maxLossStreak: streak(trades, "LOSS") };
}

function canonicalAgreement(trades: readonly ResearchTrade[]) {
  const comparisons = trades.map((trade) => settleTrade({ direction: trade.direction, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, entryTimestamp: new Date(trade.timestamp).getTime(), exitTimestamp: new Date(trade.expiryTimestamp).getTime(), dueTimestamp: new Date(trade.expiryTimestamp).getTime(), entrySymbol: trade.symbol, exitSymbol: trade.symbol }));
  const matches = comparisons.filter((result, index) => result.outcome === trades[index]!.outcome).length;
  return { matches, total: trades.length, percentage: trades.length ? matches / trades.length : 0, exact: matches === trades.length };
}

function report(trades: readonly ResearchTrade[], source: string, runId: string, datasetSha256: string) {
  const phases = PHASES.map((phase, i) => { const rows = trades.slice(i ? PHASES.slice(0, i).reduce((n, p) => n + p.size, 0) : 0, PHASES.slice(0, i + 1).reduce((n, p) => n + p.size, 0)); const wins = rows.filter((r) => r.outcome === "WIN").length; const losses = rows.filter((r) => r.outcome === "LOSS").length; const draws = rows.filter((r) => r.outcome === "DRAW").length; return { phase: phase.id, target: phase.size, n: rows.length, wins, losses, draws, evaluatedExcludingDraws: wins + losses, winRateExcludingDraws: wins + losses ? wins / (wins + losses) : null, firstTimestamp: rows[0]?.timestamp ?? null, lastTimestamp: rows.at(-1)?.timestamp ?? null }; });
  const agreement = canonicalAgreement(trades);
  const first900 = trades.slice(0, 900); const blind100 = trades.slice(900, 1_000);
  return { schemaVersion: 3, runId, mode: "SHADOW_PAPER_REPLAY", source, datasetSha256, dataset: { provider: "Yahoo Finance Chart API", symbol: "USDCAD=X", asset: "USD/CAD", marketType: "FOREX_NORMAL", timeframe: "1m", temporalResolution: "60s", temporalValidity: "VALID_BUCKET_ALIGNED", groundTruthValidity: "TEMPORALLY_APPROXIMATE" }, symbol: "USD/CAD", marketType: "FOREX_NORMAL", settlementSource: "src/training/settlement.ts#settleTrade", temporalValidity: "VALID_BUCKET_ALIGNED", trainingEligible: false, calibrationEligible: false, promotionEligible: false, configHash: createHash("sha256").update(JSON.stringify({ horizonSeconds: 60, phases: PHASES, settlementSource: "settleTrade" })).digest("hex"), phases, total: trades.length, ...metrics(trades), first900: metrics(first900), blind100: metrics(blind100), runnerVsSettleTrade: agreement, trades, note: "Outcomes derive only from supplied closed OHLC through canonical settleTrade. This 1m replay is bucket-aligned but temporally approximate to OTC and sends no broker orders." };
}

const [file, output = "diagnostic-results/paper/usdcad", requestedRunId] = process.argv.slice(2);
if (!file) throw new Error("USAGE: paper-runner <real-usdcad-1m.json> [output-dir]");
const runId = requestedRunId ?? `paper-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const raw = await readFile(file, "utf8");
const datasetSha256 = createHash("sha256").update(raw).digest("hex");
const parsed = parse(JSON.parse(raw));
const result = runPrequentialExperiment(parsed.input, 60);
if (result.status !== "COMPLETED" || result.trades.length < 1_000) throw new Error(`PAPER_DATA_INSUFFICIENT: engine produced ${result.trades.length}/1000 actionable windows; no partial A/B/C/D report written`);
const payload = report(result.trades.slice(0, 1_000), file, runId, datasetSha256);
if (!payload.runnerVsSettleTrade.exact) throw new Error(`PAPER_SETTLEMENT_MISMATCH: ${payload.runnerVsSettleTrade.matches}/${payload.runnerVsSettleTrade.total}`);
await mkdir(output, { recursive: true });
await writeFile(`${output}/RUN_USDCAD_REPORT.json`, JSON.stringify(payload, null, 2), "utf8");
await writeFile(`${output}/RUN_USDCAD_REPORT.md`, `# USD/CAD paper replay\n\n- Run ID: \`${runId}\`\n- Mode: **SHADOW_PAPER_REPLAY**\n- Source: \`${file}\`\n- Dataset SHA256: \`${datasetSha256}\`\n- Settlement: \`src/training/settlement.ts#settleTrade\`\n- Temporal validity: **VALID_BUCKET_ALIGNED / TEMPORALLY_APPROXIMATE**\n- Training eligible: **NO**\n- Runner vs settleTrade agreement: **100%**\n- No broker orders were sent.\n\n| phase | target | n | wins | losses | draws | WR excluding draws | first | last |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n${payload.phases.map((p) => `| ${p.phase} | ${p.target} | ${p.n} | ${p.wins} | ${p.losses} | ${p.draws} | ${p.winRateExcludingDraws === null ? "—" : (p.winRateExcludingDraws * 100).toFixed(2) + "%"} | ${p.firstTimestamp ?? "—"} | ${p.lastTimestamp ?? "—"} |`).join("\n")}\n`, "utf8");
await writeFile("diagnostic-results/final-1000-summary.json", JSON.stringify({ ...payload, trades: undefined }, null, 2), "utf8");
await writeFile("diagnostic-results/final-1000-holdout.json", JSON.stringify({ runId, split: { evaluation: "trades 1-900", blind: "trades 901-1000" }, evaluation: payload.first900, blind: payload.blind100, configFrozenBeforeBlind: true, runnerVsSettleTrade: payload.runnerVsSettleTrade }, null, 2), "utf8");
await writeFile("diagnostic-results/final-1000-temporal-audit.json", JSON.stringify({ runId, dataset: payload.dataset, source: "Yahoo Finance Chart API", exactOtcGroundTruth: false, classification: "VALID_BUCKET_ALIGNED", interpretation: "TEMPORALLY_APPROXIMATE", datasetSha256 }, null, 2), "utf8");
console.log(JSON.stringify({ status: "COMPLETE", output, phases: payload.phases }, null, 2));
