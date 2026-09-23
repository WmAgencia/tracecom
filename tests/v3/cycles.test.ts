/**
 * V3 — CICLOS (missoes 37/38): memoria por opportunity, mudanca de opiniao permitida,
 * contra-argumentacao, Final Challenge e a PROVA de que nao existe votacao.
 */
import { describe, expect, it } from "vitest";
import { measurementsFixture } from "./fixtures";
// @ts-expect-error - relay ESM sem tipagem
const specialistsModule = await import("../../relay/v3/specialists.mjs");
// @ts-expect-error - relay ESM sem tipagem
const assetModule = await import("../../relay/v3/asset-agent.mjs");
// @ts-expect-error - relay ESM sem tipagem
const consensusModule = await import("../../relay/v3/consensus.mjs");
// @ts-expect-error - relay ESM sem tipagem
const engineModule = await import("../../relay/v3/opportunity-engine.mjs");
const { runSpecialists, assertNoDirectionalLanguage } = specialistsModule as any;
const { classifyAsset } = assetModule as any;
const { runConsensus } = consensusModule as any;
const { ExpirationOpportunityEngine } = engineModule as any;

const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const EXP = BASE + 300_000;
const OPPORTUNITY_ID = `EURUSD:OTC@${new Date(EXP).toISOString()}`;

function cycleFor(overrides: Record<string, any> = {}, previous: any = null) {
  const measurements = measurementsFixture({ closedCandleAt: overrides.closedCandleAt ?? BASE, ...overrides });
  const previousByRole = { RSI: previous?.rsi, DMI_ADX: previous?.dmi, BOLLINGER: previous?.bollinger, ATR: previous?.atr, PRICE_ACTION: previous?.priceAction };
  const specialists = runSpecialists({ measurements, previousByRole });
  const asset = classifyAsset({ measurements, specialists, previousAssessment: previous?.asset ?? null });
  const consensus = runConsensus({ measurements, asset, timing: { ok: true, code: "ENTRY_WINDOW_OPEN", tteMs: 305_000 }, changedSincePreviousCycle: asset.changedSincePreviousCycle });
  return { measurements, specialists, asset, consensus };
}

