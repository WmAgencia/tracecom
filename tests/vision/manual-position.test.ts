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

  it("never accepts market movement as the human position direction", () => {
    const fastSaysSell = updateManualPosition(emptyManualPosition(), { manualPosition: { state: "POSITION_CONFIRMED", direction: "SELL", confidence: .9, evidence: ["green_candles", "uptrend"] } }, 1000);
    expect(fastSaysSell.direction).toBe("UNKNOWN");
    expect(fastSaysSell.state).toBe("POSSIBLE_POSITION");
    const fastSaysBuy = updateManualPosition(emptyManualPosition(), { manualPosition: { state: "POSITION_CONFIRMED", direction: "BUY", confidence: .9, evidence: ["red_candles", "downtrend"] } }, 1000);
    expect(fastSaysBuy.direction).toBe("UNKNOWN");
  });

  it("confirms an existing position even when the direction is temporarily unreadable", () => {
    const result = updateManualPosition(emptyManualPosition(), { manualPosition: { hasOpenPosition: true, state: "POSITION_CONFIRMED", direction: "UNKNOWN", confidence: .7, evidence: ["open_positions_panel"] } }, 1000);
    expect(result.state).toBe("POSITION_CONFIRMED");
    expect(result.direction).toBe("UNKNOWN");
    expect(result.hasOpenPosition).toBe(true);
  });

  it("confirms through consecutive frames (possible then panel card)", () => {
    const first = updateManualPosition(emptyManualPosition(), { manualPosition: { state: "POSSIBLE_POSITION", direction: "UNKNOWN", confidence: .5, evidence: ["position_region_changed"] } }, 1000);
    expect(first.state).toBe("POSSIBLE_POSITION");
    const second = updateManualPosition(first, { manualPosition: { hasOpenPosition: true, state: "POSITION_CONFIRMED", direction: "BUY", confidence: .8, evidence: ["open_position_card", "acima"] } }, 3000);
    expect(second.state).toBe("POSITION_CONFIRMED");
    expect(second.direction).toBe("BUY");
    expect(second.detectedAt).toBe(1000);
  });

  it("does not erase an open position on a single weak frame", () => {
    const open = updateManualPosition(emptyManualPosition(), { manualPosition: { hasOpenPosition: true, state: "POSITION_CONFIRMED", direction: "UNKNOWN", confidence: .7, evidence: ["position_panel"] } }, 1000);
    const weak = updateManualPosition(open, { manualPosition: { state: "NO_POSITION", direction: "UNKNOWN", confidence: .2, evidence: [] } }, 2000);
    expect(weak.hasOpenPosition).toBe(true);
    expect(weak.state).toBe("POSITION_CONFIRMED");
  });
});
