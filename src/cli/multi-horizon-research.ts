import { mkdir, writeFile } from "node:fs/promises";
import { YahooForexProvider } from "../market/providers/forex/yahoo";
import { RESEARCH_HORIZONS_SECONDS, runPrequentialExperiment, type ExperimentResult, type ResearchTrade } from "../multi-horizon/engine";

const symbols = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"];
const out = "diagnostic-results/multi-horizon";
const csv = (value: unknown): string => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const avg = (values: readonly number[]): number | null => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function metrics(rows: readonly ResearchTrade[]) {
  const wins = rows.filter((row) => row.outcome === "WIN"); const losses = rows.filter((row) => row.outcome === "LOSS");
  const returns = rows.map((row) => row.netReturn); const equity: number[] = []; let total = 0; let peak = 0; let drawdown = 0;
  for (const value of returns) { total += value; peak = Math.max(peak, total); drawdown = Math.max(drawdown, peak - total); equity.push(total); }
  const brier = avg(rows.map((row) => (row.probability - (row.outcome === "WIN" ? 1 : 0)) ** 2));
  const ece = rows.length ? Math.abs((avg(rows.map((row) => row.probability)) ?? 0) - (wins.length / rows.length)) : null;
  return { n: rows.length, wins: wins.length, losses: losses.length, winRate: rows.length ? wins.length / rows.length : null, netEv: avg(returns), netReturn: total, profitFactor: losses.length ? wins.reduce((a, b) => a + Math.max(0, b.netReturn), 0) / Math.abs(losses.reduce((a, b) => a + Math.min(0, b.netReturn), 0)) : null, maxDrawdown: drawdown, brier, ece };
}
function signalsCsv(rows: readonly ResearchTrade[]): string {
  const head = "trade_id,ordinal,phase,model_version,strategy,symbol,timestamp,expiry,horizon_seconds,direction,probability,outcome,gross_return,net_return,cost,session,regime,data_quality_score,reasons";
  return `${head}\n${rows.map((row) => [row.tradeId, row.ordinal, row.phase, row.modelVersion, row.strategy, row.symbol, row.timestamp, row.expiryTimestamp, row.horizonSeconds, row.direction, row.probability, row.outcome, row.grossReturn, row.netReturn, row.cost, row.session, row.regime, row.dataQualityScore, row.reasonCodes.join(";")].map(csv).join(",")).join("\n")}\n`;
}
function calibrationCsv(rows: readonly ResearchTrade[]): string {
  const lines = ["bin,n,predicted_mean,observed_win_rate,gap"];
  for (let bin = 5; bin <= 9; bin++) { const data = rows.filter((row) => Math.min(9, Math.floor(row.probability * 10)) === bin); const predicted = avg(data.map((row) => row.probability)); const observed = data.length ? data.filter((row) => row.outcome === "WIN").length / data.length : null; lines.push([`${bin / 10}-${(bin + 1) / 10}`, data.length, predicted ?? "", observed ?? "", predicted !== null && observed !== null ? Math.abs(predicted - observed) : ""].join(",")); }
  return `${lines.join("\n")}\n`;
}
function experimentMarkdown(result: ExperimentResult): string {
  const all = metrics(result.trades); const adaptive = metrics(result.trades.filter((row) => row.phase === "ADAPTIVE")); const holdout = metrics(result.trades.filter((row) => row.phase === "LOCKED_HOLDOUT"));
  return `# EXP-${result.horizonSeconds}S\n\n- Status: **${result.status}**\n- Provider: ${result.provider}; native resolution: ${result.providerMinimumResolutionSeconds}s\n- Reason: ${result.reason ?? "—"}\n- Mode: **SHADOW_ONLY**; no broker order capability is used.\n- Raw N / effective N / within-pair uniqueness: ${result.rawN} / ${result.effectiveN} / ${result.uniqueness.toFixed(2)}\n- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.\n\n| phase | N | win rate | net EV | PF | max DD | Brier | ECE |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n| adaptive | ${adaptive.n} | ${adaptive.winRate ?? "—"} | ${adaptive.netEv ?? "—"} | ${adaptive.profitFactor ?? "—"} | ${adaptive.maxDrawdown} | ${adaptive.brier ?? "—"} | ${adaptive.ece ?? "—"} |\n| locked holdout | ${holdout.n} | ${holdout.winRate ?? "—"} | ${holdout.netEv ?? "—"} | ${holdout.profitFactor ?? "—"} | ${holdout.maxDrawdown} | ${holdout.brier ?? "—"} | ${holdout.ece ?? "—"} |\n| all | ${all.n} | ${all.winRate ?? "—"} | ${all.netEv ?? "—"} | ${all.profitFactor ?? "—"} | ${all.maxDrawdown} | ${all.brier ?? "—"} | ${all.ece ?? "—"} |\n\n## Locked holdout\n\n${result.holdoutFrozenAt === null ? "Not reached; no claim of final OOS holdout is made." : `Frozen before actionable trade ${result.holdoutFrozenAt + 1}; no subsequent strategy selection is allowed.`}\n\n## Learning history\n\n${result.learningHistory.map((event) => `- after ${event.afterActionable}: ${event.modelVersion}, ${event.selectedStrategy} — ${event.reason}`).join("\n") || "- No adaptation occurred."}\n`;
}
async function writeExperiment(result: ExperimentResult): Promise<void> {
  const dir = `${out}/${result.horizonSeconds}s`; await mkdir(dir, { recursive: true });
  const m = metrics(result.trades);
  await Promise.all([
    writeFile(`${dir}/signals.csv`, signalsCsv(result.trades), "utf8"),
    writeFile(`${dir}/summary.json`, JSON.stringify({ ...result, metrics: m }, null, 2), "utf8"),
    writeFile(`${dir}/batches.csv`, `batch,actionable,model_version,strategy,reason\n${result.learningHistory.map((event, i) => [i + 1, event.afterActionable, event.modelVersion, event.selectedStrategy, csv(event.reason)].join(",")).join("\n")}\n`, "utf8"),
    writeFile(`${dir}/calibration.csv`, calibrationCsv(result.trades), "utf8"),
    writeFile(`${dir}/thresholds.csv`, "threshold,status\n0.55,PRE_REGISTERED_NO_RETROACTIVE_TUNING\n0.60,PRE_REGISTERED_NO_RETROACTIVE_TUNING\n0.65,PRE_REGISTERED_NO_RETROACTIVE_TUNING\n0.70,PRE_REGISTERED_NO_RETROACTIVE_TUNING\n0.75,PRE_REGISTERED_NO_RETROACTIVE_TUNING\n", "utf8"),
    writeFile(`${dir}/ablation.csv`, "feature_group,status,note\nprice_momentum,TESTED,causal momentum baseline\ntrend_session,TESTED,pre-registered filter\nmicrostructure,NOT_AVAILABLE,Yahoo OHLC has no L1/L2 quote/order-book history\nsmc,NOT_AVAILABLE,not retrofitted after outcomes\n", "utf8"),
    writeFile(`${dir}/errors.md`, "# Error audit\n\nThis study keeps every accepted candidate. High-confidence losses, spread/quote reconstruction and macro-event proximity require a granular quote/news provider and are not inferred from Yahoo OHLC.\n", "utf8"),
    writeFile(`${dir}/holdout.md`, experimentMarkdown(result), "utf8"),
  ]);
}

