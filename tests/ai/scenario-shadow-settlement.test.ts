/**
 * SCENARIO SHADOW SETTLEMENT (fase 29) — testes da liquidacao CAUSAL observacional.
 *
 * Prova:
 *  1. WIN/LOSS/DRAW direcional puro (BUY/SELL, inclui DRAW);
 *  2. precos causais (entrada <= targetEntryAt; liquidacao <= targetExpiryAt; preco pos-expiry nao participa);
 *  3. settleCausal grava CAUSAL_COUNTERFACTUAL (NUNCA BROKER_EXECUTED), pos-classificacao e idempotente;
 *  4. observacao antes do expiry nao liquida; ja liquidada nao reescreve;
 *  5. isolamento: o modulo NAO importa/altera decision logic congelada;
 *  6. runtime faz o hook observacional (fonte) sem tocar estrategia.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const settlement = await import("../../relay/scenario-shadow-settlement.mjs");

const {
  settleDirectionalOutcome,
  causalPricesFromCandles,
  ScenarioShadowSettlement,
  SCENARIO_SHADOW_SETTLEMENT_BASIS,
  SCENARIO_SHADOW_SETTLEMENT_POLICY,
} = settlement as unknown as Record<string, any>;

const MODULE_SOURCE: string = readFileSync("relay/scenario-shadow-settlement.mjs", "utf8");
const RUNTIME_SOURCE: string = readFileSync("relay/iq-multi-runtime.mjs", "utf8");
const SCRIPT_SOURCE: string = readFileSync("scripts/scenario-shadow-settle.mjs", "utf8");

type AnyRecord = Record<string, any>;

function candle(bucketStart: number, close: number): AnyRecord {
  return { bucketStart, open: close, high: close, low: close, close };
}

function observation(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: "scenario_cand_TEST_1",
    provenance: "PROSPECTIVE",
    marketKey: "EURUSD:OTC",
    direction: "BUY",
    payout: 87,
    targetEntryAt: 300_000,
    targetExpiryAt: 360_000,
    outcome: null,
    settlementBasis: null,
    theoreticalResult: null,
    status: "CLASSIFIED",
    ...overrides,
  };
}

function fakePool(): AnyRecord {
  const queries: AnyRecord[] = [];
  return {
    queries,
    query: async (sql: string, params: AnyRecord[] = []) => { queries.push({ sql, params }); return { rowCount: 1, rows: [] }; },
  };
}

describe("settleDirectionalOutcome", () => {
  it("resolves BUY/SELL WIN/LOSS/DRAW", () => {
    expect(settleDirectionalOutcome({ direction: "BUY", entryPrice: 1.1, expiryPrice: 1.2 })).toBe("WIN");
    expect(settleDirectionalOutcome({ direction: "BUY", entryPrice: 1.2, expiryPrice: 1.1 })).toBe("LOSS");
    expect(settleDirectionalOutcome({ direction: "BUY", entryPrice: 1.1, expiryPrice: 1.1 })).toBe("DRAW");
    expect(settleDirectionalOutcome({ direction: "SELL", entryPrice: 1.2, expiryPrice: 1.1 })).toBe("WIN");
    expect(settleDirectionalOutcome({ direction: "SELL", entryPrice: 1.1, expiryPrice: 1.2 })).toBe("LOSS");
    expect(settleDirectionalOutcome({ direction: "WAIT", entryPrice: 1.1, expiryPrice: 1.2 })).toBeNull();
    expect(settleDirectionalOutcome({ direction: "BUY", entryPrice: null, expiryPrice: 1.2 })).toBeNull();
  });
});

describe("causalPricesFromCandles", () => {
  const candles = [candle(295_000, 1.10), candle(300_000, 1.11), candle(330_000, 1.13), candle(360_000, 1.12), candle(365_000, 1.99)];

  it("uses last close at/before entry and at/before expiry; post-expiry price never participates", () => {
    const prices = causalPricesFromCandles({ candles, targetEntryAt: 300_000, targetExpiryAt: 360_000 });
    expect(prices.entryPrice).toBe(1.11);
    expect(prices.expiryPrice).toBe(1.12);
    expect(prices.complete).toBe(true);
  });

  it("is incomplete before the expiry is reached (no settlement)", () => {
    const prices = causalPricesFromCandles({ candles: candles.slice(0, 3), targetEntryAt: 300_000, targetExpiryAt: 360_000 });
    expect(prices.complete).toBe(false);
  });
});

describe("ScenarioShadowSettlement.settleCausal", () => {
  it("settles due prospective observations as CAUSAL_COUNTERFACTUAL and persists only lifecycle columns", async () => {
    const due = observation();
    const notDue = observation({ id: "scenario_cand_TEST_2", targetExpiryAt: 999_999 });
    const already = observation({ id: "scenario_cand_TEST_3", outcome: { result: "WIN" }, settlementBasis: "CAUSAL_COUNTERFACTUAL", theoreticalResult: "WIN", status: "SETTLED" });
    const shadow = { list: () => [due, notDue, already] };
    const pool = fakePool();
    const engine = new ScenarioShadowSettlement({ scenarioShadow: shadow, pool, now: () => 1_000_000 });
    const candles = [candle(300_000, 1.10), candle(360_000, 1.20)];
    const settled = engine.settleCausal({ marketKey: "EURUSD:OTC", candles, index: candles.length - 1, nowMs: 1_000_000 });

    expect(settled).toBe(1);
    expect(due.settlementBasis).toBe(SCENARIO_SHADOW_SETTLEMENT_BASIS);
    expect(due.settlementBasis).not.toBe("BROKER_EXECUTED");
    expect(due.theoreticalResult).toBe("WIN");
    expect(due.outcome.result).toBe("WIN");
    expect(due.outcome.provenance).toBe("PROSPECTIVE_SHADOW");
    expect(due.outcome.entryPrice).toBe(1.10);
    expect(due.outcome.expiryPrice).toBe(1.20);
    expect(due.outcome.outcomeUsedInClassification).toBe(false);
    expect(due.outcome.feedableToClassification).toBe(false);
    expect(due.status).toBe("SETTLED");
    expect(notDue.settlementBasis).toBeNull();
    expect(already.theoreticalResult).toBe("WIN");

    expect(pool.queries.length).toBe(1);
    expect(pool.queries[0].sql).toContain("settlement_basis=$3");
    expect(pool.queries[0].params).toContain("CAUSAL_COUNTERFACTUAL");
    expect(pool.queries[0].params).not.toContain("BROKER_EXECUTED");
    expect(pool.queries[0].sql).toContain("WHERE observation_id=$1 AND (outcome IS NULL OR outcome = 'null'::jsonb)");
    expect(pool.queries[0].sql).not.toContain("t0");
    expect(pool.queries[0].sql).not.toContain("critic_freeze");
  });

  it("is idempotent (second pass settles nothing and writes nothing)", async () => {
    const due = observation();
    const shadow = { list: () => [due] };
    const pool = fakePool();
    const engine = new ScenarioShadowSettlement({ scenarioShadow: shadow, pool, now: () => 1_000_000 });
    const candles = [candle(300_000, 1.10), candle(360_000, 1.20)];
    expect(engine.settleCausal({ marketKey: "EURUSD:OTC", candles, index: 1, nowMs: 1 })).toBe(1);
    expect(engine.settleCausal({ marketKey: "EURUSD:OTC", candles, index: 1, nowMs: 2 })).toBe(0);
    expect(pool.queries.length).toBe(1);
  });

  it("ignores other markets and non-prospective observations", () => {
    const otherMarket = observation({ id: "x", marketKey: "GBPUSD:OTC" });
    const historical = observation({ id: "y", provenance: "HISTORICAL" });
    const shadow = { list: () => [otherMarket, historical] };
    const engine = new ScenarioShadowSettlement({ scenarioShadow: shadow, pool: fakePool(), now: () => 1 });
    const candles = [candle(300_000, 1.10), candle(360_000, 1.20)];
    expect(engine.settleCausal({ marketKey: "EURUSD:OTC", candles, index: 1, nowMs: 1 })).toBe(0);
    expect(otherMarket.settlementBasis).toBeNull();
    expect(historical.settlementBasis).toBeNull();
  });
});

describe("isolamento observacional (fonte)", () => {
  it("settlement module never imports or mutates the frozen decision engine and never uses recordOutcome", () => {
    expect(MODULE_SOURCE).not.toMatch(/import[^;]*scenario-engine\.mjs/);
    expect(MODULE_SOURCE).not.toMatch(/import[^;]*scenario-shadow\.mjs/);
    expect(MODULE_SOURCE).not.toMatch(/=\s*["']BROKER_EXECUTED["']/);
    expect(SCENARIO_SHADOW_SETTLEMENT_BASIS).not.toBe("BROKER_EXECUTED");
    expect(MODULE_SOURCE).not.toMatch(/\.recordOutcome\s*\(/);
    expect(MODULE_SOURCE).not.toContain("requestOrder");
    expect(MODULE_SOURCE).not.toContain("placeOrder");
    expect(SCENARIO_SHADOW_SETTLEMENT_POLICY.controlsExecution).toBe(false);
    expect(SCENARIO_SHADOW_SETTLEMENT_POLICY.sendsOrders).toBe(false);
    expect(SCENARIO_SHADOW_SETTLEMENT_POLICY.brokerBasisForbidden).toBe(true);
  });

  it("runtime calls the observational settlement in the candle pipeline (skill: no strategy change)", () => {
    expect(RUNTIME_SOURCE).toContain("this.scenarioSettlement.settleCausal(");
    expect(RUNTIME_SOURCE).toContain("new ScenarioShadowSettlement(");
    expect(RUNTIME_SOURCE).toContain("settlement: this.scenarioSettlement.status()");
  });

  it("runtime re-observes intersections after LATE supersession/finalize (observability only)", () => {
    expect(RUNTIME_SOURCE).toContain("this.timingShadow.getByWindow(windowKey)");
    expect(RUNTIME_SOURCE).toContain("this.#observeScenarioTimingIntersection(previousTiming.candidateId)");
    expect(RUNTIME_SOURCE.match(/#observeScenarioTimingIntersectionsForMarket\(ctx\.marketKey\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("backfill script only writes the counterfactual basis and never broker", () => {
    expect(SCRIPT_SOURCE).toContain("SET outcome=$2::jsonb, settlement_basis='CAUSAL_COUNTERFACTUAL'");
    expect(SCRIPT_SOURCE).toContain("WHERE observation_id=$1 AND (outcome IS NULL OR outcome = 'null'::jsonb)");
    expect(SCRIPT_SOURCE).not.toMatch(/(SET|INSERT)[^`]*BROKER_EXECUTED/);
    expect(SCRIPT_SOURCE).not.toContain("recordOutcome");
  });
});
