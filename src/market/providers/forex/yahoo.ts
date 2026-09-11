/**
 * Yahoo Finance Chart adapter for read-only Forex market data.
 *
 * The chart endpoint is a public market-data feed (no account or trading
 * capability). It is used only as a Forex fallback when OANDA is unavailable.
 * The adapter fails closed on HTTP/schema/gap errors and never fabricates OHLC.
 */
import type { HistoricalPage, HistoricalSource } from "../../history";
import type { MarketCandle, MarketOrderBook, MarketSymbol, Timeframe } from "../../model";
import { TIMEFRAME_MS } from "../../model";
import type { MarketDataProvider, MarketListener, SubscribeOptions } from "../../providerV2";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const SYMBOLS = new Set(["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"]);

export interface YahooForexOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
      meta?: { currency?: string; instrumentType?: string; symbol?: string };
    }>;
    error?: unknown;
  };
};

const yahooSymbol = (symbol: string): string => `${symbol.replace("/", "")}=X`;
const yahooInterval = (timeframe: Timeframe): string => ({ "1m": "1m", "3m": "5m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "1h", "1d": "1d" })[timeframe];
const yahooRange = (timeframe: Timeframe): string => timeframe === "1m" || timeframe === "3m" || timeframe === "5m" || timeframe === "15m" ? "7d" : "1y";

export class YahooForexProvider implements MarketDataProvider {
  readonly id = "yahoo-forex";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private stateValue: MarketDataProvider["state"] = "disconnected";
  private connectedAtValue: number | null = null;
  private readonly listeners = new Set<MarketListener>();

  constructor(options: YahooForexOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CHART_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get state(): MarketDataProvider["state"] { return this.stateValue; }
  get connectedAt(): number | null { return this.connectedAtValue; }
  getStatus(): MarketDataProvider["state"] { return this.stateValue; }

  async connect(): Promise<void> {
    if (this.stateValue === "connected") return;
    this.stateValue = "connecting";
    this.emit({ type: "status", state: "connecting" });
    try {
      const sample = await this.getCandles({ symbol: "EUR/USD", timeframe: "1m", start: Date.now() - 20 * 60_000, end: Date.now(), limit: 10 });
      if (sample.candles.length < 2) throw new Error("Yahoo Forex sem candles fechados");
      this.stateValue = "connected";
      this.connectedAtValue = Date.now();
      this.emit({ type: "status", state: "connected" });
    } catch (error) {
      this.stateValue = "error";
      this.emit({ type: "status", state: "error", error: String(error instanceof Error ? error.message : error) });
      throw error;
    }
  }

  disconnect(): void {
    this.stateValue = "disconnected";
    this.connectedAtValue = null;
    this.listeners.clear();
    this.emit({ type: "status", state: "disconnected" });
  }

  async subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void> {
    this.assertSymbol(opts.symbol);
    if (this.stateValue !== "connected") await this.connect();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getTicker(symbol: string) {
    this.assertSymbol(symbol);
    const candles = await this.getCandles({ symbol, timeframe: "1m", start: Date.now() - 10 * 60_000, end: Date.now(), limit: 10 });
    const last = candles.candles.at(-1);
    if (!last) throw new Error(`Yahoo Forex sem ticker fechado para ${symbol}`);
    return { price: last.close, quality: last.quality, receivedAt: last.receivedAt, source: last.source };
  }

  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }) {
    this.assertSymbol(params.symbol);
    const end = params.end ?? Date.now();
    const interval = yahooInterval(params.timeframe);
    const url = `${this.baseUrl}/${encodeURIComponent(yahooSymbol(params.symbol))}?interval=${interval}&range=${yahooRange(params.timeframe)}&includePrePost=false&events=div%2Csplits`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { headers: { "User-Agent": "tracecon/0.2" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Yahoo Finance HTTP ${response.status}`);
      const payload = await response.json() as ChartPayload;
      const result = payload.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote) throw new Error("Yahoo Forex schema sem quote");
      const receivedAt = Date.now();
      const step = TIMEFRAME_MS[params.timeframe];
      const out: MarketCandle[] = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        const timestamp = Number(result.timestamp[i]) * 1000;
        const open = quote.open?.[i]; const high = quote.high?.[i]; const low = quote.low?.[i]; const close = quote.close?.[i];
        if (![timestamp, open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
        if (timestamp < params.start || timestamp >= end) continue;
        const isClosed = timestamp + step <= receivedAt;
        if (!isClosed) continue;
        if ((high as number) < Math.max(open as number, close as number) || (low as number) > Math.min(open as number, close as number)) continue;
        out.push({ provider: this.id, symbol: params.symbol, timeframe: params.timeframe, open: open as number, high: high as number, low: low as number, close: close as number, volume: Number(quote.volume?.[i] ?? 0), timestamp, receivedAt, isClosed: true, source: "rest:yahoo-chart", quality: "high", estimatedDelayMs: Math.max(0, receivedAt - (timestamp + step)) });
      }
      out.sort((a, b) => a.timestamp - b.timestamp);
      const dedup = Array.from(new Map(out.map((c) => [c.timestamp, c])).values());
      return { candles: dedup.slice(-(params.limit ?? dedup.length)), source: "rest:yahoo-chart", quality: dedup.length ? "high" as const : "unknown" as const };
    } finally {
      clearTimeout(timer);
    }
  }

  async getTrades(_symbol: string) { this.assertSymbol(_symbol); return { trades: [], source: "rest:yahoo-chart:no-trades" }; }

  async getOrderBook(symbol: string): Promise<MarketOrderBook> {
    this.assertSymbol(symbol);
    const now = Date.now();
    return { provider: this.id, symbol, bids: [], asks: [], timestamp: now, receivedAt: now, quality: "unknown" };
  }

  async getMarketMetadata(symbol: string): Promise<MarketSymbol | null> {
    this.assertSymbol(symbol);
    const [base, quote] = symbol.split("/");
    return { symbol, provider: this.id, baseAsset: base ?? "", quoteAsset: quote ?? "", market: "forex" };
  }

  get historical(): HistoricalSource {
    return { provider: this.id, fetchPage: async (params): Promise<HistoricalPage> => {
      const result = await this.getCandles(params);
      const last = result.candles.at(-1);
      const next = last ? last.timestamp + TIMEFRAME_MS[params.timeframe] : null;
      return { candles: result.candles, nextStartTime: result.candles.length >= params.limit && next !== null && next < params.end ? next : null };
    } };
  }

  private assertSymbol(symbol: string): void { if (!SYMBOLS.has(symbol.toUpperCase())) throw new Error(`Yahoo Forex símbolo não suportado: ${symbol}`); }
  private emit(event: Parameters<MarketListener>[0]): void { for (const listener of this.listeners) listener(event); }
}
