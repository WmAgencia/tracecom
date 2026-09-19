/**
 * SYNTHESIS — gating por cenario (sem votacao burra), BUY/SELL/WAIT alcancaveis,
 * contexto bom sem trigger => WAIT, risco/dados bloqueiam.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/agents-v4/index.mjs");
import { featureBundle } from "./fixtures/agents-v4-fixtures";

function agent(agentId: string, state: string, extra: any = {}) {
  return v4.makeAgentOutput({ agentId, marketKey: "EURUSD:OTC", snapshotId: "snap", state, assessment: state, reasoningSummary: state, availableAt: 1, ...extra });
}

function bullishSpecialists(overrides: any = {}) {
  return {
    MARKET_REGIME_AGENT: agent("MARKET_REGIME_AGENT", "TREND_UP"),
    MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", overrides.structure ?? "BULLISH_STRUCTURE"),
    TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { direction: "UP", weakening: false, maturity: "DEVELOPING" } }),
    LOCATION_AGENT: agent("LOCATION_AGENT", overrides.location ?? "UPPER_HALF"),
    MOMENTUM_AGENT: agent("MOMENTUM_AGENT", overrides.momentum ?? "STRONG", { detail: { direction: overrides.momentumDirection ?? "UP" } }),
    VOLATILITY_AGENT: agent("VOLATILITY_AGENT", overrides.volatility ?? "NORMAL"),
    PRICE_ACTION_AGENT: agent("PRICE_ACTION_AGENT", overrides.priceAction ?? "BULLISH"),
    MICROSTRUCTURE_AGENT: agent("MICROSTRUCTURE_AGENT", overrides.microstructure ?? "BUY_PRESSURE"),
    RISK_CONTEXT_AGENT: agent("RISK_CONTEXT_AGENT", overrides.risk ?? "ELIGIBLE"),
    DATA_QUALITY_AGENT: agent("DATA_QUALITY_AGENT", overrides.dataQuality ?? "HEALTHY"),
  };
}

function scenarioAgent(overrides: any = {}) {
  const direction = overrides.direction ?? "BUY";
  const primary = overrides.primary ?? "TREND_CONTINUATION";
  const trigger = overrides.trigger === undefined ? "momentum_strong_a_favor" : overrides.trigger;
  return agent("SCENARIO_AGENT", primary, {
    detail: {
      primaryScenario: primary, secondaryScenario: overrides.secondary ?? null, competingScenario: overrides.competing ?? null,
      direction, trigger, ambiguity: overrides.ambiguity ?? false,
      candidates: [{ scenario: primary, score: overrides.score ?? 4.5, direction, evidenceFor: ["teste"], evidenceAgainst: [], trigger }],
      evidenceFor: ["teste"], evidenceAgainst: [],
    },
  });
}

describe("SYNTHESIS_AGENT", () => {
  it("BUY alcancavel com componentes fundamentais completos e trigger", () => {
    const specialists = { ...bullishSpecialists(), SCENARIO_AGENT: scenarioAgent() };
    const result = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(result.action).toBe("BUY");
    expect(result.triggerState).toBe("TRIGGERED");
    expect(result.whyNow).toBeTruthy();
    expect(result.supportingAgents.length).toBeGreaterThanOrEqual(3);
    expect(result.invalidation.length).toBeGreaterThan(0);
  });

  it("SELL alcancavel simetricamente", () => {
    const specialists = {
      ...bullishSpecialists({ structure: "BEARISH_STRUCTURE", location: "LOWER_HALF", momentumDirection: "DOWN", priceAction: "BEARISH", microstructure: "SELL_PRESSURE" }),
      MARKET_REGIME_AGENT: agent("MARKET_REGIME_AGENT", "TREND_DOWN"),
      TREND_AGENT: agent("TREND_AGENT", "BEARISH", { detail: { direction: "DOWN", weakening: false, maturity: "DEVELOPING" } }),
      SCENARIO_AGENT: scenarioAgent({ direction: "SELL" }),
    };
    const result = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(result.action).toBe("SELL");
    expect(result.whyNow).toBeTruthy();
  });

  it("WAIT alcancavel quando o cenario nao tem direcao acionavel", () => {
    const specialists = { ...bullishSpecialists(), SCENARIO_AGENT: scenarioAgent({ direction: null, primary: "TRANSITION_NO_TRADE", trigger: null }) };
    const result = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(result.action).toBe("WAIT");
    expect(result.whyNow).toBeTruthy();
  });

  it("sem votacao burra: 9 agentes bullish mas componente fundamental do cenario ausente => WAIT", () => {
    const specialists = { ...bullishSpecialists({ momentum: "STABLE" }), SCENARIO_AGENT: scenarioAgent() };
    const result = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(result.action).toBe("WAIT");
    expect(result.triggerState).toBe("SCENARIO_COMPONENT_MISSING");
    expect(result.supportingAgents.length).toBeGreaterThanOrEqual(7);
  });

  it("contexto bom sem trigger => WAIT (whyNow explica)", () => {
    const specialists = { ...bullishSpecialists(), SCENARIO_AGENT: scenarioAgent({ trigger: null }) };
    const result = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(result.action).toBe("WAIT");
    expect(result.triggerState).toBe("CONTEXT_OK_NO_TRIGGER");
  });

  it("risco BLOCK e dados UNSAFE bloqueiam (noTrade explicito)", () => {
    const specialists = { ...bullishSpecialists(), SCENARIO_AGENT: scenarioAgent() };
    const blocked = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "BLOCK", dataQualityState: "HEALTHY" });
    expect(blocked.action).toBe("WAIT");
    expect(blocked.triggerState).toBe("RISK_BLOCK");
    const unsafe = v4.synthesize({ features: featureBundle(), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "UNSAFE" });
    expect(unsafe.noTrade).toBe(true);
    expect(unsafe.triggerState).toBe("DATA_UNSAFE");
  });

  it("RANGE_MEAN_REVERSION exige rejeicao no extremo (nao basta localizacao)", () => {
    const specialists = {
      ...bullishSpecialists({ structure: "RANGE_STRUCTURE", location: "EDGE_UPPER", priceAction: "BEARISH" }),
      MARKET_REGIME_AGENT: agent("MARKET_REGIME_AGENT", "RANGE"),
      SCENARIO_AGENT: scenarioAgent({ primary: "RANGE_MEAN_REVERSION", direction: "SELL", score: 3.5 }),
    };
    const withoutRejection = v4.synthesize({ features: featureBundle({ rejectionUp: false }), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(withoutRejection.action).toBe("WAIT");
    const withRejection = v4.synthesize({ features: featureBundle({ rejectionUp: true }), specialists, scenario: specialists.SCENARIO_AGENT, riskState: "ELIGIBLE", dataQualityState: "HEALTHY" });
    expect(withRejection.action).toBe("SELL");
  });
});
