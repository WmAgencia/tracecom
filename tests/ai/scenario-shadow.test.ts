/**
 * SCENARIO SHADOW + CRITIC INDEPENDENTE (Agente B) — testes SHADOW/anti-leakage/2 fases.
 *
 * Prova, no nivel do modulo puro + artefatos:
 *  1. Critic fase 1 ANTES de ler o Trader, congelado (hash/timestamp);
 *  2. divergencia vira investigacao e, sem evidencia, WAIT (nunca votacao; nunca inverte direcao);
 *  3. scenario persistence (CANDIDATE→R1→R2→FINAL_ENTRY) append-only com T0 imutavel;
 *  4. final revalidation LATE_WINDOW_V2 cancela candidato invalidado (nunca vira PUT);
 *  5. SHADOW nunca chama Execution Gate / nunca envia ordem;
 *  6. zero leakage (POST/settlement/result/futuro fora da classificacao T0);
 *  7. isolamento marketKey e NORMAL x OTC; 8. determinismo; 9. ablation-ready;
 * 10. migration 031 idempotente; 11. endpoint separa BROKER_EXECUTED/COUNTERFACTUAL/HISTORICAL/PROSPECTIVE.
 *
 * Nenhuma regra de decisao de producao e alterada por estes testes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const shadow = await import("../../relay/scenario-shadow.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const intersection = await import("../../relay/scenario-timing-intersection.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const timing = await import("../../relay/late-window-timing.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const { IqMultiRuntime } = await import("../../relay/iq-multi-runtime.mjs");
const {
  runScenarioShadow, ScenarioShadow, runCriticPhase1, buildCriticSnapshot, buildScenarioFeatures,
  resolveAblation, resolveScenarioDivergence, evaluateFinalRevalidation, extractResolutionEvidence,
  findForbiddenKeys, buildScenarioShadowDashboard, scenarioShadowStatus, scenarioEngineInfo,
  applyScenarioAdvisory, playbookOf, FALLBACK_ENGINE, SCENARIO_SHADOW_POLICY, ABLATION_POLICY,
  SCENARIO_ENGINE_V3_SHADOW, CURRENT_G2, SCENARIO_STAGES, RESOLUTION_POINTS,
  analyzeScenarioSnapshot, buildTimingView, DIVERGENCE_POLICY_VERSION, SCENARIO_ENGINE_V3, detachScenarioEngine,
} = shadow as unknown as Record<string, any>;
const {
  buildIntersection, ScenarioTimingIntersectionShadow, SCENARIO_TIMING_INTERSECTION_POLICY, scenarioPointAt,
} = intersection as unknown as Record<string, any>;
const { LateWindowTimingShadow, TIMING_POLICY_CURRENT, TIMING_POLICY_LATE } = timing as unknown as Record<string, any>;

type AnyRecord = Record<string, any>;

const SERVER_SOURCE: string = readFileSync("relay/server.mjs", "utf8");
const MIGRATION_SQL: string = readFileSync("relay/migrations/031_scenario_shadow.sql", "utf8");
const MODULE_SOURCE: string = readFileSync("relay/scenario-shadow.mjs", "utf8");

function snapshot(overrides: AnyRecord = {}): AnyRecord {
  return {
    action: "BUY", price: 1.1, regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida",
    structure: { label: "UP", at: 1500 }, momentum: { rsi14: 55, velocity: 0.0002, acceleration: 0.00001 },
    strength: { adx14: 25, plusDI: 22, minusDI: 18, diSpread: 4 },
    volatility: { atr: 0.001, atrRatio: 1.1 }, microstructure: { streak: 1, bodyRatio: 0.6, upperWick: 0.2, lowerWick: 0.2 },
    location: { donchianPosition: 0.6, distanceToUpperATR: 0.8, distanceToLowerATR: 1.4, channelHigh: 1.12, channelLow: 1.05 },
    critic: { verdict: "CONFIRM", independentAction: "BUY", contradictions: [], riskFlags: [] },
    consensus: { status: "CONFIRMED", action: "BUY" }, freshness: { fresh: true, tickAgeMs: 120 },
    ...overrides,
  };
}

/** Engine determinista de teste: analises por fase (mantem o contrato congelado). */
function engineFor(perPhase: AnyRecord, onCall: ((input: AnyRecord) => void) | null = null): AnyRecord {
  return {
    version: "scenario-engine-test-stub",
    REGIMES: ["TREND_UP", "TREND_DOWN", "RANGE"],
    SCENARIOS: ["TREND_PULLBACK", "BREAKOUT", "FAILED_BREAKOUT", "REVERSAL"],
    extractContext: (input: AnyRecord) => ({ ...input.snapshot, direction: input.direction }),
    classifyRegime: () => ({ regime: "TREND_UP" }),
    classifyScenario: () => ({ scenario: "TREND_PULLBACK" }),
    evaluatePlaybook: () => ({ action: "BUY" }),
    analyzeScenario: (input: AnyRecord) => {
      if (onCall) onCall(input);
      const analysis = perPhase[input.phase] ?? {};
      return { confidence: 0.5, featuresUsed: ["rsi14"], ...analysis };
    },
  };
}

const analysisFor = (over: AnyRecord = {}): AnyRecord => ({
  marketRegime: "TREND_UP", primaryScenario: "TREND_PULLBACK", action: "BUY", confidence: 0.6,
  scenarioEvidenceFor: ["STRUCTURE_ALIGNED"], scenarioEvidenceAgainst: [], invalidationReasons: [], featuresUsed: ["rsi14"], ...over,
});

function observeWith(instance: AnyRecord, over: AnyRecord = {}): AnyRecord {
  return instance.observe({
    snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY", currentDecision: "BUY" }, criticView: {},
    marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "cand_1", candidateAt: 1_000, decisionAt: 2_000,
    targetEntryAt: 61_000, targetExpiryAt: 121_000, payout: 82, now: () => 3_000, ...over,
  });
}

class FakeStore {
  rows = new Map<string, AnyRecord>();
  updates: AnyRecord[] = [];
  async save(observation: AnyRecord) { this.rows.set(observation.id, JSON.parse(JSON.stringify({ ...observation, persistPromise: undefined }))); }
  async update({ observationId, patch }: AnyRecord) {
    this.updates.push({ observationId, patch });
    const row = this.rows.get(observationId);
    if (row) Object.assign(row, patch);
    return true;
  }
  async getById(id: string) {
    for (const row of this.rows.values()) if (row.id === id || row.candidateId === id || row.executionId === id) return JSON.parse(JSON.stringify(row));
    return null;
  }
}

