/** IQ MCP shadow orchestrator — mocked scheduler/transport tests (no network, zero orders). */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { DEFAULT_OFFICE_URL, IQMCPShadowRunner, shadowEnabled } from "../../relay/iq-mcp/shadow.mjs";

const NOW = 1_789_700_000_000;

const OFFICE = {
  at: NOW,
  mode: "PRACTICE",
  modeState: { practice: { balance: 1000, currency: "USD" }, realMode: { realModeEnabled: false } },
  markets: [
    { marketKey: "EURUSD:OTC", canonical: "EURUSD", symbol: "EUR/USD", marketType: "OTC", availability: "OPEN", payout: 85, activeId: 76, enabled: true },
    { marketKey: "GBPUSD:OTC", canonical: "GBPUSD", symbol: "GBP/USD", marketType: "OTC", availability: "OPEN", payout: 86, activeId: 81, enabled: true },
  ],
};

const ASSETS = [
  { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 85, expirations: [1, 2] },
  { asset_id: 81, name: "GBP/USD (OTC)", is_open: true, profit_percent: 86, expirations: [1, 2] },
];

const MCP_ACCOUNT = { balances: [{ balance_id: 2, type: "training", currency: "USD", amount: 1000 }] };

const tempDirs: string[] = [];

function tempFilePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "iq-mcp-shadow-"));
  tempDirs.push(dir);
  return join(dir, "reconciliation.jsonl");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function fakeAdapter(options: { assetsOk?: boolean; accountOk?: boolean; health?: string; errorCode?: string } = {}) {
  const { assetsOk = true, accountOk = true, health = "CONNECTED", errorCode = "MCP_TIMEOUT" } = options;
  let assetCalls = 0;
  return {
    assetCalls: () => assetCalls,
    health: () => health,
    listAssets: async () => {
      assetCalls += 1;
      return assetsOk
        ? { ok: true, data: ASSETS, health }
        : { ok: false, error: { code: errorCode, message: `${errorCode} while listing assets` }, health: "UNAVAILABLE" };
    },
    getAccountState: async () =>
      accountOk ? { ok: true, data: MCP_ACCOUNT, health } : { ok: false, error: { code: "MCP_AUTH", message: "auth failed" }, health: "AUTH_ERROR" },
  };
}

type TimerEntry = { fn: () => void; ms: number; cleared: boolean };

function makeRunner(
  options: { env?: Record<string, string>; adapter?: unknown; fetchImpl?: unknown; runner?: Record<string, unknown> } = {},
) {
  const env = options.env ?? { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" };
  const timers: TimerEntry[] = [];
  const fetchCalls: string[] = [];
  const fetchImpl =
    options.fetchImpl ??
    (async (url: string) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify(OFFICE), { status: 200, headers: { "content-type": "application/json" } });
    });
  const adapter = options.adapter ?? fakeAdapter();
  const runner = new IQMCPShadowRunner({
    env,
    adapter,
    fetchImpl,
    now: () => NOW,
    random: () => 0.5,
    setTimer: (fn: () => void, ms: number) => {
      const entry: TimerEntry = { fn, ms, cleared: false };
      timers.push(entry);
      return entry;
    },
    clearTimer: (entry: TimerEntry) => {
      entry.cleared = true;
    },
    persistPath: tempFilePath(),
    ...options.runner,
  });
  return { runner, timers, fetchCalls, adapter };
}

describe("IQ MCP shadow — switches", () => {
  it("is disabled by default: no fetch, no schedule, fail-soft result", async () => {
    expect(shadowEnabled({})).toBe(false);
    const { runner, fetchCalls, timers } = makeRunner({ env: {} });
    expect(runner.enabled).toBe(false);
    expect(runner.start()).toMatchObject({ ok: false, code: "MCP_SHADOW_DISABLED" });
    expect(timers).toHaveLength(0);

    const result = await runner.runOnce();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MCP_SHADOW_DISABLED");
    expect(fetchCalls).toHaveLength(0);
    const status = runner.getShadowStatus();
    expect(status.enabled).toBe(false);
    expect(status.runs).toBe(0);
    expect(status.lastRunAt).toBeNull();
    expect(status.practiceOnly).toBe(true);
  });

  it("requires BOTH IQ_MCP_ENABLED and IQ_MCP_SHADOW", () => {
    expect(shadowEnabled({ IQ_MCP_ENABLED: "true" })).toBe(false);
    expect(shadowEnabled({ IQ_MCP_SHADOW: "true" })).toBe(false);
    expect(shadowEnabled({ IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "false" })).toBe(false);
    expect(shadowEnabled({ IQ_MCP_ENABLED: "1", IQ_MCP_SHADOW: "on" })).toBe(true);
    const { runner } = makeRunner({ env: { IQ_MCP_ENABLED: "true" } });
    expect(runner.enabled).toBe(false);
  });
});

