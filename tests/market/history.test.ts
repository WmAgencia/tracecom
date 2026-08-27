import { describe, expect, it } from "vitest";
import { fetchHistorical, ExponentialBackoff } from "../../src/market/history";
import type { HistoricalSource } from "../../src/market/history";
import type { MarketCandle } from "../../src/market/model";
import { detectGaps } from "../../src/market/quality";

function c(ts: number): MarketCandle {
  return { provider: "binance", symbol: "BTCUSDT", timeframe: "1m", open: 100, high: 101, low: 99, close: 100.5, volume: 10, timestamp: ts, receivedAt: ts + 1000, isClosed: true, source: "rest", quality: "high" };
}

/** Fonte sintética que "desaparece" uma janela (simula desconexão/gap). */
function gapSource(omitStart: number, omitEnd: number): HistoricalSource {
  return {
    provider: "binance",
    fetchPage: async (p) => {
      const out: MarketCandle[] = [];
      for (let t = p.start; t < p.end; t += 60_000) {
        if (t >= omitStart && t < omitEnd) continue; // gap
        out.push(c(t));
      }
      return { candles: out, nextStartTime: null };
    },
  };
}

describe("fetchHistorical (paginação + gap detection)", () => {
  it("pagina e concatenaria candles de múltiplas páginas", async () => {
    let calls = 0;
    const src: HistoricalSource = {
      provider: "binance",
      fetchPage: async (p) => {
        calls++;
        const startTs = p.start;
        const out = [c(startTs), c(startTs + 60_000), c(startTs + 120_000)];
        return { candles: out, nextStartTime: calls === 1 ? startTs + 180_000 : null };
      },
    };
    const res = await fetchHistorical(src, { symbol: "BTCUSDT", timeframe: "1m", start: Date.parse("2023-01-01T00:00:00Z"), end: Date.parse("2023-01-01T00:10:00Z"), pageSize: 10 });
    expect(res.pages).toBe(2);
    expect(res.candles.length).toBe(6);
  });

  it("detecta gap e não inventa candle para a janela ausente", async () => {
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    const res = await fetchHistorical(gapSource(t0 + 60_000, t0 + 3 * 60_000), {
      symbol: "BTCUSDT", timeframe: "1m", start: t0, end: t0 + 5 * 60_000, pageSize: 100,
    });
    const ts = res.candles.map((x) => x.timestamp);
    expect(ts).not.toContain(t0 + 60_000);
    expect(ts).not.toContain(t0 + 2 * 60_000);
    expect(res.gaps.length).toBeGreaterThan(0);
    expect(ts).toContain(t0);
    expect(ts).toContain(t0 + 3 * 60_000);
  });

  it("backoff exponencial respeita teto e jitter (não explode)", async () => {
    const b = new ExponentialBackoff(250, 2, 8_000, 0.2);
    for (let i = 0; i < 20; i++) {
      const d = b.delayMs;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(8_000 + 2_000);
      b.advance();
    }
  });

  it("reconciliação: detecta gap na série e depois recupera (sem inventar)", async () => {
    const t0 = Date.parse("2023-01-01T00:00:00Z");
    // série com gap em 1m e 2m
    const series = detectGaps([c(t0), c(t0 + 3 * 60_000)]);
    expect(series.length).toBe(1);
    // recupera do histórico (que tem os candles ausentes fora do gap omitido)
    const recovered = await fetchHistorical(gapSource(t0 + 6 * 60_000, t0 + 8 * 60_000), {
      symbol: "BTCUSDT", timeframe: "1m", start: t0, end: t0 + 10 * 60_000, pageSize: 100,
    });
    // o gap de 1m/2m foi preenchido pelo histórico (só o 6m/7m permanece omisso)
    const ts = recovered.candles.map((x) => x.timestamp);
    expect(ts).toContain(t0 + 60_000);
    expect(ts).toContain(t0 + 2 * 60_000);
    // os que o provider omitiu continuam ausentes (não inventados)
    expect(ts).not.toContain(t0 + 6 * 60_000);
  });
});
