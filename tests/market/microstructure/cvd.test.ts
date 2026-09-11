import { describe, expect, it } from "vitest";
import { computeCVD, type CVDTrade } from "../../../src/market/microstructure/cvd";

function trade(isBuyerMaker: boolean, size: number, price = 100, timestamp = 0): CVDTrade {
  return { timestamp, price, size, isBuyerMaker };
}

describe("computeCVD — Cumulative Volume Delta", () => {
  it("Caso 1: 5 trades buyer, 0 seller → cvdNormalized = 1", () => {
    const trades: CVDTrade[] = [
      trade(false, 1, 100, 1),
      trade(false, 2, 101, 2),
      trade(false, 3, 102, 3),
      trade(false, 4, 103, 4),
      trade(false, 5, 104, 5),
    ];
    const result = computeCVD({ trades });
    expect(result.cvdNormalized).toBe(1);
    expect(result.cvd).toBe(15);
    expect(result.buyVolume).toBe(15);
    expect(result.sellVolume).toBe(0);
    expect(result.delta).toBe(15);
  });

  it("Caso 2: 0 buyer, 5 seller → cvdNormalized = -1", () => {
    const trades: CVDTrade[] = [
      trade(true, 1, 100, 1),
      trade(true, 2, 101, 2),
      trade(true, 3, 102, 3),
      trade(true, 4, 103, 4),
      trade(true, 5, 104, 5),
    ];
    const result = computeCVD({ trades });
    expect(result.cvdNormalized).toBe(-1);
    expect(result.cvd).toBe(-15);
    expect(result.buyVolume).toBe(0);
    expect(result.sellVolume).toBe(15);
    expect(result.delta).toBe(-15);
  });

  it("Caso 3: 50/50 mesmo size → cvdNormalized = 0", () => {
    const trades: CVDTrade[] = [
      trade(false, 10, 100, 1),
      trade(true, 10, 101, 2),
      trade(false, 10, 102, 3),
      trade(true, 10, 103, 4),
    ];
    const result = computeCVD({ trades });
    expect(result.cvdNormalized).toBe(0);
    expect(result.cvd).toBe(0);
    expect(result.delta).toBe(0);
    expect(result.buyVolume).toBe(20);
    expect(result.sellVolume).toBe(20);
  });

  it("Caso 4: array vazio → cvd = 0, deltas = 0", () => {
    const result = computeCVD({ trades: [] });
    expect(result.cvd).toBe(0);
    expect(result.buyVolume).toBe(0);
    expect(result.sellVolume).toBe(0);
    expect(result.delta).toBe(0);
    expect(result.cvdNormalized).toBe(0);
  });
});