describe("IQ MCP shadow — run", () => {
  it("runs the comparison and persists JSONL when enabled", async () => {
    const file = tempFilePath();
    const { runner, fetchCalls } = makeRunner({ runner: { persistPath: file } });

    const result = await runner.runOnce({ trigger: "test" });
    expect(result.ok).toBe(true);
    expect(result.trigger).toBe("test");
    expect(result.records).toBeGreaterThan(0);
    expect(result.summary.total).toBe(result.records);
    expect(typeof result.summary.agreementRate).toBe("number");
    expect(result.mcpHealth).toBe("CONNECTED");
    expect(fetchCalls).toEqual([DEFAULT_OFFICE_URL]);
    expect(result.persisted).toEqual({ path: file, written: result.records });
    expect(existsSync(file)).toBe(true);

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(result.records);
    expect(() => JSON.parse(lines[0] as string)).not.toThrow();

    const status = runner.getShadowStatus();
    expect(status.runs).toBe(1);
    expect(status.failures).toBe(0);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastRunAt).toBe(NOW);
    expect(status.lastTrigger).toBe("test");
    expect(status.mcpHealth).toBe("CONNECTED");
    expect(status.agreementRate).toBe(result.summary.agreementRate);
    expect(status.persistence.records).toBe(result.records);
  });

  it("fails soft when the MCP adapter is down (never throws, nothing persisted)", async () => {
    const file = tempFilePath();
    const adapter = fakeAdapter({ assetsOk: false, health: "UNAVAILABLE", errorCode: "MCP_TIMEOUT" });
    const { runner, fetchCalls } = makeRunner({ adapter, runner: { persistPath: file } });

    await expect(runner.runOnce()).resolves.toMatchObject({ ok: false, code: "MCP_TIMEOUT" });
    const result = await runner.runOnce();
    expect(result.error.code).toBe("MCP_TIMEOUT");
    expect(result.mcpHealth).toBe("UNAVAILABLE");
    expect(fetchCalls).toHaveLength(2);
    expect(existsSync(file)).toBe(false);

    const status = runner.getShadowStatus();
    expect(status.runs).toBe(2);
    expect(status.failures).toBe(2);
    expect(status.consecutiveFailures).toBe(2);
    expect(status.lastError.code).toBe("MCP_TIMEOUT");
  });

  it("fails soft when the TraceCom office is unreachable and does not touch the adapter", async () => {
    const adapter = fakeAdapter();
    const { runner } = makeRunner({
      adapter,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MCP_SHADOW_ERROR");
    expect(String(result.error.message)).toContain("ECONNREFUSED");
    expect(adapter.assetCalls()).toBe(0);
  });

  it("maps a non-2xx office response to OFFICE_HTTP_ERROR", async () => {
    const { runner } = makeRunner({ fetchImpl: async () => new Response("maintenance", { status: 503 }) });
    const result = await runner.runOnce();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OFFICE_HTTP_ERROR");
  });

  it("keeps the run ok when JSONL persistence fails", async () => {
    const fsImpl = {
      mkdir: async () => undefined,
      appendFile: async () => {
        throw new Error("disk full");
      },
    };
    const { runner } = makeRunner({ runner: { fs: fsImpl } });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(result.persisted).toBeNull();
    expect(result.persistError).toContain("disk full");
    expect(runner.getShadowStatus().persistence.errors).toBe(1);
  });
});

describe("IQ MCP shadow — scheduler", () => {
  it("schedules interval + jitter, never per call, and stop cancels it", async () => {
    const { runner, timers } = makeRunner();
    expect(runner.start()).toMatchObject({ ok: true, alreadyRunning: false });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(62_500); // 60000 + floor(0.5 * 5000)
    expect(runner.getShadowStatus().running).toBe(true);
    expect(runner.nextRunAt).toBe(NOW + 62_500);

    expect(runner.start()).toMatchObject({ ok: true, alreadyRunning: true });
    expect(timers).toHaveLength(1);

    await runner.runOnce({ trigger: "manual" });
    expect(timers).toHaveLength(1); // runOnce itself never schedules

    expect(runner.stop()).toMatchObject({ ok: true, running: false });
    expect(timers[0]?.cleared).toBe(true);
    const status = runner.getShadowStatus();
    expect(status.running).toBe(false);
    expect(status.nextRunAt).toBeNull();
  });

  it("re-runs and re-schedules on every timer tick", async () => {
    const { runner, timers } = makeRunner();
    runner.start();
    timers[0]?.fn();
    const deadline = Date.now() + 3_000;
    while (timers.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(runner.getShadowStatus().runs).toBe(1);
    expect(timers).toHaveLength(2);
    expect(timers[1]?.ms).toBe(62_500);
    runner.stop();
  });
});

