/**
 * CLI de Backtest + Probabilidade Empírica (etapa 4).
 *
 * Coleta dados via pipeline (backfill → persistir no cold store), executa um
 * backtest de similaridade com split OOS e exibe a probabilidade empírica.
 *
 *   npm run backtest
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";
import { DEFAULT_CRITERIA } from "../backtest/backtest";
import type { SimilarityCriteria, SetupTarget } from "../backtest/types";

async function main(): Promise<void> {
  const config = loadConfig();
  const symbol = process.argv[2] ?? "BTCUSDT";
  const timeframe = (process.argv[3] ?? "1h") as "1h";

  const rt = createMarketRuntime(config, { symbols: [{ symbol, timeframe, native: true }] });
  if (!rt.configured) {
    console.log("Market: PROVIDER_NOT_CONFIGURED. Use MARKET_DATA_MODE=binance.");
    return;
  }

  console.log(`Coletando ${symbol} ${timeframe} (backfill → cold store)…`);
  await rt.start();
  await new Promise((r) => setTimeout(r, 3_000));
  const stored = rt.candleRepo.count(symbol, timeframe);
  console.log("Candles no cold store:", stored);

  const target: SetupTarget = { direction: "up", horizon: 12, minMovePct: 0.5 };
  const criteria: Partial<SimilarityCriteria> = { similarityThreshold: 0.85 };

  console.log("Executando backtest (OOS 25%)…");
  const result = await rt.backtester.run({ symbol, timeframe, target, criteria, oosRatio: 0.25, source: rt.candleRepo.source() });

  console.log("\n== BACKTEST (in-sample) ==");
  console.log("  trades     :", result.metrics.totalTrades);
  console.log("  win rate   :", (result.metrics.winRate * 100).toFixed(1) + "%");
  console.log("  ret. médio :", result.metrics.avgReturn.toFixed(3) + "%");
  console.log("  profit fac :", result.metrics.profitFactor?.toFixed(2) ?? "n/a");
  console.log("  max DD     :", result.metrics.maxDrawdown.toFixed(2) + "%");

  console.log("\n== OUT-OF-SAMPLE (25% final) ==");
  console.log("  trades     :", result.outOfSampleMetrics.totalTrades);
  console.log("  win rate   :", (result.outOfSampleMetrics.winRate * 100).toFixed(1) + "%");
  console.log("  ret. médio :", result.outOfSampleMetrics.avgReturn.toFixed(3) + "%");

  // Probabilidade empírica do setup mais recente
  const candles = rt.pipeline!.state.getCandles(symbol, timeframe);
  if (candles.length >= 30) {
    const prob = await rt.backtester.probabilityForSetup({
      candles, queryIndex: candles.length - 1, target, criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 }, oosRatio: 0.25,
    });
    console.log("\n== PROBABILIDADE EMPÍRICA (setup mais recente) ==");
    console.log("  prob       :", (prob.probability * 100).toFixed(2) + "%");
    console.log("  amostra    :", prob.sampleSize, "| favoráveis:", prob.favorable);
    console.log("  intervalo  :", prob.confidenceInterval ? `[${(prob.confidenceInterval.lower * 100).toFixed(1)}%, ${(prob.confidenceInterval.upper * 100).toFixed(1)}%]` : "n/a");
    console.log("  baseline   :", prob.baseline !== null ? (prob.baseline * 100).toFixed(1) + "%" : "n/a");
  }

  rt.stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
