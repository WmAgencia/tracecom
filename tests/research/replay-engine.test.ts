import { describe, expect, it } from "vitest";
import { buildDiagnosticCropSample, causalHistory, compareVariants, replayEvent, runVariants, type ReplayEvent } from "../../src/research/replay-engine";

const BASE = 1_000_000;

function event(index: number): ReplayEvent {
  const at = BASE + index * 5_000;
  const prices = [] as ReplayEvent["prices"];
  for (let step = 0; step < 12; step++) prices.push({ value: 1.3850 + index * .0001 + step * .0002, timestamp: at - (11 - step) * 2_000, accepted: true, source: "IQ_OPTION_CURRENT_PRICE_LABEL" });
  return { marketEventId: `me_${index}`, groundTruthId: `gt_${index}`, at, prices, frames: [{ capturedAt: at - 1_000, frameDifference: .02 }], deepContext: { version: 1, at: at - 30_000, trend: "BULLISH", momentum: "UP" }, groundTruth: { entryPrice: 1.3850 + index * .0001 + 22 * .0001, exitPrice: 1.3850 + index * .0001 + 22 * .0001 + .0004, dueTimestamp: at + 60_000 } };
}

describe("causal replay and variant testing", () => {
  it("uses only prices at or before the event timestamp", () => {
    const target = event(0);
    const future = { value: 9.9, timestamp: target.at + 30_000, accepted: true };
    const withFuture = { ...target, prices: [...target.prices, future] };
    expect(causalHistory(withFuture)).toEqual(causalHistory(target));
    expect(replayEvent(withFuture, { variantId: "a" }).decision).toBe(replayEvent(target, { variantId: "a" }).decision);
  });

  it("runs 1000 evaluations over 25 unique market events sharing ground truth", async () => {
    const events = Array.from({ length: 25 }, (_, index) => event(index));
    const variants = Array.from({ length: 40 }, (_, index) => ({ variantId: `variant_${index}`, profile: index % 3 === 0 ? "CONSERVATIVE" as const : index % 3 === 1 ? "BALANCED" as const : "AGGRESSIVE" as const }));
    const report = await runVariants(events, variants, { concurrency: 4 });
    expect(report.evaluations).toHaveLength(1000);
    expect(report.uniqueMarketEvents).toBe(25);
    expect(report.uniqueGroundTruths).toBe(25);
    expect(report.brokerSideEffects).toBe(0);
    for (const evaluation of report.evaluations) {
      expect(evaluation.groundTruthId).toBe(`gt_${evaluation.marketEventId.split("_")[1]}`);
      expect(evaluation.predictionHorizonSeconds).toBe(60);
      expect(evaluation.brokerSideEffects).toBe(0);
    }
    expect(Object.keys(report.perVariant)).toHaveLength(40);
  });

  it("compares two variants on the same events", async () => {
    const events = Array.from({ length: 10 }, (_, index) => event(index));
    const a = await runVariants(events, [{ variantId: "conservative", profile: "CONSERVATIVE" }]);
    const b = await runVariants(events, [{ variantId: "aggressive", profile: "AGGRESSIVE" }]);
    const comparison = compareVariants(a.evaluations, b.evaluations);
    expect(comparison.eventsCompared).toBe(10);
    expect(comparison.agreements + comparison.disagreements).toBe(10);
    expect(comparison.aSignalRate).toBeGreaterThanOrEqual(0);
    expect(comparison.bSignalRate).toBeGreaterThanOrEqual(comparison.aSignalRate);
  });

  it("never exports a full desktop frame description", () => {
    expect(buildDiagnosticCropSample({ dataUrl: "data:image/jpeg;base64,AAAA", width: 100, height: 50, frameId: "f1", capturedAt: 1 })).toMatchObject({ sanitized: true, frameId: "f1" });
    expect(buildDiagnosticCropSample({ dataUrl: "desktop://full-screen" })).toBeNull();
    expect(buildDiagnosticCropSample(null)).toBeNull();
  });
});
