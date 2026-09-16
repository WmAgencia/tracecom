/** GOLDEN TESTS — estrategias congeladas V1/V2/V3/V8 (auditoria 2026-09-16).
 *
 * Fixture: janela real do dataset IQOPTION_EURUSD_BINARY_10H (prefixo exato, causal).
 * Valores esperados extraidos de spec-verify.json (replay que bateu 1:1 contra
 * iqopt_benchmark para V1/V2/V3). NUNCA alterar a estrategia para fazer o teste passar.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIN_FROZEN_INDEX,
  computeFrozenFeatures,
  fibOk,
  type FrozenCandle,
  type FrozenFeatures,
} from "../../src/strategies/features.js";
import {
  FROZEN_STRATEGIES,
  FROZEN_VARIANTS,
  evaluateCandlesAt,
  evaluateFrozenSignal,
  getFrozenStrategy,
  isValidVariant,
  settleFrozenAt,
} from "../../src/strategies/frozen.js";

interface Fixture {
  candles: FrozenCandle[];
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/frozen-candles-10h.json", import.meta.url), "utf8")) as Fixture;
const candles = fixture.candles;
const indexOfBucket = (iso: string): number => candles.findIndex((candle) => candle.bucket === Date.parse(iso));

const V3_BUCKET = "2026-09-15T07:11:10Z";
const V2_BUCKET = "2026-09-15T07:04:55Z";
const V8_BUCKET = "2026-09-15T07:04:50Z";

function featuresAt(iso: string): FrozenFeatures {
  const index = indexOfBucket(iso);
  expect(index).toBeGreaterThanOrEqual(MIN_FROZEN_INDEX);
  const features = computeFrozenFeatures(candles, index);
  expect(features).not.toBeNull();
  return features as FrozenFeatures;
}

describe("frozen features — golden (dados reais auditados)", () => {
  it("V3/V1 signal candle 2026-09-15T07:11:10Z reproduz a conta auditada", () => {
    const f = featuresAt(V3_BUCKET);
    expect(f.close).toBe(1.153695);
    expect(Math.abs(f.s - 0.3889)).toBeLessThan(0.0001);
    expect(Math.abs(f.vol12 - 0.00002797)).toBeLessThan(1e-8);
    expect(Math.abs(f.r24 - 0.00007802)).toBeLessThan(1e-8);
    expect(f.fib.hi).toBe(1.153785);
    expect(f.fib.lo).toBe(1.153595);
    expect(f.fib.upSwing).toBe(true);
    expect(f.fib.inZone).toBe(true);
    expect(f.fib.zoneLow).toBeCloseTo(1.15367, 5);
    expect(f.fib.zoneHigh).toBeCloseTo(1.15371, 5);
    expect(f.structureDown).toBe(true);
    expect(f.structureUp).toBe(false);
    expect(fibOk(f, "BUY")).toBe(true);
    expect(evaluateFrozenSignal("V3", f)).toBe("BUY");
    expect(evaluateFrozenSignal("V1", f)).toBe("BUY");
    expect(evaluateCandlesAt("V3", candles, f.index)).toBe("BUY");
  });

  it("V2 signal candle 2026-09-15T07:04:55Z reproduz a conta auditada (r24 == 0 → V3 WAIT)", () => {
    const f = featuresAt(V2_BUCKET);
    expect(f.close).toBe(1.153305);
    expect(Math.abs(f.s - 0.2889)).toBeLessThan(0.0001);
    expect(Math.abs(f.vol12 - 0.00002693)).toBeLessThan(1e-8);
    expect(Math.abs(f.r24)).toBeLessThan(1e-12);
    expect(f.fib.hi).toBe(1.1534);
    expect(f.fib.lo).toBe(1.153215);
    expect(f.fib.upSwing).toBe(true);
    expect(f.fib.inZone).toBe(true);
    expect(evaluateFrozenSignal("V2", f)).toBe("BUY");
    expect(evaluateFrozenSignal("V3", f)).toBeNull(); // Sem momentum (r24 == 0) a V3 nao dispara.
  });

  it("V8 signal candle 2026-09-15T07:04:50Z reproduz structureUp + fibOk", () => {
    const f = featuresAt(V8_BUCKET);
    expect(f.close).toBe(1.1533);
    expect(Math.abs(f.s - 0.0923)).toBeLessThan(0.0001);
    expect(f.structureUp).toBe(true);
    expect(f.structureDown).toBe(false);
    expect(f.fib.upSwing).toBe(true);
    expect(f.fib.inZone).toBe(true);
    expect(evaluateFrozenSignal("V8", f)).toBe("BUY");
  });

  it("candles anteriores ao warm-up retornam null (causalidade)", () => {
    expect(computeFrozenFeatures(candles, MIN_FROZEN_INDEX - 1)).toBeNull();
    expect(computeFrozenFeatures(candles, candles.length + 5)).toBeNull();
  });
});

function makeFeatures(overrides: Partial<Omit<FrozenFeatures, "fib">> & { fib?: Partial<FrozenFeatures["fib"]> }): FrozenFeatures {
  const base: FrozenFeatures = {
    index: 100,
    bucket: 0,
    close: 1.1,
    rsi14: 55,
    s: 0,
    vol12: 0.0001,
    r24: 0,
    fib: {
      hi: 1.2,
      lo: 1.0,
      range: 0.2,
      firstHighIndex: 90,
      firstLowIndex: 70,
      upSwing: true,
      level382: 1.1236,
      level618: 1.0764,
      zoneLow: 1.0764,
      zoneHigh: 1.1236,
      inZone: true,
    },
    pivotHighCount: 2,
    pivotLowCount: 2,
    structureUp: false,
    structureDown: false,
  };
  return { ...base, ...overrides, fib: { ...base.fib, ...(overrides.fib ?? {}) } };
}

describe("limiares congelados (fronteiras exatas)", () => {
  it("V1: vol12 < 0.0009 estrito; |s| > 0.33 estrito; fibOk obrigatorio", () => {
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: 0.5, vol12: 0.0009 }))).toBeNull();
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: 0.5, vol12: 0.000899 }))).toBe("BUY");
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: 0.33, vol12: 0.0005 }))).toBeNull();
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: 0.3301, vol12: 0.0005 }))).toBe("BUY");
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: -0.34, vol12: 0.0005, fib: { upSwing: false } }))).toBe("SELL");
    expect(evaluateFrozenSignal("V1", makeFeatures({ s: 0.5, vol12: 0.0005, fib: { inZone: false } }))).toBeNull();
  });

  it("V2: vol12 < 0.0012 estrito; |s| > 0.22 estrito (sem momentum)", () => {
    expect(evaluateFrozenSignal("V2", makeFeatures({ s: 0.5, vol12: 0.0012 }))).toBeNull();
    expect(evaluateFrozenSignal("V2", makeFeatures({ s: 0.5, vol12: 0.001199 }))).toBe("BUY");
    expect(evaluateFrozenSignal("V2", makeFeatures({ s: 0.22, vol12: 0.0005 }))).toBeNull();
    expect(evaluateFrozenSignal("V2", makeFeatures({ s: -0.2201, vol12: 0.0005, fib: { upSwing: false } }))).toBe("SELL");
    expect(evaluateFrozenSignal("V2", makeFeatures({ s: 0.5, vol12: 0.0005, fib: { upSwing: false } }))).toBeNull();
  });

  it("V3: vol12 < 0.0012 e momentum r24 com sinal obrigatorio", () => {
    expect(evaluateFrozenSignal("V3", makeFeatures({ s: 0.5, r24: 0, vol12: 0.0005 }))).toBeNull();
    expect(evaluateFrozenSignal("V3", makeFeatures({ s: 0.5, r24: 1e-9, vol12: 0.0005 }))).toBe("BUY");
    expect(evaluateFrozenSignal("V3", makeFeatures({ s: -0.5, r24: -1e-9, vol12: 0.0005, fib: { upSwing: false } }))).toBe("SELL");
    expect(evaluateFrozenSignal("V3", makeFeatures({ s: -0.5, r24: 1e-9, vol12: 0.0005, fib: { upSwing: false } }))).toBeNull();
    expect(evaluateFrozenSignal("V3", makeFeatures({ s: 0.5, r24: 1e-9, vol12: 0.0012 }))).toBeNull();
  });

  it("V8: exige estrutura + fibOk; SELL exige upSwing falso", () => {
    expect(evaluateFrozenSignal("V8", makeFeatures({}))).toBeNull();
    expect(evaluateFrozenSignal("V8", makeFeatures({ structureUp: true }))).toBe("BUY");
    expect(evaluateFrozenSignal("V8", makeFeatures({ structureDown: true }))).toBeNull(); // upSwing=true bloqueia SELL
    expect(evaluateFrozenSignal("V8", makeFeatures({ structureDown: true, fib: { upSwing: false } }))).toBe("SELL");
    expect(evaluateFrozenSignal("V8", makeFeatures({ structureUp: true, fib: { inZone: false } }))).toBeNull();
  });

  it("fibOk exato: inZone + alinhamento de swing", () => {
    expect(fibOk(makeFeatures({}), "BUY")).toBe(true);
    expect(fibOk(makeFeatures({}), "SELL")).toBe(false);
    expect(fibOk(makeFeatures({ fib: { upSwing: false } }), "SELL")).toBe(true);
    expect(fibOk(makeFeatures({ fib: { inZone: false, upSwing: false } }), "SELL")).toBe(false);
  });
});

describe("registry congelado", () => {
  it("hashes auditados por familia", () => {
    expect(getFrozenStrategy("V1").entryLogicHash).toBe("70a7bfcb568bec8c");
    expect(getFrozenStrategy("V2").entryLogicHash).toBe("6f8b9001c63b7597");
    expect(getFrozenStrategy("V3").entryLogicHash).toBe("acf733a866146537");
    expect(getFrozenStrategy("V8").entryLogicHash).toBe("712373de3372e158");
  });

  it("10 variantes exatamente: V3-45/60/120/180/300, V8-45/60, V2-60/120, V1-300", () => {
    expect(FROZEN_VARIANTS.map((variant) => variant.variantId)).toEqual([
      "V1-300",
      "V2-60",
      "V2-120",
      "V3-45",
      "V3-60",
      "V3-120",
      "V3-180",
      "V3-300",
      "V8-45",
      "V8-60",
    ]);
  });

  it("ENTRY_LOGIC_HASH identico entre horizontes da mesma familia (horizonte nao muda entrada)", () => {
    for (const strategy of FROZEN_STRATEGIES) {
      const hashes = new Set(strategy.horizons.map(() => strategy.entryLogicHash));
      expect(hashes.size).toBe(1);
    }
    expect(isValidVariant("V3", 60)).toBe(true);
    expect(isValidVariant("V3", 90)).toBe(false);
    expect(isValidVariant("V8", 120)).toBe(false);
    expect(isValidVariant("V2", 45)).toBe(false);
    expect(isValidVariant("V1", 60)).toBe(false);
    expect(isValidVariant("V1", 300)).toBe(true);
  });
});

describe("settlement exato por candle (T+H a partir do bucket do sinal)", () => {
  const synthetic: FrozenCandle[] = [
    { bucket: 1_000_000, open: 1, high: 1, low: 1, close: 1.0 },
    { bucket: 1_045_000, open: 1, high: 1, low: 1, close: 1.0005 },
    { bucket: 1_060_000, open: 1, high: 1, low: 1, close: 1.0 },
    { bucket: 1_120_000, open: 1, high: 1, low: 1, close: 0.9995 },
    { bucket: 1_180_000, open: 1, high: 1, low: 1, close: 1.002 },
  ];

  it("BUY vence com close maior, igual = DRAW, ausente = UNKNOWN", () => {
    expect(settleFrozenAt(synthetic, 1_000_000, 45, "BUY", 1.0).outcome).toBe("WIN");
    expect(settleFrozenAt(synthetic, 1_000_000, 60, "BUY", 1.0).outcome).toBe("DRAW");
    expect(settleFrozenAt(synthetic, 1_000_000, 120, "BUY", 1.0).outcome).toBe("LOSS");
    expect(settleFrozenAt(synthetic, 1_000_000, 300, "BUY", 1.0).outcome).toBe("UNKNOWN");
  });

  it("SELL inverte a direcao; usa SEMPRE o close do candle em bucket+H", () => {
    expect(settleFrozenAt(synthetic, 1_000_000, 120, "SELL", 1.0).outcome).toBe("WIN");
    expect(settleFrozenAt(synthetic, 1_000_000, 180, "SELL", 1.0).outcome).toBe("LOSS");
    const result = settleFrozenAt(synthetic, 1_000_000, 180, "BUY", 1.0);
    expect(result.settlementPrice).toBe(1.002);
    expect(result.settlementBucket).toBe(1_180_000);
  });
});
