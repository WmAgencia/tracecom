import { describe, expect, it } from "vitest";
import { buildFeatureSnapshot } from "../../src/quant-v2/feature-engine";
import { quantShadowDecision } from "../../src/quant-v2/quant-fusion";
import { findSimilarPatterns } from "../../src/quant-v2/similar-pattern";
import { purgedWalkForward } from "../../src/quant-v2/walk-forward";
import type { MarketCandle } from "../../src/market/model";

function candles(n = 80): MarketCandle[] { return Array.from({ length: n }, (_, i) => { const close = 100 + i * .02; return { provider: "fixture", symbol: "USDCAD", timeframe: "1m", open: close - .01, high: close + .02, low: close - .02, close, volume: 1, timestamp: i * 5000, receivedAt: i * 5000, isClosed: true, source: "fixture", quality: "high" }; }); }

describe("Quant V2 causal shadow stack", () => {
  it("emits the versioned required feature families with null when unavailable", () => {
    const features = buildFeatureSnapshot(candles(80)).features;
    for (const key of ["return_5s", "return_60s", "logReturn_60s", "momentum_300s", "priceVelocity_30s", "priceAcceleration_60s", "bodySize", "upperWickRatio", "bullishCount_12", "bullishStreak", "realizedVol_60s", "emaSlopeMedium", "RSI", "bollingerWidth", "autocorrelationShort", "returnSkewness", "distanceRecentHigh", "meanReversionDistance"]) expect(Object.prototype.hasOwnProperty.call(features, key)).toBe(true);
  });

  it("never changes causal features when future candles are appended", () => {
    const base = candles(40), a = buildFeatureSnapshot(base, 30), b = buildFeatureSnapshot([...base, ...candles(20).map((c, i) => ({ ...c, timestamp: (40 + i) * 5000, close: 200 }))], 30);
    expect(b.timestamp).toBe(a.timestamp);
    expect(b.features.return_60s).toBe(a.features.return_60s);
    expect(b.features.RSI).toBe(a.features.RSI);
  });

  it("does not use the current or future pattern as a neighbor", () => {
    const snap = buildFeatureSnapshot(candles(50), 49); const row = { groundTruthId: "self", timestamp: snap.timestamp, features: snap.features, direction: "UP" as const, resultAtT60: "UP" as const }; const out = findSimilarPatterns(snap, [row, { ...row, groundTruthId: "future", timestamp: snap.timestamp + 1 }]);
    expect(out.neighborCount).toBe(0);
  });

  it("purges temporal overlap and applies embargo", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ timestamp: i * 1000, id: i })); const folds = purgedWalkForward(rows, 10, 5, 5, 60000);
    expect(folds.length).toBeGreaterThan(0);
    for (const f of folds) { expect(f.validation.every(x => x.timestamp >= f.train.at(-1)!.timestamp + 60000)).toBe(true); expect(f.holdout.every(x => x.timestamp >= f.embargoUntil)).toBe(true); }
  });

  it("produces a shadow-only decision and never operational signal side effects", () => {
    const decision = quantShadowDecision({ snapshot: buildFeatureSnapshot(candles()) });
    expect(["BUY", "SELL", "NO_EDGE"]).toContain(decision.direction);
    expect((decision.pUp ?? 0) + (decision.pDown ?? 0) + (decision.pNoEdge ?? 0)).toBeCloseTo(1, 8);
    expect(decision.shadowOnly).toBe(true);
    expect(decision.policyVersion).toContain("shadow");
  });
});
