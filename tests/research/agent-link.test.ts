import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentRunIdsByRole, decisionLinkStatus, LEGACY_INCOMPLETE_AGENT_LINK, type LinkRun } from "../../src/research/agent-link";

const run = (agentId: string, status = "COMPLETED", error: string | null = null): LinkRun => ({ agentRunId: `run_${agentId}`, agentId, status, error });

describe("canonical decision -> agent run links", () => {
  it("links all eight slots from persisted runs", () => {
    const runs = [run("PRICE_ACTION"), run("MOMENTUM_CANDLE"), run("QUANT_GEOMETRY"), run("RISK_CONTRARIAN"), run("BULL_ADVOCATE"), run("BEAR_ADVOCATE"), run("FUSION"), run("ARBITER")];
    const ids = agentRunIdsByRole(runs);
    expect(Object.values(ids).every((v) => v.runId !== null)).toBe(true);
    expect(ids.arbiter!.runId).toBe("run_ARBITER");
  });

  it("keeps failed runs explicit with failure reason and skipped status", () => {
    const runs = [run("PRICE_ACTION", "FAILED", "timeout"), run("MOMENTUM_CANDLE", "SKIPPED"), run("ARBITER")];
    const ids = agentRunIdsByRole(runs);
    expect(ids.priceAction).toMatchObject({ status: "FAILED", failureReason: "timeout" });
    expect(ids.momentum!.status).toBe("SKIPPED");
    expect(ids.quant!.runId).toBeNull();
    expect(ids.quant!.status).toBe("MISSING");
  });

  it("marks legacy operations instead of inventing links", () => {
    expect(decisionLinkStatus("local-1789315545671", [run("ARBITER")])).toBe(LEGACY_INCOMPLETE_AGENT_LINK);
    expect(decisionLinkStatus("decision_1789317310788_oefsft", [])).toBe(LEGACY_INCOMPLETE_AGENT_LINK);
    expect(decisionLinkStatus("decision_1789317310788_oefsft", [run("ARBITER")])).toBe("COMPLETE");
  });

  it("contract: canonical id is sent to deep pipeline and persisted on agent runs", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    const api = readFileSync("api/http.ts", "utf8");
    const relay = readFileSync("relay/server.mjs", "utf8");
    expect(app).toContain("decisionId");
    expect(app).toContain("/api/fable/trade");
    expect(app).toContain("restoreOperationalSnapshot");
    expect(api).toContain("snapshotObject.decisionId");
    expect(relay).toContain("decision_id,candle_id,frame_id) VALUES(");
    expect(relay).toContain("decisions\\/([^/]+)\\/agent-runs");
    expect(relay).toContain("operations\\/([^/]+)\\/agent-runs");
    expect(relay).toContain("agentJoinCoverage");
  });
});
