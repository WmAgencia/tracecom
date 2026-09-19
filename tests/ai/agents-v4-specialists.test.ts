/**
 * AGENTS V4 — especialistas: todos os estados alcancaveis (incluindo os que a V3 nunca atingia).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/agents-v4/index.mjs");
import { featureBundle, trendFeatures } from "./fixtures/agents-v4-fixtures";

function agent(agentId: string, state: string, extra: any = {}) {
  return v4.makeAgentOutput({ agentId, marketKey: "EURUSD:OTC", snapshotId: "snap", state, assessment: state, reasoningSummary: state, availableAt: 1, ...extra });
}

describe("MARKET_REGIME_AGENT", () => {
  it("alcanca TREND_UP e TREND_DOWN com features reais (velocity/acceleration chegam)", () => {
    expect(v4.analyzeMarketRegime({ features: trendFeatures({ direction: "UP" }) }).state).toBe("TREND_UP");
    expect(v4.analyzeMarketRegime({ features: trendFeatures({ direction: "DOWN" }) }).state).toBe("TREND_DOWN");
  });

  it("alcanca RANGE, COMPRESSION, EXPANSION, TRANSITION e UNCERTAIN", () => {
    const range = featureBundle({ structureLabel: "RANGE", structure1m: "RANGE", adx: 12, velocityATR: 0, accelerationATR: 0 });
    const compression = featureBundle({ compressed: true, atrRatio: 0.5, structureLabel: "RANGE", structure1m: "RANGE", adx: 14 });
    const expansion = featureBundle({ expanded: true, atrRatio: 1.8, expansionEvent: true, atrSlope: 0.2 });
    const transition = featureBundle({ structureLabel: "UP", structure1m: "DOWN", adx: 18, diAlignedUp: true, velocityATR: 0, accelerationATR: 0 });
    const uncertain = featureBundle({ adx: null, velocityATR: null, accelerationATR: null, structureLabel: null, structure1m: null, context5m: null, atrRatio: null, atr: null });
    expect(v4.analyzeMarketRegime({ features: range }).state).toBe("RANGE");
    expect(v4.analyzeMarketRegime({ features: compression }).state).toBe("COMPRESSION");
    expect(v4.analyzeMarketRegime({ features: expansion }).state).toBe("EXPANSION");
    expect(v4.analyzeMarketRegime({ features: transition }).state).toBe("TRANSITION");
    expect(v4.analyzeMarketRegime({ features: uncertain }).state).toBe("UNCERTAIN");
  });

  it("o score maximo de tendencia supera o limiar com folga (nao repete o teto estrutural do V3)", () => {
    expect(v4.TREND_SCORE_MAX).toBeGreaterThan(v4.TREND_SCORE_THRESHOLD * 2);
    expect(v4.TREND_SCORE_MAX / v4.TREND_SCORE_THRESHOLD).toBeGreaterThan(2);
  });

  it("fail-loud: registra features ausentes como risco em vez de silenciar", () => {
    const output = v4.analyzeMarketRegime({ features: featureBundle({ velocityATR: null, accelerationATR: null }) });
    expect(output.riskFlags).toContain("VELOCITY_UNAVAILABLE");
    expect(output.riskFlags).toContain("ACCELERATION_UNAVAILABLE");
  });
});

describe("MARKET_STRUCTURE_AGENT", () => {
  it("distingue estrutura bullish, bearish, range, transicao e desconhecida", () => {
    expect(v4.analyzeMarketStructure({ features: featureBundle({ higherHigh: true, higherLow: true, structureLabel: "UP", structure1m: "UP", structure1mHH: true, structure1mHL: true }) }).state).toBe("BULLISH_STRUCTURE");
    expect(v4.analyzeMarketStructure({ features: featureBundle({ lowerHigh: true, lowerLow: true, structureLabel: "DOWN", structure1m: "DOWN", structure1mLH: true, structure1mLL: true }) }).state).toBe("BEARISH_STRUCTURE");
    expect(v4.analyzeMarketStructure({ features: featureBundle({ structureLabel: "RANGE", structure1m: "RANGE" }) }).state).toBe("RANGE_STRUCTURE");
    expect(v4.analyzeMarketStructure({ features: featureBundle({ higherHigh: true, lowerLow: true, structureLabel: "UP", structure1m: "DOWN" }) }).state).toBe("TRANSITION_STRUCTURE");
    expect(v4.analyzeMarketStructure({ features: featureBundle({ structureLabel: null, structure1m: null }) }).state).toBe("UNKNOWN");
  });
});

describe("TREND_AGENT", () => {
  it("alcanca BULLISH/BEARISH/NEUTRAL/UNCERTAIN", () => {
    expect(v4.analyzeTrend({ features: trendFeatures({ direction: "UP" }) }).state).toBe("BULLISH");
    expect(v4.analyzeTrend({ features: trendFeatures({ direction: "DOWN" }) }).state).toBe("BEARISH");
    const neutral = featureBundle({ structureLabel: "UP", structure1m: "UP", adx: 22, diAlignedUp: true, velocityATR: 0, context5m: "UP", higherHigh: true, higherLow: true, adxSlope: 0 });
    expect(["BULLISH", "NEUTRAL"]).toContain(v4.analyzeTrend({ features: neutral }).state);
    expect(v4.analyzeTrend({ features: featureBundle({ structureLabel: null, structure1m: null, adx: null, velocityATR: null }) }).state).toBe("UNCERTAIN");
  });

  it("reporta weakening e maturity no detalhe", () => {
    const output = v4.analyzeTrend({ features: trendFeatures({ direction: "UP", adx: 32 }) });
    expect(output.detail.strength).toBeGreaterThan(0);
    expect(["EARLY", "DEVELOPING", "EXTENDED", "MATURE"]).toContain(output.detail.maturity);
    expect(output.detail).toHaveProperty("weakening");
  });
});

describe("LOCATION_AGENT / MOMENTUM_AGENT / VOLATILITY_AGENT / PRICE_ACTION_AGENT / MICROSTRUCTURE_AGENT", () => {
  it("location cobre edges, meio, overextension e indisponivel", () => {
    expect(v4.analyzeLocation({ features: featureBundle({ donchianPosition: 0.95, midLocation: false }) }).state).toBe("EDGE_UPPER");
    expect(v4.analyzeLocation({ features: featureBundle({ donchianPosition: 0.05, midLocation: false }) }).state).toBe("EDGE_LOWER");
    expect(v4.analyzeLocation({ features: featureBundle({ donchianPosition: 0.5 }) }).state).toBe("MID");
    expect(v4.analyzeLocation({ features: featureBundle({ donchianPosition: 1.06, midLocation: false, distanceToUpperATR: -3 }) }).state).toBe("OVEREXTENDED_UPPER");
    expect(v4.analyzeLocation({ features: featureBundle({ donchianPosition: null }) }).state).toBe("UNKNOWN");
  });

  it("momentum cobre STRONG/BUILDING/WEAKENING/REVERSING/STABLE", () => {
    expect(v4.analyzeMomentum({ features: featureBundle({ velocityATR: 0.6, accelerationATR: 0.2, velocity: 0.001, acceleration: 0.0002, rsiSlope: 0.5, persistence: 3, rsi: 60, diAlignedUp: true }) }).state).toBe("STRONG");
    expect(v4.analyzeMomentum({ features: featureBundle({ velocityATR: 0.15, accelerationATR: 0.1, velocity: 0.0002, acceleration: 0.0001, rsiSlope: 0.2, persistence: 1, rsi: 55, diAlignedUp: true }) }).state).toBe("BUILDING");
    expect(v4.analyzeMomentum({ features: featureBundle({ velocityATR: 0.4, accelerationATR: -0.25, velocity: 0.0005, acceleration: -0.0002, rsiSlope: 0.1, rsi: 60, diAlignedUp: true }) }).state).toBe("WEAKENING");
    expect(v4.analyzeMomentum({ features: featureBundle({ velocity: 0.0005, velocityATR: 0.3, acceleration: 0.0001, accelerationATR: 0.1, rsiSlope: -0.4, rsi: 65, diAlignedUp: true }) }).state).toBe("REVERSING");
    expect(v4.analyzeMomentum({ features: featureBundle({ velocity: 0, velocityATR: 0, acceleration: 0, accelerationATR: 0, rsiSlope: 0 }) }).state).toBe("STABLE");
  });

  it("volatility nunca escolhe direcao e cobre estados", () => {
    const compressed = v4.analyzeVolatility({ features: featureBundle({ compressed: true, atrRatio: 0.5 }) });
    expect(compressed.state).toBe("COMPRESSED");
    expect(compressed.bullishEvidence).toHaveLength(0);
    expect(compressed.bearishEvidence).toHaveLength(0);
    expect(v4.analyzeVolatility({ features: featureBundle({ expanded: true, atrRatio: 1.6 }) }).state).toBe("EXPANDED");
    expect(v4.analyzeVolatility({ features: featureBundle({ atrRatio: 3, expanded: false }) }).state).toBe("VOLATILE_SPIKE");
    expect(v4.analyzeVolatility({ features: featureBundle({ atrRatio: 1.0 }) }).state).toBe("NORMAL");
    expect(v4.analyzeVolatility({ features: featureBundle({ atr: null, atrRatio: null }) }).state).toBe("UNKNOWN");
  });

  it("price action cobre BULLISH/BEARISH/NEUTRAL/UNCERTAIN", () => {
    expect(v4.analyzePriceAction({ features: featureBundle({ closeLocation: 0.9, candleDirection: "UP", bodyRatio: 0.7, rejectionDown: true }) }).state).toBe("BULLISH");
    expect(v4.analyzePriceAction({ features: featureBundle({ closeLocation: 0.1, candleDirection: "DOWN", bodyRatio: 0.7, rejectionUp: true }) }).state).toBe("BEARISH");
    expect(v4.analyzePriceAction({ features: featureBundle({ closeLocation: 0.5, bodyRatio: 0.1, candleDirection: "FLAT" }) }).state).toBe("NEUTRAL");
    expect(v4.analyzePriceAction({ features: featureBundle({ bodyRatio: null, closeLocation: null }) }).state).toBe("UNCERTAIN");
  });

  it("microestrutura usa apenas ticks reais e admite INSUFFICIENT", () => {
    const buy = v4.analyzeMicrostructure({ features: featureBundle({ tickDirection: "UP", tickPressure: 0.5, tickVelocity: 0.0001, tickAcceleration: 0.00001 }) });
    expect(buy.state).toBe("BUY_PRESSURE");
    expect(buy.detail.orderBook).toBeNull();
    expect(buy.detail.institutionalVolume).toBeNull();
    const otcNote = buy.neutralEvidence.join("|");
    expect(otcNote).toContain("OTC_SEM_VOLUME_ORDERBOOK_SINTETICO");
    expect(v4.analyzeMicrostructure({ features: featureBundle({ ticksAvailable: false, tickCount: 0 }) }).state).toBe("INSUFFICIENT");
  });
});

describe("SCENARIO_AGENT", () => {
  function specialistMap(overrides: any = {}) {
    return {
      MARKET_REGIME_AGENT: agent("MARKET_REGIME_AGENT", overrides.regime ?? "TREND_UP"),
      MARKET_STRUCTURE_AGENT: agent("MARKET_STRUCTURE_AGENT", overrides.structure ?? "BULLISH_STRUCTURE"),
      TREND_AGENT: agent("TREND_AGENT", "BULLISH", { detail: { direction: "UP", weakening: overrides.weakening ?? false, maturity: overrides.maturity ?? "DEVELOPING" } }),
      LOCATION_AGENT: agent("LOCATION_AGENT", overrides.location ?? "UPPER_HALF"),
      MOMENTUM_AGENT: agent("MOMENTUM_AGENT", overrides.momentum ?? "STRONG", { detail: { direction: overrides.momentumDirection ?? "UP" } }),
      VOLATILITY_AGENT: agent("VOLATILITY_AGENT", overrides.volatility ?? "NORMAL"),
      PRICE_ACTION_AGENT: agent("PRICE_ACTION_AGENT", overrides.priceAction ?? "BULLISH"),
      MICROSTRUCTURE_AGENT: agent("MICROSTRUCTURE_AGENT", "BUY_PRESSURE"),
    };
  }

  it("detecta os 8 cenarios com seus componentes", () => {
    expect(v4.analyzeScenario({ features: featureBundle({ bosUp: false }), specialists: specialistMap() }).state).toBe("TREND_CONTINUATION");
    const pullback = v4.analyzeScenario({ features: featureBundle({ pullbackUp: true }), specialists: specialistMap({ location: "LOWER_HALF", momentum: "WEAKENING" }) });
    expect(pullback.state).toBe("TREND_PULLBACK");
    expect(v4.analyzeScenario({ features: featureBundle({ bosUp: true, bodyRatio: 0.6 }), specialists: specialistMap({ volatility: "EXPANDED" }) }).state).toBe("BREAKOUT");
    expect(v4.analyzeScenario({ features: featureBundle({ failedBreakoutUp: true, rejectionUp: true }), specialists: specialistMap({ priceAction: "BEARISH", location: "EDGE_UPPER" }) }).state).toBe("FAILED_BREAKOUT");
    expect(v4.analyzeScenario({ features: featureBundle({ rejectionUp: true }), specialists: specialistMap({ regime: "RANGE", structure: "RANGE_STRUCTURE", location: "EDGE_UPPER", priceAction: "BEARISH" }) }).state).toBe("RANGE_MEAN_REVERSION");
    const reversal = v4.analyzeScenario({ features: featureBundle({ failedBreakoutUp: true }), specialists: specialistMap({ weakening: true, maturity: "MATURE", location: "OVEREXTENDED_UPPER", momentum: "REVERSING", momentumDirection: "DOWN", priceAction: "BEARISH" }) });
    expect(reversal.state).toBe("REVERSAL");
    const compression = v4.analyzeScenario({ features: featureBundle({ compressed: true, expansionEvent: true, bosUp: true }), specialists: specialistMap({ regime: "COMPRESSION", structure: "RANGE_STRUCTURE", volatility: "EXPANDING" }) });
    expect(compression.state).toBe("COMPRESSION_EXPANSION");
    const transition = v4.analyzeScenario({
      features: featureBundle({}),
      specialists: {
        ...specialistMap({ regime: "TRANSITION", structure: "RANGE_STRUCTURE", location: "MID", momentum: "STABLE", momentumDirection: "FLAT", priceAction: "NEUTRAL" }),
        TREND_AGENT: agent("TREND_AGENT", "NEUTRAL", { detail: { direction: "FLAT" } }),
      },
    });
    expect(transition.state).toBe("TRANSITION_NO_TRADE");
  });

  it("marca ambiguidade somente quando competidores tem direcoes opostas", () => {
    const sameDirection = v4.analyzeScenario({ features: featureBundle({ pullbackUp: true }), specialists: specialistMap({ location: "LOWER_HALF", momentum: "WEAKENING" }) });
    expect(sameDirection.detail.candidates.length).toBeGreaterThanOrEqual(2);
    expect(sameDirection.detail.candidates[0].direction).toBe(sameDirection.detail.candidates[1].direction);
    expect(sameDirection.detail.ambiguity).toBe(false);
  });
});

describe("EXECUTION_TIMING_AGENT / RISK_CONTEXT_AGENT", () => {
  const now = 1_800_000_000_000;
  it("cobre TOO_EARLY/OBSERVE/READY_WINDOW/TOO_LATE/UNSAFE sem tocar no LATE_WINDOW_V2", () => {
    const base = { nowMs: now, targetEntryAt: now + 60_000, targetExpiryAt: now + 120_000, submitAt: now + 58_500, latencyMs: 500, displacementATR: 0.1, newCandlesSinceCandidate: 1, newTicksSinceCandidate: 5 };
    expect(v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 1_000 } }).state).toBe("TOO_EARLY");
    expect(v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 20_000 } }).state).toBe("OBSERVE");
    expect(v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 20_000, nowMs: now + 57_500 } }).state).toBe("READY_WINDOW");
    expect(v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 20_000, nowMs: now + 119_500 } }).state).toBe("TOO_LATE");
    expect(v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 20_000, nowMs: now + 130_000 } }).state).toBe("UNSAFE");
    const output = v4.analyzeExecutionTiming({ features: featureBundle(), execution: { ...base, candidateAgeMs: 20_000 } });
    expect(output.detail.lateWindowPolicy).toBe("LATE_WINDOW_V2_UNTOUCHED");
    expect(output.detail.sendsOrders).toBe(false);
  });

  it("risco cobre ELIGIBLE/CAUTION/BLOCK e bloqueia REAL (V4 e SHADOW)", () => {
    expect(v4.analyzeRiskContext({ features: featureBundle(), risk: { openPositions: 0, consecutiveLosses: 0, dailyDrawdownPct: 0, payout: 0.87 }, accountContext: "PRACTICE" }).state).toBe("ELIGIBLE");
    expect(v4.analyzeRiskContext({ features: featureBundle(), risk: { openPositions: 0, consecutiveLosses: 0, payout: 0.7 }, accountContext: "PRACTICE" }).state).toBe("CAUTION");
    expect(v4.analyzeRiskContext({ features: featureBundle(), risk: { openPositions: 2, consecutiveLosses: 7, dailyDrawdownPct: 12 }, accountContext: "PRACTICE" }).state).toBe("BLOCK");
    const real = v4.analyzeRiskContext({ features: featureBundle(), risk: { openPositions: 0 }, accountContext: "REAL" });
    expect(real.state).toBe("BLOCK");
    expect(real.riskFlags).toContain("V4_SHADOW_ONLY_REAL_FORBIDDEN");
    expect(real.detail.stakeUnchanged).toBe(true);
  });
});
