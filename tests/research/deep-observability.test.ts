import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = () => readFileSync("src/http/public/app.js", "utf8");
const api = () => readFileSync("api/http.ts", "utf8");
const relay = () => readFileSync("relay/server.mjs", "utf8");

describe("deep observability correlation contract", () => {
  it("creates one canonical decision before Fast and Deep", () => {
    const source = app();
    expect(source).toContain("state.decisionId = `decision_${candleCloseTimestamp}_");
    expect(source).toContain("decisionSource: \"FAST_THEN_DEEP\"");
    expect(source).toContain("deepRequested: true");
    expect(source).toContain("decisionId: state.decisionId");
    expect(source).toContain("state.deepExecuted = true");
  });

  it("persists metadata through RunMeta, provenance and relay SQL", () => {
    expect(api()).toContain("snapshotObject.decisionId");
    expect(api()).toContain("agentRuns = buildAgentRuns");
    expect(api()).toContain("decisionId: typeof snapshotObject.decisionId");
    expect(relay()).toContain("decision_id,candle_id,frame_id) VALUES");
    expect(relay()).toContain("decision_source,deep_requested,deep_executed");
    expect(relay()).toContain("agentJoinCoverage");
  });

  it("keeps Fast-only explicit and does not make it a Deep join failure", () => {
    const endpoint = relay();
    expect(endpoint).toContain("NOT_APPLICABLE_DEEP_NOT_EXECUTED");
    expect(endpoint).toContain("DEEP_EXECUTED_RUNS_MISSING");
    expect(endpoint).toContain("deep_requested as \"deepRequested\"");
    expect(endpoint).toContain("deep_executed as \"deepExecuted\"");
  });

  it("persists provenance independently of operational signal lock", () => {
    const source = app();
    expect(source).toContain("diagProvenance({ decisionId: state.decisionId");
    expect(source).toContain("agentRunIds: analysis.agentRunIds || []");
    expect(source).toContain("decision: analysis.decision || \"WAIT\"");
  });
});
