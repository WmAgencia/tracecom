import { describe, expect, it } from "vitest";
import { normalizeKline, normalizeWsKline, normalizeWsTrade, parseSymbol, toTimeframe } from "../../src/market/normalize";

describe("normalize: Binance REST kline", () => {
  it("converte array REST para MarketCandle canônico", () => {
    const raw = [1672515780000, "100.0", "105.0", "99.0", "104.0", "12.5", 1672515839999, "1250", 100, "12", "1200", "0"];
    const c = normalizeKline(raw as never, { provider: "binance", symbol: "BTCUSDT", timeframe: "1m", source: "rest", receivedAt: 1672515840000 });
    expect(c.open).toBe(100);
    expect(c.high).toBe(105);
    expect(c.low).toBe(99);
    expect(c.close).toBe(104);
    expect(c.volume).toBe(12.5);
    expect(c.timestamp).toBe(1672515780000);
    expect(c.provider).toBe("binance");
    expect(c.symbol).toBe("BTCUSDT");
    expect(c.isClosed).toBe(true);
  });
});

describe("normalize: Binance WS kline/trade", () => {
  it("converte payload WS de kline", () => {
    const c = normalizeWsKline(
      { s: "BTCUSDT", k: { t: 1672515780000, o: "100", h: "105", l: "99", c: "104", v: "12", x: true } },
      { provider: "binance", timeframe: "1m", source: "ws:kline", receivedAt: 1672515840000 },
    );
    expect(c.close).toBe(104);
    expect(c.isClosed).toBe(true);
    expect(c.timestamp).toBe(1672515780000);
  });

  it("converte payload WS de trade e infere side honesto", () => {
    const t = normalizeWsTrade(
      { p: "99123.5", q: "0.2", T: 1672515780000, m: true },
      { provider: "binance", symbol: "BTCUSDT", source: "ws:trade", receivedAt: 1672515780001 },
    );
    expect(t.price).toBe(99123.5);
    expect(t.quantity).toBe(0.2);
    expect(t.side).toBe("sell");
  });
});

describe("normalize: símbolos e timeframes", () => {
  it("mapeia timeframe binance para canônico", () => {
    expect(toTimeframe("1m")).toBe("1m");
    expect(toTimeframe("4h")).toBe("4h");
    expect(toTimeframe("1M")).toBeNull();
  });
  it("extrai base/quote", () => {
    expect(parseSymbol("BTCUSDT")).toEqual({ baseAsset: "BTC", quoteAsset: "USDT", market: "crypto" });
    expect(parseSymbol("ETHBTC")).toEqual({ baseAsset: "ETH", quoteAsset: "BTC", market: "crypto" });
  });
});
