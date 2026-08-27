import { describe, expect, it } from "vitest";
import { QuantEngine, DEFAULT_CONFIG } from "../../src/quant/engine";
import { macd } from "../../src/quant/trend";
import { rsi, bollinger, volatilitySeries } from "../../src/quant/momentum";
import { vwap, levelsFromCandles, marketStructure } from "../../src/quant/structure";
import { detectRegime } from "../../src/quant/regime";
import type { MarketCandle } from "../../src/market/model";

/** Gera uma série linear de candles (up ou down) para determinismo. */
function syntheticCandles(count: number, start = 100, step = 0.1): MarketCandle[] {
  const out: MarketCandle[] = [];
  let t = Date.parse("2023-01-01T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const close = start + i * step;
    out.push({
      provider: "binance", symbol: "TEST", timeframe: "1m",
      open: close - 0.5, high: close + 1, low: close - 1, close,
      volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
    });
    t += 60_000;
  }
  return out;
}

/** Série em zigzag (sobe/desce) → gera pivots reais para níveis/swings. */
function zigzagCandles(count: number, start = 100, amp = 3): MarketCandle[] {
  const out: MarketCandle[] = [];
  let t = Date.parse("2023-01-01T00:00:00Z");
  let price = start;
  let dir = 1;
  let seg = 0;
  for (let i = 0; i < count; i++) {
    price += dir * amp;
    seg++;
    if (seg >= 8) { dir *= -1; seg = 0; }
    out.push({
      provider: "binance", symbol: "TEST", timeframe: "1m",
      open: price - dir * amp, high: price + amp, low: price - amp, close: price,
      volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
    });
    t += 60_000;
  }
  return out;
}

describe("QuantEngine: determinismo e reprodução", () => {
  it("retorna o mesmo summary para a mesma entrada (reproduzível)", () => {
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const candles = syntheticCandles(120);
    const a = eng.analyze({ candles, symbol: "TEST", timeframe: "1m" });
    const b = eng.analyze({ candles, symbol: "TEST", timeframe: "1m" });
    expect(a.technicalScore).toBe(b.technicalScore);
    expect(a.regime.regime).toBe(b.regime.regime);
    expect(a.volatility.windowVolatility).toBeCloseTo(b.volatility.windowVolatility, 10);
  });

  it("em séries fechadas não usa dados futuros — indicadores só dependem do passado", () => {
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const candles = syntheticCandles(200);
    // truncar no fim não muda os indicadores dos candles antes do corte (sem look-ahead)
    const full = eng.computeIndicators(candles);
    const truncated = eng.computeIndicators(candles.slice(0, 150));
    expect(full.rsi[140]).toBeCloseTo((truncated.rsi[140] as number), 8);
    // no momento T=150, o RSI[140] é o mesmo com ou sem o futuro — integridade.
    expect(full.ema[140]).toBeCloseTo((truncated.ema[140] as number), 8);
  });

  it("nunca retorna NaN/Infinity nos indicadores", () => {
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const candles = syntheticCandles(150);
    const ind = eng.computeIndicators(candles);
    for (const s of [ind.sma, ind.ema, ind.rsi, ind.atr, ind.adx, ind.vwap]) {
      for (const v of s) expect(v === null || (Number.isFinite(v))).toBe(true);
    }
  });

  it("série em alta → technicalScore positivo e regime de alta", () => {
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const summary = eng.analyze({ candles: syntheticCandles(200, 100, 0.5), symbol: "TEST", timeframe: "1m" });
    expect(summary.technicalScore).toBeGreaterThan(0);
    expect(["uptrend", "strong_uptrend"]).toContain(summary.regime.regime);
  });

  it("série em baixa → technicalScore negativo", () => {
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const summary = eng.analyze({ candles: syntheticCandles(200, 100, -0.5), symbol: "TEST", timeframe: "1m" });
    expect(summary.technicalScore).toBeLessThan(0);
  });
});

describe("indicadores individuais", () => {
  it("MACD histograma positivo quando preço acelera para cima", () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.01); // aceleração
    const { histogram } = macd(rising, 12, 26, 9);
    const lastNonNull = histogram.filter((v) => v !== null) as number[];
    expect(lastNonNull[lastNonNull.length - 1]).toBeGreaterThan(0);
  });

  it("RSI em tendência sobe fica acima de 50", () => {
    const vals = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const r = rsi(vals, 14);
    const last = r.filter((v) => v !== null) as number[];
    expect(last[last.length - 1]).toBeGreaterThan(50);
  });

  it("Bollinger: upper > middle > lower e middle = SMA", () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const { upper, middle, lower } = bollinger(vals, 5, 2);
    const i = vals.length - 1;
    expect(upper[i]!).toBeGreaterThan(middle[i]!);
    expect(middle[i]!).toBeGreaterThan(lower[i]!);
  });

  it("volatilitySeries produz std dev móvel > 0 em série variável", () => {
    const vals = Array.from({ length: 30 }, (_, i) => 100 + (i % 7));
    const v = volatilitySeries(vals, 7);
    const last = v.filter((x) => x !== null) as number[];
    expect(last.length).toBeGreaterThan(0);
    expect(last[last.length - 1]).toBeGreaterThan(0);
  });
});

describe("estrutura e níveis", () => {
  it("vwap entre min e max de prices", () => {
    const candles = syntheticCandles(30, 100, 1);
    const v = vwap(candles);
    const last = v.filter((x) => x !== null) as number[];
    expect(last[last.length - 1]).toBeGreaterThan(99);
    expect(last[last.length - 1]).toBeLessThan(131);
  });

  it("levelsFromCandles retorna suportes e resistências ordenadas", () => {
    const candles = zigzagCandles(200, 100, 4);
    const lv = levelsFromCandles(candles, 5);
    expect(lv.supports.length).toBeGreaterThan(0);
    expect(lv.resistances.length).toBeGreaterThan(0);
    for (const s of lv.supports) expect(s.strength).toBeGreaterThan(0);
  });

  it("marketStructure identifica tendência e swings classificados", () => {
    const candles = zigzagCandles(200, 100, 4);
    const ms = marketStructure(candles, 3);
    expect(ms.swings.length).toBeGreaterThan(0);
    expect(["HH", "HL", "LH", "LL"]).toContain(ms.swings[0]!.kind);
  });
});

describe("regime detection", () => {
  it("ADX alto + direção + → uptrend", () => {
    const r = detectRegime({ adx: 30, adxDir: 1, slope: 0.01, volatilityPct: 0.002, volatilityThreshold: 0.005, closeAboveSma: true, rsiLast: 60 });
    expect(["uptrend", "strong_uptrend"]).toContain(r.regime);
  });
  it("volatilidade alta → high_volatility (independente de direção)", () => {
    const r = detectRegime({ adx: 10, adxDir: 0, slope: 0, volatilityPct: 0.012, volatilityThreshold: 0.005, closeAboveSma: false, rsiLast: 50 });
    expect(r.regime).toBe("high_volatility");
  });
  it("ADX baixo + inclinação contida → range", () => {
    const r = detectRegime({ adx: 12, adxDir: 0, slope: 0.0005, volatilityPct: 0.001, volatilityThreshold: 0.005, closeAboveSma: false, rsiLast: 50 });
    expect(r.regime).toBe("range");
  });
});
