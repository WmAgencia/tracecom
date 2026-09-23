/**
 * V3 — FEED GUARD: fail-closed quando o candle feed nao esta utilizavel.
 *
 * NUNCA fabrica dados e NUNCA chama LLM: apenas classifica o motivo do bloqueio
 * (NO_CANDLE_HISTORY | INSUFFICIENT_CANDLES | CANDLE_FEED_STALE) para auditoria.
 */
export const V3_FEED_GUARD_VERSION = "v3-feed-guard-v1";
export const V3_CANDLE_BLOCK_REASONS = Object.freeze(["NO_CANDLE_HISTORY", "INSUFFICIENT_CANDLES", "CANDLE_FEED_STALE"]);
export const MIN_CANDLES_FOR_V3 = 40;
export const MAX_CANDLE_AGE_MS = 30_000;

export function candleFeedBlockReason({ candles = null, brokerNow = null, closedCandleAt = null, minCandles = MIN_CANDLES_FOR_V3, maxAgeMs = MAX_CANDLE_AGE_MS } = {}) {
  if (!Array.isArray(candles) || candles.length === 0) return "NO_CANDLE_HISTORY";
  if (candles.length < minCandles) return "INSUFFICIENT_CANDLES";
  const now = Number(brokerNow); const closed = Number(closedCandleAt);
  if (Number.isFinite(now) && Number.isFinite(closed) && closed > 0 && now - closed > maxAgeMs) return "CANDLE_FEED_STALE";
  return null;
}
