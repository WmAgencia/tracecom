/**
 * V3 — SINGLE-CYCLE OBRIGATORIO: maxAgentCycles=1. Multiciclo NAO roda (mission "nao implemente multiciclo").
 */
import { describe, expect, it } from "vitest";
import { ALIGNED_BASE, approvalSeries, candlesFromCloses } from "./fixtures";
import { approveScript } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
const { V3Runtime } = runtimeModule as any;
const { createScriptedAgentClient } = clientModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });
const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };

const makeRuntime = () => {
  const scheduled: any[] = [];
  const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
  let brokerClock = exp - 330_000;
  const agents = createScriptedAgentClient(approveScript(), { now: () => brokerClock });
  const runtime = new V3Runtime({ strategy, agents, now: () => brokerClock, brokerNow: () => brokerClock, agentSafetyMarginMs: 2_000, estimatedFullCycleMs: 1_000, estimatedDeltaCycleMs: 1_000, scheduler });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  const closes = approvalSeries({ candles: 120 }).map((candle) => candle.close);
  const step = async (tte: number) => {
    brokerClock = exp - tte;
    const candles = candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 });
    return runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: brokerClock });
  };
  return { runtime, scheduled, step };
};

describe("V3 single-cycle obrigatorio (multiciclo desligado)", () => {
  it("lifecycle.maxAgentCycles = 1 (operacional, nao altera arquitetura)", () => {
    const { runtime } = makeRuntime();
    expect(runtime.status().lifecycle.maxAgentCycles).toBe(1);
  });

  it("apos 1 ciclo completo, candle seguinte nao gera Cycle 2 (nunca multiciclo)", async () => {
    const { runtime, step, scheduled } = makeRuntime();
    await step(325_000);
    expect(runtime.opportunities()[0].cycles.length).toBe(1);
    await step(320_000);
    expect(runtime.opportunities()[0].cycles.length).toBe(1);
    const counters = runtime.status().counters;
    expect(counters.cyclesSkippedMaxCycles + counters.cyclesSkippedNoOpportunity).toBeGreaterThanOrEqual(1);
    expect(scheduled.length).toBeLessThanOrEqual(2);
  });

  it("uma oportunidade = no maximo 1 analise (0 ordens, OBSERVE_ONLY)", async () => {
    const { runtime, step } = makeRuntime();
    await step(325_000);
    await step(315_000);
    const opportunity = runtime.opportunities()[0];
    expect(opportunity.cycles.length).toBe(1);
    expect(runtime.status().executionMode).toBe("OBSERVE_ONLY");
    expect(runtime.status().executionEnabled).toBe(false);
  });
});