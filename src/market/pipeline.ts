/**
 * Real-time Market Pipeline.
 *
 * Fluxo: Provider → Raw Event → (não há raw: já normalizado) → Validation →
 * Dedup → Aggregation → Market State → Subscribers.
 *
 * Consome `ProviderEvent` (tick/candle/book) de um `MarketDataProvider`
 * (validação + dedup + agregação) e atualiza um `MarketState` compartilhado,
 * emitindo notificações para múltiplos consumidores (quant engine, agent, UI).
 *
 * Cada consumer (ex.: quant/agent/UI) pode assinar por
 * (provider, symbol, timeframe) — uma única conexão/sink alimenta todos.
 */
import type { MarketCandle, MarketTick, ProviderConnectionState, Timeframe } from "./model";
import { TIMEFRAME_MS } from "./model";
import { MarketState } from "./state";
import { CandleAggregator } from "./aggregator";
import { DataQualityEngine, detectGaps } from "./quality";
import { ExponentialBackoff, fetchHistorical } from "./history";
import type { HistoricalSource } from "./history";
import type { MarketDataProvider, ProviderEvent } from "./providerV2";

export interface PipelineSymbolConfig {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** timeframe nativo; se não, agregar de `aggregateFrom`. */
  readonly native?: boolean;
}

export interface PipelineOptions {
  readonly provider: MarketDataProvider;
  readonly logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
  readonly staleAfterMs?: number;
}

export class MarketPipeline {
  readonly state: MarketState;
  private readonly provider: MarketDataProvider;
  private readonly quality: DataQualityEngine;
  private readonly aggregators = new Map<string, CandleAggregator>();
  private readonly subscribers = new Set<(ev: PipelineEvent) => void>();
  private readonly configs: PipelineSymbolConfig[] = [];
  private readonly log?: PipelineOptions["logger"];
  private started = false;

  constructor(opts: PipelineOptions) {
    this.provider = opts.provider;
    this.log = opts.logger;
    this.state = new MarketState();
    this.quality = new DataQualityEngine({ staleAfterMs: opts.staleAfterMs ?? 900_000, delayedAfterMs: 300_000 });
  }

  /** Configura os símbolos de interesse e sobe o stream (uma conexão). */
  async start(configs: PipelineSymbolConfig[]): Promise<void> {
    if (this.started) return; // idempotente: evita reconectar/backfill duplicado
    this.started = true;
    this.configs.push(...configs);
    await this.provider.connect();
    // Backfill inicial de candles FEICHADOS via REST (dado real, nunca inventado).
    // O quant engine precisa de histórico suficiente; o WS só traz o corrente.
    await this.backfill(configs);
    const timeframes = Array.from(new Set(configs.map((c) => c.timeframe)));
    await this.provider.subscribe(
      {
        symbol: configs[0]?.symbol ?? "",
        topics: ["klines", "trades"],
        timeframes,
      },
      (ev) => this.onProviderEvent(ev),
    );
  }

  /** Busca candles recentes via REST para cada par configurado e os injeta no estado. */
  private async backfill(configs: PipelineSymbolConfig[]): Promise<void> {
    const now = Date.now();
    const lookback = 1000; // ~1000 candles de histórico (REST até 1000 por chamada)
    for (const cfg of configs) {
      try {
        const start = now - lookback * TIMEFRAME_MS[cfg.timeframe];
        const res = await this.provider.getCandles({ symbol: cfg.symbol, timeframe: cfg.timeframe, start, limit: lookback });
        let count = 0;
        for (const c of res.candles) {
          const v = this.quality.validateCandle({ candle: c });
          if (!v.valid) continue;
          this.state.putCandle({ ...c, quality: v.quality });
          count++;
        }
        this.log?.info("backfill_completed", { symbol: cfg.symbol, timeframe: cfg.timeframe, count });
      } catch {
        this.log?.warn("backfill_failed", { symbol: cfg.symbol, timeframe: cfg.timeframe });
      }
    }
  }

  stop(): void {
    this.started = false;
    this.provider.disconnect();
  }

  /** Consumidores (quant/agent/UI) assinam eventos e/ou consultam `state`. */
  subscribe(fn: (ev: PipelineEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Consulta imediata de candles para um par (via state ou fornecedor). */
  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end: number }): Promise<MarketCandle[]> {
    return this.state.getCandles(params.symbol, params.timeframe);
  }

