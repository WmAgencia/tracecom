/**
 * MarketDataService — serviço interno de API de mercado.
 *
 * A camada acima (quant engine, agent, UI) NÃO conhece detalhes do provider.
 * Este serviço traduz requisições de alto nível para o registry/pipeline e
 * retorna respostas com frescor e qualidade explícitas.
 *
 * Sem provider configurado → `PROVIDER_NOT_CONFIGURED` (nunca dados falsos).
 */
import type { MarketCandle, MarketTick, MarketOrderBook, Timeframe } from "./model";
import type { Freshness } from "./model";
import type { MarketDataProvider } from "./providerV2";
import type { MarketPipeline } from "./pipeline";
import { ProviderNotConfiguredError } from "./providerV2";
import { MarketState } from "./state";

export interface GetMarketDataResult {
  readonly provider: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly currentPrice: number | null;
  readonly latestClosedCandle: MarketCandle | null;
  readonly latestCandle: MarketCandle | null;
  readonly volume: number | null;
  readonly quality: MarketCandle["quality"];
  readonly freshness: Freshness;
  readonly timestamp: number;
  readonly available: boolean;
  readonly status?: string;
}

export interface MarketDataServiceOptions {
  readonly provider: MarketDataProvider | null;
  readonly pipeline: MarketPipeline | null;
  readonly logger?: { error(msg: string, meta?: unknown): void };
}

export class MarketDataService {
  private readonly provider: MarketDataProvider | null;
  private readonly pipeline: MarketPipeline | null;

  constructor(opts: MarketDataServiceOptions) {
    this.provider = opts.provider;
    this.pipeline = opts.pipeline;
  }

  private requireProvider(): MarketDataProvider {
    if (!this.provider) throw new ProviderNotConfiguredError("não configurado");
    return this.provider;
  }

  async getMarketData(params: { symbol: string; timeframe: Timeframe }): Promise<GetMarketDataResult> {
    const provider = this.requireProvider();
    const now = Date.now();
    const state = this.pipeline?.state;
    const sym = state?.getSymbol(provider.id, params.symbol, params.timeframe);
    const candles = state?.getCandles(params.symbol, params.timeframe) ?? [];

    let currentPrice: number | null = null;
    let volume: number | null = null;
    try {
      const ticker = await provider.getTicker(params.symbol);
      currentPrice = ticker.price;
    } catch {
      currentPrice = sym?.lastTick?.price ?? sym?.lastCandle?.close ?? null;
    }
    if (sym?.lastCandle) volume = candles.reduce((s, c) => s + c.volume, 0);

    const freshness: Freshness = state?.freshness(provider.id, params.symbol, params.timeframe) ?? "unavailable";
    const latestClosed = sym?.lastClosedCandle ?? candles.filter((c) => c.isClosed).at(-1) ?? null;

    return {
      provider: provider.id,
      symbol: params.symbol,
      timeframe: params.timeframe,
      currentPrice,
      latestClosedCandle: latestClosed,
      latestCandle: sym?.lastCandle ?? candles.at(-1) ?? null,
      volume,
      quality: sym?.quality ?? "unknown",
      freshness,
      timestamp: now,
      available: currentPrice !== null,
      ...(provider.getStatus() !== "connected" ? { status: provider.getStatus() } : {}),
    };
  }

  async getHistoricalCandles(params: { symbol: string; timeframe: Timeframe; start: number; end: number; limit?: number }): Promise<MarketCandle[]> {
    const provider = this.requireProvider();
    const res = await provider.getCandles({ symbol: params.symbol, timeframe: params.timeframe, start: params.start, end: params.end, limit: params.limit });
    return res.candles;
  }

  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<MarketCandle | null> {
    return this.pipeline?.state.getSymbol(this.provider?.id ?? "", symbol, timeframe)?.lastCandle ?? null;
  }

  async getLatestClosedCandle(symbol: string, timeframe: Timeframe): Promise<MarketCandle | null> {
    return this.pipeline?.state.getSymbol(this.provider?.id ?? "", symbol, timeframe)?.lastClosedCandle ?? null;
  }

  async getTicker(symbol: string): Promise<{ price: number; source: string; receivedAt: number }> {
    const provider = this.requireProvider();
    const t = await provider.getTicker(symbol);
    return { price: t.price, source: t.source, receivedAt: t.receivedAt };
  }

  async getOrderBook(symbol: string, limit?: number): Promise<MarketOrderBook> {
    const provider = this.requireProvider();
    return provider.getOrderBook(symbol, limit);
  }

  async getRecentTrades(symbol: string, limit?: number): Promise<MarketTick[]> {
    const provider = this.requireProvider();
    const r = await provider.getTrades(symbol, limit);
    return r.trades;
  }

  getMarketState() {
    return {
      provider: this.provider?.getStatus() ?? "disconnected",
      connectedAt: this.provider?.connectedAt ?? null,
    };
  }

  getMarketStatus() {
    return {
      provider: this.provider?.id ?? "none",
      state: this.provider?.getStatus() ?? "disconnected",
    };
  }
}
