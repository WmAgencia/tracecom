/**
 * Ferramentas do Quant Engine para o agente (Anthropic).
 *
 * Estas tools NÃO deixam a IA calcular: apenas expõem resultados determinísticos
 * do `QuantEngine`. A IA orquestra; o motor faz a matemática.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry";
import type { MarketCandle, Timeframe } from "../../market/model";
import { QuantEngine, DEFAULT_CONFIG } from "../../quant/engine";

/** Resolve candles de um par (via state do pipeline). */
export type CandleSource = (symbol: string, timeframe: Timeframe) => readonly MarketCandle[];

const symbolSchema = z.object({
  symbol: z.string().min(2).describe("Símbolo do instrumento, ex.: BTCUSDT."),
  timeframe: z.enum(["1m", "3m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe dos candles."),
});

export function registerQuantTools(registry: ToolRegistry, source: CandleSource): void {
  const engine = new QuantEngine(DEFAULT_CONFIG);

  registry
    .register({
      name: "calculate_indicators",
      description:
        "Calcular indicadores técnicos (SMA, EMA, RSI, MACD, ATR, Bollinger, ADX, VWAP, momentum, ROC, volatilidade) a partir dos candles do instrumento.",
      schema: symbolSchema,
      handler: async (args) => {
        const candles = source(args.symbol, args.timeframe);
        if (candles.length < Math.max(DEFAULT_CONFIG.atrPeriod, DEFAULT_CONFIG.rsiPeriod)) {
          return { availability: "UNAVAILABLE", message: "Dados insuficientes para calcular indicadores.", availableCandles: candles.length };
        }
        const ind = engine.computeIndicators(candles);
        return {
          availability: "AVAILABLE",
          candleCount: candles.length,
          indicators: compactIndicators(ind),
        };
      },
    })
    .register({
      name: "calculate_volatility",
      description:
        "Calcular volatilidade histórica (janela e anualizada) e range realizado (ATR/preço) do instrumento.",
      schema: symbolSchema,
      handler: async (args) => {
        const candles = source(args.symbol, args.timeframe);
        if (candles.length < DEFAULT_CONFIG.atrPeriod) {
          return { availability: "UNAVAILABLE", message: "Dados insuficientes para calcular volatilidade." };
        }
        const summary = engine.analyze({ candles, symbol: args.symbol, timeframe: args.timeframe });
        return {
          availability: "AVAILABLE",
          windowVolatility: summary.volatility.windowVolatility,
          annualized: summary.volatility.annualized,
          realizedRangePct: summary.volatility.atrPct,
          atr: summary.volatility.atr,
          sampleSize: summary.volatility.sampleSize,
          regime: summary.regime.regime,
          regimeConfidence: summary.regime.confidence,
        };
      },
    })
    .register({
      name: "detect_market_regime",
      description: "Classificar o regime de mercado (uptrend/downtrend/range/high_volatility) com confiança e razões.",
      schema: symbolSchema,
      handler: async (args) => {
        const candles = source(args.symbol, args.timeframe);
        if (candles.length < DEFAULT_CONFIG.adxPeriod * 2) {
          return { availability: "UNAVAILABLE", message: "Dados insuficientes para detectar regime." };
        }
        const summary = engine.analyze({ candles, symbol: args.symbol, timeframe: args.timeframe });
        return {
          availability: "AVAILABLE",
          regime: summary.regime.regime,
          confidence: summary.regime.confidence,
          reasons: summary.regime.reasons,
          structureTrend: summary.structure.trend,
          technicalScore: summary.technicalScore,
        };
      },
    });
}

/** Converte as séries completas em um resumo compacto (últimos valores + amostra). */
function compactIndicators(ind: ReturnType<QuantEngine["computeIndicators"]>) {
  const last = (s: readonly (number | null)[]) => s.filter((v) => v !== null).at(-1) ?? null;
  return {
    sma: last(ind.sma),
    ema: last(ind.ema),
    rsi: last(ind.rsi),
    macd: { line: last(ind.macd.line), signal: last(ind.macd.signal), histogram: last(ind.macd.histogram) },
    atr: last(ind.atr),
    bollinger: { upper: last(ind.bollinger.upper), middle: last(ind.bollinger.middle), lower: last(ind.bollinger.lower) },
    vwap: last(ind.vwap),
    adx: last(ind.adx),
    momentum: last(ind.momentum),
    roc: last(ind.roc),
    volatility: last(ind.volatility),
  };
}
