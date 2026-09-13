import { describe, expect, it } from "vitest";
import { buildTraceTree, sanitizeHop, type Span } from "../../src/research/trace-tree";
import { buildDecisionProvenance, buildWhy, THRESHOLD_VERSION } from "../../src/research/provenance";

const T = 1_000_000;
const span = (id: string, parent: string | null, component: string, operation: string, offset: number, status = "OK"): Span => ({ spanId: id, parentSpanId: parent, traceId: "trace_1", component, operation, startedAt: T + offset, completedAt: T + offset + 5, latencyMs: 5, status });

describe("distributed trace tree", () => {
  it("builds parent/child hierarchy with duration and errors", () => {
    const tree = buildTraceTree([
      span("root", null, "browser", "MARKET_EVENT", 0),
      span("fast", "root", "fast-path", "FAST_PATH", 1),
      span("regime", "fast", "fast-path", "REGIME", 2),
      span("arbiter", "fast", "arbiter", "ARBITER", 3, "ERROR"),
    ]);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]!.children[0]!.children.map((node) => node.spanId)).toEqual(["regime", "arbiter"]);
    expect(tree.spanCount).toBe(4);
    expect(tree.durationMs).toBeGreaterThanOrEqual(5);
    expect(tree.status).toBe("ERROR");
    expect(tree.errors[0]).toMatchObject({ spanId: "arbiter", component: "arbiter" });
  });

  it("keeps orphan spans as roots and sanitizes hops", () => {
    const tree = buildTraceTree([span("a", "missing", "browser", "OP", 0)], [{ hop: "vercel", route: "/api/fast/decision", method: "POST", status: 200, startedAt: T, completedAt: T + 3, latencyMs: 3, authorization: "Bearer secret" } as never]);
    expect(tree.roots[0]!.spanId).toBe("a");
    expect(JSON.stringify(tree.hops)).not.toContain("Bearer secret");
    expect((sanitizeHop({ hop: "relay", route: "/x", status: 200, startedAt: 1, completedAt: 2, cookie: "abc" } as never) as Record<string, unknown>).cookie).toBeUndefined();
  });
});

describe("decision provenance", () => {
  it("builds complete provenance with structured WHY", () => {
    const provenance = buildDecisionProvenance({ decisionId: "op_1", sessionId: "vision_1", candleId: "candle_1", profile: "BALANCED", decision: "BUY", directionalLean: "BUY", bullScore: .74, bearScore: .26, rawConfidence: .69, regime: "TREND_UP", trendAlignment: "WITH_TREND", blockedBy: [] });
    expect(provenance.decisionId).toBe("op_1");
    expect(provenance.thresholdVersion).toBe(THRESHOLD_VERSION);
    expect(provenance.why.primaryReasons.length).toBeGreaterThan(0);
    expect(provenance.why.supportingEvidence).toContain("regime=TREND_UP");
    expect(provenance.why.rejectedAlternatives[0]).toBe("counter_side=SELL");
    expect(provenance.modelVersions.vision).toBe("claude-opus-5");
  });

  it("flags counter-trend reasons and uncertainty structurally", () => {
    const why = buildWhy({ decisionId: "op_2", profile: "AGGRESSIVE", decision: "WAIT", directionalLean: "BUY", bullScore: .55, bearScore: .45, rawConfidence: .52, counterTrend: true, reversalEvidence: [], blockedBy: ["COUNTER_TREND_NO_REVERSAL_EVIDENCE", "INSUFFICIENT_CONFIDENCE"], regime: "RANGE", trendAlignment: "COUNTER_TREND" });
    expect(why.riskFactors).toContain("counter_trend");
    expect(why.uncertaintyFactors).toContain("COUNTER_TREND_NO_REVERSAL_EVIDENCE");
    expect(why.primaryReasons[0]).toBe("no_profile_threshold_satisfied");
  });
});
