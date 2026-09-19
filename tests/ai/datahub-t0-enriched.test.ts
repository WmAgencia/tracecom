/**
 * T0 ENRIQUECIDO — completude (velocity/acceleration/swings/BOS/HTF/ticks), point-in-time
 * (availableAt <= decisionAt, zero future leakage), multi-timeframe honesto e provenance.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");
import { BASE_MS, CANDLE_MS, buildEnrichedT0, compressionCandles, rangeCandles, zigzagCandles } from "./fixtures/agents-v4-fixtures";

describe("T0 enriquecido (datahub)", () => {
  it("nao perde velocity/acceleration (gargalo diagnostico da V3)", () => {
    const candles = zigzagCandles({ dir: "UP" });
    const { t0 } = buildEnrichedT0({ candles });
    expect(t0.momentum.velocity).not.toBeNull();
    expect(t0.momentum.acceleration).not.toBeNull();
    expect(t0.momentum.velocity).toBeGreaterThan(0);
    expect(t0.featureProvenance["momentum.velocity"].status).toBe("OK");
    expect(t0.featureProvenance["momentum.acceleration"].status).toBe("OK");
  });

  it("expoe swings, HH/HL/LH/LL, BOS, suporte/resistencia e range", () => {
    const candles = zigzagCandles({ dir: "UP" });
    const { t0 } = buildEnrichedT0({ candles });
    expect(t0.structure.label).toBe("UP");
    expect(t0.structure.swings.length).toBeGreaterThan(0);
    expect(t0.structure.higherHigh).toBe(true);
    expect(t0.structure.higherLow).toBe(true);
    expect(t0.structure.bos).toBeTruthy();
    expect(t0.structure.range.high).not.toBeNull();
    expect(t0.featureProvenance["structure.bos"]).toBeTruthy();
  });

  it("deriva 1m/5m apenas de candles 5s fechados (candle nao fechado nunca aparece como fechado)", () => {
    const candles = zigzagCandles({ dir: "UP", steps: 180 });
    const decisionAt = (candles[candles.length - 1] as any).bucketStart + 2_000;
    const t0 = hub.buildT0Enriched({
      marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76, accountContext: "PRACTICE",
      decisionAt, price: (candles[candles.length - 1] as any).close, candles5s: candles, ticks: [],
      featureContext: null, structureFeatures: null,
    });
    expect(t0.candles5s.forming).not.toBeNull();
    expect(t0.candles5s.forming.closed).toBe(false);
    expect(t0.candles5s.closedCount).toBe(179);
    expect(t0.timeframes.structure1m.closedCount).toBeGreaterThanOrEqual(5);
    expect(t0.timeframes.structure1m.closedCount).toBeLessThan(180 / 12 + 1);
    expect(t0.timeframes.context5m.available).toBe(true);
  });

  it("availableAt <= decisionAt e zero future leakage", () => {
    const candles = zigzagCandles({ dir: "UP" });
    const { t0, decisionAt } = buildEnrichedT0({ candles });
    expect(t0.times.availableAt).toBeLessThanOrEqual(decisionAt);
    expect(t0.times.decisionAt).toBe(decisionAt);
    expect(hub.findFutureReferences(t0, decisionAt)).toEqual([]);
  });

  it("carrega proveniencia completa por feature (value/calculatedAt/availableAt/source/producer/formulaVersion)", () => {
    const candles = zigzagCandles({ dir: "UP" });
    const { t0 } = buildEnrichedT0({ candles });
    for (const [path, entry] of Object.entries(t0.featureProvenance) as Array<[string, any]>) {
      expect(entry, path).toMatchObject({
        status: expect.any(String),
        source: expect.any(String),
        producer: expect.any(String),
        formulaVersion: expect.any(String),
        calculatedAt: expect.any(Number),
      });
      if (entry.status !== "INSUFFICIENT_DATA") expect(entry.availableAt, path).toBeLessThanOrEqual(t0.times.decisionAt);
    }
    expect(t0.featureProvenance["indicators.rsi14"].producer).toBe("feature-engine-v1");
    expect(t0.featureProvenance["timeframes.structure1m"].source).toBe("CANDLE_5S_DERIVED");
  });

  it("microestrutura usa somente ticks reais e marca indisponivel sem ticks (OTC nunca inventa volume)", () => {
    const candles = rangeCandles();
    const { t0 } = buildEnrichedT0({ candles, ticks: [] });
    expect(t0.ticks.available).toBe(false);
    expect(t0.ticks.direction).toBeNull();
    expect(t0.flags.otcSyntheticVolume).toBe(false);
    const withTicks = buildEnrichedT0({ candles }).t0;
    expect(withTicks.ticks.available).toBe(true);
    expect(withTicks.featureProvenance["ticks.microstructure"].source).toBe("TICK_RING");
  });

  it("compression metrics expoem atrRatio/donchian/bollinger e estado", () => {
    const candidates = [zigzagCandles({ dir: "UP" }), compressionCandles(), rangeCandles()];
    for (const candles of candidates) {
      const { t0 } = buildEnrichedT0({ candles });
      expect(["COMPRESSED", "NORMAL", "EXPANDED"]).toContain(t0.compression.state);
      expect(t0.compression.atrRatio).not.toBeNull();
      expect(t0.indicators.bollinger.width).not.toBeNull();
    }
  });

  it("produz relatorio de cobertura por feature com NORMAL/OTC", () => {
    const otc = buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) }).t0;
    const normal = buildEnrichedT0({ candles: zigzagCandles({ dir: "DOWN", steps: 88 }), marketKey: "EURUSD:NORMAL", marketType: "NORMAL", activeId: 1 }).t0;
    const coverage = hub.computeFeatureCoverage([otc, normal]);
    expect(coverage.snapshots).toBe(2);
    expect(coverage.byMarketType.OTC).toBe(1);
    expect(coverage.byMarketType.NORMAL).toBe(1);
    const rsi = coverage.rows.find((row: any) => row.feature === "indicators.rsi14");
    expect(rsi.availablePct).toBe(100);
    expect(rsi.byType.OTC.availablePct).toBe(100);
  });

  it("mantem o candle em formacao fora do fechado e com idade", () => {
    const candles = zigzagCandles({ dir: "UP", steps: 88 });
    const lastStart = (candles[candles.length - 1] as any).bucketStart;
    const decisionAt = lastStart + 2_000;
    const t0 = hub.buildT0Enriched({
      marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76, decisionAt,
      price: (candles[candles.length - 1] as any).close, candles5s: candles, ticks: [],
    });
    expect(t0.candles5s.forming).not.toBeNull();
    expect(t0.candles5s.forming.bucketStart).toBe(lastStart);
    expect(t0.candles5s.forming.closed).toBe(false);
    expect(t0.candles5s.lastClosed === null || t0.candles5s.lastClosed.close !== t0.candles5s.forming.close).toBe(true);
  });
});
