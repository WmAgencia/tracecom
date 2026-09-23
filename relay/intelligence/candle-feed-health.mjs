/**
 * TRACECOM — CANDLE FEED HEALTH: diagnostico puro e observavel do feed de candles.
 *
 * Diferencia as camadas sem inferir uma pela outra:
 *   A. CONNECTED  -> session.connected (WS de market data)
 *   B. SUBSCRIBED -> ctx.subscriptionState === "SUBSCRIBED"
 *   C. RECEIVING  -> lastMarketMessageAt / lastCandleAt frescos
 *   D. STORING    -> storedCandles > 0 no buffer do runtime
 *
 * Nao le nem escreve candles; apenas deriva metricas do estado existente.
 */
export const CANDLE_FEED_HEALTH_VERSION = "candle-feed-health-v1";

export const FEED_BLOCK_REASONS = Object.freeze([
  "NO_LIVE_OPPORTUNITY",
  "NO_CANDLE_HISTORY",
  "CANDLE_FEED_DISCONNECTED",
  "CANDLE_FEED_STALE",
  "INSUFFICIENT_CANDLES",
  "MARKET_NOT_SUBSCRIBED",
]);

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/** Saude por mercado (camadas B/C/D para um unico ctx). */
export function marketFeedHealth(ctx, { now, maxAgeMs = 15_000, minCandles = 40 } = {}) {
  const candles = ctx?.candles;
  const storedCandles = candles && typeof candles.size === "number" ? candles.size : 0;
  let oldestCandleAt = null; let newestCandleAt = null;
  if (candles && typeof candles.keys === "function") {
    for (const key of candles.keys()) {
      if (oldestCandleAt === null || key < oldestCandleAt) oldestCandleAt = key;
      if (newestCandleAt === null || key > newestCandleAt) newestCandleAt = key;
    }
  }
  const lastCandleAt = newestCandleAt ?? finite(ctx?.lastCandle?.bucketEnd);
  const ageMs = lastCandleAt !== null ? Math.max(0, Number(now) - lastCandleAt) : null;
  const subscriptionState = ctx?.subscriptionState ?? "UNKNOWN";
  const reasons = new Set();
  if (subscriptionState !== "SUBSCRIBED") reasons.add("MARKET_NOT_SUBSCRIBED");
  if (storedCandles === 0) reasons.add("NO_CANDLE_HISTORY");
  else if (storedCandles < minCandles) reasons.add("INSUFFICIENT_CANDLES");
  if (lastCandleAt === null) reasons.add("NO_CANDLE_HISTORY");
  else if (ageMs !== null && ageMs > maxAgeMs) reasons.add("CANDLE_FEED_STALE");
  const list = [...reasons];
  return {
    marketKey: ctx?.marketKey ?? null, activeId: ctx?.activeId ?? null, marketType: ctx?.marketType ?? null,
    enabled: ctx?.enabled === true, availability: ctx?.availability ?? null,
    storedCandles, oldestCandleAt, lastCandleAt, ageMs,
    subscriptionState, feedReady: list.length === 0, reasons: list,
  };
}

/** Saude global do candle feed (camadas A + agregacao de B/C/D). */
export function candleFeedHealth({
  session = null, markets = [], metrics = {}, reconnects = 0, now,
  startedAt = null, lastSubscriptionAt = null, lastReconnectAt = null, lastError = null,
  maxAgeMs = 15_000, minCandles = 40,
} = {}) {
  const list = Array.isArray(markets) ? markets : [...(markets?.values?.() ?? [])];
  const rows = list.map((ctx) => marketFeedHealth(ctx, { now, maxAgeMs, minCandles }));
  const enabledRows = rows.filter((row) => row.enabled);
  const subscribedRows = rows.filter((row) => row.subscriptionState === "SUBSCRIBED");
  const withCandles = rows.filter((row) => row.storedCandles > 0);
  const readyRows = rows.filter((row) => row.feedReady);
  const lastCandleAt = rows.reduce((acc, row) => (row.lastCandleAt !== null && (acc === null || row.lastCandleAt > acc) ? row.lastCandleAt : acc), null);
  const oldestCandleAt = rows.reduce((acc, row) => (row.oldestCandleAt !== null && (acc === null || row.oldestCandleAt < acc) ? row.oldestCandleAt : acc), null);
  const ageMs = lastCandleAt !== null ? Math.max(0, Number(now) - lastCandleAt) : null;
  const wsConnected = session?.connected === true;
  const enabledReady = enabledRows.filter((row) => row.feedReady);
  const feedReady = wsConnected && subscribedRows.length > 0 && enabledReady.length > 0 && ageMs !== null && ageMs <= maxAgeMs;
  const reasons = new Set();
  if (!wsConnected) reasons.add("CANDLE_FEED_DISCONNECTED");
  for (const row of enabledRows) for (const reason of row.reasons) reasons.add(reason);
  return {
    version: CANDLE_FEED_HEALTH_VERSION,
    at: Number(now),
    wsConnected, authenticated: wsConnected, host: session?.host ?? null, connectionId: session?.connectionId ?? null,
    subscriptionCount: subscribedRows.length, marketsExpected: rows.length, marketsEnabled: enabledRows.length,
    marketsSubscribed: subscribedRows.length, marketsWithCandles: withCandles.length, marketsReady: enabledReady.length,
    lastMarketMessageAt: finite(metrics.lastMarketMessageAt), lastCandleAt, oldestCandleAt, ageMs,
    candlesReceivedTotal: Number(metrics.candlesReceivedTotal ?? 0), candlesStoredTotal: Number(metrics.candlesStoredTotal ?? metrics.candles ?? 0),
    historyLoadedTotal: Number(metrics.historyLoadedTotal ?? 0), historyMarketsTotal: Number(metrics.historyMarketsTotal ?? 0),
    rejectedTotal: Number(metrics.rejected ?? 0),
    reconnectCount: Number(reconnects ?? 0), lastReconnectAt: finite(lastReconnectAt), lastSubscriptionAt: finite(lastSubscriptionAt),
    lastError: lastError ?? null, startedAt: finite(startedAt),
    feedReady, reasons: [...reasons].slice(0, 12),
    markets: rows,
  };
}
