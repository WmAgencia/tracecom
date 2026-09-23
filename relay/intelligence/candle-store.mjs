import { MAX_CONTEXT_AGE_MS, OPERATIONAL_CANDLE_INTERVAL_MS, ASSET_CONTEXT_WINDOW_CANDLES } from "./asset-context.mjs";

export const CANDLE_STORE_VERSION = "operational-candles-5s-v1";
export const DEFAULT_RETENTION_MS = MAX_CONTEXT_AGE_MS + 30 * 60_000;
export const DEFAULT_LOAD_LIMIT = ASSET_CONTEXT_WINDOW_CANDLES + 60;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export class CandleStore {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, intervalMs = OPERATIONAL_CANDLE_INTERVAL_MS, retentionMs = DEFAULT_RETENTION_MS, flushMs = 2_000, maxBuffer = 2_000 } = {}) {
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.intervalMs = intervalMs;
    this.retentionMs = retentionMs;
    this.flushMs = Math.max(500, Number(flushMs) || 2_000);
    this.maxBuffer = Math.max(100, Number(maxBuffer) || 2_000);
    this.buffer = [];
    this.timer = null;
    this.flushing = false;
    this.stats = { written: 0, duplicates: 0, errors: 0, dropped: 0, lastFlushAt: null, lastPruneAt: null };
  }

  get ready() { return Boolean(this.pool?.query); }

  record(marketKey, candle) {
    if (!this.ready || !marketKey || !candle) return false;
    const at = num(candle.at ?? candle.bucketEnd ?? candle.bucketStart);
    const open = num(candle.open); const high = num(candle.high); const low = num(candle.low); const close = num(candle.close);
    if (at === null || close === null || high === null || low === null) return false;
    this.buffer.push({ marketKey: String(marketKey), at, open: open ?? close, high, low, close });
    if (this.buffer.length >= this.maxBuffer) { void this.flush(); return true; }
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.flushMs);
      this.timer.unref?.();
    }
    return true;
  }

  async flush() {
    if (this.flushing) return 0;
    if (!this.ready || !this.buffer.length) return 0;
    this.flushing = true;
    const rows = this.buffer.splice(0, this.buffer.length);
    try {
      const values = [];
      const params = [];
      for (const row of rows) {
        const base = params.length;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(row.marketKey, this.intervalMs, row.at, row.open, row.high, row.low, row.close);
      }
      const result = await this.pool.query(`INSERT INTO iq_candles_5s(market_key, interval_ms, at, open, high, low, close) VALUES ${values.join(",")} ON CONFLICT (market_key, interval_ms, at) DO NOTHING`, params);
      const inserted = Number(result?.rowCount ?? 0);
      this.stats.written += inserted;
      this.stats.duplicates += Math.max(0, rows.length - inserted);
      this.stats.lastFlushAt = this.now();
      return inserted;
    } catch (error) {
      this.stats.errors += 1;
      this.log("CANDLE_STORE_FLUSH_FAIL", String(error?.message ?? error).slice(0, 140));
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  async loadRecent(marketKey, { limit = DEFAULT_LOAD_LIMIT, sinceMs = null } = {}) {
    if (!this.ready || !marketKey) return [];
    const since = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : this.now() - MAX_CONTEXT_AGE_MS - this.intervalMs;
    const boundedLimit = Math.max(2, Math.min(ASSET_CONTEXT_WINDOW_CANDLES + 120, Number(limit) || DEFAULT_LOAD_LIMIT));
    const sql = "SELECT at, open, high, low, close FROM iq_candles_5s WHERE market_key=$1 AND interval_ms=$2 AND at >= $3 ORDER BY at ASC LIMIT $4";
    const params = [String(marketKey), this.intervalMs, since, boundedLimit];
    let result = await this.pool.query(sql, params);
    // Nunca tratar um drop do scheduler como "sem historico": uma retentativa antes de desistir.
    if (result?.dropped === true) result = await this.pool.query(sql, params);
    if (result?.dropped === true) throw new Error("CANDLE_STORE_LOAD_DROPPED");
    const rows = result?.rows ?? [];
    return rows.map((row) => ({ at: num(row.at), open: num(row.open), high: num(row.high), low: num(row.low), close: num(row.close) })).filter((row) => row.at !== null && row.close !== null);
  }

  async prune() {
    if (!this.ready) return 0;
    try {
      const result = await this.pool.query("DELETE FROM iq_candles_5s WHERE at < $1", [this.now() - this.retentionMs]);
      this.stats.lastPruneAt = this.now();
      return Number(result?.rowCount ?? 0);
    } catch (error) {
      this.stats.errors += 1;
      this.log("CANDLE_STORE_PRUNE_FAIL", String(error?.message ?? error).slice(0, 140));
      return 0;
    }
  }

  status() {
    return {
      version: CANDLE_STORE_VERSION,
      ready: this.ready,
      intervalMs: this.intervalMs,
      retentionMs: this.retentionMs,
      buffered: this.buffer.length,
      stats: { ...this.stats },
    };
  }
}
