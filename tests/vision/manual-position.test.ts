import { describe, expect, it } from "vitest";
import { emptyManualPosition, updateManualPosition } from "../../src/vision/manual-position";

describe("manual visual position state", () => {
  it("does not invent a position without explicit visual evidence", () => {
    expect(updateManualPosition(emptyManualPosition(), { trend: "BUY" }).state).toBe("NO_POSITION");
  });
  it("tracks confirmed direction and preserves linked model context", () => {
    const result = updateManualPosition(emptyManualPosition(), { manualPosition: { state: "POSITION_CONFIRMED", direction: "BUY", confidence: "0.82", evidence: ["entry_marker", "position_panel"] } }, 1000, "decision-1", "BUY");
    expect(result).toMatchObject({ state: "POSITION_CONFIRMED", direction: "BUY", confidence: .82, detectedAt: 1000, linkedDecisionId: "decision-1", linkedLean: "BUY" });
  });
});
