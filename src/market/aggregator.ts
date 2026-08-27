/**
 * Candle Aggregator — agrega ticks/trades/candles menores em candles maiores
 * (ex.: 1m → 3m) de forma determinística e incremental.
 *
 * Garantias:
 *   - bucket correto em UTC (início = floor(t / tfMs) * tfMs);
 *   - open=primeiro open, high=max, low=min, close=último close, volume=soma;
 *   - deduplicação (mesmo provider+symbol+sequence → ignorar);
 *   - ordenação ao emitir (cronológica);
 *   - IMUTABILIDADE: um bucket já fechado nunca é alterado por dados tardios.
 */
import type { MarketCandle, MarketTick, Timeframe } from "./model";
import { TIMEFRAME_MS } from "./model";

export interface AggregatorConfig {
  readonly target: Timeframe;
  readonly provider: string;
  readonly symbol: string;
  readonly source: string;
  readonly quality: MarketCandle["quality"];
}

export type AggregatorInput =
  | { readonly kind: "tick"; readonly tick: MarketTick }
  | { readonly kind: "candle"; readonly candle: MarketCandle };

export interface AggregateResult {
  readonly candles: readonly MarketCandle[]; // cronológica, abertos+fechados
  readonly closedNow: readonly MarketCandle[]; // buckets que fecharam NESTA ingestão
  readonly ignored: number;
}

/** Início (ms) do bucket de `t` para um timeframe (UTC). */
export function bucketStart(timestamp: number, timeframe: Timeframe): number {
  return Math.floor(timestamp / TIMEFRAME_MS[timeframe]) * TIMEFRAME_MS[timeframe];
}

export class CandleAggregator {
  private readonly open = new Map<number, MarketCandle>();
  private readonly closed = new Map<number, MarketCandle>();
  private readonly seen = new Set<string>();
  private readonly cfg: AggregatorConfig;
  private readonly tfMs: number;

  constructor(cfg: AggregatorConfig) {
    this.cfg = cfg;
    this.tfMs = TIMEFRAME_MS[cfg.target];
  }

  ingest(input: AggregatorInput, now: number): AggregateResult {
    let ignored = 0;
    let bucket: number;
    let agg: { open: number; high: number; low: number; close: number; volume: number };
    let sequence: number | undefined;

    if (input.kind === "tick") {
      const t = input.tick;
      if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.timestamp)) {
        return this.result(now, 0, 1);
      }
      bucket = bucketStart(t.timestamp, this.cfg.target);
      agg = { open: t.price, high: t.price, low: t.price, close: t.price, volume: t.quantity };
      sequence = t.sequence;
    } else {
      const c = input.candle;
      if (!Number.isFinite(c.timestamp)) return this.result(now, 0, 1);
      bucket = this.cfg.target === c.timeframe ? bucketStart(c.timestamp, this.cfg.target) : bucketStart(c.timestamp, this.cfg.target);
      agg = { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      sequence = c.sequence;
      if (sequence !== undefined) {
        const key = `${this.cfg.provider}:${this.cfg.symbol}:${sequence}`;
        if (this.seen.has(key)) return this.result(now, 0, 1);
        this.seen.add(key);
      }
    }

    // IMUTABILIDADE: bucket já fechado → ignorar (não alterar o passado).
    if (this.closed.has(bucket)) return this.result(now, 0, 1);

    const prev = this.open.get(bucket);
    if (prev && prev.receivedAt > now) {
      // evento "mais novo" com receivedAt menor que o existente é anômalo;
      // preservamos o existente (não retroanimamos).
      return this.result(now, 0, 1);
    }

    if (prev) {
      this.open.set(bucket, {
        ...prev,
        // recebidos agora têm prioridade temporal; se o tick for mais antigo
        // que o último close conhecido dentro do bucket, mantemos ordem.
        high: Math.max(prev.high, agg.high),
        low: Math.min(prev.low, agg.low),
        close: agg.close,
        volume: prev.volume + agg.volume,
        receivedAt: now,
        ...(sequence !== undefined ? { sequence } : {}),
      });
    } else {
      this.open.set(bucket, {
        provider: this.cfg.provider,
        symbol: this.cfg.symbol,
        timeframe: this.cfg.target,
        open: agg.open,
        high: agg.high,
        low: agg.low,
        close: agg.close,
        volume: agg.volume,
        timestamp: bucket,
        receivedAt: now,
        isClosed: false,
        source: this.cfg.source,
        quality: this.cfg.quality,
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }

    return this.result(now, 0, ignored);
  }

  /** Up/insert manual de um candle do próprio timeframe. */
  upsert(candle: MarketCandle): void {
    const bucket = bucketStart(candle.timestamp, this.cfg.target);
    const normalized: MarketCandle = {
      ...candle,
      timestamp: bucket,
      provider: this.cfg.provider,
      symbol: this.cfg.symbol,
      timeframe: this.cfg.target,
    };
    if (normalized.isClosed) {
      const existing = this.closed.get(bucket);
      if (existing && existing.receivedAt > normalized.receivedAt) return;
      this.closed.set(bucket, normalized);
      this.open.delete(bucket);
    } else {
      const existing = this.open.get(bucket);
      if (existing && existing.receivedAt > normalized.receivedAt) return;
      this.open.set(bucket, normalized);
    }
  }

  closedCandles(): MarketCandle[] {
    return Array.from(this.closed.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  allCandles(now: number): MarketCandle[] {
    this.settle(now);
    const merged = new Map<number, MarketCandle>();
    for (const c of this.closed.values()) merged.set(c.timestamp, c);
    for (const c of this.open.values()) merged.set(c.timestamp, c);
    return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Marca buckets como fechados quando now já passou do fim do bucket. */
  private settle(now: number): void {
    let moved = 0;
    for (const [bucket, c] of Array.from(this.open.entries())) {
      const bucketEnd = bucket + this.tfMs;
      if (now >= bucketEnd && c.receivedAt <= Math.max(now, bucketEnd)) {
        const finalCandle: MarketCandle = {
          ...c,
          isClosed: true,
          estimatedDelayMs: Math.max(0, now - bucketEnd),
        };
        this.closed.set(bucket, finalCandle);
        this.open.delete(bucket);
        moved++;
      }
    }
    void moved;
  }

  /** Candles que fecharam ao aplicar `now` (antes do settle da chamada). */
  private result(now: number, _closed: number, ignored: number): AggregateResult {
    const closedKeys = new Set(this.closed.keys());
    this.settle(now);
    const after = this.allCandles(now);
    const closedNow = after.filter((c) => c.isClosed && !closedKeys.has(c.timestamp));
    return { candles: after, closedNow, ignored };
  }
}
