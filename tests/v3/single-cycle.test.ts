process.env.V3_PREFILTER_MIN_ALIGN = "1";
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

const makeRuntime = (script: Record<string, any>, { pool = null as any, margin = 2_000, full = 1_000, delta = 1_000, agentsGate = null as any, nowRef = { value: exp - 330_000 } } = {}) => {
  const scheduled: any[] = [];
  const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
  const calls: Array<{ role: string; prompt: string }> = [];
  const inner = createScriptedAgentClient(script, { now: () => nowRef.value });
  const agents = { available: true, async call(input: any) { calls.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
  const runtime = new V3Runtime({ strategy, agents, pool, agentsGate, now: () => nowRef.value, brokerNow: () => nowRef.value, agentSafetyMarginMs: margin, estimatedFullCycleMs: full, estimatedDeltaCycleMs: delta, scheduler });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  const step = async (tte: number) => {
    nowRef.value = exp - tte;
    const candles = candlesFromCloses(closes, { startAt: nowRef.value - closes.length * 5_000 });
    return runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: nowRef.value });
  };
  return { runtime, scheduled, calls, step, opportunity: () => runtime.opportunities()[0] };
};

describe("V3 single-cycle operacional", () => {
  it("A. Wave1 deterministica nao invoca LLM; Consensus executa 1x quando prefilter passa", async () => {
    const { runtime, calls, step } = makeRuntime(approveScript());
    await step(325_000);
    const cycle = runtime.status().engine;
    expect(cycle).toBeTruthy();
    expect(calls.length).toBe(1);
    expect(calls[0]!.role).toBe("CONSENSUS_FINAL");
    const cycleCalls = runtime.opportunities()[0].cycles[0].agents.calls ?? [];
    expect(cycleCalls.filter((call: any) => call.provider === "code")).toHaveLength(6);
    expect(runtime.status().agents.calls).toBe(7);
  });

  it("D. Consensus indisponivel (provider) => CANCEL fail-closed (available)", async () => {
    const { runtime, step, opportunity } = makeRuntime({ ...approveScript(), CONSENSUS_FINAL: { status: "ERROR", reason: "HTTP_402", role: "CONSENSUS_FINAL", model: null, provider: "groq", latencyMs: 5, output: null } });
    await step(325_000);
    const cycle = runtime.opportunities()[0].cycles[0];
    expect(cycle.agents.available).toBe(true);
    expect(cycle.consensusResult).toBe("CANCEL");
    expect(opportunity().finalDecision?.result ?? "CANCEL").toBe("CANCEL");
  });

  it("C. 6 Wave1 deterministicos validos => Consensus executa (1 LLM) e E/F/G: result define direcao canonica", async () => {
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
    const sell = makeRuntime({ ...approveScript(), CONSENSUS_FINAL: consensusFinalOutput({ result: "APPROVE_SELL", direction: "DOWN", agreement: "PARTIAL" }) });
    await sell.step(325_000);
    expect(sell.opportunity().finalDecision?.result).toBe("APPROVE_SELL");
    expect(sell.opportunity().finalDecision?.direction).toBe("DOWN");
  });

  it("H. somente 1 ciclo por opportunity (segundo candle bloqueado)", async () => {
    const { runtime, step, opportunity } = makeRuntime(approveScript());
    await step(325_000);
    await step(320_000);
    expect(opportunity().cycles.length).toBe(1);
    expect(runtime.status().counters.cyclesSkippedMaxCycles).toBeGreaterThanOrEqual(1);
  });

  it("H2. TEST SCOPE: allowlist so limita LLM; universo intacto e reversivel", async () => {
    const { runtime, calls, step, opportunity } = makeRuntime(approveScript());
    runtime.setOpportunityScope(["OTHER:OTC"]);
    const skipped = await step(325_000);
    expect(skipped).toBeNull();
    expect(calls.length).toBe(0);
    expect(runtime.status().counters.cyclesSkippedScope).toBe(1);
    expect(opportunity().cycles.length).toBe(0);
    runtime.setOpportunityScope(null);
    const cycle = await step(320_000);
    expect(cycle?.cycle).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("H4. ECONOMIA: sistema desarmado => LLM NAO pensa (zero calls, SYSTEM_INACTIVE); armado => pensa", async () => {
    const inactive = makeRuntime(approveScript(), { agentsGate: () => false });
    await inactive.step(325_000);
    expect(inactive.calls.length).toBe(0);
    expect(inactive.runtime.status().counters.cyclesSkippedInactive).toBe(1);
    expect(inactive.runtime.status().counters.agentCycles).toBe(0);
    expect(inactive.opportunity().cycles[0].agents.reason).toBe("SYSTEM_INACTIVE");
    expect(inactive.runtime.status().counters.agentUnavailableReasons.SYSTEM_INACTIVE).toBeGreaterThanOrEqual(1);
    const active = makeRuntime(approveScript(), { agentsGate: () => true });
    await active.step(325_000);
    expect(active.calls.length).toBeGreaterThanOrEqual(1);
    expect(active.runtime.status().counters.agentCycles).toBeGreaterThanOrEqual(1);
  });

  it("H3. agents indisponivel registra motivo exato (V3_AGENTS_DISABLED)", async () => {
    const scheduled: any[] = [];
    const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
    const nowRef = { value: exp - 330_000 };
    const runtime = new V3Runtime({ strategy, agents: null, now: () => nowRef.value, brokerNow: () => nowRef.value, agentSafetyMarginMs: 2_000, estimatedFullCycleMs: 1_000, estimatedDeltaCycleMs: 1_000, scheduler });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    nowRef.value = exp - 325_000;
    const candles = candlesFromCloses(closes, { startAt: nowRef.value - closes.length * 5_000 });
    await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: nowRef.value });
    const cycle = runtime.opportunities()[0].cycles[0];
    expect(cycle.agents.available).toBe(false);
    expect(cycle.agents.reason).toBe("V3_AGENTS_DISABLED");
    expect(runtime.status().counters.agentUnavailableReasons.V3_AGENTS_DISABLED).toBeGreaterThanOrEqual(1);
  });

  it("I. persistCycle aguarda a opportunity pai (barrier FK) e re-tenta quando o pool dropa", async () => {
    const order: string[] = [];
    let cycleAttempts = 0;
    const pool = { query: async (sql: string) => { if (sql.includes("INSERT INTO iq_v3_opportunities")) { order.push("opportunity:start"); await new Promise((resolve) => setTimeout(resolve, 30)); order.push("opportunity:done"); } else if (sql.includes("INSERT INTO iq_v3_cycles")) { cycleAttempts += 1; order.push("cycle:attempt" + cycleAttempts); if (cycleAttempts === 1) return { rows: [], dropped: true, reason: "RATE_LIMITED" }; order.push("cycle:done"); } return { rows: [], rowCount: 1 }; } };
    const { runtime, step } = makeRuntime(approveScript(), { pool });
    await step(325_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toContain("opportunity:done");
    expect(order).toContain("cycle:done");
    expect(order.indexOf("opportunity:done")).toBeLessThan(order.indexOf("cycle:attempt1"));
    expect(cycleAttempts).toBeGreaterThanOrEqual(2);
    expect(runtime.status().counters.persistDropped).toBeGreaterThanOrEqual(1);
  });

  it("J. discovery event-driven: C1 imediato com TTE ~330 (sem esperar novo candle)", async () => {
    const { runtime, step } = makeRuntime(approveScript());
    const cycle = await step(329_500);
    expect(cycle?.cycle).toBe(1);
    expect(cycle?.tteMs).toBeGreaterThanOrEqual(329_000);
    expect(runtime.status().counters.agentCycles).toBe(1);
  });
});

