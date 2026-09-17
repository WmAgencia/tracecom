/** STRESS 55 — wrapper vitest do harness scripts/stress-55.mjs (12 iteracoes, 55 mercados).
 * Invariantes: nenhuma ordem sai, nenhum candle cruza de mercado, event loop saudavel. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const { runStress } = await import("../../scripts/stress-55.mjs");

describe("STRESS 55 — 55 mercados / 110 agentes sem ordens", () => {
  it("12 iteracoes: 55 mercados semeados, zero ordens, zero contaminacao, lag p95 < 250ms", async () => {
    const startedAt = Date.now();
    const report = await runStress({ iterations: 12, markets: 55 });
    const elapsedMs = Date.now() - startedAt;

    expect(report.marketsSeeded).toBe(55);
    expect(report.marketsOpen).toBe(55);
    expect(report.marketsActive).toBe(55);
    expect(report.ordersSent).toBe(0);
    expect(report.placeOrderCalls).toBe(0);
    expect(report.executedSignals).toBe(0);
    expect(report.positionsCreated).toBe(0);
    expect(report.pendingOrders).toBe(0);
    expect(report.openPositions).toBe(0);
    expect(report.contamination).toEqual([]);
    expect(report.eventLoopLag.p95).toBeLessThan(250);
    expect(report.availability.openBefore).toBe(55);
    expect(report.availability.openSuspended).toBe(35);
    expect(report.availability.openReopened).toBe(55);
    expect(report.candles.seeded).toBe(55 * 60);
    expect(report.candles.bufferMin).toBeGreaterThan(60);
    expect(report.jit.probe.candidateCreated).toBe(true);
    expect(report.jit.counters.candidates).toBeGreaterThanOrEqual(1);
    expect(report.signals.stats.executed).toBe(0);
    expect(report.signals.stats.blocked).toBeGreaterThanOrEqual(3);
    expect(report.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(60_000);
  }, 120_000);
});
