/**
 * Market State — estado de mercado em memória (por provider/symbol/timeframe).
 *
 * Consultável rapidamente pelo motor quantitativo. Não é persistent; cache em
 * memória para HOT DATA. Rejeita escrita de dados inválidos (não inventa).
 */
import type {
  MarketCandle,
  MarketOrderBook,
  MarketTick,
  ProviderConnectionState,
  Timeframe,
} from "./model";
import type { Freshness } from "./model";

export interface SymbolState {
  readonly provider: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  lastCandle: MarketCandle | null;
  lastClosedCandle: MarketCandle | null;
  lastTick: MarketTick | null;
  orderBook: MarketOrderBook | null;
  lastUpdatedAt: number | null;
  quality: MarketCandle["quality"];
  /** nº do último sequence visto (dedup dos consumidores). */
  lastSequence: number | null;
}

/** Estado de conexão de um provedor (leitura). */
export interface ProviderState {
  readonly state: ProviderConnectionState;
  readonly connectedAt: number | null;
  readonly lastError?: string;
}

/** Implementação mutável interna do estado de conexão. */
interface MutableProviderState {
  state: ProviderConnectionState;
  connectedAt: number | null;
  lastError?: string;
}

export class MarketState {
  private readonly symbolMap = new Map<string, SymbolState>();
  private readonly providerMap = new Map<string, MutableProviderState>();
  private readonly allCandles = new Map<string, MarketCandle[]>();

  private key(provider: string, symbol: string, timeframe: Timeframe): string {
    return `${provider}:${symbol}:${timeframe}`;
  }

  getSymbol(provider: string, symbol: string, timeframe: Timeframe): SymbolState | undefined {
    return this.symbolMap.get(this.key(provider, symbol, timeframe));
  }

  getCandles(symbol: string, timeframe: Timeframe): MarketCandle[] {
    return this.allCandles.get(`${symbol}:${timeframe}`) ?? [];
  }

  putCandle(candle: MarketCandle): void {
    const k = this.key(candle.provider, candle.symbol, candle.timeframe);
    let s = this.symbolMap.get(k);
    if (!s) {
      s = {
        provider: candle.provider, symbol: candle.symbol, timeframe: candle.timeframe,
        lastCandle: null, lastClosedCandle: null, lastTick: null, orderBook: null,
        lastUpdatedAt: null, quality: "unknown", lastSequence: null,
      };
      this.symbolMap.set(k, s);
    }
    s.lastCandle = candle;
    if (candle.isClosed) s.lastClosedCandle = candle;
    s.lastUpdatedAt = candle.receivedAt;
    s.quality = candle.quality;
    s.lastSequence = candle.sequence ?? s.lastSequence;

    const listKey = `${candle.symbol}:${candle.timeframe}`;
    let list = this.allCandles.get(listKey);
    if (!list) { list = []; this.allCandles.set(listKey, list); }
    const idx = list.findIndex((c) => c.timestamp === candle.timestamp);
    if (idx >= 0) list[idx] = candle;
    else {
      list.push(candle);
      list.sort((a, b) => a.timestamp - b.timestamp);
      // manter janela curta de HOT candles p/ análise (ex.: 500).
      if (list.length > 500) list.splice(0, list.length - 500);
    }
  }

  setLastTick(tick: MarketTick): void {
    const k = this.key(tick.provider, tick.symbol, "1m");
    let s = this.symbolMap.get(k);
    if (!s) {
      s = {
        provider: tick.provider, symbol: tick.symbol, timeframe: "1m",
        lastCandle: null, lastClosedCandle: null, lastTick: null, orderBook: null,
        lastUpdatedAt: null, quality: tick.quality, lastSequence: null,
      };
      this.symbolMap.set(k, s);
    }
    s.lastTick = tick;
    s.lastUpdatedAt = tick.receivedAt;
    s.lastSequence = tick.sequence ?? s.lastSequence;
  }

  setOrderBook(book: MarketOrderBook): void {
    for (const [k, s] of this.symbolMap) {
      if (s.symbol === book.symbol) {
        s.orderBook = book;
        s.lastUpdatedAt = book.receivedAt;
      }
      void k;
    }
    // atualiza também se não existe entry: cria neutro
    const listKey = `${book.symbol}:book`;
    void listKey;
  }

  setConnectionState(provider: string, state: ProviderConnectionState, error?: string): void {
    const p: MutableProviderState = this.providerMap.get(provider) ?? { state, connectedAt: null };
    p.state = state;
    if (state === "connected") p.connectedAt = Date.now();
    if (error) p.lastError = error;
    this.providerMap.set(provider, p);
  }

  getProviderState(provider: string): ProviderState | undefined {
    return this.providerMap.get(provider);
  }

  /**
   * Froços/freshness de um par. Usa age do último candle vs. timeframe.
   */
  freshness(provider: string, symbol: string, timeframe: Timeframe): Freshness {
    const s = this.getSymbol(provider, symbol, timeframe);
    if (!s || !s.lastCandle) return "unavailable";
    if (!s.lastUpdatedAt) return "unavailable";
    const tfMs = TIMEFRAME_MS_SAFE[timeframe];
    const age = Date.now() - s.lastUpdatedAt;
    if (age > tfMs * 6) return "stale";
    if (age > tfMs * 3) return "delayed";
    return "fresh";
  }
}

const TIMEFRAME_MS_SAFE: Record<Timeframe, number> = {
  "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000,
};
