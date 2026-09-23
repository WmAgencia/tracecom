/**
 * V3 — SIMETRIA DA SCENARIO LIBRARY (UP/DOWN sem privilegio de direcao).
 */
import { describe, expect, it } from "vitest";
import { measurementsFixture } from "./fixtures";
// @ts-expect-error - relay ESM sem tipagem
const scenariosModule = await import("../../relay/v3/scenarios.mjs");
// @ts-expect-error - relay ESM sem tipagem
const assetModule = await import("../../relay/v3/asset-agent.mjs");
// @ts-expect-error - relay ESM sem tipagem
const specialistsModule = await import("../../relay/v3/specialists.mjs");
const { evaluateScenario } = scenariosModule as any;
const { classifyAsset } = assetModule as any;
const { runSpecialists } = specialistsModule as any;

const swap = (value: string, map: Record<string, string>) => map[value] ?? value;

/** Espelha um snapshot de measurements (bullish <-> bearish) mantendo a logica estrutural. */
export function mirrorMeasurements(m: any) {
  const trend = m.structure.trend === "UPTREND" ? "DOWNTREND" : m.structure.trend === "DOWNTREND" ? "UPTREND" : m.structure.trend;
  const legLabels: Record<string, string> = { HH: "LL", LL: "HH", HL: "LH", LH: "HL" };
  return {
    ...m,
    structure: {
      ...m.structure,
      trend,
      swingLegs: (m.structure.swingLegs ?? []).map((leg: any) => ({ ...leg, label: swap(leg.label, legLabels) })),
      lastHigh: m.structure.lastLow, lastLow: m.structure.lastHigh,
      lastBOS: m.structure.lastBOS ? { ...m.structure.lastBOS, type: m.structure.lastBOS.type === "BULLISH_BOS" ? "BEARISH_BOS" : "BULLISH_BOS" } : null,
      lastCHoCH: m.structure.lastCHoCH ? { ...m.structure.lastCHoCH, type: m.structure.lastCHoCH.type === "BEARISH_CHOCH" ? "BULLISH_CHOCH" : "BEARISH_CHOCH" } : null,
    },
    rsi: { ...m.rsi, slope: m.rsi.slope === null ? null : -m.rsi.slope, crossback: m.rsi.crossback ? { ...m.rsi.crossback, direction: m.rsi.crossback.direction === "UP" ? "DOWN" : "UP" } : null },
    dmi: { ...m.dmi, plusDi: m.dmi.minusDi, minusDi: m.dmi.plusDi, spread: m.dmi.spread === null ? null : -m.dmi.spread, pressureChange: m.dmi.pressureChange === null ? null : -m.dmi.pressureChange, dominance: swap(m.dmi.dominance, { PLUS: "MINUS", MINUS: "PLUS" }), takeover: m.dmi.takeover ? swap(m.dmi.takeover, { PLUS_TOOK_OVER: "MINUS_TOOK_OVER", MINUS_TOOK_OVER: "PLUS_TOOK_OVER" }) : null },
    pullback: m.pullback ? { ...m.pullback, direction: swap(m.pullback.direction, { UP_TREND_PULLBACK: "DOWN_TREND_PULLBACK", DOWN_TREND_PULLBACK: "UP_TREND_PULLBACK" }), structureTrend: trend } : m.pullback,
    micro: { ...m.micro, direction: m.micro.direction === "UP" ? "DOWN" : "UP" },
    breakoutRetest: { ...m.breakoutRetest, breakout: m.breakoutRetest.breakdown === true, breakdown: m.breakoutRetest.breakout === true, failed: m.breakoutRetest.failed ? { ...m.breakoutRetest.failed, type: m.breakoutRetest.failed.type === "FAILED_BREAKOUT" ? "FAILED_BREAKDOWN" : "FAILED_BREAKOUT" } : null, resistance: m.breakoutRetest.support, support: m.breakoutRetest.resistance },
  };
}

