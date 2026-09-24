/**
 * V3 AGENT TEAM v4 — DETERMINISTIC_CONSENSUS_ONLY:
 * Wave1 = 6 assessments deterministicos (codigo); prefilter; 1 unico LLM (Consensus/Groq).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const teamModule = await import("../../relay/v3/agents/team.mjs");
// @ts-expect-error - relay ESM sem tipagem
const wave1Module = await import("../../relay/v3/deterministic-wave1.mjs");
// @ts-expect-error - relay ESM sem tipagem
const prefilterModule = await import("../../relay/v3/prefilter.mjs");
const { runAgentCycle, WAVE1_ROLES, CONSENSUS_ROLE } = teamModule as any;
const { deterministicWave1Calls } = wave1Module as any;
const { prefilterWave1 } = prefilterModule as any;

const strong = {
  rsi: { value: 42, zone: "NEUTRAL", momentum: "FLAT", divergence: null, failureSwing: null },
  dmi: { adx: 28, plusDi: 24, minusDi: 12, spread: 12, adxSlope: 1.5 },
  bollinger: { squeeze: "NORMAL", bandWalk: "BELOW_LOWER", rejection: true, reentry: false },
  atr: { regime: "VOLATILITY_COMPATIBLE" },
  structure: { trend: "UPTREND", lastBOS: { type: "BULLISH_BOS" }, lastCHoCH: null },
  pullback: { active: true, depth: "NORMAL", distanceAtr: 0.6 },
  micro: { candle: "BULLISH" },
  breakoutRetest: { breakout: true, breakdown: false, failed: false },
};
const weak = {
  rsi: { value: 50, zone: "NEUTRAL", momentum: "FLAT" },
  dmi: { adx: 10, plusDi: 15, minusDi: 16, spread: -1 },
  bollinger: { squeeze: "NORMAL", bandWalk: "MID", rejection: false, reentry: false },
  atr: { regime: "LOW_INFORMATION_VOLATILITY" },
  structure: { trend: "RANGE", lastBOS: null, lastCHoCH: null },
  pullback: { active: false },
  micro: { candle: "DOJI" },
  breakoutRetest: {},
};
const consensusOK = (result = "CANCEL") => ({
  role: "CONSENSUS_FINAL", status: "OK", reason: null, model: "openai/gpt-oss-120b", provider: "groq", latencyMs: 120, queueWaitMs: 0, schemaValid: true,
  output: { independentAssessment: "evidencias alinhadas", assetComparison: "concordo", scenario: "BREAKOUT", direction: result === "APPROVE_BUY" ? "UP" : result === "APPROVE_SELL" ? "DOWN" : "NONE", agreement: "AGREE", supportingEvidence: [], counterEvidence: [], bestCaseForUp: [], bestCaseAgainstUp: [], bestCaseForDown: [], bestCaseAgainstDown: [], blockers: [], invalidations: [], marketAmbiguities: [], reasons: ["alinhamento"], result },
});

describe("V3 team — Wave1 deterministica + 1 LLM (Consensus)", () => {
  it("ciclo valido: 6 assessments deterministicos (provider=code) + 1 Consensus (groq) = 7 agentCalls", async () => {
    const client = { available: true, call: async () => consensusOK("APPROVE_BUY") };
    const result = await runAgentCycle({ client, measurements: strong, opportunityId: "X:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.available).toBe(true);
    expect(result.agentCalls).toHaveLength(7);
    expect(result.agentCalls.filter((call: any) => call.provider === "code")).toHaveLength(6);
    expect(result.agentCalls.filter((call: any) => call.provider === "groq")).toHaveLength(1);
    expect(result.architecture).toBe("DETERMINISTIC_CONSENSUS_ONLY");
    expect(result.result).toBe("APPROVE_BUY");
    expect(result.prefilter.pass).toBe(true);
  });

  it("PREFILTER reprova candidato fraco => ZERO chamadas LLM, CANCEL/PREFILTER_*", async () => {
    let llmCalls = 0;
    const client = { available: true, call: async () => { llmCalls += 1; return consensusOK(); } };
    const result = await runAgentCycle({ client, measurements: weak, opportunityId: "Y:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.available).toBe(true);
    expect(result.result).toBe("CANCEL");
    expect(result.reason).toMatch(/^PREFILTER_/);
    expect(llmCalls).toBe(0);
  });

  it("Consensus indisponivel (provider error) => available=true, CANCEL/CONSENSUS_UNAVAILABLE (fail-closed)", async () => {
    const client = { available: true, call: async () => ({ role: "CONSENSUS_FINAL", status: "ERROR", reason: "HTTP_402", model: null, provider: "groq", latencyMs: 5, queueWaitMs: 0, schemaValid: false, output: null }) };
    const result = await runAgentCycle({ client, measurements: strong, opportunityId: "Z:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.available).toBe(true);
    expect(result.result).toBe("CANCEL");
    expect(result.reason).toBe("CONSENSUS_UNAVAILABLE");
    expect(result.agentCalls.filter((call: any) => call.provider === "groq")).toHaveLength(1);
  });

  it("INDEPENDENCIA: especialistas deterministas nao dependem do client; Consensus ve todos + asset como hipotese", async () => {
    let consensusPrompt = "";
    const client = { available: true, call: async (input: any) => { consensusPrompt = input.prompt ?? ""; return consensusOK(); } };
    const result = await runAgentCycle({ client, measurements: strong, opportunityId: "W:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.specialists).toBeTruthy();
    expect(result.asset.scenario).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log("PROMPT_DEBUG " + JSON.stringify(consensusPrompt.slice(0, 240)));
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]) expect(consensusPrompt).toContain(role);
    expect(consensusPrompt).toContain("specialistEvidence");
    expect(consensusPrompt).toContain("ASSET_THESIS_TO_CHALLENGE");
  });
});