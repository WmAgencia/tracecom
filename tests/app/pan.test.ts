/**
 * Smoke P-AN: confirma que MARKET_DATA_MODE=binance ativa BinanceProvider V2.
 *
 * Antes do fix: app/index.ts usava `registry.providerFromConfig` que forçava
 * "binance" → "noop", então produção rodava em `NoopProvider` mesmo com
 * market data mode correto.
 *
 * Depois do fix: `registryV2.resolveProvider` retorna `BinanceProvider`
 * (com métodos connect()/subscribe()) quando marketDataMode === "binance".
 */
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app/index";

describe("P-AN: market provider wiring", () => {
  it("com MARKET_DATA_MODE=binance, createApp retorna BinanceProvider V2 (não NoopProvider)", () => {
    const prev = process.env.MARKET_DATA_MODE;
    process.env.MARKET_DATA_MODE = "binance";
    process.env.ANTHROPIC_API_KEY = ""; // evita chamada real
    try {
      const app = createApp(); // usa process.env direto (loadConfig default)
      const p = app.provider as unknown as Record<string, unknown>;
      // V2 BinanceProvider: tem id="binance", connect(), subscribe().
      // NoopProvider legada: não tem connect nem state.
      expect(p.id).toBe("binance");
      expect(typeof p.connect).toBe("function");
      expect(typeof p.subscribe).toBe("function");
      app.close();
    } finally {
      process.env.MARKET_DATA_MODE = prev;
    }
  });
});
