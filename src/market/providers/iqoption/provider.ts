/**
 * IQ Option browser-session provider.
 *
 * It does not authenticate, open sockets, send subscriptions, or send orders.
 * A Chrome extension forwards a strictly normalized, numeric, inbound-only
 * market frame from a user-authenticated page session to `ingest`.
 */
import type { HistoricalPage, HistoricalSource } from "../../history";
import type { MarketCandle, MarketOrderBook, MarketSymbol, MarketTick, ProviderConnectionState, Timeframe } from "../../model";
import type { MarketDataProvider, MarketListener, SubscribeOptions } from "../../providerV2";
import { IqSymbolResolver, normalizeIqSymbol } from "./symbol-resolver";

export type IqBrowserFrame =
  | { readonly kind: "heartbeat"; readonly tabId: number; readonly serverTime: number; readonly receivedAt: number }
  | { readonly kind: "tick"; readonly tabId: number; readonly activeId: string | number; readonly symbol: string; readonly price: number; readonly timestamp: number; readonly sequence: number; readonly receivedAt: number; readonly bid?: number; readonly ask?: number }
  | { readonly kind: "candle"; readonly tabId: number; readonly activeId: string | number; readonly symbol: string; readonly timeframe: Timeframe; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number; readonly timestamp: number; readonly isClosed: boolean; readonly sequence: number; readonly receivedAt: number; readonly serverTime?: number; readonly bid?: number; readonly ask?: number };

export interface IqProviderHealth {
  readonly state: ProviderConnectionState;
  readonly lastFrameAt: number | null;
  readonly lastServerTime: number | null;
  readonly stale: boolean;
  readonly rejectedFrames: number;
}

export class IqOptionMarketProvider implements MarketDataProvider {
  readonly id = "iqoption";
  private _state: ProviderConnectionState = "disconnected";
  private _connectedAt: number | null = null;
  private readonly listeners = new Set<MarketListener>();
  private readonly resolver = new IqSymbolResolver();
  private readonly candles = new Map<string, MarketCandle[]>();
  private readonly ticks = new Map<string, MarketTick[]>();
  private readonly lastSequence = new Map<string, number>();
  private _lastFrameAt: number | null = null;
  private _lastServerTime: number | null = null;
  private rejectedFrames = 0;

