/**
 * Interface abstrata de um provedor de Market Data (v2).
 *
 * O restante do sistema depende APENAS desta interface — nunca de SDKs.
 * Implementações concretas ficam em `providers/**` (ex.: binance/).
 *
 * Sem provedor conectado, o Registry retorna `PROVIDER_NOT_CONFIGURED`.
 */
import type {
  MarketCandle,
  MarketOrderBook,
  MarketSymbol,
  MarketTick,
  ProviderConnectionState,
  Timeframe,
} from "./model";
import type { HistoricalPage, HistoricalSource } from "./history";

/** Stream de tópicos suportado por um provedor. */
export type MarketStreamTopic = "trades" | "klines" | "book" | "ticker";

/** Listenable de um stream de mercado. */
export type MarketListener = (event: ProviderEvent) => void;

/** Evento já normalizado que um provedor emite para o pipeline. */
export type ProviderEvent =
  | { readonly type: "tick"; readonly tick: MarketTick }
  | { readonly type: "candle"; readonly candle: MarketCandle }
  | { readonly type: "book"; readonly book: MarketOrderBook }
  | { readonly type: "status"; readonly state: ProviderConnectionState; readonly error?: string };

export interface SubscribeOptions {
  readonly symbol: string;
  readonly topics: readonly MarketStreamTopic[];
  readonly timeframes?: readonly Timeframe[];
}

export interface MarketDataProvider {
  readonly id: string;
  readonly state: ProviderConnectionState;
  readonly connectedAt: number | null;

  /** Abre a conexão (WS) — idempotente. */
  connect(): Promise<void>;
  disconnect(): void;
  getStatus(): ProviderConnectionState;

  /** Assina streams e encaminha eventos via listener. Retorna unsubscribe(). */
  subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void>;

  /** Snapshot via REST. */
  getTicker(symbol: string): Promise<{ price: number; quality: MarketCandle["quality"]; receivedAt: number; source: string }>;
  getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }): Promise<{ candles: MarketCandle[]; source: string; quality: MarketCandle["quality"] }>;
  getTrades(symbol: string, limit?: number): Promise<{ trades: MarketTick[]; source: string }>;
  getOrderBook(symbol: string, limit?: number): Promise<MarketOrderBook>;
  getMarketMetadata(symbol: string): Promise<MarketSymbol | null>;

  /** Fontes históricas paginadas (para gaps/reconciliação). */
  readonly historical: HistoricalSource;
}

/** Erro estruturado de "provedor não configurado". */
export class ProviderNotConfiguredError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED";
  constructor(providerId: string) {
    super(`Provedor ${providerId} não configurado (sem credencial/conexão).`);
    this.name = "ProviderNotConfiguredError";
  }
}
