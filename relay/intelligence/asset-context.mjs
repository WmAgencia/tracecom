export const ASSET_CONTEXT_WINDOW_CANDLES = 2160;
export const ASSET_CONTEXT_PIVOT_K = 2;
export const ASSET_CONTEXT_MAX_EVENTS = 64;
export const MAX_CONTEXT_AGE_MS = 3 * 60 * 60 * 1000;
export const OPERATIONAL_CANDLE_INTERVAL_MS = 5000;
export const MIN_CONTEXT_OBSERVATIONS = 25;
export const GAP_FACTOR = 10;
export const GAP_RATIO_MAX = 0.02;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function computeAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const start = Math.max(1, candles.length - period);
  let sum = 0; let n = 0;
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]; const p = candles[i - 1];
    const high = num(c.high); const low = num(c.low); const pc = num(p.close);
    if (high === null || low === null || pc === null) continue;
    sum += Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)); n += 1;
  }
  return n ? sum / n : null;
}

export class AssetContext {
  constructor({ marketKey = null, maxCandles = ASSET_CONTEXT_WINDOW_CANDLES, pivotK = ASSET_CONTEXT_PIVOT_K } = {}) {
    this.marketKey = marketKey;
    this.maxCandles = maxCandles;
    this.pivotK = pivotK;
    this.candles = [];
    this.pivots = [];
    this.events = [];
    this.structure = "RANGE";
    this.regime = "RANGE";
    this.lastBOS = null;
    this.lastCHoCH = null;
    this.version = 0;
    this.hydratedAt = null;
    this.intervalMs = null;
    this.counts = { ingested: 0, invalid: 0, outOfOrder: 0 };
  }

  get lastCandle() { return this.candles[this.candles.length - 1] ?? null; }

