/**
 * MarketContext — contexto estruturado entregue ao agente (Groq).
 *
 * A IA NÃO recebe o stream bruto. Recebe um snapshot relevante e enxuto,
 * já enriquecido com features calculadas pelo Quant Engine (indicadores,
 * volatilidade, regime, estrutura). A IA recebe contexto, não milhões de ticks.
 *
 * REGRA: se o Quant Engine não tiver dados suficientes, os campos permanecem
 * null — a IA deve então concluir WAIT, nunca inventar números.
 */
import type { MarketCandle, DataQualityLevel, Freshness, ProviderConnectionState, Timeframe } from "./model";

export interface MarketQuantFeatures {
  readonly technicalScore: number | null; // -1..1
  readonly rsi: number | null;
  readonly macdHistogram: number | null;
  readonly atrPct: number | null; // % (ATR/preço)
  readonly volatilityAnnualized: number | null; // %
  readonly marketRegime: string | null;
  readonly structureTrend: string | null;
  readonly supports: number[]; // preços
  readonly resistances: number[];
  readonly sampleSize: number;
}

export interface MarketContext {
  readonly provider: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly currentPrice: number | null;
  readonly latestClosedCandle: MarketCandle | null;
  readonly recentCandles: readonly MarketCandle[];
  readonly volume: number | null;
  readonly volatility: number | null; // mantido p/ compat (hist.)
  readonly providerState: ProviderConnectionState;
  readonly dataQuality: DataQualityLevel;
  readonly freshness: Freshness;
  readonly timestamp: number;
  readonly available: boolean;
  /** Features calculadas pelo Quant Engine (null quando sem dados). */
  readonly quant?: MarketQuantFeatures;
  readonly note?: string;
}

const MAX_RECENT = 60;

export function buildMarketContext(input: {
  readonly provider: string;
  readonly providerState: ProviderConnectionState;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly currentPrice: number | null;
  readonly latestClosedCandle: MarketCandle | null;
  readonly candles: readonly MarketCandle[];
  readonly volume: number | null;
  readonly quality: DataQualityLevel;
  readonly freshness: Freshness;
  readonly quant?: MarketQuantFeatures;
  readonly timestamp?: number;
}): MarketContext {
  const available = input.currentPrice !== null && input.latestClosedCandle !== null && input.providerState === "connected";
  return {
    provider: input.provider,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentPrice: input.currentPrice,
    latestClosedCandle: input.latestClosedCandle,
    recentCandles: input.candles.slice(-MAX_RECENT),
    volume: input.volume,
    volatility: null,
    providerState: input.providerState,
    dataQuality: input.quality,
    freshness: input.freshness,
    timestamp: input.timestamp ?? Date.now(),
    available,
    ...(input.quant ? { quant: input.quant } : {}),
    ...(available ? {} : { note: "Dados indisponíveis/incompletos — conclusão deve ser WAIT ou explicitamente incerta." }),
  };
}
