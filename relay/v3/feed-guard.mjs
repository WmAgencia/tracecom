/**
 * V3 — FEED GUARD: fail-closed quando o candle feed nao esta utilizavel.
 *
 * NUNCA fabrica dados e NUNCA chama LLM: apenas classifica o motivo do bloqueio para auditoria.
 *
 * Motivos e ONDE sao classificados:
 * - NO_CANDLE_HISTORY / INSUFFICIENT_CANDLES / CANDLE_FEED_STALE -> AQUI (candleFeedBlockReason),
 *   a partir do buffer real de candles do ciclo.
 * - CANDLE_FEED_DISCONNECTED -> camada de relay (`iq-multi-runtime.mjs` #runLoop: queda do WS de
 *   market data chama `v3.noteFeedBlocked("CANDLE_FEED_DISCONNECTED", marketKey)` para mercados habilitados).
 * - MARKET_NOT_SUBSCRIBED -> camada de relay (`#subscribeCtx` falhou para o mercado OU `#onCandleEvent`
 *   recebeu activeId sem ctx habilitado); tambem visivel por mercado em `candleFeed.markets[].subscriptionState`.
 * Disconnect NAO e inferido por ausencia de candles: vem do estado real do WS no relay.
 */
export const V3_FEED_GUARD_VERSION = "v3-feed-guard-v2";
export const V3_CANDLE_BLOCK_REASONS = Object.freeze(["NO_CANDLE_HISTORY", "INSUFFICIENT_CANDLES", "CANDLE_FEED_STALE"]);
export const V3_RELAY_BLOCK_REASONS = Object.freeze(["CANDLE_FEED_DISCONNECTED", "MARKET_NOT_SUBSCRIBED"]);
export const V3_FEED_BLOCK_REASONS = Object.freeze([...V3_CANDLE_BLOCK_REASONS, ...V3_RELAY_BLOCK_REASONS]);
export const MIN_CANDLES_FOR_V3 = 40;
export const MAX_CANDLE_AGE_MS = 30_000;

export function candleFeedBlockReason({ candles = null, brokerNow = null, closedCandleAt = null, minCandles = MIN_CANDLES_FOR_V3, maxAgeMs = MAX_CANDLE_AGE_MS } = {}) {
  if (!Array.isArray(candles) || candles.length === 0) return "NO_CANDLE_HISTORY";
  if (candles.length < minCandles) return "INSUFFICIENT_CANDLES";
  const now = Number(brokerNow); const closed = Number(closedCandleAt);
  if (Number.isFinite(now) && Number.isFinite(closed) && closed > 0 && now - closed > maxAgeMs) return "CANDLE_FEED_STALE";
  return null;
}
