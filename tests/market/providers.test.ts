import { describe, expect, it } from "vitest";
import { MockedProvider } from "../../src/market/providers/mocked";
import { NoopProvider } from "../../src/market/providers/noop";
import { createMarketDataProvider } from "../../src/market/registry";
import type { Candle } from "../../src/domain/types";

const instrument = {
  symbol: "BTCUSDT",
  label: "BTC/USDT",
  kind: "spot" as const,
  quote: "USDT",
  providerId: "test",
};

describe("NoopProvider", () => {
  it("retorna DATA_UNAVAILABLE para toda leitura (nunca inventa)", async () => {
    const p = new NoopProvider();
    const res = await p.candles({ instrument });
    expect(res.availability).toBe("UNAVAILABLE");
    expect(res.payload).toBeUndefined();
    expect(res.message).toMatch(/noop/i);
  });
});

describe("MockedProvider (somente testes)", () => {
  it("gera candles historicamente determinísticos para a mesma seed", async () => {
    const p = MockedProvider.synthetic(instrument);
    const a = await p.candles({ instrument, timeframe: "1h", limit: 50 });
    const b = await p.candles({ instrument, timeframe: "1h", limit: 50 });
    expect(a.availability).toBe("AVAILABLE");
    // OHLC/volume são determinísticos (mesma seed); timestamps relativos não.
    const pa = a.payload as { open: number; high: number; low: number; close: number; volume: number }[];
    const pb = b.payload as { open: number; high: number; low: number; close: number; volume: number }[];
    expect(pa.map((c) => c.close)).toEqual(pb.map((c) => c.close));
    expect(pa.map((c) => c.volume)).toEqual(pb.map((c) => c.volume));
  });

  it("candles respeitam limit e horizonte temporal", async () => {
    const p = MockedProvider.synthetic(instrument);
    const res = await p.candles({ instrument, timeframe: "1h", limit: 100 });
    const candles = res.payload as Candle[];
    expect(candles.length).toBe(100);
    const step = 3_600_000;
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp - candles[i - 1]!.timestamp).toBe(step);
    }
  });

  it("order_book retorna UNAVAILABLE (não simula book real)", async () => {
    const p = MockedProvider.synthetic(instrument);
    const res = await p.orderBook({ instrument });
    expect(res.availability).toBe("UNAVAILABLE");
  });
});

describe("createMarketDataProvider", () => {
  it("noop quando dados não conectados (produção)", () => {
    const p = createMarketDataProvider("noop");
    expect(p.available).toBe(false);
    expect(p.id).toBe("noop");
  });
  it("mocked apenas quando explicitamente solicitado (testes)", () => {
    const p = createMarketDataProvider("mocked");
    expect(p.available).toBe(true);
    expect(p.id).toBe("mocked");
  });
});
