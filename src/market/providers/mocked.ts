/**
 * Provider "mocked": fornece dados SINTÉTICOS determinísticos.
 *
 * ⚠️ ATENÇÃO: este provider gera dados artificiais e NUNCA deve ser usado em
 * produção ou para conclusões reais. Ele existe exclusivamente para testar o
 * pipeline (agente, ferramentas, modelos, auditoria) sem depender de uma fonte
 * externa. Em modo "mocked" o sistema deve ser incapaz de atingir um provider
 * real — isolamento garantido pelo registry.
 *
 * Por isso, os dados são gerados com um PRNG determinístico (seed baseada no
 * símbolo+timeframe) para reproduzibilidade em testes.
 */
import type { Candle, Instrument, Timeframe, ToolResult } from "../../domain/types";
import { dataUnavailable, ok } from "../result";
import type {
  LiquidityMetrics,
  MarketDataProvider,
  MarketQuery,
} from "../provider";

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

function seedFor(query: MarketQuery): number {
  const s = `${query.instrument.symbol}:${query.timeframe ?? "default"}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

export class MockedProvider implements MarketDataProvider {
  readonly id = "mocked";
  readonly available = true;

  constructor(private readonly instrumentHint: {
    readonly basePrice: number;
    readonly baseVolume: number;
  }) {}

  get connectedAt(): number | null {
    return Date.now();
  }

  private genCandles(query: MarketQuery): Candle[] {
    const tf = query.timeframe ?? "1h";
    const step = TIMEFRAME_MS[tf];
    const limit = query.limit ?? 200;
    const rand = rng(seedFor(query));
    const now = Date.now();
    const start = now - limit * step;
    const candles: Candle[] = [];
    let price = this.instrumentHint.basePrice;
    for (let i = 0; i < limit; i++) {
      const drift = (rand() - 0.5) * price * 0.004;
      const open = price;
      const close = Math.max(price * 0.1, open + drift);
      const high = Math.max(open, close) + Math.abs(rand()) * price * 0.002;
      const low = Math.min(open, close) - Math.abs(rand()) * price * 0.002;
      const volume = this.instrumentHint.baseVolume * (0.5 + rand());
      candles.push({
        timestamp: start + i * step,
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    return candles;
  }

  async candles(query: MarketQuery): Promise<ToolResult<Candle[]>> {
    return ok("get_candles", this.genCandles(query), { source: this.id });
  }

  async ticker(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    const candles = this.genCandles({ ...query, limit: 1 });
    const last = candles[candles.length - 1];
    if (!last) return dataUnavailable("get_market_data", "Sem candles.");
    return ok(
      "get_market_data",
      {
        symbol: query.instrument.symbol,
        lastPrice: last.close,
        high24h: last.high,
        low24h: last.low,
        changePct: (last.close - last.open) / last.open,
      },
      { source: this.id },
    );
  }

  async volume(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    const candles = this.genCandles(query);
    const total = candles.reduce((s, c) => s + c.volume, 0);
    const avg = total / (candles.length || 1);
    return ok("get_volume", { total, average: avg, count: candles.length }, {
      source: this.id,
    });
  }

  async orderBook(_query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    return dataUnavailable("get_order_book", "Cancelado: impossível simular ordem real.");
  }

  async liquidity(query: MarketQuery): Promise<ToolResult<LiquidityMetrics>> {
    const rand = rng(seedFor(query));
    const last = this.genCandles({ ...query, limit: 1 })[0];
    const lastPrice = last?.close ?? this.instrumentHint.basePrice;
    const metrics: LiquidityMetrics = {
      bidDepth: Math.round(1000 + rand() * 10_000),
      askDepth: Math.round(1000 + rand() * 10_000),
      spread: lastPrice * (0.0001 + rand() * 0.0006),
      depthImbalance: rand() * 2 - 1,
      lastPrice,
    };
    return ok("get_liquidity_metrics", metrics, { source: this.id });
  }

  async funding(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    const rand = rng(seedFor(query) ^ 0x9e3779b9);
    return ok(
      "get_funding_data",
      { rate: (rand() - 0.5) * 0.0004, nextAt: Date.now() + 8 * 3_600_000 },
      { source: this.id },
    );
  }

  async openInterest(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    const rand = rng(seedFor(query) ^ 0x85ebca6b);
    return ok(
      "get_open_interest",
      { value: Math.round(rand() * 1e9), changePct: (rand() - 0.5) * 0.1 },
      { source: this.id },
    );
  }

  /** Utilidade para testes/base: cria um provider mockado a partir do instrument. */
  static synthetic(instrument: Pick<Instrument, "symbol">): MockedProvider {
    return new MockedProvider({ basePrice: 100, baseVolume: 1000 });
  }
}
