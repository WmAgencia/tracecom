/**
 * V3 — AGENTES v3: arquitetura hibrida final (Wave 1 = 5 specialists + Asset em paralelo; Wave 2 = Consensus Final
 * decisor de mercado; Execution/Safety Gate deterministico SEM analise tecnica).
 *
 * Prova: independencia (ninguem ve ninguem na Wave 1), 6 chamadas concorrentes, Wave 2 so apos 6/6,
 * exatamente 7 chamadas, fail-closed, fact packets FULL/DELTA com fingerprint, grounding, scenario library.
 */
import { describe, expect, it } from "vitest";
import { approveScript, assetOutput, cancelScript, consensusFinalOutput, specialistOutput } from "./agent-script";
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
// @ts-expect-error - relay ESM sem tipagem
const packetsModule = await import("../../relay/v3/agents/fact-packets.mjs");
const { validateAgentOutput, numericGroundingError, collectInputNumbers, normalizeAgentOutput } = schemas as any;
const { CAPABILITIES, agentRequestOptions } = capabilities as any;
const { createScriptedAgentClient, createLlmAgentClient, rescueJsonExcerpt } = clientModule as any;
const { runAgentCycle, SPECIALIST_ROLES, WAVE1_ROLES, CONSENSUS_ROLE } = teamModule as any;
const { executionGate } = gateModule as any;
const { buildPacketEnvelope, diffPacket, buildAssetSnapshot } = packetsModule as any;

const measurements = { closedCandle: { at: 1, open: 1, high: 1, low: 1, close: 1 }, structure: { trend: "UPTREND", lastBOS: { type: "BULLISH_BOS" }, lastCHoCH: null, lastHigh: { price: 1.1 }, lastLow: { price: 1.0 }, swingLegs: [], zones: [], pivotCount: { highs: 3, lows: 3 } }, rsi: { value: 45, slope: 1.2, zone: "NEUTRAL", momentum: "RECOVERING", crossback: null, persistence: 3, failureSwing: null, divergence: [] }, dmi: { adx: 26, spread: 9, adxSlope: 1, plusDi: 30, minusDi: 21, dominance: "PLUS", trendState: "STRENGTHENING", takeover: null, measurements: { previousSpread: 5 } }, atr: { atr: 0.0008, volRatio: 1.05, regime: "VOLATILITY_COMPATIBLE", normalizedRange: 1.0, normalizedImpulse: 0.8, normalizedPullback: 0.5, wickNormalization: 0.4 }, bollinger: { percentB: 0.55, bandwidth: 0.001, midlineSlope: 0.0001, bandWalk: "MID", reentry: false, rejection: false, squeeze: "NORMAL", expansion: "EXPANDING" }, pullback: { active: true, depth: "NORMAL", direction: "UP_TREND_PULLBACK", distanceAtr: 0.8, referenceExtreme: 1.1, structureTrend: "UPTREND" }, micro: { direction: "UP", bodyRatio: 0.5, upperWickRatio: 0.2, lowerWickRatio: 0.3, closeInRange: 0.7, streak: 1, character: "MIXED" }, impulse: { direction: "UP", normalized: 0.8, netMove: 0.001, candles: 10, consecutiveDirection: 7, decelerating: false, classification: "BALANCED" }, breakoutRetest: { breakout: false, breakdown: false, retest: false, failed: null, resistance: 1.1, support: 1.0 }, zoneDistance: [{ type: "SUPPORT", kind: "SWING_LOW", price: 1.0, distance: 0.05, distanceAtr: 1.2, side: "ABOVE" }] };

