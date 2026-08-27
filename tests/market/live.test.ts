import { describe, it, expect } from "vitest";
import { BinanceProvider, BinanceRestClient } from "../../src/market/providers/binance/rest";
import { MarketPipeline } from "../../src/market/pipeline";

/**
 * Teste opcional de integração real. Marca `skipIfOffline` via flag de rede.
 * Não é determinístico (depende de internet) — mantido fora da suíte padrão
 * por segurança, ativo somente quando explicitamente desejado.
 */
const LIVE = process.env.TRACECON_LIVE === "1";

describe.skipIf(!LIVE)("Binance live (REST)", () => {
  it("busca candles reais de BTCUSDT 1m", async () => {
    const client = new BinanceRestClient();
    const candles = await client.klines({ symbol: "BTCUSDT", timeframe: "1m", start: Date.now() - 3 * 60_000 });
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.every((c) => c.close > 0 && c.timestamp > 0)).toBe(true);
    expect(candles.every((c) => c.provider === "binance")).toBe(true);
  });

  it("ticker de preço real", async () => {
    const client = new BinanceRestClient();
    const t = await client.ticker("BTCUSDT");
    expect(t.price).toBeGreaterThan(0);
  });

  it("pipeline conecta e popula estado com dados reais", async () => {
    const provider = new BinanceProvider();
    const pipeline = new MarketPipeline({
      provider,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await pipeline.start([{ symbol: "BTCUSDT", timeframe: "1m", native: true }]);
    // espera um tick/candle chegar (até 8s) — não determinístico
    await new Promise((r) => setTimeout(r, 8_000));
    const md = await pipeline.state.getCandles("BTCUSDT", "1m");
    expect(md.length).toBeGreaterThan(0);
    pipeline.stop();
  }, 20_000);
});