describe("V3 ciclos — sequencia com mudanca de opiniao e log completo", () => {
  it("BUY_CANDIDATE ×2 -> WAIT -> BUY_CANDIDATE -> FINAL APPROVE_BUY (memoria por ciclo)", () => {
    const engine = new ExpirationOpportunityEngine({ now: () => EXP - 330_000 });
    engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: EXP - 330_000, deadtimeMs: 30_000 });

    const c1 = cycleFor({ closedCandleAt: BASE - 30_000 });
    expect(c1.asset.state).toBe("BUY_CANDIDATE");
    engine.recordCycle(OPPORTUNITY_ID, { at: BASE - 30_000, status: c1.asset.state, assetScenario: c1.asset.scenario, consensusResult: c1.consensus.result, agreement: c1.consensus.agreement, specialists: c1.specialists, asset: c1.asset, consensus: c1.consensus });

    const c2 = cycleFor({ closedCandleAt: BASE - 25_000 }, { ...c1.specialists, asset: c1.asset });
    expect(c2.asset.state).toBe("BUY_CANDIDATE");
    expect(c2.asset.changedSincePreviousCycle.length).toBe(0);
    engine.recordCycle(OPPORTUNITY_ID, { at: BASE - 25_000, status: c2.asset.state, assetScenario: c2.asset.scenario, consensusResult: c2.consensus.result, agreement: c2.consensus.agreement, specialists: c2.specialists, asset: c2.asset, consensus: c2.consensus });

    // Ciclo 3: forca direcional enfraquecendo e sem confirmacao de retomada => WAIT (opiniao anterior NAO tem autoridade)
    const c3 = cycleFor({ closedCandleAt: BASE - 20_000, crossback: null, rsiSlope: -0.4, adx: 18, adxSlope: -1.4, spread: 1, dominance: "BALANCED", trendState: "WEAKENING", pullbackActive: false, lastBOS: null }, { ...c2.specialists, asset: c2.asset });
    expect(c3.asset.state).toBe("WAIT");
    expect(c3.asset.changedSincePreviousCycle.some((change: any) => change.field === "state")).toBe(true);
    engine.recordCycle(OPPORTUNITY_ID, { at: BASE - 20_000, status: c3.asset.state, assetScenario: c3.asset.scenario, consensusResult: c3.consensus.result, agreement: c3.consensus.agreement, specialists: c3.specialists, asset: c3.asset, consensus: c3.consensus });

    const c4 = cycleFor({ closedCandleAt: BASE - 15_000 }, { ...c3.specialists, asset: c3.asset });
    expect(c4.asset.state).toBe("BUY_CANDIDATE");
    expect(c4.consensus.result).toBe("APPROVE_BUY");
    expect(c4.consensus.agreement).toBe("AGREE");
    engine.recordCycle(OPPORTUNITY_ID, { at: BASE - 15_000, status: c4.asset.state, assetScenario: c4.asset.scenario, consensusResult: c4.consensus.result, agreement: c4.consensus.agreement, specialists: c4.specialists, asset: c4.asset, consensus: c4.consensus });

    const opportunity = engine.get(OPPORTUNITY_ID)!;
    expect(opportunity.cycles).toHaveLength(4);
    expect(opportunity.cycles.map((cycle: any) => cycle.status)).toEqual(["BUY_CANDIDATE", "BUY_CANDIDATE", "WAIT", "BUY_CANDIDATE"]);
    expect(opportunity.cycles.every((cycle: any) => cycle.specialists?.rsi && cycle.asset?.scenario && cycle.consensus?.result)).toBe(true);

    engine.finalizeCycle(OPPORTUNITY_ID, { asset: c4.asset, consensus: c4.consensus, brokerNow: EXP - 302_000 });
    expect(engine.get(OPPORTUNITY_ID)!.status).toBe("APPROVED_BUY");
  });

  it("INVALIDATION estrutural mata a tese => CANCEL", () => {
    const measurements = measurementsFixture({ lastCHoCH: { type: "BEARISH_CHOCH", level: 1.348 }, lastBOS: null });
    const specialists = runSpecialists({ measurements });
    const asset = classifyAsset({ measurements, specialists });
    expect(asset.invalidations.some((item: any) => item.code === "BEARISH_CHOCH")).toBe(true);
    const consensus = runConsensus({ measurements, asset, timing: { ok: true, code: "ENTRY_WINDOW_OPEN" } });
    expect(consensus.result).toBe("CANCEL");
    expect(consensus.challenge.reasons).toContain("NO_INVALIDATIONS");
  });

  it("Asset BUY_CANDIDATE x Consensus independente (DISAGREE) => CANCEL", () => {
    const measurements = measurementsFixture();
    const specialists = runSpecialists({ measurements });
    const asset = classifyAsset({ measurements, specialists });
    expect(asset.state).toBe("BUY_CANDIDATE");
    const consensus = runConsensus({ measurements, asset, timing: { ok: true, code: "ENTRY_WINDOW_OPEN" } });
    if (consensus.agreement === "AGREE") expect(consensus.result).toBe("APPROVE_BUY");
    else expect(consensus.result).toBe("CANCEL");
    // Disagreement explicito: tese BUY com cenario independente defendendo baixa
    const bearish = measurementsFixture({ trend: "DOWNTREND", lastBOS: null, pullback: { active: false, direction: null, depth: null, distanceAtr: null, structureTrend: "DOWNTREND" }, dmi: { adx: 30, adxSlope: 1.2, plusDi: 15, minusDi: 32, spread: -17, strength: "STRONG", trendState: "STRENGTHENING", dominance: "MINUS", takeover: "MINUS_TOOK_OVER", pressureChange: -2, measurements: {} }, rsi: { value: 40, zone: "LOW", slope: -1.1, acceleration: -0.2, crossback: { direction: "DOWN" }, persistence: { side: "BELOW_50", candles: 5 }, failureSwing: null, momentum: "DETERIORATING", divergence: [], measurements: {} }, micro: { bodyRatio: 0.7, closeInRange: 0.2, upperWickRatio: 0.1, lowerWickRatio: 0.5, direction: "DOWN", streak: 3, character: "DECISIVE" } });
    const bearishSpecialists = runSpecialists({ measurements: bearish });
    const bearishAsset = classifyAsset({ measurements: bearish, specialists: bearishSpecialists });
    const mixed = runConsensus({ measurements: bearish, asset: { ...asset }, timing: { ok: true } });
    expect(["CANCEL"]).toContain(mixed.result);
    expect(bearishAsset.state).not.toBe(asset.state);
  });

  it("PROVA ANTI-VOTACAO: multiplas familias SUPPORT + 1 INVALIDATION estrutural => CANCEL", () => {
    const measurements = measurementsFixture({ lastCHoCH: { type: "BEARISH_CHOCH", level: 1.348 }, lastBOS: null });
    const specialists = runSpecialists({ measurements });
    const families = new Set([
      ...Object.values(specialists).flatMap((agent: any) => (agent?.supportingEvidence ?? []).map((item: any) => item.family)),
      ...(measurements.dmi?.dominance === "PLUS" ? ["DIRECTIONAL_PRESSURE"] : []),
    ]);
    expect(families.size).toBeGreaterThanOrEqual(4);
    const asset = classifyAsset({ measurements, specialists });
    const consensus = runConsensus({ measurements, asset, timing: { ok: true } });
    expect(consensus.result).toBe("CANCEL");
    expect(consensus.challenge.challengeSteps.find((step: any) => step.id === "NO_INVALIDATIONS").ok).toBe(false);
  });

  it("especialistas nunca respondem BUY/SELL/CALL/PUT", () => {
    const measurements = measurementsFixture();
    const specialists = runSpecialists({ measurements });
    for (const agent of Object.values(specialists)) {
      expect(assertNoDirectionalLanguage(JSON.stringify(agent))).toBe(true);
    }
  });
});

