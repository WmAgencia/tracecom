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
const {
  runScenarioShadow, ScenarioShadow, runCriticPhase1, buildCriticSnapshot, buildScenarioFeatures,
  resolveAblation, resolveScenarioDivergence, evaluateFinalRevalidation, extractResolutionEvidence,
  findForbiddenKeys, buildScenarioShadowDashboard, scenarioShadowStatus, scenarioEngineInfo,
  applyScenarioAdvisory, playbookOf, FALLBACK_ENGINE, SCENARIO_SHADOW_POLICY, ABLATION_POLICY,
  SCENARIO_ENGINE_V3_SHADOW, CURRENT_G2, SCENARIO_STAGES, RESOLUTION_POINTS,
} = shadow as unknown as Record<string, any>;

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
    expect(observation.lateWindow.timingPolicyVersion).toBe("LATE_WINDOW_V2");
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

  it("modulo nao referencia ordem/expiracao de producao", () => {
    expect(MODULE_SOURCE).not.toMatch(/requestOrder|placeOrder|buyOption|sendOrder/);
    const runtimeSource = readFileSync("relay/iq-multi-runtime.mjs", "utf8");
    expect(runtimeSource).not.toContain("scenario-shadow");
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
    for (const key of ["REGIMES", "SCENARIOS", "extractContext", "classifyRegime", "classifyScenario", "evaluatePlaybook", "analyzeScenario"]) {
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
  });

  it("extractResolutionEvidence e conservador: undefined = nao observado", () => {
    const evidence = extractResolutionEvidence({ snapshot: snapshot({ evidence: {} }), direction: "BUY" });
    expect(evidence.holdAboveLevel).toBeUndefined();
    expect(evidence.reEntry).toBeUndefined();
    expect(typeof evidence.locationOk).toBe("boolean");
  });
});