describe("1. Critic independente em 2 fases (fase 1 congelada ANTES do Trader)", () => {
  it("fase 1 recebe o T0 sem a conclusao do Trader e congela hash/timestamp", () => {
    const calls: AnyRecord[] = [];
    const engine = engineFor({ PHASE1_INDEPENDENT: analysisFor({ marketRegime: "TREND_UP" }), PHASE2_TRADER: analysisFor() }, (input) => calls.push(input));
    const observation = runScenarioShadow({
      snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, criticView: { traderAssessment: "CONFIRM" },
      marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_phase", candidateAt: 1_000, decisionAt: 2_000, payout: 82, engine, now: () => 3_000,
    });
    expect(calls).toHaveLength(2);
    const firstCall = calls[0] as AnyRecord;
    const secondCall = calls[1] as AnyRecord;
    expect(firstCall.phase).toBe("PHASE1_INDEPENDENT");
    expect(firstCall.traderConclusionVisible).toBe(false);
    expect(firstCall.snapshot).not.toHaveProperty("trader");
    expect(firstCall.snapshot).not.toHaveProperty("consensus");
    expect(firstCall.snapshot).not.toHaveProperty("action");
    expect(secondCall.phase).toBe("PHASE2_TRADER");
    expect(observation.criticFreeze.criticSawTraderConclusion).toBe(false);
    expect(observation.criticFreeze.frozenHash).toHaveLength(64);
    expect(observation.criticFreeze.frozenAt).toBe(3_000);
  });

  it("analise da fase 1 e congelada e nao e sobrescrita pela fase 2", () => {
    const engine = engineFor({
      PHASE1_INDEPENDENT: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT" }),
      PHASE2_TRADER: analysisFor({ primaryScenario: "BREAKOUT", action: "BUY" }),
    });
    const frozen = runCriticPhase1({ snapshotT0: buildT0ForTest(), engine, now: () => 111 });
    expect(Object.isFrozen(frozen.analysis)).toBe(true);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.frozenAt).toBe(111);
    expect(frozen.analysis.primaryScenario).toBe("FAILED_BREAKOUT");
    expect(() => { (frozen.analysis as AnyRecord).primaryScenario = "HACK"; }).toThrow();
    expect(frozen.analysis.primaryScenario).toBe("FAILED_BREAKOUT");
  });

  it("comparacao registra os pontos exatos de divergencia e o acordo", () => {
    const engine = engineFor({
      PHASE1_INDEPENDENT: analysisFor({ primaryScenario: "REVERSAL", action: "SELL" }),
      PHASE2_TRADER: analysisFor({ primaryScenario: "TREND_PULLBACK", action: "BUY" }),
    });
    const observation = runScenarioShadow({
      snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, marketKey: "EURUSD:OTC", candidateId: "c_cmp",
      candidateAt: 1_000, decisionAt: 2_000, engine, now: () => 3_000,
    });
    expect(observation.agreement).toBe(false);
    expect(observation.comparison.points.traderScenario).toBe("TREND_PULLBACK");
    expect(observation.comparison.points.criticScenario).toBe("REVERSAL");
    expect(observation.comparison.points.traderAction).toBe("BUY");
    expect(observation.comparison.points.criticAction).toBe("SELL");
    expect(observation.comparison.directionFlipForbidden).toBe(true);
  });

  function buildT0ForTest(): AnyRecord {
    // buildT0Snapshot e reutilizado do shadow-lab via runScenarioShadow; aqui usamos um T0 ja pronto.
    const observation = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, candidateAt: 1_000, decisionAt: 2_000, engine: FALLBACK_ENGINE, now: () => 1 });
    return observation.t0;
  }
});

describe("2. divergencia = investigacao (nunca votacao; sem evidencia -> WAIT)", () => {
  it("TREND_PULLBACK/BUY vs REVERSAL/SELL nao vira votacao e nunca adota SELL", () => {
    const divergence = resolveScenarioDivergence({
      trader: { primaryScenario: "TREND_PULLBACK", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "REVERSAL", action: "SELL", marketRegime: "TREND_DOWN" },
      snapshot: snapshot(),
    });
    expect(divergence.divergence).toBe("DIRECTION_OPPOSITE");
    expect(divergence.investigation).toBe(true);
    expect(divergence.finalAction).toBe("WAIT");
    expect(divergence.finalAction).not.toBe("SELL");
    expect(divergence.directionFlipForbidden).toBe(true);
    expect(divergence.adoptedDirection).toBeNull();
    expect(divergence.reasonsForWait).toContain("NEVER_ADOPT_CRITIC_DIRECTION");
  });

  it("BREAKOUT/BUY vs FAILED_BREAKOUT/WAIT compara hold/re-entry/wick/momentum/ticks/location; sem evidencia -> WAIT", () => {
    const divergence = resolveScenarioDivergence({
      trader: { primaryScenario: "BREAKOUT", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "FAILED_BREAKOUT", action: "WAIT", marketRegime: "TREND_UP" },
      snapshot: snapshot({
        microstructure: { streak: -1, bodyRatio: 0.2, upperWick: 0.9, lowerWick: 0.05 },
        momentum: { rsi14: 55, velocity: -0.0004 }, location: { donchianPosition: 0.5, distanceToUpperATR: 0.4, distanceToLowerATR: 3.0 },
        freshness: { fresh: false, tickAgeMs: 60_000 },
      }),
    });
    expect(divergence.divergence).toBe("TRADER_ENTRY_CRITIC_WAIT");
    expect(divergence.investigation).toBe(true);
    expect(divergence.finalAction).toBe("WAIT");
    expect(divergence.reasonsForWait).toContain("CRITIC_WAIT_INCONCLUSIVE");
    for (const point of RESOLUTION_POINTS) expect(divergence.resolutionPoints).toHaveProperty(point);
    expect(divergence.resolutionSatisfied.length).toBeLessThan(4);
  });

  it("com evidencia suficiente (>=4/6) mantem a direcao do Trader — nunca a do Critic", () => {
    const divergence = resolveScenarioDivergence({
      trader: { primaryScenario: "BREAKOUT", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "FAILED_BREAKOUT", action: "WAIT", marketRegime: "TREND_UP" },
      snapshot: snapshot({ evidence: { holdAboveLevel: true, reEntry: true, rejectionWick: false, ticksFresh: true } }),
    });
    expect(divergence.finalAction).toBe("BUY");
    expect(divergence.resolutionSatisfied.length).toBeGreaterThanOrEqual(4);
    expect(divergence.adoptedDirection).toBeNull();
  });

  it("Trader WAIT nunca e promovido pela entrada do Critic", () => {
    const divergence = resolveScenarioDivergence({
      trader: { primaryScenario: "CONSOLIDATION", action: "WAIT", marketRegime: "RANGE" },
      critic: { primaryScenario: "BREAKOUT", action: "BUY", marketRegime: "RANGE" },
      snapshot: snapshot({ evidence: { holdAboveLevel: true, reEntry: true, rejectionWick: false, ticksFresh: true } }),
    });
    expect(divergence.divergence).toBe("TRADER_WAIT_CRITIC_ENTRY");
    expect(divergence.finalAction).toBe("WAIT");
    expect(divergence.reasonsForWait).toContain("TRADER_WAIT_NEVER_PROMOTED");
  });
});

describe("3. scenario persistence (append-only, T0 imutavel)", () => {
  function withStages(): { shadow: AnyRecord; observation: AnyRecord } {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 5_000 });
    const observation = observeWith(instance, { candidateId: "c_persist" });
    instance.recordStage({ candidateId: "c_persist", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "BREAKOUT" }), atMs: 20_000 });
    instance.recordStage({ candidateId: "c_persist", stage: "REVALIDATION_2", analysis: analysisFor({ primaryScenario: "BREAKOUT" }), atMs: 30_000 });
    instance.recordStage({ candidateId: "c_persist", stage: "FINAL_ENTRY", analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT", playbook: { playbookId: "PB_FAILED_BREAKOUT" } }), atMs: 40_000 });
    return { shadow: instance, observation };
  }

  it("registra CANDIDATE→R1→R2→FINAL_ENTRY com sequencia correta e change count", () => {
    const { observation } = withStages();
    expect(observation.stages.map((row: AnyRecord) => row.stage)).toEqual(["CANDIDATE", "REVALIDATION_1", "REVALIDATION_2", "FINAL_ENTRY"]);
    expect(observation.persistence.scenarioAtCandidate.scenario).toBe("TREND_PULLBACK");
    expect(observation.persistence.scenarioAtRevalidation1.scenario).toBe("BREAKOUT");
    expect(observation.persistence.scenarioAtRevalidation2.scenario).toBe("BREAKOUT");
    expect(observation.persistence.scenarioAtFinalEntry.scenario).toBe("FAILED_BREAKOUT");
    expect(observation.persistence.scenarioChanged).toBe(true);
    expect(observation.persistence.scenarioChangeCount).toBe(2);
    expect(observation.finalEntryAt).toBe(40_000);
  });

  it("mantem timelines de regime/direction/critic/quality/location/momentum e playbook@candidate vs @entry", () => {
    const { observation } = withStages();
    for (const key of ["regimeTimeline", "directionTimeline", "criticTimeline", "qualityTimeline", "locationTimeline", "momentumTimeline"]) {
      expect(Array.isArray(observation.persistence[key])).toBe(true);
      expect(observation.persistence[key]).toHaveLength(4);
    }
    expect(observation.persistence.playbookAtCandidate).toBe("PB_TREND_PULLBACK");
    expect(observation.persistence.playbookAtEntry).toBe("PB_FAILED_BREAKOUT");
    expect(observation.persistence.transitions.length).toBeGreaterThanOrEqual(3);
  });

  it("nao sobrescreve T0 nem reescreve estagios ja gravados (replace por estagio, nao append duplicado)", () => {
    const { shadow: instance, observation } = withStages();
    const t0Before = JSON.stringify(observation.t0);
    expect(Object.isFrozen(observation.t0)).toBe(true);
    instance.recordStage({ candidateId: "c_persist", stage: "FINAL_ENTRY", analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT" }), atMs: 45_000 });
    expect(JSON.stringify(observation.t0)).toBe(t0Before);
    expect(observation.stages.filter((row: AnyRecord) => row.stage === "FINAL_ENTRY")).toHaveLength(1);
    expect(observation.finalEntryAt).toBe(45_000);
  });

  it("scenario sem mudanca nao incrementa change count", () => {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 1 });
    observeWith(instance, { candidateId: "c_stable" });
    instance.recordStage({ candidateId: "c_stable", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "TREND_PULLBACK" }) });
    const observation = instance.getByCandidate("c_stable");
    expect(observation.persistence.scenarioChanged).toBe(false);
    expect(observation.persistence.scenarioChangeCount).toBe(0);
  });
});

