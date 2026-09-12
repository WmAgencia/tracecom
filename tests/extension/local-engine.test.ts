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

  it("generates BUY and SELL from causal local feature replay", async () => {
    const e = await engine();
    expect(e.analyze("EURUSD-OTC", item(Array.from({ length: 40 }, (_, i) => 1 + i * 0.001)))).toMatchObject({ decision: "BUY", productionDecision: "WAIT", shadowEligible: true });
    expect(e.analyze("EURUSD-OTC", item(Array.from({ length: 40 }, (_, i) => 1.04 - i * 0.001)))).toMatchObject({ decision: "SELL", productionDecision: "WAIT", shadowEligible: true });
  });

  it("uses discrete signatures and causal MTF/tick features", async () => {
    const e = await engine(); const prices = Array.from({ length: 45 }, (_, i) => 1 + i * 0.0007);
    const a: any = item(prices); a.ticks = Array.from({ length: 20 }, (_, i) => ({ timestamp: i * 1000, price: 1 + i * .0001 }));
    const b: any = item(prices.map((x) => x + 0.00000001)); b.ticks = a.ticks;
    const one: any = e.analyze("EURUSD", a); const two: any = e.analyze("EURUSD", b);
    expect(one.signature).toBe(two.signature); expect(one.features.mtf.direction5m).not.toBe("UNAVAILABLE"); expect(one.features.ticks.tickCount).toBe(20); expect(one.snapshot.candles).toHaveLength(30);
  });

  it("classifies offline outcomes and does not execute orders", async () => {
    const e = await engine();
    expect(e.classifyOutcome("BUY", 100, 101)).toBe("WIN");
    expect(e.classifyOutcome("SELL", 100, 99)).toBe("WIN");
    expect(e.classifyOutcome("BUY", 100, 100)).toBe("DRAW");
    expect(e.classifyOutcome("BUY", 100, 99)).toBe("LOSS");
  });
});
