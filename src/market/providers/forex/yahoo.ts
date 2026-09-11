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
  /** Polling interval used by the read-only subscription adapter. */
  readonly pollIntervalMs?: number;
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
const yahooInterval = (timeframe: Timeframe): string => ({ "1m": "1m", "3m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "1h", "1d": "1d" })[timeframe];
/** Yahoo does not expose every canonical TraceCon timeframe. These two are
 * built only from smaller real candles; no bucket is emitted when there is a
 * source gap, so aggregation never fabricates OHLC. */
const yahooSourceTimeframe = (timeframe: Timeframe): Timeframe => timeframe === "3m" ? "1m" : timeframe === "4h" ? "1h" : timeframe;
const yahooRange = (timeframe: Timeframe): string => {
  const source = yahooSourceTimeframe(timeframe);
  return source === "1m" || source === "3m" || source === "5m" || source === "15m" ? "7d" : "1y";
};

export class YahooForexProvider implements MarketDataProvider {
  readonly id = "yahoo-forex";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private stateValue: MarketDataProvider["state"] = "disconnected";
  private connectedAtValue: number | null = null;
  private readonly listeners = new Set<MarketListener>();
  private readonly timers = new Set<ReturnType<typeof setInterval>>();

  constructor(options: YahooForexOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CHART_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.pollIntervalMs = Math.max(15_000, options.pollIntervalMs ?? 60_000);
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
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.stateValue = "disconnected";
    this.connectedAtValue = null;
    this.emit({ type: "status", state: "disconnected" });
    this.listeners.clear();
  }

  async subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void> {
    this.assertSymbol(opts.symbol);
    if (this.stateValue !== "connected") await this.connect();
    this.listeners.add(listener);
    const timeframes = opts.timeframes?.length ? opts.timeframes : ["1m" as const];
    let active = true;
    const poll = async (): Promise<void> => {
      if (!active) return;
      try {
        const end = Date.now();
        for (const timeframe of timeframes) {
          const step = TIMEFRAME_MS[timeframe];
          const result = await this.getCandles({
            symbol: opts.symbol,
            timeframe,
            start: end - step * 3,
            end,
            limit: 3,
          });
          for (const candle of result.candles) listener({ type: "candle", candle });
        }
        if (this.stateValue !== "connected") {
          this.stateValue = "connected";
          listener({ type: "status", state: "connected" });
        }
      } catch (error) {
        this.stateValue = "reconnecting";
        listener({ type: "status", state: "reconnecting", error: String(error instanceof Error ? error.message : error) });
      }
    };
    const timer = setInterval(() => void poll(), this.pollIntervalMs);
    this.timers.add(timer);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
      this.timers.delete(timer);
      this.listeners.delete(listener);
    };
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
    const sourceTimeframe = yahooSourceTimeframe(params.timeframe);
    const sourceStep = TIMEFRAME_MS[sourceTimeframe];
    const targetStep = TIMEFRAME_MS[params.timeframe];
    const requestStart = params.timeframe === sourceTimeframe ? params.start : params.start - (targetStep - sourceStep);
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
      const out: MarketCandle[] = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        const timestamp = Number(result.timestamp[i]) * 1000;
        const open = quote.open?.[i]; const high = quote.high?.[i]; const low = quote.low?.[i]; const close = quote.close?.[i];
        if (![timestamp, open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
        if (timestamp < requestStart || timestamp >= end) continue;
        const isClosed = timestamp + sourceStep <= receivedAt;
        if (!isClosed) continue;
        if ((high as number) < Math.max(open as number, close as number) || (low as number) > Math.min(open as number, close as number)) continue;
        out.push({ provider: this.id, symbol: params.symbol, timeframe: sourceTimeframe, open: open as number, high: high as number, low: low as number, close: close as number, volume: Number(quote.volume?.[i] ?? 0), timestamp, receivedAt, isClosed: true, source: "rest:yahoo-chart", quality: "high", estimatedDelayMs: Math.max(0, receivedAt - (timestamp + sourceStep)) });
      }
      out.sort((a, b) => a.timestamp - b.timestamp);
      const dedup = Array.from(new Map(out.map((c) => [c.timestamp, c])).values());
      const normalized = sourceTimeframe === params.timeframe
        ? dedup.map((c) => ({ ...c, timeframe: params.timeframe }))
        : aggregateCandles(dedup, params.symbol, params.timeframe, sourceStep, targetStep);
      const filtered = normalized.filter((c) => c.timestamp >= params.start && c.timestamp < end);
      return { candles: filtered.slice(-(params.limit ?? filtered.length)), source: "rest:yahoo-chart", quality: filtered.length ? "high" as const : "unknown" as const };
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

function aggregateCandles(
  source: readonly MarketCandle[],
  symbol: string,
  timeframe: Timeframe,
  sourceStep: number,
  targetStep: number,
): MarketCandle[] {
  const buckets = new Map<number, MarketCandle[]>();
  for (const candle of source) {
    const bucket = Math.floor(candle.timestamp / targetStep) * targetStep;
    const rows = buckets.get(bucket) ?? [];
    rows.push(candle);
    buckets.set(bucket, rows);
  }
  const expected = targetStep / sourceStep;
  const out: MarketCandle[] = [];
  for (const [timestamp, rows] of buckets) {
    rows.sort((a, b) => a.timestamp - b.timestamp);
    if (rows.length !== expected) continue;
    if (rows.some((c, index) => c.timestamp !== timestamp + index * sourceStep)) continue;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const receivedAt = Math.max(...rows.map((c) => c.receivedAt));
    out.push({
      provider: first.provider,
      symbol,
      timeframe,
      open: first.open,
      high: Math.max(...rows.map((c) => c.high)),
      low: Math.min(...rows.map((c) => c.low)),
      close: last.close,
      volume: rows.reduce((sum, c) => sum + c.volume, 0),
      timestamp,
      receivedAt,
      isClosed: true,
      source: "rest:yahoo-chart:aggregate",
      quality: "high",
      estimatedDelayMs: Math.max(0, receivedAt - (timestamp + targetStep)),
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}
