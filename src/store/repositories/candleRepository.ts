/**
 * Repositório de candles HISTÓRICOS (cold store).
 *
 * Persiste apenas candles fechados reais, para estatística/backtest.
 * Atende `CandleHistorySource` (usado pelo Backtester) e as tools de histórico.
 * Nunca inventa: insere somente dados recebidos; leituras retornam o que existe.
 */
import type { MarketCandle } from "../../market/model";
import type { Datastore } from "../db";
import { TIMEFRAME_MS } from "../../market/model";
import type { Timeframe } from "../../market/model";

interface CandleRow {
  provider: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  quality: string;
  is_closed: number;
}

export interface CandleFilter {
  readonly provider?: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly start?: number;
  readonly end?: number;
  readonly limit?: number;
}

export class CandleRepository {
  constructor(private readonly store: Datastore, private readonly providerId = "binance") {}

  /** Insere candles fechados (upsert idempotente por PK). Ignora abertos. */
  upsert(candles: readonly MarketCandle[]): number {
    const stmt = this.store.db.prepare(`
      INSERT OR IGNORE INTO market_candles (
        provider, symbol, timeframe, timestamp,
        open, high, low, close, volume, source, quality, is_closed
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
    `);
    let n = 0;
    for (const c of candles) {
      if (!c.isClosed) continue; // só histórico fechado
      if (!Number.isFinite(c.close) || c.close <= 0) continue;
      stmt.run(c.provider, c.symbol, c.timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.volume, c.source, c.quality);
      n++;
    }
    return n;
  }

  get(filter: CandleFilter): MarketCandle[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    where.push("symbol = ?"); params.push(filter.symbol);
    where.push("timeframe = ?"); params.push(filter.timeframe);
    if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
    else { where.push("provider = ?"); params.push(this.providerId); }
    if (filter.start !== undefined) { where.push("timestamp >= ?"); params.push(filter.start); }
    if (filter.end !== undefined) { where.push("timestamp <= ?"); params.push(filter.end); }
    const limit = filter.limit ?? 10_000;
    const sql = `SELECT * FROM market_candles WHERE ${where.join(" AND ")} ORDER BY timestamp ASC LIMIT ?`;
    const rows = this.store.db.prepare(sql).all(...params, limit) as unknown as CandleRow[];
    return rows.map(rowToCandle);
  }

  /** Conformidade com CandleHistorySource do backtest. */
  source(): { getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end: number }): Promise<MarketCandle[]> } {
    return {
      getCandles: async (p) => this.get({ symbol: p.symbol, timeframe: p.timeframe, start: p.start, end: p.end }),
    };
  }

  count(symbol: string, timeframe: Timeframe): number {
    const row = this.store.db.prepare(
      "SELECT COUNT(*) AS n FROM market_candles WHERE symbol = ? AND timeframe = ? AND provider = ?",
    ).get(symbol, timeframe, this.providerId) as { n: number };
    return Number(row.n);
  }

  /** Detecta lacunas no cold store para cobertura contínua. */
  gaps(symbol: string, timeframe: Timeframe): Array<{ from: number; to: number }> {
    const rows = this.store.db.prepare(
      "SELECT timestamp FROM market_candles WHERE symbol = ? AND timeframe = ? AND provider = ? ORDER BY timestamp ASC",
    ).all(symbol, timeframe, this.providerId) as unknown as { timestamp: number }[];
    const out: Array<{ from: number; to: number }> = [];
    const step = TIMEFRAME_MS[timeframe];
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i]!.timestamp - (rows[i - 1]!.timestamp + step);
      if (gap > 0) out.push({ from: rows[i - 1]!.timestamp + step, to: rows[i]!.timestamp });
    }
    return out;
  }
}

function rowToCandle(r: CandleRow): MarketCandle {
  return {
    provider: r.provider,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    timestamp: r.timestamp,
    receivedAt: r.timestamp,
    isClosed: r.is_closed === 1,
    source: r.source,
    quality: r.quality as MarketCandle["quality"],
  };
}
