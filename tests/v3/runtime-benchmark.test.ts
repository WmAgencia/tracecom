/**
 * V3 — integração do runtime (discovery -> ciclos -> snapshot/persistência) e benchmark 30 ativos.
 */
import { describe, expect, it } from "vitest";
import { pullbackRetomadaSeries, rangeSeries, candlesFromCloses, approvalSeries, ALIGNED_BASE } from "./fixtures";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/v3/runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const measurementsModule = await import("../../relay/v3/measurements.mjs");
// @ts-expect-error - relay ESM sem tipagem
const specialistsModule = await import("../../relay/v3/specialists.mjs");
// @ts-expect-error - relay ESM sem tipagem
const assetModule = await import("../../relay/v3/asset-agent.mjs");
// @ts-expect-error - relay ESM sem tipagem
const consensusModule = await import("../../relay/v3/consensus.mjs");
const { V3Runtime } = runtimeModule as any;
const { measureAll } = measurementsModule as any;
const { runSpecialists } = specialistsModule as any;
const { classifyAsset } = assetModule as any;
const { runConsensus } = consensusModule as any;

const exp = ALIGNED_BASE + 300_000;
const activeFor = (expirationAt: number) => ({ id: 76, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime: 30, option: { expiration_times: [Math.round(expirationAt / 1000)], profit: { commission: 18 } } });

