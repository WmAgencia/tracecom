/** CRITIC QUANT — validacao matematica do Feature Engine deterministico (sem LLM, sem futuro). */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const engine = await import("../../relay/feature-engine.mjs");
const { adxWilder, atrWilder, buildFeatureContext, donchian, freshnessGate, microstructure, rsiWilder } = engine as unknown as {
  rsiWilder: (closes: number[], period?: number) => number | null;
  atrWilder: (candles: Array<{ open: number; high: number; low: number; close: number }>, period?: number) => number | null;
  adxWilder: (candles: Array<{ open: number; high: number; low: number; close: number }>, period?: number) => { adx: number; plusDI: number; minusDI: number } | null;
  donchian: (candles: Array<{ high: number; low: number; close: number }>, period?: number) => { upper: number; middle: number; lower: number; width: number; position: number } | null;
  microstructure: (candles: Array<{ open: number; high: number; low: number; close: number }>, window?: number) => Record<string, unknown> | null;
  buildFeatureContext: (input: Record<string, unknown>) => Record<string, unknown>;
  freshnessGate: (context: Record<string, unknown>, maxAgeMs?: number, horizonSeconds?: number) => { fresh: boolean; reason: string; maxAgeMs?: number; ageMs?: number };
};

const candle = (open: number, high: number, low: number, close: number, start = 0) => ({ open, high, low, close, start });

describe("RSI Wilder(14)", () => {
  it("serie classica de referencia → primeiro RSI ~70 (tolerancia Wilder)", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const value = rsiWilder(closes, 14) as number;
    expect(value).toBeGreaterThan(69);
    expect(value).toBeLessThan(72.5);
  });
  it("serie estritamente crescente → 100; dados insuficientes → null", () => {
    expect(rsiWilder(Array.from({ length: 20 }, (_, index) => 1 + index * 0.001), 14)).toBe(100);
    expect(rsiWilder([1, 2, 3], 14)).toBeNull();
  });
});

describe("ATR Wilder(14)", () => {
  it("range constante sem gaps → ATR = range", () => {
    const candles = Array.from({ length: 20 }, () => candle(1, 1.5, 0.5, 1.2));
    expect(atrWilder(candles, 14)).toBeCloseTo(1.0, 10);
  });
  it("insuficiente → null", () => { expect(atrWilder([candle(1, 2, 0.5, 1)], 14)).toBeNull(); });
});

describe("Donchian(20)", () => {
  it("upper/lower/middle/position exatos", () => {
    const candles = Array.from({ length: 20 }, (_, index) => candle(index, 10 + index, 5 - index * 0.1, 8));
    const channel = donchian(candles, 20) as { upper: number; middle: number; lower: number; width: number; position: number };
    expect(channel.upper).toBe(29);      // high do ultimo candle (10+19)
    expect(channel.middle).toBeCloseTo((29 + (5 - 19 * 0.1)) / 2, 10);
    expect(channel.lower).toBeCloseTo(5 - 1.9, 10);
    expect(channel.position).toBeGreaterThan(0);
    expect(channel.position).toBeLessThanOrEqual(1);
  });
  it("insuficiente → null", () => { expect(donchian([candle(1, 2, 0.5, 1)], 20)).toBeNull(); });
});

describe("ADX(14)", () => {
  it("tendencia de alta forte → ADX > 0 e +DI > -DI", () => {
    const candles = Array.from({ length: 60 }, (_, index) => { const base = 1 + index * 0.002; return candle(base, base + 0.003, base - 0.0005, base + 0.0025, index * 5000); });
    const result = adxWilder(candles, 14) as { adx: number; plusDI: number; minusDI: number };
    expect(result.adx).toBeGreaterThan(0);
    expect(result.plusDI).toBeGreaterThan(result.minusDI);
  });
  it("dados insuficientes → null (nunca inventa)", () => { expect(adxWilder(Array.from({ length: 10 }, () => candle(1, 2, 0.5, 1)), 14)).toBeNull(); });
});

