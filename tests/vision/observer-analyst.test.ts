import { describe, expect, it, vi } from "vitest";
import { MarketObserver } from "../../src/vision/market-observer";
import { analyzeTechnicalState } from "../../src/vision/technical-analyst";
import { retrieveTechnicalKnowledge } from "../../src/vision/knowledge-base";
import { buildMarketState } from "../../src/vision/market-state";

describe("Observer + Technical Analyst runtime contracts", () => {
  it("runs single-flight observations around 1Hz and persists every result", async () => {
    const persisted: string[] = []; let resolveCapture!: () => void; const capture = vi.fn(() => new Promise<any>((resolve) => { resolveCapture = () => resolve({ observationId: `o${persisted.length}`, capturedAt: Date.now(), processedAt: Date.now(), positionExists: false, positionDirection: "UNKNOWN", observationQuality: "VALID" }); })); const observer = new MarketObserver(capture, (o) => { persisted.push(o.observationId); }, 5); observer.start(); await new Promise(r => setTimeout(r, 10)); resolveCapture(); await new Promise(r => setTimeout(r, 10)); observer.stop(); expect(capture).toHaveBeenCalled(); expect(persisted.length).toBeGreaterThan(0); expect(observer.metrics().overlappingJobs).toBe(0);
  });
  it("never lets the Technical Analyst invent an observation and keeps WAIT valid", () => { const out = analyzeTechnicalState({ candles: [], marketContextId: "mc", segmentId: "seg", referencePrice: null, observationsAvailable: 0 }); expect(out.decision).toBe("WAIT"); expect(out.shadowOnly).toBe(true); });
  it("builds bounded multi-horizon state and retrieves contextual knowledge", () => { const candles = Array.from({ length: 20 }, (_, i) => ({ provider: "f", symbol: "NZD/USD", timeframe: "1m" as const, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1, timestamp: i * 5000, receivedAt: i * 5000, isClosed: true, source: "fixture", quality: "high" as const })); const state = buildMarketState(candles, "seg_1"); expect(state.version).toBe("market-state-v1"); expect(state.horizons["5h"]?.available).toBe(false); expect(retrieveTechnicalKnowledge({ regime: "RANGE" }).length).toBeGreaterThan(0); });
});
