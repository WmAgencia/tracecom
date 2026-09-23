/** Fixtures V3: candles 5s sinteticos e measurements controlados (deterministicos). */

export const ALIGNED_BASE = Math.floor(Date.now() / 300_000) * 300_000;
export const STEP_MS = 5_000;

export function candlesFromCloses(closes: number[], { startAt = ALIGNED_BASE - closes.length * STEP_MS, spread = 0.0004 } = {}) {
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1]!;
    // open dentro do corpo (gap implicito): garante extremos estritos para pivots causais
    const open = close - (close - previous) * 0.3;
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread;
    return { at: startAt + index * STEP_MS, open, high, low, close };
  });
}

/** Tendencia de alta em zigzag (HH/HL reais) com pullback e retomada — serie operacional. */
export function trendZigzagSeries({ base = 1.35, candles = 110, trendPerCandle = 0.00006, amplitude = 0.0004 } = {}) {
  const closes = Array.from({ length: candles }, (_, index) => base + index * trendPerCandle + Math.sin(index / 5) * amplitude);
  return candlesFromCloses(closes);
}

/** Tendencia de alta em zigzag + pullback mais profundo + retomada com novo topo (BOS). */
export function pullbackThenBosSeries({ base = 1.35, candles = 120 } = {}) {
  const closes = Array.from({ length: candles }, (_, index) => {
    const trend = base + index * 0.00005;
    const wave = Math.sin(index / 5) * 0.0004;
    const pullback = index > candles - 26 && index <= candles - 10 ? -0.0007 * Math.sin(((index - (candles - 26)) / 16) * Math.PI) : 0;
    const recovery = index > candles - 10 ? (index - (candles - 10)) * 0.00009 : 0;
    return trend + wave + pullback + recovery;
  });
  return candlesFromCloses(closes);
}

/** Serie com confirmacao estrutural completa (BULLISH_BOS + dominancia PLUS + sem blockers) usada no caminho de APPROVE. */
export function approvalSeries({ base = 1.35, candles = 120 } = {}) {
  const closes = Array.from({ length: candles }, (_, index) => {
    const trend = base + index * 0.00005;
    const wave = Math.sin(index / 5) * 0.0004;
    const pullback = index > candles - 26 && index <= candles - 10 ? -0.0007 * Math.sin(((index - (candles - 26)) / 16) * Math.PI) : 0;
    const recovery = index > candles - 10 ? (index - (candles - 10)) * 0.00004 : 0;
    return trend + wave + pullback + recovery;
  });
  return candlesFromCloses(closes);
}

function linear(start: number, end: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / Math.max(1, count - 1));
}

/** Uptrend + pullback NORMAL/DEEP + retomada (crossback) nas ultimas 2-3 velas. */
export function pullbackRetomadaSeries({ base = 1.35, candles = 80 } = {}) {
  const up = linear(base, base + 0.0040, Math.floor(candles * 0.6));
  const down = linear(up[up.length - 1]!, up[up.length - 1]! - 0.0011, 12);
  const recovery = linear(down[down.length - 1]!, down[down.length - 1]! + 0.0016, candles - up.length - down.length);
  return candlesFromCloses([...up, ...down.slice(1), ...recovery.slice(1)]);
}

/** Uptrend forte com novo topo (BOS) e sem pullback relevante. */
export function trendContinuationSeries({ base = 1.35, candles = 80 } = {}) {
  const up = linear(base, base + 0.0060, candles - 4);
  const push = linear(up[up.length - 1]!, up[up.length - 1]! + 0.0012, 4);
  return candlesFromCloses([...up, ...push.slice(1)]);
}

/** Range real: patamares simetricos sem HH/HL persistentes (pivots empatados => estrutura RANGE). */
export function rangeSeries({ base = 1.35, candles = 90 } = {}) {
  const closes = Array.from({ length: candles }, (_, index) => base + (index % 10 < 5 ? 0.0005 : -0.0005));
  return candlesFromCloses(closes);
}

/** Downtrend forte (CHoCH/takeover para baixo). */
export function downtrendSeries({ base = 1.35, candles = 80 } = {}) {
  const down = linear(base, base - 0.0060, candles);
  return candlesFromCloses(down);
}

