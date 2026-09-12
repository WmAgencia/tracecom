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
    const unavailable = "UNAVAILABLE";
    if (!item || candles.length < 12) return { ...base, decision: "WAIT", confidence: 0, rationale: "IQ_DATA_INSUFFICIENT_HISTORY", productionDecision: "WAIT", shadowEligible: false, reasons: ["IQ_DATA_INSUFFICIENT_HISTORY"], counterReasons: ["INSUFFICIENT_CLOSED_CANDLES"], features: { trendAlignment: unavailable, momentumQuality: unavailable, candleQuality: unavailable, structureQuality: unavailable, liquidityQuality: unavailable, volatilityQuality: unavailable, MTFAlignment: unavailable, rejectionQuality: unavailable, breakoutQuality: unavailable, timingQuality: "WAIT" }, signature: "trace1m-local-v1:insufficient", snapshot: { asset: symbol, timeframe: TRACE_1M_TIMEFRAME, observedAt: Date.now(), price: currentPrice, candleCount: candles.length, candles: candles.slice(-12).map((c) => ({ ...c })) } };
    const recent = candles.slice(-5);
    const first = recent[0].close;
    const last = recent.at(-1).close;
    const delta = (last - first) / Math.max(Math.abs(first), Number.EPSILON);
    const confidence = Math.min(0.69, 0.5 + Math.min(0.19, Math.abs(delta) * 100));
    const decision = delta > 0.00015 ? "BUY" : delta < -0.00015 ? "SELL" : "WAIT";
    const trend = delta > 0 ? "BULLISH" : delta < 0 ? "BEARISH" : "FLAT";
    const rationale = decision === "WAIT" ? "NO_EDGE" : "LOCAL_1M_MOMENTUM_SHADOW";
    const features = { trendAlignment: trend, momentumQuality: Math.abs(delta) > 0.00015 ? "PASS" : "WEAK", candleQuality: "OBSERVED", structureQuality: "UNAVAILABLE", liquidityQuality: unavailable, volatilityQuality: "UNAVAILABLE", MTFAlignment: unavailable, rejectionQuality: unavailable, breakoutQuality: unavailable, timingQuality: decision === "WAIT" ? "WAIT" : "PASS" };
    const reasons = decision === "WAIT" ? ["NO_EDGE"] : ["LOCAL_1M_MOMENTUM_SHADOW", `TREND_${trend}`];
    const counterReasons = decision === "WAIT" ? ["MOMENTUM_BELOW_THRESHOLD"] : ["MTF_UNAVAILABLE", "LIQUIDITY_UNAVAILABLE"];
    const signature = `trace1m-local-v1:${decision}:${Math.round(delta * 1e6)}:${candles.length}`;
    return { ...base, decision, confidence, score: delta, rationale, productionDecision: "WAIT", shadowEligible: decision !== "WAIT", candlesUsed: recent.length, generatedAt: Date.now(), reasons, counterReasons, features, signature, snapshot: { asset: symbol, timeframe: TRACE_1M_TIMEFRAME, observedAt: Date.now(), price: currentPrice, candleCount: candles.length, candles: candles.slice(-12).map((c) => ({ ...c })) } };
  }

  globalThis.TraceConLocalEngine = { analyze, classifyOutcome, version: "trace1m-local-v1" };
})();
