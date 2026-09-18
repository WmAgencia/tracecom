/**
 * PROSPECTIVE SHADOW LAB — testes anti-leakage, isolamento e politica SHADOW.
 *
 * Estes testes provam, no nivel do modulo puro + artefatos de runtime:
 *  1. T0 nunca contem dado futuro/resultado;  2. POST nunca entra em decisao;
 *  3. MANUAL_UI nunca vira G2_AUTO;  4. SHADOW nunca controla Execution Gate;
 *  5. correctedGateShadow nunca controla producao;  6. isolamento marketKey;
 *  7. isolamento NORMAL/OTC;  8. contrafactual nunca entra no PnL do broker;
 *  9. settlement executado e shadow nao se misturam;  10. reinicio preserva associacao;
 *  11. leakage de candle futuro e detectado.
 *
 * Nenhuma regra de decisao e alterada por estes testes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const lab = await import("../../relay/shadow-lab.mjs");
const {
  buildT0Snapshot, findFutureReferences, buildPostWindow, extractPreWindow,
  decisionSourceOf, parseMarketKey, observationKey, classifyLocation, classifyEntryLocation,
  directionAdjustedDisplacement, buildDisplacementShadow, classifyDisplacementBucket,
  classifyContradictionSeverity, criticCodeSeverity, correctedFeaturesFromSnapshot,
  scoreGateCorrectedShadow, compareGateVersions, correctedStabilityShadow,
  degradationInputsFromSnapshot, observeDegradation, buildCounterfactualShadow,
  buildShadowLabDashboard, summarizeRows, normalizedOutcomePnl, applyShadowAdvisory,
  ShadowLab, SHADOW_POLICY, SHADOW_FILTERS_V1, GATE_CORRECTED_SHADOW,
  PROSPECTIVE_CHECKPOINT_N, POST_WINDOW_OFFSETS_SECONDS,
} = lab as unknown as Record<string, any>;

type AnyRecord = Record<string, any>;

const RUNTIME_SOURCE: string = readFileSync("relay/iq-multi-runtime.mjs", "utf8");
const MIGRATION_SQL: string = readFileSync("relay/migrations/029_prospective_shadow_lab.sql", "utf8");

function candidateSnapshot(overrides: AnyRecord = {}): AnyRecord {
  return {
    action: "BUY", price: 1.1, regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida",
    structure: { label: "UP", at: 900 }, momentum: { rsi14: 55, velocity: 0.0002, acceleration: 0.00001 },
    strength: { adx14: 25, plusDI: 22, minusDI: 18, diSpread: 4 },
    volatility: { atr: 0.001, atrRatio: 1.1 }, microstructure: { streak: 1, bodyRatio: 0.6, upperWick: 0.2, lowerWick: 0.2 },
    location: { donchianPosition: 0.6, distanceToUpperATR: 0.8, distanceToLowerATR: 1.4, channelHigh: 1.12, channelLow: 1.05, zone: "UPPER_HALF" },
    critic: { verdict: "CONFIRM", independentAction: "BUY", contradictions: [], riskFlags: [] },
    consensus: { status: "CONFIRMED", action: "BUY" }, knowledgeContextIds: ["kb_1"],
    freshness: { fresh: true, tickAgeMs: 120 },
    ...overrides,
  };
}

class FakeStore {
  rows = new Map<string, AnyRecord>();
  windows: AnyRecord[] = [];
  updates: AnyRecord[] = [];
  async save(observation: AnyRecord) { this.rows.set(observation.id, JSON.parse(JSON.stringify(observation))); }
  async update({ observationId, candidateId, patch }: AnyRecord) {
    this.updates.push({ observationId, candidateId, patch });
    const key = observationId ?? candidateId;
    const row = this.rows.get(key);
    if (row) Object.assign(row, patch);
    return true;
  }
  async getById(id: string) {
    for (const row of this.rows.values()) if (row.id === id || row.candidateId === id || row.executionId === id) return JSON.parse(JSON.stringify(row));
    return null;
  }
  async saveWindow(observation: AnyRecord, kind: string, rows: AnyRecord[]) { this.windows.push({ id: observation.id, kind, rows: rows.length }); }
}

function observeWith(labInstance: AnyRecord, overrides: AnyRecord = {}): AnyRecord {
  return labInstance.observeCandidate({
    marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76, candidateId: "cand_otc_1", decisionSource: "G2_AUTO",
    candidateAt: 900_000, decisionAt: 990_000, jitAt: 991_000, sendAt: 992_000, targetEntryAt: 1_000_000, targetExpiryAt: 1_060_000,
    payout: 82, candidateSnapshot: candidateSnapshot(), jitSnapshot: candidateSnapshot({ price: 1.101 }),
    candidatePrice: 1.1, jitPrice: 1.101, actualEntryPrice: 1.101, direction: "BUY", atr: 0.001,
    quality: { score: 88, checks: [{ id: "accel_agrees", ok: false, points: 0, max: 8 }] }, threshold: 75,
    gateAccepted: true, currentExecution: "PENDING",
    candles: [{ bucketStart: 895_000, open: 1.1, high: 1.1, low: 1.09, close: 1.1 }],
    ...overrides,
  });
}

describe("1. snapshot T0 imutavel e point-in-time (D4)", () => {
  it("whitelist elimina resultado/futuro e mantem os campos exigidos", () => {
    const t0: AnyRecord = buildT0Snapshot({
      marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76, direction: "BUY",
      candidateAt: 1000, decisionAt: 2000, jitAt: 2900, sendAt: 3000, targetEntryAt: 4000, targetExpiryAt: 5000, payout: 82,
      snapshot: {
        regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback", result: "WIN", settlementPrice: 9.99,
        postWindow: { close: 9.99 }, futureCandles: [{ bucketStart: 99999 }],
        structure: { label: "UP", at: 1500 }, location: { donchianPosition: 0.6 },
        momentum: { rsi14: 55 }, strength: { adx14: 25 }, volatility: { atr: 0.001 }, microstructure: { streak: 1 },
        critic: { verdict: "CONFIRM", contradictions: [], riskFlags: [] }, consensus: { status: "CONFIRMED" },
        knowledgeContextIds: ["kb_1"], freshness: { fresh: true, tickAgeMs: 120 },
      },
      quality: { score: 88, checks: [{ id: "regime_ok", ok: true }] },
      location: { tag: "LOCATION_UPPER_HALF" }, displacement: { candidateToEntryATR: 0.2 }, revalidation: { ok: true, checks: [] },
    });
    const flat = JSON.stringify(t0);
    expect(flat).not.toContain("WIN");
    expect(flat).not.toContain("postWindow");
    expect(flat).not.toContain("settlementPrice");
    expect(flat).not.toContain("futureCandles");
    for (const key of ["candidateAt", "decisionAt", "jitAt", "sendAt", "marketKey", "regime", "setup", "structure", "location", "momentum", "strength", "volatility", "microstructure", "critic", "consensus", "qualityScore", "qualityChecks", "entryLocation", "displacement", "jitRevalidation", "freshness", "payout"]) {
      expect(key in t0, key).toBe(true);
    }
    expect(Object.isFrozen(t0)).toBe(true);
  });

  it("detector acusa referencia temporal futura remanescente (candle futuro)", () => {
    const t0 = buildT0Snapshot({ marketKey: "EURUSD:OTC", decisionAt: 2000, snapshot: { structure: { label: "UP", bucketStart: 9000 } } });
    const violations = findFutureReferences(t0, 2000);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("bucketStart");
    expect(findFutureReferences(t0, 10_000)).toHaveLength(0);
  });

  it("PRE window so inclui candles anteriores ao ponto de decisao", () => {
    const pre = extractPreWindow([
      { bucketStart: 1000, close: 1 }, { bucketStart: 2000, close: 2 }, { bucketStart: 3000, close: 3 },
    ], 2000, 5);
    expect(pre.map((row: AnyRecord) => row.bucketStart)).toEqual([1000, 2000]);
  });
});

describe("2. janela POST e diagnostic_only e nunca realimenta T0 (D5)", () => {
  it("flags obrigatorias e offsets com tolerancia", () => {
    const post = buildPostWindow({
      entryAtMs: 1_000_000, expiryAtMs: 1_060_000,
      candles: [
        { bucketStart: 1_005_000, open: 1, high: 1.1, low: 0.9, close: 1.05 },
        { bucketStart: 1_060_000, open: 1.05, high: 1.1, low: 1.04, close: 1.08 },
      ],
    });
    expect(post.diagnosticOnly).toBe(true);
    expect(post.feedableToT0).toBe(false);
    expect(post.usedInDecision).toBe(false);
    expect(post.offsets.map((row: AnyRecord) => row.targetSeconds)).toEqual([5, 60]);
    expect(post.expiryCandle).toBeNull();
    expect(post.offsets.every((row: AnyRecord) => row.offsetSeconds <= row.targetSeconds + post.toleranceSeconds)).toBe(true);
    expect(new Set(post.offsets.map((row: AnyRecord) => row.bucketStart)).size).toBe(post.offsets.length);
  });

  it("injetar a janela POST no snapshot NAO muda o score do gate", () => {
    const snapshot = candidateSnapshot();
    const before = scoreGateCorrectedShadow(snapshot, { direction: "BUY", payout: 82, timing: {} }).score;
    const post = buildPostWindow({ entryAtMs: 1_000_000, expiryAtMs: 1_060_000, candles: [{ bucketStart: 1_005_000, close: 9.99 }] });
    const after = scoreGateCorrectedShadow({ ...snapshot, postWindow: post }, { direction: "BUY", payout: 82, timing: {} }).score;
    expect(after).toBe(before);
    expect(POST_WINDOW_OFFSETS_SECONDS).toEqual([5, 10, 15, 20, 30, 45, 60]);
  });
});

describe("3. MANUAL_UI nunca e contabilizado como G2_AUTO (D3)", () => {
  it("mapeia origens e isola G2 no dashboard", () => {
    expect(decisionSourceOf({ source: "AUTO_DECISION" })).toBe("G2_AUTO");
    expect(decisionSourceOf({ source: "ui:smoke" })).toBe("MANUAL_UI");
    expect(decisionSourceOf({ source: "MANUAL" })).toBe("MANUAL_UI");
    expect(decisionSourceOf({ source: "DIAGNOSTIC_SIGNAL" })).toBe("TEST");
    expect(decisionSourceOf({ infraProbe: true, source: "AUTO_DECISION" })).toBe("INFRA_PROBE");
    expect(decisionSourceOf({ source: "origem-desconhecida" })).toBe("MANUAL_UI");
    const dashboard = buildShadowLabDashboard({
      executedTrades: [
        { tradeId: "manual", result: "LOSS", stake: 1, payout: 88, decisionSource: "MANUAL_UI" },
        { tradeId: "auto", result: "WIN", stake: 10, payout: 82, pnl: 8.2, decisionSource: "G2_AUTO" },
      ],
    });
    expect(dashboard.sections.BROKER_EXECUTED.summary.n).toBe(2);
    expect(dashboard.sections.BROKER_EXECUTED.byDecisionSource.G2_AUTO.n).toBe(1);
    expect(dashboard.sections.BROKER_EXECUTED.byDecisionSource.MANUAL_UI.n).toBe(1);
    expect(dashboard.arms.CURRENT_G2.n).toBe(1);
  });

  it("runtime: decisionSnapshot usa a decisao do Brain e persiste a direcao manual separada", () => {
    expect(RUNTIME_SOURCE).not.toContain('action: pending.direction === "CALL" ? "BUY"');
    expect(RUNTIME_SOURCE).toContain("manualRequestedDirection");
    expect(RUNTIME_SOURCE).toContain("brainDecision");
    expect(RUNTIME_SOURCE).toContain("decisionSourceOf({ source: pending.source");
    expect(readFileSync("relay/professor.mjs", "utf8")).toContain("decision_source");
  });
});

describe("4. SHADOW nunca controla o Execution Gate", () => {
  it("politica explicita e identidade de conselho", () => {
    expect(SHADOW_POLICY.controlsExecution).toBe(false);
    expect(SHADOW_POLICY.controlsDirection).toBe(false);
    expect(SHADOW_POLICY.controlsStake).toBe(false);
    expect(applyShadowAdvisory("EXECUTE")).toBe("EXECUTE");
    expect(applyShadowAdvisory("REJECT")).toBe("REJECT");
  });

  it("filtros contrafactuais retornam todos true sem tocar na execucao corrente", () => {
    const counterfactual = buildCounterfactualShadow({
      location: { entry: { tag: "LOCATION_MID" } }, displacement: { candidateToEntryATR: 0.9 },
      critic: { wouldVetoIfHardContradiction: true }, degradation: { state: "SEVERELY_DEGRADED" },
      gateComparison: { correctedShadowScore: 100 }, threshold: 75,
    });
    expect(counterfactual.locationFilterWouldReject).toBe(true);
    expect(counterfactual.displacementFilterWouldReject).toBe(true);
    expect(counterfactual.hardCriticWouldReject).toBe(true);
    expect(counterfactual.degradationFilterWouldReject).toBe(true);
    expect(counterfactual.correctedGateWouldAccept).toBe(true);
    expect(counterfactual.controlPolicy).toBe("SHADOW_ONLY_NEVER_CONTROLS_EXECUTION");
    expect(applyShadowAdvisory("EXECUTE")).toBe("EXECUTE");
  });

  it("runtime: ordem dos checks do gate intacta e nenhum veredito shadow em condicao de execucao", () => {
    const start = RUNTIME_SOURCE.indexOf("async #finalizeEntry");
    const end = RUNTIME_SOURCE.indexOf("  #candidateSnapshot(ctx");
    const segment = RUNTIME_SOURCE.slice(start, end);
    expect(segment.indexOf("if (!location.ok)")).toBeGreaterThan(-1);
    expect(segment.indexOf("if (!location.ok)")).toBeLessThan(segment.indexOf("if (microVeto.veto)"));
    expect(segment.indexOf("if (microVeto.veto)")).toBeLessThan(segment.indexOf("quality.score < this.#minTradeQualityScore()"));
    expect(/if\s*\(\s*(?:counterfactual|correctedShadow|degradationObserverState|h3Critic)/.test(segment)).toBe(false);
  });
});

describe("5. correctedGateShadow nunca controla producao (D1/D2 em sombra)", () => {
  it("politica e comparacao lado a lado", () => {
    expect(SHADOW_POLICY.gatePolicies[GATE_CORRECTED_SHADOW]).toBe("SHADOW_ONLY");
    const comparison = compareGateVersions({
      current: { score: 88, checks: [{ id: "accel_agrees", ok: false, points: 0, max: 8 }] },
      corrected: { score: 96, checks: [{ id: "accel_agrees", ok: true, points: 8, max: 8 }] },
      threshold: 75,
    });
    expect(comparison.currentScore).toBe(88);
    expect(comparison.correctedShadowScore).toBe(96);
    expect(comparison.scoreDelta).toBe(8);
    expect(comparison.currentDecision).toBe("ACCEPT");
    expect(comparison.correctedShadowDecision).toBe("ACCEPT");
    expect(comparison.changedChecks.map((row: AnyRecord) => row.id)).toEqual(["accel_agrees"]);
    expect(comparison.controlPolicy).toBe("GATE_CORRECTED_SHADOW_NEVER_CONTROLS_EXECUTION");
  });

  it("feature corrigida le momentum (D1) e knowledge; producao intacta", () => {
    const snapshot = candidateSnapshot();
    const corrected = correctedFeaturesFromSnapshot(snapshot, { direction: "BUY", payout: 82, timing: {} });
    expect(corrected.acceleration).toBe(0.00001);
    expect(corrected.velocity).toBe(0.0002);
    expect(corrected.knowledgeContextIds).toEqual(["kb_1"]);
    expect(scoreGateCorrectedShadow(snapshot, { direction: "BUY", payout: 82, timing: {} }).score)
      .toBeGreaterThanOrEqual(scoreGateCorrectedShadow(candidateSnapshot({ momentum: { rsi14: 55 } }), { direction: "BUY", payout: 82, timing: {} }).score);
  });

  it("C_STABILITY corrigido ignora mudanca apenas de preco (D2)", () => {
    const before = candidateSnapshot();
    const afterPriceOnly = candidateSnapshot({ price: 1.2, location: { ...before.location, donchianPosition: 0.61 } });
    expect(correctedStabilityShadow({ candidateSnapshot: before, jitSnapshot: afterPriceOnly, directionChanges: 0 }).decision).toBe("ACCEPT");
    const afterStructure = candidateSnapshot({ structure: { label: "DOWN", at: 990 } });
    expect(correctedStabilityShadow({ candidateSnapshot: before, jitSnapshot: afterStructure, directionChanges: 0 }).decision).toBe("ABSTAIN");
  });

  it("runtime: bloco do gate de producao nao referencia corrected", () => {
    const start = RUNTIME_SOURCE.indexOf("if (this.config.qualityGateEnabled === true) {");
    const end = RUNTIME_SOURCE.indexOf("const entryTiming = {");
    const block = RUNTIME_SOURCE.slice(start, end);
    expect(block).not.toMatch(/corrected/i);
    const locationReject = block.indexOf("if (!location.ok)");
    expect(block.indexOf("this.shadowLab.markExecution", locationReject)).toBeGreaterThan(locationReject);
    expect(block.indexOf("this.#cancelCandidate", locationReject)).toBeGreaterThan(block.indexOf("this.shadowLab.markExecution", locationReject));
  });
});

describe("6/7. isolamento marketKey e NORMAL/OTC", () => {
  it("parse e chaves de observacao preservam canonical+tipo", () => {
    expect(parseMarketKey("EURUSD:OTC")).toMatchObject({ canonical: "EURUSD", marketType: "OTC", valid: true });
    expect(parseMarketKey("EURUSD:NORMAL")).toMatchObject({ canonical: "EURUSD", marketType: "NORMAL", valid: true });
    expect(parseMarketKey("EURUSD")).toMatchObject({ valid: false });
    const otc = observationKey({ correlationId: "r1", marketKey: "EURUSD:OTC", targetEntryAt: 1000 });
    const normal = observationKey({ correlationId: "r1", marketKey: "EURUSD:NORMAL", targetEntryAt: 1000 });
    expect(otc).not.toBe(normal);
    expect(otc).toContain("EURUSD_OTC");
    expect(normal).toContain("EURUSD_NORMAL");
  });

  it("observacoes de mercados diferentes nao se misturam na memoria do ShadowLab", () => {
    const instance: AnyRecord = new ShadowLab({ store: new FakeStore(), now: () => 1000 });
    observeWith(instance, { marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_otc" });
    instance.observeCandidate({
      marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candidateId: "c_normal", decisionSource: "G2_AUTO",
      payout: 85, candidateSnapshot: candidateSnapshot(), jitSnapshot: candidateSnapshot(), candidatePrice: 1.1, jitPrice: 1.1, actualEntryPrice: 1.1,
      direction: "BUY", atr: 0.001, quality: { score: 80, checks: [] }, threshold: 75, gateAccepted: true, currentExecution: "PENDING",
    });
    expect(instance.byMarket.get("EURUSD:OTC")).toHaveLength(1);
    expect(instance.byMarket.get("EURUSD:NORMAL")).toHaveLength(1);
    expect(instance.byMarket.get("EURUSD:OTC")[0].marketKey).toBe("EURUSD:OTC");
    expect(instance.byMarket.get("EURUSD:NORMAL")[0].marketKey).toBe("EURUSD:NORMAL");
  });
});

describe("8/9. contrafactual x broker: nunca misturar", () => {
  it("dashboard separa BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE", () => {
    const observations = [
      { id: "o1", provenance: "PROSPECTIVE", decisionSource: "G2_AUTO", marketKey: "EURUSD:OTC", payout: 82, settlementBasis: "BROKER_EXECUTED", brokerResult: "WIN", theoreticalResult: "WIN", theoreticalPnl: 0.82, currentExecution: "EXECUTE", counterfactual: { locationFilterWouldReject: false, displacementFilterWouldReject: false, hardCriticWouldReject: false, degradationFilterWouldReject: false, correctedGateWouldAccept: true } },
      { id: "o2", provenance: "PROSPECTIVE", decisionSource: "G2_AUTO", marketKey: "AUDCHF:OTC", payout: 82, settlementBasis: "CAUSAL_COUNTERFACTUAL", brokerResult: null, theoreticalResult: "LOSS", theoreticalPnl: -1, currentExecution: "REJECT", counterfactual: { locationFilterWouldReject: true, displacementFilterWouldReject: true, hardCriticWouldReject: true, degradationFilterWouldReject: true, correctedGateWouldAccept: true } },
      { id: "o3", provenance: "HISTORICAL", decisionSource: "G2_AUTO", marketKey: "CADCHF:OTC", payout: 82, settlementBasis: "CAUSAL_COUNTERFACTUAL", theoreticalResult: "WIN", theoreticalPnl: 0.82, currentExecution: "REJECT", counterfactual: {} },
    ];
    const executed = [
      { tradeId: "t1", result: "WIN", stake: 10, pnl: 8.2, payout: 82, decisionSource: "G2_AUTO" },
      { tradeId: "t2", result: "LOSS", stake: 10, pnl: -10, payout: 82, decisionSource: "MANUAL_UI" },
    ];
    const dashboard = buildShadowLabDashboard({ observations, executedTrades: executed });
    expect(dashboard.sections.BROKER_EXECUTED.summary.normalizedPnl).toBeCloseTo(0.82 - 1, 6);
    expect(dashboard.sections.COUNTERFACTUAL.observations).toBe(2);
    expect(dashboard.sections.HISTORICAL.observations).toBe(1);
    expect(dashboard.sections.PROSPECTIVE.settled).toBe(2);
    const h1 = dashboard.arms.H1_LOCATION;
    expect(h1.accepted + h1.rejected).toBe(2);
    expect(h1.acceptedSummary.decided).toBe(1);
    const brokerFlat = JSON.stringify(dashboard.sections.BROKER_EXECUTED);
    expect(brokerFlat).not.toContain("CAUSAL_COUNTERFACTUAL");
    expect(brokerFlat).not.toContain("theoretical");
  });

  it("settlement executado usa basis BROKER_EXECUTED; rejeitado usa CAUSAL_COUNTERFACTUAL; campos nunca se sobrescrevem", async () => {
    const store = new FakeStore();
    const instance: AnyRecord = new ShadowLab({ store, now: () => 1000 });
    const executedObs = observeWith(instance);
    instance.markExecution({ observationId: executedObs.id, currentExecution: "EXECUTE" });
    await instance.settleExecuted({
      candidateId: executedObs.candidateId, executionId: "exec_1", brokerResult: "WIN", profit: 8.2, stake: 10, payout: 82,
      entryAt: 1_000_000, entryPrice: 1.101, settlementPrice: 1.105,
      candles: [{ bucketStart: 1_005_000, close: 1.102 }, { bucketStart: 1_060_000, close: 1.105 }],
    });
    expect(executedObs.settlementBasis).toBe("BROKER_EXECUTED");
    expect(executedObs.brokerResult).toBe("WIN");
    expect(executedObs.theoreticalPnl).toBeCloseTo(0.82, 4);

    const rejected = observeWith(instance, { candidateId: "cand_rejected", targetExpiryAt: 1_060_000, gateAccepted: false, currentExecution: "REJECT" });
    instance.markExecution({ observationId: rejected.id, currentExecution: "REJECT", reason: "QUALITY_SCORE_BELOW_THRESHOLD" });
    const settledCount = instance.settleCausal({ marketKey: "EURUSD:OTC", candles: [{ bucketStart: 1_055_000, close: 1.105 }, { bucketStart: 1_065_000, close: 1.11 }], index: 1, nowMs: 2_000_000 });
    expect(settledCount).toBe(1);
    expect(rejected.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
    expect(rejected.brokerResult).toBeNull();
    expect(rejected.theoreticalResult).toBe("WIN");
    expect(executedObs.settlementBasis).toBe("BROKER_EXECUTED");
  });

  it("normalizedOutcomePnl e summarizeRows reportam CI/coverage/expectancy sem inventar dados", () => {
    expect(normalizedOutcomePnl({ result: "WIN", payout: 82 })).toBeCloseTo(0.82, 4);
    expect(normalizedOutcomePnl({ result: "LOSS", payout: 82 })).toBe(-1);
    expect(normalizedOutcomePnl({ result: "DRAW", payout: 82 })).toBe(0);
    const summary = summarizeRows([
      { theoreticalResult: "WIN", theoreticalPnl: 0.82, payout: 82 },
      { theoreticalResult: "LOSS", theoreticalPnl: -1, payout: 82 },
      { theoreticalResult: "WIN", theoreticalPnl: 0.82, payout: 82 },
    ]);
    expect(summary.decided).toBe(3);
    expect(summary.wr).toBeCloseTo(0.6667, 3);
    expect(summary.ci95.low).toBeLessThan(summary.wr);
    expect(summary.ci95.high).toBeGreaterThan(summary.wr);
    expect(summary.maxLossStreak).toBe(1);
    expect(summary.normalizedPnl).toBeCloseTo(0.64, 4);
    expect(PROSPECTIVE_CHECKPOINT_N).toBe(30);
  });
});

describe("10. reinicio nao perde a associacao da observacao", () => {
  it("settle apos restart encontra a observacao persistida por candidate_id", async () => {
    const store = new FakeStore();
    const first: AnyRecord = new ShadowLab({ store, now: () => 1000 });
    const observation = observeWith(first, { candidateId: "cand_restart" });
    first.resetInMemory();
    expect(first.get(observation.id)).toBeNull();
    const second: AnyRecord = new ShadowLab({ store, now: () => 2000 });
    const settled = await second.settleExecuted({ candidateId: "cand_restart", executionId: "exec_restart", brokerResult: "LOSS", profit: -10, stake: 10, payout: 82 });
    expect(settled?.observationId).toBe(observation.id);
    expect(store.rows.get(observation.id)!.settlementBasis).toBe("BROKER_EXECUTED");
    expect(store.rows.get(observation.id)!.theoreticalPnl).toBe(-1);
  });

  it("runtime persiste t0Snapshot no entryTiming e o journal o consome (D4)", () => {
    expect(RUNTIME_SOURCE).toContain("t0Snapshot: candidate.initialFull");
    expect(RUNTIME_SOURCE).toContain("position.t0Snapshot ?? position.entryTiming?.t0Snapshot");
    expect(RUNTIME_SOURCE).toContain("shadowObservationId");
  });
});

describe("11. leakage de candle futuro e detectado", () => {
  it("findFutureReferences acusa qualquer timestamp posterior ao ponto de decisao", () => {
    const payload = { decisionAt: 1000, structure: { at: 500, bucketStart: 700 }, location: { computedAt: 2500 }, features: { candles: [{ bucketStart: 1000 }, { bucketStart: 1001 }] } };
    const violations = findFutureReferences(payload, 1000);
    expect(violations.some((path: string) => path.includes("location.computedAt"))).toBe(true);
    expect(violations.some((path: string) => path.includes("bucketStart=1001"))).toBe(true);
    expect(findFutureReferences(payload, 3000)).toHaveLength(0);
  });

  it("T0 do ShadowLab nao carrega a janela POST nem o settlement price", () => {
    const store = new FakeStore();
    const instance: AnyRecord = new ShadowLab({ store, now: () => 1000 });
    const observation = observeWith(instance);
    const flat = JSON.stringify(instance.observations.get(observation.id).t0);
    expect(flat).not.toMatch(/postWindow|settlementPrice|brokerResult|theoretical/i);
  });
});

describe("classificadores H1/H2/H3 e degradation observer (descritivos)", () => {
  it("H1: tags de localizacao com precedencia documentada", () => {
    expect(classifyLocation({ donchianPosition: 0.5, distanceToUpperATR: 1, distanceToLowerATR: 1, direction: "BUY" }).tag).toBe("LOCATION_MID");
    expect(classifyLocation({ donchianPosition: 0.05, distanceToUpperATR: 1.9, distanceToLowerATR: 0.1, direction: "BUY" }).tag).toBe("LOCATION_EDGE");
    expect(classifyLocation({ donchianPosition: 0.25, distanceToUpperATR: 1.5, distanceToLowerATR: 0.5, direction: "BUY" }).tag).toBe("LOCATION_LOWER_HALF");
    expect(classifyLocation({ donchianPosition: 0.8, distanceToUpperATR: 0.4, distanceToLowerATR: 1.6, direction: "BUY" }).tag).toBe("LOCATION_UPPER_HALF");
    expect(classifyLocation({ donchianPosition: 0.5, distanceToUpperATR: 2.6, distanceToLowerATR: 3.1, direction: "BUY" }).tag).toBe("LOCATION_OVEREXTENDED");
    expect(classifyLocation({ donchianPosition: null }).tag).toBeNull();
  });

  it("H1: localizacao da entrada reconstruida do canal", () => {
    const entry = classifyEntryLocation({ entryPrice: 1.06, channelHigh: 1.1, channelLow: 1.0, direction: "BUY" });
    expect(entry.donchianPosition).toBeCloseTo(0.6, 3);
    expect(entry.positionSource).toBe("RECONSTRUCTED_FROM_CHANNEL");
    expect(classifyEntryLocation({ entryPrice: null }).positionSource).toBe("UNRECONSTRUCTIBLE");
  });

  it("H2: deslocamento direction-adjusted positivo=adverso e buckets", () => {
    expect(directionAdjustedDisplacement({ fromPrice: 1.0, toPrice: 1.01, direction: "BUY" })).toBeCloseTo(0.01, 4);
    expect(directionAdjustedDisplacement({ fromPrice: 1.0, toPrice: 1.01, direction: "SELL" })).toBeCloseTo(-0.01, 4);
    expect(classifyDisplacementBucket(-0.2)).toBe("BUCKET_FAVORABLE_OR_ZERO");
    expect(classifyDisplacementBucket(0.1)).toBe("BUCKET_0_015");
    expect(classifyDisplacementBucket(0.2)).toBe("BUCKET_015_025");
    expect(classifyDisplacementBucket(0.3)).toBe("BUCKET_025_035");
    expect(classifyDisplacementBucket(0.4)).toBe("BUCKET_035_050");
    expect(classifyDisplacementBucket(0.6)).toBe("BUCKET_GT_050");
    const displacement = buildDisplacementShadow({ candidatePrice: 1.0, jitPrice: 1.0003, actualEntryPrice: 1.0005, atr: 0.001, direction: "BUY" });
    expect(displacement.candidateToEntryATR).toBeCloseTo(0.5, 3);
    expect(displacement.bucket).toBe("BUCKET_035_050");
    expect(displacement.signConvention).toContain("POSITIVE=ADVERSE");
  });

  it("H3: severidade NONE/SOFT/HARD/MULTIPLE e veto contrafactual", () => {
    expect(criticCodeSeverity("aceleracao_contra_a_entrada")).toBe("HARD");
    expect(criticCodeSeverity("preco_esticado_contra_a_entrada")).toBe("HARD");
    expect(criticCodeSeverity("conflito_di_contra_entrada")).toBe("HARD");
    expect(criticCodeSeverity("adx_fraco_para_setup")).toBe("SOFT");
    expect(criticCodeSeverity("checklist_falhou:sem_extensao_excessiva")).toBe("SOFT");
    expect(criticCodeSeverity("codigo_desconhecido_xyz")).toBe("SOFT");
    expect(classifyContradictionSeverity({ contradictions: [] }).severity).toBe("NONE");
    expect(classifyContradictionSeverity({ contradictions: ["adx_fraco_para_setup"] }).severity).toBe("SOFT");
    const hard = classifyContradictionSeverity({ contradictions: ["preco_esticado_contra_a_entrada"] });
    expect(hard.severity).toBe("HARD");
    expect(hard.wouldVetoIfHardContradiction).toBe(true);
    expect(classifyContradictionSeverity({ contradictions: ["aceleracao_contra_a_entrada", "conflito_di_contra_entrada"] }).severity).toBe("MULTIPLE");
    expect(classifyContradictionSeverity({ contradictions: ["adx_fraco_para_setup"] }).wouldVetoIfHardContradiction).toBe(false);
  });

  it("degradation observer: 4 estados com reasons decomponiveis", () => {
    const base = { direction: "BUY", donchianPosition: 0.6, rsi: 55, adx: 30, plusDI: 25, minusDI: 18, atrRatio: 1.1, upperWick: 0.2, lowerWick: 0.2, structureLabel: "UP", criticSeverity: "NONE", locationTag: "LOCATION_UPPER_HALF", fresh: true, tickAgeMs: 100, displacementATR: 0.05 };
    expect(observeDegradation({ candidate: base, jit: base }).state).toBe("STABLE");
    expect(observeDegradation({ candidate: base, jit: { ...base, criticSeverity: "NONE", adx: 24 } }).state).toBe("DEGRADED");
    expect(observeDegradation({ candidate: base, jit: { ...base, adx: 24, plusDI: 17, minusDI: 26 } }).state).toBe("SEVERELY_DEGRADED");
    const improved = observeDegradation({ candidate: { ...base, criticSeverity: "SOFT" }, jit: base });
    expect(improved.state).toBe("IMPROVED");
    expect(improved.degradationReasons).toContain("CRITIC_CLEANED");
    const severe = observeDegradation({ candidate: base, jit: { ...base, displacementATR: 0.7 } });
    expect(severe.state).toBe("SEVERELY_DEGRADED");
    expect(severe.reasons.every((reason: AnyRecord) => reason.code && reason.dimension && reason.impact)).toBe(true);
    const inputs = degradationInputsFromSnapshot({ snapshot: candidateSnapshot(), direction: "BUY" });
    expect(inputs.rsi).toBe(55);
    expect(inputs.donchianPosition).toBe(0.6);
  });

  it("migration 029 garante imutabilidade do T0, diagnostic_only e feedable_to_t0=false", () => {
    expect(MIGRATION_SQL).toContain("iq_shadow_observations_t0_immutable");
    expect(MIGRATION_SQL).toContain("is immutable");
    expect(MIGRATION_SQL).toContain("feedable_to_t0 boolean NOT NULL DEFAULT false");
    expect(MIGRATION_SQL).toContain("diagnostic_only boolean NOT NULL DEFAULT true");
    expect(MIGRATION_SQL).toContain("decision_source text");
    expect(readFileSync("scripts/db-retention.mjs", "utf8")).toContain("iq_trade_market_windows");
  });
});
