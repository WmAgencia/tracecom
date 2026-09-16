/** PARIDADE relay (.mjs) x TypeScript — garante uma unica semantica congelada.
 * O relay roda o mesmo motor (features/V1/V2/V3/V8/settlement) para os shadow engines.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeFrozenFeatures, type FrozenCandle } from "../../src/strategies/features.js";
import { evaluateFrozenSignal, settleFrozenAt } from "../../src/strategies/frozen.js";
// @ts-ignore - modulo ESM sem tipagem (validado em runtime por este teste)
import { computeFrozenFeatures as relayFeatures, evaluateFrozen, settleFrozen } from "../../relay/frozen-strategies.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/frozen-candles-10h.json", import.meta.url), "utf8")) as { candles: FrozenCandle[] };
const candles = fixture.candles.map((candle) => ({ start: candle.bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close, n: candle.ticks ?? 1 }));

describe("paridade relay x TS (frozen features/strategies)", () => {
  it("features identicas em toda a janela do fixture", () => {
    let checked = 0;
    for (let index = 0; index < candles.length; index += 1) {
      const ts = computeFrozenFeatures(candles.map((c) => ({ bucket: c.start, open: c.open, high: c.high, low: c.low, close: c.close })), index);
      const relay = relayFeatures(candles, index);
      if (ts === null || relay === null) {
        expect(ts === null && relay === null).toBe(true);
        continue;
      }
      expect(Math.abs(ts.s - relay.s)).toBeLessThan(1e-12);
      expect(Math.abs(ts.vol12 - relay.vol12)).toBeLessThan(1e-15);
      expect(Math.abs(ts.r24 - relay.r24)).toBeLessThan(1e-12);
      expect(ts.fib.upSwing).toBe(relay.fib.upSwing);
      expect(ts.fib.inZone).toBe(relay.fib.inZone);
      expect(ts.fib.hi).toBe(relay.fib.hi);
      expect(ts.fib.lo).toBe(relay.fib.lo);
      expect(ts.structureUp).toBe(relay.structureUp);
      expect(ts.structureDown).toBe(relay.structureDown);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("sinal identico para V1/V2/V3/V8 em toda a janela", () => {
    for (let index = 0; index < candles.length; index += 1) {
      const ts = computeFrozenFeatures(candles.map((c) => ({ bucket: c.start, open: c.open, high: c.high, low: c.low, close: c.close })), index);
      const relay = relayFeatures(candles, index);
      if (ts === null || relay === null) continue;
      expect(evaluateFrozenSignal("V1", ts)).toBe(evaluateFrozen("V1", relay));
      expect(evaluateFrozenSignal("V2", ts)).toBe(evaluateFrozen("V2", relay));
      expect(evaluateFrozenSignal("V3", ts)).toBe(evaluateFrozen("V3", relay));
      expect(evaluateFrozenSignal("V8", ts)).toBe(evaluateFrozen("V8", relay));
    }
  });

  it("settlement identico (WIN/LOSS/DRAW/UNKNOWN)", () => {
    const synthetic = [
      { bucket: 1_000_000, open: 1, high: 1, low: 1, close: 1.0 },
      { bucket: 1_045_000, open: 1, high: 1, low: 1, close: 1.0005 },
      { bucket: 1_060_000, open: 1, high: 1, low: 1, close: 1.0 },
      { bucket: 1_120_000, open: 1, high: 1, low: 1, close: 0.9995 },
    ];
    for (const horizon of [45, 60, 120, 180, 300]) {
      for (const direction of ["BUY", "SELL"] as const) {
        const settled = settleFrozenAt(synthetic, 1_000_000, horizon, direction, 1.0);
        const targetBucket = 1_000_000 + horizon * 1000;
        const candle = synthetic.find((c) => c.bucket === targetBucket);
        const relayOutcome = candle === undefined ? "UNKNOWN" : settleFrozen(direction, 1.0, candle.close);
        expect(settled.outcome).toBe(relayOutcome);
      }
    }
  });
});
