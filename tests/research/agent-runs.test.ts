import { describe, expect, it } from "vitest";
import { buildAgentRuns } from "../../src/research/agent-runs";

const meta = { sessionId: "vision_x", traceId: "trace_x", marketEventId: "candle_x", frameId: "frame_x", candleId: "candle_x", decisionId: "dec_x", startedAt: 1_000, completedAt: 1_500, model: "claude-opus-5", provider: "nexxus" };

describe("deep agent-run emission", () => {
  it("emits only executed steps with correlation ids", () => {
    const result = buildAgentRuns({ debate: { agents: [
      { name: "BULL_AGENT", score: .7, evidence: ["trend_up"] },
      { name: "BEAR_AGENT", score: .3, evidence: ["weak_down"] },
      { name: "STRUCTURE_MOMENTUM_AGENT", score: .5 },
      { name: "RISK_NO_TRADE_AGENT", score: .4 },
    ], arbiter: { decision: "BUY", directionalLean: "BUY", leanConfidence: .66, latencyMs: 2 } }, advocates: { bull: { bullConfidence: .7, evidence: ["fusion_bull"] }, bear: { bearConfidence: .3, evidence: ["fusion_bear"] } }, meta });
    expect(result.specialistRunIds).toHaveLength(4);
    expect(result.bullRunId).toBeTruthy();
    expect(result.bearRunId).toBeTruthy();
    expect(result.fusionRunId).toBeTruthy();
    expect(result.arbiterRunId).toBeTruthy();
    const arbiter = result.runs.find((run) => run.agentId === "ARBITER")!;
    expect(arbiter.structuredOutput.inputRunIds).toContain(result.fusionRunId);
    expect(arbiter.status).toBe("COMPLETED");
    expect(arbiter.traceId).toBe("trace_x");
    expect(arbiter.marketEventId).toBe("candle_x");
    const fusion = result.runs.find((run) => run.agentId === "FUSION")!;
    expect(fusion.structuredOutput.inputAgentRunIds).toEqual(result.specialistRunIds);
    const bull = result.runs.find((run) => run.agentId === "BULL_ADVOCATE")!;
    expect(bull.structuredOutput.claims).toEqual(["fusion_bull"]);
    for (const run of result.runs) { expect(run.frameId).toBe("frame_x"); expect(run.candleId).toBe("candle_x"); }
  });

  it("marks skipped steps explicitly instead of faking execution", () => {
    const skipped = buildAgentRuns({ debate: null, advocates: null, meta });
    expect(skipped.runs[0]).toMatchObject({ agentId: "FUSION", status: "SKIPPED" });
    expect(skipped.runs[0]!.structuredInput.reason).toBe("deep_debate_not_executed");
    const noAdvocates = buildAgentRuns({ debate: { agents: [{ name: "BULL_AGENT", score: .6 }], arbiter: { decision: "WAIT", directionalLean: "NONE", leanConfidence: 0 } }, advocates: null, meta });
    expect(noAdvocates.runs.find((run) => run.agentId === "BULL_ADVOCATE")!.status).toBe("SKIPPED");
    expect(noAdvocates.runs.find((run) => run.agentId === "BEAR_ADVOCATE")!.status).toBe("SKIPPED");
  });

  it("marks failed steps with sanitized error", () => {
    const failed = buildAgentRuns({ debate: { agents: [{ name: "BULL_AGENT", score: .5, timedOut: true }], arbiter: { decision: "WAIT", directionalLean: "NONE" } }, advocates: null, meta });
    const bull = failed.runs.find((run) => run.agentId === "BULL_AGENT")!;
    expect(bull.status).toBe("FAILED");
    expect(bull.error).toBe("AGENT_TIMEOUT");
  });
});
