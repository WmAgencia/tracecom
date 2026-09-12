import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

async function engine(): Promise<{ analyze: (symbol: string, item: unknown) => Record<string, unknown>; classifyOutcome: (decision: string, entry: number, exit: number) => string }> {
  const source = await readFile(new URL("../../extension/local-engine.js", import.meta.url), "utf8");
  const context: { TraceConLocalEngine?: { analyze: (symbol: string, item: unknown) => Record<string, unknown>; classifyOutcome: (decision: string, entry: number, exit: number) => string } } = {};
  runInNewContext(source, context);
  if (!context.TraceConLocalEngine) throw new Error("local engine did not initialize");
  return context.TraceConLocalEngine;
}

function item(closes: number[]) {
  return { lastFrameAt: Date.now(), lastPrice: closes.at(-1), lastPriceTimestamp: Date.now(), candles: closes.map((close, index) => ({ timeframe: "1m", timestamp: index * 60_000, open: close, high: close, low: close, close, volume: 0, isClosed: true })) };
}

describe("TRACE_CON offline local shadow engine", () => {
  it("returns WAIT until enough causal closed candles exist", async () => {
    const e = await engine();
    expect(e.analyze("EURUSD-OTC", item([1, 1, 1]))).toMatchObject({ decision: "WAIT", shadowEligible: false });
  });

  it("generates BUY and SELL from local candle replay", async () => {
    const e = await engine();
    expect(e.analyze("EURUSD-OTC", item(Array.from({ length: 12 }, (_, i) => 1 + i * 0.001)))).toMatchObject({ decision: "BUY", productionDecision: "WAIT", shadowEligible: true });
    expect(e.analyze("EURUSD-OTC", item(Array.from({ length: 12 }, (_, i) => 1.02 - i * 0.001)))).toMatchObject({ decision: "SELL", productionDecision: "WAIT", shadowEligible: true });
  });

  it("classifies offline outcomes and does not execute orders", async () => {
    const e = await engine();
    expect(e.classifyOutcome("BUY", 100, 101)).toBe("WIN");
    expect(e.classifyOutcome("SELL", 100, 99)).toBe("WIN");
    expect(e.classifyOutcome("BUY", 100, 100)).toBe("DRAW");
    expect(e.classifyOutcome("BUY", 100, 99)).toBe("LOSS");
  });
});
