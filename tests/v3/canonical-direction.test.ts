/**
 * CANONICAL DECISION DIRECTION — a autoridade direcional final e SEMPRE o Consensus Final (LLM).
 * O Asset e hipotese independente: nao pode sobrescrever a decisao nem contaminar snapshot/scheduler.
 */
import { describe, expect, it } from "vitest";
import { ALIGNED_BASE, approvalSeries, candlesFromCloses } from "./fixtures";
import { approveScript, assetOutput, consensusFinalOutput } from "./agent-script";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const gateModule = await import("../../relay/v3/final-gate.mjs");
// @ts-expect-error - relay ESM sem tipagem
const snapshotModule = await import("../../relay/v3/decision-snapshot.mjs");
// @ts-expect-error - relay ESM sem tipagem
const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
const { V3Runtime } = runtimeModule as any;
const { canonicalDecisionDirection } = gateModule as any;
const { buildV3DecisionSnapshot } = snapshotModule as any;
const { createScriptedAgentClient } = clientModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });
const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };

const runUntilApproval = async (script: Record<string, any>) => {
  const scheduled: any[] = [];
  const scheduler = { schedule: (intent: any) => { scheduled.push(intent); return { scheduled: true, intent }; }, status: () => ({ pending: scheduled.length, counters: {} }), cancel: () => true, tick: () => [], fireDue: () => [] };
  let brokerClock = exp - 320_000;
  const agents = createScriptedAgentClient(script, { now: () => brokerClock });
  const runtime = new V3Runtime({ strategy, agents, now: () => brokerClock, brokerNow: () => brokerClock, agentSafetyMarginMs: 1_000, estimatedWaveMs: 500, scheduler });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  const closes = approvalSeries({ candles: 120 }).map((candle) => candle.close);
  let cycle = null;
  for (const tte of [327_000, 322_000, 317_000, 312_000, 307_000]) {
    brokerClock = exp - tte;
    const candles = candlesFromCloses(closes, { startAt: brokerClock - closes.length * 5_000 });
    const current = await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: brokerClock });
    if (current?.consensus === "APPROVE_BUY" || current?.consensus === "APPROVE_SELL") { cycle = current; }
    if (runtime.opportunities()[0]?.finalDecision) break;
  }
  return { cycle, opportunity: runtime.opportunities()[0], scheduled, runtime };
};

describe("canonical direction — Consensus manda, Asset nao sobrescreve", () => {
  it("mapa: APPROVE_BUY=>UP, APPROVE_SELL=>DOWN, CANCEL=>NONE", () => {
    expect(canonicalDecisionDirection({ result: "APPROVE_BUY", direction: "UP" })).toBe("UP");
    expect(canonicalDecisionDirection({ result: "APPROVE_SELL", direction: "DOWN" })).toBe("DOWN");
    expect(canonicalDecisionDirection({ result: "CANCEL", direction: "UP" })).toBe("NONE");
    expect(canonicalDecisionDirection(null)).toBe("NONE");
  });

  it("Asset DOWN/SELL_CANDIDATE + Consensus APPROVE_BUY => execucao canonica UP (nunca DOWN)", async () => {
    const script = { ...approveScript(), ASSET: assetOutput({ direction: "DOWN", state: "SELL_CANDIDATE", bestCounterCase: "BOS bullish invalidaria a queda" }) };
    const { cycle, opportunity, scheduled } = await runUntilApproval(script);
    expect(cycle).toBeTruthy();
    expect(cycle.consensus).toBe("APPROVE_BUY");
    expect(cycle.assetDirection).toBe("DOWN");        // hipotese registrada como informacao
    expect(cycle.direction).toBe("UP");               // execucao canonica
    expect(opportunity.finalDecision.result).toBe("APPROVE_BUY");
    expect(opportunity.finalDecision.direction).toBe("UP");
    expect(scheduled[0].context.direction).toBe("UP");
    expect(scheduled[0].context.direction).not.toBe("DOWN");
  });

  it("Asset UP/BUY_CANDIDATE + Consensus APPROVE_SELL => execucao canonica DOWN (espelho)", async () => {
    const script = {
      ...approveScript(),
      ASSET: assetOutput({ direction: "UP", state: "BUY_CANDIDATE" }),
      CONSENSUS_FINAL: consensusFinalOutput({ direction: "DOWN", result: "APPROVE_SELL", independentAssessment: "estrutura virou para baixa", assetComparison: "asset ainda comprado; hipotese rejeitada", supportingEvidence: ["CHoCH bearish"], bestCaseForUp: ["BOS"], bestCaseAgainstUp: ["CHoCH bearish"] }),
    };
    const { cycle, opportunity, scheduled } = await runUntilApproval(script);
    expect(cycle).toBeTruthy();
    expect(cycle.consensus).toBe("APPROVE_SELL");
    expect(cycle.assetDirection).toBe("UP");
    expect(cycle.direction).toBe("DOWN");
    expect(opportunity.finalDecision.direction).toBe("DOWN");
    expect(scheduled[0].context.direction).toBe("DOWN");
    expect(scheduled[0].context.direction).not.toBe("UP");
  });

  it("snapshot: canonicalDirection e finalDecision.direction vem do Consensus; Asset fica como hipotese", () => {
    const snapshot = buildV3DecisionSnapshot({
      strategy, opportunity: { opportunityId: "EURUSD:OTC@x", expirationAt: exp, targetSendAt: exp - 302_000 }, cycles: [],
      asset: { scenario: "PULLBACK_CONTINUATION", direction: "DOWN", state: "SELL_CANDIDATE", bestCounterCase: "x", blockers: [], invalidations: [] },
      consensus: { result: "APPROVE_BUY", direction: "UP", agreement: "PARTIAL" },
      specialists: null, measurements: null,
      finalDecision: { result: "APPROVE_BUY", direction: "UP", at: 1, tteMs: 310_000 },
      timing: null,
    });
    expect(snapshot.canonicalDirection).toBe("UP");
    expect(snapshot.finalDecision.direction).toBe("UP");
    expect(snapshot.asset.direction).toBe("DOWN"); // hipotese preservada, nunca autoridade
  });
});
