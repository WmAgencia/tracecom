import { describe, expect, it } from "vitest";
import { applyTrainingAnalysis, createTrainingSession, evaluateVirtualTrades, trainingSummary, type TrainingSession } from "../../src/training/session";

function makeSession(): TrainingSession {
  return createTrainingSession({ id: "training_test_1", symbol: "USD/CAD", marketType: "OTC", horizonSeconds: 60, maxEvaluatedTrades: 100 });
}

const analysis = (overrides: Record<string, unknown> = {}) => ({ analysisId: "vision_1", decision: "WAIT", directionalLean: "BUY", leanConfidence: .62, confidence: .62, dataQuality: .9, ...overrides });

describe("durable training session lifecycle", () => {
  it("creates an ACTIVE session with explicit lifecycle fields", () => {
    const session = makeSession();
    expect(session.status).toBe("ACTIVE");
    expect(session.updatedAt).toBeGreaterThan(0);
    expect(trainingSummary(session).persistence).toBe("MEMORY_FALLBACK");
  });

  it("persists a pending WAIT directional lean trade and survives a cold start", () => {
    const session = makeSession();
    const trade = applyTrainingAnalysis(session, { timestamp: 1_000, analysis: analysis(), reference: 1.387408, referenceSource: "IQ_OPTION_CURRENT_PRICE_LABEL", priceConfidence: .97, symbol: "USD/CAD" });
    expect(trade).toMatchObject({ direction: "BUY", counterfactual: true, shadowKind: "WAIT_DIRECTIONAL_LEAN", result: null, entryPriceSource: "IQ_OPTION_CURRENT_PRICE_LABEL" });
    // Simula cold start: a sessão é serializada/deserializada a partir do storage durável.
    const reloaded = JSON.parse(JSON.stringify(session)) as TrainingSession;
    expect(reloaded.trades).toHaveLength(1);
    expect(trainingSummary(reloaded).openVirtualTrades).toBe(1);
    evaluateVirtualTrades(reloaded, 61_000, 1.3879, "IQ_OPTION_CURRENT_PRICE_LABEL", .97);
    const summary = trainingSummary(reloaded);
    expect(summary.openVirtualTrades).toBe(0);
    expect(summary.directionalLeanEvaluated).toBe(1);
    expect(summary.directionalLeanWIN).toBe(1);
    expect(summary.directionalLeanWR).toBe(1);
  });

  it("creates operational BUY/SELL trades and settles them through settleTrade", () => {
    const session = makeSession();
    const trade = applyTrainingAnalysis(session, { timestamp: 1_000, analysis: analysis({ decision: "BUY", directionalLean: "BUY" }), reference: 1.387408, referenceSource: "VISION_PRICE_LABEL", priceConfidence: .98, symbol: "USD/CAD" });
    expect(trade).toMatchObject({ direction: "BUY", counterfactual: false, shadowKind: "DECISION" });
    evaluateVirtualTrades(session, 61_000, 1.3873, "VISION_PRICE_LABEL", .98);
    expect(trainingSummary(session).LOSS).toBe(1);
  });

  it("settles as UNKNOWN when no causal price exists at expiration", () => {
    const session = makeSession();
    applyTrainingAnalysis(session, { timestamp: 1_000, analysis: analysis(), reference: 1.387408, referenceSource: "VISION_PRICE_LABEL", priceConfidence: .97, symbol: "USD/CAD" });
    evaluateVirtualTrades(session, 61_000, null);
    const summary = trainingSummary(session);
    expect(summary.UNKNOWN).toBe(1);
    expect(summary.directionalLeanUNKNOWN).toBe(1);
    expect(summary.directionalLeanWR).toBeNull();
  });

  it("counts WAIT analyses even when no trade is created", () => {
    const session = makeSession();
    const trade = applyTrainingAnalysis(session, { timestamp: 1_000, analysis: analysis({ directionalLean: "NONE" }), reference: null, symbol: "USD/CAD" });
    expect(trade).toBeNull();
    expect(trainingSummary(session).WAIT).toBe(1);
    expect(trainingSummary(session).openVirtualTrades).toBe(0);
  });
});