describe("microestrutura e contexto deterministico", () => {
  it("streak/viés dos ultimos candles e wicks", () => {
    const candles = [candle(1, 1.1, 0.9, 1.05), candle(1.05, 1.2, 1.0, 1.15), candle(1.15, 1.3, 1.1, 1.25), candle(1.25, 1.4, 1.2, 1.35), candle(1.35, 1.5, 1.3, 1.45), candle(1.45, 1.5, 1.2, 1.4)];
    const micro = microstructure(candles, 6) as Record<string, unknown>;
    expect(String(micro.directionSequence)).toMatch(/[+-]/);
    expect(micro.returnOverWindow).toBeGreaterThan(0);
    expect(Number(micro.downWickRatio)).toBeGreaterThan(0);
  });
  it("buildFeatureContext marca provenance e INSUFFICIENT_DATA corretamente", () => {
    const context = buildFeatureContext({ candles: [], now: 1000, frameCapturedAt: 500, vision: null }) as Record<string, any>;
    expect(context.deterministicIndicators.rsi14).toMatchObject({ value: null, status: "INSUFFICIENT_DATA", source: "UNAVAILABLE" });
    expect(context.causalPrice.value).toBeNull();
    const rich = buildFeatureContext({ candles: Array.from({ length: 60 }, (_, index) => candle(1 + index * 0.001, 1.01 + index * 0.001, 0.99 + index * 0.001, 1.005 + index * 0.001, index * 5000)), now: 1000, frameCapturedAt: 900 }) as Record<string, any>;
    expect(rich.deterministicIndicators.rsi14.source).toBe("DETERMINISTIC_CALCULATION");
    expect(rich.deterministicIndicators.rsi14.value).not.toBeNull();
    expect(rich.deterministicIndicators.donchianPosition.value).toBeGreaterThanOrEqual(0);
  });
  it("FRESHNESS GATE: projetado do horizonte (nunca aceita age >= horizonte) — decisao atrasada vira STALE_ANALYSIS", () => {
    const fresh = buildFeatureContext({ candles: [], now: 30_000, frameCapturedAt: 25_000 }) as Record<string, any>;
    expect(freshnessGate(fresh).fresh).toBe(true);
    const nearHorizon = buildFeatureContext({ candles: [], now: 130_000, frameCapturedAt: 70_000 }) as Record<string, any>;
    expect(freshnessGate(nearHorizon)).toMatchObject({ fresh: false, reason: "STALE_ANALYSIS" }); // age 60s >= horizonte 60s
    const stale = buildFeatureContext({ candles: [], now: 200_000, frameCapturedAt: 60_000 }) as Record<string, any>;
    expect(freshnessGate(stale)).toMatchObject({ fresh: false, reason: "STALE_ANALYSIS" });
    const unknown = buildFeatureContext({ candles: [], now: 1000, frameCapturedAt: null }) as Record<string, any>;
    expect(freshnessGate(unknown)).toMatchObject({ fresh: false, reason: "FRAME_TIMESTAMP_UNAVAILABLE" });
    // invariante: effectiveMax SEMPRE < horizonte
    const gate = freshnessGate(fresh, 999_999, 60) as { maxAgeMs: number };
    expect(gate.maxAgeMs).toBeLessThan(60_000);
  });
  it("GOLDEN FIXTURE §17: midpoint ask/bid corrobora o preco 1.153700 exatamente", () => {
    expect((1.153710 + 1.153690) / 2).toBeCloseTo(1.153700, 10);
    const context = buildFeatureContext({ candles: [candle(1.153690, 1.153720, 1.153680, 1.153700, 0)], now: 1000, frameCapturedAt: 900 }) as Record<string, any>;
    expect(context.causalPrice.value).toBe(1.153700);
    expect(context.causalPrice.source).toBe("DETERMINISTIC_CALCULATION");
  });
});