/** Snapshot de measurements controlado (para testes unitarios de Asset/Consensus). */
export function measurementsFixture(overrides: Record<string, any> = {}) {
  const trend = overrides.trend ?? "UPTREND";
  const pullbackActive = overrides.pullbackActive ?? true;
  return {
    version: "v3-measurements-v1",
    marketKey: overrides.marketKey ?? "EURUSD:OTC",
    cycleNumber: overrides.cycleNumber ?? 1,
    closedCandleAt: overrides.closedCandleAt ?? ALIGNED_BASE,
    closedCandleId: `${overrides.marketKey ?? "EURUSD:OTC"}:${overrides.closedCandleAt ?? ALIGNED_BASE}`,
    closedCandle: { at: overrides.closedCandleAt ?? ALIGNED_BASE, open: 1.35, high: 1.351, low: 1.349, close: overrides.close ?? 1.3505 },
    rsi: overrides.rsi ?? { value: 45, zone: "NEUTRAL", slope: overrides.rsiSlope ?? 1.2, acceleration: 0.2, crossback: overrides.crossback === undefined ? { direction: "UP", atIndex: 78, from: 48, to: 52 } : overrides.crossback, persistence: { side: "ABOVE_50", candles: 2 }, failureSwing: null, momentum: "RECOVERING", divergence: [], measurements: {} },
    dmi: overrides.dmi ?? { adx: overrides.adx ?? 26, adxSlope: overrides.adxSlope ?? 1.5, plusDi: 28, minusDi: 19, spread: overrides.spread ?? 9, strength: "STRONG", trendState: overrides.trendState ?? "STRENGTHENING", dominance: overrides.dominance ?? "PLUS", takeover: overrides.takeover ?? null, pressureChange: 1, measurements: {} },
    bollinger: overrides.bollinger ?? { percentB: 0.55, bandwidth: 0.0009, midlineSlope: 0.00002, bandWalk: "UPPER_HALF", reentry: false, rejection: false, expansion: "EXPANDING", squeeze: "NORMAL", measurements: { bandwidthPercentile: 0.5 } },
    atr: overrides.atr ?? { atr: 0.0008, atrPct: 0.0006, volRatio: overrides.volRatio ?? 1.05, regime: "VOLATILITY_COMPATIBLE", normalizedRange: 1.1, normalizedImpulse: 1.6, normalizedPullback: 1.0, wickNormalization: 0.7, assessment: "VOLATILITY_COMPATIBLE", measurements: {} },
    structure: overrides.structure ?? { trend, swingLegs: trend === "DOWNTREND" ? [{ kind: "LOW", label: "LL" }, { kind: "HIGH", label: "LH" }] : [{ kind: "LOW", label: "HL" }, { kind: "HIGH", label: "HH" }], lastHigh: { price: 1.354, at: ALIGNED_BASE - 10_000 }, lastLow: { price: 1.348, at: ALIGNED_BASE - 20_000 }, lastBOS: overrides.lastBOS === undefined ? (trend === "UPTREND" ? { type: "BULLISH_BOS", level: 1.354, at: ALIGNED_BASE - 10_000 } : null) : overrides.lastBOS, lastCHoCH: overrides.lastCHoCH ?? null, zones: [{ type: "SUPPORT", price: 1.348 }, { type: "RESISTANCE", price: 1.354 }], pivotCount: { highs: 4, lows: 4 }, measurements: {} },
    pullback: overrides.pullback ?? { active: pullbackActive, direction: trend === "UPTREND" ? "UP_TREND_PULLBACK" : trend === "DOWNTREND" ? "DOWN_TREND_PULLBACK" : null, depth: overrides.pullbackDepth ?? "NORMAL", distanceAtr: overrides.pullbackDistanceAtr ?? 1.0, referenceExtreme: 1.354, structureTrend: trend },
    zoneDistance: [],
    impulse: overrides.impulse ?? { direction: "UP", netMove: 0.001, normalized: 1.6, candles: 10, consecutiveDirection: 4, decelerating: false, classification: "IMPULSE" },
    micro: overrides.micro ?? { bodyRatio: 0.6, closeInRange: 0.7, upperWickRatio: 0.2, lowerWickRatio: 0.2, direction: "UP", streak: 2, character: "DECISIVE" },
    breakoutRetest: overrides.breakoutRetest ?? { breakout: false, breakdown: false, retest: false, failed: null, resistance: 1.354, support: 1.348, measurements: { lookback: 30, closedAbove: 0, closedBelow: 0 } },
  };
}
