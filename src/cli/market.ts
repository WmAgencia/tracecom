/**
 * CLI do runtime de mercado (etapa 2).
 *
 * Uso:
 *   npm run market -- --ui         → sobe o servidor HTTP com UI técnica
 *   npm run market -- --live       → testa pipeline real e imprime estado
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";
import { startMarketServer } from "../market/ui";

async function main(): Promise<void> {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const wantUi = args.includes("--ui");

  const rt = createMarketRuntime(config, {
    symbols: [
      { symbol: "BTCUSDT", timeframe: "1m", native: true },
      { symbol: "BTCUSDT", timeframe: "3m", native: true },
      { symbol: "ETHUSDT", timeframe: "1m", native: true },
    ],
  });

  if (wantUi) {
    const server = startMarketServer(rt, { nodeEnv: config.nodeEnv }, 8787);
    console.log("TRACECON market runtime iniciado.");
    process.on("SIGINT", () => {
      rt.stop();
      server.close();
      process.exit(0);
    });
    return;
  }

  if (!rt.configured || !rt.pipeline) {
    console.log("Market: PROVIDER_NOT_CONFIGURED (nenhum provedor integrado configurado).");
    return;
  }

  console.log("Conectando à Binance (REST público)…");
  const started = Date.now();
  await rt.start();
  console.log("Conectado em", Date.now() - started, "ms");

  // Aguarda alguns ticks/stream e imprime estado (com features do quant engine).
  await new Promise((r) => setTimeout(r, 6_000));
  const ctx = await rt.buildContext("BTCUSDT", "1m");
  console.log(JSON.stringify({
    provider: ctx.provider,
    status: rt.provider?.getStatus(),
    currentPrice: ctx.currentPrice,
    lastClosedClose: ctx.latestClosedCandle?.close ?? null,
    latestClose: ctx.recentCandles.at(-1)?.close ?? null,
    quality: ctx.dataQuality,
    freshness: ctx.freshness,
    volume: ctx.volume,
    available: ctx.available,
    quant: ctx.quant ?? null,
  }, null, 2));

  rt.stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
