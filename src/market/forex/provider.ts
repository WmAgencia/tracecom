/**
 * Provider interface abstrata para Forex.
 *
 * Cada provider concreto (Dukascopy, OANDA v20, Polygon) implementa esta interface.
 * O resto do sistema usa apenas `ForexProvider`, nunca o provider concreto.
 */
import type { Timeframe } from "../model";
import type {
  ForexPair, Quote, MarketTick, ValidationResult, ForexMarketSnapshot,
} from "./types";

/** Interface mínima para qualquer provider Forex. */
export interface ForexProvider {
  readonly id: string;
  readonly displayName: string;
  /** Fetch cotação atual (top-of-book). Pode falhar se provider offline. */
  fetchQuote(pair: ForexPair): Promise<Quote>;
  /** Fetch candles históricas para um par+timeframe+janela. */
  fetchCandles(
    pair: ForexPair,
    timeframe: Timeframe,
    startMs: number,
    endMs: number,
  ): Promise<ReadonlyArray<ForexCandle>>;
  /** Verifica saúde do provider (heartbeat). */
  health(): Promise<ProviderHealth>;
}

/** Candle Forex (Open/High/Low/Close/Volume + bid/ask agregados). */
export interface ForexCandle {
  readonly symbol: string;
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly bidClose: number | null;
  readonly askClose: number | null;
  readonly volume: number | null;
  readonly source: string;
  readonly quality: "high" | "medium" | "low" | "unknown";
}

/** Status de saúde do provider. */
export interface ProviderHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly lastCheck: number;
  readonly errorMessage: string | null;
}

/** Snapshot consolidado retornado por um provider. */
export interface ProviderSnapshot {
  readonly providerId: string;
  readonly fetchedAt: number;
  readonly pairs: ReadonlyArray<ForexMarketSnapshot>;
  readonly health: ProviderHealth;
}

/** Factory para criar providers concretos. */
export type ForexProviderFactory = (opts: ProviderFactoryOpts) => ForexProvider;

export interface ProviderFactoryOpts {
  /** API key ou credencial (vazio para providers gratuitos). */
  readonly apiKey?: string;
  /** Account ID exigido pelo endpoint OANDA pricing. */
  readonly accountId?: string;
  /** URL base customizada (opcional). */
  readonly baseUrl?: string;
  /** Timeout em ms. */
  readonly timeoutMs?: number;
}

/** Validação completa: quote + freshness + sanity checks. */
export function fullValidate(
  quote: Quote | null,
  now: number,
  pair: ForexPair,
): ValidationResult {
  // Re-export aqui para manter uma só entry-point para consumers do ForexProvider.
  const { validateQuote } = require("./types") as typeof import("./types");
  return validateQuote(quote, now, pair);
}
