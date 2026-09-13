import { describe, expect, it } from "vitest";
import { breakEvenWinRate, buildCalibration, calibrateConfidence, edgeVsBreakEven, type CalibrationSample } from "../../src/analytics/confidence-calibration";

function sample(confidence: number, result: CalibrationSample["result"], extra: Partial<CalibrationSample> = {}): CalibrationSample {
  return { direction: "BUY", confidence, result, ...extra };
}

describe("confidence calibration from real settlements", () => {
  it("reports INSUFFICIENT_SAMPLE honestly on small samples", () => {
    const report = buildCalibration([sample(.7, "WIN"), sample(.6, "LOSS")]);
    expect(report.status).toBe("INSUFFICIENT_SAMPLE");
    expect(calibrateConfidence(.7, report)).toBeNull();
  });

  it("records buckets with empirical win rate when enough data exists", () => {
    const samples: CalibrationSample[] = [];
    for (let index = 0; index < 40; index++) samples.push(sample(.62, index < 22 ? "WIN" : "LOSS"));
    for (let index = 0; index < 40; index++) samples.push(sample(.72, index < 28 ? "WIN" : "LOSS"));
    for (let index = 0; index < 40; index++) samples.push(sample(.82, index < 34 ? "WIN" : "LOSS"));
    const report = buildCalibration(samples, { minBucketSample: 30, minTotal: 100 });
    expect(report.status).toBe("AVAILABLE");
    const bucket = report.buckets.find((item) => item.bucket === "60-65")!;
    expect(bucket.evaluated).toBe(40);
    expect(bucket.empiricalWinRate).toBeCloseTo(.55, 5);
    const calibrated = calibrateConfidence(.62, report);
    expect(calibrated).not.toBeNull();
    expect(calibrated!).toBeLessThan(.62);
  });

  it("keeps the mapping monotonic", () => {
    const samples: CalibrationSample[] = [];
    for (let index = 0; index < 40; index++) samples.push(sample(.62, index < 30 ? "WIN" : "LOSS")); // 75%
    for (let index = 0; index < 40; index++) samples.push(sample(.72, index < 8 ? "WIN" : "LOSS"));   // 20%
    for (let index = 0; index < 40; index++) samples.push(sample(.82, index < 30 ? "WIN" : "LOSS")); // 75%
    const report = buildCalibration(samples, { minBucketSample: 30, minTotal: 100 });
    for (let index = 1; index < report.mapping.length; index++) expect(report.mapping[index]!.empiricalWinRate).toBeGreaterThanOrEqual(report.mapping[index - 1]!.empiricalWinRate);
  });

  it("excludes synthetic smoke settlements and UNKNOWN results from fitting", () => {
    const synthetic = Array.from({ length: 50 }, () => sample(.7, "WIN", { synthetic: true }));
    const unknown = Array.from({ length: 50 }, () => sample(.7, "UNKNOWN"));
    const report = buildCalibration([...synthetic, ...unknown]);
    expect(report.excludedSynthetic).toBe(50);
    expect(report.excludedUnknown).toBe(50);
    expect(report.status).toBe("INSUFFICIENT_SAMPLE");
    expect(report.evaluated).toBe(0);
  });

  it("counts DRAW without inflating win rate", () => {
    const samples: CalibrationSample[] = [];
    for (let index = 0; index < 30; index++) samples.push(sample(.65, "WIN"));
    for (let index = 0; index < 10; index++) samples.push(sample(.65, "DRAW"));
    for (let index = 0; index < 30; index++) samples.push(sample(.75, "WIN"));
    for (let index = 0; index < 30; index++) samples.push(sample(.85, "WIN"));
    const report = buildCalibration(samples, { minBucketSample: 30, minTotal: 100 });
    const bucket = report.buckets.find((item) => item.bucket === "65-70")!;
    expect(bucket.draws).toBe(10);
    expect(bucket.empiricalWinRate).toBe(1);
  });

  it("computes break-even only from a real payout ratio and never invents one", () => {
    expect(breakEvenWinRate(.86)).toBeCloseTo(1 / 1.86, 6);
    expect(breakEvenWinRate(null)).toBeNull();
    expect(breakEvenWinRate(undefined)).toBeNull();
    expect(breakEvenWinRate(0)).toBeNull();
    expect(edgeVsBreakEven(.6, .86)).toBeCloseTo(.6 - 1 / 1.86, 6);
    expect(edgeVsBreakEven(.6, null)).toBeNull();
  });
});
