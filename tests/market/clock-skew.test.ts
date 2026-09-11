import { describe, expect, it } from "vitest";
import { applyClockSkewCorrection, estimateBinanceClockSkew } from "../../src/market/clock-skew";
import type { MarketCandle } from "../../src/market/model";

function c(ts: number, receivedAt = ts + 1_000): MarketCandle {
  return {
    provider: "binance",
    symbol: "BTCUSDT",
    timeframe: "1m",
    open: 100, high: 105, low: 98, close: 103,
    volume: 10,
    timestamp: ts,
    receivedAt,
    isClosed: true,
    source: "rest",
    quality: "high",
  };
}

describe("applyClockSkewCorrection", () => {
  it("caso 1: candles com 30s de skew → timestamps somam 30000ms", () => {
    const t0 = 1_700_000_000_000;
    const receivedAt = t0 + 1_000;
    const candles = [c(t0, receivedAt), c(t0 + 60_000, receivedAt), c(t0 + 120_000, receivedAt)];
    // serverTime está 30s à frente do receivedAt → offset positivo.
    const serverTime = receivedAt + 30_000;

    const result = applyClockSkewCorrection(candles, serverTime);

    expect(result.offsetMs).toBe(30_000);
    expect(result.droppedCount).toBe(0);
    expect(result.candles).toHaveLength(3);
    // Cada candle tem seu timestamp deslocado em +30s (offsetMs) em relação ao original.
    for (let i = 0; i < result.candles.length; i++) {
      expect(result.candles[i]!.timestamp - candles[i]!.timestamp).toBe(30_000);
    }
  });

  it("caso 2: candles com desvio > maxOffsetMs → são filtrados", () => {
    const t0 = 1_700_000_000_000;
    const receivedAt = t0 + 1_000;
    const candles = [c(t0, receivedAt), c(t0 + 60_000, receivedAt)];
    // serverTime 5 minutos à frente → 300_000ms > maxOffsetMs default 60_000.
    const serverTime = receivedAt + 300_000;
    const warnings: string[] = [];

    const result = applyClockSkewCorrection(candles, serverTime, {
      maxOffsetMs: 60_000,
      logger: (m) => warnings.push(m),
    });

    expect(result.candles).toHaveLength(0);
    expect(result.droppedCount).toBe(2);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("offset estimado");
  });

  it("caso 3: array vazio → retorna array vazio", () => {
    const result = applyClockSkewCorrection([], 1_700_000_000_000);
    expect(result.candles).toEqual([]);
    expect(result.offsetMs).toBe(0);
    expect(result.droppedCount).toBe(0);
  });

  it("caso 4: candles já alinhados (offset 0) → retorna candles inalterados (idempotência)", () => {
    const t0 = 1_700_000_000_000;
    const receivedAt = t0 + 1_000;
    const candles = [c(t0, receivedAt), c(t0 + 60_000, receivedAt)];
    // serverTime == max(receivedAt) → offset = 0.
    const result = applyClockSkewCorrection(candles, receivedAt);

    expect(result.offsetMs).toBe(0);
    expect(result.droppedCount).toBe(0);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]!.timestamp).toBe(candles[0]!.timestamp);
    expect(result.candles[1]!.timestamp).toBe(candles[1]!.timestamp);
    // Não é a mesma referência (é um novo array slice).
    expect(result.candles).not.toBe(candles);
  });

  it("bônus: não muta candles de entrada", () => {
    const t0 = 1_700_000_000_000;
    const receivedAt = t0 + 1_000;
    const candle = c(t0, receivedAt);
    const original = candle.timestamp;
    applyClockSkewCorrection([candle], receivedAt + 30_000);
    expect(candle.timestamp).toBe(original);
  });

  it("bônus: serverTimeMs inválido → no-op", () => {
    const t0 = 1_700_000_000_000;
    const receivedAt = t0 + 1_000;
    const candles = [c(t0, receivedAt)];
    const result = applyClockSkewCorrection(candles, Number.NaN);
    expect(result.offsetMs).toBe(0);
    expect(result.candles[0]!.timestamp).toBe(candles[0]!.timestamp);
  });
});

describe("estimateBinanceClockSkew", () => {
  it("retorna diferença entre serverTime e relógio local (mock)", async () => {
    const fixedLocal = 1_700_000_000_000;
    const fixedServer = fixedLocal + 5_000;
    const origNow = Date.now;
    Date.now = () => fixedLocal;
    try {
      const mockFetch: typeof fetch = (async (_url: string | URL | Request) => {
        return new Response(JSON.stringify({ serverTime: fixedServer }), { status: 200 });
      }) as typeof fetch;
      const skew = await estimateBinanceClockSkew(mockFetch);
      // midpoint = fixedLocal (before==after), logo skew ≈ 5000ms.
      expect(skew).toBe(5_000);
    } finally {
      Date.now = origNow;
    }
  });
});