const gateCalls = (count = 7) => Array.from({ length: count }, (_, index) => ({ role: index === count - 1 ? CONSENSUS_ROLE : WAVE1_ROLES[index], status: "OK", opportunityId: "EURUSD:OTC@x", schemaValid: true, semanticValid: true }));

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
      return { status: "OK", reason: null, model: "deepseek-v4.1-flash", text: JSON.stringify(specialistOutput("RSI")), parsed: specialistOutput("RSI"), latencyMs: 1200, usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } }, finishReason: "stop", httpStatus: 200 };
    };
    const client = createLlmAgentClient({ runner, maxTokens: 512 });
    const call = await client.call({ role: "RSI", prompt: "delta", requestId: "r1", opportunityId: "EURUSD:OTC@x" });
    expect(call.status).toBe("OK");
    expect(seen[0].responseFormat).toEqual({ type: "json_object" });
    expect(seen[0].reasoningEffort).toBe("none");
    expect(seen[0].temperature).toBe(0);
    expect(call.provider).toBe("openCodeGo");
    expect(call.sessionHash).toMatch(/^[0-9a-f]{12}$/);
    expect(call.payloadChars).toBe("delta".length);
    expect(call.promptTokens).toBe(300);
    expect(call.cachedTokens).toBe(0);
    expect(call.reasoningTokens).toBe(0);
    expect(call.startedAt).toBeTruthy();
    expect(call.finishedAt).toBeTruthy();
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

  it("Asset exige thesis e scenario da Scenario Library; state x direction coerentes", () => {
    expect(validateAgentOutput("ASSET", assetOutput()).ok).toBe(true);
    expect(validateAgentOutput("ASSET", assetOutput({ thesis: undefined })).error).toBe("thesis");
    expect(validateAgentOutput("ASSET", assetOutput({ scenario: "CENARIO_INVENTADO" })).error).toBe("scenario");
    expect(validateAgentOutput("ASSET", assetOutput({ direction: "UP", state: "SELL_CANDIDATE" })).error).toBe("state_direction_conflict");
  });

  it("Consensus Final: contrato completo, red-team bilateral, result x direction obrigatorios", () => {
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput()).ok).toBe(true);
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ independentAssessment: undefined })).error).toBe("independentAssessment");
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ assetComparison: undefined })).error).toBe("assetComparison");
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ result: "APPROVE_SELL" })).error).toBe("result_direction_conflict");
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ result: "HOLD" })).error).toBe("result");
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ scenario: "NAO_EXISTE" })).error).toBe("scenario");
  });

  it("normalizacao determinista: campo de lista emitido como string vira [string] sem perda", () => {
    const normalized = normalizeAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ reasons: "motivo unico", marketAmbiguities: null }));
    expect(normalized.reasons).toEqual(["motivo unico"]);
    expect(normalized.marketAmbiguities).toEqual([]);
    expect(validateAgentOutput("CONSENSUS_FINAL", normalized).ok).toBe(true);
    expect(validateAgentOutput("CONSENSUS_FINAL", consensusFinalOutput({ reasons: "x".repeat(400) })).ok).toBe(false);
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

