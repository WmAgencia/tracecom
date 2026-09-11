/**
 * Testes Round 6: Forex Data Layer.
 *
 * Cobre:
 *  1. Abstrações: ForexPair, Quote, MarketTick
 *  2. parseForexPair
 *  3. spreadPips
 *  4. validateQuote (FRESH/STALE/INVALID/UNKNOWN)
 *  5. sessionAt + sessionPhaseAt
 *  6. OandaForexProvider formatters (pairToOanda, timeframeToOanda, msToRfc3339)
 *  7. OandaForexProvider fetchQuote/fetchCandles/health (com mock fetch)
 *  8. MockForexProvider determinístico
 *  9. ForexMarketScanner runOnce
 * 10. Scanner graceful degradation quando provider falha
 * 11. ForexCandle OHLC integrity (high >= max(open,close), low <= min)
 * 12. Quote bid/ask validation
 * 13. Não inventa dados quando provider offline
 */
import { describe, it, expect } from "vitest";
import {
  parseForexPair, validateQuote, computeSpreadPips,
  DEFAULT_FOREX_UNIVERSE, FOREX_TIMEFRAMES,
  sessionAt, sessionPhaseAt, msToRfc3339,
} from "../../src/market/forex/types";
import type { ForexPair, Quote } from "../../src/market/forex/types";
import {
  pairToOanda, timeframeToOanda, oandaToTimeframe,
  OandaForexProvider, MockForexProvider, createOandaProvider, createMockProvider,
} from "../../src/market/forex/oanda-provider";
import { ForexMarketScanner } from "../../src/market/forex/scanner";

describe("Round 6 — Forex abstractions", () => {
  it("1. parseForexPair parseia EUR/USD", () => {
    const p = parseForexPair("EUR/USD");
    expect(p).not.toBeNull();
    expect(p!.canonical).toBe("EUR/USD");
    expect(p!.base).toBe("EUR");
    expect(p!.quote).toBe("USD");
    expect(p!.pricePrecision).toBe(5);
    expect(p!.pipSize).toBeCloseTo(0.0001);
    expect(p!.standardLotSize).toBe(100_000);
    expect(p!.isExotic).toBe(false);
  });

  it("2. parseForexPair parseia USD/JPY com precision=3", () => {
    const p = parseForexPair("USD/JPY");
    expect(p).not.toBeNull();
    expect(p!.pricePrecision).toBe(3);
    expect(p!.pipSize).toBeCloseTo(0.01);
  });

  it("3. parseForexPair parseia XAU/USD com precision=2", () => {
    const p = parseForexPair("XAU/USD");
    expect(p!.pricePrecision).toBe(2);
    expect(p!.pipSize).toBeCloseTo(0.01);
    expect(p!.standardLotSize).toBe(100);
  });

  it("4. parseForexPair rejeita entrada inválida", () => {
    expect(parseForexPair("EUR")).toBeNull();
    expect(parseForexPair("EUR/USD/USD")).toBeNull();
    expect(parseForexPair("")).toBeNull();
  });

  it("5. computeSpreadPips calcula corretamente", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0800, ask: 1.0802, spread: 0.0002,
      spreadPips: 0, mid: 1.0801, timestamp: Date.now(), venue: "test",
      pipSize: 0.0001,
    };
    // spread 0.0002 / pipSize 0.0001 = 2 pips
    expect(computeSpreadPips(q)).toBe(2);
  });

  it("6. DEFAULT_FOREX_UNIVERSE tem 12 pares", () => {
    expect(DEFAULT_FOREX_UNIVERSE.length).toBe(12);
    const eurUsd = DEFAULT_FOREX_UNIVERSE.find((p) => p.canonical === "EUR/USD");
    expect(eurUsd).toBeDefined();
    const xauUsd = DEFAULT_FOREX_UNIVERSE.find((p) => p.canonical === "XAU/USD");
    expect(xauUsd).toBeDefined();
  });

  it("7. FOREX_TIMEFRAMES cobre M1..D1", () => {
    expect(FOREX_TIMEFRAMES).toContain("1m");
    expect(FOREX_TIMEFRAMES).toContain("4h");
    expect(FOREX_TIMEFRAMES).toContain("1d");
    expect(FOREX_TIMEFRAMES.length).toBe(7);
  });
});

