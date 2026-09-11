/**
 * Testes do DukascopyForexProvider.
 *
 * Cobre:
 *  1. fetchCandles("EURUSD", "1h", 24) → 24 candles em ordem temporal.
 *  2. Símbolo não suportado → lança erro claro.
 *  3. Modo offline (mock fetch falha) → candles sintéticos com source="synthetic".
 *  4. fetchOrderBook("EURUSD") → retorna MarketOrderBook vazio (FX sem L2 centralizado).
 *  5. Spread típico EURUSD ≈ 0.7 pips (1 pip = 0.0001 para majors sem JPY).
 *  + Bonus: determinismo do modo sintético (mesma seed → mesmos closes).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DukascopyForexProvider } from "../../../../src/market/providers/forex/dukascopy";
import {
  FOREX_PAIRS,
  TYPICAL_SPREAD_PIPS,
  PIP_SIZE,
  TYPICAL_PRICE_USD,
  getForexPairMeta,
  isSupportedForexPair,
} from "../../../../src/market/providers/forex/catalog";
import { resolveProvider } from "../../../../src/market/registryV2";

describe("DukascopyForexProvider — catálogo forex", () => {
  it("0. catálogo tem exatamente 5 majors", () => {
    expect(FOREX_PAIRS.length).toBe(5);
    expect(FOREX_PAIRS).toContain("EURUSD");
    expect(FOREX_PAIRS).toContain("USDJPY");
  });

  it("0b. isSupportedForexPair aceita case-insensitive", () => {
    expect(isSupportedForexPair("eurusd")).toBe(true);
    expect(isSupportedForexPair("EURUSD")).toBe(true);
    expect(isSupportedForexPair("XYZABC")).toBe(false);
  });

  it("0c. getForexPairMeta devolve metadados com pipSize correto (JPY=0.01)", () => {
    const eurusd = getForexPairMeta("EURUSD");
    expect(eurusd?.pipSize).toBe(0.0001);
    expect(eurusd?.base).toBe("EUR");
    expect(eurusd?.quote).toBe("USD");

    const usdjpy = getForexPairMeta("USDJPY");
    expect(usdjpy?.pipSize).toBe(0.01);
    expect(usdjpy?.base).toBe("USD");
    expect(usdjpy?.quote).toBe("JPY");
  });

  it("0d. TYPICAL_SPREAD_PIPS.EURUSD ≈ 0.7 pips", () => {
    expect(TYPICAL_SPREAD_PIPS.EURUSD).toBeCloseTo(0.7, 1);
    expect(TYPICAL_PRICE_USD.EURUSD).toBeGreaterThan(0);
    expect(PIP_SIZE.EURUSD).toBe(0.0001);
  });
});

describe("DukascopyForexProvider — modo sintético (forceSynthetic)", () => {
  it("1. fetchCandles('EURUSD', '1h', 24) retorna 24 candles em ordem", async () => {
    const provider = new DukascopyForexProvider({ forceSynthetic: true });
    const { candles, source, quality } = await provider.getCandles({
      symbol: "EURUSD",
      timeframe: "1h",
      limit: 24,
    });
    expect(candles.length).toBe(24);
    expect(source).toBe("synthetic");
    expect(quality).toBe("low");
    // Timestamps monotônicos crescentes, espaçados em 1h.
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp).toBeGreaterThan(candles[i - 1]!.timestamp);
      expect(candles[i]!.timestamp - candles[i - 1]!.timestamp).toBe(3_600_000);
    }
    // OHLC integrity.
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(c.open);
      expect(c.high).toBeGreaterThanOrEqual(c.close);
      expect(c.low).toBeLessThanOrEqual(c.open);
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  it("1b. candles sintéticos são determinísticos (mesma seed = mesmos closes)", async () => {
    const p1 = new DukascopyForexProvider({ forceSynthetic: true });
    const p2 = new DukascopyForexProvider({ forceSynthetic: true });
    const a = await p1.getCandles({ symbol: "GBPUSD", timeframe: "1h", limit: 50 });
    const b = await p2.getCandles({ symbol: "GBPUSD", timeframe: "1h", limit: 50 });
    expect(a.candles.map((c) => c.close)).toEqual(b.candles.map((c) => c.close));
    expect(a.candles.map((c) => c.open)).toEqual(b.candles.map((c) => c.open));
  });

  it("2. símbolo não suportado lança erro claro", async () => {
    const provider = new DukascopyForexProvider({ forceSynthetic: true });
    await expect(
      provider.getCandles({ symbol: "XYZABC", timeframe: "1h", limit: 10 }),
    ).rejects.toThrow(/não suportado/i);
    await expect(provider.getTicker("XYZABC")).rejects.toThrow(/não suportado/i);
    await expect(provider.getOrderBook("XYZABC")).rejects.toThrow(/não suportado/i);
  });

  it("4. fetchOrderBook('EURUSD') retorna MarketOrderBook vazio (FX sem L2)", async () => {
    const provider = new DukascopyForexProvider({ forceSynthetic: true });
    const book = await provider.getOrderBook("EURUSD");
    expect(book).not.toBeNull();
    expect(book.symbol).toBe("EURUSD");
    expect(book.provider).toBe("dukascopy");
    expect(book.bids.length).toBe(0);
    expect(book.asks.length).toBe(0);
    expect(book.quality).toBe("unknown");
  });

  it("5. spread típico EURUSD = 0.7 pips (1 pip = 0.0001)", () => {
    // Cálculo: spread típico em USD = pips * pipSize = 0.7 * 0.0001 = 0.00007
    const spreadUsd = TYPICAL_SPREAD_PIPS.EURUSD * PIP_SIZE.EURUSD;
    expect(spreadUsd).toBeCloseTo(0.00007, 6);
    // Anchor de preço plausível (>1 para EURUSD).
    expect(TYPICAL_PRICE_USD.EURUSD).toBeGreaterThan(1);
  });

  it("6. metadata Forex (base/quote) parseado corretamente", async () => {
    const provider = new DukascopyForexProvider({ forceSynthetic: true });
    const meta = await provider.getMarketMetadata("USDJPY");
    expect(meta).not.toBeNull();
    expect(meta!.baseAsset).toBe("USD");
    expect(meta!.quoteAsset).toBe("JPY");
    expect(meta!.market).toBe("forex");
    expect(meta!.provider).toBe("dukascopy");
  });

  it("7. connect em modo sintético vira 'connected' sem rede", async () => {
    const provider = new DukascopyForexProvider({ forceSynthetic: true });
    await provider.connect();
    expect(provider.getStatus()).toBe("connected");
    expect(provider.connectedAt).not.toBeNull();
    provider.disconnect();
    expect(provider.getStatus()).toBe("disconnected");
  });
});

describe("DukascopyForexProvider — modo offline (fetch falha)", () => {
  it("3. fetch falha → expõe indisponibilidade sem fabricar candles", async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const provider = new DukascopyForexProvider({ fetchImpl });
    // connect() vai falhar — esperamos que isso aconteça.
    await expect(provider.connect()).rejects.toThrow(/Forex provider/i);

    // Mesmo com connect falho, o provider não inventa histórico.
    const { candles, source, quality } = await provider.getCandles({
      symbol: "AUDUSD",
      timeframe: "1h",
      limit: 12,
    });
    expect(source).toBe("unavailable");
    expect(quality).toBe("unknown");
    expect(candles).toEqual([]);
  });

  it("3b. HTTP 503 também permanece indisponível", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      }) as Response) as typeof fetch;
    const provider = new DukascopyForexProvider({ fetchImpl });
    await expect(provider.connect()).rejects.toThrow();
    const { source } = await provider.getCandles({ symbol: "USDCAD", timeframe: "1h", limit: 5 });
    expect(source).toBe("unavailable");
  });
});

describe("DukascopyForexProvider — registryV2", () => {
  it("8. resolveProvider('forex') não usa fallback sintético sem OANDA", () => {
    const p = resolveProvider({ marketDataMode: "forex", nodeEnv: "test" });
    expect(p).toBeNull();
  });

  it("8b. resolveProvider('forex') usa OANDA quando configurada", () => {
    const p = resolveProvider({
      marketDataMode: "forex",
      nodeEnv: "test",
      oanda: { apiKey: "test-key", accountId: "test-account", baseUrl: "https://fake.test/v3" },
    });
    expect(p?.id).toBe("oanda");
  });

  it("9. resolveProvider('binance') ainda devolve BinanceProvider (regressão)", () => {
    const p = resolveProvider({ marketDataMode: "binance", nodeEnv: "test" });
    expect(p).not.toBeNull();
    expect(p!.id).toBe("binance");
  });

  it("10. resolveProvider('noop') devolve null", () => {
    const p = resolveProvider({ marketDataMode: "noop", nodeEnv: "test" });
    expect(p).toBeNull();
  });
});

describe("DukascopyForexProvider — interação com console (smoke)", () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
  it("11. modo sintético não imprime warnings de rede", async () => {
    const p = new DukascopyForexProvider({ forceSynthetic: true });
    await p.getCandles({ symbol: "EURUSD", timeframe: "1h", limit: 5 });
    // Sem warning de network.
    const warns = consoleWarn.mock.calls.map((c: readonly unknown[]) => String(c[0])).join(" ");
    expect(warns).not.toMatch(/network/i);
  });
});
