import { describe, expect, it } from "vitest";
import { DataQualityEngine, detectGaps } from "../../src/market/quality";
import type { MarketCandle } from "../../src/market/model";

function c(ts: number, o = 100, h = 105, l = 98, cl = 103, v = 10, since = ts): MarketCandle {
  return {
    provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
    open: o, high: h, low: l, close: cl, volume: v, timestamp: ts,
    receivedAt: since + 1_000, isClosed: true, source: "rest", quality: "high",
  };
}

describe("DataQualityEngine", () => {
  const eng = new DataQualityEngine({ staleAfterMs: 300_000, delayedAfterMs: 120_000 });

  it("aceita candle válido", () => {
    const now = Date.now();
    const r = eng.validateCandle({ candle: c(now - 60_000, 100, 105, 98, 103, 10, now - 60_000), now });
    expect(r.valid).toBe(true);
    expect(r.quality).toBe("high");
  });

  it("rejeita NaN/Infinity (nunca fabrica)", () => {
    const now = Date.now();
    expect(eng.validateCandle({ candle: c(now - 10_000, Number.NaN), now }).valid).toBe(false);
    expect(eng.validateCandle({ candle: c(now - 10_000, Infinity), now }).valid).toBe(false);
  });

  it("rejeita preço <= 0 e high < low", () => {
    const now = Date.now();
    expect(eng.validateCandle({ candle: c(now - 10_000, -10), now }).valid).toBe(false);
    expect(eng.validateCandle({ candle: c(now - 10_000, 100, 95, 100, 103), now }).valid).toBe(false);
  });

  it("detecta gap em relação ao anterior", () => {
    const now = Date.now();
    const t0 = now - 120_000;
    const prev = c(t0 - 3 * 60_000); // pulou 2 minutos → gap
    const r = eng.validateCandle({ candle: c(t0), now, prev });
    expect(r.gapDetected).toBe(true);
    expect(r.quality).toBe("medium");
  });

  it("detecta candle atrasado (stale)", () => {
    const now = Date.now();
    const ts = now - 400_000; // janela 1m antiga
    const r = eng.validateCandle({ candle: c(ts - 60_000, 100, 105, 98, 103, 10, now), now });
    expect(r.stale).toBe(true);
  });
});

describe("detectGaps", () => {
  it("detecta lacunas de timeframes ausentes", () => {
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const a = c(t0, 0, 0, 0, 0, 0);
    const b = c(t0 + 60_000, 0, 0, 0, 0, 0);
    const d = c(t0 + 3 * 60_000, 0, 0, 0, 0, 0); // faltou o de 2m
    const gaps = detectGaps([a, b, d]);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.from).toBe(t0 + 2 * 60_000);
    expect(gaps[0]!.to).toBe(t0 + 3 * 60_000);
  });
});
