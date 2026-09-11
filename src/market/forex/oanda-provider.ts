/**
 * OandaForexProvider — implementação concreta do ForexProvider contra a API v20.
 *
 * URL base produção: https://api-fxtrade.oanda.com/v3
 * URL sandbox: https://api-fxpractice.oanda.com/v3
 *
 * Endpoints usados:
 *   GET /v3/accounts/{id}/pricing?instruments=EUR_USD   → pricing stream (snapshot)
 *   GET /v3/instruments/{pair}/candles?granularity=M1&from=...&to=...   → candles
 *   GET /v3/accounts/{id}                                 → health
 *
 * Doc: https://developer.oanda.com/rest-live-v20/introduction
 *
 * IMPORTANTE:
 * - OANDA retorna timestamps RFC3339 (ex: "2024-01-15T14:30:00.000000000Z").
 * - Pares OANDA são "EUR_USD" (sem barra).
 * - Granularities: S5, S10, S15, S30, M1, M2, M4, M5, M10, M15, M30, H1, H2, H3, H4, H6, H8, H12, D, W, M.
 */
import type { Timeframe } from "../model";
import type { ForexPair, Quote, MarketTick, DataFreshness } from "./types";
import {
  computeSpreadPips, validateQuote, msToRfc3339,
} from "./types";
import type {
  ForexProvider, ForexCandle, ProviderHealth, ProviderSnapshot,
  ProviderFactoryOpts,
} from "./provider";

/** Converte ForexPair.canonical "EUR/USD" → "EUR_USD" esperado pela OANDA. */
export function pairToOanda(pair: ForexPair): string {
  return pair.canonical.replace("/", "_");
}

/** Converte timeframe "1m" → "M1" esperado pela OANDA. */
export function timeframeToOanda(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    "1m": "M1",
    "3m": "M3",
    "5m": "M5",
    "15m": "M15",
    "1h": "H1",
    "4h": "H4",
    "1d": "D",
  };
  return map[tf] ?? "H1";
}

/** Converte timeframe OANDA "M1" → "1m" esperado pelo sistema. */
export function oandaToTimeframe(granularity: string): Timeframe | null {
  const map: Record<string, Timeframe> = {
    M1: "1m",
    M3: "3m",
    M5: "5m",
    M15: "15m",
    H1: "1h",
    H4: "4h",
    D: "1d",
  };
  return map[granularity] ?? null;
}

interface OandaQuoteResponse {
  prices: Array<{
    type: string;
    time: string;
    bids: Array<{ price: string; liquidity: number }>;
    asks: Array<{ price: string; liquidity: number }>;
    closeoutBid?: string;
    closeoutAsk?: string;
    status: string;
    instrument: string;
  }>;
}

interface OandaCandlesResponse {
  instrument: string;
  granularity: string;
  candles: Array<{
    time: string;
    bid?: { o: string; h: string; l: string; c: string };
    ask?: { o: string; h: string; l: string; c: string };
    mid?: { o: string; h: string; l: string; c: string };
    volume: number;
    complete: boolean;
  }>;
}

/** Provider concreto para OANDA v20. */
export class OandaForexProvider implements ForexProvider {
  readonly id = "oanda";
  readonly displayName = "OANDA v20";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly accountId: string;

  constructor(opts: ProviderFactoryOpts) {
    this.baseUrl = opts.baseUrl ?? "https://api-fxpractice.oanda.com/v3";
    this.apiKey = opts.apiKey ?? "";
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.accountId = opts.accountId?.trim() ?? "";
  }

