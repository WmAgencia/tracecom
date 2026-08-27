/**
 * CLI de Fusão de Evidências (Etapa 5) — decisão analítica completa.
 *
 *   npm run decide BTCUSDT 1h up 12
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";
import type { Direction } from "../backtest/types";

async function main(): Promise<void> {
  const config = loadConfig();
  const symbol = process.argv[2] ?? "BTCUSDT";
  const timeframe = (process.argv[3] ?? "1h") as "1h";
  const direction = (process.argv[4] ?? "up") as Direction;
  const horizon = Number(process.argv[5] ?? 12);

  const rt = createMarketRuntime(config, { symbols: [{ symbol, timeframe, native: true }] });
  if (!rt.configured) {
    console.log("Market: PROVIDER_NOT_CONFIGURED. Use MARKET_DATA_MODE=binance.");
    return;
  }

  console.log(`Coletando ${symbol} ${timeframe}…`);
  await rt.start();
  await new Promise((r) => setTimeout(r, 3_000));

  console.log(`\n== Análise ${symbol} ${timeframe} (${direction} · ${horizon} candles) ==`);
  const result = await rt.fusion.analyze({ symbol, timeframe, direction, horizon });

  console.log("  DECISÃO     :", result.decision);
  console.log("  score       :", result.score.toFixed(3));
  console.log("  confiança   :", (result.confidence * 100).toFixed(1) + "%");
  console.log("  técnico     :", result.technicalScore?.toFixed(3) ?? "n/a");
  console.log("  prob.empí.  :", result.probability ? (result.probability.probability * 100).toFixed(1) + "% (amostra " + result.probability.sampleSize + ")" : "n/a");
  console.log("  regime      :", result.regime ?? "n/a");
  console.log("  risco       :", result.risk.level, `(${result.risk.score.toFixed(2)})`, result.risk.unknown ? "[desconhecido]" : "");
  console.log("  dados sufic.:", result.dataSufficient, "| contestado:", result.blockedByCounterEvidence);

  console.log("  FAVORÁVEIS  :");
  for (const f of result.factors.favorable) console.log("    +", f.text);
  console.log("  CONTRÁRIOS  :");
  for (const f of result.factors.counter) console.log("    -", f.text);
  console.log("  INVALIDADORES:");
  for (const i of result.factors.invalidators) console.log("    !", i);

  console.log("\n  Racional    :", result.rationale);

  // Registra a decisão + valida pendentes (ciclo estatístico, dados reais).
  await rt.analytics.recordDecision({
    symbol, timeframe, direction,
    decision: result.decision,
    horizon,
    entryTime: Date.now(),
    entryPrice: result.technicalScore !== null ? rt.pipeline?.state.getCandles(symbol, timeframe).at(-1)?.close ?? null : null,
    score: result.score,
    confidence: result.confidence,
    probability: result.probability?.probability ?? null,
    sampleSize: result.sampleSize,
    regime: result.regime ?? null,
    rationale: result.rationale,
  });
  const evaled = await rt.analytics.evaluatePending();
  const stats = await rt.analytics.stats();
  console.log("\n  Validação   :", evaled.evaluated, "avaliadas | total:", stats.total,
    "| wins:", stats.wins, "| misses:", stats.misses, "| win rate:", stats.winRate != null ? (stats.winRate * 100).toFixed(1) + "%" : "—");

  rt.stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
