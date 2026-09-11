/** Adapter OANDA v20 para a interface canônica de MarketDataProvider. */
import type { HistoricalPage, HistoricalSource } from "../../history";
import type { MarketCandle, MarketOrderBook, MarketSymbol, Timeframe } from "../../model";
import { TIMEFRAME_MS } from "../../model";
import type { MarketDataProvider, MarketListener, SubscribeOptions } from "../../providerV2";
import { OandaForexProvider } from "../../forex/oanda-provider";
import { parseForexPair } from "../../forex/types";

export interface OandaMarketDataOptions {
  readonly apiKey: string;
  readonly accountId: string;
  readonly baseUrl?: string;
  readonly pollIntervalMs?: number;
}

export class OandaMarketDataProvider implements MarketDataProvider {
  readonly id = "oanda";
  private _state: MarketDataProvider["state"] = "disconnected";
  private _connectedAt: number | null = null;
  private readonly forex: OandaForexProvider;
  private readonly pollIntervalMs: number;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  readonly historical: HistoricalSource;

  constructor(opts: OandaMarketDataOptions) {
    this.forex = new OandaForexProvider(opts);
    this.pollIntervalMs = Math.max(5_000, opts.pollIntervalMs ?? 15_000);
    this.historical = {
      provider: this.id,
      fetchPage: async (params): Promise<HistoricalPage> => {
        const result = await this.getCandles(params);
        const last = result.candles.at(-1);
        const next = last ? last.timestamp + TIMEFRAME_MS[params.timeframe] : null;
        return {
          candles: result.candles,
          nextStartTime: result.candles.length >= params.limit && next !== null && next < params.end ? next : null,
        };
      },
    };
  }

  get state(): MarketDataProvider["state"] { return this._state; }
  get connectedAt(): number | null { return this._connectedAt; }
  getStatus(): MarketDataProvider["state"] { return this._state; }

  async connect(): Promise<void> {
    if (this._state === "connected") return;
    this._state = "connecting";
    const health = await this.forex.health();
    if (!health.ok) {
      this._state = "error";
      throw new Error(`Falha de conexão com OANDA: ${health.errorMessage ?? "health check falhou"}`);
    }
    this._state = "connected";
    this._connectedAt = Date.now();
  }

  disconnect(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this._state = "disconnected";
    this._connectedAt = null;
  }

  async subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void> {
    if (this._state !== "connected") await this.connect();
    let active = true;
    const poll = async (): Promise<void> => {
      if (!active) return;
      try {
        const ticker = await this.getTicker(opts.symbol);
        listener({ type: "tick", tick: {
          provider: this.id, symbol: opts.symbol, price: ticker.price, quantity: 0,
          timestamp: ticker.receivedAt, receivedAt: ticker.receivedAt,
          source: ticker.source, quality: ticker.quality,
        } });
        for (const timeframe of opts.timeframes ?? ["1m"]) {
          const end = Date.now();
          const result = await this.getCandles({
            symbol: opts.symbol, timeframe, start: end - TIMEFRAME_MS[timeframe] * 3, end, limit: 3,
          });
          const last = result.candles.at(-1);
          if (last) listener({ type: "candle", candle: last });
        }
        if (this._state !== "connected") {
          this._state = "connected";
          listener({ type: "status", state: "connected" });
        }
      } catch (error) {
        this._state = "reconnecting";
        listener({ type: "status", state: "reconnecting", error: String(error instanceof Error ? error.message : error) });
      }
    };
    const timer = setInterval(() => void poll(), this.pollIntervalMs);
    this.timers.add(timer);
    void poll();
    return () => { active = false; clearInterval(timer); this.timers.delete(timer); };
  }

  async getTicker(symbol: string) {
    const quote = await this.forex.fetchQuote(requirePair(symbol));
    return { price: quote.mid, quality: "high" as const, receivedAt: quote.timestamp, source: this.id };
  }

  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }) {
    const end = params.end ?? Date.now();
    const raw = await this.forex.fetchCandles(requirePair(params.symbol), params.timeframe, params.start, end);
    const receivedAt = Date.now();
    const candles: MarketCandle[] = raw.slice(-(params.limit ?? raw.length)).map((c) => ({
      provider: this.id, symbol: params.symbol, timeframe: params.timeframe,
      open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume ?? 0, timestamp: c.timestamp, receivedAt,
      isClosed: true, source: c.source, quality: c.quality,
      estimatedDelayMs: Math.max(0, receivedAt - (c.timestamp + TIMEFRAME_MS[params.timeframe])),
    }));
    return { candles, source: this.id, quality: candles.length ? "high" as const : "unknown" as const };
  }

  async getTrades(_symbol: string, _limit?: number) { return { trades: [], source: "oanda:unavailable" }; }

  async getOrderBook(symbol: string, _limit?: number): Promise<MarketOrderBook> {
    const quote = await this.forex.fetchQuote(requirePair(symbol));
    return {
      provider: this.id, symbol,
      bids: [{ price: quote.bid, quantity: 0 }], asks: [{ price: quote.ask, quantity: 0 }],
      timestamp: quote.timestamp, receivedAt: Date.now(), quality: "high",
    };
  }

  async getMarketMetadata(symbol: string): Promise<MarketSymbol | null> {
    const pair = parseForexPair(symbol);
    return pair ? { symbol, provider: this.id, baseAsset: pair.base, quoteAsset: pair.quote, market: "forex" } : null;
  }
}

function requirePair(symbol: string) {
  const pair = parseForexPair(symbol);
  if (!pair) throw new Error(`Símbolo Forex inválido: ${symbol}`);
  return pair;
}
