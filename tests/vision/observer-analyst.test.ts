import { describe, expect, it, vi } from "vitest";
import { MarketObserver } from "../../src/vision/market-observer";
import { analyzeTechnicalState } from "../../src/vision/technical-analyst";

describe("Observer + Technical Analyst runtime contracts", () => {
  it("runs single-flight observations around 1Hz and persists every result", async () => {
    const persisted: string[] = []; let resolveCapture!: () => void; const capture = vi.fn(() => new Promise<any>((resolve) => { resolveCapture = () => resolve({ observationId: `o${persisted.length}`, capturedAt: Date.now(), processedAt: Date.now(), positionExists: false, positionDirection: "UNKNOWN", observationQuality: "VALID" }); })); const observer = new MarketObserver(capture, (o) => { persisted.push(o.observationId); }, 5); observer.start(); await new Promise(r => setTimeout(r, 10)); resolveCapture(); await new Promise(r => setTimeout(r, 10)); observer.stop(); expect(capture).toHaveBeenCalled(); expect(persisted.length).toBeGreaterThan(0); expect(observer.metrics().overlappingJobs).toBe(0);
  });
  it("never lets the Technical Analyst invent an observation and keeps WAIT valid", () => { const out = analyzeTechnicalState({ candles: [], marketContextId: "mc", segmentId: "seg", referencePrice: null, observationsAvailable: 0 }); expect(out.decision).toBe("WAIT"); expect(out.shadowOnly).toBe(true); });
});
