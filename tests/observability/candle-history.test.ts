/**
 * CANDLE HISTORY SEED — backfill real do broker sem fabricar dados:
 * so candles fechados, dedupe por bucketStart, buffer limitado, candle invalido ignorado.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const historyModule = await import("../../relay/intelligence/candle-history.mjs");
const { extractHistoryCandles, seedCandlesFromHistory, HISTORY_BACKFILL_CANDLES } = historyModule as any;

const normalize = (raw: any, { sizeSeconds = 5 }: any = {}) => ({
  bucketStart: raw.from, bucketEnd: raw.to, open: raw.open, high: raw.max, low: raw.min, close: raw.close, sizeSeconds,
});

describe("candle history — extracao e seed", () => {
  it("extrai candles[] e candles[5]; vazio quando nao ha", () => {
    expect(extractHistoryCandles({ candles: [{ from: 1 }] })).toHaveLength(1);
    expect(extractHistoryCandles({ candles: { "5": [{ from: 1 }, { from: 2 }] } })).toHaveLength(2);
    expect(extractHistoryCandles({ candles: {} })).toHaveLength(0);
    expect(extractHistoryCandles(null)).toHaveLength(0);
  });

  it("semeia apenas candles fechados, deduplica e limita o buffer", () => {
    const existing = new Map<any, any>();
    const serverNow = 1_000_000;
    const rows = [
      { from: 990_000, to: 995_000, open: 1, max: 2, min: 0.5, close: 1.5 },
      { from: 995_000, to: 1_000_000, open: 1, max: 2, min: 0.5, close: 1.6 },
      { from: 1_000_000, to: 1_005_000, open: 1, max: 2, min: 0.5, close: 1.7 }, // ainda aberto/futuro
      { from: 990_000, to: 995_000, open: 9, max: 9, min: 9, close: 9 },           // duplicado
      { from: 980_000, to: 985_000, open: 1, max: 2, min: 0.5, close: null },      // invalido
    ];
    const seeded = seedCandlesFromHistory({ existing, rows, sizeSeconds: 5, serverNow, maxBuffer: 10, normalize });
    expect(seeded.added).toBe(2);
    expect(seeded.skipped).toBe(3);
    expect(seeded.newest.bucketStart).toBe(995_000);
    expect(existing.size).toBe(2);
    expect(existing.get(990_000).close).toBe(1.5);
    expect(existing.get(990_000).source).toBe("BROKER_HISTORY");
    const big = new Map<any, any>();
    for (let index = 0; index < 20; index += 1) big.set(index * 5_000, { bucketStart: index * 5_000, bucketEnd: index * 5_000 + 5_000, close: 1 });
    seedCandlesFromHistory({ existing: big, rows: [{ from: 100_000, to: 105_000, open: 1, max: 1, min: 1, close: 1 }], serverNow: 200_000, maxBuffer: 10, normalize });
    expect(big.size).toBe(10);
    expect([...big.keys()].sort((a, b) => a - b)[0]).toBeGreaterThan(0);
  });

  it("HISTORY_BACKFILL_CANDLES cobre com margem o minimo do V3 (>=40)", () => {
    expect(HISTORY_BACKFILL_CANDLES).toBeGreaterThanOrEqual(120);
  });
});