describe("V3 fact packets — code turns data into facts (FULL/DELTA/fingerprint)", () => {
  it("1o ciclo FULL; ciclo seguinte DELTA com mudanca; fingerprint deterministico", () => {
    const full = buildPacketEnvelope({ role: "RSI", measurements, cycleNumber: 1 });
    expect(full.mode).toBe("FULL");
    expect(full.fingerprint).toBe(buildPacketEnvelope({ role: "RSI", measurements, cycleNumber: 1 }).fingerprint);
    const later = { ...measurements, rsi: { ...measurements.rsi, slope: 2.5 } };
    const delta = buildPacketEnvelope({ role: "RSI", measurements: later, cycleNumber: 2, previousPacket: full.packet, previousAssessment: specialistOutput("RSI") });
    expect(delta.mode).toBe("DELTA");
    expect(delta.previousFingerprint).toBe(full.fingerprint);
    expect(delta.fingerprint).not.toBe(full.fingerprint);
    const paths = delta.delta.changed.map((item: any) => item.path);
    expect(paths).toContain("rsi.slope");
    expect(delta.payload.facts).toBeUndefined();
    expect(delta.payload.previousAssessment.assessment).toContain("RSI");
  });

  it("pacotes sao compactos (sem series longas) e ASSET ve todos os dominios", () => {
    for (const role of WAVE1_ROLES) {
      const envelope = buildPacketEnvelope({ role, measurements, cycleNumber: 1 });
      const json = envelope.json;
      expect(json).not.toContain("series");
      expect(json.length).toBeLessThan(2_600);
    }
    const asset = buildAssetSnapshot(measurements);
    for (const key of ["rsi", "dmi", "bollinger", "atr", "structure", "pullback", "micro", "impulse", "breakoutRetest"]) expect(asset[key]).toBeTruthy();
    expect(asset.timing).toBeNull();
  });

  it("diff detecta eventos novos/removidos (bools) e removeu", () => {
    const before = { closedCandle: { close: 1 }, breakoutRetest: { breakout: false, old: 1 } };
    const after = { closedCandle: { close: 2 }, breakoutRetest: { breakout: true } };
    const diff = diffPacket(before, after, { role: "PRICE_ACTION" });
    expect(diff.eventsNew).toContain("breakoutRetest.breakout");
    expect(diff.changed.map((item: any) => item.path)).toContain("closedCandle.close");
    expect(diff.removed.map((item: any) => item.path)).toContain("breakoutRetest.old");
  });
});

