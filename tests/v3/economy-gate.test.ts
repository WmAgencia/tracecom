/**
 * ECONOMIA (C): zero chamadas LLM quando o sistema esta inativo; resposta in-flight descartada apos STOP.
 * Gate no llm-client (fronteira do provider), testavel com runner fake.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
const { createLlmAgentClient } = clientModule as any;

const validConsensusOutput = {
  independentAssessment: "evidencias alinhadas", assetComparison: "concordo", scenario: "BREAKOUT", direction: "UP", agreement: "AGREE",
  supportingEvidence: [], counterEvidence: [], bestCaseForUp: [], bestCaseAgainstUp: [], bestCaseForDown: [], bestCaseAgainstDown: [],
  blockers: [], invalidations: [], marketAmbiguities: [], reasons: ["alinhamento"], result: "CANCEL",
};
const okResult = { status: "OK", reason: null, model: "m", provider: "nvidia", text: JSON.stringify(validConsensusOutput), parsed: validConsensusOutput, latencyMs: 5, httpStatus: 200, limits: {} };

describe("V3 economia — gate no provider", () => {
  it("sistema INATIVO => ZERO chamadas ao provider (gate antes do request)", async () => {
    let providerCalls = 0;
    const client = createLlmAgentClient({ runner: async () => { providerCalls += 1; return okResult; }, activityCheck: () => false, now: () => Date.now() });
    const call = await client.call({ role: "CONSENSUS_FINAL", prompt: "x", requestId: "r1", opportunityId: "O" });
    expect(providerCalls).toBe(0);
    expect(call.status).toBe("ERROR");
    expect(call.reason).toBe("SYSTEM_INACTIVE");
  });

  it("sistema ATIVO => provider chamado normalmente", async () => {
    let providerCalls = 0;
    const client = createLlmAgentClient({ runner: async () => { providerCalls += 1; return { ...okResult, text: JSON.stringify({ a: 1 }) }; }, activityCheck: () => true, now: () => Date.now() });
    const call = await client.call({ role: "CONSENSUS_FINAL", prompt: "x", requestId: "r2", opportunityId: "O" });
    expect(providerCalls).toBe(1);
    expect(call.status).toBe("OK");
  });

  it("STOP durante a chamada => resposta in-flight DESCARTADA (nunca vira aprovacao)", async () => {
    let active = true;
    let providerCalls = 0;
    const client = createLlmAgentClient({ runner: async () => { providerCalls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { ...okResult, text: JSON.stringify({ result: "APPROVE_BUY" }) }; }, activityCheck: () => active, now: () => Date.now() });
    const pending = client.call({ role: "CONSENSUS_FINAL", prompt: "x", requestId: "r3", opportunityId: "O" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    active = false; // sistema desligado no meio da chamada
    const call = await pending;
    expect(providerCalls).toBe(1); // a chamada aconteceu (estava ativa), mas...
    expect(call.status).toBe("ERROR");
    expect(call.reason).toBe("INACTIVE_INVALIDATED");
    expect(call.output).toBeNull();
  });
});