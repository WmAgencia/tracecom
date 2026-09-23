/**
 * V3 SINGLE-CYCLE (operacional): 1 opportunity = 1 analise completa (6 Wave1 + Consensus).
 * Grounding: prosa sanitizada (warning) x estrutura fail-closed; persistencia com barrier FK; sem C2.
 */
import { describe, expect, it } from "vitest";
import { ALIGNED_BASE, approvalSeries, candlesFromCloses } from "./fixtures";
import { approveScript, assetOutput, consensusFinalOutput, specialistOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const schemasModule = await import("../../relay/v3/agents/schemas.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
// @ts-expect-error - relay ESM sem tipagem
const teamModule = await import("../../relay/v3/agents/team.mjs");
const { V3Runtime } = runtimeModule as any;
const { validateAgentOutput, collectInputNumbers } = schemasModule as any;
const { createScriptedAgentClient } = clientModule as any;
const { runAgentCycle } = teamModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });
const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };
const closes = approvalSeries({ candles: 120 }).map((candle) => candle.close);

const measurements = { closedCandle: { at: 1, open: 1, high: 1, low: 1, close: 1 }, structure: { trend: "UPTREND" }, rsi: { value: 45, slope: 1.2, zone: "NEUTRAL" }, dmi: { adx: 26, spread: 9 }, atr: { atr: 0.0008, volRatio: 1.05 }, bollinger: { percentB: 0.55 }, pullback: { active: true, depth: "NORMAL" }, micro: { direction: "UP" }, impulse: {}, breakoutRetest: {} };

const makeRuntime = (script: Record<string, any>, { pool = null as any, margin = 2_000, full = 1_000, delta = 1_000, nowRef = { value: exp - 330_000 } } = {}) => {
  const scheduled: any[] = [];
  const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
  const calls: Array<{ role: string; prompt: string }> = [];
  const inner = createScriptedAgentClient(script, { now: () => nowRef.value });
  const agents = { available: true, async call(input: any) { calls.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
  const runtime = new V3Runtime({ strategy, agents, pool, now: () => nowRef.value, brokerNow: () => nowRef.value, agentSafetyMarginMs: margin, estimatedFullCycleMs: full, estimatedDeltaCycleMs: delta, scheduler });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  const step = async (tte: number) => {
    nowRef.value = exp - tte;
    const candles = candlesFromCloses(closes, { startAt: nowRef.value - closes.length * 5_000 });
    return runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: nowRef.value });
  };
  return { runtime, scheduled, calls, step, opportunity: () => runtime.opportunities()[0] };
};

