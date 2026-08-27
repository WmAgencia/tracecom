/**
 * Modelo canônico de Market Data da TRACECON.
 *
 * Diferentes provedores têm formatos diferentes. Aqui definimos o modelo
 * INTERNO que a Tracecon usa em todo o restante do sistema (quant engine,
 * agent, UI). Nenhuma camada abaixo/acima deve "vazar" o formato de um SDK.
 *
 * PRINCÍPIO: cada dado carrega metadados suficientes para responder
 * "De onde veio este dado?" — provider, símbolo, timeframe, origem,
 * timestamps, qualidade, atraso estimado e sequência quando disponível.
 */

/** Timeframes canônicos (mínimos desta etapa). Timeframe de segundos pode ser adicionado depois. */
export type Timeframe =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

/** Duration de cada timeframe em milissegundos (para bucketing e gaps). */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * Cataloga se um timeframe é nativamente suportado por um provedor.
 * Quando `false`, o pipeline deve AGREGAR de timeframes menores (ex.: 1m→3m).
 * NUNCA fabricar candle.
 */
export interface TimeframeSupport {
  readonly native: boolean;
  readonly aggregateFrom?: Timeframe;
}

/** Identificação de mercado no provedor (símbolo + provider + moeda base/quote). */
export interface MarketSymbol {
  /** Símbolo canônico no provider, ex.: "BTCUSDT" na binance. */
  readonly symbol: string;
  readonly provider: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly market: "crypto" | "stock" | "forex" | "index" | "commodity";
}

/** Qualidade percebida de um dado. */
export type DataQualityLevel = "high" | "medium" | "low" | "unknown";

/**
 * Candle canônico.
 *
 * `timestamp` = início do bucket (UTC, ms). `receivedAt` = quando a Tracecon
 * recebeu. `isClosed` = o bucket completou (não é o "candle atual" aberto).
 * `source` = origem (ex.: "rest" | "ws:<stream>"). `sequence` = nº do evento
 * no provider quando disponível (para dedup/ordenação).
 */
export interface MarketCandle {
  readonly provider: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly timestamp: number; // início do bucket (UTC, ms)
  readonly receivedAt: number; // ms epoch
  readonly isClosed: boolean;
  readonly source: string;
  readonly quality: DataQualityLevel;
  readonly sequence?: number;
  /** Atraso estimado (ms) entre o fechamento do bucket e o receivedAt. */
  readonly estimatedDelayMs?: number;
}

/** Um tick/evento de preço (trade) normalizado. */
export interface MarketTick {
  readonly provider: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: number;
  readonly timestamp: number; // ocorrência no provider (UTC, ms)
  readonly receivedAt: number; // quando a Tracecon recebeu
  readonly source: string;
  readonly quality: DataQualityLevel;
  readonly sequence?: number;
  readonly side?: "buy" | "sell"; // se o provider informar
}

/** Estado de conexão de um provedor. */
export type ProviderConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** Snapshot de book (nível base). */
export interface MarketOrderBook {
  readonly provider: string;
  readonly symbol: string;
  readonly bids: ReadonlyArray<{ readonly price: number; readonly quantity: number }>;
  readonly asks: ReadonlyArray<{ readonly price: number; readonly quantity: number }>;
  readonly timestamp: number;
  readonly receivedAt: number;
  readonly quality: DataQualityLevel;
  readonly sequence?: number;
}

/** Rótulo de frescor de uma resposta consultável. */
export type Freshness = "fresh" | "stale" | "delayed" | "unavailable";
