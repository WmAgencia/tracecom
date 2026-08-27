import { describe, expect, it } from "vitest";
import { sma, ema, rsi, trueRange, atr, stdDev, lastValid } from "../../src/quant/math";

describe("math: SMA/EMA", () => {
  it("SMA de janela com pequena série", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("EMA converge (seed = SMA do período)", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    // seed no índice 2 = média(1,2,3)=2
    expect(e[2]).toBeCloseTo(2);
    expect(e[3]!).toBeCloseTo(2 * 0.5 + 4 * 0.5); // alpha = 2/(3+1)=0.5
  });
});

describe("math: RSI", () => {
  it("RSI = 100 quando só tem ganhos", () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14);
    expect(r[14]).toBe(100);
  });
  it("RSI em queda constante → próximo de 0", () => {
    const vals = Array.from({ length: 15 }, (_, i) => 20 - i);
    const r = rsi(vals, 14);
    expect(r[14]!).toBeCloseTo(0, 5);
  });
});

describe("math: TR / ATR", () => {
  it("True Range usa máx(high-low, |high-prevC|, |low-prevC|)", () => {
    // prev close 100, high 110, low 95 → candidatos: 15, 10, 5 → 15
    expect(trueRange([110], [95], [100])).toEqual([15]);
  });
  it("ATR com seed + Wilder smoothing", () => {
    const highs = [10, 11, 12, 13, 14, 15, 16];
    const lows = [9, 10, 11, 12, 13, 14, 15];
    const closes = [9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
    const a = atr(highs, lows, closes, 3);
    // TR[0]=max(1,|10-9.5|,|9-9.5|)=1; TR[1]=max(1,|11-10.5|,|10-10.5|)=1; igual p/ TR[2]
    // seed = média(1,1,1)=1. Recebemos 1.333? Verifica nossos TRs.
    const tr0 = trueRange([10], [9], [9.5])[0]!;
    expect(tr0).toBe(1);
    // o teste anterior assumia TRs=1; o engine calcula TR correto. Vamos validar que atr[2] fim é a média correta.
    const seed = (a[2] as number);
    const expected = (1 + 1.5 + 1.5) / 3; // TRs reais: [1, 1.5, 1.5]
    expect(seed).toBeCloseTo(expected, 5);
  });
});

describe("math: estatística", () => {
  it("stdDev amostral conhecido", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
  it("lastValid pega o último não-nulo", () => {
    expect(lastValid([null, null, 3, null, 5])).toBe(5);
    expect(lastValid([null, null])).toBeNull();
  });
});
