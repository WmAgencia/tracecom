/**
 * Binance provider — fonte REST (dados históricos + snapshot).
 *
 * Verificado: `GET /api/v3/klines` (sem auth, real). Funcionalidades extras
 * (funding/OI) ficam em `futures.ts` separado, voltado a Futures.
 *
 * NÃO trata ordens/conta. É só inteligência/análise.
 */
import type { MarketCandle, MarketOrderBook, MarketSymbol, MarketTick, Timeframe } from "../../model";
import { TIMEFRAME_MS } from "../../model";
import { normalizeKline, parseSymbol } from "../../normalize";
import type { MarketDataProvider, MarketListener, SubscribeOptions } from "../../providerV2";
import type { HistoricalSource, HistoricalPage } from "../../history";
import { BinanceStream } from "./stream";

const BASE_URL = "https://api.binance.com/api/v3";

export interface BinanceRestOptions {
  readonly baseUrl?: string;
}

export class BinanceRestClient {
  private readonly baseUrl: string;
  constructor(private readonly opts: BinanceRestOptions = {}) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  private async get(path: string, params: Record<string, string | number>): Promise<unknown[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const url = `${this.baseUrl}${path}?${qs.toString()}`;
    const res = await fetch(url, { headers: { "User-Agent": "tracecon/0.1" } });
    if (!res.ok) {
      throw new Error(`Binance REST ${res.status} ${res.statusText} para ${path}`);
    }
    return (await res.json()) as unknown[];
  }

  async klines(params: {
    symbol: string;
    timeframe: Timeframe;
    start: number;
    end?: number;
    limit?: number;
  }): Promise<MarketCandle[]> {
    const raw = await this.get("/klines", {
      symbol: params.symbol,
      interval: params.timeframe, // '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d' coincidem
      startTime: params.start,
      limit: params.limit ?? 500,
      ...(params.end ? { endTime: params.end } : {}),
    });
    const receivedAt = Date.now();
    return raw.map((r) =>
      normalizeKline(r as unknown[], {
        provider: "binance",
        symbol: params.symbol,
        timeframe: params.timeframe,
        source: "rest",
        receivedAt,
      }),
    );
  }

  async ticker(symbol: string): Promise<{ price: number; receivedAt: number; source: string }> {
    // usa /ticker/24hr? ou /ticker/price mais leve. Preferimos price.
    const raw = (await this.get("/ticker/price", { symbol })) as unknown as { symbol: string; price: string };
    return { price: Number(raw.price), receivedAt: Date.now(), source: "rest" };
  }

  async trades(symbol: string, limit = 100): Promise<MarketTick[]> {
    const raw = (await this.get("/aggTrades", { symbol, limit })) as Record<string, unknown>[];
    const receivedAt = Date.now();
    return raw.map((t) => ({
      provider: "binance",
      symbol,
      price: Number(t.p),
      quantity: Number(t.q),
      timestamp: Number(t.T),
      receivedAt,
      source: "rest",
      quality: "unknown",
      ...(t.m !== undefined ? { side: t.m ? "sell" as const : "buy" as const } : {}),
    }));
  }

  async orderBook(symbol: string, limit = 100): Promise<MarketOrderBook> {
    const raw = (await this.get("/depth", { symbol, limit })) as unknown as {
      bids: string[][]; asks: string[][]; lastUpdateId: number;
    };
    return {
      provider: "binance",
      symbol,
      bids: raw.bids.map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
      asks: raw.asks.map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
      timestamp: Date.now(),
      receivedAt: Date.now(),
      quality: "unknown",
      sequence: Number(raw.lastUpdateId),
    };
  }

  async marketInfo(symbol: string): Promise<MarketSymbol> {
    const p = parseSymbol(symbol);
    return { symbol, provider: "binance", baseAsset: p.baseAsset, quoteAsset: p.quoteAsset, market: p.market };
  }

  /** Fonte histórica paginada. */
  historical(): HistoricalSource {
    return {
      provider: "binance",
      fetchPage: async (params): Promise<HistoricalPage> => {
        // Binance devolve no máximo 1000 por chamada; usamos o limit pedido.
        const candles = await this.klines({ symbol: params.symbol, timeframe: params.timeframe, start: params.start, limit: params.limit });
        const last = candles[candles.length - 1];
        const next = last ? last.timestamp + TIMEFRAME_MS[params.timeframe] : null;
        return {
          candles,
          nextStartTime: candles.length >= params.limit && next !== null && next <= params.end ? next : null,
        };
      },
    };
  }
}

/**
 * Provider Binance completo (REST + WS). O botão "connect/disconnect/subscribe"
 * da UI opera nesta classe.
 */
export class BinanceProvider implements MarketDataProvider {
  readonly id = "binance";
  private _state: MarketDataProvider["state"] = "disconnected";
  private _connectedAt: number | null = null;
  private stream: BinanceStream | null = null;
  private readonly listeners = new Set<MarketListener>();
  readonly historical: HistoricalSource;

  constructor(private readonly rest: BinanceRestClient = new BinanceRestClient()) {
    this.historical = rest.historical();
  }

  get state(): MarketDataProvider["state"] {
    return this._state;
  }
  get connectedAt(): number | null {
    return this._connectedAt;
  }

  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this._state = "connecting";
    this.emit({ type: "status", state: "connecting" });
    // Não há handshake explícito p/ binance pública; validamos via REST ping.
    try {
      const res = await fetch(`${BASE_URL}/ping`);
      if (!res.ok) throw new Error("ping falhou");
      this._state = "connected";
      this._connectedAt = Date.now();
      this.emit({ type: "status", state: "connected" });
    } catch {
      this._state = "error";
      this.emit({ type: "status", state: "error", error: "Falha ao conectar à Binance" });
      throw new Error("Falha de conexão com a Binance");
    }
  }

  disconnect(): void {
    this._state = "disconnected";
    this._connectedAt = null;
    this.stream?.stop();
    this.stream = null;
    this.emit({ type: "status", state: "disconnected" });
  }

  getStatus(): MarketDataProvider["state"] {
    return this._state;
  }

  async subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void> {
    this.listeners.add(listener);
    if (this._state !== "connected") await this.connect();
    // O stream WS cobre kl+aggTrade. Configuramos um stream por assinatura.
    const stream = new BinanceStream({
      onEvent: (ev) => this.dispatch(ev),
      onState: (s) => {
        this._state = s;
        this.emit({ type: "status", state: s });
      },
    });
    this.stream = stream;
    stream.start([{ symbol: opts.symbol, timeframes: opts.timeframes?.length ? opts.timeframes : ["1m"] }]);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stream?.stop();
    };
  }

  async getTicker(symbol: string) {
    const t = await this.rest.ticker(symbol);
    return { price: t.price, quality: "high" as const, receivedAt: t.receivedAt, source: t.source };
  }

  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }) {
    const candles = await this.rest.klines(params);
    return { candles, source: "rest", quality: "high" as const };
  }

  async getTrades(symbol: string, limit?: number) {
    const trades = await this.rest.trades(symbol, limit);
    return { trades, source: "rest" };
  }

  async getOrderBook(symbol: string, limit?: number) {
    return this.rest.orderBook(symbol, limit);
  }

  async getMarketMetadata(symbol: string) {
    return this.rest.marketInfo(symbol);
  }

  private dispatch(ev: Parameters<MarketListener>[0]): void {
    for (const l of this.listeners) l(ev);
  }
  private emit(ev: Parameters<MarketListener>[0]): void {
    for (const l of this.listeners) l(ev);
  }
}
