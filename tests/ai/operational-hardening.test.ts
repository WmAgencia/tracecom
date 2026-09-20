/**
 * HARDENING OPERACIONAL (relay/runtime) — sem tocar na estrategia V4:
 *  - bulk MESAS exige filtro explicito e confirmacao para zerar o universo;
 *  - audit log com oldValue/newValue/actor/requestId;
 *  - seed do registry so apos config hidratado;
 *  - boot com DB lento nao persiste defaults nem sobrescreve config;
 *  - alarme de universo vazio.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");

const KEY = "EURUSD:OTC";

const marketRow = (overrides: Record<string, unknown> = {}) => ({ market_key: KEY, enabled: false, paused: false, max_stake: 10, configured_stake: 10, revision: 1, active_id: 76, instrument_types: ["binary"], availability: "OPEN", payout: 85, ...overrides });
const configRow = (overrides: Record<string, unknown> = {}) => ({ mode: "PRACTICE", global_max_stake: 100, default_stake: 10, auto_execute: true, revision: 7, selection_json: { brainGeneration: 2 }, ...overrides });

function fakePool(options: { failConfig?: number; configRow?: Record<string, unknown> | null; marketRows?: Array<Record<string, unknown>>; instrumentRows?: Array<Record<string, unknown>>; enabledBefore?: number; matchedEnabled?: number } = {}) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let configFailures = options.failConfig ?? 0;
  const pool = {
    totalCount: 2, idleCount: 2, waitingCount: 0, options: { max: 5 },
    calls,
    async query(text: string, params?: unknown[]) {
      const flat = String(text).replace(/\s+/g, " ").trim();
      calls.push({ text: flat, params });
      if (flat.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }] };
      if (flat.includes("FROM iq_runtime_config WHERE id=1")) {
        if (configFailures > 0) { configFailures -= 1; throw new Error("ECHECKOUTTIMEOUT db not ready"); }
        return { rows: options.configRow ? [options.configRow] : [] };
      }
      if (flat.includes("FROM iq_markets")) return { rows: options.marketRows ?? [] };
      if (flat.includes("INSERT INTO iq_rsi_instruments")) return { rows: [] };
      if (flat.includes("FROM iq_rsi_instruments ORDER BY")) return { rows: options.instrumentRows ?? [] };
      if (flat.includes("count(*)")) {
        const matched = flat.includes("AND enabled=true");
        return { rows: [{ n: matched ? (options.matchedEnabled ?? 0) : (options.enabledBefore ?? 0) }] };
      }
      if (flat.includes("UPDATE iq_rsi_instruments")) return { rows: [{ market_key: KEY, instrument_type: "BINARY" }] };
      return { rows: [] };
    },
  };
  return pool;
}

function buildRuntime(pool: ReturnType<typeof fakePool>) {
  const events: Array<Record<string, unknown>> = [];
  const runtime = new runtimeModule.IqMultiRuntime({ pool, rsiAgentsV4Enabled: true, log: () => {} });
  runtime.on("event", (event: Record<string, unknown>) => events.push(event));
  return { runtime, events };
}

describe("HARDENING — bulk MESAS", () => {
  it("sem filtro explicito => MESAS_FILTER_REQUIRED e nenhum UPDATE", async () => {
    const pool = fakePool();
    const { runtime } = buildRuntime(pool);
    await expect(runtime.bulkSetInstruments({ filter: {}, enabled: false })).rejects.toMatchObject({ code: "MESAS_FILTER_REQUIRED" });
    expect(pool.calls.some((call) => call.text.includes("UPDATE iq_rsi_instruments"))).toBe(false);
    runtime.stop("TEST");
  });

  it("zerar universo (N>0 -> 0) sem confirmacao => 409 e nenhum UPDATE", async () => {
    const pool = fakePool({ enabledBefore: 29, matchedEnabled: 29 });
    const { runtime } = buildRuntime(pool);
    await expect(runtime.bulkSetInstruments({ filter: { instrumentType: "BINARY" }, enabled: false })).rejects.toMatchObject({ code: "MESAS_ZERO_UNIVERSE_CONFIRMATION_REQUIRED" });
    expect(pool.calls.some((call) => call.text.includes("UPDATE iq_rsi_instruments"))).toBe(false);
    runtime.stop("TEST");
  });

  it("zerar universo com confirmacao explicita => atualiza, audita e emite evento critico", async () => {
    const pool = fakePool({ enabledBefore: 29, matchedEnabled: 29 });
    const { runtime, events } = buildRuntime(pool);
    const result = await runtime.bulkSetInstruments({ filter: { instrumentType: "BINARY" }, enabled: false, confirmZeroUniverse: true, meta: { actor: "operator", requestId: "req-1" } });
    expect(result.changed).toBe(1);
    expect(result.enabledBefore).toBe(29);
    expect(events.some((event) => event.type === "mesas.bulk_zero_universe")).toBe(true);
    const audit = runtime.auditTrail({ stage: "MESAS_BULK" }).audit?.[0];
    expect(audit?.detail).toMatchObject({ oldValue: 29, actor: "operator", requestId: "req-1", confirmZeroUniverse: true });
    runtime.stop("TEST");
  });

  it("toggle individual audita oldValue/newValue", async () => {
    const pool = fakePool();
    const { runtime } = buildRuntime(pool);
    await runtime.setInstrumentEnabled({ marketKey: KEY, instrumentType: "BINARY", durationSeconds: 60, enabled: true, meta: { actor: "operator", requestId: "req-2" } });
    const audit = runtime.auditTrail({ stage: "MESAS_INSTRUMENT" }).audit?.[0];
    expect(audit?.detail).toMatchObject({ oldValue: null, newValue: true, actor: "operator", requestId: "req-2" });
    runtime.stop("TEST");
  });
});

describe("HARDENING — boot/restart com DB lento", () => {
  it("falha ao carregar config NAO persiste defaults e permanece recuperavel", async () => {
    const pool = fakePool({ failConfig: 1, configRow: configRow(), marketRows: [marketRow()] });
    const { runtime } = buildRuntime(pool);
    await runtime.reloadConfiguration();
    expect(runtime.configHydrated).toBe(false);
    expect(runtime.configLoaded).toBe(false);
    expect(pool.calls.some((call) => call.text.includes("INSERT INTO iq_runtime_config"))).toBe(false);
    // Retry com DB saudavel: hidrata e carrega a config persistida (nunca defaults).
    await runtime.reloadConfiguration();
    expect(runtime.configHydrated).toBe(true);
    expect(runtime.config.defaultStake).toBe(10);
    expect(runtime.config.autoExecute).toBe(true);
    runtime.stop("TEST");
  });

  it("seed do registry so roda apos config hidratado", async () => {
    const pool = fakePool({ configRow: configRow(), marketRows: [marketRow()] });
    const { runtime } = buildRuntime(pool);
    pool.calls.length = 0;
    await runtime.refreshInstrumentRegistry({ force: true });
    expect(pool.calls.some((call) => call.text.includes("INSERT INTO iq_rsi_instruments"))).toBe(false);
    await runtime.reloadConfiguration();
    pool.calls.length = 0;
    await runtime.refreshInstrumentRegistry({ force: true });
    expect(pool.calls.some((call) => call.text.includes("INSERT INTO iq_rsi_instruments"))).toBe(true);
    runtime.stop("TEST");
  });

  it("universo vazio com mercado legado ativo dispara rsi.v4.universe_empty", async () => {
    const pool = fakePool({
      configRow: configRow(),
      marketRows: [marketRow({ enabled: true })],
      instrumentRows: [{ market_key: KEY, instrument_type: "BINARY", duration_seconds: 60, market_type: "OTC", canonical: "EURUSD", enabled: false, status: "OPEN", payout: 85 }],
    });
    const { runtime, events } = buildRuntime(pool);
    await runtime.reloadConfiguration();
    const ctx = runtime.markets.get(KEY);
    ctx.enabled = true; ctx.availability = "OPEN";
    await runtime.refreshInstrumentRegistry({ force: true });
    const alarm = events.find((event) => event.type === "rsi.v4.universe_empty");
    expect(alarm).toBeTruthy();
    expect(alarm?.reason).toBe("MESAS_ZERO_ENABLED");
    expect(runtime.rsiAgentsV4.status().universeEmpty).toBe(true);
    expect(runtime.rsiAgentsV4.status().blockedReason).toBe("MESAS_ZERO_ENABLED");
    expect(runtime.persistenceHealth().pool).toMatchObject({ total: 2, idle: 2, max: 5 });
    runtime.stop("TEST");
  });
});
