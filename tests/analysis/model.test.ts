import { describe, expect, it } from "vitest";
import { AnalysisBuilder, VERSION } from "../../src/analysis/model";

const instrument = {
  symbol: "BTCUSDT",
  label: "BTC/USDT",
  kind: "spot" as const,
  quote: "USDT",
  providerId: "test",
};

describe("AnalysisBuilder", () => {
  it("constrói análise com rastro de auditoria completo", () => {
    const a = new AnalysisBuilder({
      instrument,
      timeframe: "1m",
      horizon: "5 candles",
      input: "Analise BTC no 1m",
      version: VERSION,
    })
      .addStep("identify_instrument")
      .addStep("fetch_candles")
      .addObservation("RSI 55")
      .addIndicator("RSI=55")
      .addCalculation("atr=12.5")
      .addSource("get_candles")
      .addFavorable("volume crescendo")
      .addCounter("posição contra a tendência")
      .addInvalidator("romper suporte em 95000")
      .recordToolCall({
        tool: "get_candles",
        arguments: { symbol: "BTCUSDT", timeframe: "1m" },
        startedAt: 1000,
        finishedAt: 1100,
        availability: "AVAILABLE",
      })
      .build({ decision: { direction: "BUY", rationale: "evidências" } });

    expect(a.instrument.symbol).toBe("BTCUSDT");
    expect(a.decision.direction).toBe("BUY");
    expect(a.favorableFactors).toContain("volume crescendo");
    expect(a.counterFactors).toHaveLength(1);
    expect(a.invalidators).toHaveLength(1);
    expect(a.trail.steps).toContain("fetch_candles");
    expect(a.trail.toolCalls).toHaveLength(1);
    expect(a.trail.toolCalls[0]!.durationMs).toBe(100);
    expect(a.trail.sources).toEqual(["get_candles"]);
    expect(a.incomplete).toBe(false);
  });

  it("sem tool calls marca análise como incomplete (não fabrica conclusão)", () => {
    const a = new AnalysisBuilder({
      instrument,
      timeframe: "1h",
      horizon: "1 dia",
      input: "?",
      version: VERSION,
    }).build();
    expect(a.incomplete).toBe(true);
    expect(a.decision.direction).toBe("WAIT");
    expect(a.decision.rationale).toMatch(/sem dados/i);
    expect(a.trail.toolCalls).toHaveLength(0);
  });
});