describe("Round 6 — Validation", () => {
  const EUR_USD: ForexPair = parseForexPair("EUR/USD")!;
  const now = Date.now();

  it("8. validateQuote retorna FRESH para quote recente", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0800, ask: 1.0802, spread: 0.0002,
      spreadPips: 20, mid: 1.0801, timestamp: now - 5_000, venue: "test",
    };
    const v = validateQuote(q, now, EUR_USD);
    expect(v.status).toBe("FRESH");
    expect(v.reasonCodes).toEqual([]);
    expect(v.stalenessMs).toBe(5_000);
  });

  it("9. validateQuote retorna STALE para quote > 30s", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0800, ask: 1.0802, spread: 0.0002,
      spreadPips: 20, mid: 1.0801, timestamp: now - 60_000, venue: "test",
    };
    const v = validateQuote(q, now, EUR_USD);
    expect(v.status).toBe("STALE");
  });

  it("10. validateQuote retorna INVALID para ASK_LT_BID", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0802, ask: 1.0800, spread: -0.0002, // ask < bid
      spreadPips: -20, mid: 1.0801, timestamp: now, venue: "test",
    };
    const v = validateQuote(q, now, EUR_USD);
    expect(v.status).toBe("INVALID");
    expect(v.reasonCodes).toContain("ASK_LT_BID");
  });

  it("11. validateQuote retorna INVALID para FUTURE_TIMESTAMP", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0800, ask: 1.0802, spread: 0.0002,
      spreadPips: 20, mid: 1.0801, timestamp: now + 90_000, venue: "test",
      pipSize: 0.00001,
    };
    const v = validateQuote(q, now, EUR_USD);
    expect(v.status).toBe("INVALID");
    expect(v.reasonCodes).toContain("FUTURE_TIMESTAMP");
  });

  it("12. validateQuote retorna INVALID para ABNORMAL_SPREAD", () => {
    const q: Quote = {
      symbol: "EUR/USD", bid: 1.0000, ask: 1.0500, // 5% spread — anormal
      spread: 0.05, spreadPips: 5000, mid: 1.025, timestamp: now, venue: "test",
    };
    const v = validateQuote(q, now, EUR_USD);
    expect(v.status).toBe("INVALID");
    expect(v.reasonCodes).toContain("ABNORMAL_SPREAD");
  });

  it("13. validateQuote retorna UNKNOWN se quote=null", () => {
    const v = validateQuote(null, now, EUR_USD);
    expect(v.status).toBe("UNKNOWN");
    expect(v.reasonCodes).toContain("NO_QUOTE");
  });
});

describe("Round 6 — Sessions", () => {
  it("14. sessionAt identifica Asia/London/NY/Overlap/Rollover", () => {
    // 02:00 UTC = Asia
    expect(sessionAt(Date.UTC(2024, 0, 15, 2, 0, 0))).toBe("ASIA");
    // 10:00 UTC = London
    expect(sessionAt(Date.UTC(2024, 0, 15, 10, 0, 0))).toBe("LONDON");
    // 14:00 UTC = Overlap
    expect(sessionAt(Date.UTC(2024, 0, 15, 14, 0, 0))).toBe("OVERLAP_LONDON_NY");
    // 18:00 UTC = NY
    expect(sessionAt(Date.UTC(2024, 0, 15, 18, 0, 0))).toBe("NEW_YORK");
    // 23:00 UTC = Rollover
    expect(sessionAt(Date.UTC(2024, 0, 15, 23, 0, 0))).toBe("ROLLOVER");
    // Sábado = ASIA residual (não tem where no forex)
    expect(sessionAt(Date.UTC(2024, 0, 13, 12, 0, 0))).toBe("ASIA"); // Sat noon
  });

  it("15. sessionPhaseAt retorna fase OPENING/MID/CLOSING", () => {
    const tsLondonOpening = Date.UTC(2024, 0, 15, 8, 0, 0);
    expect(sessionPhaseAt(tsLondonOpening, "LONDON")).toBe("OPENING");
    const tsLondonMid = Date.UTC(2024, 0, 15, 10, 0, 0);
    expect(sessionPhaseAt(tsLondonMid, "LONDON")).toBe("MID");
    const tsLondonClosing = Date.UTC(2024, 0, 15, 12, 30, 0);
    expect(sessionPhaseAt(tsLondonClosing, "LONDON")).toBe("CLOSING");
    expect(sessionPhaseAt(tsLondonMid, "ROLLOVER")).toBe("CLOSED");
  });
});

