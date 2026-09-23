/**
 * V3 — AGENTES v2: structured output, schemas compactos, validacao semantica,
 * fail-closed (timeout/truncamento/429/5xx/parcial), 2-wave, bilateral e Final Gate deterministico.
 */
import { describe, expect, it } from "vitest";
import { approveScript, bilateralOutput, specialistOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const schemas = await import("../../relay/v3/agents/schemas.mjs");
// @ts-expect-error - relay ESM sem tipagem
const capabilities = await import("../../relay/v3/agents/capabilities.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
// @ts-expect-error - relay ESM sem tipagem
const teamModule = await import("../../relay/v3/agents/team.mjs");
// @ts-expect-error - relay ESM sem tipagem
const gateModule = await import("../../relay/v3/final-gate.mjs");
const { validateAgentOutput, numericGroundingError, collectInputNumbers } = schemas as any;
const { CAPABILITIES, agentRequestOptions } = capabilities as any;
const { createScriptedAgentClient, createLlmAgentClient, rescueJsonExcerpt } = clientModule as any;
const { runAgentCycle, SPECIALIST_ROLES } = teamModule as any;
const { finalGate } = gateModule as any;

const measurements = { closedCandle: { at: 1, open: 1, high: 1, low: 1, close: 1 }, structure: { trend: "UPTREND", lastBOS: { type: "BULLISH_BOS" } }, rsi: { value: 45, slope: 1.2, zone: "NEUTRAL" }, dmi: { adx: 26, spread: 9 }, atr: { atr: 0.0008, volRatio: 1.05 }, bollinger: { percentB: 0.55 }, pullback: { active: true, depth: "NORMAL" }, micro: { direction: "UP" }, impulse: {}, breakoutRetest: {} };

describe("V3 capabilities — matriz medida", () => {
  it("json_object suportado; json_schema NAO; reasoning none; opcoes dos agentes refletem a matriz", () => {
    expect(CAPABILITIES.jsonObject).toBe(true);
    expect(CAPABILITIES.jsonSchema).toBe(false);
    expect(CAPABILITIES.reasoningEffortNone).toBe(true);
    const options = agentRequestOptions({ maxTokens: 512 });
    expect(options.responseFormat).toEqual({ type: "json_object" });
    expect(options.reasoningEffort).toBe("none");
    expect(options.temperature).toBe(0);
    expect(options.maxTokens).toBe(512);
  });

  it("client real propaga response_format/reasoning/temperature e sessoes estaveis por opportunity+role", async () => {
    const seen: any[] = [];
    const runner = async (options: any) => {
      seen.push(options);
      return { status: "OK", reason: null, model: "deepseek-v4.1-flash", text: JSON.stringify(specialistOutput("RSI")), parsed: specialistOutput("RSI"), latencyMs: 1200, usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }, finishReason: "stop", httpStatus: 200 };
    };
    const client = createLlmAgentClient({ runner, maxTokens: 512 });
    const call = await client.call({ role: "RSI", prompt: "delta", requestId: "r1", opportunityId: "EURUSD:OTC@x" });
    expect(call.status).toBe("OK");
    expect(seen[0].responseFormat).toEqual({ type: "json_object" });
    expect(seen[0].reasoningEffort).toBe("none");
    expect(seen[0].temperature).toBe(0);
    expect(seen[0].maxTokens).toBe(512);
    const sessionA = seen[0].sessionContext.sessionKey;
    await client.call({ role: "RSI", prompt: "delta2", requestId: "r2", opportunityId: "EURUSD:OTC@x" });
    expect(seen[1].sessionContext.sessionKey).toBe(sessionA);
    await client.call({ role: "DMI_ADX", prompt: "delta3", requestId: "r3", opportunityId: "EURUSD:OTC@x" });
    expect(seen[2].sessionContext.sessionKey).not.toBe(sessionA);
  });
});

describe("V3 schemas — compactos + semantica", () => {
  it("especialista compacto valido; campos desconhecidos de playbook/source rejeitados", () => {
    expect(validateAgentOutput("RSI", specialistOutput("RSI")).ok).toBe(true);
    expect(validateAgentOutput("RSI", specialistOutput("RSI", { playbooks: ["NAO_EXISTE"] })).error).toBe("unknown_playbook");
    expect(validateAgentOutput("RSI", specialistOutput("RSI", { sources: ["FONTE_FALSA"] })).error).toBe("unknown_source");
    expect(validateAgentOutput("RSI", { ...specialistOutput("RSI"), facts: [] }).error).toBe("facts");
    expect(validateAgentOutput("RSI", specialistOutput("RSI", { facts: [{ code: "X", direction: "SIDEWAYS", strength: "WEAK" }] })).error).toBe("facts");
  });

  it("consensus bilateral exige os quatro casos e familias", () => {
    expect(validateAgentOutput("CONSENSUS_BILATERAL", bilateralOutput()).ok).toBe(true);
    expect(validateAgentOutput("CONSENSUS_BILATERAL", bilateralOutput({ bestCaseAgainstUp: undefined })).ok).toBe(true); // vazio permitido
    expect(validateAgentOutput("CONSENSUS_BILATERAL", bilateralOutput({ evidenceFamilies: [] })).error).toBe("evidenceFamilies");
  });

  it("ancoragem numerica: numeros inventados rejeitados; numeros do input aceitos", () => {
    const inputNumbers = collectInputNumbers(measurements);
    expect(numericGroundingError({ detail: "RSI 45 com slope 1.2" }, inputNumbers)).toBeNull();
    const invented = numericGroundingError({ detail: "RSI 87.5" }, inputNumbers);
    expect(invented?.error).toBe("invented_number");
    expect(validateAgentOutput("RSI", specialistOutput("RSI", { facts: [{ code: "RSI_SLOPE", direction: "UP", strength: "STRONG", detail: "ADX 87.5" }] }), { inputNumbers }).error).toBe("invented_number");
  });
});

describe("V3 client — fail-closed estruturado", () => {
  const runnerFor = (result: any) => async () => result;
  it("TRUNCATED (finish_reason=length) => AGENT_UNAVAILABLE", async () => {
    const client = createLlmAgentClient({ runner: runnerFor({ status: "OK", text: '{"assessment":"cort', parsed: null, latencyMs: 900, finishReason: "length", httpStatus: 200, usage: {} }) });
    const call = await client.call({ role: "RSI", prompt: "x", requestId: "r" });
    expect(call.status).toBe("ERROR");
    expect(call.reason).toBe("TRUNCATED");
  });
  it("INVALID_JSON sem resgate como sucesso", async () => {
    const client = createLlmAgentClient({ runner: runnerFor({ status: "OK", text: "isso nao e json {quebrado", parsed: null, latencyMs: 800, finishReason: "stop", httpStatus: 200 }) });
    const call = await client.call({ role: "RSI", prompt: "x", requestId: "r" });
    expect(call.status).toBe("ERROR");
    expect(call.reason).toBe("INVALID_JSON");
    expect(call.rawExcerpt).toBeTruthy();
    expect(rescueJsonExcerpt("```json\n{\"a\":1}\n```")).toContain("a");
  });
  it("HTTP 429/5xx => PROVIDER_ERROR com httpStatus", async () => {
    for (const status of [429, 500, 503]) {
      const client = createLlmAgentClient({ runner: runnerFor({ status: "ERROR", reason: `HTTP_${status}`, text: null, parsed: null, latencyMs: 300, httpStatus: status, finishReason: null, usage: null }) });
      const call = await client.call({ role: "ATR", prompt: "x", requestId: "r" });
      expect(call.reason).toBe(`HTTP_${status}`);
      expect(call.httpStatus).toBe(status);
    }
  });
  it("orcamento esgotado nao chama o provider (budgetMs<=500) e budgetMs null NAO bloqueia (regressao Number(null)=0)", async () => {
    let called = 0;
    const client = createLlmAgentClient({ runner: async () => { called += 1; return { status: "OK", text: JSON.stringify(specialistOutput("RSI")), parsed: specialistOutput("RSI"), latencyMs: 1, finishReason: "stop", httpStatus: 200, usage: {} } } });
    const expired = await client.call({ role: "RSI", prompt: "x", requestId: "r", budgetMs: 300 });
    expect(expired.reason).toBe("ANALYSIS_DEADLINE");
    expect(called).toBe(0);
    const noBudget = await client.call({ role: "RSI", prompt: "x", requestId: "r2", budgetMs: null });
    expect(noBudget.status).toBe("OK");
    expect(called).toBe(1);
  });
});

describe("V3 team v2 — duas ondas, bilateral e Final Gate", () => {
  it("FULL ciclo aprovado: Wave A + Wave B paralela + gate deterministico (7 chamadas, sem 3a onda)", async () => {
    const client = createScriptedAgentClient(approveScript());
    const result = await runAgentCycle({ client, measurements, cycleNumber: 4, opportunityId: "EURUSD:OTC@x" });
    expect(result.available).toBe(true);
    expect(result.architecture).toBe("TWO_WAVE");
    expect(result.result).toBe("APPROVE_BUY");
    expect(result.agentCalls.map((call: any) => call.role)).toEqual(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET", "CONSENSUS_BILATERAL"]);
    expect(result.finalGate.result).toBe("APPROVE_BUY");
    expect(result.finalGate.counterCase).toEqual(["CHoCH bearish invalidaria"]);
    expect(result.latency.waveA).toBeGreaterThanOrEqual(0);
    expect(result.latency.waveB).toBeGreaterThanOrEqual(0);
    expect(result.latency.total).toBeGreaterThanOrEqual(0);
  });

  it("Consensus independente NAO recebe a tese do Asset (independencia preservada)", async () => {
    const base = approveScript();
    const seen: Array<{ role: string; prompt: string }> = [];
    const inner = createScriptedAgentClient(base);
    const client = { available: true, async call(input: any) { seen.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
    await runAgentCycle({ client, measurements, cycleNumber: 1, opportunityId: "X" });
    const consensusPrompt = seen.find((entry) => entry.role === "CONSENSUS_BILATERAL")!.prompt;
    expect(consensusPrompt).not.toContain("assetThesis");
    expect(consensusPrompt).not.toContain("BUY_CANDIDATE");
    expect(consensusPrompt).not.toContain("scenario\":\"TREND_CONTINUATION\",\"direction");
    const { systemPromptFor } = await import("../../relay/v3/agents/prompts.mjs" as any);
    expect(systemPromptFor("CONSENSUS_BILATERAL")).toContain("bestCaseAgainstUp");
    expect(systemPromptFor("CONSENSUS_BILATERAL")).toContain("bestCaseAgainstDown");
  });

  it("Wave A parcial (1 timeout) => AGENT_UNAVAILABLE (nunca usa 4 de 5)", async () => {
    const script = { ...approveScript(), BOLLINGER: { status: "ERROR", reason: "TIMEOUT" } };
    const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements, cycleNumber: 1, opportunityId: "X" });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("AGENT_UNAVAILABLE");
    expect(result.result).toBe("CANCEL");
  });

  it("Asset timeout / Consensus timeout => AGENT_UNAVAILABLE", async () => {
    for (const role of ["ASSET", "CONSENSUS_BILATERAL"]) {
      const script = { ...approveScript(), [role]: { status: "ERROR", reason: "TIMEOUT" } };
      const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements, cycleNumber: 1, opportunityId: "X" });
      expect(result.available, role).toBe(false);
      expect(result.reason, role).toBe("AGENT_UNAVAILABLE");
    }
  });

  it("orcamento estourado no meio da onda => ANALYSIS_DEADLINE e nenhum approval", async () => {
    const roles = approveScript();
    const slow: Record<string, any> = {};
    for (const [role, output] of Object.entries(roles)) slow[role] = { output, sleepMs: 30, latencyMs: 30 };
    const result = await runAgentCycle({ client: createScriptedAgentClient(slow), measurements, cycleNumber: 1, opportunityId: "X", budgetMs: 10 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("ANALYSIS_DEADLINE");
    expect(result.result).toBe("CANCEL");
  });

  it("3-wave continua disponivel para benchmark e produz o mesmo APPROVE no script", async () => {
    const script = { ...approveScript(), CONSENSUS_FINAL: { agreement: "AGREE", result: "APPROVE_BUY", bestCounterCase: "CHoCH", reasons: [] } };
    const result = await runAgentCycle({ client: createScriptedAgentClient(script), measurements, cycleNumber: 1, opportunityId: "X", architecture: "THREE_WAVE" });
    expect(result.available).toBe(true);
    expect(result.result).toBe("APPROVE_BUY");
    expect(result.agentCalls).toHaveLength(8);
  });
});

describe("V3 Final Gate — deterministico, sem votacao", () => {
  const baseAsset = { scenario: "TREND_CONTINUATION", direction: "UP", state: "BUY_CANDIDATE", blockers: [], invalidations: [], bestCounterCase: "x" };
  it("aprova quando agreement/scenario/familias/invalidations ok", () => {
    const gate = finalGate({ asset: baseAsset, consensus: bilateralOutput(), timing: { tteMs: 310_000 } });
    expect(gate.result).toBe("APPROVE_BUY");
    expect(gate.steps.every((step: any) => step.ok)).toBe(true);
  });
  it("DISAGREE => CANCEL; blocker => CANCEL; invalidation direcional contra => CANCEL", () => {
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput({ direction: "DOWN" }), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput({ blockers: ["SQUEEZE"] }), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput({ invalidations: ["BEARISH_CHOCH"] }), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
  });
  it("invalidation a FAVOR da direcao nao bloqueia (BEARISH invalidation numa tese DOWN)", () => {
    const assetDown = { ...baseAsset, direction: "DOWN", state: "SELL_CANDIDATE" };
    const consensusDown = bilateralOutput({ direction: "DOWN", invalidations: ["BEARISH_CHOCH"] });
    expect(finalGate({ asset: assetDown, consensus: consensusDown, timing: { tteMs: 310_000 } }).result).toBe("APPROVE_SELL");
  });
  it("timing fora da janela de analysis => CANCEL", () => {
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput(), timing: { tteMs: 299_000 } }).result).toBe("CANCEL");
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput(), timing: { tteMs: 331_000 } }).result).toBe("CANCEL");
  });
  it("ambiguidades do mercado => CANCEL", () => {
    expect(finalGate({ asset: baseAsset, consensus: bilateralOutput({ marketAmbiguities: ["range indefinido"] }), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
  });
});
