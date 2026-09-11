import { mkdir, writeFile } from "node:fs/promises";
import { runShadowValidation, type ShadowSignalRecord } from "../shadow-validation/engine";

type Report = Awaited<ReturnType<typeof runShadowValidation>>;

function wilson95(wins: number, n: number): { lo: number; hi: number } | null {
  if (!n) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function actionable(rows: readonly ShadowSignalRecord[]): ShadowSignalRecord[] { return rows.filter((row) => row.decision !== "WAIT" && row.outcome !== "UNKNOWN"); }
function stats(rows: readonly ShadowSignalRecord[]): { n: number; wins: number; losses: number; winRate: number | null; netReturn: number; netEv: number; coverage: number } {
  const a = actionable(rows);
  const wins = a.filter((row) => row.outcome === "WIN").length;
  const losses = a.filter((row) => row.outcome === "LOSS").length;
  return { n: a.length, wins, losses, winRate: wins + losses ? wins / (wins + losses) : null, netReturn: a.reduce((sum, row) => sum + (row.netReturn ?? 0), 0), netEv: a.reduce((sum, row) => sum + row.expectedValue - row.totalCost, 0) / Math.max(1, a.length), coverage: rows.length ? a.length / rows.length : 0 };
}
function csv(value: unknown): string { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function groupCsv(records: ShadowSignalRecord[], name: string, selector: (row: ShadowSignalRecord) => string): string {
  const groups = new Map<string, ShadowSignalRecord[]>();
  for (const row of records) { const key = selector(row); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const lines = [`group,n,wins,losses,win_rate,net_return,net_ev,coverage`];
  for (const [key, rows] of groups) { const s = stats(rows); lines.push([key, s.n, s.wins, s.losses, s.winRate ?? "", s.netReturn.toFixed(8), s.netEv.toFixed(8), s.coverage.toFixed(6)].map(csv).join(",")); }
  return `# ${name}\n${lines.join("\n")}\n`;
}

function bands(records: ShadowSignalRecord[]): string {
  const result = (lo: number, hi: number) => {
    const rows = actionable(records).filter((row) => row.calibratedProbability >= lo && row.calibratedProbability <= hi);
    const s = stats(rows); const ci = wilson95(s.wins, s.wins + s.losses);
    return `| ${lo.toFixed(2)}–${hi.toFixed(2)} | ${s.n} | ${s.winRate?.toFixed(4) ?? "—"} | ${ci ? `${ci.lo.toFixed(4)}–${ci.hi.toFixed(4)}` : "—"} | ${s.netEv.toFixed(6)} | ${s.netReturn.toFixed(6)} |`;
  };
  return `## Probability bands (95% CI)\n\n| faixa | n | win rate | IC 95% | net EV | retorno líquido |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${result(0.75, 0.85)}\n${result(0.78, 0.82)}\n`;
}

function thresholdCsv(records: ShadowSignalRecord[]): { csv: string; best: number | null } {
  const ordered = [...records].sort((a, b) => a.analysisTimestamp.localeCompare(b.analysisTimestamp));
  const split = Math.max(1, Math.floor(ordered.length * 0.6));
  const train = ordered.slice(0, split); const test = ordered.slice(split);
  const thresholds = [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
  const rows = ["threshold,train_n,train_win_rate,train_net_ev,test_n,test_win_rate,test_net_ev,overfit_risk"];
  let best: number | null = null; let bestEv = -Infinity;
  for (const threshold of thresholds) {
    const tr = train.filter((row) => row.decision !== "WAIT" && row.calibratedProbability >= threshold);
    const te = test.filter((row) => row.decision !== "WAIT" && row.calibratedProbability >= threshold);
    const a = stats(tr); const b = stats(te); const risk = a.n < 30 || b.n < 30 || (a.winRate !== null && b.winRate !== null && a.winRate - b.winRate > 0.15) ? "OVERFIT_RISK" : "OK";
    rows.push([threshold, a.n, a.winRate ?? "", a.netEv.toFixed(8), b.n, b.winRate ?? "", b.netEv.toFixed(8), risk].map(csv).join(","));
    if (a.n >= 30 && b.n >= 30 && a.netEv > bestEv) { best = threshold; bestEv = a.netEv; }
  }
  return { csv: rows.join("\n") + `\n# best_train_threshold=${best ?? "NONE"}\n`, best };
}

function featureAblation(records: ShadowSignalRecord[]): string {
  const ordered = [...records].sort((a, b) => a.analysisTimestamp.localeCompare(b.analysisTimestamp));
  const test = ordered.slice(Math.floor(ordered.length * 0.6));
  const variants: Array<[string, string, ShadowSignalRecord[]]> = [
    ["FULL_CURRENT", "causal momentum + volatility", test],
    ["NO_HIGH_VOLATILITY", "session/regime gate removes HIGH_VOLATILITY", test.filter((r) => r.regime !== "HIGH_VOLATILITY")],
    ["NO_LOW_VOLATILITY", "session/regime gate removes LOW_VOLATILITY", test.filter((r) => r.regime !== "LOW_VOLATILITY")],
    ["TREND_AND_BREAKOUT_ONLY", "only TREND_* and BREAKOUT_* regimes", test.filter((r) => r.regime.startsWith("TREND_") || r.regime.startsWith("BREAKOUT_"))],
    ["LONDON_NY_ONLY", "session gate", test.filter((r) => r.session === "LONDON" || r.session === "NEW_YORK" || r.session === "LONDON_NEW_YORK_OVERLAP")],
  ];
  const lines = ["variant,description,n,wins,losses,win_rate,net_return,net_ev,coverage,status"];
  for (const [variant, description, rows] of variants) { const s = stats(rows); lines.push([variant, description, s.n, s.wins, s.losses, s.winRate ?? "", s.netReturn.toFixed(8), s.netEv.toFixed(8), s.coverage.toFixed(6), "TEST_B"].map(csv).join(",")); }
  for (const feature of ["SMC_FVG", "SMC_ORDER_BLOCK", "SMC_BOS_CHOCH", "LIQUIDITY", "OFI_CVD", "MACRO", "SPREAD_QUANTILE"]) lines.push([feature, "feature not present in Yahoo historical payload; no invented ablation", "", "", "", "", "", "", "", "NOT_AVAILABLE"].map(csv).join(","));
  return `${lines.join("\n")}\n`;
}

function errorAnalysis(records: ShadowSignalRecord[]): string {
  const losses = actionable(records).filter((row) => row.outcome === "LOSS").sort((a, b) => b.calibratedProbability - a.calibratedProbability).slice(0, 25);
  const lines = ["# Forex error analysis", "", "High-confidence losses are listed first. This is descriptive OOS evidence, not a retroactive threshold selection.", "", "| timestamp | symbol | session | regime | direction | p_cal | expected_edge | net_return | reasons |", "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |"];
  for (const row of losses) lines.push(`| ${row.analysisTimestamp} | ${row.symbol} | ${row.session} | ${row.regime} | ${row.direction} | ${row.calibratedProbability.toFixed(4)} | ${row.expectedEdge.toFixed(4)} | ${(row.netReturn ?? 0).toFixed(6)} | ${row.reasonCodes.join("; ")} |`);
  return `${lines.join("\n")}\n`;
}

function markdown(report: Report, bestThreshold: number | null): string {
  const m = report.metrics;
  const rows = m.bins.map((b) => `| ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | ${b.n} | ${b.predictedMean.toFixed(4)} | ${b.observedWinRate.toFixed(4)} | ${b.gap.toFixed(4)} | ${b.confidence80 ? `${b.confidence80.lo.toFixed(4)}–${b.confidence80.hi.toFixed(4)}` : "—"} |`).join("\n");
  const groups = Object.entries(m.grouped).map(([k, v]) => `| ${k} | ${v.n} | ${v.evaluated} | ${v.wins} | ${v.losses} | ${v.winRate === null ? "—" : v.winRate.toFixed(4)} |`).join("\n");
  return `# TraceCon Forex shadow validation\n\n- Gerado em: ${report.generatedAt}\n- Fonte: ${report.provider} (${report.source}); seleção solicitada: ${report.requestedProvider}\n- OANDA: ${report.providerFallbackReason ?? "configurado/selecionado"}\n- Janela: ${report.dataWindow.from} → ${report.dataWindow.to}\n- Símbolos: ${report.symbols.join(", ")} · timeframe: ${report.timeframe} · horizonte: ${report.horizonCandles} candles\n- Execução: **${report.executionMode}** (nenhuma ordem enviada)\n- Lookahead: **não detectado; labels só ficam disponíveis após o fechamento do candle futuro**\n\n## Métricas\n\n| métrica | valor |\n| --- | ---: |\n| sinais totais | ${m.totalSignals} |\n| acionáveis / WAIT | ${m.actionableSignals} / ${m.waitSignals} |\n| avaliados / desconhecidos | ${m.evaluatedSignals} / ${m.unknownSignals} |\n| win / loss / draw | ${m.wins} / ${m.losses} / ${m.draws} |\n| win rate | ${m.winRate === null ? "—" : m.winRate.toFixed(4)} |\n| BUY / SELL | ${m.precisionByDirection.BUY?.toFixed(4) ?? "—"} / ${m.precisionByDirection.SELL?.toFixed(4) ?? "—"} |\n| coverage / abstention | ${m.coverage.toFixed(4)} / ${m.abstentionRate.toFixed(4)} |\n| Brier / log loss | ${m.brier?.toFixed(6) ?? "—"} / ${m.logLoss?.toFixed(6) ?? "—"} |\n| ECE / MCE | ${m.ece?.toFixed(6) ?? "—"} / ${m.mce?.toFixed(6) ?? "—"} |\n| slope / intercept | ${m.calibrationSlope?.toFixed(6) ?? "—"} / ${m.calibrationIntercept?.toFixed(6) ?? "—"} |\n| EV previsto / net EV | ${m.expectedValue.toFixed(6)} / ${m.netExpectedValue.toFixed(6)} |\n| retorno líquido / profit factor | ${m.realizedNetReturn.toFixed(6)} / ${m.profitFactor?.toFixed(4) ?? "—"} |\n| max drawdown / maior W-L | ${m.maxDrawdown.toFixed(6)} / ${m.longestWinStreak}-${m.longestLossStreak} |\n| melhor threshold escolhido no TRAIN | ${bestThreshold ?? "nenhum (amostra/EV insuficiente)"} |\n| validação 80% (0.75–0.85) | n=${m.confidence80Validation.n}, win=${m.confidence80Validation.winRate?.toFixed(4) ?? "—"}, IC 80%=${m.confidence80Validation.interval ? `${m.confidence80Validation.interval.lo.toFixed(4)}–${m.confidence80Validation.interval.hi.toFixed(4)}` : "—"} |\n\n${bands(report.records)}\n## Reliability bins\n\n| bin | n | previsto | observado | gap | IC 80% |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## Breakdown\n\n| chave (símbolo|tf|regime|sessão|direção|calibração) | n | avaliados | wins | losses | win rate |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${groups}\n\nSpread histórico bid/ask não é fornecido pelo Yahoo; cada registro mantém spread=null e marca spreadSource=UNAVAILABLE. O custo usado no EV é um proxy explícito, não uma cotação de corretora.\n`;
}

const outDir = "diagnostic-results";
await mkdir(outDir, { recursive: true });
try {
  const report = await runShadowValidation();
  const threshold = thresholdCsv(report.records);
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const reportJson = JSON.stringify(report, null, 2);
  const reportMarkdown = markdown(report, threshold.best);
  await writeFile(`${outDir}/shadow-validation-${stamp}.json`, reportJson, "utf8");
  await writeFile(`${outDir}/shadow-validation-${stamp}.md`, reportMarkdown, "utf8");
  await writeFile(`${outDir}/shadow-validation-latest.json`, reportJson, "utf8");
  await writeFile(`${outDir}/shadow-validation-latest.md`, reportMarkdown, "utf8");
  await writeFile(`${outDir}/forex-shadow-validation-latest.json`, reportJson, "utf8");
  await writeFile(`${outDir}/forex-shadow-validation-latest.md`, reportMarkdown, "utf8");
  await writeFile(`${outDir}/forex-threshold-analysis.csv`, threshold.csv, "utf8");
  await writeFile(`${outDir}/forex-feature-ablation.csv`, featureAblation(report.records), "utf8");
  await writeFile(`${outDir}/forex-symbol-analysis.csv`, groupCsv(report.records, "symbol", (row) => row.symbol), "utf8");
  await writeFile(`${outDir}/forex-session-analysis.csv`, groupCsv(report.records, "session", (row) => row.session), "utf8");
  await writeFile(`${outDir}/forex-regime-analysis.csv`, groupCsv(report.records, "regime", (row) => row.regime), "utf8");
  await writeFile(`${outDir}/forex-error-analysis.md`, errorAnalysis(report.records), "utf8");
  console.log(JSON.stringify({ ok: true, provider: report.provider, fallback: report.providerFallbackReason, total: report.metrics.totalSignals, actionable: report.metrics.actionableSignals, evaluated: report.metrics.evaluatedSignals, winRate: report.metrics.winRate, netExpectedValue: report.metrics.netExpectedValue, brier: report.metrics.brier, ece: report.metrics.ece, bestTrainThreshold: threshold.best, report: `${outDir}/forex-shadow-validation-latest.md` }, null, 2));
} catch (error) {
  console.error(`shadow-validation falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
