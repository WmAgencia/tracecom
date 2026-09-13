import { describe, expect, it } from "vitest";
import { OperationalController } from "../../src/vision/operational-controller";

const lock = (controller: OperationalController, now = 1_000, key = "tab-a") => controller.lock({ signalId: "sig-1", idempotencyKey: key, direction: "BUY", originSymbol: "USD/CAD (OTC)", now, countdownMs: 10_000, horizonMs: 60_000 });

describe("OperationalController", () => {
  it("locks direction, countdown and settlement immutably while later callers cannot reverse it", () => {
    const controller = new OperationalController(); const first = lock(controller);
    expect(first).toMatchObject({ direction: "BUY", entryAt: 11_000, settlementAt: 71_000 });
    expect(() => controller.lock({ signalId: "sig-2", idempotencyKey: "tab-b", direction: "SELL", originSymbol: "USD/CAD (OTC)", now: 2_000, countdownMs: 1, horizonMs: 1 })).toThrow("already_active");
    expect(controller.current().signal).toMatchObject({ direction: "BUY", settlementAt: 71_000 });
  });

  it("is idempotent under concurrent same-key lock attempts", async () => {
    const controller = new OperationalController();
    const results = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve(lock(controller))));
    expect(new Set(results.map((row) => row.signalId))).toEqual(new Set(["sig-1"]));
    expect(controller.current().metrics).toMatchObject({ locked: 1, duplicateRequests: 24 });
    expect(controller.replay().filter((event) => event.type === "OPERATIONAL_SIGNAL_LOCKED")).toHaveLength(1);
  });

  it("keeps a paper entry and settlement causal, including early and wrong-symbol UNKNOWN", () => {
    const controller = new OperationalController(); lock(controller); controller.tick(11_000);
    controller.lockEntry({ signalId: "sig-1", price: 1.2, timestamp: 11_000, symbol: "USD/CAD (OTC)" });
    const early = controller.settle({ signalId: "sig-1", price: 1.3, timestamp: 70_999, symbol: "USD/CAD (OTC)" });
    expect(early).toMatchObject({ outcome: "UNKNOWN", settlementReason: "EARLY_EXIT", direction: "BUY" });
    expect(controller.current().metrics).toMatchObject({ UNKNOWN: 1, settled: 1 });
  });

  it("uses settleTrade outcome authority and never changes a settled result", () => {
    const controller = new OperationalController(); lock(controller); controller.lockEntry({ signalId: "sig-1", price: 1.2, timestamp: 11_000, symbol: "USD/CAD (OTC)" });
    const settled = controller.settle({ signalId: "sig-1", price: 1.3, timestamp: 71_000, symbol: "USD/CAD (OTC)" });
    expect(settled).toMatchObject({ outcome: "WIN", settlementReason: "DIRECTIONAL_MOVE" });
    expect(controller.settle({ signalId: "sig-1", price: 1.1, timestamp: 80_000, symbol: "USD/CAD (OTC)" })).toEqual(settled);
  });

  it("replays ordered SSE-style events and restores immutable state across reload", () => {
    const first = new OperationalController(); const delivered: number[] = [];
    const stop = first.subscribe((event) => delivered.push(event.sequence)); lock(first); first.lockEntry({ signalId: "sig-1", price: 1.2, timestamp: 11_000, symbol: "USD/CAD (OTC)" }); stop();
    const snapshot = first.snapshot(); const reloaded = OperationalController.restore(snapshot);
    expect(delivered).toEqual([1, 2, 3]); expect(reloaded.replay(1).map((event) => event.sequence)).toEqual([2, 3]);
    expect(reloaded.current().signal).toMatchObject({ direction: "BUY", entryPrice: 1.2, settlementAt: 71_000 });
  });

  it("does not mix symbol context or allow post-entry invalidation", () => {
    const controller = new OperationalController(); lock(controller);
    expect(() => controller.lockEntry({ signalId: "sig-1", price: 1.2, timestamp: 11_000, symbol: "EUR/USD (OTC)" })).toThrow("entry_symbol_mismatch");
    controller.lockEntry({ signalId: "sig-1", price: 1.2, timestamp: 11_000, symbol: "USD/CAD (OTC)" });
    expect(() => controller.invalidate("sig-1", "stale", 12_000)).toThrow("cannot_invalidate_entered_signal");
  });
});