describe("4. final revalidation acoplada ao LATE_WINDOW_V2 (cancela, nunca inverte)", () => {
  it("mudanca invalidante de cenario cancela o candidato (WAIT)", () => {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 5_000 });
    const observation = observeWith(instance, { candidateId: "c_cancel" });
    const result = instance.revalidateFinal({
      candidateId: "c_cancel", analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT", invalidationReasons: ["FAILED_BREAKOUT"] }),
      atMs: 60_000, deadlineAt: 90_000, timingPolicyVersion: "LATE_WINDOW_V2",
    });
    expect(result.cancelled).toBe(true);
    expect(result.reason).toBe("SCENARIO_INVALIDATED_AT_FINAL_REVALIDATION");
    expect(observation.finalAction).toBe("WAIT");
    expect(observation.status).toBe("CANCELLED");
    expect(observation.timingView.timingPolicyVersion).toBe("LATE_WINDOW_V2");
  });

  it("CALL invalidada nao vira PUT: direcao oposta e forcada para WAIT", () => {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 5_000 });
    const observation = observeWith(instance, { candidateId: "c_flip" });
    const result = instance.revalidateFinal({
      candidateId: "c_flip", analysis: analysisFor({ primaryScenario: "REVERSAL", action: "SELL", invalidationReasons: ["REVERSAL_RISK"] }),
      atMs: 60_000, deadlineAt: 90_000,
    });
    expect(result.directionFlipped).toBe(true);
    expect(result.directionFlipAttempted).toBe(true);
    expect(result.finalAction).toBe("WAIT");
    expect(observation.finalAction).toBe("WAIT");
    expect(observation.finalAction).not.toBe("SELL");
    expect(observation.scenarioDecision.reasonsForWait).toContain("DIRECTION_CHANGE_FORCED_WAIT_NEVER_FLIP");
  });

  it("avaliacao apos o deadline e diagnóstica e nunca decide", () => {
    const observation = observeWith(new ScenarioShadow({ now: () => 5_000 }), { candidateId: "c_after" });
    const result = evaluateFinalRevalidation({ observation, analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "SELL" }), atMs: 100_000, deadlineAt: 90_000 });
    expect(result.afterDeadline).toBe(true);
    expect(result.finalAction).toBeNull();
    expect(result.reasonsForWait).toContain("AFTER_DEADLINE_DIAGNOSTIC_ONLY");
  });
});

describe("5. SHADOW nunca controla execucao (Execution Gate intocado)", () => {
  it("politica explicita e identidade de conselho", () => {
    expect(SCENARIO_SHADOW_POLICY.execution).toBe("SHADOW_ONLY");
    expect(SCENARIO_SHADOW_POLICY.controlsExecution).toBe(false);
    expect(SCENARIO_SHADOW_POLICY.controlsDirection).toBe(false);
    expect(SCENARIO_SHADOW_POLICY.controlsStake).toBe(false);
    expect(SCENARIO_SHADOW_POLICY.controlsProductionCritic).toBe(false);
    expect(applyScenarioAdvisory("EXECUTE")).toBe("EXECUTE");
    expect(applyScenarioAdvisory("REJECT")).toBe("REJECT");
  });

  it("runScenarioShadow nunca chama o Execution Gate mesmo recebendo um spy", () => {
    let calls = 0;
    const executionGate = () => { calls += 1; throw new Error("EXECUTION_GATE_MUST_NOT_BE_CALLED"); };
    const observation = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, candidateId: "c_gate", executionGate, now: () => 1 });
    expect(calls).toBe(0);
    expect(observation.executionGateCalled).toBe(false);
  });

  it("modulo nao referencia ordem/expiracao de producao e NAO importa o timing (desacoplado)", () => {
    expect(MODULE_SOURCE).not.toMatch(/requestOrder|placeOrder|buyOption|sendOrder/);
    expect(MODULE_SOURCE).not.toMatch(/from\s+"\.\/late-window-timing\.mjs"/);
    expect(MODULE_SOURCE).not.toMatch(/sameExpirationWindow|lateDeadlineAt|TIMING_POLICY_LATE\s*=/);
  });

  it("hook de runtime e observacional: importa scenario-shadow e nunca chama requestOrder/placeOrder", () => {
    const runtimeSource = readFileSync("relay/iq-multi-runtime.mjs", "utf8");
    expect(runtimeSource).toContain('from "./scenario-shadow.mjs"');
    expect(runtimeSource).toContain("#beginScenarioShadow");
    expect(runtimeSource).toContain("this.scenarioShadow.observe");
    expect(runtimeSource).toContain("this.scenarioTimingIntersection.observe");
    // Nenhuma ordem e disparada dentro dos hooks de cenario/intersecao.
    const hookSlice = runtimeSource.slice(runtimeSource.indexOf("#beginScenarioShadow"), runtimeSource.indexOf("#finalizeCandidate"));
    expect(hookSlice).not.toMatch(/requestOrder|placeOrder|placeOption|#handleSignal/);
  });
});

