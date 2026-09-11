/**
 * ForexMarketScanner — monitora continuamente múltiplos pares.
 *
 * Loop:
 *   1. Para cada par na universe configurável:
 *      a. Fetch quote (top-of-book).
 *      b. Fetch candles históricas (rolling window).
 *      c. Valida freshness + integrity.
 *      d. Calcula MarketSnapshot.
 *   2. Retorna lista de MarketSnapshot ordenada por par.
 *
 * Intervalo configurável via TRACECON_FOREX_SCAN_INTERVAL_MS (default 30000).
 *
 * Não inventa dados: se provider offline, retorna snapshots com status STALE/UNKNOWN.
 */
import type { ForexProvider, ProviderSnapshot, ProviderHealth } from "./provider";
import type { ForexPair, ForexMarketSnapshot, ForexSession, Quote } from "./types";
import {
  DEFAULT_FOREX_UNIVERSE, FOREX_TIMEFRAMES,
  FOREX_TIMEFRAME_MS, computeSpreadPips, parseForexPair, validateQuote, sessionAt, sessionPhaseAt,
} from "./types";

export interface ForexScannerOptions {
  readonly provider: ForexProvider;
  /** Lista de pares (canonical "EUR/USD"). Default: DEFAULT_FOREX_UNIVERSE. */
  readonly universe?: ReadonlyArray<string>;
  /** Timeframe para candles. Default: "1h". */
  readonly timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  /** Janela de candles (em candles). Default: 100. */
  readonly candleWindow?: number;
  /** Logger opcional. */
  readonly logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
}

/** Snapshot por par. */
export interface PairSnapshot {
  readonly pair: ForexPair;
  readonly snapshot: ForexMarketSnapshot;
  readonly candles: ReadonlyArray<{
    readonly timestamp: number;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
  }>;
  /**
   * Métricas observadas de qualidade/tradeability. O score é um ranking de
   * prontidão de dados, nunca uma probabilidade ou recomendação de trade.
   */
  readonly analysis: PairScanAnalysis;
}

export interface PairScanAnalysis {
  readonly readinessScore: number;
  readonly rank: number | null;
  readonly reasons: readonly string[];
  readonly spreadPips: number | null;
  readonly candleCount: number;
  readonly realizedVolatilityPct: number | null;
  readonly momentumPct: number | null;
  readonly trend: "up" | "down" | "flat" | "unknown";
  readonly sessionLiquidity: "high" | "normal" | "low" | "closed";
}

export class ForexMarketScanner {
  private readonly provider: ForexProvider;
  private readonly pairs: ReadonlyArray<ForexPair>;
  private readonly timeframe: NonNullable<ForexScannerOptions["timeframe"]>;
  private readonly candleWindow: number;
  private readonly logger: NonNullable<ForexScannerOptions["logger"]>;
  private lastRunAt: number = 0;
  private lastResult: ReadonlyArray<PairSnapshot> = [];

  constructor(opts: ForexScannerOptions) {
    this.provider = opts.provider;
    const uni = opts.universe ?? DEFAULT_FOREX_UNIVERSE.map((p) => p.canonical);
    const parsed = uni.map(parseForexPair).filter((p): p is ForexPair => p !== null);
    this.pairs = parsed;
    this.timeframe = opts.timeframe ?? "1h";
    this.candleWindow = opts.candleWindow ?? 100;
    this.logger = opts.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  }

  /** Lista de pares sendo monitorados. */
  getUniverse(): ReadonlyArray<ForexPair> {
    return this.pairs;
  }

  /** Última execução do scan. */
  getLastRun(): { at: number; results: ReadonlyArray<PairSnapshot> } {
    return { at: this.lastRunAt, results: this.lastResult };
  }

  /** Executa um scan completo dos pares. */
  async runOnce(now: number = Date.now()): Promise<ReadonlyArray<PairSnapshot>> {
    const out: PairSnapshot[] = [];
    const timeframeMs = FOREX_TIMEFRAME_MS[this.timeframe] ?? 3_600_000;
    const start = now - timeframeMs * this.candleWindow;
    const end = now;
    for (const pair of this.pairs) {
      try {
        const quote = await this.provider.fetchQuote(pair);
        const candles = await this.provider.fetchCandles(pair, this.timeframe, start, end);
        const validation = validateQuote(quote, now, pair);
        const session = sessionAt(now);
        const sessionPhase = sessionPhaseAt(now, session);
        const snap: ForexMarketSnapshot = {
          symbol: pair.canonical,
          lastQuote: quote,
          lastTick: null,
          session,
          sessionPhase,
          freshness: validation,
          timestamp: now,
        };
        const ohlcCandles = sanitizeCandles(candles, timeframeMs, now);
        out.push({
          pair,
          snapshot: snap,
          candles: ohlcCandles,
          analysis: analyzePair(quote, ohlcCandles, validation.status, session, sessionPhase, this.candleWindow),
        });
      } catch (e: unknown) {
        this.logger.warn("forex.scan.pair.failed", {
          symbol: pair.canonical,
          message: String(e instanceof Error ? e.message : e),
        });
        // Não inventar dados: emite snapshot STALE sem quote.
        out.push({
          pair,
          snapshot: {
            symbol: pair.canonical,
            lastQuote: null,
            lastTick: null,
            session: sessionAt(now),
            sessionPhase: sessionPhaseAt(now, sessionAt(now)),
            freshness: {
              status: "UNKNOWN",
              reasonCodes: ["PROVIDER_ERROR"],
              lastValidTimestamp: null,
              stalenessMs: null,
            },
            timestamp: now,
          },
          candles: [],
          analysis: unavailableAnalysis("PROVIDER_ERROR"),
        });
      }
    }
    // O rank é por prontidão observada. A resposta preserva a ordem da
    // universe para consumidores que a usam como identidade de painel.
    const ranks = out
      .map((item, index) => ({ item, index }))
      .sort((a, b) => b.item.analysis.readinessScore - a.item.analysis.readinessScore || a.index - b.index)
      .reduce((acc, entry, index) => acc.set(entry.index, index + 1), new Map<number, number>());
    const ranked = out.map((item, index) => ({
      ...item,
      analysis: { ...item.analysis, rank: ranks.get(index) ?? null },
    }));
    this.lastRunAt = now;
    this.lastResult = ranked;
    return ranked;
  }