describe("V3 single-cycle operacional", () => {
  it("A. numero inventado apenas em prosa opcional => warning + sanitizado, agente valido e nao chega ao Consensus", async () => {
    const script = { ...approveScript(), RSI: specialistOutput("RSI", { facts: [{ code: "RSI_SLOPE", direction: "UP", strength: "MODERATE", detail: "ADX caiu 9876.54 pontos" }] }) };
    const { runtime, calls, step } = makeRuntime(script);
    await step(325_000);
    const cycle = runtime.status().engine;
    expect(cycle).toBeTruthy();
    const consensusPrompt = calls.find((entry) => entry.role === "CONSENSUS_FINAL")?.prompt ?? "";
    expect(consensusPrompt).not.toContain("9876.54");
    expect(runtime.status().agents.calls).toBeGreaterThanOrEqual(7);
  });

  it("B. erro estrutural real (blocker com numero inventado) => fail-closed e Consensus nao executa", async () => {
    const { runtime, calls, step } = makeRuntime({ ...approveScript(), RSI: { ...approveScript().RSI, blockers: ["ADX caiu 9876.54"] } });
    await step(325_000);
    expect(calls.some((entry) => entry.role === "CONSENSUS_FINAL")).toBe(false);
    expect(runtime.status().counters.agentUnavailable).toBeGreaterThanOrEqual(1);
  });

  it("B2. validate: prosa sanitiza, estrutura falha", () => {
    const inputs = collectInputNumbers(measurements);
    const prose = validateAgentOutput("RSI", specialistOutput("RSI", { facts: [{ code: "RSI_SLOPE", direction: "UP", strength: "MODERATE", detail: "ADX caiu 9876.54" }] }), { inputNumbers: inputs });
    expect(prose.ok).toBe(true);
    expect(prose.groundingWarnings.length).toBeGreaterThanOrEqual(1);
    expect(validateAgentOutput("RSI", specialistOutput("RSI", { blockers: ["ADX 9876.54"] }), { inputNumbers: inputs }).error).toBe("invented_number");
  });

  it("C. 6 Wave1 validos => Consensus executa (7 calls) e E/F/G: result define direcao canonica", async () => {
    const { runtime, calls, step, opportunity } = makeRuntime(approveScript());
    await step(325_000);
    expect(calls.filter((entry) => entry.role === "CONSENSUS_FINAL")).toHaveLength(1);
    expect(opportunity().finalDecision?.result).toBe("APPROVE_BUY");
    expect(opportunity().finalDecision?.direction).toBe("UP");
  });

  it("E. Consensus CANCEL => final CANCEL; G2. APPROVE_SELL => DOWN", async () => {
    const cancel = makeRuntime({ ...approveScript(), CONSENSUS_FINAL: consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "DISAGREE" }) });
    await cancel.step(325_000);
    expect(cancel.opportunity().finalDecision?.result).toBe("CANCEL");
    const sell = makeRuntime({ ...approveScript(), ASSET: assetOutput({ direction: "DOWN", state: "WAIT" }), CONSENSUS_FINAL: consensusFinalOutput({ result: "APPROVE_SELL", direction: "DOWN", agreement: "PARTIAL" }) });
    await sell.step(325_000);
    expect(sell.opportunity().finalDecision?.result).toBe("APPROVE_SELL");
    expect(sell.opportunity().finalDecision?.direction).toBe("DOWN");
  });

  it("D. Wave1 5/6 => Consensus NAO executa", async () => {
    const { runtime, calls, step } = makeRuntime({ ...approveScript(), BOLLINGER: { status: "ERROR", reason: "TIMEOUT" } });
    await step(325_000);
    expect(calls.some((entry) => entry.role === "CONSENSUS_FINAL")).toBe(false);
    expect(runtime.status().counters.agentUnavailable).toBeGreaterThanOrEqual(1);
  });

  it("H. somente 1 ciclo por opportunity (segundo candle bloqueado)", async () => {
    const { runtime, step, opportunity } = makeRuntime(approveScript());
    await step(325_000);
    await step(320_000);
    expect(opportunity().cycles.length).toBe(1);
    expect(runtime.status().counters.cyclesSkippedMaxCycles).toBeGreaterThanOrEqual(1);
  });

  it("I. persistCycle aguarda a opportunity pai (barrier FK)", async () => {
    const order: string[] = [];
    const pool = { query: async (sql: string) => { if (sql.includes("INSERT INTO iq_v3_opportunities")) { order.push("opportunity:start"); await new Promise((resolve) => setTimeout(resolve, 30)); order.push("opportunity:done"); } else if (sql.includes("INSERT INTO iq_v3_cycles")) { order.push("cycle"); } return { rows: [], rowCount: 1 }; } };
    const { step } = makeRuntime(approveScript(), { pool });
    await step(325_000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(order).toContain("opportunity:done");
    expect(order).toContain("cycle");
    expect(order.indexOf("opportunity:done")).toBeLessThan(order.indexOf("cycle"));
  });

  it("J. discovery event-driven: C1 imediato com TTE ~330 (sem esperar novo candle)", async () => {
    const { runtime, step } = makeRuntime(approveScript());
    const cycle = await step(329_500);
    expect(cycle?.cycle).toBe(1);
    expect(cycle?.tteMs).toBeGreaterThanOrEqual(329_000);
    expect(runtime.status().counters.agentCycles).toBe(1);
  });
});
