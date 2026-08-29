/**
 * Regression tests — CAMADA 5 (Validação).
 *
 * Estes testes exercitam o pipeline completo (QuantEngine + Backtester +
 * FusionService) com candles sintéticos de regimes conhecidos, para garantir
 * que o motor NUNCA invente sinais em condições de incerteza e que produza
 * sinais coerentes com o regime detectado quando há dados suficientes.
 *
 * Princípios verificados:
 *   1. Dados insuficientes (<30 candles) → WAIT + dataSufficient=false.
 *   2. Regime volátil → WAIT ou risco alto (nunca BUY/SELL silencioso).
 *   3. Range lateral → WAIT (sem direção).
 *   4. Breakout bullish clássico → pode dar BUY, ou WAIT com confluência.
 *      Nunca SELL espúrio.
 *   5. Breakdown confirmado → pode dar SELL, ou WAIT consistente.
 *      Nunca BUY espúrio.
 */
import { describe, expect, it } from "vitest";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester } from "../../src/backtest/backtest";
import { FusionService } from "../../src/fusion/service";
import type { CandleHistorySource, CandleHistoryQuery } from "../../src/backtest/types";
import type { MarketCandle, Timeframe } from "../../src/market/model";

// ---------------------------------------------------------------------------
// Geradores de candles sintéticos
// ---------------------------------------------------------------------------

function mkCandle(ts: number, close: number, opts?: { vol?: number }): MarketCandle {
  const vol = opts?.vol ?? 0.005; // ±0.5% intra-candle
  return {
    provider: "test",
    symbol: "BTCUSDT",
    timeframe: "1h",
    open: close * (1 - vol * 0.1),
    high: close * (1 + vol),
    low: close * (1 - vol),
    close,
    volume: 1000,
    timestamp: ts,
    receivedAt: ts + 1,
    isClosed: true,
    source: "test",
    quality: "high",
  };
}

/** Breakout bullish clássico: SMA20 ascendente, RSI saindo de oversold,
 *  MACD cruzando alta. ~80 candles com drift positivo de +0.8% por candle. */
function breakoutBullishCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    // Fase inicial lateral (20 candles) → depois breakout
    if (i < 20) {
      price = 100 + Math.sin(i / 2) * 0.5;
    } else {
      // Crescimento consistente ~0.8% por candle
      price = price * 1.008;
    }
    out.push(mkCandle(start + i * 3_600_000, price));
  }
  return out;
}

/** Breakdown confirmado: SMA20 descendente, RSI caindo de sobrecompra.
 *  ~80 candles com drift negativo de -0.7% por candle após fase inicial. */
function breakdownBearishCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    if (i < 20) {
      price = 100 + Math.cos(i / 2) * 0.5;
    } else {
      price = price * 0.993;
    }
    out.push(mkCandle(start + i * 3_600_000, price));
  }
  return out;
}

/** Range lateral apertado: preços oscilando ±1% em torno de 100.
 *  RSI neutro, MACD ~zero. */
function rangeCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    // Oscilação senoidal apertada
    price = 100 + Math.sin(i / 3) * 1.0;
    out.push(mkCandle(start + i * 3_600_000, price));
  }
  return out;
}

/** Regime volátil: candles com variações grandes e aleatórias.
 *  ATR% alto, gera regime high_volatility. */
function volatileCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    // Saltos grandes de ±3% por candle
    const drift = (Math.sin(i * 0.7) + Math.cos(i * 1.3)) * 0.03;
    price = price * (1 + drift);
    out.push(mkCandle(start + i * 3_600_000, price, { vol: 0.05 }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: monta FusionService mínimo com mock historySource
// ---------------------------------------------------------------------------

function makeService(candles: MarketCandle[]) {
  const tf: Timeframe = "1h";
  const historySource: CandleHistorySource = {
    async getCandles(_q: CandleHistoryQuery): Promise<MarketCandle[]> {
      return candles;
    },
  };
  const quant = new QuantEngine();
  const backtester = new Backtester();
  const currentCandles = (_s: string, _t: Timeframe) => candles;
  const svc = new FusionService({
    quant,
    backtester,
    historySource,
    currentCandles,
  });
  return svc;
}

// ---------------------------------------------------------------------------
// Testes de regressão
// ---------------------------------------------------------------------------

describe("Fusion regression — CAMADA 5", () => {
  it("breakout bullish clássico: nunca inventa SELL", async () => {
    const candles = breakoutBullishCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    // Invariante: o motor NUNCA deve dar SELL em condição bullish clara
    expect(r.decision).not.toBe("SELL");
    // Pode dar BUY ou WAIT (com confluência) — ambos válidos.
    expect(["BUY", "WAIT"]).toContain(r.decision);
    // Se for BUY, direção consistente com up
    if (r.decision === "BUY") {
      expect(r.direction).toBe("up");
    }
  });

  it("breakdown confirmado: nunca inventa BUY", async () => {
    const candles = breakdownBearishCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "down",
      horizon: 5,
    });
    // Invariante: o motor NUNCA deve dar BUY em condição bearish clara
    expect(r.decision).not.toBe("BUY");
    // Pode dar SELL ou WAIT — ambos válidos.
    expect(["SELL", "WAIT"]).toContain(r.decision);
    if (r.decision === "SELL") {
      expect(r.direction).toBe("down");
    }
  });

  it("range sem direção: WAIT (sem alucinar)", async () => {
    const candles = rangeCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    // Em range lateral, decisão não pode ser direcional BUY/SELL sem evidência
    // forte. Aceitamos WAIT como decisão primária.
    expect(r.decision).toBe("WAIT");
    expect(r.direction).toBeNull();
  });

  it("dados insuficientes (<30 candles): WAIT + dataSufficient=false", async () => {
    const candles = breakoutBullishCandles(20);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    // Invariante crítica: nunca BUY/SELL com < 30 candles
    expect(r.decision).toBe("WAIT");
    expect(r.dataSufficient).toBe(false);
    expect(r.direction).toBeNull();
    // Justificativa deve mencionar insuficiência
    expect(r.rationale.toLowerCase()).toMatch(/insuficiente|dados/);
  });

  it("regime volátil: WAIT ou risco alto, nunca BUY/SELL silencioso", async () => {
    const candles = volatileCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    // Em regime volátil:
    //  - WAIT é a resposta esperada
    //  - se houver decisão direcional, risco DEVE ser "high"
    if (r.decision !== "WAIT") {
      expect(r.risk.level).toBe("high");
    } else {
      // WAIT é perfeitamente válido em volatilidade extrema
      expect(r.decision).toBe("WAIT");
    }
    // O regime deve estar marcado como volátil
    const highVolatility = r.factors.counter.some((f) =>
      f.text.toLowerCase().includes("volatilidade") ||
      f.text.toLowerCase().includes("volatility")
    );
    expect(highVolatility || r.regime === "high_volatility").toBe(true);
  });

  it("campos do FusionResult permanecem consistentes em qualquer regime", async () => {
    // Sanity: dados suficientes → dataSufficient=true + estrutura completa
    const candles = breakoutBullishCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    expect(r.score).toBeGreaterThanOrEqual(-1);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.generatedAt).toBeGreaterThan(0);
    expect(Array.isArray(r.sources)).toBe(true);
    expect(r.sources.length).toBeGreaterThan(0);
    // Fatores devem ser arrays
    expect(Array.isArray(r.factors.favorable)).toBe(true);
    expect(Array.isArray(r.factors.counter)).toBe(true);
    expect(Array.isArray(r.factors.invalidators)).toBe(true);
  });
});