  #updateInterval(at) {
    const last = this.lastCandle;
    if (!last) return;
    const diff = at - last.at;
    if (diff <= 0) return;
    this.intervalMs = this.intervalMs === null ? diff : Math.min(this.intervalMs, diff);
  }

  #pruneByTime() {
    const last = this.lastCandle;
    if (!last) return;
    const cutoff = last.at - MAX_CONTEXT_AGE_MS;
    let drop = 0;
    while (drop < this.candles.length && this.candles[drop].at < cutoff) drop += 1;
    if (drop) this.candles.splice(0, drop);
    if (this.candles.length > this.maxCandles) this.candles.splice(0, this.candles.length - this.maxCandles);
  }

  coverageMs() { return this.candles.length >= 2 ? this.lastCandle.at - this.candles[0].at : 0; }

  gaps() {
    const n = this.candles.length;
    if (n < 2) return { count: 0, maxGapMs: 0, gapRatio: 0, comparisons: 0 };
    const base = this.intervalMs ?? OPERATIONAL_CANDLE_INTERVAL_MS;
    let count = 0; let maxGapMs = 0;
    for (let i = 1; i < n; i += 1) {
      const diff = this.candles[i].at - this.candles[i - 1].at;
      if (diff > base * 2) { count += 1; if (diff > maxGapMs) maxGapMs = diff; }
    }
    return { count, maxGapMs, gapRatio: count / (n - 1), comparisons: n - 1 };
  }

  assessReadiness({ expectedIntervalMs = OPERATIONAL_CANDLE_INTERVAL_MS, minObservations = MIN_CONTEXT_OBSERVATIONS, maxAgeMs = MAX_CONTEXT_AGE_MS } = {}) {
    const observations = this.candles.length;
    const coverageMs = this.coverageMs();
    const g = this.gaps();
    const base = { observations, coverageMs, intervalMs: this.intervalMs, expectedIntervalMs, gapRatio: g.gapRatio, maxGapMs: g.maxGapMs, rejectedInvalid: this.counts.invalid, rejectedOutOfOrder: this.counts.outOfOrder };
    if (observations < minObservations) return { status: "FAILED", reason: "INSUFFICIENT_OBSERVATIONS", ...base };
    if (!this.intervalMs) return { status: "FAILED", reason: "INTERVAL_UNKNOWN", ...base };
    if (Math.abs(this.intervalMs - expectedIntervalMs) > expectedIntervalMs * 0.5) return { status: "PARTIAL", reason: "INTERVAL_INCOMPATIBLE", ...base };
    if (coverageMs + this.intervalMs < maxAgeMs) return { status: "PARTIAL", reason: "COVERAGE_INSUFFICIENT", ...base };
    if (g.maxGapMs > this.intervalMs * GAP_FACTOR) return { status: "PARTIAL", reason: "GAP_TOO_LARGE", ...base };
    if (g.gapRatio > GAP_RATIO_MAX) return { status: "PARTIAL", reason: "GAP_RATIO_HIGH", ...base };
    return { status: "READY", reason: null, ...base };
  }

  ingest(candle) {
    const at = num(candle?.at); const high = num(candle?.high); const low = num(candle?.low); const close = num(candle?.close);
    if (at === null || high === null || low === null || close === null) { this.counts.invalid += 1; return false; }
    const last = this.lastCandle;
    if (last && at <= last.at) { this.counts.outOfOrder += 1; return false; }
    this.#updateInterval(at);
    this.candles.push({ at, open: num(candle.open) ?? close, high, low, close });
    this.counts.ingested += 1;
    this.#pruneByTime();
    this.#confirmPivots();
    this.#updateStructure();
    this.#detectBreaks();
    this.version += 1;
    return true;
  }

  ingestMany(list = []) { let n = 0; for (const c of list) if (this.ingest(c)) n += 1; return n; }

  hydrate(list = []) { const n = this.ingestMany(list); this.hydratedAt = this.lastCandle?.at ?? null; return n; }

  #confirmPivots() {
    const k = this.pivotK; const len = this.candles.length;
    const idx = len - 1 - k;
    if (idx < k) return;
    const c = this.candles[idx];
    let isHigh = true; let isLow = true;
    for (let i = idx - k; i <= idx + k; i += 1) {
      if (i === idx) continue;
      if (this.candles[i].high >= c.high) isHigh = false;
      if (this.candles[i].low <= c.low) isLow = false;
    }
    if (!isHigh && !isLow) return;
    if (this.pivots.length && this.pivots[this.pivots.length - 1].at === c.at) return;
    const type = isHigh ? "HIGH" : "LOW";
    const pivot = { at: c.at, index: idx, type, price: type === "HIGH" ? c.high : c.low, confirmedAt: this.lastCandle.at };
    this.pivots.push(pivot);
    if (this.pivots.length > 64) this.pivots.splice(0, this.pivots.length - 64);
    this.#pushEvent({ at: c.at, type: type === "HIGH" ? "PIVOT_HIGH" : "PIVOT_LOW", confirmedAt: pivot.confirmedAt, price: pivot.price });
  }

  #recentPivots(type, count) { return this.pivots.filter((p) => p.type === type).slice(-count); }

  #detectBreaks() {
    const close = this.lastCandle?.close; const at = this.lastCandle?.at;
    if (close === undefined || at === undefined) return;
    const highs = this.#recentPivots("HIGH", 1); const lows = this.#recentPivots("LOW", 1);
    const lastHigh = highs[0] ?? null; const lastLow = lows[0] ?? null;
    if (lastHigh && close > lastHigh.price && !(this.lastBOS?.type === "BOS_UP" && this.lastBOS?.level === lastHigh.at)) {
      const event = { at, type: "BOS_UP", confirmedAt: at, price: close, level: lastHigh.at };
      this.lastBOS = event; this.#pushEvent(event);
    }
    if (lastLow && close < lastLow.price && !(this.lastBOS?.type === "BOS_DOWN" && this.lastBOS?.level === lastLow.at)) {
      const event = { at, type: "BOS_DOWN", confirmedAt: at, price: close, level: lastLow.at };
      this.lastBOS = event; this.#pushEvent(event);
    }
    if (this.structure === "UPTREND" && lastLow && close < lastLow.price && !(this.lastCHoCH?.type === "CHOCH_DOWN" && this.lastCHoCH?.level === lastLow.at)) {
      const event = { at, type: "CHOCH_DOWN", confirmedAt: at, price: close, level: lastLow.at };
      this.lastCHoCH = event; this.#pushEvent(event);
    }
    if (this.structure === "DOWNTREND" && lastHigh && close > lastHigh.price && !(this.lastCHoCH?.type === "CHOCH_UP" && this.lastCHoCH?.level === lastHigh.at)) {
      const event = { at, type: "CHOCH_UP", confirmedAt: at, price: close, level: lastHigh.at };
      this.lastCHoCH = event; this.#pushEvent(event);
    }
  }

  #pushEvent(event) {
    this.events.push(event);
    if (this.events.length > ASSET_CONTEXT_MAX_EVENTS) this.events.splice(0, this.events.length - ASSET_CONTEXT_MAX_EVENTS);
  }

  #updateStructure() {
    const highs = this.#recentPivots("HIGH", 2); const lows = this.#recentPivots("LOW", 2);
    if (highs.length < 2 || lows.length < 2) { this.structure = "RANGE"; this.regime = "RANGE"; return; }
    const hh = highs[1].price > highs[0].price; const hl = lows[1].price > lows[0].price;
    const lh = highs[1].price < highs[0].price; const ll = lows[1].price < lows[0].price;
    if (hh && hl) { this.structure = "UPTREND"; this.regime = "UPTREND"; }
    else if (lh && ll) { this.structure = "DOWNTREND"; this.regime = "DOWNTREND"; }
    else { this.structure = "RANGE"; this.regime = "RANGE"; }
  }

  zones() {
    const atr = computeAtr(this.candles);
    const close = this.lastCandle?.close ?? null;
    if (atr === null || close === null) return [];
    return this.pivots.slice(-8).map((p, i, arr) => ({
      at: p.at, type: p.type, price: p.price,
      kind: i >= arr.length - 2 ? "MICRO" : i >= arr.length - 5 ? "LOCAL" : "STRUCTURAL",
      distanceAtr: Math.round(((close - p.price) / atr) * 100) / 100,
    }));
  }

  pullback() {
    const atr = computeAtr(this.candles);
    const close = this.lastCandle?.close ?? null;
    if (atr === null || close === null) return { active: false, depth: null, distanceAtr: null };
    const highs = this.#recentPivots("HIGH", 1); const lows = this.#recentPivots("LOW", 1);
    if (this.structure === "UPTREND" && highs.length) {
      const distanceAtr = (highs[0].price - close) / atr;
      const belowHL = lows.length ? close < lows[0].price : false;
      const depth = belowHL || distanceAtr >= 3 ? "STRUCTURE_THREATENING" : distanceAtr < 0.5 ? "SHALLOW" : distanceAtr < 1.5 ? "NORMAL" : "DEEP";
      return { active: distanceAtr > 0, direction: "UP_TREND_PULLBACK", depth, distanceAtr: Math.round(distanceAtr * 100) / 100 };
    }
    if (this.structure === "DOWNTREND" && lows.length) {
      const distanceAtr = (close - lows[0].price) / atr;
      const aboveLH = highs.length ? close > highs[0].price : false;
      const depth = aboveLH || distanceAtr >= 3 ? "STRUCTURE_THREATENING" : distanceAtr < 0.5 ? "SHALLOW" : distanceAtr < 1.5 ? "NORMAL" : "DEEP";
      return { active: distanceAtr > 0, direction: "DOWN_TREND_PULLBACK", depth, distanceAtr: Math.round(distanceAtr * 100) / 100 };
    }
    return { active: false, direction: null, depth: null, distanceAtr: null };
  }

  snapshot() {
    const last = this.lastCandle;
    return {
      marketKey: this.marketKey,
      version: this.version,
      candles: this.candles.length,
      windowFirstAt: this.candles[0]?.at ?? null,
      lastAt: last?.at ?? null,
      lastClose: last?.close ?? null,
      regime: this.regime,
      structure: this.structure,
      swings: this.pivots.slice(-4).map((p) => `${p.type}:${p.price}`),
      lastBOS: this.lastBOS,
      lastCHoCH: this.lastCHoCH,
      events: this.events.length,
      zones: this.zones(),
      pullback: this.pullback(),
      hydratedAt: this.hydratedAt,
      intervalMs: this.intervalMs,
      coverageMs: this.coverageMs(),
      gapRatio: this.gaps().gapRatio,
      counts: { ...this.counts },
    };
  }
}
