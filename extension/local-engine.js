/* TRACE_CON local TRACE_1M shadow engine. No network, credentials or orders. */
(() => {
  "use strict";
  const TRACE_1M_TIMEFRAME = "1m";

  function classifyOutcome(decision, entryPrice, exitPrice) {
    const entry = Number(entryPrice);
    const exit = Number(exitPrice);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit)) return "UNKNOWN";
    const raw = (exit - entry) / entry;
    const signed = decision === "SELL" ? -raw : raw;
    return Math.abs(signed) < 0.00001 ? "DRAW" : signed > 0 ? "WIN" : "LOSS";
  }

  function analyze(symbol, item) {
    const candles = (item?.candles || []).filter((c) => c.timeframe === TRACE_1M_TIMEFRAME && c.isClosed !== false);
    const currentPrice = item?.lastPrice ?? candles.at(-1)?.close ?? null;
    const ageMs = item?.lastFrameAt ? Date.now() - item.lastFrameAt : Infinity;
    const base = { symbol, timeframe: TRACE_1M_TIMEFRAME, currentPrice, source: "iqoption:local-shadow", provider: "iqoption", feed: { state: ageMs <= 15_000 ? "LIVE" : "DEGRADED", lastPrice: currentPrice, lastPriceTimestamp: item?.lastPriceTimestamp ?? null, ageMs, candleCount: candles.length } };
    if (!item || candles.length < 12) return { ...base, decision: "WAIT", confidence: 0, rationale: "IQ_DATA_INSUFFICIENT_HISTORY", productionDecision: "WAIT", shadowEligible: false };
    const recent = candles.slice(-5);
    const first = recent[0].close;
    const last = recent.at(-1).close;
    const delta = (last - first) / Math.max(Math.abs(first), Number.EPSILON);
    const confidence = Math.min(0.69, 0.5 + Math.min(0.19, Math.abs(delta) * 100));
    const decision = delta > 0.00015 ? "BUY" : delta < -0.00015 ? "SELL" : "WAIT";
    return { ...base, decision, confidence, score: delta, rationale: decision === "WAIT" ? "NO_EDGE" : "LOCAL_1M_MOMENTUM_SHADOW", productionDecision: "WAIT", shadowEligible: decision !== "WAIT", candlesUsed: recent.length, generatedAt: Date.now() };
  }

  globalThis.TraceConLocalEngine = { analyze, classifyOutcome, version: "trace1m-local-v1" };
})();
