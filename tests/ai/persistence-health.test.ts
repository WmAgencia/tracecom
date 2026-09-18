/** PERSISTENCE HEALTH - o runtime NUNCA pode se reportar HEALTHY enquanto o audit trail nao persiste. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

function poolWith(handler: (sql: string, params?: unknown[]) => unknown) {
  return { query: async (sql: string, params?: unknown[]) => handler(sql, params) };
}

function readOnlyError(): any {
  const error: any = new Error("cannot execute INSERT in a read-only transaction");
  error.code = "25006";
  return error;
}

function diskFullError(): any {
  const error: any = new Error("could not write to file \"base/pgsql_tmp/pgsql_tmp448422.0\": No space left on device");
  error.code = "53100";
  return error;
}

function fixture(pool: unknown) {
  return new IqMultiRuntime({ pool, getSsid: () => null, now: () => Date.now(), log: () => {} }) as any;
}

describe("PERSISTENCE HEALTH - audit nunca escondido", () => {
  it("DB read-only: probe falha com 25006 -> UNAVAILABLE + PERSISTENCE_UNAVAILABLE + DB_DEGRADED", async () => {
    const pool = poolWith((sql) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "on" }] };
      if (sql.startsWith("INSERT INTO iq_audit_trail")) throw readOnlyError();
      return { rows: [] };
    });
    const runtime = fixture(pool);
    const probe = await runtime.persistProbe();
    expect(probe).toMatchObject({ ok: false, persisted: false, code: "25006" });
    const health = runtime.persistenceHealth();
    expect(health.ok).toBe(false);
    expect(health.state).toBe("UNAVAILABLE");
    expect(health.alerts).toContain("PERSISTENCE_UNAVAILABLE");
    expect(health.alerts).toContain("DB_DEGRADED");
    expect(health.auditPersisting).toBe(false);
    expect(health.readOnly).toBe(true);
    const office = runtime.office();
    expect(office.health).toMatchObject({ ok: false, auditPersisting: false });
    expect(office.health.alerts).toContain("DB_DEGRADED");
  });

  it("disco cheio (53100): audit falhando -> DEGRADED e nunca HEALTHY", async () => {
    const pool = poolWith((sql) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }] };
      if (sql.startsWith("INSERT INTO iq_audit_trail")) throw diskFullError();
      return { rows: [] };
    });
    const runtime = fixture(pool);
    const probe = await runtime.persistProbe();
    expect(probe).toMatchObject({ ok: false, persisted: false, code: "53100" });
    const health = runtime.persistenceHealth();
    expect(health.ok).toBe(false);
    expect(health.state).toBe("DEGRADED");
    expect(health.alerts).toContain("DB_DEGRADED");
    expect(health.alerts).not.toContain("PERSISTENCE_UNAVAILABLE");
    expect(health.auditPersisting).toBe(false);
    expect(runtime.office().health.ok).toBe(false);
  });

  it("persistencia normal: probe escreve e le de volta -> HEALTHY", async () => {
    const pool = poolWith((sql, params) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }] };
      if (sql.startsWith("INSERT INTO iq_audit_trail")) return { rowCount: 1, rows: [{ id: 4242, created_at: "2026-09-18T00:00:00Z" }] };
      if (sql.startsWith("SELECT id, correlation_id")) return { rows: [{ id: 4242, correlation_id: String(params?.[0] ?? ""), stage: "PERSISTENCE_PROBE", detail: { probe: true }, created_at: "2026-09-18T00:00:00Z" }] };
      return { rows: [] };
    });
    const runtime = fixture(pool);
    const probe = await runtime.persistProbe();
    expect(probe).toMatchObject({ ok: true, persisted: true, readBackOk: true, insertedId: 4242 });
    const health = runtime.persistenceHealth();
    expect(health.ok).toBe(true);
    expect(health.state).toBe("HEALTHY");
    expect(health.alerts).toEqual([]);
    expect(health.auditPersisting).toBe(true);
    expect(runtime.office().health.state).toBe("HEALTHY");
  });

  it("sem pool: PERSISTENCE_UNAVAILABLE explicito e ok=false", () => {
    const runtime = fixture(null);
    const health = runtime.persistenceHealth();
    expect(health.ok).toBe(false);
    expect(health.state).toBe("UNAVAILABLE");
    expect(health.alerts).toContain("PERSISTENCE_UNAVAILABLE");
    expect(runtime.office().health.alerts).toContain("PERSISTENCE_UNAVAILABLE");
  });
});