describe("V3 scenario library — simetria tipo x direcao", () => {
  it("TREND_CONTINUATION: UP e DOWN com a mesma logica estrutural", () => {
    const up = measurementsFixture({ trend: "UPTREND", pullback: { active: false, direction: null, depth: null, distanceAtr: null, structureTrend: "UPTREND" } });
    const down = mirrorMeasurements(up);
    const upEval = evaluateScenario("TREND_CONTINUATION", up);
    const downEval = evaluateScenario("TREND_CONTINUATION", down);
    expect(upEval.matched).toBe(true);
    expect(downEval.matched).toBe(true);
    expect(upEval.direction).toBe("UP");
    expect(downEval.direction).toBe("DOWN");
    expect(downEval.supports).toBe(upEval.supports);
    expect(downEval.blockers).toEqual(upEval.blockers);
  });

  it("PULLBACK_CONTINUATION e TREND_RESUMPTION espelhados", () => {
    const up = measurementsFixture();
    const down = mirrorMeasurements(up);
    for (const scenario of ["PULLBACK_CONTINUATION", "TREND_RESUMPTION"]) {
      const upEval = evaluateScenario(scenario, up);
      const downEval = evaluateScenario(scenario, down);
      expect(upEval.matched, scenario).toBe(true);
      expect(downEval.matched, scenario).toBe(true);
      expect(upEval.direction, scenario).toBe("UP");
      expect(downEval.direction, scenario).toBe("DOWN");
      expect(downEval.supports, scenario).toBe(upEval.supports);
    }
  });

  it("STRUCTURAL_REVERSAL: BEARISH_CHOCH => DOWN; BULLISH_CHOCH => UP (espelhado)", () => {
    const bearish = measurementsFixture({ lastBOS: null, lastCHoCH: { type: "BEARISH_CHOCH", level: 1.348 }, dmi: { adx: 30, adxSlope: 1.2, plusDi: 15, minusDi: 32, spread: -17, strength: "STRONG", trendState: "STRENGTHENING", dominance: "MINUS", takeover: "MINUS_TOOK_OVER", pressureChange: -2, measurements: {} }, rsi: { value: 38, zone: "LOW", slope: -1.1, acceleration: -0.2, crossback: { direction: "DOWN" }, persistence: { side: "BELOW_50", candles: 5 }, failureSwing: null, momentum: "DETERIORATING", divergence: [], measurements: {} } });
    const bullish = mirrorMeasurements(bearish);
    const down = evaluateScenario("STRUCTURAL_REVERSAL", bearish);
    const up = evaluateScenario("STRUCTURAL_REVERSAL", bullish);
    expect(down.matched).toBe(true);
    expect(up.matched).toBe(true);
    expect(down.direction).toBe("DOWN");
    expect(up.direction).toBe("UP");
    expect(up.supports).toBe(down.supports);
  });

  it("DEEP_PULLBACK_STRUCTURE_THREAT espelhado (UP->defensivo SELL; DOWN->defensivo BUY)", () => {
    const up = measurementsFixture({ lastBOS: null, crossback: null, rsiSlope: -0.4, dmi: { adx: 24, adxSlope: -0.8, plusDi: 24, minusDi: 22, spread: 2, strength: "DEVELOPING", trendState: "WEAKENING", dominance: "BALANCED", takeover: null, pressureChange: -1, measurements: {} }, pullbackDepth: "DEEP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "DEEP", distanceAtr: 2.2, structureTrend: "UPTREND" }, micro: { bodyRatio: 0.3, closeInRange: 0.5, upperWickRatio: 0.3, lowerWickRatio: 0.3, direction: "UP", streak: 1, character: "MIXED" } });
    const down = mirrorMeasurements(up);
    const upEval = evaluateScenario("DEEP_PULLBACK_STRUCTURE_THREAT", up);
    const downEval = evaluateScenario("DEEP_PULLBACK_STRUCTURE_THREAT", down);
    expect(upEval.matched).toBe(true);
    expect(downEval.matched).toBe(true);
    expect(upEval.direction).toBe("UP");
    expect(downEval.direction).toBe("DOWN");
    const assetUp = classifyAsset({ measurements: up, specialists: runSpecialists({ measurements: up }) });
    const assetDown = classifyAsset({ measurements: down, specialists: runSpecialists({ measurements: down }) });
    expect(assetUp.state).toBe("SELL_CANDIDATE");
    expect(assetDown.state).toBe("BUY_CANDIDATE");
  });

  it("BREAKOUT UP vs BREAKDOWN DOWN; FAILED_BREAKOUT DOWN vs FAILED_BREAKDOWN UP", () => {
    const breakout = measurementsFixture({ breakoutRetest: { breakout: true, breakdown: false, retest: false, failed: null, resistance: 1.354, support: 1.348, measurements: { lookback: 30, closedAbove: 3, closedBelow: 0 } } });
    const failed = measurementsFixture({ breakoutRetest: { breakout: false, breakdown: false, retest: false, failed: { type: "FAILED_BREAKOUT", level: 1.354 }, resistance: 1.354, support: 1.348, measurements: {} } });
    const mirrored = mirrorMeasurements(breakout);
    const mirroredFailed = mirrorMeasurements(failed);
    expect(evaluateScenario("BREAKOUT", breakout).direction).toBe("UP");
    expect(evaluateScenario("BREAKDOWN", mirrored).direction).toBe("DOWN");
    expect(evaluateScenario("FAILED_BREAKOUT", failed).direction).toBe("DOWN");
    expect(evaluateScenario("FAILED_BREAKDOWN", mirroredFailed).direction).toBe("UP");
    expect(evaluateScenario("BREAKOUT", breakout).supports).toBe(evaluateScenario("BREAKDOWN", mirrored).supports);
    expect(evaluateScenario("FAILED_BREAKOUT", failed).supports).toBe(evaluateScenario("FAILED_BREAKDOWN", mirroredFailed).supports);
  });

  it("BREAKOUT_RETEST UP (resistencia) e DOWN (suporte apos breakdown)", () => {
    const up = measurementsFixture({ breakoutRetest: { breakout: true, breakdown: false, retest: true, failed: null, resistance: 1.354, support: 1.348, measurements: {} } });
    const down = mirrorMeasurements(up);
    const upEval = evaluateScenario("BREAKOUT_RETEST", up);
    const downEval = evaluateScenario("BREAKOUT_RETEST", down);
    expect(upEval.matched).toBe(true);
    expect(downEval.matched).toBe(true);
    expect(upEval.direction).toBe("UP");
    expect(downEval.direction).toBe("DOWN");
    expect(downEval.supports).toBe(upEval.supports);
  });

  it("nenhuma direcao privilegiada: classifyAsset espelha BUY_CANDIDATE/SELL_CANDIDATE", () => {
    const base = measurementsFixture();
    const mirrored = mirrorMeasurements(base);
    const assetBase = classifyAsset({ measurements: base, specialists: runSpecialists({ measurements: base }) });
    const assetMirror = classifyAsset({ measurements: mirrored, specialists: runSpecialists({ measurements: mirrored }) });
    expect(assetBase.scenario).toBe(assetMirror.scenario);
    expect(assetBase.direction).toBe("UP");
    expect(assetMirror.direction).toBe("DOWN");
    expect(assetBase.state).toBe("BUY_CANDIDATE");
    expect(assetMirror.state).toBe("SELL_CANDIDATE");
  });
});