  /** Health check do provider subjacente. */
  async health(): Promise<ProviderHealth> {
    return this.provider.health();
  }
}

function sanitizeCandles(
  candles: Awaited<ReturnType<ForexProvider["fetchCandles"]>>,
  timeframeMs: number,
  now: number,
): PairSnapshot["candles"] {
  const byTimestamp = new Map<number, PairSnapshot["candles"][number]>();
  for (const c of candles) {
    if (
      c.quality !== "high" ||
      ![c.timestamp, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.timestamp > now + 5_000 ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      c.low <= 0
    ) continue;
    byTimestamp.set(c.timestamp, {
      timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    });
  }
  const sorted = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted.at(-1);
  if (!latest || now - latest.timestamp > timeframeMs * 2.5) return [];
  let start = sorted.length - 1;
  while (start > 0 && sorted[start]!.timestamp - sorted[start - 1]!.timestamp <= timeframeMs * 1.5) start--;
  return sorted.slice(start);
}

function unavailableAnalysis(reason: string): PairScanAnalysis {
  return {
    readinessScore: 0,
    rank: null,
    reasons: [reason],
    spreadPips: null,
    candleCount: 0,
    realizedVolatilityPct: null,
    momentumPct: null,
    trend: "unknown",
    sessionLiquidity: "closed",
  };
}

function analyzePair(
  quote: Quote | null,
  candles: PairSnapshot["candles"],
  freshness: ForexMarketSnapshot["freshness"]["status"],
  session: ForexSession,
  phase: ForexMarketSnapshot["sessionPhase"],
  requestedWindow: number,
): PairScanAnalysis {
  if (!quote || freshness === "UNKNOWN" || freshness === "INVALID") return unavailableAnalysis(freshness === "INVALID" ? "INVALID_QUOTE" : "NO_USABLE_QUOTE");

  const reasons: string[] = [];
  const spreadPips = computeSpreadPips(quote);
  const spreadScore = spreadPips <= 1 ? 20 : spreadPips <= 2 ? 15 : spreadPips <= 5 ? 8 : 2;
  if (spreadPips > 5) reasons.push("WIDE_SPREAD");
  const freshnessScore = freshness === "FRESH" ? 35 : 15;
  if (freshness !== "FRESH") reasons.push("STALE_QUOTE");
  const coverage = Math.min(1, candles.length / Math.max(1, requestedWindow));
  const candleScore = Math.round(20 * coverage);
  if (coverage < 0.8) reasons.push("INCOMPLETE_CANDLE_WINDOW");
  const sessionLiquidity = session === "OVERLAP_LONDON_NY" ? "high"
    : session === "LONDON" || session === "NEW_YORK" ? "normal"
      : session === "ASIA" && phase !== "CLOSED" ? "low" : "closed";
  const sessionScore = sessionLiquidity === "high" ? 15 : sessionLiquidity === "normal" ? 12 : sessionLiquidity === "low" ? 6 : 0;
  if (sessionLiquidity === "closed") reasons.push("MARKET_CLOSED_OR_ROLLOVER");
  const closes = candles.map((c) => c.close).filter((value) => Number.isFinite(value) && value > 0);
  const lookback = closes.slice(-21);
  const first = lookback[0] ?? null;
  const last = lookback.at(-1) ?? null;
  const momentumPct = first && last ? ((last - first) / first) * 100 : null;
  const average = lookback.length ? lookback.reduce((sum, value) => sum + value, 0) / lookback.length : null;
  const trend = average === null || last === null ? "unknown"
    : last > average * 1.0005 ? "up" : last < average * 0.9995 ? "down" : "flat";
  const realizedVolatilityPct = logReturnVolatilityPct(closes.slice(-30));
  if (candles.length < 2) reasons.push("INSUFFICIENT_CANDLES_FOR_METRICS");
  return {
    readinessScore: Math.min(100, freshnessScore + spreadScore + candleScore + sessionScore),
    rank: null,
    reasons,
    spreadPips,
    candleCount: candles.length,
    realizedVolatilityPct,
    momentumPct,
    trend,
    sessionLiquidity,
  };
}

function logReturnVolatilityPct(closes: readonly number[]): number | null {
  if (closes.length < 3) return null;
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1]!;
    const current = closes[index]!;
    returns.push(Math.log(current / previous));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}