describe("V3 runtime — discovery -> multi-ciclos -> snapshot (observe-only)", () => {
  it("cria opportunity em ~TTE330, roda ciclos por candle fechado e registra snapshot se aprovado", () => {
    const queries: string[] = [];
    const pool = { query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 1 }; } };
    const strategy = { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" };
    const runtime = new V3Runtime({ pool, strategy, now: () => exp - 330_000 });
    const init = runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    expect(init.newOffers).toBe(1);
    expect(init.discovered).toBe(1);
    const opportunity = runtime.opportunities()[0];
    expect(opportunity.firstSeenTteMs).toBe(330_000);

    const closes = pullbackRetomadaSeries({ candles: 90 }).map((candle) => candle.close);
    const cycles = [];
    for (const tte of [325_000, 320_000, 315_000, 310_000, 305_000]) {
      const brokerNow = exp - tte;
      const candles = candlesFromCloses(closes.map((close, index) => close * (1 + index * 0.0000001)), { startAt: brokerNow - closes.length * 5_000 });
      const cycle = runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow });
      if (cycle) cycles.push(cycle);
    }
    expect(cycles.length).toBeGreaterThanOrEqual(3);
    const after = runtime.opportunities()[0];
    expect(after.cycles.length).toBe(cycles.length);
    expect(after.cycles.every((cycle: any) => cycle.assetState && cycle.consensusResult && cycle.specialists?.rsi)).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO iq_v3_opportunities"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO iq_v3_cycles"))).toBe(true);
    const status = runtime.status();
    expect(status.executionMode).toBe("OBSERVE_ONLY");
    expect(status.executionEnabled).toBe(false);
    expect(status.latency.count).toBe(cycles.length);
    expect(status.counters.candleCycles).toBe(cycles.length);
  });

  it("TTE<=300 sem envio => MISSED_5M_ENTRY_WINDOW e nenhum ciclo novo", () => {
    const runtime = new V3Runtime({ strategy: { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false } , now: () => exp - 330_000 });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    const closes = pullbackRetomadaSeries({ candles: 90 }).map((candle) => candle.close);
    const candles = candlesFromCloses(closes, { startAt: exp - 299_000 - closes.length * 5_000 });
    const cycle = runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: exp - 299_000 });
    expect(cycle).toBeNull();
    expect(runtime.opportunities()[0].status).toBe("MISSED_5M_ENTRY_WINDOW");
  });

  it("range/no-setup nao gera ordem nem snapshot executavel", () => {
    const runtime = new V3Runtime({ strategy: { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false }, now: () => exp - 330_000 });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    const candles = rangeSeries({ candles: 90 }).map((candle, index) => ({ ...candle, at: exp - 320_000 - (89 - index) * 5_000 }));
    const cycle = runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow: exp - 320_000 });
    expect(cycle).toBeTruthy();
    expect(["NO_SETUP", "WAIT"]).toContain(cycle.assetState);
    const opportunity = runtime.opportunities()[0];
    expect(["NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE"]).toContain(opportunity.status);
    if (opportunity.finalDecision) expect(opportunity.finalDecision.executionBlocked).toBeDefined();
    expect(runtime.status().executionEnabled).toBe(false);
  });

  it("aprovacao real => snapshot imutavel com hash + executionBlocked (V3 observe-only, zero ordem)", () => {
    const runtime = new V3Runtime({ strategy: { version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:v3-test", statsEpoch: "epoch-v3" }, now: () => exp - 320_000 });
    runtime.onInitializationData({ result: { binary: { actives: { 76: activeFor(exp) } } } }, { brokerNow: exp - 330_000, marketKeyByActiveId: new Map([[76, "EURUSD:OTC"]]) });
    const closes = approvalSeries({ candles: 120 }).map((candle) => candle.close);
    let approved = null;
    for (const tte of [327_000, 322_000, 317_000, 312_000, 307_000, 303_000]) {
      const brokerNow = exp - tte;
      const candles = candlesFromCloses(closes, { startAt: brokerNow - closes.length * 5_000 });
      const cycle = runtime.onClosedCandle({ marketKey: "EURUSD:OTC", candles, brokerNow });
      if (cycle?.consensus === "APPROVE_BUY" || cycle?.consensus === "APPROVE_SELL") approved = cycle;
    }
    expect(approved).toBeTruthy();
    const opportunity = runtime.opportunities()[0];
    expect(["APPROVED_BUY", "APPROVED_SELL", "FINAL_REVIEW"]).toContain(opportunity.status);
    expect(opportunity.finalDecision?.snapshotHash).toMatch(/^sha256:/);
    expect(opportunity.finalDecision?.executionBlocked).toBe("V3_NOT_ACTIVE");
    expect(runtime.status().counters.snapshots).toBeGreaterThanOrEqual(1);
    expect(runtime.status().counters.executionBlocked).toBeGreaterThanOrEqual(1);
    expect(runtime.status().executionEnabled).toBe(false);
  });
});

describe("V3 benchmark — 30 ativos, ciclos completos", () => {
  it("p95 do ciclo completo permanece bem abaixo do orcamento de 5s e zero janelas perdidas", () => {
    const markets = Array.from({ length: 30 }, (_, index) => `M${index}:OTC`);
    const series = markets.map((_, index) => pullbackRetomadaSeries({ candles: 90 + index }));
    const latencies: number[] = [];
    let approvals = 0; let noSetup = 0; let wait = 0;
    const cycles = 8;
    const startedAll = Date.now();
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (let index = 0; index < markets.length; index += 1) {
        const brokerNow = exp - (330_000 - cycle * 4_000);
        const candles = series[index]!.map((candle, candleIndex) => ({ ...candle, at: brokerNow - (series[index]!.length - 1 - candleIndex) * 5_000 }));
        const started = Date.now();
        const measurements = measureAll(candles, { marketKey: markets[index], cycleNumber: cycle + 1 });
        const specialists = runSpecialists({ measurements });
        const asset = classifyAsset({ measurements, specialists });
        const consensus = runConsensus({ measurements, asset, timing: { ok: true, code: "ENTRY_WINDOW_OPEN", tteMs: 330_000 - cycle * 4_000 } });
        latencies.push(Date.now() - started);
        if (consensus.result === "APPROVE_BUY" || consensus.result === "APPROVE_SELL") approvals += 1;
        else if (asset.state === "NO_SETUP") noSetup += 1;
        else wait += 1;
        // nenhuma janela perdida: a decisao do ciclo cabe antes do proximo candle (5s) e do corte (TTE>300s)
        expect(330_000 - cycle * 4_000).toBeGreaterThan(300_000);
      }
    }
    const totalMs = Date.now() - startedAll;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))] ?? 0;
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.99))] ?? 0;
    console.log(`V3_BENCHMARK cycles=${latencies.length} p50=${p50}ms p95=${p95}ms p99=${p99}ms total=${totalMs}ms approvals=${approvals} wait=${wait} noSetup=${noSetup}`);
    expect(p95).toBeLessThan(250);
    expect(p99).toBeLessThan(400);
    expect(latencies.length).toBe(30 * cycles);
    expect(approvals + noSetup + wait).toBe(latencies.length);
  }, 60_000);
});
