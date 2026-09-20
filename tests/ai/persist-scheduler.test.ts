/**
 * PERSIST SCHEDULER — backpressure do pool: best-effort dropado sob saturacao,
 * criticos nunca dropados por fila cheia, circuit breaker e contadores.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const schedulerModule = await import("../../relay/persist-scheduler.mjs");
const { createPersistScheduler, CRITICAL_SQL } = schedulerModule;

function deferred(): { promise: Promise<{ rows: unknown[] }>; resolve: (value: { rows: unknown[] }) => void; reject: (error: unknown) => void } {
  let resolve!: (value: { rows: unknown[] }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ rows: unknown[] }>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PERSIST SCHEDULER", () => {
  it("respeita o limite de concorrencia e processa a fila", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    const pool = { __rawQuery: () => { const d = deferred(); pending.push(d); return d.promise; } };
    const scheduler = createPersistScheduler({ pool, maxInFlight: 2, maxQueue: 10, maxBestEffortPerSecond: 1000 });
    const resolved = { rows: [] };
    const auto = setInterval(() => { for (const d of pending.splice(0)) d.resolve(resolved); }, 0);
    await Promise.all([scheduler.query("SELECT 1"), scheduler.query("SELECT 2"), scheduler.query("SELECT 3")]);
    clearInterval(auto);
    await tick(); await tick();
    expect(scheduler.stats().inFlight).toBe(0);
    expect(scheduler.stats().queue).toBe(0);
    expect(scheduler.stats().dropped).toBe(0);
  });

  it("fila cheia dropa best-effort (nunca cresce sem limite)", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    const pool = { __rawQuery: () => { const d = deferred(); pending.push(d); return d.promise; } };
    const scheduler = createPersistScheduler({ pool, maxInFlight: 1, maxQueue: 1, maxBestEffortPerSecond: 1000 });
    const first = scheduler.query("INSERT INTO scenario_shadow_x VALUES(1)");
    const second = scheduler.query("INSERT INTO scenario_shadow_y VALUES(1)");
    const third = scheduler.query("INSERT INTO scenario_shadow_z VALUES(1)");
    await tick();
    const thirdResult = await third;
    expect(thirdResult).toMatchObject({ dropped: true, reason: "QUEUE_FULL", bestEffort: true });
    expect(scheduler.stats().dropped).toBe(1);
    const auto = setInterval(() => { for (const d of pending.splice(0)) d.resolve({ rows: [] }); }, 0);
    await Promise.all([first, second]);
    clearInterval(auto);
  });

  it("queries criticas (audit/executions/MESAS) NUNCA sao dropadas por fila cheia", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    const pool = { __rawQuery: () => { const d = deferred(); pending.push(d); return d.promise; } };
    const scheduler = createPersistScheduler({ pool, maxInFlight: 1, maxQueue: 1, maxBestEffortPerSecond: 1000 });
    const blocker = scheduler.query("INSERT INTO scenario_shadow_x VALUES(1)");
    const queued = scheduler.query("INSERT INTO scenario_shadow_y VALUES(1)");
    const critical = scheduler.query("INSERT INTO iq_executions(execution_id) VALUES($1)", ["c1"]);
    await tick();
    expect(scheduler.stats().dropped).toBe(0);
    expect(scheduler.stats().critical).toBe(1);
    const auto = setInterval(() => { for (const d of pending.splice(0)) d.resolve({ rows: [{ id: 1 }] }); }, 0);
    await expect(critical).resolves.toMatchObject({ rows: [{ id: 1 }] });
    await Promise.all([blocker, queued]);
    clearInterval(auto);
    expect(CRITICAL_SQL.test("INSERT INTO iq_rsi_instruments(market_key) VALUES($1)")).toBe(true);
    expect(CRITICAL_SQL.test("INSERT INTO scenario_shadow_x VALUES(1)")).toBe(false);
    expect(CRITICAL_SQL.test("INSERT INTO iq_audit_trail(correlation_id) VALUES($1)")).toBe(false);
  });

  it("rate-limit de best-effort dropa o excedente, mas criticos passam", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    const pool = { __rawQuery: () => { const d = deferred(); pending.push(d); return d.promise; } };
    const scheduler = createPersistScheduler({ pool, maxInFlight: 5, maxQueue: 100, maxBestEffortPerSecond: 1 });
    const first = scheduler.query("INSERT INTO scenario_shadow_a VALUES(1)");
    const second = scheduler.query("INSERT INTO scenario_shadow_b VALUES(1)");
    await tick();
    const secondResult = await second;
    expect(secondResult).toMatchObject({ dropped: true, reason: "RATE_LIMITED" });
    expect(scheduler.stats().rateLimited).toBe(1);
    const critical = scheduler.query("INSERT INTO iq_runtime_config(id) VALUES(1)");
    const auto = setInterval(() => { for (const d of pending.splice(0)) d.resolve({ rows: [] }); }, 0);
    await Promise.all([first, critical]);
    clearInterval(auto);
  });

  it("circuit breaker abre apos falhas consecutivas e dropa best-effort, mas criticos passam", async () => {
    let bestEffortCalls = 0;
    const pool = {
      __rawQuery: (text: string) => {
        if (String(text).includes("iq_executions")) return Promise.resolve({ rows: [{ id: 7 }] });
        bestEffortCalls += 1;
        if (bestEffortCalls <= 6) return Promise.reject(new Error("ECHECKOUTTIMEOUT"));
        return Promise.resolve({ rows: [] });
      },
    };
    const scheduler = createPersistScheduler({ pool, maxInFlight: 1, maxQueue: 10, maxBestEffortPerSecond: 1000, breakerFailures: 3, breakerCooldownMs: 60_000 });
    await scheduler.query("INSERT INTO scenario_shadow_a VALUES(1)");
    await scheduler.query("INSERT INTO scenario_shadow_b VALUES(1)");
    await scheduler.query("INSERT INTO scenario_shadow_c VALUES(1)");
    expect(scheduler.stats().breakerActive).toBe(true);
    const dropped = await scheduler.query("INSERT INTO scenario_shadow_d VALUES(1)");
    expect(dropped).toMatchObject({ dropped: true, reason: "BREAKER_OPEN" });
    const critical = await scheduler.query("INSERT INTO iq_executions(execution_id) VALUES($1)", ["c2"]);
    expect(critical).toMatchObject({ rows: [{ id: 7 }] });
  });
});
