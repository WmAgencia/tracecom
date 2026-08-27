/**
 * CLI do Quant Engine (etapa 3) sobre o pipeline real.
 *
 * Conecta à Binance, coleta candles reais e roda o quant engine (indicadores,
 * volatilidade, regime, estrutura, technicalScore) — exibe as features.
 *
 *   npm run quant
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";

async function main(): Promise<void> {
  const config = loadConfig();
  const rt = createMarketRuntime(config, {
    symbols: [
      { symbol: "BTCUSDT", timeframe: "1m", native: true },
      { symbol: "BTCUSDT", timeframe: "3m", native: true },
      { symbol: "ETHUSDT", timeframe: "1m", native: true },
    ],
  });

  if (!rt.configured) {
    console.log("Market: PROVIDER_NOT_CONFIGURED. Use MARKET_DATA_MODE=binance.");
    return;
  }

  console.log("Coletando dados reais da Binance…");
  await rt.start();
  await new Promise((r) => setTimeout(r, 6_000));

  for (const [symbol, timeframe] of [["BTCUSDT", "1m"], ["BTCUSDT", "3m"], ["ETHUSDT", "1m"]] as const) {
    const ctx = await rt.buildContext(symbol, timeframe);
    const candles = rt.pipeline?.state.getCandles(symbol, timeframe) ?? [];
    console.log(`\n[${symbol} ${timeframe}] candles=${candles.length} available=${ctx.available}`);
    console.log("  price      :", ctx.currentPrice);
    console.log("  quality    :", ctx.dataQuality, "| freshness:", ctx.freshness);
    if (ctx.quant) {
      console.log("  technical  :", ctx.quant.technicalScore?.toFixed(3));
      console.log("  rsi        :", ctx.quant.rsi?.toFixed(2));
      console.log("  macd hist  :", ctx.quant.macdHistogram?.toFixed(4));
      console.log("  atr%       :", ctx.quant.atrPct?.toFixed(4));
      console.log("  vol anu.   :", ctx.quant.volatilityAnnualized?.toFixed(2));
      console.log("  regime     :", ctx.quant.marketRegime);
      console.log("  estrutura  :", ctx.quant.structureTrend);
      console.log("  suporte    :", ctx.quant.supports.slice(0, 3).map((s) => s.toFixed(0)).join(", "));
      console.log("  resist.    :", ctx.quant.resistances.slice(0, 3).map((s) => s.toFixed(0)).join(", "));
    } else {
      console.log("  quant      : dados insuficientes (sem features — nenhum número inventado)");
    }
  }

  rt.stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
