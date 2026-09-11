import { describe, expect, it } from "vitest";
import { computeOFI, type OFIBook } from "../../../src/market/microstructure/ofi";

function book(bids: [number, number][], asks: [number, number][]): OFIBook {
  return {
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
  };
}

describe("computeOFI — Order Flow Imbalance", () => {
  it("Caso 1: livros idênticos → OFI = 0", () => {
    const same = book(
      [
        [100, 10],
        [99, 8],
      ],
      [
        [101, 10],
        [102, 8],
      ],
    );
    const result = computeOFI({ prevBook: same, currBook: same });
    expect(result.ofi).toBe(0);
    expect(result.depthImbalance).toBe(0);
    expect(result.bidVolume).toBe(18);
    expect(result.askVolume).toBe(18);
  });

  it("Caso 2: bids aumentam 10x, asks inalteradas → OFI ≈ 1", () => {
    const prev = book(
      [
        [100, 10],
        [99, 8],
      ],
      [
        [101, 10],
        [102, 8],
      ],
    );
    const curr = book(
      [
        [100, 100],
        [99, 80],
      ],
      [
        [101, 10],
        [102, 8],
      ],
    );
    const result = computeOFI({ prevBook: prev, currBook: curr });
    // Bids cresceram (Δbid positivo), asks estáveis (Δask = 0).
    // bidVolume = 180, askVolume = 18 → normalizer = 99.
    // ofiRaw = (100-10) + (80-8) = 162. ofi = 162 / 99 = ~1.636, clampado a 1.
    expect(result.ofi).toBe(1);
    expect(result.depthImbalance).toBeGreaterThan(0);
    expect(result.bidVolume).toBe(180);
    expect(result.askVolume).toBe(18);
  });

  it("Caso 3: bids diminuem 100%, asks inalteradas → OFI ≈ -1", () => {
    const prev = book(
      [
        [100, 10],
        [99, 8],
      ],
      [
        [101, 10],
        [102, 8],
      ],
    );
    const curr = book(
      [
        [100, 0],
        [99, 0],
      ],
      [
        [101, 10],
        [102, 8],
      ],
    );
    const result = computeOFI({ prevBook: prev, currBook: curr });
    // Bids evaporaram → Δbid negativo forte; asks estáveis.
    // ofiRaw = −18, normalizer = 9 → ofi = −2, clampado a −1.
    expect(result.ofi).toBe(-1);
    expect(result.depthImbalance).toBeLessThan(0);
  });

  it("Caso 4: novo nível de preço aparece → contribui com seu size", () => {
    const prev = book(
      [
        [100, 10],
      ],
      [
        [101, 10],
      ],
    );
    // Novo nível 99 (bid) entra com 50, e novo nível 102 (ask) entra com 30.
    const curr = book(
      [
        [100, 10],
        [99, 50],
      ],
      [
        [101, 10],
        [102, 30],
      ],
    );
    const result = computeOFI({ prevBook: prev, currBook: curr, depth: 5 });
    // ofiRaw = (50 − 0) + (−30 − 0) = 20. bidVol = 60, askVol = 40, normalizer = 50.
    // ofi = 20 / 50 = 0.4
    expect(result.ofi).toBeCloseTo(0.4, 6);
    expect(result.bidVolume).toBe(60);
    expect(result.askVolume).toBe(40);
    expect(result.depthImbalance).toBeCloseTo(0.2, 6);
  });
});
