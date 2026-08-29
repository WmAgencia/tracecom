import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { GuardRepository } from "../../src/store/repositories/guardRepository";
import { freshGuardState } from "../../src/fusion/guards";
import type { GuardState } from "../../src/fusion/guards";

describe("GuardRepository (cold store do circuit breaker)", () => {
  it("load() retorna null quando a tabela ainda não tem dados válidos", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new GuardRepository(store);
    expect(repo.load()).toBeNull();
    store.close();
  });

  it("save(state) persiste e load() retorna o mesmo estado", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new GuardRepository(store);
    const state: GuardState = {
      consecutiveLosses: 3,
      cooldownUntil: Date.parse("2025-06-01T12:00:00Z"),
      dailyLossPct: 4.5,
      lastLossAt: Date.parse("2025-06-01T11:00:00Z"),
      circuitTrippedAt: Date.parse("2025-06-01T11:00:00Z"),
      lastUpdatedDay: "2025-06-01",
    };
    repo.save(state);

    const loaded = repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(state);
    store.close();
  });

  it("reset() zera todos os campos e atualiza lastUpdatedDay para hoje (YYYY-MM-DD)", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new GuardRepository(store);
    // estado "sujo" qualquer
    repo.save({
      consecutiveLosses: 5,
      cooldownUntil: 12345,
      dailyLossPct: 9.9,
      lastLossAt: 1000,
      circuitTrippedAt: 1000,
      lastUpdatedDay: "1999-01-01",
    });

    repo.reset();
    const loaded = repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.consecutiveLosses).toBe(0);
    expect(loaded!.cooldownUntil).toBeNull();
    expect(loaded!.dailyLossPct).toBe(0);
    expect(loaded!.lastLossAt).toBeNull();
    expect(loaded!.circuitTrippedAt).toBeNull();

    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(loaded!.lastUpdatedDay).toBe(todayUtc);
    expect(loaded!.lastUpdatedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    store.close();
  });

  it("lastUpdatedDay persistido tem formato YYYY-MM-DD", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new GuardRepository(store);
    const now = Date.parse("2025-03-15T10:00:00Z");
    const state = freshGuardState(now);
    expect(state.lastUpdatedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    repo.save(state);
    const loaded = repo.load();
    expect(loaded!.lastUpdatedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded!.lastUpdatedDay).toBe("2025-03-15");
    store.close();
  });

  it("round-trip preserva nulos (cooldownUntil/lastLossAt/circuitTrippedAt)", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new GuardRepository(store);
    const state = freshGuardState(Date.now());
    repo.save(state);
    const loaded = repo.load();
    expect(loaded!.cooldownUntil).toBeNull();
    expect(loaded!.lastLossAt).toBeNull();
    expect(loaded!.circuitTrippedAt).toBeNull();
    expect(loaded!.consecutiveLosses).toBe(0);
    expect(loaded!.dailyLossPct).toBe(0);
    store.close();
  });
});