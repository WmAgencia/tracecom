/**
 * Bug fix B4 — auditoria de regressão: garantir que `indicators.ema` é calculado
 * com a função EMA exponencial (alpha=2/(period+1), seed=SMA), e NÃO com SMA.
 *
 * Se este teste falhar, alguém trocou `ema(closes, ...)` por `smaFn(closes, ...)`
 * em `src/quant/engine.ts:53` e reintroduziu o bug.
 */
import { describe, expect, it } from "vitest";
import { QuantEngine, DEFAULT_CONFIG } from "../../src/quant/engine";
import type { MarketCandle } from "../../src/market/model";

/** Mulberry32 — PRNG determinístico para candles sintéticos reprodutíveis. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gera candles com tendência (subindo ~step/vela), ruído pequeno. */
function trendingCandles(count: number, start: number, step: number, noise = 0.05): MarketCandle[] {
  const rand = mulberry32(42);
  const out: MarketCandle[] = [];
  let t = Date.parse("2023-01-01T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const close = start + i * step + (rand() - 0.5) * noise;
    out.push({
      provider: "binance", symbol: "TEST", timeframe: "1m",
      open: close - 0.5, high: close + 1, low: close - 1, close,
      volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
    });
    t += 60_000;
  }
  return out;
}

/** Gera candles laterais (random walk pequeno, sem direção dominante). */
function sidewaysCandles(count: number, start: number, amp = 0.3): MarketCandle[] {
  const rand = mulberry32(99);
  const out: MarketCandle[] = [];
  let t = Date.parse("2023-01-01T00:00:00Z");
  let price = start;
  for (let i = 0; i < count; i++) {
    price += (rand() - 0.5) * amp;
    const close = price;
    out.push({
      provider: "binance", symbol: "TEST", timeframe: "1m",
      open: close - 0.25, high: close + 0.5, low: close - 0.5, close,
      volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
    });
    t += 60_000;
  }
  return out;
}

describe("B4: indicators.ema deve ser EMA exponencial, não SMA", () => {
  it("Caso 1: em série com mudança abrupta recente, ema diverge de sma significativamente", () => {
    // Sideways por 70 candles (preço ~100), depois 30 candles caindo para 80.
    // A EMA deve reagir mais rápido à queda recente; o SMA carrega mais
    // memória do passado plano. Se `smaFn === ema`, ambas seriam idênticas.
    const candles: MarketCandle[] = [];
    let t = Date.parse("2023-01-01T00:00:00Z");
    // 70 candles flat em 100
    for (let i = 0; i < 70; i++) {
      candles.push({
        provider: "binance", symbol: "TEST", timeframe: "1m",
        open: 100, high: 100.5, low: 99.5, close: 100,
        volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
      });
      t += 60_000;
    }
    // 30 candles caindo linearmente para 80
    for (let i = 0; i < 30; i++) {
      const close = 100 - (i + 1) * (20 / 30);
      candles.push({
        provider: "binance", symbol: "TEST", timeframe: "1m",
        open: close + 0.5, high: close + 1, low: close - 1, close,
        volume: 10, timestamp: t, receivedAt: t + 1, isClosed: true, source: "test", quality: "high",
      });
      t += 60_000;
    }
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const ind = eng.computeIndicators(candles);

    const idx = ind.ema.length - 1;
    const emaVal = ind.ema[idx]!;
    const smaVal = ind.sma[idx]!;
    expect(emaVal).not.toBeNull();
    expect(smaVal).not.toBeNull();

    // EMA deve estar abaixo da SMA (reagiu à queda); SMA ainda puxa para 100.
    expect(emaVal).toBeLessThan(smaVal);
    // Diferença mensurável — se fossem idênticas (bug B4) seria exatamente 0.
    expect(Math.abs(smaVal - emaVal)).toBeGreaterThan(0.1);
  });

  it("Caso 2: em candles laterais, ema[50] ≈ sma[50] mas NÃO idênticos pixel a pixel", () => {
    const candles = sidewaysCandles(120, 100, 0.3);
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const ind = eng.computeIndicators(candles);

    const idx = 50;
    const emaVal = ind.ema[idx]!;
    const smaVal = ind.sma[idx]!;
    expect(emaVal).not.toBeNull();
    expect(smaVal).not.toBeNull();

    // Próximos, mas não idênticos — guarda contra o bug `smaFn === ema`.
    expect(Math.abs(emaVal - smaVal)).toBeLessThan(0.5);
    expect(emaVal).not.toBe(smaVal);
  });

  it("Caso 3: séries ema e sma retornam valores diferentes em input não-trivial", () => {
    // Em tendência clara, SMA e EMA devem divergir ao longo da série.
    const candles = trendingCandles(100, 100, 0.5, 0.05);
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const ind = eng.computeIndicators(candles);

    let diffs = 0;
    let total = 0;
    for (let i = 0; i < ind.ema.length; i++) {
      const e = ind.ema[i];
      const s = ind.sma[i];
      if (e != null && s != null) {
        total++;
        if (Math.abs(e - s) > 1e-9) diffs++;
      }
    }
    expect(total).toBeGreaterThan(20);
    // Pelo menos 80% dos pontos válidos divergem — se for 0, é SMA dentro do EMA.
    expect(diffs / total).toBeGreaterThan(0.8);
  });

  it("sanidade: quantidade de candles não muda assinatura de computeIndicators", () => {
    const candles = trendingCandles(80, 100, 0.5);
    const eng = new QuantEngine(DEFAULT_CONFIG);
    const ind = eng.computeIndicators(candles);
    expect(ind.candleCount).toBe(80);
    expect(ind.sma).toHaveLength(80);
    expect(ind.ema).toHaveLength(80);
  });
});
