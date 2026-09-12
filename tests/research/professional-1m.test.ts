import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../src/market/model";
import { PROFESSIONAL_1M_PHASES, assertChronologicalPhaseWindows, buildProfessionalContext1m, evaluateProfessionalTrade, mineWinSignatures } from "../../src/research/professional-1m";

function candles(count = 30): MarketCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * 0.0001;
    return { provider: "test", symbol: "EUR/USD", timeframe: "1m", open: close - 0.00004, high: close + 0.00005, low: close - 0.00005, close, volume: 0, timestamp: 1_700_000_000_000 + i * 60_000, receivedAt: 1_700_000_000_000 + (i + 1) * 60_000, isClosed: true, source: "fixture", quality: "high" };
  });
}

describe("professional TRACE_1M research contracts", () => {
  it("locks the requested A-E sizes and final learning boundary", () => {
    expect(PROFESSIONAL_1M_PHASES.map((p) => p.targetActionable)).toEqual([1_000, 1_000, 1_000, 500, 100]);
    expect(PROFESSIONAL_1M_PHASES.at(-1)).toMatchObject({ id: "E", allowLearning: false, signatureInputVersion: "V4" });
  });

  it("uses only closed data at or before the planned entry", () => {
    const source = candles();
    const before = buildProfessionalContext1m(source, 20);
    const mutatedFuture = source.map((c, i) => i > 20 ? { ...c, close: c.close * 10, high: c.high * 10 } : c);
    expect(buildProfessionalContext1m(mutatedFuture, 20)).toEqual(before);
    expect(before.analysisAt).toBe(source[20]!.timestamp + 60_000);
  });

  it("never converts missing news, macro or microstructure into a false observation", () => {
    const context = buildProfessionalContext1m(candles(), 20);
    expect(context.features.NEWS_POINT_IN_TIME_AVAILABLE!.present).toBeNull();
    expect(context.features.MACRO_POINT_IN_TIME_AVAILABLE!.availability).toBe("NOT_AVAILABLE");
    expect(context.features.MICROSTRUCTURE_AVAILABLE!.availability).toBe("NOT_AVAILABLE");
  });

  it("applies the economic dead-zone before calling a trade a win", () => {
    const source = candles(); const context = buildProfessionalContext1m(source, 20);
    const tinyMove = { ...source[21]!, close: context.entryPrice * 1.00001 };
    const trade = evaluateProfessionalTrade(context, tinyMove, "A", 0.00022);
    expect(trade.outcome).toBe("LOSS");
    expect(trade.netReturn).toBeLessThan(0);
  });

  it("ranks signatures with support, lift, CI, EV and effective N", () => {
    const source = candles(); const base = buildProfessionalContext1m(source, 20);
    const rows = Array.from({ length: 60 }, (_, i) => ({ ...evaluateProfessionalTrade(base, source[21]!, "A", 0), outcome: i < 45 ? "WIN" as const : "LOSS" as const, netReturn: i < 45 ? 0.001 : -0.001, uniqueness: 0.5 }));
    const signatures = mineWinSignatures(rows, { minN: 30, maxFactors: 1 });
    expect(signatures[0]).toMatchObject({ n: 60, wins: 45, losses: 15, effectiveN: 30 });
    expect(signatures[0]!.confidence95[0]).toBeLessThan(0.75);
  });

  it("rejects overlapping future phases", () => {
    expect(() => assertChronologicalPhaseWindows([
      { phase: "A", from: 0, to: 10 }, { phase: "B", from: 10, to: 20 }, { phase: "C", from: 21, to: 30 }, { phase: "D", from: 31, to: 40 }, { phase: "E", from: 41, to: 50 },
    ])).toThrow("PROFESSIONAL_1M_PHASE_OVERLAP");
  });
});
