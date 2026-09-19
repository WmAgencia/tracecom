/**
 * CHECKPOINT REPORT (scripts/scenario-shadow-report.mjs) — nos N=30, 60, 100 e a cada +100.
 *
 * Prova: observacao invalida nao entra nas metricas principais (e contada como descartada),
 * BROKER_EXECUTED / COUNTERFACTUAL / PROSPECTIVE nunca se misturam, e as secoes exigidas existem.
 * Nenhuma logica de estrategia e exercitada aqui (somente leitura de observacoes persistidas).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - script ESM sem tipagem
const report = await import("../../scripts/scenario-shadow-report.mjs");

type AnyRecord = Record<string, any>;
const {
  checkpointThresholds, nextCheckpoint, buildScenarioShadowReport, mapObservationRow,
  computeG2VsV3, classifyStability, STABILITY_CLASSES,
} = report as unknown as Record<string, any>;

function row(index: number, over: AnyRecord = {}): AnyRecord {
  const action = over.action ?? "BUY";
  const traderScenario = over.traderScenario ?? "TREND_CONTINUATION";
  const marketKey = over.marketKey ?? (index % 2 === 0 ? "EURUSD:OTC" : "GBPUSD:NORMAL");
  const marketType = over.marketType ?? (index % 2 === 0 ? "OTC" : "NORMAL");
  return {
    id: `scenario_cand_${index}`,
    provenance: "PROSPECTIVE",
    marketKey, marketType,
    direction: action === "WAIT" ? "BUY" : action,
    candidateId: `cand_${index}`, correlationId: `corr_${index}`, executionId: null, tradeId: null,
    candidateAt: 1_000 + index * 1_000, decisionAt: 1_100 + index * 1_000, jitAt: 2_000 + index * 1_000,
    finalEntryAt: 3_000 + index * 1_000, targetEntryAt: 61_000 + index * 1_000, targetExpiryAt: 121_000 + index * 1_000,
    createdAt: 1_100 + index * 1_000, payout: 82,
    t0: { candidateAt: 1_000 + index * 1_000, decisionAt: 1_100 + index * 1_000, marketKey, direction: action === "WAIT" ? "BUY" : action, freshness: { fresh: true, tickAgeMs: 100 } },
    t0Integrity: { asOfMs: 1_100 + index * 1_000, clean: true },
    currentDecision: { action: over.g2 ?? action },
    scenarioDecision: { action },
    traderScenario: { primaryScenario: traderScenario, marketRegime: over.regime ?? "TREND_UP", action, featuresUsed: ["structureLabel", "atrRatio", "rsi14"], invalidationReasons: over.invalidationReasons ?? [] },
    criticScenario: { primaryScenario: over.criticScenario ?? traderScenario, action: over.criticAction ?? action },
    criticFreeze: { criticSawTraderConclusion: false },
    agreement: over.agreement ?? true,
    persistence: { scenarioChanged: over.scenarioChanged ?? false, scenarioChangeCount: over.scenarioChangeCount ?? 0 },
    playbookAtCandidate: over.playbook ?? "PB_TREND_CONTINUATION",
    finalAction: action,
    reasonsForWait: action === "WAIT" ? ["NO_VALID_SCENARIO"] : [],
    outcome: over.outcome ?? null,
    settlementBasis: over.settlementBasis ?? null,
    brokerResult: over.brokerResult ?? null,
    engineInfo: { mode: "SCENARIO_ENGINE" },
    persistState: "LOADED",
  };
}

describe("checkpoint report", () => {
  it("dispara em N=30, 60, 100 e a cada +100", () => {
    expect(checkpointThresholds(0)).toEqual([]);
    expect(checkpointThresholds(29)).toEqual([]);
    expect(checkpointThresholds(30)).toEqual([30]);
    expect(checkpointThresholds(60)).toEqual([30, 60]);
    expect(checkpointThresholds(99)).toEqual([30, 60]);
    expect(checkpointThresholds(100)).toEqual([30, 60, 100]);
    expect(checkpointThresholds(101)).toEqual([30, 60, 100]);
    expect(checkpointThresholds(200)).toEqual([30, 60, 100, 200]);
    expect(checkpointThresholds(315)).toEqual([30, 60, 100, 200, 300]);
    expect(nextCheckpoint(0)).toBe(30);
    expect(nextCheckpoint(30)).toBe(60);
    expect(nextCheckpoint(100)).toBe(200);
    expect(nextCheckpoint(250)).toBe(300);
  });

  it("gera relatorios por checkpoint com N/WR/coverage/WAIT rate e sem promocao automatica", () => {
    const rows = Array.from({ length: 130 }, (_, index) => row(index, { action: index % 3 === 0 ? "WAIT" : index % 2 === 0 ? "BUY" : "SELL" }));
    const built = buildScenarioShadowReport({ rows, intersections: [], since: "2026-09-01T00:00:00Z", generatedAt: "2026-09-19T08:00:00Z" });
    expect(built.checkpoints.reached).toEqual([30, 60, 100]);
    expect(built.checkpoints.next).toBe(200);
    expect(built.checkpoints.automaticPromotion).toBe(false);
    expect(built.checkpoints.reports.map((entry: AnyRecord) => entry.checkpointN)).toEqual([30, 60, 100]);
    expect(built.checkpoints.reports[0].exploratory).toBe(true);
    expect(built.checkpoints.reports[1].exploratory).toBe(false);
    for (const entry of built.checkpoints.reports) {
      expect(entry.metrics.nValid).toBe(entry.checkpointN);
      expect(entry.metrics.direction.actions.BUY + entry.metrics.direction.actions.SELL + entry.metrics.direction.actions.WAIT).toBe(entry.checkpointN);
      expect(entry.metrics.rates).toHaveProperty("waitRate");
      expect(entry.metrics.outcomes.byBasis).toHaveProperty("BROKER_EXECUTED");
      expect(entry.metrics.traderVsCritic.matrix).toBeTruthy();
      expect(entry.metrics.playbooks).toHaveProperty("PB_TRANSITION_NO_TRADE");
    }
    expect(built.sampleSize.validProspective).toBe(130);
  });

  it("exclui observacao invalida das metricas principais e conta como descartada", () => {
    const invalid = row(1, { outcome: { result: "WIN", normalizedPnl: 0.82 }, settlementBasis: "CAUSAL_COUNTERFACTUAL" });
    invalid.t0 = null;
    const rows = [row(0), row(2), invalid];
    const built = buildScenarioShadowReport({ rows });
    expect(built.totals.observations).toBe(3);
    expect(built.totals.valid).toBe(2);
    expect(built.totals.discarded).toBe(1);
    expect(built.quality.invalidReasons.T0_MISSING).toBe(1);
    expect(built.headline.n).toBe(2);
    expect(built.headline.metrics.outcomes.byBasis.CAUSAL_COUNTERFACTUAL.settled).toBe(0);
  });

  it("separa BROKER_EXECUTED / COUNTERFACTUAL / PROSPECTIVE sem somar WR/PnL", () => {
    const broker = row(0, { outcome: { result: "WIN", normalizedPnl: 0.82, at: 10 }, settlementBasis: "BROKER_EXECUTED", brokerResult: "WIN" });
    const counter = row(1, { outcome: { result: "LOSS", normalizedPnl: -1, at: 11 }, settlementBasis: "CAUSAL_COUNTERFACTUAL" });
    const pending = row(2);
    const built = buildScenarioShadowReport({ rows: [broker, counter, pending] });
    expect(built.sections.BROKER_EXECUTED.observations).toBe(1);
    expect(built.sections.BROKER_EXECUTED.summary.wins).toBe(1);
    expect(built.sections.COUNTERFACTUAL.observations).toBe(1);
    expect(built.sections.COUNTERFACTUAL.summary.losses).toBe(1);
    expect(built.sections.PROSPECTIVE.observations).toBe(3);
    const headlineBasis = built.headline.metrics.outcomes.byBasis;
    expect(headlineBasis.BROKER_EXECUTED.wins).toBe(1);
    expect(headlineBasis.CAUSAL_COUNTERFACTUAL.losses).toBe(1);
    expect(headlineBasis.BROKER_EXECUTED.normalizedPnl + headlineBasis.CAUSAL_COUNTERFACTUAL.normalizedPnl).toBeCloseTo(-0.18, 6);
    expect(built.headline.metrics.outcomes.policy).toContain("NUNCA_SOMAR");
  });

  it("computa CURRENT_G2 vs V3 (acordo, G2 TRADE/V3 WAIT, ambos TRADE mesma/outra direcao)", () => {
    const rows = [
      row(0, { action: "BUY", g2: "BUY" }),
      row(1, { action: "WAIT", g2: "BUY" }),
      row(2, { action: "SELL", g2: "WAIT" }),
      row(3, { action: "SELL", g2: "BUY" }),
      row(4, { action: "WAIT", g2: "WAIT" }),
    ];
    const comparison = computeG2VsV3(rows);
    expect(comparison.n).toBe(5);
    expect(comparison.agreed).toBe(2);
    expect(comparison.agreementRate).toBe(0.4);
    expect(comparison.g2TradeV3Wait).toBe(1);
    expect(comparison.g2WaitV3Trade).toBe(1);
    expect(comparison.bothTradeSameDirection).toBe(1);
    expect(comparison.bothTradeDifferentDirection).toBe(1);
    expect(comparison.bothWait).toBe(1);
    expect(comparison.ci95).toHaveProperty("low");
  });

  it("classifica estabilidade STABLE_SCENARIO / SCENARIO_CHANGED / MULTIPLE_CHANGES", () => {
    expect(STABILITY_CLASSES).toEqual(["STABLE_SCENARIO", "SCENARIO_CHANGED", "MULTIPLE_CHANGES"]);
    expect(classifyStability(row(0))).toBe("STABLE_SCENARIO");
    expect(classifyStability(row(1, { scenarioChanged: true, scenarioChangeCount: 1 }))).toBe("SCENARIO_CHANGED");
    expect(classifyStability(row(2, { scenarioChanged: true, scenarioChangeCount: 2 }))).toBe("MULTIPLE_CHANGES");
    const built = buildScenarioShadowReport({ rows: [row(0), row(1, { scenarioChanged: true, scenarioChangeCount: 1 }), row(2, { scenarioChanged: true, scenarioChangeCount: 3 })] });
    expect(built.headline.metrics.stability.classes.STABLE_SCENARIO.n).toBe(1);
    expect(built.headline.metrics.stability.classes.SCENARIO_CHANGED.n).toBe(1);
    expect(built.headline.metrics.stability.classes.MULTIPLE_CHANGES.n).toBe(1);
    expect(built.headline.metrics.rates.scenarioChangeRate).toBe(0.6667);
  });

  it("cruza V3 x Late Window em 4 quadrantes (BUY/SELL/WAIT x ACCEPT/CANCEL)", () => {
    const rows = [row(0, { action: "BUY" }), row(1, { action: "WAIT" }), row(2, { action: "SELL" }), row(3, { action: "BUY" })];
    const intersections = [
      { candidateId: "cand_0", lateOutcome: "LATE_ACCEPT", verdict: "BOTH_ENTRY" },
      { candidateId: "cand_1", lateOutcome: "LATE_ACCEPT", verdict: "SCENARIO_WAIT_LATE_ACCEPT" },
      { candidateId: "cand_2", lateOutcome: "LATE_CANCEL", verdict: "BOTH_WAIT" },
    ];
    const built = buildScenarioShadowReport({ rows, intersections });
    const late = built.headline.metrics.lateWindow;
    expect(late.matched).toBe(3);
    expect(late.matrix.BUY).toEqual({ ACCEPT: 1, CANCEL: 0 });
    expect(late.matrix.WAIT).toEqual({ ACCEPT: 1, CANCEL: 0 });
    expect(late.matrix.SELL).toEqual({ ACCEPT: 0, CANCEL: 1 });
    expect(late.quadrants).toEqual({ ENTRY_LATE_ACCEPT: 1, ENTRY_LATE_CANCEL: 1, WAIT_LATE_ACCEPT: 1, WAIT_LATE_CANCEL: 0 });
    expect(late.cancelRate).toBe(0.3333);
    expect(built.intersections.byVerdict).toMatchObject({ BOTH_ENTRY: 1, SCENARIO_WAIT_LATE_ACCEPT: 1, BOTH_WAIT: 1 });
  });

  it("traz matriz TraderScenario x CriticScenario, playbooks, NORMAL x OTC e motivos de invalidacao", () => {
    const rows = [
      row(0, { traderScenario: "REVERSAL", criticScenario: "TREND_PULLBACK", playbook: "PB_REVERSAL", action: "WAIT" }),
      row(1, { traderScenario: "TREND_CONTINUATION", criticScenario: "TREND_CONTINUATION", playbook: "PB_TREND_CONTINUATION", action: "BUY", invalidationReasons: ["MOMENTUM_CONFLICT"] }),
    ];
    const built = buildScenarioShadowReport({ rows });
    const matrix = built.headline.metrics.traderVsCritic.matrix;
    expect(matrix["REVERSAL × TREND_PULLBACK"].n).toBe(1);
    expect(matrix["REVERSAL × TREND_PULLBACK"].finalAction.WAIT).toBe(1);
    expect(built.headline.metrics.traderVsCritic.scenarioAgreementRate).toBe(0.5);
    const playbook = built.headline.metrics.playbooks.PB_REVERSAL;
    expect(playbook.n).toBe(1);
    expect(playbook.actions.WAIT).toBe(1);
    expect(playbook.coverage).toBe(0);
    expect(built.headline.metrics.marketType.OTC.n).toBe(1);
    expect(built.headline.metrics.marketType.NORMAL.n).toBe(1);
    expect(built.headline.metrics.byAsset[0]).toHaveProperty("asset");
    expect(built.headline.metrics.playbooks.PB_TREND_CONTINUATION.topInvalidationReasons[0]).toEqual({ reason: "MOMENTUM_CONFLICT", count: 1 });
  });

  it("mapeia linha do DB para a vista do relatorio sem perder basis/outcome", () => {
    const mapped = mapObservationRow({
      observation_id: "scenario_x", provenance: "PROSPECTIVE", market_key: "EURUSD:OTC", market_type: "OTC",
      candidate_at: "2026-09-19T00:00:00.000Z", direction: "BUY", final_action: "BUY", settlement_basis: "CAUSAL_COUNTERFACTUAL",
      outcome: { result: "WIN", normalizedPnl: 0.82 }, trader_scenario: { primaryScenario: "BREAKOUT", featuresUsed: ["structureLabel"] }, created_at: "2026-09-19T00:00:01.000Z",
    });
    expect(mapped.id).toBe("scenario_x");
    expect(mapped.marketType).toBe("OTC");
    expect(mapped.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
    expect(mapped.outcome.result).toBe("WIN");
    expect(mapped.persistState).toBe("LOADED");
  });

  it("nao conclui edge por WR alto em N pequeno (somente checkpoint exploratorio)", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index, { outcome: { result: "WIN", normalizedPnl: 0.82, at: index }, settlementBasis: "CAUSAL_COUNTERFACTUAL" }));
    const built = buildScenarioShadowReport({ rows });
    expect(built.checkpoints.reached).toEqual([]);
    expect(built.checkpoints.next).toBe(30);
    expect(built.sampleSize.reachedCheckpoint).toBe(false);
    expect(built.checkpoints.automaticPromotion).toBe(false);
    expect(built.headline.metrics.outcomes.byBasis.CAUSAL_COUNTERFACTUAL.wr).toBe(1);
    expect(built.headline.note).toContain("descartadas");
  });
});