describe("6. zero leakage (POST/settlement/outcome fora da classificacao T0)", () => {
  it("remove result/settlement/postWindow/futuro do T0 e da fase 1", () => {
    const dirty = snapshot({
      result: "WIN", settlementPrice: 9.99, postWindow: { close: 9.99 }, futureCandles: [{ bucketStart: 999_999 }],
      brokerResult: "WIN", theoreticalPnl: 0.82, pnl: 100, profit: 10,
    });
    const observation = runScenarioShadow({ snapshot: dirty, direction: "BUY", traderView: { action: "BUY" }, candidateId: "c_leak", candidateAt: 1_000, decisionAt: 2_000, now: () => 3_000 });
    const flat = JSON.stringify(observation.t0);
    expect(flat).not.toContain("WIN");
    expect(flat).not.toContain("postWindow");
    expect(flat).not.toContain("settlementPrice");
    expect(flat).not.toContain("futureCandles");
    expect(findForbiddenKeys(observation.t0)).toHaveLength(0);
    expect(findForbiddenKeys(buildCriticSnapshot(observation.t0))).toHaveLength(0);
    expect(observation.outcome).toBeNull();
  });

  it("detecta referencia temporal futura no T0 mas ignora alvos agendados", () => {
    const observation = runScenarioShadow({
      snapshot: snapshot({ structure: { label: "UP", at: 9_999_999 } }), direction: "BUY", traderView: { action: "BUY" },
      candidateId: "c_future", candidateAt: 1_000, decisionAt: 2_000, targetEntryAt: 61_000, targetExpiryAt: 121_000, now: () => 3_000,
    });
    expect(observation.t0Integrity.clean).toBe(false);
    expect(observation.t0Integrity.futureReferences.some((reference: string) => reference.includes("structure.at"))).toBe(true);
    expect(observation.t0Integrity.futureReferences.some((reference: string) => reference.includes("targetEntryAt"))).toBe(false);
    expect(observation.t0Integrity.futureReferences.some((reference: string) => reference.includes("targetExpiryAt"))).toBe(false);
  });

  it("outcome posterior e marcado OUTCOME e nao altera a classificacao", () => {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 5_000 });
    const observation = observeWith(instance, { candidateId: "c_outcome" });
    const classificationBefore = JSON.stringify({ critic: observation.criticFreeze.frozenHash, trader: observation.traderScenario, stages: observation.stages });
    instance.recordOutcome({ candidateId: "c_outcome", result: "LOSS", settlementBasis: "CAUSAL_COUNTERFACTUAL", payout: 82, atMs: 99_000 });
    expect(observation.outcome.result).toBe("LOSS");
    expect(observation.outcome.outcomeUsedInClassification).toBe(false);
    expect(observation.outcomeUsedInClassification).toBe(false);
    expect(JSON.stringify({ critic: observation.criticFreeze.frozenHash, trader: observation.traderScenario, stages: observation.stages })).toBe(classificationBefore);
    expect(observation.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
  });
});

describe("7. isolamento marketKey / NORMAL x OTC / determinismo", () => {
  it("mercados diferentes nao se misturam na memoria", () => {
    const instance: AnyRecord = new ScenarioShadow({ now: () => 1 });
    observeWith(instance, { marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_otc" });
    instance.observe({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candidateId: "c_normal", candidateAt: 1_000, decisionAt: 2_000, now: () => 3_000 });
    expect(instance.observationsForMarket("EURUSD:OTC")).toHaveLength(1);
    expect(instance.observationsForMarket("EURUSD:NORMAL")).toHaveLength(1);
    expect(instance.getByCandidate("c_otc").marketKey).toBe("EURUSD:OTC");
    expect(instance.getByCandidate("c_normal").marketKey).toBe("EURUSD:NORMAL");
    expect(instance.getByCandidate("c_otc").id).not.toBe(instance.getByCandidate("c_normal").id);
  });

  it("determinismo: mesma entrada -> mesma classificacao e mesmo hash congelado", () => {
    const build = () => runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, candidateId: "c_det", candidateAt: 1_000, decisionAt: 2_000, payout: 82, now: () => 3_000 });
    const first = build();
    const second = build();
    expect(JSON.stringify(first.criticScenario)).toBe(JSON.stringify(second.criticScenario));
    expect(first.criticFreeze.frozenHash).toBe(second.criticFreeze.frozenHash);
    expect(first.finalAction).toBe(second.finalAction);
    expect(JSON.stringify(FALLBACK_ENGINE.analyzeScenario({ snapshot: snapshot(), direction: "BUY" })))
      .toBe(JSON.stringify(FALLBACK_ENGINE.analyzeScenario({ snapshot: snapshot(), direction: "BUY" })));
  });
});

describe("8. ABLATION-ready (pesquisa, sem pesos aprendidos)", () => {
  it("permite desligar componentes e registra featuresUsed apenas dos ativos", () => {
    const plan = resolveAblation({ rsi: false, volatility: false, microstructure: true });
    expect(plan.disabled.sort()).toEqual(["rsi", "volatility"]);
    const built = buildScenarioFeatures(snapshot(), { direction: "BUY", ablation: plan });
    expect(built.featuresUsed).not.toContain("rsi14");
    expect(built.featuresUsed).not.toContain("atr");
    expect(built.featuresUsed).not.toContain("atrRatio");
    expect(built.featuresUsed).toContain("adx14");
    expect(built.featuresUsed).toContain("streak");
    expect(ABLATION_POLICY.researchOnly).toBe(true);
    expect(ABLATION_POLICY.productionUse).toBe(false);
    expect(ABLATION_POLICY.learnedWeights).toBe(false);
  });

  it("observacao registra a configuracao de ablation usada", () => {
    const observation = runScenarioShadow({
      snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, candidateId: "c_abl", ablation: { location: false }, now: () => 1,
    });
    expect(observation.ablation.disabled).toContain("location");
    expect(observation.ablation.policy.researchOnly).toBe(true);
    expect(observation.traderScenario.featuresUsed).not.toContain("donchianPosition");
  });
});

describe("9. migration 031 idempotente e series separadas", () => {
  it("DDL idempotente, trigger de imutabilidade e versoes separadas", () => {
    expect(MIGRATION_SQL).toContain("CREATE TABLE IF NOT EXISTS iq_scenario_shadow_observations");
    expect(MIGRATION_SQL).toContain("CREATE INDEX IF NOT EXISTS");
    expect(MIGRATION_SQL).toContain("DROP TRIGGER IF EXISTS iq_scenario_shadow_t0_immutable");
    expect(MIGRATION_SQL).toContain("t0 is immutable");
    expect(MIGRATION_SQL).toContain("critic_freeze is immutable");
    expect(MIGRATION_SQL).toContain("scenario_policy_version");
    expect(MIGRATION_SQL).toContain("SCENARIO_ENGINE_V3_SHADOW");
    expect(MIGRATION_SQL).toContain("CURRENT_G2");
    expect(MIGRATION_SQL).toContain("LATE_WINDOW_V2");
    expect(MIGRATION_SQL).toContain("scenario_at_revalidation1");
    expect(MIGRATION_SQL).toContain("playbook_at_entry");
    expect(MIGRATION_SQL).not.toContain("ALTER TABLE iq_trade_journal");
    expect(readFileSync("scripts/db-retention.mjs", "utf8")).toContain("iq_scenario_shadow_observations");
  });
});

