import { describe, expect, it } from "vitest";
import { isKnownDecisionId, normalizeDecisionId, traceIdFor } from "../../src/research/ids";

describe("decision id normalization and trace convention", () => {
  it("normalizes new decisions to decision_<unique>", () => {
    expect(normalizeDecisionId("vision_1789315551431", 1_000, "ab12xy")).toBe("decision_1000_ab12xy");
    expect(normalizeDecisionId(undefined, 2_000, "zz99aa")).toMatch(/^decision_2000_zz99aa$/);
  });

  it("keeps historical ids untouched and readable", () => {
    for (const legacy of ["local-1789315545671", "decision_candle_1789315550000", "op_1789315551431_nifzjd", "decision_1789_abc"]) {
      expect(isKnownDecisionId(legacy)).toBe(true);
      expect(normalizeDecisionId(legacy, 999, "xxxxxx")).toBe(legacy);
    }
    expect(isKnownDecisionId("vision_1")).toBe(false);
  });

  it("uses the causal candle trace when available and never the session id", () => {
    expect(traceIdFor("DECISION", "candle_1789315550000", 1_000, "abcd")).toBe("trace_candle_1789315550000");
    expect(traceIdFor("HEARTBEAT", null, 1_000, "abcd")).toBe("trace_HEARTBEAT_1000_abcd");
    expect(traceIdFor("HEARTBEAT", null, 1_000, "abcd")).not.toContain("vision_");
  });
});
