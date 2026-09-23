/**
 * V3 MULTI-CYCLE LIVENESS + REVERSIBLE PRE-SEND DECISION.
 * Ciclo 1 = FULL; Ciclo 2 = DELTA (candle novo); maxAgentCycles=2; NO SUNK COST:
 * a ultima decisao tentativa valida antes do freeze vira final; scheduler e reversivel (cancel/replace).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { ALIGNED_BASE, approvalSeries, candlesFromCloses } from "./fixtures";
import { approveScript, assetOutput, consensusFinalOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
const { V3Runtime } = runtimeModule as any;
const { createScriptedAgentClient } = clientModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });
const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };
const closes = approvalSeries({ candles: 120 }).map((candle) => candle.close);

const cycleOf = (requestId: string) => { const parts = String(requestId ?? "").split(":"); return Number(parts[parts.length - 2]); };
const byCycle = (script: (cycle: number, role: string) => any) => (input: any) => script(cycleOf(input.requestId), input.role);

const setup = (scriptFn: (cycle: number, role: string) => any, { margin = 2_000, full = 100, delta = 100 } = {}) => {
  const scheduled: any[] = [];
  const cancelled: any[] = [];
  const scheduler = {
    schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; },
    cancel: (id: string, reason: string) => { cancelled.push({ id, reason }); return true; },
    status: () => ({ pending: scheduled.length, counters: {} }),
  };
  const prompts: Array<{ role: string; prompt: string; cycle: number }> = [];
  let brokerClock = exp - 330_000;
  const now = () => brokerClock;
  const inner = createScriptedAgentClient(byCycle(scriptFn), { now });
  const agents = { available: true, async call(input: any) { prompts.push({ role: input.role, prompt: input.prompt, cycle: cycleOf(input.requestId) }); return inner.call(input); } };
  const runtime = new V3Runtime({ strategy, agents, now, brokerNow: now, agentSafetyMarginMs: margin, estimatedFullCycleMs: full, estimatedDeltaCycleMs: delta, scheduler });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  const step = async (tte: number) => {
    brokerClock = exp - tte;
    const candles = candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 });
    return runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: brokerClock });
  };
  return { runtime, scheduled, cancelled, prompts, step, opportunity: () => runtime.opportunities()[0] };
};

const cycle1ApproveBuy = (cycle: number, role: string) => approveScript()[role];
const cycle2CancelWait = (cycle: number, role: string) => {
  if (cycle <= 1) return approveScript()[role];
  if (role === "ASSET") return assetOutput({ state: "WAIT", direction: "UP" });
  if (role === "CONSENSUS_FINAL") return consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "DISAGREE", reasons: ["nova evidencia cancelou a tese"] });
  return approveScript()[role];
};
const cycle2ApproveSell = (cycle: number, role: string) => {
  if (cycle <= 1) return approveScript()[role];
  if (role === "CONSENSUS_FINAL") return consensusFinalOutput({ result: "APPROVE_SELL", direction: "DOWN", agreement: "PARTIAL", independentAssessment: "estrutura virou para baixo", assetComparison: "asset ainda comprado; hipotese rejeitada" });
  if (role === "ASSET") return assetOutput({ state: "WAIT", direction: "UP" });
  return approveScript()[role];
};

describe("V3 multi-cycle — revisao pre-send (NO SUNK COST)", () => {
  it("A. Cycle1 APPROVE_BUY + Cycle2 CANCEL => final CANCEL e intent cancelado", async () => {
    const { runtime, scheduled, cancelled, step, opportunity } = setup(cycle2CancelWait);
    await step(327_000);
    const afterC1 = opportunity();
    expect(afterC1.cycles.length).toBe(1);
    expect(afterC1.tentativeDecision.result).toBe("APPROVE_BUY");
    expect(afterC1.finalizedAt).toBeNull();
    expect(scheduled.at(-1)?.context?.tentative).toBe(true);
    await step(322_000);
    const after = opportunity();
    expect(after.cycles.length).toBe(2);
    expect(after.tentativeDecision.result).toBe("CANCEL");
    expect(after.finalDecision.result).toBe("CANCEL");
    expect(after.status).toBe("CANCELLED");
    expect(cancelled.some((entry) => entry.reason === "FINAL_CONSENSUS_CANCEL")).toBe(true);
    expect(scheduled.filter((entry) => entry.context?.final === true)).toHaveLength(0);
  });

  it("B. Cycle1 APPROVE_BUY + Cycle2 APPROVE_SELL => final SELL/DOWN (replace)", async () => {
    const { scheduled, step, opportunity } = setup(cycle2ApproveSell);
    await step(327_000);
    await step(322_000);
    const after = opportunity();
    expect(after.finalDecision.result).toBe("APPROVE_SELL");
    expect(after.finalDecision.direction).toBe("DOWN");
    const finals = scheduled.filter((entry) => entry.context?.final === true);
    expect(finals).toHaveLength(1);
    expect(finals[0].context.direction).toBe("DOWN");
    expect(after.finalDecision.snapshotHash).toMatch(/^sha256:/);
  });

  it("C. Cycle1 CANCEL + Asset WAIT + Cycle2 APPROVE_BUY => final BUY/UP", async () => {
    const script = (cycle: number, role: string) => {
      if (cycle <= 1) {
        if (role === "CONSENSUS_FINAL") return consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "PARTIAL", reasons: ["sem confirmacao no C1"] });
        if (role === "ASSET") return assetOutput({ state: "WAIT" });
        return approveScript()[role];
      }
      return approveScript()[role];
    };
    const { step, opportunity } = setup(script);
    await step(327_000);
    expect(opportunity().status).toBe("WAIT");
    expect(opportunity().finalizedAt).toBeNull();
    await step(322_000);
    const after = opportunity();
    expect(after.finalDecision.result).toBe("APPROVE_BUY");
    expect(after.finalDecision.direction).toBe("UP");
    expect(after.finalDecision.cycleNumber).toBe(2);
  });

  it("D. Cycle1 NO_SETUP => nenhum Cycle 2 (7 calls apenas)", async () => {
    const script = (cycle: number, role: string) => {
      if (role === "ASSET") return assetOutput({ state: "NO_SETUP", direction: "NONE", thesis: "sem setup" });
      if (role === "CONSENSUS_FINAL") return consensusFinalOutput({ result: "CANCEL", direction: "NONE", agreement: "DISAGREE", reasons: ["no setup"] });
      return approveScript()[role];
    };
    const { runtime, step, opportunity } = setup(script);
    await step(327_000);
    const after = opportunity();
    expect(after.status).toBe("NO_SETUP");
    expect(after.cycles.length).toBe(1);
    await step(322_000);
    expect(runtime.status().counters.agentCycles).toBe(1);
    expect(runtime.status().agents.calls).toBe(7);
    expect(opportunity().cycles.length).toBe(1);
  });

  it("E/F. Cycle2 usa closedCandleId novo e FactPackets DELTA", async () => {
    const { prompts, step, opportunity } = setup(cycle2CancelWait);
    await step(327_000);
    await step(322_000);
    const after = opportunity();
    expect(after.cycles[1].closedCandleId).not.toBe(after.cycles[0].closedCandleId);
    const rsiC1 = prompts.find((entry) => entry.role === "RSI" && entry.cycle === 1);
    const rsiC2 = prompts.find((entry) => entry.role === "RSI" && entry.cycle === 2);
    expect(rsiC1?.prompt).toContain("\"mode\":\"FULL\"");
    expect(rsiC2?.prompt).toContain("\"mode\":\"DELTA\"");
    expect(rsiC2?.prompt).toContain("previousAssessment");
    expect(after.cycles[1].remainingBudgetAtCycleStart).toBeGreaterThanOrEqual(1_000);
    expect(after.cycles[1].estimatedCycleLatency).toBe(1_000);
  });

  it("H. Final snapshot reflete a ultima decisao valida (cycleNumber=2)", async () => {
    const { step, opportunity } = setup(cycle2ApproveSell);
    await step(327_000);
    await step(322_000);
    const after = opportunity();
    expect(after.finalizedAt).not.toBeNull();
    expect(after.finalDecision.cycleNumber).toBe(2);
    expect(after.finalDecision.direction).toBe("DOWN");
    expect(after.decisionHistory.map((entry: any) => entry.result)).toEqual(["APPROVE_BUY", "APPROVE_SELL"]);
  });

  it("I. Sem orcamento suficiente nenhum ciclo LLM inicia (fallback deterministico fail-closed)", async () => {
    const { runtime, step, opportunity } = setup(cycle1ApproveBuy, { full: 60_000, delta: 60_000 });
    await step(325_000);
    expect(runtime.status().counters.agentCycles).toBe(0);
    expect(runtime.status().counters.cyclesSkippedDeadline).toBe(1);
    expect(opportunity().cycles.length).toBe(1);
    expect(opportunity().cycles[0].agents.available).toBe(false);
    expect(opportunity().tentativeDecision?.result).not.toBe("APPROVE_BUY");
  });

  it("J. Deadline abortado => fail-closed, nenhum output parcial e nenhuma aprovacao", async () => {
    const scheduled: any[] = [];
    const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
    let brokerClock = exp - 330_000;
    const slow = {
      available: true,
      async call() { await new Promise((resolve) => setTimeout(resolve, 1_500)); return { status: "ERROR", reason: "SHOULD_NOT_BE_REACHED", role: "RSI", latencyMs: 1_500, output: null, schemaValid: false, semanticValid: false, usage: null, finishReason: null, httpStatus: null }; },
    };
    const runtime = new V3Runtime({ strategy, agents: slow, now: () => brokerClock, brokerNow: () => brokerClock, agentSafetyMarginMs: 2_000, estimatedFullCycleMs: 1_000, estimatedDeltaCycleMs: 1_000, scheduler });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    brokerClock = exp - 305_000; // budget = 305s - 302s - 2s = 1000ms
    const candles = candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 });
    await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: brokerClock });
    expect(runtime.status().counters.deadlineAborts).toBeGreaterThanOrEqual(1);
    expect(runtime.status().counters.agentUnavailable).toBeGreaterThanOrEqual(1);
    const after = runtime.opportunities()[0];
    expect(after.tentativeDecision?.result).not.toBe("APPROVE_BUY");
    expect(after.finalDecision?.result ?? "CANCEL").toBe("CANCEL");
    expect(scheduled.filter((entry) => entry.context?.final === true)).toHaveLength(0);
  });
});

  it("L. C2 encadeia IMEDIATAMENTE se candle novo ja fechou durante o C1 (sem esperar novo evento)", async () => {
    const scheduled: any[] = [];
    const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, cancel: () => true, status: () => ({ pending: 0, counters: {} }) };
    let brokerClock = exp - 330_000;
    const slowScript: Record<string, any> = {};
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET", "CONSENSUS_FINAL"]) slowScript[role] = { output: approveScript()[role], sleepMs: 30, latencyMs: 30 };
    const inner = createScriptedAgentClient(slowScript, { now: () => brokerClock });
    const prompts: Array<{ role: string; prompt: string }> = [];
    const agents = { available: true, async call(input: any) { prompts.push({ role: input.role, prompt: input.prompt }); return inner.call(input); } };
    const runtime = new V3Runtime({ strategy, agents, now: () => brokerClock, brokerNow: () => brokerClock, agentSafetyMarginMs: 2_000, estimatedFullCycleMs: 1_000, estimatedDeltaCycleMs: 1_000, scheduler });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    brokerClock = exp - 327_000;
    const c1Candles = candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 });
    const running = runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles: c1Candles, brokerNow: brokerClock });
    await new Promise((resolve) => setTimeout(resolve, 20)); // C1 em voo
    brokerClock = exp - 322_000; // novo candle fechou durante o C1
    const overlapping = await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles: candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 }), brokerNow: brokerClock });
    expect(overlapping).toBeNull(); // evento concorrente e ignorado (in-flight)
    await running;
    const after = runtime.opportunities()[0];
    expect(after.cycles.length).toBe(2); // C2 encadeado sem novo evento
    expect(after.finalDecision).not.toBeNull();
    const rsiC2 = prompts.find((entry) => entry.role === "RSI" && entry.prompt.includes("\"mode\":\"DELTA\""));
    expect(rsiC2).toBeTruthy();
  });

describe("V3 congelamento de seguranca", () => {
  it("K. V2 permanece frozen/intocado", () => {
    const manifest = JSON.parse(fs.readFileSync("D:/tracecom/repo/estrategias/strategy-versions/PULLBACK_4060_300_AGENTIC_V2.json", "utf8"));
    expect(manifest.status).toBe("ACTIVE");
    expect(manifest.frozen).toBe(true);
    expect(manifest.strategyHash).toBe("sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0");
  });
});
