import { describe, expect, it } from "vitest";
import { detectLocalPosition, emptyPositionDetectorMemory, normalizePositionRect, type LocalCropPositionInput } from "../../src/vision/position-detector";

const frame = (frameId: string, candidates: LocalCropPositionInput["candidates"], width = 1000, height = 500): LocalCropPositionInput => ({ frameId, capturedAt: Number(frameId.replace(/\D/g, "")) || 1, width, height, candidates });
const panel = (x = 750, y = 100) => ({ kind: "POSITION_PANEL" as const, confidence: .92, rect: { x, y, width: 180, height: 240 } });
const expiry = (x = 760, y = 200) => ({ kind: "EXPIRY" as const, confidence: .8, rect: { x, y, width: 90, height: 18 } });
const direction = (value: "BUY" | "SELL", x = 770, y = 260) => ({ kind: "DIRECTION_LABEL" as const, direction: value, confidence: .88, rect: { x, y, width: 100, height: 30 } });

describe("local crop position detector", () => {
  it("normalizes ROI independently of crop resolution", () => {
    expect(normalizePositionRect({ x: 500, y: 200, width: 250, height: 100 }, 1000, 500)).toMatchObject({ x: .5, y: .4, width: .25 });
    expect(normalizePositionRect({ x: 500, y: 200, width: 250, height: 100 }, 1000, 500)?.height).toBeCloseTo(.2);
    expect(normalizePositionRect({ x: 1000, y: 400, width: 500, height: 200 }, 2000, 1000)).toMatchObject({ x: .5, y: .4, width: .25 });
    expect(normalizePositionRect({ x: 1000, y: 400, width: 500, height: 200 }, 2000, 1000)?.height).toBeCloseTo(.2);
  });

  it("requires two different local crop frames before confirming a position", () => {
    const first = detectLocalPosition(frame("frame-1", [panel(), expiry(), direction("BUY")]));
    expect(first).toMatchObject({ state: "POSSIBLE_POSITION", direction: "BUY", candidateFrames: 1 });
    const second = detectLocalPosition(frame("frame-2", [panel(), expiry(), direction("BUY")]), first.memory);
    expect(second).toMatchObject({ state: "POSITION_CONFIRMED", direction: "BUY", candidateFrames: 2 });
    expect(second.roi?.x).toBeCloseTo(.75);
  });

  it("keeps direction UNKNOWN when the panel is visible but has no readable direction", () => {
    const one = detectLocalPosition(frame("unknown-1", [panel(), expiry()]));
    const two = detectLocalPosition(frame("unknown-2", [panel(), expiry()]), one.memory);
    expect(two).toMatchObject({ state: "POSITION_CONFIRMED", direction: "UNKNOWN" });
  });

  it("marks opposing direction labels as mismatch and never chooses a side", () => {
    const result = detectLocalPosition(frame("mismatch-1", [panel(), expiry(), direction("BUY"), direction("SELL", 780, 300)]));
    expect(result).toMatchObject({ state: "POSITION_UNCERTAIN", direction: "UNKNOWN", mismatch: true });
    expect(result.evidence).toContain("DIRECTION_MISMATCH");
  });

  it("does not accept chart text or one isolated direction label as a position", () => {
    const chartNoise = detectLocalPosition(frame("noise-1", [{ kind: "OTHER", text: "ACIMA", confidence: .99, rect: { x: 100, y: 100, width: 30, height: 20 } }, direction("BUY")]));
    expect(chartNoise).toMatchObject({ state: "NO_POSITION", direction: "UNKNOWN" });
  });

  it("rejects duplicate frames and malformed rectangles", () => {
    const first = detectLocalPosition(frame("dup-1", [panel(), expiry()]));
    const duplicate = detectLocalPosition(frame("dup-1", [panel(), expiry()]), first.memory);
    expect(duplicate).toMatchObject({ state: "NO_POSITION", direction: "UNKNOWN" });
    expect(normalizePositionRect({ x: 0, y: 0, width: -1, height: 5 }, 100, 100)).toBeNull();
  });

  it("detects direction mismatch across confirmation frames", () => {
    const first = detectLocalPosition(frame("switch-1", [panel(), expiry(), direction("BUY")]), emptyPositionDetectorMemory());
    const confirmed = detectLocalPosition(frame("switch-2", [panel(), expiry(), direction("BUY")]), first.memory);
    const conflict = detectLocalPosition(frame("switch-3", [panel(), expiry(), direction("SELL")]), confirmed.memory);
    expect(conflict).toMatchObject({ state: "POSITION_UNCERTAIN", direction: "UNKNOWN", mismatch: true });
  });
});