  /** Reconciliação de gaps: busca histórico e o re-insere (sem inventar). */
  async recoverGaps(params: {
    symbol: string;
    timeframe: Timeframe;
    start: number;
    end?: number;
  }): Promise<{ recovered: number; gaps: number }> {
    const current = this.state.getCandles(params.symbol, params.timeframe);
    const gapsTuple = detectGaps(current);
    let recovered = 0;
    const source = this.provider.historical;
    for (const g of gapsTuple) {
      const res = await fetchHistorical(source, {
        symbol: params.symbol,
        timeframe: params.timeframe,
        start: g.from,
        end: g.to,
        backoff: new ExponentialBackoff(),
      });
      for (const c of res.candles) {
        this.ingestCandle(c);
        recovered++;
      }
      this.log?.info("gap_recovered", { symbol: params.symbol, timeframe: params.timeframe, from: g.from, to: g.to, count: res.candles.length });
    }
    if (params.end) {
      // Busca por novas entradas após o fim conhecido (recente).
      const last = current[current.length - 1];
      if (last) {
        const res = await fetchHistorical(source, {
          symbol: params.symbol, timeframe: params.timeframe, start: last.timestamp, end: params.end, backoff: new ExponentialBackoff(),
        });
        for (const c of res.candles) {
          const seen = this.state.getCandles(params.symbol, params.timeframe).some((x) => x.timestamp === c.timestamp);
          if (!seen) { this.ingestCandle(c); recovered++; }
        }
      }
    }
    return { recovered, gaps: gapsTuple.length };
  }

  private onProviderEvent(ev: ProviderEvent): void {
    switch (ev.type) {
      case "candle":
        this.ingestCandle(ev.candle);
        break;
      case "tick":
        this.ingestTick(ev.tick);
        break;
      case "book":
        this.state.setOrderBook(ev.book);
        break;
      case "status":
        this.handleStatus(ev.state, ev.error);
        break;
    }
  }

  private ingestCandle(raw: MarketCandle): void {
    const v = this.quality.validateCandle({ candle: raw });
    if (!v.valid) {
      this.log?.warn("data_quality_error", { symbol: raw.symbol, problems: v.problems });
      return;
    }
    this.state.putCandle({ ...raw, quality: v.quality });
    this.emit({ type: "candle", candle: { ...raw, quality: v.quality } });
  }

  private ingestTick(tick: MarketTick): void {
    const v = this.quality.validateTick(tick);
    if (!v.valid) return;
    this.state.setLastTick(tick);
    // Alimenta o agregador do timeframe do símbolo (1m base por ora).
    this.aggregateTick(tick);
    this.emit({ type: "tick", tick });
  }

  private aggregateTick(tick: MarketTick): void {
    // Agregamos para cada timeframe configurado para este símbolo.
    for (const cfg of this.configs) {
      if (cfg.symbol !== tick.symbol) continue;
      this.aggregate({ kind: "tick", tick }, cfg);
    }
  }

  private aggregate(input: Parameters<CandleAggregator["ingest"]>[0], cfg: PipelineSymbolConfig): void {
    const key = `${cfg.symbol}@${cfg.timeframe}`;
    let agg = this.aggregators.get(key);
    if (!agg) {
      agg = new CandleAggregator({
        target: cfg.timeframe,
        provider: this.provider.id,
        symbol: cfg.symbol,
        source: "pipeline",
        quality: "high",
      });
      this.aggregators.set(key, agg);
    }
    const res = agg.ingest(input, Date.now());
    if (res.closedNow.length > 0) {
      this.log?.info("closed_candle", { symbol: cfg.symbol, timeframe: cfg.timeframe, count: res.closedNow.length });
    }
    for (const c of res.candles) this.state.putCandle(c);
  }

  private handleStatus(state: ProviderConnectionState, error?: string): void {
    this.state.setConnectionState(this.provider.id, state, error);
    if (state === "reconnecting") {
      this.log?.warn("provider_reconnecting", { provider: this.provider.id, error });
    }
  }

  private emit(ev: PipelineEvent): void {
    for (const s of this.subscribers) s(ev);
  }
}

export type PipelineEvent =
  | { readonly type: "candle"; readonly candle: MarketCandle }
  | { readonly type: "tick"; readonly tick: MarketTick }
  | { readonly type: "state"; readonly providerId: string; readonly state: ProviderConnectionState };
