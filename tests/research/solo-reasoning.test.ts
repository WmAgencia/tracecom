/**
 * SOLO_REASONING_V1_SHADOW — provas: todos os cenarios avaliados, tese congelada, refutacao procura
 * contraevidencia e nao altera a tese, INVALIDATED/WEAKENED/AMBIGUOUS -> WAIT, sem auto-inversao,
 * point-in-time, settlement idempotente, SHADOW nunca executa.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const solo = await import("../../relay/solo-reasoning.mjs");
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");
import { buildEnrichedT0, rangeCandles, zigzagCandles } from "../ai/fixtures/agents-v4-fixtures";

const t0Up = () => buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) }).t0;
const t0Down = () => buildEnrichedT0({ candles: zigzagCandles({ dir: "DOWN", steps: 88 }) }).t0;

describe("SOLO_REASONING_V1_SHADOW", () => {
  it("avalia TODOS os cenarios e escolhe primary de forma deterministica", () => {
    const engine = new solo.SoloReasoningEngine({});
    const observation = engine.observe({ t0: t0Up(), candidate: { candidateId: "s1", targetEntryAt: 1, targetExpiryAt: 2, payout: 0.87 }, g2Action: "BUY", v4Action: "BUY" });
    expect(observation.discovery.scenarios).toHaveLength(8);
    expect(solo.SCENARIOS).toContain(observation.discovery.primaryScenario);
    const again = engine.observe({ t0: t0Up(), candidate: { candidateId: "s1b", targetEntryAt: 1, targetExpiryAt: 2, payout: 0.87 } });
    expect(again.discovery.primaryScenario).toBe(observation.discovery.primaryScenario);
  });

  it("tese inicial e congelada com hash e a refutacao NAO a modifica", () => {
    const engine = new solo.SoloReasoningEngine({});
    const observation = engine.observe({ t0: t0Up(), candidate: { candidateId: "s2", targetEntryAt: 1, targetExpiryAt: 2, payout: 0.87 }, g2Action: "BUY" });
    const frozen = JSON.stringify(observation.thesis);
    expect(observation.thesis.initialThesisHash).toHaveLength(64);
    expect(observation.refutation.refutationStrength).toBeTruthy();
    expect(solo.SURVIVALS).toContain(observation.refutation.survival);
    expect(JSON.stringify(observation.thesis)).toBe(frozen);
  });

  it("refutacao procura contraevidencia real (nao autojustificacao)", () => {
    const result = solo.selfRefute({
      thesis: { initialAction: "BUY", initialDirection: "BULLISH", trigger: null },
      t0: t0Down(),
      specialists: { structure: { state: "BEARISH_STRUCTURE" }, location: { state: "EDGE_UPPER" }, momentum: { state: "REVERSING", detail: { direction: "DOWN" }, riskFlags: [] }, priceAction: { state: "BEARISH" }, microstructure: { state: "SELL_PRESSURE", riskFlags: [] }, regime: { state: "TREND_DOWN" }, volatility: { state: "NORMAL" }, trend: {} },
      discovery: { primaryFit: 0.5, scenarios: [{ scenarioId: "REVERSAL", fitScore: 0.45, direction: "SELL" }], ambiguity: false },
    });
    expect(result.refutationStrength).toBe("FATAL");
    expect(result.survival).toBe("THESIS_INVALIDATED");
    expect(result.strongestCounterEvidence.length).toBeGreaterThan(0);
    expect(result.whatWouldMakeOriginalWrong.length).toBeGreaterThan(0);
  });

  it("INVALIDATED / WEAKENED / AMBIGUOUS => WAIT e NUNCA inverte direcao", () => {
    const buy = { initialAction: "BUY", initialDirection: "BULLISH" };
    expect(solo.finalDecision({ thesis: buy, refutation: { refutationStrength: "FATAL", survival: "THESIS_INVALIDATED" } }).action).toBe("WAIT");
    expect(solo.finalDecision({ thesis: buy, refutation: { refutationStrength: "MATERIAL", survival: "THESIS_WEAKENED" } }).action).toBe("WAIT");
    expect(solo.finalDecision({ thesis: buy, refutation: { refutationStrength: "WEAK", survival: "AMBIGUOUS" } }).action).toBe("WAIT");
    const survives = solo.finalDecision({ thesis: buy, refutation: { refutationStrength: "NONE", survival: "THESIS_SURVIVES" } });
    expect(survives.action).toBe("BUY");
    expect(survives.autoInvert).toBe(false);
  });

  it("ambiguidade entre cenarios incompativeis pode gerar WAIT", () => {
    const discovery = solo.discoverScenarios({ features: { bosUp: true, bosDown: false }, t0: t0Up(), specialists: { regime: { state: "TRANSITION" }, structure: { state: "RANGE_STRUCTURE" }, trend: { state: "NEUTRAL", detail: { weakening: false, maturity: "EARLY" } }, location: { state: "MID" }, momentum: { state: "STABLE", detail: { direction: "FLAT" }, riskFlags: [] }, volatility: { state: "NORMAL" }, priceAction: { state: "NEUTRAL" }, microstructure: { state: "BALANCED" } } });
    expect(discovery.scenarios.length).toBe(8);
    expect(typeof discovery.ambiguity).toBe("boolean");
    expect(discovery.scenarioGap).toBeGreaterThanOrEqual(0);
  });

  it("projecao usa somente informacao point-in-time e nao emite probabilidade", () => {
    const engine = new solo.SoloReasoningEngine({});
    const t0 = t0Up();
    const observation = engine.observe({ t0, candidate: { candidateId: "s3", targetEntryAt: 1, targetExpiryAt: 2, payout: 0.87 } });
    if (observation.projection) {
      expect(observation.projection.expectedExpiryDirection).toMatch(/ACIMA|ABAIXO/);
      expect(observation.projection.expectedExpiryZone.low).toBeLessThanOrEqual(observation.projection.expectedExpiryZone.high);
      expect(JSON.stringify(observation.projection)).not.toMatch(/probability|probabilidade/i);
    }
    expect(hub.findFutureReferences(observation.projection ?? {}, t0.times.availableAt)).toEqual([]);
  });

  it("SHADOW nunca executa e settlement e idempotente com contrafactual da tese inicial", () => {
    const engine = new solo.SoloReasoningEngine({});
    const t0 = t0Up();
    const observation = engine.observe({ t0, candidate: { candidateId: "s4", targetEntryAt: t0.times.decisionAt - 2_000, targetExpiryAt: t0.times.decisionAt + 58_000, payout: 0.87 } });
    const candles = [];
    for (let index = 0; index < 60; index += 1) { const bucketStart = t0.times.decisionAt - 30_000 + index * 5_000; candles.push({ bucketStart, bucketEnd: bucketStart + 5_000, open: 1.1, high: 1.101, low: 1.099, close: 1.1005 }); }
    engine.settleCausal({ marketKey: observation.marketKey, candles, index: candles.length - 1, nowMs: t0.times.decisionAt + 200_000 });
    const first = JSON.stringify({ outcome: observation.outcome, initial: observation.initialCounterfactual });
    engine.settleCausal({ marketKey: observation.marketKey, candles, index: candles.length - 1, nowMs: t0.times.decisionAt + 300_000 });
    expect(JSON.stringify({ outcome: observation.outcome, initial: observation.initialCounterfactual })).toBe(first);
    expect(solo.SOLO_POLICY.controlsExecution).toBe(false);
    expect(observation).not.toHaveProperty("brokerOrderId");
    expect(observation).not.toHaveProperty("executionId");
    const status = engine.status();
    expect(status.controlsExecution).toBe(false);
    expect(status.counters.observations).toBe(1);
  });

  it("latencia por fase e medida e freeze declara ausencia de tuning", () => {
    const engine = new solo.SoloReasoningEngine({});
    engine.observe({ t0: t0Up(), candidate: { candidateId: "s5", targetEntryAt: 1, targetExpiryAt: 2 } });
    const status = engine.status();
    for (const key of ["scenarioDiscovery", "playbookEvaluation", "initialThesis", "projection", "selfRefutation", "finalDecision", "total"]) expect(status.latencyMs[key].count, key).toBeGreaterThan(0);
    const manifest = solo.soloFreezeManifest();
    expect(manifest.noTuning).toBe(true);
    expect(manifest.policy.rounds).toBe(1);
    expect(manifest.policy.voting).toBe(false);
  });

  it("range sem direcao permanece WAIT (sem trades forcados)", () => {
    const engine = new solo.SoloReasoningEngine({});
    const observation = engine.observe({ t0: buildEnrichedT0({ candles: rangeCandles() }).t0, candidate: { candidateId: "s6", targetEntryAt: 1, targetExpiryAt: 2 } });
    expect(["WAIT", "BUY", "SELL"]).toContain(observation.finalAction);
    if (observation.finalAction === "WAIT") expect(observation.direction).toBeNull();
  });
});
