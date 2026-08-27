/**
 * Tipos do Quantitative Analysis Engine.
 *
 * O motor quantitativo é INDEPENDENTE da IA (LLM). É determinístico, testável
 * e reproduzível. Toda saída é um valor numérico derivado apenas dos candles
 * recebidos — nunca um número inventado pelo agente.
 *
 * A probabilidade/score derivados de dados devem sempre carregar metadados de
 * amostra; nunca é a LLM que fabrica um número.
 */
import type { MarketCandle } from "../market/model";

/** Resultado de uma série indicadora (indexado por posição, pode ser null). */
export type Series = ReadonlyArray<number | null>;

/** Direção de um indicador / leitura. */
export type Signal = "bullish" | "bearish" | "neutral";

/** Regime de mercado detectado. */
export type MarketRegime =
  | "strong_uptrend"
  | "uptrend"
  | "range"
  | "downtrend"
  | "strong_downtrend"
  | "high_volatility"
  | "unknown";

export interface IndicatorResult<TReturn = { readonly [key: string]: number | Series }> {
  readonly name: string;
  readonly data: TReturn;
}

/** Valores calculados sobre um conjunto de candles. */
export interface ComputedIndicators {
  readonly sma: Series;
  readonly ema: Series;
  readonly rsi: Series;
  readonly macd: { readonly line: Series; readonly signal: Series; readonly histogram: Series };
  readonly atr: Series;
  readonly bollinger: { readonly upper: Series; readonly middle: Series; readonly lower: Series };
  readonly vwap: Series;
  readonly adx: Series;
  readonly momentum: Series;
  readonly roc: Series;
  readonly volatility: Series;
  readonly candleCount: number;
}

/** Uma linha de suporte ou resistência (local de preço relevante). */
export interface PriceLevel {
  readonly price: number;
  readonly kind: "support" | "resistance";
  readonly strength: number; // 0..1
  readonly touches: number;
}

/** Estilo de swing (market structure). */
export type SwingKind = "HH" | "HL" | "LH" | "LL";

export interface SwingPoint {
  readonly index: number;
  readonly timestamp: number;
  readonly price: number;
  readonly kind: SwingKind;
}

/** Detecção de market structure. */
export interface MarketStructure {
  readonly swings: readonly SwingPoint[];
  readonly trend: "up" | "down" | "sideways";
  readonly structureLabel: string;
}

/** Volatilidade histórica anualizada (ou por janela) empírica. */
export interface VolatilityResult {
  readonly windowVolatility: number; // % por candle (std dev dos retornos)
  readonly annualized: number; // % anualizada
  readonly realizedRange: number; // atr/price médio
  readonly sampleSize: number;
  readonly atr: number | null;
  readonly atrPct: number | null;
}

/** Resumo final do quant engine, pronto para a fusão de evidências. */
export interface QuantSummary {
  readonly indicators: ComputedIndicators;
  readonly volatility: VolatilityResult;
  readonly regime: { readonly regime: MarketRegime; readonly confidence: number; readonly reasons: readonly string[] };
  readonly structure: MarketStructure;
  readonly levels: { readonly supports: readonly PriceLevel[]; readonly resistances: readonly PriceLevel[] };
  readonly technicalScore: number; // -1..1 derivado de dados
  readonly sampleSize: number;
}

/** Entrada do QuantEngine. */
export interface QuantInput {
  readonly candles: readonly MarketCandle[];
  readonly symbol: string;
  readonly timeframe: string;
}

/** Configuração de períodos dos indicadores. */
export interface IndicatorConfig {
  readonly smaPeriod: number;
  readonly emaPeriod: number;
  readonly rsiPeriod: number;
  readonly macdFast: number;
  readonly macdSlow: number;
  readonly macdSignal: number;
  readonly atrPeriod: number;
  readonly bollingerPeriod: number;
  readonly bollingerStdDev: number;
  readonly adxPeriod: number;
}
