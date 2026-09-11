import { describe, expect, it } from "vitest";
import { createPaperSignal, scheduleSignal, advanceSignal } from "../../src/signals/lifecycle";
import { Datastore } from "../../src/store/db";
import { SignalRepository } from "../../src/store/repositories/signalRepository";

describe("SignalRepository", () => {
  it("persists the signal and append-only transition history", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new SignalRepository(store);
    const now = 1_700_000_000_000;
    const created = createPaperSignal({ symbol: "EUR/USD", timeframe: "1m", direction: "up", decision: "BUY", countdownAt: now + 1, entryAt: now + 2, expiresAt: now + 60, now });
    repo.save(created);
    const countdown = advanceSignal(scheduleSignal(created, now), now + 1);
    repo.save(countdown);
    const loaded = repo.find(created.id)!;
    expect(loaded.state).toBe("countdown");
    expect(loaded.events.map((event) => event.newState)).toEqual(["created", "scheduled", "countdown"]);
    expect(repo.list({ symbol: "eur/usd" })).toHaveLength(1);
    store.close();
  });
});
