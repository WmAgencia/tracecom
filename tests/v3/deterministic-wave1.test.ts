/**
 * V3 — WAVE1 DETERMINISTICA + PREFILTER + ciclo com 1 unico LLM (Consensus).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const wave1Module = await import("../../relay/v3/deterministic-wave1.mjs");
const { deterministicWave1Calls, classifyScenario } = wave1Module as any;
// @ts-expect-error - relay ESM sem tipagem
const prefilterModule = await import("../../relay/v3/prefilter.mjs");
const { prefilterWave1 } = prefilterModule as any;
// @ts-expect-error - relay ESM sem tipagem
const schemasModule = await import("../../relay/v3/agents/schemas.mjs");
const { SPECIALIST_SCHEMA, ASSET_SCHEMA } = schemasModule as any;
// @ts-expect-error - relay ESM sem tipagem
const teamModule = await import("../../relay/v3/agents/team.mjs");
const { runAgentCycle } = teamModule as any;

const strongMeasurements = {
  rsi: { value: 42, zone: "NEUTRAL", momentum: "FLAT", divergence: null, failureSwing: null },
  dmi: { adx: 28, plusDi: 24, minusDi: 12, spread: 12, adxSlope: 1.5, trendState: "TRENDING" },
  bollinger: { zone: "MIDDLE", squeeze: false },
  atr: { regime: "VOLATILITY_COMPATIBLE", atr: 0.0004 },
  structure: { trend: "UPTREND", lastBOS: { type: "BULLISH_BOS" }, lastCHoCH: null, lastHigh: { price: 1.09 }, lastLow: { price: 1.08 } },
  pullback: { active: true, depth: "NORMAL", distanceAtr: 0.6 },
  micro: { candle: "BULLISH", structure: "HL" },
  breakoutRetest: { breakout: true, breakdown: false, failed: false },
};

const neutralMeasurements = {
  rsi: { value: 50, zone: "NEUTRAL", momentum: "FLAT", divergence: null, failureSwing: null },
  dmi: { adx: 10, plusDi: 15, minusDi: 16, spread: -1, adxSlope: -0.5 },
  bollinger: { zone: "MIDDLE", squeeze: true },
  atr: { regime: "LOW_INFORMATION_VOLATILITY" },
  structure: { trend: "RANGE", lastBOS: null, lastCHoCH: null },
  pullback: { active: false },
  micro: { candle: "DOJI" },
  breakoutRetest: {},
};

const validConsensus = {
  role: "CONSENSUS_FINAL", status: "OK", reason: null, model: "openai/gpt-oss-120b", provider: "groq", latencyMs: 100, queueWaitMs: 0, schemaValid: true,
  output: { independentAssessment: "Evidencias apontam continuacao compradora dentro da tendencia.", assetComparison: "Concordo com a tese do Asset.", scenario: "PULLBACK_CONTINUATION", direction: "UP", agreement: "AGREE", supportingEvidence: ["BOS recente", "pressao DMI positiva"], counterEvidence: [], bestCaseForUp: ["retomada apos pullback"], bestCaseAgainstUp: ["falha em superar o extremo"], bestCaseForDown: [], bestCaseAgainstDown: [], blockers: [], invalidations: [], marketAmbiguities: [], reasons: ["alinhamento estrutural"], result: "CANCEL" },
};

describe("V3 wave1 deterministica", () => {
  it("produz 6 assessments no schema real (5 especialistas + ASSET), sem numeros em prosa", () => {
    const calls = deterministicWave1Calls(strongMeasurements);
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.status).toBe("OK");
      expect(call.model).toBe("deterministic");
      expect(call.provider).toBe("code");
      expect(call.latencyMs).toBe(0);
      expect(call.output).toBeTruthy();
      if (call.role === "ASSET") {
        const error = ASSET_SCHEMA.validate(call.output);
        expect(error).toBeNull();
        expect(call.output.scenario).toBe("BREAKOUT");
        expect(call.output.direction).toBe("UP");
        expect(call.output.state).toBe("BUY_CANDIDATE");
      } else {
        const error = SPECIALIST_SCHEMA.validate(call.output);
        expect(error).toBeNull();
        expect(/\d/.test(JSON.stringify(call.output.facts.map((f: any) => f.code)))).toBe(false);
      }
    }
  });

  it("sem medicoes: fallback seguro (NEUTRAL + blockers), schemas ainda validos", () => {
    const calls = deterministicWave1Calls({});
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      const error = call.role === "ASSET" ? ASSET_SCHEMA.validate(call.output) : SPECIALIST_SCHEMA.validate(call.output);
      expect(error).toBeNull();
    }
    const asset = calls.find((call: any) => call.role === "ASSET");
    expect(asset.output.state).toBe("NO_SETUP");
  });
});

describe("V3 prefilter", () => {
  it("candidato forte (alinhamento + asset BUY_CANDIDATE + sem blocker critico) passa", () => {
    const calls = deterministicWave1Calls(strongMeasurements);
    const asset = calls.find((call: any) => call.role === "ASSET");
    const decision = prefilterWave1({ calls, asset, env: {} });
    expect(decision.pass).toBe(true);
    expect(decision.alignment).toBeGreaterThanOrEqual(2);
  });

  it("candidato fraco (range/squeeze/asset NO_SETUP) e reprovado sem LLM", () => {
    const calls = deterministicWave1Calls(neutralMeasurements);
    const asset = calls.find((call: any) => call.role === "ASSET");
    const decision = prefilterWave1({ calls, asset, env: {} });
    expect(decision.pass).toBe(false);
    expect(["PREFILTER_NO_ASSET_CANDIDATE", "PREFILTER_WEAK_ALIGNMENT", "PREFILTER_CRITICAL_BLOCKER"].includes(decision.reason)).toBe(true);
  });
});

describe("V3 ciclo com 1 unico LLM", () => {
  it("prefilter reprovado => ZERO chamadas LLM, resultado CANCEL/PREFILTER_REJECTED", async () => {
    let llmCalls = 0;
    const client = { available: true, call: async () => { llmCalls += 1; return validConsensus; } };
    const result = await runAgentCycle({ client, measurements: neutralMeasurements, opportunityId: "X:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.available).toBe(true);
    expect(result.result).toBe("CANCEL");
    expect(result.reason).toMatch(/^PREFILTER_/);
    expect(llmCalls).toBe(0);
    expect(result.agentCalls).toHaveLength(6);
  });

  it("prefilter aprovado => EXATAMENTE 1 chamada LLM (Consensus) e pipeline completo (6 DET + 1 LLM = 7)", async () => {
    let llmCalls = 0;
    const client = { available: true, call: async () => { llmCalls += 1; return validConsensus; } };
    const result = await runAgentCycle({ client, measurements: strongMeasurements, opportunityId: "Y:1", cycleNumber: 1, now: () => 1_000_000 });
    expect(result.available).toBe(true);
    expect(llmCalls).toBe(1);
    expect(result.agentCalls).toHaveLength(7);
    expect(result.agentCalls.filter((call: any) => call.provider === "code")).toHaveLength(6);
    expect(result.agentCalls.filter((call: any) => call.provider === "groq")).toHaveLength(1);
    expect(result.consensus.result).toBe("CANCEL");
  });
});