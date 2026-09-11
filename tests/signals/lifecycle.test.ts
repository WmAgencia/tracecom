import { describe, expect, it } from "vitest";
import { advanceSignal, cancelSignal, createPaperSignal, evaluatePaperSignal, executePaperSignal, scheduleSignal } from "../../src/signals/lifecycle";

const NOW = 1_700_000_000_000;
function created() {
  return createPaperSignal({ symbol: "eur/usd", timeframe: "1m", direction: "up", decision: "BUY", countdownAt: NOW + 10, entryAt: NOW + 20, expiresAt: NOW + 60, now: NOW });
}

describe("paper signal lifecycle", () => {
  it("follows created -> scheduled -> countdown -> ready -> executed -> evaluated", () => {
    const scheduled = scheduleSignal(created(), NOW + 1);
    const countdown = advanceSignal(scheduled, NOW + 10);
    const ready = advanceSignal(countdown, NOW + 20);
    const executed = executePaperSignal(ready, "paper-request-1", "shadow-1", NOW + 21);
    const evaluated = evaluatePaperSignal(executed, NOW + 40);
    expect(evaluated.state).toBe("evaluated");
    expect(evaluated.events.map((event) => event.newState)).toEqual(["created", "scheduled", "countdown", "ready", "executed", "evaluated"]);
  });

  it("does not execute a stale or invalidated signal", () => {
    const scheduled = scheduleSignal(created(), NOW);
    expect(advanceSignal(scheduled, NOW + 61).state).toBe("expired");
    const invalidated = advanceSignal(scheduled, NOW + 15, "structure_break");
    expect(invalidated.state).toBe("invalidated");
    expect(invalidated.invalidationReason).toBe("structure_break");
  });

  it("requires a cancellation reason and makes repeated execution idempotent", () => {
    expect(() => cancelSignal(created(), "")).toThrow(/reason/);
    const ready = advanceSignal(advanceSignal(scheduleSignal(created(), NOW), NOW + 10), NOW + 20);
    const executed = executePaperSignal(ready, "request-1", "shadow-1", NOW + 21);
    expect(executePaperSignal(executed, "request-1", "shadow-1", NOW + 22)).toBe(executed);
  });

  it("keeps an executed paper position awaiting evaluation instead of expiring or cancelling it", () => {
    const ready = advanceSignal(advanceSignal(scheduleSignal(created(), NOW), NOW + 10), NOW + 20);
    const executed = executePaperSignal(ready, "request-2", "shadow-2", NOW + 21);
    expect(advanceSignal(executed, NOW + 100).state).toBe("executed");
    expect(() => cancelSignal(executed, "operator")).toThrow(/executed/);
  });
});