describe("10. endpoint responde e separa BROKER_EXECUTED/COUNTERFACTUAL/HISTORICAL/PROSPECTIVE", () => {
  const rows = [
    { id: "o1", provenance: "PROSPECTIVE", settlementBasis: "BROKER_EXECUTED", payout: 82, outcome: { result: "WIN", normalizedPnl: 0.82 }, agreement: true, divergence: { divergence: "SAME" }, persistence: { scenarioChangeCount: 0 }, criticFreeze: { criticSawTraderConclusion: false } },
    { id: "o2", provenance: "PROSPECTIVE", settlementBasis: "CAUSAL_COUNTERFACTUAL", payout: 82, outcome: { result: "LOSS", normalizedPnl: -1 }, agreement: false, divergence: { divergence: "DIRECTION_OPPOSITE", investigation: true }, persistence: { scenarioChangeCount: 2, scenarioChanged: true }, status: "CANCELLED", criticFreeze: { criticSawTraderConclusion: false } },
    { id: "o3", provenance: "HISTORICAL", settlementBasis: "CAUSAL_COUNTERFACTUAL", payout: 82, outcome: { result: "WIN", normalizedPnl: 0.82 }, criticFreeze: { criticSawTraderConclusion: false } },
  ];

  it("secoes separadas, broker nunca contem contrafactual", () => {
    const dashboard = buildScenarioShadowDashboard({ observations: rows, executedTrades: [{ tradeId: "t1" }] });
    expect(Object.keys(dashboard.sections)).toEqual(["BROKER_EXECUTED", "COUNTERFACTUAL", "HISTORICAL", "PROSPECTIVE"]);
    expect(dashboard.sections.BROKER_EXECUTED.observations).toBe(1);
    expect(dashboard.sections.COUNTERFACTUAL.observations).toBe(1);
    expect(dashboard.sections.HISTORICAL.observations).toBe(1);
    expect(dashboard.sections.PROSPECTIVE.observations).toBe(2);
    expect(JSON.stringify(dashboard.sections.BROKER_EXECUTED)).not.toContain("CAUSAL_COUNTERFACTUAL");
    expect(dashboard.criticIndependence.violations).toBe(0);
    expect(dashboard.controlsExecution).toBe(false);
  });

  it("payload do endpoint e rota admin-only no server (aditivo)", () => {
    const status = scenarioShadowStatus({ observations: rows });
    expect(status.scenarioPolicyVersion).toBe(SCENARIO_ENGINE_V3_SHADOW);
    expect(status.currentPolicyVersion).toBe(CURRENT_G2);
    expect(status.separation).toContain("BROKER_EXECUTED");
    expect(SERVER_SOURCE).toMatch(/url\.pathname === '\/api\/iq\/research\/scenario-shadow' && req\.method === 'GET'\)\s*\{\s*if\(req\.headers\['x-relay-admin'\] !== admin\) return reply\(res,401/);
    expect(SERVER_SOURCE).toContain("scenarioShadowStatus()");
    expect(SERVER_SOURCE).toContain("import { scenarioShadowStatus } from './scenario-shadow.mjs'");
  });
});

describe("11. reinicio nao perde associacao + persistencia serializada", () => {
  it("toJSON/loadFrom preservam a associacao por candidateId", () => {
    const first: AnyRecord = new ScenarioShadow({ now: () => 1 });
    observeWith(first, { candidateId: "c_restart" });
    const state = first.toJSON();
    const second: AnyRecord = new ScenarioShadow({ now: () => 2 });
    expect(second.loadFrom(state)).toBe(true);
    expect(second.getByCandidate("c_restart").id).toBe("scenario_c_restart");
    const stage = second.recordStage({ candidateId: "c_restart", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "BREAKOUT" }) });
    expect(stage.stage).toBe("REVALIDATION_1");
    expect(stage.scenario).toBe("BREAKOUT");
  });

  it("assinatura assincrona recarrega do store por candidateId", async () => {
    const store = new FakeStore();
    const first: AnyRecord = new ScenarioShadow({ store, now: () => 1 });
    observeWith(first, { candidateId: "c_store" });
    const second: AnyRecord = new ScenarioShadow({ store, now: () => 2 });
    const loaded = await second.loadByCandidate("c_store");
    expect(loaded).toBeTruthy();
    expect(loaded.candidateId).toBe("c_store");
    expect(second.getByCandidate("c_store")).toBeTruthy();
  });

  it("INSERT precede UPDATE e placeholders 1:1", async () => {
    const events: string[] = [];
    let insertResolved = false;
    const pool = {
      query: async (sql: string, params: any[] = []) => {
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
        if (placeholders.length) {
          expect(Math.max(...placeholders)).toBe(params.length);
          expect(new Set(placeholders).size).toBe(params.length);
        }
        if (sql.includes("INSERT INTO iq_scenario_shadow_observations")) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          insertResolved = true; events.push("insert:resolved");
        } else if (sql.includes("UPDATE iq_scenario_shadow_observations")) {
          events.push(`update:insertResolved=${insertResolved}`);
        }
        return { rows: [] };
      },
    };
    const instance: AnyRecord = new ScenarioShadow({ pool, now: () => 1 });
    observeWith(instance, { candidateId: "c_sql" });
    instance.recordStage({ candidateId: "c_sql", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "BREAKOUT" }) });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(events).toContain("insert:resolved");
    expect(events).toContain("update:insertResolved=true");
    expect(events.indexOf("insert:resolved")).toBeLessThan(events.findIndex((event) => event.startsWith("update:")));
  });
});

describe("12. contrato congelado respeitado", () => {
  it("fallback cobre todos os simbolos do contrato e engineInfo e explicito", () => {
    for (const key of ["SCENARIO_ENGINE_VERSION", "REGIMES", "SCENARIOS", "extractContext", "classifyRegime", "classifyScenario", "evaluatePlaybook", "analyzeScenario"]) {
      expect(FALLBACK_ENGINE[key]).toBeDefined();
    }
    const analysis = FALLBACK_ENGINE.analyzeScenario({ snapshot: snapshot(), direction: "BUY" });
    for (const key of ["marketRegime", "primaryScenario", "scenarioEvidenceFor", "scenarioEvidenceAgainst", "action", "confidence", "featuresUsed", "invalidationReasons"]) {
      expect(analysis).toHaveProperty(key);
    }
    expect(SCENARIO_STAGES).toEqual(["CANDIDATE", "REVALIDATION_1", "REVALIDATION_2", "FINAL_ENTRY"]);
    const info = scenarioEngineInfo();
    expect(["SCENARIO_ENGINE", "FALLBACK"]).toContain(info.mode);
    expect(info.contract).toContain("analyzeScenario");
    expect(typeof info.fallbackActive).toBe("boolean");
    // Fail-safe EXPLICITO: modo FALLBACK sempre carrega motivo; modo real nunca se diz fallback.
    expect(info.fallbackActive).toBe(info.mode === "FALLBACK");
    if (info.mode === "FALLBACK") expect(typeof info.fallbackReason).toBe("string");
    else expect(info.fallbackReason).toBeNull();
  });

  it("extractResolutionEvidence e conservador: undefined = nao observado", () => {
    const evidence = extractResolutionEvidence({ snapshot: snapshot({ evidence: {} }), direction: "BUY" });
    expect(evidence.holdAboveLevel).toBeUndefined();
    expect(evidence.reEntry).toBeUndefined();
    expect(typeof evidence.locationOk).toBe("boolean");
  });
});

