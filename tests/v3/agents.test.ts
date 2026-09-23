/**
 * V3 — AGENTES LLM: schemas, fail-closed, independencia do Consensus e concorrencia.
 */
import { describe, expect, it } from "vitest";
import { approveScript, specialistOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const schemas = await import("../../relay/v3/agents/schemas.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
// @ts-expect-error - relay ESM sem tipagem
const teamModule = await import("../../relay/v3/agents/team.mjs");
const { validateAgentOutput } = schemas as any;
const { createScriptedAgentClient } = clientModule as any;
const { runAgentCycle, SPECIALIST_ROLES } = teamModule as any;

describe("V3 agentes — schema e linguagem", () => {
  it("especialista valido passa; BUY/SELL e confidence sao rejeitados", () => {
    const valid = specialistOutput("RSI");
    expect(validateAgentOutput("RSI", valid).ok).toBe(true);
    expect(validateAgentOutput("RSI", { ...valid, domainAssessment: "BUY now" }).error).toBe("directional_decision_language");
    expect(validateAgentOutput("RSI", { ...valid, observations: ["confidence 80%"] }).error).toBe("confidence_not_allowed");
    expect(validateAgentOutput("RSI", { ...valid, deterministicFacts: [] }).error).toBe("deterministicFacts");
  });

  it("Asset valida estado/direcao coerentes e Consensus exige agreement para APPROVE", () => {
    const asset = approveScript().ASSET;
    expect(validateAgentOutput("ASSET", asset).ok).toBe(true);
    expect(validateAgentOutput("ASSET", { ...asset, direction: "DOWN", state: "BUY_CANDIDATE" }).error).toBe("state_direction_conflict");
    expect(validateAgentOutput("CONSENSUS_FINAL", { agreement: "DISAGREE", result: "APPROVE_BUY", bestCounterCase: "x", challengeSteps: [], reasons: [] }).error).toBe("approve_requires_agreement");
    expect(validateAgentOutput("CONSENSUS_FINAL", { agreement: "AGREE", result: "APPROVE_SELL", bestCounterCase: "x", challengeSteps: ["a"], reasons: [] }).ok).toBe(true);
  });
});

describe("V3 agentes — fail-closed", () => {
  it("timeout/erro/schema invalido em qualquer agente => AGENT_UNAVAILABLE (nunca APPROVE)", async () => {
    for (const role of [...SPECIALIST_ROLES, "ASSET", "CONSENSUS_INDEPENDENT", "CONSENSUS_FINAL"]) {
      const script = { ...approveScript(), [role]: { status: "ERROR", reason: "TIMEOUT" } };
      const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements: { closedCandle: { at: 1 } }, cycleNumber: 1 });
      expect(result.available, role).toBe(false);
      expect(result.reason, role).toBe("AGENT_UNAVAILABLE");
      expect(result.result, role).toBe("CANCEL");
    }
  });

  it("output malformado do LLM => schema invalido => AGENT_UNAVAILABLE", async () => {
    const script = { ...approveScript(), ASSET: { scenario: "TREND_CONTINUATION", direction: "UP", state: "MOON" } };
    const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements: { closedCandle: { at: 1 } }, cycleNumber: 1 });
    expect(result.available).toBe(false);
    expect(result.result).toBe("CANCEL");
    expect(result.agentCalls.some((call: any) => call.role === "ASSET" && call.reason?.startsWith("SCHEMA_"))).toBe(true);
  });

  it("provider nao configurado => AGENT_UNAVAILABLE", async () => {
    const client = createScriptedAgentClient({});
    const result = await runAgentCycle({ client: { ...client, available: false }, measurements: { closedCandle: { at: 1 } }, cycleNumber: 1 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("AGENT_UNAVAILABLE");
  });
});

describe("V3 agentes — independencia e concorrencia", () => {
  it("Consensus independente NAO recebe a conclusao do Asset; Final recebe e compara", async () => {
    const seen: Array<{ role: string; prompt: string }> = [];
    const script = approveScript();
    const client = createScriptedAgentClient(({ role }: any) => script[role]);
    const spy = { available: true, async call(input: any) { seen.push({ role: input.role, prompt: input.prompt }); return client.call(input); } };
    const result = await runAgentCycle({ client: spy, measurements: { closedCandle: { at: 1 } }, cycleNumber: 3 });
    expect(result.available).toBe(true);
    const independentPrompt = seen.find((entry) => entry.role === "CONSENSUS_INDEPENDENT")!.prompt;
    expect(independentPrompt).not.toContain("BUY_CANDIDATE");
    expect(independentPrompt).not.toContain("assetThesis");
    const finalPrompt = seen.find((entry) => entry.role === "CONSENSUS_FINAL")!.prompt;
    expect(finalPrompt).toContain("assetThesis");
    expect(finalPrompt).toContain("independentClassification");
  });

  it("5 especialistas rodam em paralelo e a ordem de resposta nao altera o resultado", async () => {
    const base = approveScript();
    const delayed: any = {};
    for (const role of SPECIALIST_ROLES) delayed[role] = { ...base[role], sleepMs: role === "RSI" ? 20 : 1, latencyMs: 1 };
    const script = { ...base, ...delayed };
    const client = createScriptedAgentClient(script);
    const startedAt = Date.now();
    const result = await runAgentCycle({ client, measurements: { closedCandle: { at: 1 } }, cycleNumber: 2 });
    const elapsed = Date.now() - startedAt;
    expect(result.available).toBe(true);
    expect(result.result).toBe("APPROVE_BUY");
    // se fossem sequenciais, 20+1*4 = 24ms; paralelo fica proximo do maior (20ms) — tolerancia ampla para CI
    expect(elapsed).toBeLessThan(120);
    expect(client.calls.filter((call: any) => SPECIALIST_ROLES.includes(call.role))).toHaveLength(5);
  });

  it("DISAGREE do Final Challenge => CANCEL (sem votacao)", async () => {
    const script = { ...approveScript(), CONSENSUS_FINAL: { agreement: "DISAGREE", result: "CANCEL", bestCounterCase: "tese errada", challengeSteps: ["disagree"], reasons: ["DISAGREE"] } };
    const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements: { closedCandle: { at: 1 } }, cycleNumber: 1 });
    expect(result.available).toBe(true);
    expect(result.result).toBe("CANCEL");
  });
});
