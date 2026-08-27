/**
 * Normalização de dados Binance → modelo canônico da Tracecon.
 *
 * Apenas converte o formato; NÃO valida (validação fica na DataQualityEngine)
 * e NÃO inventa dados. Endpoints verificados (ver docs/market-data/providers.md).
 */
import type { MarketCandle, MarketSymbol, MarketTick, Timeframe } from "./model";

const BINANCE_TIMEFRAME: Record<string, Timeframe> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};

/** REST kline → array [0..11]. `x` no WS indica fechado. */
export function normalizeKline(
  raw: unknown[],
  opts: { provider: string; symbol: string; timeframe: Timeframe; source: string; isClosed?: boolean; receivedAt?: number },
): MarketCandle {
  const v = raw as Array<string | number>;
  const receivedAt = opts.receivedAt ?? Date.now();
  const isClosed = opts.isClosed ?? receivedAt >= (Number(v[6]) || 0);
  return {
    provider: opts.provider,
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    open: Number(v[1]),
    high: Number(v[2]),
    low: Number(v[3]),
    close: Number(v[4]),
    volume: Number(v[5]),
    timestamp: Number(v[0]),
    receivedAt,
    isClosed,
    source: opts.source,
    quality: "unknown",
  };
}

/** WS kline de kline stream: { k: { t,o,h,l,c,v,x,i } }. Sempre payload cru do binance. */
export function normalizeWsKline(
  msg: { k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean }; s?: string },
  opts: { provider: string; timeframe: Timeframe; source: string; receivedAt?: number },
): MarketCandle {
  const k = msg.k!;
  const receivedAt = opts.receivedAt ?? Date.now();
  return {
    provider: opts.provider,
    symbol: msg.s ?? "",
    timeframe: opts.timeframe,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    timestamp: k.t,
    receivedAt,
    isClosed: k.x,
    source: opts.source,
    quality: "unknown",
  };
}

/** WS trade: { p, q, T, m }. */
export function normalizeWsTrade(
  msg: { p: string; q: string; T: number; m?: boolean },
  opts: { provider: string; symbol: string; source: string; receivedAt?: number },
): MarketTick {
  return {
    provider: opts.provider,
    symbol: opts.symbol,
    price: Number(msg.p),
    quantity: Number(msg.q),
    timestamp: msg.T,
    receivedAt: opts.receivedAt ?? Date.now(),
    source: opts.source,
    quality: "unknown",
    ...(msg.m !== undefined ? { side: msg.m ? "sell" : "buy" as const } : {}),
  };
}

/** Mapeia a string de intervalo binance para nosso Timeframe (ou null). */
export function toTimeframe(interval: string): Timeframe | null {
  return BINANCE_TIMEFRAME[interval] ?? null;
}

/** Extrai base/quote de um símbolo conhecido (ex.: BTCUSDT → BTC, USDT). */
export function parseSymbol(symbol: string): { baseAsset: string; quoteAsset: string; market: MarketSymbol["market"] } {
  // Ordem das moedas de quote mais comuns.
  const quotes = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USD", "BTC", "ETH", "BNB", "TRY", "EUR"];
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return { baseAsset: symbol.slice(0, symbol.length - q.length), quoteAsset: q, market: "crypto" };
    }
  }
  return { baseAsset: symbol, quoteAsset: "USD", market: "crypto" };
}
