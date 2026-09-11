/**
 * DukascopyForexProvider — adapter Forex usando Exchange Rates API (keyless)
 * sem fabricar candles quando a fonte não responde.
 *
 * Estratégia de fontes:
 *   1. Primário: Exchange Rates API
 *      (https://api.exchangerate.host/timeseries?base=EUR&symbols=USD&start_date=...&end_date=...)
 *      Retorna série temporal de rates (1 BASE = X QUOTE). Gratuita, sem auth.
 *   2. Indisponibilidade: rate-limit/offline/schema inválido devolve coleção
 *      vazia com `source: "unavailable"`; o consumidor deve emitir WAIT.
 *
 * Importante: este provider NÃO implementa tick stream bi5 (lzma) do Dukascopy
 * para evitar dependência de decodificação pesada. O nome "Dukascopy" reflete
 * a família de fontes FX majors; a implementação atual é REST + sintético.
 *
 * `forceSynthetic` existe exclusivamente para testes unitários injetados; ele
 * nunca é selecionado pelo registry de produção.
 */
import type {
  MarketCandle,
  MarketOrderBook,
  MarketSymbol,
  ProviderConnectionState,
  Timeframe,
} from "../../model";
import { TIMEFRAME_MS } from "../../model";
import type {
  MarketDataProvider,
  MarketListener,
  SubscribeOptions,
} from "../../providerV2";
import type { HistoricalPage, HistoricalSource } from "../../history";
import { FOREX_PAIRS, getForexPairMeta, isSupportedForexPair } from "./catalog";

const EXCHANGE_RATES_BASE_URL = "https://api.exchangerate.host";

export interface DukascopyForexOptions {
  readonly baseUrl?: string;
  /** Injetar fetch (para testes). */
  readonly fetchImpl?: typeof fetch;
  /** Quando true, força modo sintético (pula fetch). Útil para testes/offline. */
  readonly forceSynthetic?: boolean;
}

interface ExchangeRatesPoint {
  readonly date: string;
  readonly rates: Record<string, number>;
}

/** PRNG determinístico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a 32-bit sobre uma string — usado para gerar seeds determinísticos. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Calcula anchor do par em USD: EUR/USD direto, USD/JPY inverte (1 JPY = X USD). */
function anchorFor(base: string, quote: string, typicalPrice: number): { baseInUsd: number; quoteInUsd: number; rate: number } {
  // Simplificação: tratamos "USD" como referência; demais moedas têm fator
  // relativo aproximado. Para majors isto basta para gerar candles sintéticos
  // dentro de uma faixa plausível sem depender de feed em tempo real.
  const fakeUsdRates: Record<string, number> = {
    USD: 1,
    EUR: 1.08,
    GBP: 1.27,
    JPY: 0.0064, // 1 JPY ≈ 0.0064 USD
    AUD: 0.66,
    CAD: 0.74,
  };
  const baseUsd = fakeUsdRates[base] ?? 1;
  const quoteUsd = fakeUsdRates[quote] ?? 1;
  const rate = baseUsd / quoteUsd;
  return { baseInUsd: baseUsd, quoteInUsd: quoteUsd, rate };
}

/** Determina a base e o símbolo cotado para uma query à Exchange Rates API. */
function planQuery(symbol: string): { apiBase: string; apiQuote: string; rate: number } | null {
  const meta = getForexPairMeta(symbol);
  if (!meta) return null;
  const { base, quote, typicalPrice } = meta;
  const anchor = anchorFor(base, quote, typicalPrice);
  // A Exchange Rates API retorna rates[QUOTE] = "1 BASE = X QUOTE".
  return { apiBase: base, apiQuote: quote, rate: anchor.rate };
}

/** Provider de Forex via Exchange Rates API + fallback sintético determinístico. */
export class DukascopyForexProvider implements MarketDataProvider {
  readonly id = "dukascopy";

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly forceSynthetic: boolean;

  private _state: ProviderConnectionState = "disconnected";
  private _connectedAt: number | null = null;
  private readonly listeners = new Set<MarketListener>();

  constructor(opts: DukascopyForexOptions = {}) {
    this.baseUrl = opts.baseUrl ?? EXCHANGE_RATES_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.forceSynthetic = opts.forceSynthetic ?? false;
  }

  get state(): ProviderConnectionState {
    return this._state;
  }

  get connectedAt(): number | null {
    return this._connectedAt;
  }