describe("V3 team — Wave 1 (6 paralelos) + Wave 2 (Consensus Final decisor)", () => {
  it("ciclo valido: 6+1 chamadas, Asset+specialists em paralelo e Consensus decidindo", async () => {
    const client = createScriptedAgentClient(approveScript());
    const result = await runAgentCycle({ client, measurements, cycleNumber: 4, opportunityId: "EURUSD:OTC@x" });
    expect(result.available).toBe(true);
    expect(result.architecture).toBe("HYBRID_2_WAVE");
    expect(result.result).toBe("APPROVE_BUY");
    expect(result.agentCalls.map((call: any) => call.role)).toEqual(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET", "CONSENSUS_FINAL"]);
    expect(result.agentCalls).toHaveLength(7);
    expect(result.finalGate.result).toBe("APPROVE_BUY");
    expect(result.finalGate.consensusResult).toBe("APPROVE_BUY");
    for (const role of WAVE1_ROLES) expect(result.factPackets[role].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(result.latency.wave1).toBeGreaterThanOrEqual(0);
    expect(result.latency.wave2).toBeGreaterThanOrEqual(0);
  });

  it("Wave 1 tem 6 chamadas CONCORRENTES e a Wave 2 so inicia depois de 6/6", async () => {
    const script: Record<string, any> = {};
    const base = approveScript();
    for (const role of WAVE1_ROLES) script[role] = { output: base[role], sleepMs: 5, latencyMs: 5 };
    script[CONSENSUS_ROLE] = { output: base[CONSENSUS_ROLE], sleepMs: 1, latencyMs: 1 };
    const inner = createScriptedAgentClient(script);
    let active = 0; let maxActive = 0; let wave1Resolved = 0; let consensusStartedWith = -1; const starts: Array<{ role: string; wave1Resolved: number }> = [];
    const client = {
      available: true,
      async call(input: any) {
        if (input.role === CONSENSUS_ROLE) { consensusStartedWith = wave1Resolved; starts.push({ role: input.role, wave1Resolved }); return inner.call(input); }
        active += 1; maxActive = Math.max(maxActive, active);
        try { return await inner.call(input); } finally { active -= 1; wave1Resolved += 1; }
      },
    };
    const result = await runAgentCycle({ client, measurements, cycleNumber: 1, opportunityId: "X" });
    expect(result.available).toBe(true);
    expect(maxActive).toBe(6);
    expect(consensusStartedWith).toBe(6);
  });

  it("INDEPENDENCIA: Asset nao recebe specialists; specialists nao recebem Asset; Consensus ve tudo com Asset por ultimo", async () => {
    const seen: Array<{ role: string; prompt: string }> = [];
    const inner = createScriptedAgentClient(approveScript());
    const client = { available: true, async call(input: any) { seen.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
    await runAgentCycle({ client, measurements, cycleNumber: 1, opportunityId: "X" });
    const promptByRole = Object.fromEntries(seen.map((entry) => [entry.role, entry.prompt]));
    // Asset: apenas o snapshot deterministico do seu papel.
    expect(promptByRole.ASSET).toContain("\"facts\"");
    expect(promptByRole.ASSET).not.toContain("specialistEvidence");
    expect(promptByRole.ASSET).not.toContain("RSI estado do dominio");
    expect(promptByRole.ASSET).not.toContain("ASSET_THESIS_TO_CHALLENGE");
    // Specialists: apenas o proprio packet; nunca Asset/outros specialists.
    for (const role of SPECIALIST_ROLES) {
      expect(promptByRole[role]).toContain("\"facts\"");
      expect(promptByRole[role]).not.toContain("ASSET_THESIS_TO_CHALLENGE");
      expect(promptByRole[role]).not.toContain("bestCounterCase");
      expect(promptByRole[role]).not.toContain("specialistEvidence");
    }
    expect(promptByRole.RSI).not.toContain("DMI_ADX estado do dominio");
    expect(promptByRole.DMI_ADX).not.toContain("RSI estado do dominio");
    // Consensus: deterministic facts + 5 specialists + Asset no bloco final.
    expect(promptByRole[CONSENSUS_ROLE]).toContain("deterministicFacts");
    expect(promptByRole[CONSENSUS_ROLE]).toContain("specialistEvidence");
    for (const role of SPECIALIST_ROLES) expect(promptByRole[CONSENSUS_ROLE]).toContain(`${role} estado do dominio`);
    expect(promptByRole[CONSENSUS_ROLE]).toContain("ASSET_THESIS_TO_CHALLENGE");
    expect(promptByRole[CONSENSUS_ROLE]).toContain("estrutura de alta intacta");
    const consensusPrompt = promptByRole[CONSENSUS_ROLE] ?? "";
    const idxSpecialists = consensusPrompt.indexOf("specialistEvidence");
    const idxAsset = consensusPrompt.indexOf("ASSET_THESIS_TO_CHALLENGE");
    expect(idxSpecialists).toBeGreaterThan(-1);
    expect(idxAsset).toBeGreaterThan(idxSpecialists);
    const { systemPromptFor } = await import("../../relay/v3/agents/prompts.mjs" as any);
    expect(systemPromptFor(CONSENSUS_ROLE)).toContain("independentAssessment");
    expect(systemPromptFor(CONSENSUS_ROLE)).toContain("ASSET_THESIS_TO_CHALLENGE");
  });

  it("Wave 2 NAO roda se qualquer Wave 1 falhar; falha no Consensus => AGENT_UNAVAILABLE", async () => {
    const called: string[] = [];
    const failAsset = { ...approveScript(), ASSET: { status: "ERROR", reason: "TIMEOUT" } };
    const innerFail = createScriptedAgentClient(failAsset);
    const clientFail = { available: true, async call(input: any) { called.push(input.role); return innerFail.call(input); } };
    const failed = await runAgentCycle({ client: clientFail, measurements, cycleNumber: 1, opportunityId: "X" });
    expect(failed.available).toBe(false);
    expect(failed.reason).toBe("AGENT_UNAVAILABLE");
    expect(failed.result).toBe("CANCEL");
    expect(called).not.toContain(CONSENSUS_ROLE);
    const consensusFail = { ...approveScript(), CONSENSUS_FINAL: { status: "ERROR", reason: "HTTP_500" } };
    const failed2 = await runAgentCycle({ client: createScriptedAgentClient(consensusFail), measurements, cycleNumber: 1, opportunityId: "X" });
    expect(failed2.available).toBe(false);
    expect(failed2.reason).toBe("AGENT_UNAVAILABLE");
  });

  it("segundo ciclo de uma opportunity usa DELTA nos fact packets", async () => {
    const seen: Array<{ role: string; prompt: string }> = [];
    const inner = createScriptedAgentClient(approveScript());
    const client = { available: true, async call(input: any) { seen.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
    const first = await runAgentCycle({ client, measurements, cycleNumber: 1, opportunityId: "X" });
    const later = { ...measurements, rsi: { ...measurements.rsi, slope: 2.5 } };
    const second = await runAgentCycle({ client, measurements: later, cycleNumber: 2, opportunityId: "X", previousPackets: first.nextState.packets, previousOutputs: first.nextState.outputs });
    expect(second.available).toBe(true);
    const rsiCalls = seen.filter((entry) => entry.role === "RSI");
    expect(rsiCalls[0]!.prompt).toContain("\"mode\":\"FULL\"");
    expect(rsiCalls[1]!.prompt).toContain("\"mode\":\"DELTA\"");
    expect(rsiCalls[1]!.prompt).toContain("previousAssessment");
    expect(second.factPackets.RSI.mode).toBe("DELTA");
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

  it("cancelamento explicito do Consensus (sem evidencia) => CANCEL sem APPROVE", async () => {
    const result = await runAgentCycle({ client: createScriptedAgentClient(cancelScript()), measurements, cycleNumber: 1, opportunityId: "X" });
    expect(result.available).toBe(true);
    expect(result.result).toBe("CANCEL");
    expect(result.finalGate.result).toBe("CANCEL");
  });
});

describe("V3 Execution/Safety Gate — NAO faz analise tecnica", () => {
  const consensus = consensusFinalOutput();
  it("aprova quando contratos operacionais passam (mesmo com agreement PARTIAL)", () => {
    const gate = executionGate({ consensus: consensusFinalOutput({ agreement: "PARTIAL" }), calls: gateCalls(), timing: { tteMs: 310_000 }, opportunityId: "EURUSD:OTC@x", deadlineMs: 20_000, latencyTotalMs: 9_000 });
    expect(gate.pass).toBe(true);
    expect(gate.result).toBe("APPROVE_BUY");
  });
  it("direcao vem SOMENTE do Consensus: CANCEL do Consensus nunca vira APPROVE (Asset nao decide)", () => {
    const gate = executionGate({ consensus: consensusFinalOutput({ result: "CANCEL", direction: "NONE" }), calls: gateCalls(), timing: { tteMs: 310_000 }, opportunityId: "EURUSD:OTC@x" });
    expect(gate.result).toBe("CANCEL");
    const gate2 = executionGate({ consensus: consensusFinalOutput({ result: "APPROVE_SELL", direction: "DOWN" }), calls: gateCalls(), timing: { tteMs: 310_000 }, opportunityId: "EURUSD:OTC@x" });
    expect(gate2.result).toBe("APPROVE_SELL");
  });
  it("blockers/invalidations/ambiguidades declarados pela propria decisao => CANCEL (fail-closed)", () => {
    expect(executionGate({ consensus: consensusFinalOutput({ blockers: ["SQZ"] }), calls: gateCalls(), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus: consensusFinalOutput({ invalidations: ["BEARISH_CHOCH"] }), calls: gateCalls(), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus: consensusFinalOutput({ marketAmbiguities: ["range"] }), calls: gateCalls(), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
  });
  it("contrato de chamadas/timing/deadline falhando => CANCEL", () => {
    expect(executionGate({ consensus, calls: gateCalls(6), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus, calls: gateCalls().map((call: any, index: number) => (index === 2 ? { ...call, status: "ERROR" } : call)), timing: { tteMs: 310_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus, calls: gateCalls(), timing: { tteMs: 299_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus, calls: gateCalls(), timing: { tteMs: 331_000 } }).result).toBe("CANCEL");
    expect(executionGate({ consensus, calls: gateCalls(), timing: { tteMs: 310_000 }, deadlineMs: 5_000, latencyTotalMs: 6_000 }).result).toBe("CANCEL");
  });
});