describe("Round 6 — OandaForexProvider formatters", () => {
  it("16. pairToOanda converte EUR/USD → EUR_USD", () => {
    const p = parseForexPair("EUR/USD")!;
    expect(pairToOanda(p)).toBe("EUR_USD");
  });

  it("17. timeframeToOanda mapeia 1m → M1, 4h → H4, 1d → D", () => {
    expect(timeframeToOanda("1m")).toBe("M1");
    expect(timeframeToOanda("4h")).toBe("H4");
    expect(timeframeToOanda("1d")).toBe("D");
    expect(oandaToTimeframe("M1")).toBe("1m");
    expect(oandaToTimeframe("H4")).toBe("4h");
  });

  it("18. msToRfc3339 formata ISO com precisão nanossegundos", () => {
    const ts = Date.UTC(2024, 0, 15, 14, 30, 0);
    const rfc = msToRfc3339(ts);
    expect(rfc).toMatch(/^2024-01-15T14:30:00\.000Z$/);
  });
});

describe("Round 6 — MockForexProvider", () => {
  it("19. MockForexProvider.fetchQuote retorna quote determinístico", async () => {
    const p = new MockForexProvider();
    const q = await p.fetchQuote(parseForexPair("EUR/USD")!);
    expect(q.symbol).toBe("EUR/USD");
    expect(q.bid).toBeGreaterThan(0);
    expect(q.ask).toBeGreaterThan(q.bid);
    expect(q.timestamp).toBeGreaterThan(0);
    expect(q.venue).toBe("mock");
  });

  it("20. MockForexProvider.fetchCandles retorna candles ordenados", async () => {
    const p = new MockForexProvider();
    const start = Date.now() - 3_600_000;
    const end = Date.now();
    const candles = await p.fetchCandles(parseForexPair("EUR/USD")!, "1m", start, end);
    expect(candles.length).toBeGreaterThan(0);
    // OHLC integrity
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
    // Ordem temporal
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp).toBeGreaterThanOrEqual(candles[i - 1]!.timestamp);
    }
  });

  it("21. MockForexProvider.health sempre ok", async () => {
    const p = new MockForexProvider();
    const h = await p.health();
    expect(h.ok).toBe(true);
    expect(h.errorMessage).toBeNull();
  });
});

describe("Round 6 — OandaForexProvider (mocked fetch)", () => {
  function mockFetch(json: unknown, status = 200): typeof fetch {
    return (async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    })) as unknown as typeof fetch;
  }

  it("22. OandaForexProvider.fetchQuote parseia corretamente", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      prices: [{
        type: "PRICE",
        time: "2024-01-15T14:30:00.000000000Z",
        bids: [{ price: "1.0800", liquidity: 100 }],
        asks: [{ price: "1.0802", liquidity: 100 }],
        closeoutBid: "1.0800",
        closeoutAsk: "1.0802",
        status: "tradeable",
        instrument: "EUR_USD",
      }],
    }) as typeof fetch;
    try {
      const p = new OandaForexProvider({ apiKey: "fake", accountId: "demo", baseUrl: "https://fake.test/v3" });
      const q = await p.fetchQuote(parseForexPair("EUR/USD")!);
      expect(q.bid).toBeCloseTo(1.08);
      expect(q.ask).toBeCloseTo(1.0802);
      expect(q.mid).toBeCloseTo(1.0801);
      expect(q.venue).toBe("oanda");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("23. OandaForexProvider.fetchCandles parseia corretamente", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      instrument: "EUR_USD",
      granularity: "H1",
      candles: [
        { time: "2024-01-15T13:00:00.000000000Z", mid: { o: "1.080", h: "1.082", l: "1.078", c: "1.081" }, volume: 1000, complete: true },
        { time: "2024-01-15T14:00:00.000000000Z", mid: { o: "1.081", h: "1.083", l: "1.080", c: "1.082" }, volume: 1500, complete: true },
      ],
    }) as typeof fetch;
    try {
      const p = new OandaForexProvider({ apiKey: "fake", accountId: "demo", baseUrl: "https://fake.test/v3" });
      const candles = await p.fetchCandles(parseForexPair("EUR/USD")!, "1h", 0, Date.now());
      expect(candles.length).toBe(2);
      expect(candles[0]!.open).toBeCloseTo(1.080);
      expect(candles[1]!.close).toBeCloseTo(1.082);
      expect(candles[0]!.quality).toBe("high");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("24. OandaForexProvider.health captura erro de fetch", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      const p = new OandaForexProvider({ apiKey: "fake", accountId: "demo", baseUrl: "https://fake.test/v3" });
      const h = await p.health();
      expect(h.ok).toBe(false);
      expect(h.errorMessage).toContain("network down");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("25. createOandaProvider factory funciona", () => {
    const p = createOandaProvider({ apiKey: "x", accountId: "demo" });
    expect(p.id).toBe("oanda");
  });
});