describe("13. ISOLAMENTO BIDIRECIONAL Scenario Engine x LATE_WINDOW_V2", () => {
  const BASE = Date.UTC(2026, 8, 18, 12, 0, 0);
  const TARGET_EXPIRY_AT = BASE + 120_000;

  function runTiming() {
    const instance: AnyRecord = new LateWindowTimingShadow({ now: () => BASE + 1_000 });
    const observation = instance.begin({
      marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_iso", direction: "BUY",
      candidateSnapshot: { action: "BUY", at: BASE - 5_000, price: 1.1, regime: "TREND_UP", setup: "TREND_PULLBACK", structure: { label: "UP" }, momentum: { rsi14: 55 }, freshness: { fresh: true } },
      targetEntryAt: BASE + 60_000, targetExpiryAt: TARGET_EXPIRY_AT, currentSubmitAt: BASE + 59_000, currentLeadMs: 1_000,
      productKind: "turbo", payout: 82, atMs: BASE,
    });
    instance.observe({
      marketKey: "EURUSD:OTC", candidateId: "c_iso", atMs: BASE + 2_000, serverNowMs: BASE + 2_000,
      final: { action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida", consensusStatus: "CONFIRMED" }, freshness: { fresh: true },
      latestSnapshot: { action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK" }, gateEnabled: false, price: 1.1001, candles: [], payout: 82,
    });
    instance.finalize({ candidateId: "c_iso", atMs: BASE + 88_000, serverNowMs: BASE + 88_000, reason: "DEADLINE_REACHED" });
    return { instance, observation };
  }

  function busyScenario(): void {
    const instance: AnyRecord = new ScenarioShadow({ now: () => BASE + 3_000 });
    instance.observe({
      snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, criticView: {},
      marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_iso", candidateAt: BASE, decisionAt: BASE + 1_000,
      targetEntryAt: BASE + 60_000, targetExpiryAt: TARGET_EXPIRY_AT, payout: 82,
    });
    instance.recordStage({ candidateId: "c_iso", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "BREAKOUT", action: "WAIT" }), atMs: BASE + 30_000 });
    instance.revalidateFinal({ candidateId: "c_iso", analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT" }), atMs: BASE + 55_000, deadlineAt: BASE + 60_000 });
    instance.recordOutcome({ candidateId: "c_iso", result: "LOSS", payout: 82, settlementBasis: "BROKER_EXECUTED", atMs: BASE + 130_000 });
  }

  function runScenario() {
    const instance: AnyRecord = new ScenarioShadow({ now: () => BASE + 3_000 });
    const observation = instance.observe({
      snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, criticView: {},
      marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_iso", candidateAt: BASE, decisionAt: BASE + 1_000,
      targetEntryAt: BASE + 60_000, targetExpiryAt: TARGET_EXPIRY_AT, payout: 82,
    });
    instance.recordStage({ candidateId: "c_iso", stage: "REVALIDATION_1", analysis: analysisFor({ primaryScenario: "BREAKOUT", action: "WAIT" }), atMs: BASE + 30_000, quality: { score: 80 }, location: { donchianPosition: 0.6 }, momentum: { rsi14: 55 } });
    instance.revalidateFinal({ candidateId: "c_iso", analysis: analysisFor({ primaryScenario: "FAILED_BREAKOUT", action: "WAIT" }), atMs: BASE + 55_000, deadlineAt: BASE + 60_000 });
    return { instance, observation };
  }

  const timingFingerprint = (observation: AnyRecord): string => JSON.stringify({
    outcome: observation.outcome, verdict: observation.late.verdict, deadlineAt: observation.late.deadlineAt,
    compare: observation.comparison, evaluations: observation.late.evaluations,
  });

  it("(a) desligar o Scenario Engine -> Late Window produz resultado IDENTICO", () => {
    const isolated = runTiming();
    const fingerprintBefore = timingFingerprint(isolated.observation);
    busyScenario();
    const withScenarioTraffic = runTiming();
    expect(timingFingerprint(withScenarioTraffic.observation)).toBe(fingerprintBefore);
    expect(withScenarioTraffic.observation.outcome).toBe("LATE_ACCEPT");
    // Nenhum vestigio de cenario no estado do timing.
    expect(JSON.stringify(withScenarioTraffic.observation)).not.toContain("scenario");
  });

  it("(b) desligar o Late Window -> Scenario Engine produz resultado IDENTICO", () => {
    const isolated = runScenario();
    const scenarioFingerprint = (observation: AnyRecord): string => JSON.stringify({
      finalAction: observation.finalAction, status: observation.status, stages: observation.stages,
      criticHash: observation.criticFreeze.frozenHash, trader: observation.traderScenario, divergence: observation.divergence,
    });
    const before = scenarioFingerprint(isolated.observation);
    runTiming();
    const withTimingTraffic = runScenario();
    expect(scenarioFingerprint(withTimingTraffic.observation)).toBe(before);
    expect(withTimingTraffic.observation.finalAction).toBe("WAIT");
  });

  it("modulo de cenario nao importa/conhece a politica de timing (e vice-versa)", () => {
    expect(MODULE_SOURCE).not.toMatch(/from\s+"\.\/late-window-timing\.mjs"/);
    expect(MODULE_SOURCE).not.toMatch(/sameExpirationWindow|lateDeadlineAt|adaptiveLateMarginMs/);
    const timingSource: string = readFileSync("relay/late-window-timing.mjs", "utf8");
    expect(timingSource).not.toContain("scenario-shadow");
    expect(timingSource).not.toContain("scenario-engine");
    // 031 fica intocada nesta rodada (acoplamento removido sem migracao destrutiva).
    expect(readFileSync("relay/migrations/031_scenario_shadow.sql", "utf8")).toContain("timing_policy_version");
  });
});

describe("14. FAIL-SAFE explicitamente logado/marcado (nunca silencioso)", () => {
  it("engine que lanca degrada com motivo persistido, sem derrubar a observacao", () => {
    const broken = { version: "broken-engine-v0", SCENARIO_ENGINE_VERSION: "BROKEN", analyzeScenario: () => { throw new Error("BOOM_ENGINE"); } };
    const observation = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, engine: broken, now: () => 7 });
    expect(observation.traderScenario.degradedToFallback).toBe(true);
    expect(observation.traderScenario.degradedReason).toContain("BOOM_ENGINE");
    expect(observation.engineFallback.active).toBe(true);
    expect(observation.engineFallback.explicit).toBe(true);
    expect(observation.engineFallback.reason).toContain("BOOM_ENGINE");
    expect(observation.engineInfo.degradedAnalyses.length).toBeGreaterThanOrEqual(1);
    expect(observation.scenarioEngineVersion).toBe("BROKEN");
  });

  it("observacao sem engine explicito registra o modo REAL do motor (fallback so se faltar)", () => {
    const observation = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, now: () => 7 });
    const info = scenarioEngineInfo();
    expect(observation.engineInfo.mode).toBe(info.mode);
    expect(observation.engineFallback.active).toBe(info.fallbackActive);
    expect(observation.scenarioEngineVersion).toBe(info.mode === "FALLBACK" ? observation.scenarioEngineVersion : observation.engineInfo.usedEngineVersion);
    if (info.mode === "SCENARIO_ENGINE") {
      expect(observation.engineFallback.active).toBe(false);
      expect(observation.scenarioEngineVersion).toBe(SCENARIO_ENGINE_VERSION_EXPECTED());
    }
  });

  function SCENARIO_ENGINE_VERSION_EXPECTED(): string { return SCENARIO_ENGINE_V3; }

  it("analyzeScenarioSnapshot e puro e nao persiste nada (contrato do motor)", () => {
    const analysis = analyzeScenarioSnapshot({ snapshot: snapshot(), direction: "BUY" });
    for (const key of ["marketRegime", "primaryScenario", "action", "confidence", "featuresUsed"]) expect(analysis).toHaveProperty(key);
    expect(analyzeScenarioSnapshot({ snapshot: snapshot(), direction: "BUY" })).toEqual(analysis);
  });
});

describe("15. politica de divergencia EXPERIMENTAL_V1 decomposta (sem score magico)", () => {
  it("registra as 6 checagens individualmente com valor e estado", () => {
    const divergence = resolveScenarioDivergence({
      trader: { primaryScenario: "BREAKOUT", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "FAILED_BREAKOUT", action: "WAIT", marketRegime: "TREND_UP" },
      snapshot: snapshot({ evidence: { holdAboveLevel: true, reEntry: false, rejectionWick: true } }),
    });
    expect(divergence.divergencePolicy).toBe(DIVERGENCE_POLICY_VERSION);
    expect(divergence.divergencePolicy).toBe("EXPERIMENTAL_V1");
    expect(divergence.checks).toHaveLength(6);
    for (const check of divergence.checks) {
      expect(["holdAboveLevel", "reEntry", "noRejectionWick", "momentumAligned", "ticksFresh", "locationOk"]).toContain(check.point);
      expect(["SATISFIED", "NOT_SATISFIED", "UNKNOWN"]).toContain(check.state);
      if (check.state === "UNKNOWN") expect(check.value).toBeNull(); else expect(typeof check.value).toBe("boolean");
    }
    expect(divergence.satisfiedCount).toBe(divergence.resolutionSatisfied.length);
    expect(divergence.requiredCount).toBe(4);
  });

  it("conflito Trader CALL x Critic PUT -> WAIT/CONFLICT_UNRESOLVED ate evidencia suficiente", () => {
    const unresolved = resolveScenarioDivergence({
      trader: { primaryScenario: "TREND_PULLBACK", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "REVERSAL", action: "SELL", marketRegime: "TREND_DOWN" },
      snapshot: snapshot(),
    });
    expect(unresolved.divergence).toBe("DIRECTION_OPPOSITE");
    expect(unresolved.conflict).toBe("CONFLICT_UNRESOLVED");
    expect(unresolved.finalAction).toBe("WAIT");
    expect(unresolved.reasonsForWait).toContain("CONFLICT_UNRESOLVED");
    expect(unresolved.criticDirectionAdopted).toBe(false);
    expect(unresolved.adoptedDirection).toBeNull();
    expect(unresolved.finalAction).not.toBe("SELL");
  });

  it("Critic NUNCA adota direcao: mesmo resolvido, direcao final e a do Trader ou WAIT", () => {
    const resolved = resolveScenarioDivergence({
      trader: { primaryScenario: "TREND_PULLBACK", action: "BUY", marketRegime: "TREND_UP" },
      critic: { primaryScenario: "REVERSAL", action: "SELL", marketRegime: "TREND_UP" },
      snapshot: snapshot({ evidence: { holdAboveLevel: true, reEntry: true, rejectionWick: false, ticksFresh: true } }),
    });
    expect(resolved.finalAction).toBe("BUY");
    expect(resolved.adoptedDirection).toBeNull();
    expect(resolved.criticDirectionAdopted).toBe(false);
    expect(resolved.conflict).toBe("RESOLVED_TRADER_DIRECTION_ONLY");
    const dashboard = buildScenarioShadowDashboard({ observations: [{ provenance: "PROSPECTIVE", divergence: { divergence: "DIRECTION_OPPOSITE", criticDirectionAdopted: true } }] });
    expect(dashboard.criticIndependence.criticDirectionAdopted).toBe(1);
  });
});

