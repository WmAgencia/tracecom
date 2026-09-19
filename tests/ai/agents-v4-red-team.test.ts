/**
 * RED TEAM V4 — fase cega congelada, comparacao com a Synthesis, conflito material => WAIT
 * e NUNCA inversao automatica de direcao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/agents-v4/index.mjs");
import { featureBundle } from "./fixtures/agents-v4-fixtures";

function agent(agentId: string, state: string, extra: any = {}) {
  return v4.makeAgentOutput({ agentId, marketKey: "EURUSD:OTC", snapshotId: "snap", state, assessment: state, reasoningSummary: state, availableAt: 1, ...extra });
}

function synthesisFixture(overrides: any = {}) {
  return {
    action: overrides.action ?? "BUY",
    direction: overrides.action ?? "BUY",
    primaryScenario: overrides.scenario ?? "TREND_PULLBACK",
    detail: { action: overrides.action ?? "BUY", direction: overrides.action ?? "BUY", primaryScenario: overrides.scenario ?? "TREND_PULLBACK" },
  };
}

describe("RED_TEAM_V4", () => {
  it("fase 1 e cega: nao ve Synthesis/especialistas e congela hash estavel", () => {
    const features = featureBundle({ structureLabel: "UP", structure1m: "UP", adx: 28, diAlignedUp: true, velocityATR: 0.5, accelerationATR: 0.2, pullbackUp: true, rsi: 55 });
    const first = v4.runRedTeamPhase1({ features, atMs: 1 });
    const second = v4.runRedTeamPhase1({ features, atMs: 2 });
    expect(first.seesSynthesis).toBe(false);
    expect(first.seesSpecialists).toBe(false);
    expect(first.frozenHash).toBe(second.frozenHash);
    expect(first.frozenHash).toHaveLength(64);
    const changed = v4.runRedTeamPhase1({ features: { ...features, structure1m: "DOWN" }, atMs: 1 });
    expect(changed.frozenHash).not.toBe(first.frozenHash);
  });

  it("conflito BREAKOUT vs FAILED_BREAKOUT e material; resolucao exige prova objetiva", () => {
    const synthesis = synthesisFixture({ scenario: "BREAKOUT", action: "BUY" });
    const phase1 = { scenario: "FAILED_BREAKOUT", direction: "SELL", regime: "RANGE", riskFlags: [], frozenHash: "h", action: "SELL" };
    const unresolved = v4.runRedTeamPhase2({ phase1, synthesis, specialists: {}, features: featureBundle({ failedBreakoutUp: true, bosUp: false }), atMs: 3 });
    expect(unresolved.conflicts.some((row: any) => row.type === "BREAKOUT_VS_FAILED_BREAKOUT" && row.unresolved)).toBe(true);
    expect(unresolved.verdict).toBe("CHALLENGED_UNRESOLVED");
    expect(unresolved.action).toBe("WAIT");
    expect(unresolved.direction).toBe("BUY");
    expect(unresolved.neverInvertsDirection).toBe(true);

    const specialists = {
      PRICE_ACTION_AGENT: agent("PRICE_ACTION_AGENT", "BULLISH"),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", "BULLISH_STRUCTURE"),
      LOCATION_AGENT: agent("LOCATION_AGENT", "UPPER_HALF"),
      VOLATILITY_AGENT: agent("VOLATILITY_AGENT", "EXPANDING"),
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { weakening: false, maturity: "DEVELOPING" } }),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", "STRONG", { detail: { direction: "UP" } }),
    };
    const resolved = v4.runRedTeamPhase2({ phase1, synthesis, specialists, features: featureBundle({ bosUp: true, bodyRatio: 0.7, failedBreakoutUp: false, overextended: false }), atMs: 4 });
    expect(resolved.verdict).toBe("CHALLENGED_RESOLVED");
    expect(resolved.action).toBe("BUY");
  });

  it("PULLBACK vs REVERSAL: tendencia intacta resolve; exaustao confirmada NAO resolve", () => {
    const synthesis = synthesisFixture({ scenario: "TREND_PULLBACK", action: "BUY" });
    const phase1 = { scenario: "REVERSAL", direction: "SELL", regime: "TREND_UP", riskFlags: ["OVEREXTENDED"], frozenHash: "h", action: "SELL" };
    const intact = {
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { weakening: false, maturity: "DEVELOPING" } }),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", "BULLISH_STRUCTURE"),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", "BUILDING", { detail: { direction: "UP" } }),
    };
    const resolved = v4.runRedTeamPhase2({ phase1, synthesis, specialists: intact, features: featureBundle(), atMs: 5 });
    expect(resolved.conflicts.find((row: any) => row.type === "PULLBACK_VS_REVERSAL").unresolved).toBe(false);
    expect(resolved.action).toBe("BUY");

    const exhausted = {
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { weakening: true, maturity: "MATURE" } }),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", "TRANSITION_STRUCTURE"),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", "REVERSING", { detail: { direction: "DOWN" } }),
    };
    const unresolved = v4.runRedTeamPhase2({ phase1, synthesis, specialists: exhausted, features: featureBundle(), atMs: 6 });
    expect(unresolved.unresolvedMaterial).toBeGreaterThan(0);
    expect(unresolved.action).toBe("WAIT");
  });

  it("CONTINUATION vs EXHAUSTION e TREND vs TRANSITION seguem as regras de resolucao", () => {
    const synthesis = synthesisFixture({ scenario: "TREND_CONTINUATION", action: "BUY" });
    const exhaustion = { scenario: "REVERSAL", direction: "SELL", regime: "TREND_UP", riskFlags: ["OVEREXTENDED"], frozenHash: "h", action: "SELL" };
    const strongMomentum = {
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { weakening: false, maturity: "DEVELOPING" } }),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", "STRONG", { detail: { direction: "UP" } }),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", "BULLISH_STRUCTURE"),
      PRICE_ACTION_AGENT: agent("PRICE_ACTION_AGENT", "BULLISH"),
    };
    const resolved = v4.runRedTeamPhase2({ phase1: exhaustion, synthesis, specialists: strongMomentum, features: featureBundle(), atMs: 7 });
    expect(resolved.action).toBe("BUY");
    const weak = {
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { weakening: true, maturity: "MATURE" } }),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", "REVERSING", { detail: { direction: "DOWN" } }),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", "TRANSITION_STRUCTURE"),
    };
    const unresolved = v4.runRedTeamPhase2({ phase1: exhaustion, synthesis, specialists: weak, features: featureBundle(), atMs: 8 });
    expect(unresolved.action).toBe("WAIT");
  });
});
