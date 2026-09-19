/**
 * DATA QUALITY das observacoes SHADOW — cada uma das 8 condicoes invalida a observacao.
 *
 * Observacao invalida NAO entra nas metricas principais, mas continua persistida e contada como
 * descartada. Nenhuma regra de estrategia/classificacao e tocada por este modulo.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const quality = await import("../../relay/scenario-observation-quality.mjs");

type AnyRecord = Record<string, any>;

const {
  assessScenarioObservationQuality, partitionObservationsByQuality, summarizeInvalidReasons,
  INVALID_REASONS, OBSERVATION_QUALITY_VERSION, OBSERVATION_QUALITY_POLICY, FEED_STALE_TICK_AGE_MS,
} = quality as unknown as Record<string, any>;

function observation(overrides: AnyRecord = {}): AnyRecord {
  const base: AnyRecord = {
    id: "scenario_cand_1",
    provenance: "PROSPECTIVE",
    marketKey: "EURUSD:OTC",
    marketType: "OTC",
    direction: "BUY",
    candidateId: "cand_1",
    correlationId: "corr_1",
    executionId: null,
    tradeId: null,
    candidateAt: 1_000,
    decisionAt: 2_000,
    jitAt: 3_000,
    finalEntryAt: 4_000,
    targetEntryAt: 61_000,
    targetExpiryAt: 121_000,
    createdAt: 2_000,
    t0: { candidateAt: 1_000, decisionAt: 2_000, marketKey: "EURUSD:OTC", direction: "BUY", freshness: { fresh: true, tickAgeMs: 120 } },
    t0Integrity: { asOfMs: 2_000, clean: true },
    outcome: null,
    settlementBasis: null,
    featuresUsed: ["structureLabel", "donchianPosition", "atrRatio", "rsi14"],
    traderScenario: { featuresUsed: ["structureLabel", "donchianPosition", "atrRatio", "rsi14"], invalidationReasons: [], scenarioEvidenceAgainst: [] },
  };
  return {
    ...base,
    ...overrides,
    traderScenario: overrides.traderScenario === null ? null : { ...base.traderScenario, ...(overrides.traderScenario ?? {}) },
  };
}

describe("scenario observation data quality", () => {
  it("observacao completa e fresca e valida (nao descartada)", () => {
    const result = assessScenarioObservationQuality(observation());
    expect(result.version).toBe(OBSERVATION_QUALITY_VERSION);
    expect(result.valid).toBe(true);
    expect(result.discarded).toBe(false);
    expect(result.invalidReasons).toEqual([]);
    expect(result.policy.invalidExcludedFromMainMetrics).toBe(true);
    expect(result.policy.mutatesObservation).toBe(false);
  });

  it("marca FEED_STALE por fresh=false, por tickAgeMs acima do limiar e por sinal do motor", () => {
    expect(assessScenarioObservationQuality(observation({ t0: { ...observation().t0, freshness: { fresh: false, tickAgeMs: 100 } } })).invalidReasons).toContain("FEED_STALE");
    expect(assessScenarioObservationQuality(observation({ t0: { ...observation().t0, freshness: { fresh: true, tickAgeMs: FEED_STALE_TICK_AGE_MS + 1 } } })).invalidReasons).toContain("FEED_STALE");
    expect(assessScenarioObservationQuality(observation({ traderScenario: { invalidationReasons: ["FEED_STALE", "X"] } })).invalidReasons).toContain("FEED_STALE");
  });

  it("marca T0_MISSING quando o T0 ausente/vazio", () => {
    expect(assessScenarioObservationQuality(observation({ t0: null })).invalidReasons).toContain("T0_MISSING");
    expect(assessScenarioObservationQuality(observation({ t0: {} })).invalidReasons).toContain("T0_MISSING");
  });

  it("marca CLOCK_INCONSISTENT quando timestamps invertem ou o drift e grande", () => {
    expect(assessScenarioObservationQuality(observation({ decisionAt: 500 })).invalidReasons).toContain("CLOCK_INCONSISTENT");
    expect(assessScenarioObservationQuality(observation({ createdAt: 2_000 + 3_600_001 })).invalidReasons).toContain("CLOCK_INCONSISTENT");
    expect(assessScenarioObservationQuality(observation({ targetEntryAt: 200_000, targetExpiryAt: 121_000 })).invalidReasons).toContain("CLOCK_INCONSISTENT");
  });

  it("marca MARKET_KEY_AMBIGUOUS quando a chave nao parseia", () => {
    expect(assessScenarioObservationQuality(observation({ marketKey: "EURUSD" })).invalidReasons).toContain("MARKET_KEY_AMBIGUOUS");
    expect(assessScenarioObservationQuality(observation({ marketKey: null })).invalidReasons).toContain("MARKET_KEY_AMBIGUOUS");
  });

  it("marca NORMAL_OTC_MISMATCH quando marketType diverge da chave", () => {
    const result = assessScenarioObservationQuality(observation({ marketType: "NORMAL" }));
    expect(result.invalidReasons).toContain("NORMAL_OTC_MISMATCH");
    expect(result.checks.NORMAL_OTC_MATCH.detail).toMatchObject({ marketType: "NORMAL", parsedMarketType: "OTC" });
  });

  it("marca SETTLEMENT_UNCERTAIN para result/basis invalidos; aceita contrafactual explicito", () => {
    expect(assessScenarioObservationQuality(observation({ outcome: { result: "WIN" }, settlementBasis: null })).invalidReasons).toContain("SETTLEMENT_UNCERTAIN");
    expect(assessScenarioObservationQuality(observation({ outcome: { result: "UNKNOWN" }, settlementBasis: "CAUSAL_COUNTERFACTUAL" })).invalidReasons).toContain("SETTLEMENT_UNCERTAIN");
    expect(assessScenarioObservationQuality(observation({ outcome: { result: "WIN" }, settlementBasis: "BROKER_EXECUTED", brokerResult: null })).invalidReasons).toContain("SETTLEMENT_UNCERTAIN");
    expect(assessScenarioObservationQuality(observation({ outcome: { result: "WIN" }, settlementBasis: "CAUSAL_COUNTERFACTUAL" })).valid).toBe(true);
  });

  it("marca RESTART_WITHOUT_ASSOCIATION para linha LOADED sem ids e outcome sem vinculo", () => {
    expect(assessScenarioObservationQuality(observation({ persistState: "LOADED", candidateId: null, correlationId: null })).invalidReasons).toContain("RESTART_WITHOUT_ASSOCIATION");
    expect(assessScenarioObservationQuality(observation({ candidateId: null, executionId: null, outcome: { result: "WIN" }, settlementBasis: "CAUSAL_COUNTERFACTUAL" })).invalidReasons).toContain("RESTART_WITHOUT_ASSOCIATION");
  });

  it("marca FEATURE_CRITICAL_UNAVAILABLE sem structureLabel ou sem volatilidade E momentum", () => {
    expect(assessScenarioObservationQuality(observation({ featuresUsed: [], traderScenario: null })).invalidReasons).toContain("FEATURE_CRITICAL_UNAVAILABLE");
    expect(assessScenarioObservationQuality(observation({ featuresUsed: ["donchianPosition", "atrRatio", "rsi14"], traderScenario: null })).invalidReasons).toContain("FEATURE_CRITICAL_UNAVAILABLE");
    expect(assessScenarioObservationQuality(observation({ featuresUsed: ["structureLabel"], traderScenario: null })).invalidReasons).toContain("FEATURE_CRITICAL_UNAVAILABLE");
  });

  it("acumula multiplos motivos na ordem congelada de INVALID_REASONS", () => {
    const result = assessScenarioObservationQuality(observation({ t0: null, marketKey: "EURUSD", marketType: "NORMAL", persistState: "LOADED", candidateId: null, correlationId: null, featuresUsed: [], traderScenario: null }));
    expect(result.valid).toBe(false);
    expect(result.invalidReasons).toEqual(INVALID_REASONS.filter((reason: string) => result.invalidReasons.includes(reason)));
    expect(new Set(result.invalidReasons).size).toBe(result.invalidReasons.length);
    expect(result.invalidReasons.length).toBeGreaterThanOrEqual(4);
  });

  it("particiona validas/invalidas e conta descartadas sem apagar nada", () => {
    const rows = [observation(), observation({ id: "scenario_cand_2", t0: null }), observation({ id: "scenario_cand_3", t0: { ...observation().t0, freshness: { fresh: false } } })];
    const snapshot = JSON.stringify(rows);
    const partition = partitionObservationsByQuality(rows);
    expect(partition.total).toBe(3);
    expect(partition.valid).toHaveLength(1);
    expect(partition.discarded).toBe(2);
    expect(partition.invalidReasons).toMatchObject({ T0_MISSING: 1, FEED_STALE: 1 });
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(summarizeInvalidReasons(rows)).toMatchObject({ total: 3, discarded: 2 });
  });

  it("normaliza linha do DB (snake_case) e e deterministico", () => {
    const dbRow = {
      observation_id: "scenario_db_1", provenance: "PROSPECTIVE", market_key: "GBPUSD:OTC", market_type: "OTC",
      candidate_id: "cand_db", candidate_at: 10, decision_at: 20, jit_at: 30, target_entry_at: 40, target_expiry_at: 100,
      created_at: 20, t0: { candidateAt: 10, marketKey: "GBPUSD:OTC", freshness: { fresh: true, tickAgeMs: 50 } },
      t0_integrity: { asOfMs: 20 }, trader_scenario: { featuresUsed: ["structureLabel", "atrRatio", "rsi14"], invalidationReasons: [] },
      outcome: null, settlement_basis: null,
    };
    const first = assessScenarioObservationQuality(dbRow);
    const second = assessScenarioObservationQuality(dbRow);
    expect(first.valid).toBe(true);
    expect(second).toEqual(first);
  });
});
