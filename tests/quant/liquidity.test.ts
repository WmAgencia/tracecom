import { describe, expect, it } from "vitest";
import { detectLiquidity } from "../../src/quant/liquidity";
import type { MarketCandle } from "../../src/market/model";
import type { SwingPoint } from "../../src/quant/types";

const BASE_TS = 1_700_000_000_000;

function makeCandle(
  index: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume = 100,
): MarketCandle {
  return {
    provider: "test",
    symbol: "BTCUSDT",
    timeframe: "1h",
    open: o,
    high: h,
    low: l,
    close: c,
    volume,
    timestamp: BASE_TS + index * 3_600_000,
    receivedAt: BASE_TS + index * 3_600_000,
    isClosed: true,
    source: "rest",
    quality: "high",
  };
}

function swing(index: number, price: number, kind: SwingPoint["kind"]): SwingPoint {
  return { index, timestamp: BASE_TS + index * 3_600_000, price, kind };
}

describe("liquidity: equal highs/lows + sweeps", () => {
  it("Caso 1 — equal highs: 2 swings highs no mesmo preço viram 1 nível com 2 touches", () => {
    // Subimos até 110, voltamos, subimos até 110.05 (dentro de 0.1%), voltamos.
    const candles: MarketCandle[] = [
      makeCandle(0, 100, 102, 99, 101),
      makeCandle(1, 101, 105, 100, 104),
      makeCandle(2, 104, 110, 103, 108),
      makeCandle(3, 108, 110, 105, 106),
      makeCandle(4, 106, 108, 104, 105),
      makeCandle(5, 105, 109, 104, 108),
      makeCandle(6, 108, 110.05, 107, 109),
    ];
    // 2 swing highs: candle 2 (110) e candle 6 (110.05)
    const swings: SwingPoint[] = [
      swing(2, 110, "HH"),
      swing(6, 110.05, "HH"),
    ];

    const result = detectLiquidity(candles, swings);
    const equalHigh = result.levels.find((l) => l.kind === "high");
    expect(equalHigh).toBeDefined();
    expect(equalHigh!.touches.length).toBe(2);
    expect(equalHigh!.swept).toBe(false);
  });

  it("Caso 2 — buy-side sweep: candle rompe high mas fecha abaixo", () => {
    // swing high em X=110 no candle 2; depois candle 3 com high=112 mas close=108
    const candles: MarketCandle[] = [
      makeCandle(0, 100, 102, 99, 101),
      makeCandle(1, 104, 110, 103, 108),
      makeCandle(2, 108, 109, 105, 106),
      makeCandle(3, 106, 110.03, 105, 108),
      makeCandle(4, 108, 112, 107, 108), // sweep do pool confirmado
    ];
    const swings: SwingPoint[] = [swing(1, 110, "HH"), swing(3, 110.03, "HH")];

    const result = detectLiquidity(candles, swings);
    const lvl = result.levels.find((l) => l.kind === "high");
    expect(lvl).toBeDefined();
    expect(lvl!.swept).toBe(true);
    expect(lvl!.sweepType).toBe("buy-side");
    expect(lvl!.sweptAt).toBe(candles[4]!.timestamp);
    expect(result.buySideSweeps.length).toBe(1);
    expect(result.buySideSweeps[0]!.level).toBeCloseTo(110.015);
  });

  it("Caso 3 — sem sweep: candle seguinte não rompe o nível", () => {
    const candles: MarketCandle[] = [
      makeCandle(0, 100, 102, 99, 101),
      makeCandle(1, 101, 110.02, 100, 104),
      makeCandle(2, 104, 110, 103, 108), // pivot high = 110
      makeCandle(3, 108, 109, 106, 107), // high=109 < 110, sem sweep
    ];
    const swings: SwingPoint[] = [swing(1, 110.02, "HH"), swing(2, 110, "HH")];

    const result = detectLiquidity(candles, swings);
    const lvl = result.levels.find((l) => l.kind === "high");
    expect(lvl).toBeDefined();
    expect(lvl!.swept).toBe(false);
    expect(lvl!.sweptAt).toBeNull();
    expect(lvl!.sweepType).toBeNull();
    expect(result.buySideSweeps.length).toBe(0);
  });

  it("Caso 4 — sweep fora do lookback (default 5) não é reportado", () => {
    // 12 candles no total. Pivot high em candle 2 (110). Sweep em candle 10 (10 candles depois).
    const candles: MarketCandle[] = [];
    for (let i = 0; i <= 11; i++) candles.push(makeCandle(i, 100 + i, 102 + i, 99 + i, 101 + i));
    candles[2] = makeCandle(2, 104, 110, 103, 108);
    candles[10] = makeCandle(10, 108, 115, 107, 108); // sweep longe (índice 10, lookback=5 → só conta 3..7)

    candles[1] = makeCandle(1, 104, 110.02, 103, 108);
    const swings: SwingPoint[] = [swing(1, 110.02, "HH"), swing(2, 110, "HH")];
    const result = detectLiquidity(candles, swings);
    const lvl = result.levels.find((l) => l.kind === "high");
    expect(lvl).toBeDefined();
    expect(lvl!.swept).toBe(false);
    expect(result.buySideSweeps.length).toBe(0);
  });

  it("Caso 5 — empty: array vazio retorna result vazio", () => {
    const result = detectLiquidity([], []);
    expect(result.levels.length).toBe(0);
    expect(result.buySideSweeps.length).toBe(0);
    expect(result.sellSideSweeps.length).toBe(0);
  });
});