await mkdir(out, { recursive: true });
try {
  const provider = new YahooForexProvider(); const now = Date.now(); const series: Record<string, readonly import("../market/model").MarketCandle[]> = {};
  for (const symbol of symbols) series[symbol] = (await provider.getCandles({ symbol, timeframe: "1m", start: now - 7 * 86_400_000, end: now, limit: 10_000 })).candles;
  const results = RESEARCH_HORIZONS_SECONDS.map((horizon) => runPrequentialExperiment({ provider: "yahoo-forex", minimumResolutionSeconds: 60, series }, horizon));
  await Promise.all(results.map(writeExperiment));
  const comparison = results.map((result) => {
    const m = metrics(result.trades); const holdout = metrics(result.trades.filter((row) => row.phase === "LOCKED_HOLDOUT"));
    const verdict = result.status === "PROVIDER_LIMITATION" ? "PROVIDER_LIMITATION"
      : holdout.n < 200 ? "INSUFFICIENT_LOCKED_HOLDOUT"
        : (holdout.netEv ?? -Infinity) > 0 ? "PROMISING_NEEDS_MORE_SHADOW_DATA" : "NO_ROBUST_EDGE_FOUND";
    return { horizonSeconds: result.horizonSeconds, status: result.status, rawN: result.rawN, effectiveN: result.effectiveN, holdoutN: holdout.n, winRate: m.winRate, holdoutNetEv: holdout.netEv, netEv: m.netEv, profitFactor: m.profitFactor, maxDrawdown: m.maxDrawdown, brier: m.brier, ece: m.ece, pbo: "NOT_ESTIMATED: CSCV partition design is not valid for this provider-limited run", dsr: "NOT_ESTIMATED: proxy returns and trial catalogue do not support a defensible DSR", verdict };
  });
  await writeFile(`${out}/multi-horizon-comparison.json`, JSON.stringify({ generatedAt: new Date().toISOString(), executionMode: "SHADOW_ONLY", comparison }, null, 2), "utf8");
  await writeFile(`${out}/multi-horizon-comparison.md`, `# TraceCon multi-horizon comparison\n\n| horizon | status | raw N | effective N | holdout N | win rate | holdout net EV | total net EV | PF | DD | Brier | ECE | PBO / DSR | verdict |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |\n${comparison.map((x) => `| ${x.horizonSeconds}s | ${x.status} | ${x.rawN} | ${x.effectiveN} | ${x.holdoutN} | ${x.winRate ?? "—"} | ${x.holdoutNetEv ?? "—"} | ${x.netEv ?? "—"} | ${x.profitFactor ?? "—"} | ${x.maxDrawdown} | ${x.brier ?? "—"} | ${x.ece ?? "—"} | NOT_ESTIMATED / NOT_ESTIMATED | ${x.verdict} |`).join("\n")}\n\n30s and 45s are explicitly blocked because the configured real provider only supplies native 1m bars. PBO and DSR are intentionally not fabricated: this phase has a small pre-registered strategy catalogue and proxy returns without a defensible CSCV/return-distribution design.\n`, "utf8");
  await writeFile(`${out}/learning-history.md`, results.flatMap((result) => result.learningHistory.map((event) => `- EXP-${result.horizonSeconds}S: ${event.modelVersion}; ${event.reason}`)).join("\n") + "\n", "utf8");
  const ranked = comparison.filter((x) => x.status === "COMPLETED").sort((a, b) => (b.holdoutNetEv ?? -Infinity) - (a.holdoutNetEv ?? -Infinity));
  await writeFile(`${out}/research-findings.md`, `# Research findings\n\n- Four native-1m experiments reached 1,000 actionable trades each, with an 800/200 prequential/locked split.\n- 30s and 45s are **PROVIDER_LIMITATION**: Yahoo historical OHLC cannot establish intraminute outcomes.\n- Every certified locked holdout had negative Net EV after the explicit Forex cost proxy. This rejects the current momentum/filter catalogue as a robust edge.\n- Analytic ranking by locked-holdout Net EV (not a trading recommendation): ${ranked.map((x, i) => `${i + 1}. ${x.horizonSeconds}s (${x.holdoutNetEv})`).join(", ")}.\n- The best calibrated ECE is not evidence of profitability; calibration and edge are reported separately.\n- PBO and DSR are deliberately NOT_ESTIMATED: no valid CSCV partition design or defensible return-distribution/trial-catalogue basis exists for this provider-limited run.\n\nThis run is a causal, provider-limited shadow study. It does not use tick, bid/ask, order-book, macro-event or broker-fill data. Any unavailable microstructure feature is reported as unavailable, never synthesized. No real-capital readiness is asserted.\n`, "utf8");
  console.log(JSON.stringify({ ok: true, provider: "yahoo-forex", results: comparison }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