  private async fetchJson<T>(path: string): Promise<T> {
    if (!this.apiKey || !this.accountId) {
      throw new Error("OANDA não configurado: defina OANDA_API_KEY e OANDA_ACCOUNT_ID no servidor");
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Accept": "application/json",
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`OANDA ${path} → ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchQuote(pair: ForexPair): Promise<Quote> {
    const instrument = pairToOanda(pair);
    const data = await this.fetchJson<OandaQuoteResponse>(
      `/accounts/${this.accountId}/pricing?instruments=${instrument}`,
    );
    const p = data.prices[0];
    if (!p) throw new Error(`OANDA: sem quote para ${instrument}`);
    const bid = p.closeoutBid ? Number(p.closeoutBid) : Number(p.bids[0]?.price ?? 0);
    const ask = p.closeoutAsk ? Number(p.closeoutAsk) : Number(p.asks[0]?.price ?? 0);
    if (bid <= 0 || ask <= 0) throw new Error(`OANDA: bid/ask inválido (${bid}/${ask})`);
    return {
      symbol: pair.canonical,
      bid,
      ask,
      spread: ask - bid,
      spreadPips: computeSpreadPips({
        symbol: pair.canonical, bid, ask, spread: ask - bid,
        spreadPips: 0, mid: (bid + ask) / 2, timestamp: 0, venue: "oanda",
        pipSize: pair.pipSize,
      }),
      mid: (bid + ask) / 2,
      timestamp: Date.parse(p.time),
      venue: this.id,
      pipSize: pair.pipSize,
    };
  }

  async fetchCandles(
    pair: ForexPair,
    timeframe: Timeframe,
    startMs: number,
    endMs: number,
  ): Promise<ReadonlyArray<ForexCandle>> {
    const instrument = pairToOanda(pair);
    const granularity = timeframeToOanda(timeframe);
    const data = await this.fetchJson<OandaCandlesResponse>(
      `/instruments/${instrument}/candles?granularity=${granularity}` +
        `&from=${msToRfc3339(startMs)}&to=${msToRfc3339(endMs)}`,
    );
    const result: ForexCandle[] = [];
    for (const c of data.candles) {
      // Candle em formação nunca entra em backtest/fusion como evidência fechada.
      if (!c.mid || !c.complete) continue;
      result.push({
        symbol: pair.canonical,
        timestamp: Date.parse(c.time),
        open: Number(c.mid.o),
        high: Number(c.mid.h),
        low: Number(c.mid.l),
        close: Number(c.mid.c),
        bidClose: c.bid ? Number(c.bid.c) : null,
        askClose: c.ask ? Number(c.ask.c) : null,
        volume: c.volume,
        source: this.id,
        quality: "high",
      });
    }
    return result;
  }

  async health(): Promise<ProviderHealth> {
    const t0 = Date.now();
    try {
      // Endpoint /v3/accounts sem ID retorna 400; usamos pricing sem instruments para heart.
      await this.fetchJson<{ prices: unknown[] }>(
      `/accounts/${this.accountId}/pricing?instruments=EUR_USD`,
      );
      return { ok: true, latencyMs: Date.now() - t0, lastCheck: Date.now(), errorMessage: null };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        lastCheck: Date.now(),
        errorMessage: String(e instanceof Error ? e.message : e),
      };
    }
  }
}

/** Factory para DI. */
export function createOandaProvider(opts: ProviderFactoryOpts): ForexProvider {
  return new OandaForexProvider(opts);
}

/** Provider concreto MOCK para testes e offline. */
export class MockForexProvider implements ForexProvider {
  readonly id = "mock";
  readonly displayName = "Mock (offline)";

  private readonly quotes = new Map<string, { bid: number; ask: number; ts: number }>();

  async fetchQuote(pair: ForexPair): Promise<Quote> {
    // Bid/ask determinísticos baseados em hash do símbolo.
    const seed = pair.canonical.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const basePrice = pair.base === "USD" ? 1.0 + seed * 0.001 : 1.0 + seed * 0.01;
    const spread = pair.pricePrecision === 3 ? 0.01 : 0.0001;
    const bid = basePrice;
    const ask = basePrice + spread;
    const ts = Date.now();
    this.quotes.set(pair.canonical, { bid, ask, ts });
    return {
      symbol: pair.canonical,
      bid,
      ask,
      spread,
      spreadPips: 1,
      mid: (bid + ask) / 2,
      timestamp: ts,
      venue: this.id,
      pipSize: pair.pipSize,
    };
  }

  async fetchCandles(
    pair: ForexPair,
    timeframe: Timeframe,
    startMs: number,
    endMs: number,
  ): Promise<ReadonlyArray<ForexCandle>> {
    const FRAME_MS: Record<Timeframe, number> = {
      "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
      "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
    };
    const step = FRAME_MS[timeframe] ?? 3_600_000;
    const out: ForexCandle[] = [];
    const q = await this.fetchQuote(pair);
    let price = q.mid;
    // Random walk determinístico.
    let seed = pair.canonical.length;
    for (let t = startMs; t <= endMs; t += step) {
      seed = (seed * 1103515245 + 12345) % 2147483647;
      const drift = ((seed % 200) - 100) / 10000;
      price = price + drift;
      const open = price;
      const close = price + drift / 2;
      const high = Math.max(open, close) + Math.abs(drift) * 0.5;
      const low = Math.min(open, close) - Math.abs(drift) * 0.5;
      out.push({
        symbol: pair.canonical,
        timestamp: t,
        open,
        high,
        low,
        close,
        bidClose: close - q.spread / 2,
        askClose: close + q.spread / 2,
        volume: 1000 + (seed % 500),
        source: this.id,
        quality: "high",
      });
    }
    return out;
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true, latencyMs: 1, lastCheck: Date.now(), errorMessage: null };
  }
}

export function createMockProvider(): ForexProvider {
  return new MockForexProvider();
}