  get state(): ProviderConnectionState { return this._state; }
  get connectedAt(): number | null { return this._connectedAt; }

  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this._state = "connecting";
    this.emit({ type: "status", state: "connecting" });
    // Browser session is the transport. It becomes connected only on a valid frame.
  }

  disconnect(): void {
    this._state = "disconnected";
    this._connectedAt = null;
    this.emit({ type: "status", state: "disconnected" });
  }

  getStatus(): ProviderConnectionState { return this._state; }

  health(now: number = Date.now(), staleAfterMs = 10_000): IqProviderHealth {
    const stale = this._lastFrameAt === null || now - this._lastFrameAt > staleAfterMs;
    return { state: stale && this._state === "connected" ? "reconnecting" : this._state, lastFrameAt: this._lastFrameAt, lastServerTime: this._lastServerTime, stale, rejectedFrames: this.rejectedFrames };
  }

  getServerTime(): number | null { return this._lastServerTime; }

  /** Ingests normalized inbound market data; returns false on schema/order rejection. */
  ingest(frame: unknown): boolean {
    if (!isIqBrowserFrame(frame) || !this.validFrame(frame)) return this.reject();
    this._lastFrameAt = frame.receivedAt;
    if ("serverTime" in frame && typeof frame.serverTime === "number") this._lastServerTime = frame.serverTime;
    if (this._state !== "connected") {
      this._state = "connected";
      this._connectedAt = frame.receivedAt;
      this.emit({ type: "status", state: "connected" });
    }
    if (frame.kind === "heartbeat") return true;
    const instrument = this.resolver.register(frame.activeId, frame.symbol);
    if (!instrument) return this.reject();
    const sequenceKey = `${frame.tabId}:${instrument.activeId}:${frame.kind}:${"timeframe" in frame ? frame.timeframe : "tick"}`;
    const previous = this.lastSequence.get(sequenceKey);
    if (previous !== undefined && frame.sequence <= previous) return this.reject();
    this.lastSequence.set(sequenceKey, frame.sequence);
    if (frame.kind === "tick") {
      const tick: MarketTick = { provider: this.id, symbol: instrument.symbol, price: frame.price, quantity: 0, timestamp: frame.timestamp, receivedAt: frame.receivedAt, source: "iqoption:browser-session", quality: "high", sequence: frame.sequence };
      this.push(this.ticks, instrument.symbol, tick);
      this.emit({ type: "tick", tick });
      return true;
    }
    const candle: MarketCandle = { provider: this.id, symbol: instrument.symbol, timeframe: frame.timeframe, open: frame.open, high: frame.high, low: frame.low, close: frame.close, volume: frame.volume, timestamp: frame.timestamp, receivedAt: frame.receivedAt, isClosed: frame.isClosed, source: "iqoption:browser-session", quality: "high", sequence: frame.sequence, estimatedDelayMs: Math.max(0, frame.receivedAt - (frame.serverTime ?? frame.timestamp)) };
    this.putCandle(candle);
    this.emit({ type: "candle", candle });
    return true;
  }

  async subscribe(_opts: SubscribeOptions, listener: MarketListener): Promise<() => void> {
    this.listeners.add(listener);
    if (this._state === "disconnected") await this.connect();
    return () => this.listeners.delete(listener);
  }

  async getTicker(symbol: string): Promise<{ price: number; quality: MarketCandle["quality"]; receivedAt: number; source: string }> {
    const tick = this.ticks.get(symbol)?.at(-1);
    const candle = this.candles.get(`${symbol}:1m`)?.at(-1);
    const source = tick ?? candle;
    if (!source) throw new Error("IQ Option browser session has no market data for symbol");
    return { price: "price" in source ? source.price : source.close, quality: source.quality, receivedAt: source.receivedAt, source: source.source };
  }

  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }): Promise<{ candles: MarketCandle[]; source: string; quality: MarketCandle["quality"] }> {
    const all = this.candles.get(`${params.symbol}:${params.timeframe}`) ?? [];
    const result = all.filter((c) => c.timestamp >= params.start && (params.end === undefined || c.timestamp <= params.end)).slice(-(params.limit ?? all.length));
    return { candles: result, source: "iqoption:browser-session", quality: result.length ? "high" : "unknown" };
  }

  async getTrades(symbol: string, limit = 100): Promise<{ trades: MarketTick[]; source: string }> { return { trades: (this.ticks.get(symbol) ?? []).slice(-limit), source: "iqoption:browser-session" }; }
  async getOrderBook(symbol: string, _limit?: number): Promise<MarketOrderBook> { const now = Date.now(); return { provider: this.id, symbol, bids: [], asks: [], timestamp: now, receivedAt: now, quality: "unknown" }; }
  async getMarketMetadata(symbol: string): Promise<MarketSymbol | null> { const parsed = normalizeIqSymbol(symbol); if (!parsed) return null; const base = parsed.symbol.slice(0, 3); const quote = parsed.symbol.slice(3, 6); return { symbol: parsed.symbol, provider: this.id, baseAsset: base, quoteAsset: quote, market: "forex" }; }
  get historical(): HistoricalSource { return { provider: this.id, fetchPage: async (params): Promise<HistoricalPage> => { const page = await this.getCandles(params); const last = page.candles.at(-1); return { candles: page.candles, nextStartTime: last && page.candles.length >= params.limit ? last.timestamp + 1 : null }; } }; }

  private validFrame(frame: IqBrowserFrame): boolean {
    if (!Number.isInteger(frame.tabId) || frame.tabId < 0 || !Number.isFinite(frame.receivedAt)) return false;
    if (frame.kind === "heartbeat") return Number.isFinite(frame.serverTime) && frame.serverTime > 0;
    if (!normalizeIqSymbol(frame.symbol) || !Number.isFinite(frame.timestamp) || frame.timestamp <= 0 || !Number.isInteger(frame.sequence) || frame.sequence < 0) return false;
    if (frame.kind === "tick") return Number.isFinite(frame.price) && frame.price > 0;
    return [frame.open, frame.high, frame.low, frame.close, frame.volume].every(Number.isFinite) && frame.open > 0 && frame.close > 0 && frame.high >= frame.low && frame.high >= frame.open && frame.high >= frame.close && frame.low <= frame.open && frame.low <= frame.close && frame.volume >= 0;
  }
  private reject(): false { this.rejectedFrames += 1; return false; }
  private putCandle(candle: MarketCandle): void { const key = `${candle.symbol}:${candle.timeframe}`; const list = this.candles.get(key) ?? []; const index = list.findIndex((existing) => existing.timestamp === candle.timestamp); if (index >= 0) list[index] = candle; else list.push(candle); list.sort((a, b) => a.timestamp - b.timestamp); if (list.length > 2_000) list.splice(0, list.length - 2_000); this.candles.set(key, list); }
  private push<T>(map: Map<string, T[]>, key: string, item: T): void { const list = map.get(key) ?? []; list.push(item); if (list.length > 5_000) list.splice(0, list.length - 5_000); map.set(key, list); }
  private emit(event: Parameters<MarketListener>[0]): void { for (const listener of this.listeners) listener(event); }
}

function isIqBrowserFrame(value: unknown): value is IqBrowserFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  return frame.kind === "heartbeat" || frame.kind === "tick" || frame.kind === "candle";
}