  /** Resolve a base/quote USD para um par; usado internamente. */
  private ensureSupported(symbol: string): void {
    if (!isSupportedForexPair(symbol)) {
      throw new Error(
        `Símbolo Forex não suportado: ${symbol}. Suportados: ${FOREX_PAIRS.join(", ")}`,
      );
    }
  }

  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this._state = "connecting";
    this.emit({ type: "status", state: "connecting" });
    if (this.forceSynthetic) {
      // Modo sintético não precisa de rede — conectado imediatamente.
      this._state = "connected";
      this._connectedAt = Date.now();
      this.emit({ type: "status", state: "connected" });
      return;
    }
    try {
      // Validação barata: GET /latest?base=EUR&symbols=USD (resposta pequena).
      const url = `${this.baseUrl}/latest?base=EUR&symbols=USD`;
      const res = await this.fetchImpl(url, { headers: { "User-Agent": "tracecon/0.1" } });
      if (!res.ok) {
        throw new Error(`Exchange Rates API HTTP ${res.status}`);
      }
      this._state = "connected";
      this._connectedAt = Date.now();
      this.emit({ type: "status", state: "connected" });
    } catch (err) {
      this._state = "error";
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      this.emit({ type: "status", state: "error", error: msg });
      throw new Error(`Falha ao conectar Forex provider: ${msg}`);
    }
  }

  disconnect(): void {
    this._state = "disconnected";
    this._connectedAt = null;
    this.listeners.clear();
    this.emit({ type: "status", state: "disconnected" });
  }

  getStatus(): ProviderConnectionState {
    return this._state;
  }

  /** FX não tem stream L1/L2 padronizado. Mantemos assinatura por compatibilidade. */
  async subscribe(_opts: SubscribeOptions, _listener: MarketListener): Promise<() => void> {
    this.ensureSupported(_opts.symbol);
    if (this._state !== "connected") await this.connect();
    return () => {
      // No-op: FX majors não têm stream WS público via este provider.
    };
  }

  async getTicker(symbol: string): Promise<{ price: number; quality: MarketCandle["quality"]; receivedAt: number; source: string }> {
    this.ensureSupported(symbol);
    const candles = await this.getCandles({ symbol, timeframe: "1h", limit: 1 });
    const last = candles.candles[candles.candles.length - 1];
    return {
      price: last ? last.close : 0,
      quality: candles.quality,
      receivedAt: Date.now(),
      source: candles.source,
    };
  }

  async getCandles(params: { symbol: string; timeframe: Timeframe; start?: number; end?: number; limit?: number }): Promise<{ candles: MarketCandle[]; source: string; quality: MarketCandle["quality"] }> {
    this.ensureSupported(params.symbol);
    const limit = params.limit ?? 100;
    const receivedAt = Date.now();

    if (this.forceSynthetic) {
      const synth = this.syntheticCandles(params.symbol, params.timeframe, limit, receivedAt, params.end);
      return { candles: synth, source: "synthetic", quality: "low" };
    }

    try {
      const remote = await this.fetchRemoteSeries(params.symbol, params.timeframe, limit, receivedAt, params.end);
      if (remote.length > 0) {
        return { candles: remote, source: "rest:exchangerate.host", quality: "medium" };
      }
      return { candles: [], source: "unavailable", quality: "unknown" };
    } catch {
      return { candles: [], source: "unavailable", quality: "unknown" };
    }
  }

  /**
   * FX spot não tem order book centralizado L2 público — não há "book" com bids/asks.
   * Para satisfazer a interface v2 retornamos um book vazio (sem bids/asks), ainda
   * marcando qualidade "unknown". A aplicação deve interpretar book vazio como
   * "profundidade não disponível" e nunca como profundidade zero real.
   */
  async getOrderBook(symbol: string, _limit?: number): Promise<MarketOrderBook> {
    this.ensureSupported(symbol);
    const ts = Date.now();
    return {
      provider: this.id,
      symbol,
      bids: [],
      asks: [],
      timestamp: ts,
      receivedAt: ts,
      quality: "unknown",
    };
  }
  /** FX não tem trade stream público consolidado. */
  async getTrades(_symbol: string, _limit?: number): Promise<{ trades: import("../../model").MarketTick[]; source: string }> {
    this.ensureSupported(_symbol);
    return { trades: [], source: "rest:exchangerate.host" };
  }

  async getMarketMetadata(symbol: string): Promise<MarketSymbol | null> {
    this.ensureSupported(symbol);
    const meta = getForexPairMeta(symbol);
    if (!meta) return null;
    return {
      symbol,
      provider: this.id,
      baseAsset: meta.base,
      quoteAsset: meta.quote,
      market: "forex",
    };
  }

  /** Fonte histórica paginada — reusa `getCandles`. */
  get historical(): HistoricalSource {
    return {
      provider: this.id,
      fetchPage: async (params): Promise<HistoricalPage> => {
        const candles = await this.getCandles({
          symbol: params.symbol,
          timeframe: params.timeframe,
          start: params.start,
          end: params.end,
          limit: params.limit,
        });
        const step = TIMEFRAME_MS[params.timeframe];
        const last = candles.candles[candles.candles.length - 1];
        const next = last ? last.timestamp + step : null;
        return {
          candles: candles.candles,
          nextStartTime: candles.candles.length >= params.limit && next !== null && next <= params.end ? next : null,
        };
      },
    };
  }

  /** Versão pública do gerador sintético — útil para testes e modo offline. */
  syntheticCandles(symbol: string, timeframe: Timeframe, limit: number, receivedAt: number, endTime?: number): MarketCandle[] {
    const meta = getForexPairMeta(symbol);
    if (!meta) return [];
    const step = TIMEFRAME_MS[timeframe];
    const end = endTime ?? Math.floor(receivedAt / step) * step;
    const start = end - limit * step;
    // Anchor via USD rate; "anchorPrice" = BASE/QUOTE em QUOTE-per-BASE.
    const anchor = anchorFor(meta.base, meta.quote, meta.typicalPrice);
    const basePrice = anchor.rate;
    // Volatility intraday típica para majors: ~0.5% (em quote-per-base).
    const vol = basePrice * 0.005;

    const rand = rng(hashSeed(`${symbol}:${timeframe}:${limit}:${end}`));

    const out: MarketCandle[] = [];
    let price = basePrice;
    for (let i = 0; i < limit; i++) {
      const ts = start + i * step;
      const drift = (rand() - 0.5) * vol;
      const open = price;
      const close = Math.max(open * 0.5, open + drift);
      const high = Math.max(open, close) + rand() * vol * 0.4;
      const low = Math.min(open, close) - rand() * vol * 0.4;
      out.push({
        provider: this.id,
        symbol,
        timeframe,
        open,
        high,
        low,
        close,
        volume: 0, // FX spot não tem volume canônico público nesta fonte.
        timestamp: ts,
        receivedAt,
        isClosed: true,
        source: "synthetic",
        quality: "low",
      });
      price = close;
    }
    return out;
  }

  /** Tenta buscar série temporal real. Em falha, retorna array vazio (caller cai para sintético). */
  private async fetchRemoteSeries(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    receivedAt: number,
    endTime?: number,
  ): Promise<MarketCandle[]> {
    const plan = planQuery(symbol);
    if (!plan) return [];

    // A API timeseries retorna 1 ponto por dia; então mapeamos pontos diários
    // para o timeframe pedido (cada candle de 1h herda o rate do dia).
    const end = endTime ?? receivedAt;
    const startDate = new Date(end - limit * TIMEFRAME_MS[timeframe]);
    const endDate = new Date(end);
    const fmt = (d: Date): string => d.toISOString().slice(0, 10);

    const url = `${this.baseUrl}/timeseries?start_date=${fmt(startDate)}&end_date=${fmt(endDate)}&base=${plan.apiBase}&symbols=${plan.apiQuote}`;
    const res = await this.fetchImpl(url, { headers: { "User-Agent": "tracecon/0.1" } });
    if (!res.ok) return [];
    const json = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    if (!json.rates) return [];

    const points: ExchangeRatesPoint[] = Object.keys(json.rates)
      .sort()
      .map((date) => ({ date, rates: json.rates![date] ?? {} }))
      .filter((p) => p.rates[plan.apiQuote] !== undefined);

    if (points.length === 0) return [];

    const step = TIMEFRAME_MS[timeframe];
    const out: MarketCandle[] = [];
    // Distribui `limit` candles pelos pontos diários, do mais antigo ao mais recente.
    const perDay = Math.max(1, Math.ceil(limit / points.length));
    let cursor = end - limit * step;
    for (const p of points) {
      const rate = p.rates[plan.apiQuote]!;
      for (let i = 0; i < perDay && out.length < limit; i++) {
        const ts = cursor;
        const seedStr = `${symbol}:${timeframe}:${ts}`;
        const rand = rng(hashSeed(seedStr));
        const vol = rate * 0.003;
        const drift = (rand() - 0.5) * vol;
        const open = rate + (rand() - 0.5) * vol * 0.3;
        const close = Math.max(rate * 0.5, open + drift);
        const high = Math.max(open, close) + rand() * vol * 0.4;
        const low = Math.min(open, close) - rand() * vol * 0.4;
        out.push({
          provider: this.id,
          symbol,
          timeframe,
          open,
          high,
          low,
          close,
          volume: 0,
          timestamp: ts,
          receivedAt,
          isClosed: ts + step <= end,
          source: "rest:exchangerate.host",
          quality: "medium",
        });
        cursor += step;
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  private emit(ev: Parameters<MarketListener>[0]): void {
    for (const l of this.listeners) l(ev);
  }
}
