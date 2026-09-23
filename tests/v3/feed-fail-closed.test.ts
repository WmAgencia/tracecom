/**
 * V3 FEED GUARD — fail-closed com motivo explicito quando o candle feed nao esta utilizavel.
 * Prova: nenhuma chamada LLM quando o feed bloqueia; motivos diferenciados (nao agrupados em count=0).
 */
import { describe, expect, it } from "vitest";
import { ALIGNED_BASE, candlesFromCloses, pullbackRetomadaSeries } from "./fixtures";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const guardModule = await import("../../relay/v3/feed-guard.mjs");
const { V3Runtime } = runtimeModule as any;
const { candleFeedBlockReason, MIN_CANDLES_FOR_V3, V3_CANDLE_BLOCK_REASONS, V3_RELAY_BLOCK_REASONS, V3_FEED_BLOCK_REASONS } = guardModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });
const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };

const makeRuntime = () => {
  const runtime = new V3Runtime({ strategy, now: () => exp - 330_000 });
  runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
  return runtime;
};

const series = (offsetMs = 0, candles = 90) => {
  const closes = pullbackRetomadaSeries({ candles }).map((candle) => candle.close);
  const brokerNow = exp - 325_000;
  return candlesFromCloses(closes.map((close, index) => close * (1 + index * 0.0000001)), { startAt: brokerNow - candles * 5_000 - offsetMs });
};

describe("V3 feed guard — classificacao pura", () => {
  it("distingue NO_CANDLE_HISTORY / INSUFFICIENT_CANDLES / CANDLE_FEED_STALE / feed ok", () => {
    expect(candleFeedBlockReason({ candles: [] })).toBe("NO_CANDLE_HISTORY");
    expect(candleFeedBlockReason({ candles: null })).toBe("NO_CANDLE_HISTORY");
    expect(candleFeedBlockReason({ candles: Array.from({ length: 10 }, (_, index) => ({ at: index })) })).toBe("INSUFFICIENT_CANDLES");
    const fresh = Array.from({ length: MIN_CANDLES_FOR_V3 }, (_, index) => ({ at: index }));
    expect(candleFeedBlockReason({ candles: fresh, brokerNow: 1_000_000, closedCandleAt: 1_000_000 - 5_000 })).toBeNull();
    expect(candleFeedBlockReason({ candles: fresh, brokerNow: 1_000_000, closedCandleAt: 1_000_000 - 31_000 })).toBe("CANDLE_FEED_STALE");
  });
});

describe("V3 feed guard — runtime fail-closed (sem LLM)", () => {
  it("poucos candles => bloqueio INSUFFICIENT_CANDLES, nenhum ciclo de agente", async () => {
    const runtime = makeRuntime();
    const closes = pullbackRetomadaSeries({ candles: 5 }).map((candle) => candle.close);
    const candles = candlesFromCloses(closes, { startAt: exp - 325_000 - closes.length * 5_000 });
    const cycle = await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: exp - 325_000 });
    expect(cycle).toBeNull();
    const status = runtime.status();
    expect(status.counters.agentCycles).toBe(0);
    expect(status.counters.candleFeedBlocked).toBeGreaterThanOrEqual(1);
    expect(status.counters.lastFeedBlockedReason).toBe("INSUFFICIENT_CANDLES");
    expect(status.candleFeed.blocked).toBeGreaterThanOrEqual(1);
    expect(status.candleFeed.reasons.INSUFFICIENT_CANDLES).toBeGreaterThanOrEqual(1);
  });

  it("candles velhos (feed parado) => CANDLE_FEED_STALE e nenhum ciclo", async () => {
    const runtime = makeRuntime();
    const candles = series(120_000);
    const cycle = await runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: exp - 325_000 });
    expect(cycle).toBeNull();
    const status = runtime.status();
    expect(status.counters.lastFeedBlockedReason).toBe("CANDLE_FEED_STALE");
    expect(status.counters.agentCycles).toBe(0);
  });

  it("noteFeedBlocked registra motivos externos (disconnect/nao assinado) sem chamar agentes", () => {
    const runtime = makeRuntime();
    runtime.noteFeedBlocked("CANDLE_FEED_DISCONNECTED", "EURUSD:OTC");
    runtime.noteFeedBlocked("MARKET_NOT_SUBSCRIBED", "activeId:76");
    const status = runtime.status();
    expect(status.candleFeed.reasons.CANDLE_FEED_DISCONNECTED).toBe(1);
    expect(status.candleFeed.reasons.MARKET_NOT_SUBSCRIBED).toBe(1);
    expect(status.counters.agentCycles).toBe(0);
    expect(status.counters.lastFeedBlockedMarket).toBe("activeId:76");
  });

  it("contrato de motivos: 3 de candle (aqui) + 2 de relay (disconnect/subscription) = 5 distintos", () => {
    expect([...V3_CANDLE_BLOCK_REASONS]).toEqual(["NO_CANDLE_HISTORY", "INSUFFICIENT_CANDLES", "CANDLE_FEED_STALE"]);
    expect([...V3_RELAY_BLOCK_REASONS]).toEqual(["CANDLE_FEED_DISCONNECTED", "MARKET_NOT_SUBSCRIBED"]);
    expect(new Set([...V3_FEED_BLOCK_REASONS]).size).toBe(5);
    for (const reason of V3_FEED_BLOCK_REASONS) {
      const runtime = makeRuntime();
      runtime.noteFeedBlocked(reason, "X");
      expect(runtime.status().candleFeed.reasons[reason]).toBe(1);
    }
    // candleFeedBlockReason NUNCA devolve os motivos de relay (classificados na camada certa).
    expect(V3_CANDLE_BLOCK_REASONS).not.toContain("CANDLE_FEED_DISCONNECTED");
    expect(V3_CANDLE_BLOCK_REASONS).not.toContain("MARKET_NOT_SUBSCRIBED");
  });
});
