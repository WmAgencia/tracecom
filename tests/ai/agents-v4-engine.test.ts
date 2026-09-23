/**
 * ENGINE V4 — integracao T0 enriquecido, version router (independencia), settlement causal
 * (nunca BROKER_EXECUTED), benchmark e prova de que SHADOW nunca executa.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/agents-v4/index.mjs");
import { BASE_MS, buildEnrichedT0, healthyDataQuality, zigzagCandles } from "./fixtures/agents-v4-fixtures";

function candidateFixture(decisionAt: number, overrides: any = {}) {
  return {
    candidateId: "cand-1", correlationId: "corr-1", createdAt: decisionAt - 25_000,
    targetEntryAt: decisionAt - 2_000, targetExpiryAt: decisionAt + 55_000,
    entryPrice: 1.1, payout: 0.87, ...overrides,
  };
}

describe("AgentsV4Engine", () => {
  it("integra T0 enriquecido e alcanca BUY (mesmos insumos do G2)", () => {
    const { t0, decisionAt } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    const observation = engine.observeCandidate({
      t0, candidate: candidateFixture(decisionAt), g2Action: "BUY",
      v3Runner: () => ({ action: "WAIT", primaryScenario: "TRANSITION_NO_TRADE", marketRegime: "TRANSITION" }),
      dataQualityAssessment: healthyDataQuality(t0),
      risk: { accountContext: "PRACTICE", openPositions: 0, consecutiveLosses: 0, dailyDrawdownPct: 0, payout: 0.87 },
    });
    expect(observation).not.toBeNull();
    expect(observation.finalAction).toBe("BUY");
    expect(observation.regime).toBe("TREND_UP");
    expect(observation.router.versions.G2_CURRENT.action).toBe("BUY");
    expect(observation.router.versions.SCENARIO_ENGINE_V3_FROZEN.action).toBe("WAIT");
    expect(observation.router.independence.isolated).toBe(true);
    expect(observation.router.versions.PROFESSIONAL_AGENT_SYSTEM_V4.action).toBe("BUY");
  });

  it("version router isola falhas e nunca cria chamadas cruzadas", () => {
    const { t0 } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const calls: string[] = [];
    const record = v4.runVersionRouter({
      t0,
      g2: () => { calls.push("g2"); return { action: "SELL" }; },
      v3: () => { calls.push("v3"); throw new Error("V3_TEST_FAIL"); },
      v4: () => { calls.push("v4"); return { action: "BUY", scenario: "TREND_CONTINUATION", regime: "TREND_UP" }; },
    });
    expect(calls).toEqual(["g2", "v3", "v4"]);
    expect(record.versions.SCENARIO_ENGINE_V3_FROZEN.action).toBe("ERROR");
    expect(record.versions.G2_CURRENT.action).toBe("SELL");
    expect(record.versions.PROFESSIONAL_AGENT_SYSTEM_V4.action).toBe("BUY");
    expect(record.independence.crossCalls).toBe(0);
    expect(record.policy.controlsExecution).toBe(false);
  });

  it("settlement causal: apenas BUY/SELL liquida; WAIT fica fora; basis nunca BROKER_EXECUTED", () => {
    const { t0, decisionAt } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    const buyObservation = engine.observeCandidate({
      t0, candidate: candidateFixture(decisionAt), g2Action: "BUY",
      v3Runner: () => ({ action: "WAIT" }), dataQualityAssessment: healthyDataQuality(t0),
      risk: { accountContext: "PRACTICE", openPositions: 0, consecutiveLosses: 0, dailyDrawdownPct: 0, payout: 0.87 },
    });
    const waitObservation = engine.observeCandidate({
      t0: { ...t0, snapshotId: `${t0.snapshotId}-2` }, candidate: candidateFixture(decisionAt, { candidateId: "cand-2" }), g2Action: "BUY",
      v3Runner: () => ({ action: "WAIT" }),
      dataQualityAssessment: hub.assessDataQuality({ ...healthyDataQuality(t0), feed: { connected: false, tickAgeMs: null } }),
      risk: { accountContext: "PRACTICE", openPositions: 0 },
    });
    expect(waitObservation.finalAction).toBe("NO_TRADE");
    const settlement = new v4.AgentsV4Settlement({ observationSource: engine });
    const candles = [];
    for (let index = 0; index < 60; index += 1) {
      const bucketStart = decisionAt - 30_000 + index * 5_000;
      candles.push({ bucketStart, bucketEnd: bucketStart + 5_000, open: 1.1, high: 1.101, low: 1.099, close: index % 2 === 0 ? 1.1005 : 1.0995 });
    }
    const settledBuy = settlement.settleCausal({ marketKey: "EURUSD:OTC", candles, index: candles.length - 1, nowMs: decisionAt + 200_000 });
    expect(settledBuy).toBe(1);
    expect(buyObservation.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
    expect(["WIN", "LOSS", "DRAW"]).toContain(buyObservation.theoreticalResult);
    expect(buyObservation.outcome.settlementBasis).not.toBe("BROKER_EXECUTED");
    expect(buyObservation.outcome.feedableToClassification).toBe(false);
    expect(waitObservation.settlementBasis).toBeNull();
    expect(settlement.pendingForMarket("EURUSD:OTC")).toHaveLength(0);
  });

  it("settlement e idempotente (linha liquidada nunca e reescrita)", () => {
    const { t0, decisionAt } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    const observation = engine.observeCandidate({
      t0, candidate: candidateFixture(decisionAt), g2Action: "BUY", v3Runner: () => ({ action: "WAIT" }),
      dataQualityAssessment: healthyDataQuality(t0), risk: { accountContext: "PRACTICE", openPositions: 0 },
    });
    const settlement = new v4.AgentsV4Settlement({ observationSource: engine });
    const candles = [];
    for (let index = 0; index < 60; index += 1) {
      const bucketStart = decisionAt - 30_000 + index * 5_000;
      candles.push({ bucketStart, bucketEnd: bucketStart + 5_000, open: 1.1, high: 1.101, low: 1.099, close: 1.1005 });
    }
    settlement.settleCausal({ marketKey: "EURUSD:OTC", candles, index: candles.length - 1, nowMs: decisionAt + 200_000 });
    const firstOutcome = JSON.stringify(observation.outcome);
    settlement.settleCausal({ marketKey: "EURUSD:OTC", candles, index: candles.length - 1, nowMs: decisionAt + 300_000 });
    expect(JSON.stringify(observation.outcome)).toBe(firstOutcome);
  });

  it("shadow nunca executa: policy, observation e comites declaram isso", () => {
    const { t0, decisionAt } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    const observation = engine.observeCandidate({
      t0, candidate: candidateFixture(decisionAt), g2Action: "BUY", v3Runner: () => ({ action: "WAIT" }),
      dataQualityAssessment: healthyDataQuality(t0), risk: { accountContext: "PRACTICE", openPositions: 0 },
    });
    expect(observation.payload.controlsExecution).toBe(false);
    expect(observation.payload.shadowOnly).toBe(true);
    expect(observation.router.policy.sendsOrders).toBe(false);
    expect(observation.payload.committees.policy.sendsOrders).toBe(false);
    expect(observation.payload.committees.execution.policy.controlsExecution).toBe(false);
    expect(JSON.stringify(observation.payload)).not.toContain("brokerOrderId");
    expect(observation).not.toHaveProperty("brokerOrderId");
    expect(observation).not.toHaveProperty("executionId");
  });

  it("benchmark agrega G2/V3/V4 sem misturar bases de settlement", () => {
    const { t0, decisionAt } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    engine.observeCandidate({ t0, candidate: candidateFixture(decisionAt), g2Action: "BUY", v3Runner: () => ({ action: "WAIT" }), dataQualityAssessment: healthyDataQuality(t0), risk: { accountContext: "PRACTICE", openPositions: 0 } });
    engine.observeCandidate({ t0: { ...t0, snapshotId: `${t0.snapshotId}-b` }, candidate: candidateFixture(decisionAt, { candidateId: "cand-b" }), g2Action: "SELL", v3Runner: () => ({ action: "WAIT" }), dataQualityAssessment: healthyDataQuality(t0), risk: { accountContext: "PRACTICE", openPositions: 0 } });
    const summary = engine.status().benchmark;
    expect(summary.total).toBe(2);
    expect(summary.actions.g2.BUY).toBe(1);
    expect(summary.actions.g2.SELL).toBe(1);
    expect(summary.actions.v3.WAIT).toBe(2);
    const v4Total = (summary.actions.v4.BUY ?? 0) + (summary.actions.v4.SELL ?? 0) + (summary.actions.v4.WAIT ?? 0) + (summary.actions.v4.NO_TRADE ?? 0);
    expect(v4Total).toBe(2);
    expect(summary.settlement.basis).toContain("CAUSAL_COUNTERFACTUAL");
    expect(summary.controlsExecution).toBe(false);
  });

  it("latencia medida e dentro do budget de pesquisa (p95 < 50ms, sem bloquear feed)", () => {
    const { t0 } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    const dq = healthyDataQuality(t0);
    for (let index = 0; index < 50; index += 1) engine.analyze({ t0, dataQualityAssessment: dq });
    const status = engine.status();
    expect(status.latencyMs.total.count).toBe(50);
    expect(status.latencyMs.total.p95).toBeLessThan(50);
    expect(status.latencyMs.specialists.p95).toBeLessThan(40);
  });

  it("coverage ao vivo exposta no status apos observacao de mercado", () => {
    const { t0 } = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) });
    const engine = new v4.AgentsV4Engine();
    engine.observeMarketState({ t0, dataQualityAssessment: healthyDataQuality(t0), risk: { accountContext: "PRACTICE" } });
    const status = engine.status();
    expect(status.coverage.snapshots).toBe(1);
    expect(status.coverage.byMarketType.OTC).toBe(1);
    expect(status.markets.length).toBe(1);
    expect(status.markets[0].agents.length).toBe(12);
    expect(status.markets[0].opinion).toBeTruthy();
  });

  it("REAL allowlist permanece intacto (identidade = versão operacional congelada)", async () => {
    // @ts-expect-error - relay ESM sem tipagem
    const accountContext = await import("../../relay/account-context.mjs");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.allowed).toContain("PULLBACK_4060_300_AGENTIC_V2");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.allowed).not.toContain("PROFESSIONAL_BRAIN_G2");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.shadowOnly).toContain("AGENT_V4");
  });
});