describe("16. versionamento persistido e series independentes", () => {
  it("persiste scenarioEngineVersion e timingPolicyVersion independentes", () => {
    const late = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, timingView: { timingPolicyVersion: "LATE_WINDOW_V2", deadlineAt: 90_000 }, candidateId: "c_v_late", now: () => 1 });
    const current = runScenarioShadow({ snapshot: snapshot(), direction: "BUY", traderView: { action: "BUY" }, timingView: { timingPolicyVersion: "CURRENT_V1", deadlineAt: 60_000 }, candidateId: "c_v_cur", now: () => 1 });
    expect(late.scenarioPolicyVersion).toBe(SCENARIO_ENGINE_V3_SHADOW);
    expect(late.scenarioEngineVersion).toBe(SCENARIO_ENGINE_V3);
    expect(late.timingView.timingPolicyVersion).toBe("LATE_WINDOW_V2");
    expect(current.timingView.timingPolicyVersion).toBe("CURRENT_V1");
    expect(late.seriesKey).not.toBe(current.seriesKey);
    expect(late.seriesKey).toContain(SCENARIO_ENGINE_V3);
    expect(late.seriesKey).toContain("LATE_WINDOW_V2");
    expect(current.seriesKey).toContain("CURRENT_V1");
    // Quatro series futuras comparaveis sem misturar amostras.
    const status = scenarioShadowStatus({ observations: [late, current] });
    expect(status.series.counts[late.seriesKey]).toBe(1);
    expect(status.series.counts[current.seriesKey]).toBe(1);
    expect(status.timingCoupling).toBe("NONE");
    expect(status.divergencePolicy).toBe("EXPERIMENTAL_V1");
    expect(status.scenarioEngineVersion).toBe(SCENARIO_ENGINE_V3);
  });

  it("migration 032 aditiva com coluna de versao e tabela de intersecao; retencao cobre a tabela", () => {
    const migration = readFileSync("relay/migrations/032_scenario_timing_intersection.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS scenario_engine_version");
    expect(migration).toContain("iq_scenario_timing_intersections");
    expect(migration).toContain("DROP TRIGGER IF EXISTS iq_scenario_shadow_engine_immutable");
    expect(migration).toContain("is immutable");
    const retention = readFileSync("scripts/db-retention.mjs", "utf8");
    expect(retention).toContain("iq_scenario_timing_intersections");
  });

  it("buildTimingView e opaco: nao deriva deadline nem depende de politica", () => {
    const view = buildTimingView({ timingPolicyVersion: "CUSTOM_X", deadlineAt: 123 });
    expect(view.timingPolicyVersion).toBe("CUSTOM_X");
    expect(view.deadlineAt).toBe(123);
    expect(view.controlsExecution).toBe(false);
    expect(buildTimingView({}).timingPolicyVersion).toBeNull();
  });
});

describe("17. intersecao observacional separada (somente leitura)", () => {
  const scenarioState = () => ({
    id: "scenario_c_int", candidateId: "c_int", correlationId: "corr_1", marketKey: "EURUSD:OTC", marketType: "OTC",
    scenarioPolicyVersion: SCENARIO_ENGINE_V3_SHADOW, scenarioEngineVersion: SCENARIO_ENGINE_V3,
    stages: [{ stage: "CANDIDATE", at: 1_000, scenario: "BREAKOUT", action: "BUY", regime: "TREND_UP", playbook: "PB_BREAKOUT" }],
    persistence: { scenarioChanged: true, scenarioChangeCount: 1 },
    finalAction: "BUY", status: "CLASSIFIED", divergence: { divergence: "SAME" },
  });
  const timingState = () => ({
    id: "timing_c_int", candidateId: "c_int", marketKey: "EURUSD:OTC", marketType: "OTC", windowKey: "EURUSD:OTC:120000",
    direction: "BUY", outcome: "LATE_CANCEL", outcomeReason: "CANDIDATE_LOGIC_CHANGED_TO_WAIT",
    policyVersion: "LATE_WINDOW_V2", targetExpiryAt: 120_000,
    policy: { sameExpirationAtDeadline: true },
    late: { deadlineAt: 90_000, verdict: "CANCEL_CANDIDATE_LOGIC_CHANGED_TO_WAIT", evaluations: [{ at: 80_000, action: "WAIT", valid: false }, { at: 89_000, action: "WAIT", valid: false }], lastBeforeDeadline: { at: 89_000, action: "WAIT", valid: false } },
    comparison: { keptSameExpiration: true },
  });

  it("buildIntersection decompoe cenario@candidate vs cenario@deadline vs LATE_CANCEL", () => {
    const scenario = scenarioState();
    const timing = timingState();
    const before = JSON.stringify({ scenario, timing });
    const row = buildIntersection({ scenario, timing, atMs: 91_000 });
    expect(row.verdict).toBe("SCENARIO_ENTRY_LATE_CANCEL");
    expect(row.intersectionCodes).toContain("SCENARIO_AT_CANDIDATE");
    expect(row.intersectionCodes).toContain("LATE_CANCEL");
    expect(row.intersectionCodes).toContain("SCENARIO_FINAL_ENTRY");
    expect(row.scenarioAtCandidate.scenario).toBe("BREAKOUT");
    expect(row.scenarioFinalAction).toBe("BUY");
    expect(row.lateOutcome).toBe("LATE_CANCEL");
    expect(row.mutatedInputs).toBe(false);
    expect(JSON.stringify({ scenario, timing })).toBe(before);
    expect(row.controlsExecution).toBe(false);
  });

  it("scenarioPointAt usa apenas stages com at <= deadline (nunca inventa estado)", () => {
    const stages = [{ stage: "CANDIDATE", at: 1_000, scenario: "A", action: "BUY" }, { stage: "REVALIDATION_1", at: 50_000, scenario: "B", action: "WAIT" }, { stage: "FINAL_ENTRY", at: 95_000, scenario: "C", action: "BUY" }];
    expect(scenarioPointAt(stages, 60_000).scenario).toBe("B");
    expect(scenarioPointAt(stages, 90_000).scenario).toBe("B");
    expect(scenarioPointAt(stages, null).scenario).toBe("C");
    expect(scenarioPointAt([], 10)).toBeNull();
  });

  it("classe registra intersecoes sem tocar nos dois estados e respeita enable/disable", () => {
    const disabled: AnyRecord = new ScenarioTimingIntersectionShadow({ enabled: false });
    expect(disabled.observe({ scenarioObservation: scenarioState(), timingObservation: timingState() })).toBeNull();
    expect(disabled.list()).toHaveLength(0);
    const instance: AnyRecord = new ScenarioTimingIntersectionShadow({ now: () => 91_000 });
    const row = instance.observe({ scenarioObservation: scenarioState(), timingObservation: timingState() });
    expect(row.id).toContain("c_int");
    expect(instance.getByCandidate("c_int").verdict).toBe("SCENARIO_ENTRY_LATE_CANCEL");
    const summary = instance.summary();
    expect(summary.isolation.mutatesNeither).toBe(true);
    expect(summary.isolation.scenarioControlsTiming).toBe(false);
    expect(summary.isolation.timingControlsScenario).toBe(false);
    expect(summary.byVerdict.SCENARIO_ENTRY_LATE_CANCEL).toBe(1);
    expect(SCENARIO_TIMING_INTERSECTION_POLICY.mutatesNeither).toBe(true);
    // reinicio nao perde associacao
    const restarted: AnyRecord = new ScenarioTimingIntersectionShadow({ now: () => 2 });
    expect(restarted.loadFrom(instance.toJSON())).toBe(true);
    expect(restarted.getByCandidate("c_int").id).toBe(row.id);
  });
});