describe("Round 6 — ForexMarketScanner", () => {
  it("26. runOnce itera sobre todos os pares da universe", async () => {
    const scanner = new ForexMarketScanner({
      provider: new MockForexProvider(),
      universe: ["EUR/USD", "GBP/USD", "USD/JPY"],
    });
    const results = await scanner.runOnce();
    expect(results.length).toBe(3);
    expect(results.map((r) => r.pair.canonical)).toEqual(["EUR/USD", "GBP/USD", "USD/JPY"]);
  });

  it("27. graceful degradation: par com erro → STALE/UNKNOWN", async () => {
    const flakyProvider = {
      id: "flaky",
      displayName: "Flaky",
      async fetchQuote(pair: ForexPair) {
        if (pair.canonical === "EUR/USD") throw new Error("timeout");
        return {
          symbol: pair.canonical, bid: 1, ask: 1.0002, spread: 0.0002,
          spreadPips: 20, mid: 1.0001, timestamp: Date.now(), venue: "flaky",
        };
      },
      async fetchCandles() { return []; },
      async health() { return { ok: true, latencyMs: 1, lastCheck: Date.now(), errorMessage: null }; },
    };
    const scanner = new ForexMarketScanner({
      provider: flakyProvider as any,
      universe: ["EUR/USD", "GBP/USD"],
    });
    const results = await scanner.runOnce();
    expect(results.length).toBe(2);
    expect(results[0]!.snapshot.freshness.status).toBe("UNKNOWN");
    expect(results[0]!.snapshot.freshness.reasonCodes).toContain("PROVIDER_ERROR");
    expect(results[1]!.snapshot.freshness.status).toBe("FRESH"); // GBP/USD funciona
  });

  it("28. Scanner retorna candles em OHLC ordenado", async () => {
    const scanner = new ForexMarketScanner({
      provider: new MockForexProvider(),
      universe: ["EUR/USD"],
      timeframe: "1h",
      candleWindow: 10,
    });
    const results = await scanner.runOnce();
    expect(results.length).toBe(1);
    expect(results[0]!.candles.length).toBeGreaterThan(0);
    for (const c of results[0]!.candles) {
      expect(c.high).toBeGreaterThanOrEqual(c.open);
      expect(c.high).toBeGreaterThanOrEqual(c.close);
      expect(c.low).toBeLessThanOrEqual(c.open);
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  it("29. Scanner getLastRun registra última execução", async () => {
    const scanner = new ForexMarketScanner({
      provider: new MockForexProvider(),
      universe: ["EUR/USD"],
    });
    expect(scanner.getLastRun().at).toBe(0);
    await scanner.runOnce();
    expect(scanner.getLastRun().at).toBeGreaterThan(0);
  });

  it("30. Scanner usa universe DEFAULT quando não passa universe", () => {
    const scanner = new ForexMarketScanner({ provider: new MockForexProvider() });
    expect(scanner.getUniverse().length).toBe(12);
  });

  it("31. Scanner filtra pares inválidos da universe", () => {
    const scanner = new ForexMarketScanner({
      provider: new MockForexProvider(),
      universe: ["EUR/USD", "INVALID/INVALID/INVALID", "GBP/USD"],
    });
    expect(scanner.getUniverse().length).toBe(2);
  });

  it("32. Scanner inclui session e sessionPhase em cada snapshot", async () => {
    const scanner = new ForexMarketScanner({
      provider: new MockForexProvider(),
      universe: ["EUR/USD"],
    });
    const results = await scanner.runOnce();
    expect(results[0]!.snapshot.session).toMatch(/ASIA|LONDON|OVERLAP_LONDON_NY|NEW_YORK|ROLLOVER/);
    expect(["OPENING", "MID", "CLOSING", "CLOSED"]).toContain(results[0]!.snapshot.sessionPhase);
  });

  it("33. health do Scanner retorna health do provider", async () => {
    const scanner = new ForexMarketScanner({ provider: new MockForexProvider() });
    const h = await scanner.health();
    expect(h.ok).toBe(true);
  });

  it("34. Scanner expõe ranking de prontidão e métricas observadas, sem probabilidade inventada", async () => {
    const scanner = new ForexMarketScanner({ provider: new MockForexProvider(), universe: ["EUR/USD"] });
    const result = (await scanner.runOnce())[0]!;
    expect(result.analysis.rank).toBe(1);
    expect(result.analysis.readinessScore).toBeGreaterThan(0);
    expect(result.analysis.spreadPips).not.toBeNull();
    expect(result.analysis.candleCount).toBe(result.candles.length);
    expect(result.analysis.trend).toMatch(/up|down|flat|unknown/);
  });
});
