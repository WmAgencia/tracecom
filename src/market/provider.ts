/**
 * Casa de abstração de Market Data Provider.
 *
 * A Tracecon NÃO se acopla a uma única corretora. Toda leitura de dados de
 * mercado passa por um `MarketDataProvider`. A implementação concreta
 * (Binance, Alpaca, etc.) será adicionada depois de pesquisarmos qual
 * entrega os dados com velocidade/qualidade suficientes para o produto.
 *
 * Nesta etapa, apenas a interface, o registro e um provider "noop" existem.
 * Qualquer leitura sem provider conectado retorna `availability: "UNAVAILABLE"`
 * — NUNCA dados inventados.
 */
import type {
  Candle,
  DataAvailability,
  Instrument,
  Timeframe,
  ToolResult,
} from "../domain/types";

/** Campos de snapshot de mercado solicitados por ferramentas de leitura. */
export const MARKET_SNAPSHOT_FIELDS = [
  "ticker",
  "orderbook",
  "funding",
  "openInterest",
  "recentTrades",
] as const;

export type MarketSnapshotField = (typeof MARKET_SNAPSHOT_FIELDS)[number];

/** Atores/participantes que a ferramenta de liquidez pode reportar. */
export interface LiquidityMetrics {
  readonly bidDepth: number;
  readonly askDepth: number;
  readonly spread: number;
  readonly depthImbalance: number; // -1..1 (1 = forte compra)
  readonly lastPrice: number;
}

/** Assinatura de uma consulta a um provider. */
export interface MarketQuery {
  readonly instrument: Instrument;
  readonly timeframe?: Timeframe;
  readonly limit?: number;
}

export interface MarketDataProvider {
  /** Identificador único do provider (ex.: "binance"). */
  readonly id: string;
  readonly available: boolean;
  /** Timestamp do último heartbeat/validação da conexão. */
  readonly connectedAt: number | null;

  candles(query: MarketQuery): Promise<ToolResult<Candle[]>>;
  ticker(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>>;
  volume(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>>;
  orderBook(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>>;
  liquidity(query: MarketQuery): Promise<ToolResult<LiquidityMetrics>>;
  funding(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>>;
  openInterest(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>>;
}

/** Modo do mercado: determina qual provider é instanciado (ver registry). */
export type MarketDataMode = "noop" | "mocked";