describe("18. hook de runtime observacional (nunca executa)", () => {
  const BASE = Date.UTC(2026, 8, 18, 12, 0, 20);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function brain(action: string): AnyRecord {
    const trader = {
      agent: "TRADER", action, setup: action === "WAIT" ? "NO_VALID_SETUP" : "TREND_PULLBACK", trigger: action === "WAIT" ? null : "pullback_com_estrutura_mantida",
      analysisConfidence: action === "WAIT" ? 0 : 0.62, waitReason: action === "WAIT" ? "SEM_SETUP_VALIDO" : null,
      structure: { label: "HH_HL", candleShape: { bodyRatio: 0.7, upperWick: 0.1, lowerWick: 0.2 }, velocity: { velocity: 0.0002, acceleration: 0.00001 } },
      location: { zone: "MEIO_CANAL", donchianPosition: 0.6, distanceToUpperATR: 1.2, distanceToLowerATR: 1.1, channelHigh: 1.2, channelLow: 1.0 },
      momentum: { rsi14: 58, velocity: 0.0002, acceleration: 0.001 }, strength: { adx14: 27, diSpread: 12, plusDI: 20, minusDI: 8 },
      volatility: { atrRatio: 0.0012, atr: 0.0002 }, microstructure: { streak: 2, bodyRatio: 0.7 },
      processLog: [], supportingEvidence: [], contradictingEvidence: [], primaryRisk: null, latencyMs: 1,
    };
    const critic = { agent: "CRITIC", traderAssessment: action === "WAIT" ? "WAIT" : "CONFIRM", independentAction: action, contradictions: [], riskFlags: [], finalRecommendation: action, latencyMs: 1 };
    const consensus = { action, status: action === "WAIT" ? "WAIT" : "CONFIRMED", reason: action === "WAIT" ? "TRADER_WAIT" : "TRADER_E_CRITIC_ALINHADOS", rules: [], analysisConfidence: action === "WAIT" ? 0 : 0.62, estimatedWinProbability: null, latencyMs: 1 };
    return { trader, critic, consensus, regime: "TREND_UP" };
  }

  function fixture() {
    const clock = { nowMs: BASE };
    const overrides = new Map<string, () => AnyRecord>();
    const runtime: AnyRecord = new IqMultiRuntime({
      pool: null, getSsid: () => null, now: () => clock.nowMs, log: () => {}, ackTimeoutMs: 150,
      decisionOverride: ({ marketKey }: AnyRecord) => { const override = overrides.get(marketKey); return override ? override() : brain("WAIT"); },
    });
    runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-scn", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true, connectedAt: clock.nowMs };
    runtime.connection = { connectionId: "conn-scn", host: "ws.iqoption.com", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true };
    runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: clock.nowMs, type: "PRACTICE" };
    runtime.config.autoExecute = true; runtime.config.globalMaxStake = 100; runtime.config.calculatedBankrollStake = 1; runtime.config.qualityGateEnabled = true; runtime.config.minTradeQualityScore = 75;
    runtime.__sent = [];
    runtime.client = { serverNow: () => clock.nowMs, placeOrder: (options: AnyRecord) => { runtime.__sent.push(options); return options.requestId; }, getOptions: async () => ({ response: { msg: { closed_options: [] } } }) };
    const ctx = runtime.markets.get("EURUSD:OTC");
    ctx.availability = "OPEN"; ctx.activeId = 76; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 100; ctx.instrumentTypes = ["binary", "turbo"];
    let bucket = Math.floor((clock.nowMs - 40 * 5_000) / 5_000) * 5_000;
    const ingest = (bucketStart: number, close: number) => { runtime.ingestEvent("candle-generated", { connectionId: "conn-scn", receivedAt: clock.nowMs, msg: { active_id: 76, size: 5, from: Math.floor(bucketStart / 1000), to: Math.floor(bucketStart / 1000) + 5, open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close } }); bucket = bucketStart; };
    for (let index = 0; index < 40; index += 1) ingest(bucket + 5_000, 1.1 + index * 0.00001);
    const step = ({ advanceMs = 5_000, close = null }: AnyRecord = {}) => {
      clock.nowMs += advanceMs;
      const aligned = Math.floor(clock.nowMs / 5_000) * 5_000 - 5_000;
      ingest(Math.max(bucket + 5_000, aligned), close ?? Number(ctx.lastCandle?.close ?? 1.1));
    };
    return { runtime, clock, overrides, ctx, step };
  }

  it("cria observacao de cenario + intersecao no candidato, sem enviar ordem", async () => {
    const { runtime, ctx, overrides, step } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(20);
    expect(ctx.candidate).toBeTruthy();
    const candidateId = ctx.candidate.id;
    const observation = runtime.scenarioShadow.getByCandidate(candidateId);
    expect(observation).toBeTruthy();
    expect(observation.criticFreeze.criticSawTraderConclusion).toBe(false);
    expect(observation.scenarioDecision.adoptedDirection).toBeNull();
    expect(observation.engineFallback.explicit).toBe(true);
    expect(runtime.timingShadow.getByCandidate(candidateId)).toBeTruthy();
    const intersectionRow = runtime.scenarioTimingIntersection.getByCandidate(candidateId);
    expect(intersectionRow).toBeTruthy();
    expect(intersectionRow.mutatedInputs).toBe(false);
    expect(intersectionRow.controlsExecution).toBe(false);
    expect(runtime.__sent).toHaveLength(0);
    const status = runtime.scenarioShadowStatus();
    expect(status.controlsExecution).toBe(false);
    expect(status.enabled).toBe(true);
    expect(status.intersections.isolation.mutatesNeither).toBe(true);
    expect(status.scenarioEngineVersion).toBe(SCENARIO_ENGINE_V3);
    runtime.stop("END");
  });

  it("enable/disable independentes: cenario desligado nao altera timing/intersecao habilitada", async () => {
    const { runtime, ctx, overrides, step } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(20);
    const candidateId = ctx.candidate.id;
    const timingBefore = JSON.stringify(runtime.timingShadow.getByCandidate(candidateId));
    expect(runtime.setScenarioShadowEnabled(false).enabled).toBe(false);
    step();
    await sleep(10);
    expect(runtime.scenarioShadow.enabled).toBe(false);
    // Timing continua identico ao estado anterior + novas avaliacoes (nunca afetado).
    const timingAfter = runtime.timingShadow.getByCandidate(candidateId);
    expect(timingAfter).toBeTruthy();
    expect(timingAfter.outcome === "OBSERVING" || timingAfter.outcome === "LATE_ACCEPT" || timingAfter.outcome === "LATE_CANCEL").toBe(true);
    expect(JSON.parse(timingBefore).direction).toBe(timingAfter.direction);
    // Intersecao desligada tambem e independente.
    const countBefore = runtime.scenarioTimingIntersection.list().length;
    runtime.setScenarioTimingIntersectionEnabled(false);
    step();
    await sleep(10);
    expect(runtime.scenarioTimingIntersection.list().length).toBe(countBefore);
    expect(runtime.__sent).toHaveLength(0);
    runtime.stop("END");
  });
});
