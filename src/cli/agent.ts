/**
 * CLI de desenvolvimento do agente Tracecon (Etapa 1).
 *
 * Uso:
 *   npm run agent:dry -- "Analise BTCUSDT no 1m para os próximos 5 candles"
 *
 * Sem ANTHROPIC_API_KEY no .env, roda em modo estático (dry-run): exercita o
 * pipeline com ferramentas reais, mas NUNCA inventa dados — em modo noop os
 * dados retornam UNAVAILABLE e a conclusão é WAIT/incomplete.
 */
import { createApp } from "../app/index";
import { createLogger } from "../observability/logger";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input =
    args.join(" ") || "Analise BTCUSDT no 1m para os próximos 5 candles.";

  const app = createApp();
  const logger = createLogger({ logLevel: app.config.logLevel, nodeEnv: app.config.nodeEnv });

  console.log("TRACECON agent - modo:", app.ai.mode, "| provider:", app.provider.id);
  console.log("Input:", input, "\n");

  try {
    const instrument = app.resolveInstrument("BTCUSDT");
    const analysis = await app.engine.analyze({
      instrument,
      timeframe: "1m",
      horizon: "5 candles",
      input,
    });

    console.log("Decisão:", analysis.decision.direction, "-", analysis.decision.rationale);
    console.log("Incomplete:", analysis.incomplete);
    console.log("Fatores favoráveis:", analysis.favorableFactors);
    console.log("Fatores contrários:", analysis.counterFactors);
    console.log("Invalidadores:", analysis.invalidators);
    console.log("Fontes:", analysis.sources);
    console.log("Tool calls:", analysis.trail.toolCalls.length);
    for (const c of analysis.trail.toolCalls) {
      logger.debug(`  ${c.tool} (${c.availability}) ${c.durationMs}ms`);
    }

    await app.repo.save(analysis);
    console.log("\nSalva no repositório. Total:", await app.repo.count());
  } finally {
    app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