describe("V3 NO_SETUP vs WAIT", () => {
  it("range sem estrutura: primeiro ciclo FULL pode declarar NO_SETUP e encerrar a opportunity", () => {
    const engine = new ExpirationOpportunityEngine({ now: () => EXP - 330_000 });
    engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: EXP - 330_000, deadtimeMs: 30_000 });
    const measurements = measurementsFixture({ trend: "RANGE", pullbackActive: false, lastBOS: null, rsiSlope: 0.1, crossback: null, adx: 12, adxSlope: 0.1, spread: 1, dominance: "BALANCED", trendState: "FLAT", bandWalk: "MID", percentB: 0.5, impulse: { direction: "UP", netMove: 0.0001, normalized: 0.2, candles: 10, consecutiveDirection: 1, decelerating: false, classification: "COILED" }, breakoutRetest: { breakout: false, breakdown: false, retest: false, failed: null } });
    const specialists = runSpecialists({ measurements });
    const asset = classifyAsset({ measurements, specialists });
    expect(["NO_SETUP", "WAIT"]).toContain(asset.state);
    if (asset.state === "NO_SETUP") {
      engine.recordCycle(OPPORTUNITY_ID, { at: EXP - 330_000, status: asset.state, asset, specialists, consensus: null });
      engine.finalizeCycle(OPPORTUNITY_ID, { asset, consensus: { result: "CANCEL" }, brokerNow: EXP - 330_000 });
      const opportunity = engine.get(OPPORTUNITY_ID)!;
      expect(opportunity.status).toBe("NO_SETUP");
      expect(opportunity.closedReason).toBe("FIRST_FULL_CYCLE_NO_SETUP");
    }
  });

  it("WAIT continua os ciclos enquanto houver tempo", () => {
    const engine = new ExpirationOpportunityEngine({ now: () => EXP - 330_000 });
    engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: EXP - 330_000, deadtimeMs: 30_000 });
    const measurements = measurementsFixture({ crossback: null, rsiSlope: 0, pullbackActive: true, lastBOS: null, micro: { bodyRatio: 0.3, closeInRange: 0.5, upperWickRatio: 0.3, lowerWickRatio: 0.3, direction: "UP", streak: 1, character: "MIXED" }, dmi: { adx: 22, adxSlope: 0, plusDi: 24, minusDi: 22, spread: 2, strength: "DEVELOPING", trendState: "FLAT", dominance: "BALANCED", takeover: null, pressureChange: 0, measurements: {} } });
    const specialists = runSpecialists({ measurements });
    const asset = classifyAsset({ measurements, specialists });
    expect(asset.state).toBe("WAIT");
    engine.recordCycle(OPPORTUNITY_ID, { at: EXP - 330_000, status: "WAIT", asset, specialists, consensus: null });
    expect(engine.get(OPPORTUNITY_ID)!.status).toBe("WAIT");
    expect(engine.get(OPPORTUNITY_ID)!.closedAt).toBeNull();
  });
});
