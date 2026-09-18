/** STRESS 55 — wrapper vitest do harness scripts/stress-55.mjs (12 iteracoes, N mercados do universo reconciliado).
 * Invariantes: nenhuma ordem sai, nenhum candle cruza de mercado, event loop saudavel. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const { runStress, SUSPENDED_COUNT } = await import("../../scripts/stress-55.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const { UNIVERSE } = await import("../../relay/market-universe.mjs");

describe("STRESS 55 — N mercados / 2N agentes sem ordens", () => {
  it("12 iteracoes: N mercados semeados, zero ordens, zero contaminacao, lag p95 < 250ms", async () => {
    const total = UNIVERSE.length;
    const startedAt = Date.now();
    const report = await runStress({ iterations: 12, markets: total });
    const elapsedMs = Date.now() - startedAt;

    expect(report.marketsSeeded).toBe(total);
    expect(report.marketsOpen).toBe(total);
    expect(report.marketsActive).toBe(total);
    expect(report.ordersSent).toBe(0);
    expect(report.placeOrderCalls).toBe(0);
    expect(report.executedSignals).toBe(0);
    expect(report.positionsCreated).toBe(0);
    expect(report.pendingOrders).toBe(0);
    expect(report.openPositions).toBe(0);
    expect(report.contamination).toEqual([]);
    expect(report.eventLoopLag.p95).toBeLessThan(250);
    expect(report.availability.openBefore).toBe(total);
    expect(report.availability.openSuspended).toBe(total - SUSPENDED_COUNT);
    expect(report.availability.openReopened).toBe(total);
    expect(report.candles.seeded).toBe(total * 60);
    expect(report.candles.bufferMin).toBeGreaterThan(60);
    expect(report.jit.probe.candidateCreated).toBe(true);
    expect(report.jit.counters.candidates).toBeGreaterThanOrEqual(1);
    expect(report.signals.stats.executed).toBe(0);
    expect(report.signals.stats.blocked).toBeGreaterThanOrEqual(3);
    expect(report.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(60_000);
  }, 120_000);
});
