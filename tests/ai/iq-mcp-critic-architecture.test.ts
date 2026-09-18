/**
 * IQ MCP — fresh-critic architecture tests.
 *
 * Proves: the MCP never enters the hot path (no src/api/relay decision module
 * imports it), there is no scheduler inside the adapter and the shadow runner
 * is interval-based and inert while disabled, offline failures propagate as
 * `{ ok:false }` without throwing, and JSONL history is bounded (tail read +
 * rotation). Zero network, zero orders.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { IQOfficialMCPAdapter } from "../../relay/iq-mcp/adapter.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import { createAgentToolGateway } from "../../relay/iq-mcp/llm-guard.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import { IQMCPShadowRunner } from "../../relay/iq-mcp/shadow.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import { DEFAULT_MAX_HISTORY_BYTES, DEFAULT_MAX_HISTORY_RECORDS, loadHistory, persistRecords } from "../../relay/iq-mcp/reconciliation.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MODULE_DIR = join(ROOT, "relay", "iq-mcp");

function walkFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function moduleSource(name: string): string {
  return readFileSync(join(MODULE_DIR, name), "utf8");
}

describe("critic architecture — MCP stays out of the hot path", () => {
  it("no file under src/ or api/ references iq-mcp", () => {
    for (const dir of ["src", "api"]) {
      const files = walkFiles(join(ROOT, dir));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        if (!/\.(ts|js|mjs|cjs)$/i.test(file)) continue;
        expect(readFileSync(file, "utf8").includes("iq-mcp"), file).toBe(false);
      }
    }
  });

  it("no top-level relay module (JIT/decision runtime) imports iq-mcp", () => {
    const relayRoot = join(ROOT, "relay");
    const files = readdirSync(relayRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
    expect(files.length).toBeGreaterThan(0);
    for (const entry of files) {
      const source = readFileSync(join(relayRoot, entry.name), "utf8");
      expect(source.includes("iq-mcp"), entry.name).toBe(false);
    }
  });

  it("only shadow.mjs wires the adapter; the adapter itself has no scheduler", () => {
    const adapter = moduleSource("adapter.mjs");
    expect(adapter.includes("setInterval")).toBe(false);
    expect(adapter.includes("new IQOfficialMCPAdapter")).toBe(false);
    for (const name of ["reconciliation.mjs", "security.mjs", "llm-guard.mjs"]) {
      const source = moduleSource(name);
      expect(source.includes("setInterval"), name).toBe(false);
      expect(source.includes("setTimeout"), name).toBe(false);
    }
    const shadow = moduleSource("shadow.mjs");
    expect(shadow.includes("setInterval")).toBe(false);
    expect(shadow.includes("new IQOfficialMCPAdapter")).toBe(true);
    expect(shadow.includes("setTimer(")).toBe(true);
  });

  it("the AI gateway imports neither the adapter nor fetch", () => {
    const guard = moduleSource("llm-guard.mjs");
    expect(guard.includes("adapter.mjs")).toBe(false);
    expect(guard.includes("fetch(")).toBe(false);
    expect(guard.includes("./security.mjs")).toBe(true);
  });

  it("shadow cannot schedule or fetch while disabled", async () => {
    const schedules: unknown[] = [];
    const runner = new IQMCPShadowRunner({
      env: {},
      adapter: { health: () => "UNAVAILABLE" },
      fetchImpl: async () => {
        throw new Error("shadow must not fetch while disabled");
      },
      setTimer: (fn: () => void, ms: number) => {
        schedules.push({ fn, ms });
        return 0;
      },
    });
    expect(runner.start()).toMatchObject({ ok: false, code: "MCP_SHADOW_DISABLED" });
    expect(schedules).toHaveLength(0);
    const result = await runner.runOnce();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MCP_SHADOW_DISABLED");
    expect(runner.getShadowStatus().running).toBe(false);
  });
});

describe("critic architecture — fail-soft { ok:false } propagation", () => {
  function offlineAdapter(fetchImpl: unknown) {
    return new IQOfficialMCPAdapter({ product: "binary", enabled: true, token: "t", fetchImpl, maxRetries: 0 });
  }

  it("never throws and always returns { ok:false, error.code } when the transport is offline", async () => {
    const adapter = offlineAdapter(async () => {
      throw new Error("ECONNREFUSED");
    });
    const results = await Promise.all([
      adapter.discoverCapabilities(),
      adapter.listAssets(),
      adapter.getMarketStatus(76),
      adapter.getPayout(76),
      adapter.getExpirations(76),
      adapter.getCandles(76, 60, 10),
      adapter.getAccountState(),
      adapter.getPositions(),
      adapter.getSettlement(50),
      adapter.getLimits(),
      adapter.invokeTool("list_assets"),
    ]);
    for (const res of results) {
      expect(res.ok).toBe(false);
      expect(typeof res.error.code).toBe("string");
    }
  });

  it("survives a transport that throws synchronously", async () => {
    const adapter = offlineAdapter(() => {
      throw new Error("sync explosion");
    });
    const res = await adapter.listAssets();
    expect(res.ok).toBe(false);
    expect(typeof res.error.code).toBe("string");
  });

  it("propagates { ok:false } through the AI gateway without throwing", async () => {
    const execute = async () => ({ ok: false, error: { code: "MCP_UNAVAILABLE", message: "offline" } });
    const gateway = createAgentToolGateway({ agent: "critic", execute });
    const res = await gateway.callTool("list_assets", {});
    expect(res).toMatchObject({ ok: false, error: { code: "MCP_UNAVAILABLE" } });
  });

  it("queues a concurrent burst through the local limiter without starvation", async () => {
    let nowMs = 0;
    const requests: Array<{ method?: string }> = [];
    const rpcMessage = (id: number | undefined, payload: unknown) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } });
    const fetchImpl = async (_url: string, init: { body?: string }) => {
      const req = JSON.parse(init.body ?? "{}");
      requests.push(req);
      if (req.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "burst" },
        });
      }
      if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify(rpcMessage(req.id, { candles: [] })), { status: 200, headers: { "content-type": "application/json" } });
    };
    const adapter = new IQOfficialMCPAdapter({
      product: "binary",
      enabled: true,
      token: "t",
      fetchImpl,
      maxRetries: 0,
      maxRateWaitMs: 5_000,
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    });

    const results = (await Promise.all(Array.from({ length: 100 }, (_value, index) => adapter.getCandles(76, 60, index + 1)))) as Array<{ ok: boolean }>;
    expect(results.every((res) => res.ok)).toBe(true);
    expect(adapter.stats.rateLimited).toBe(0);
    expect(requests.filter((req) => req.method === "tools/call")).toHaveLength(100);
    expect(nowMs).toBeGreaterThanOrEqual(40_000);
  });
});

describe("critic architecture — bounded JSONL history", () => {
  it("reads only a bounded tail of a huge file", async () => {
    const reads: Array<{ length: number; position: number }> = [];
    const fsImpl = {
      stat: async () => ({ size: 10_000_000 }),
      open: async () => ({
        read: async (_buffer: Buffer, _offset: number, length: number, position: number) => {
          reads.push({ length, position });
          return { bytesRead: length };
        },
        close: async () => undefined,
      }),
    };
    const records = await loadHistory({ path: "virtual.jsonl", maxBytes: 4096, fsImpl });
    expect(records).toEqual([]);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.length).toBe(4096);
    expect(reads[0]?.position).toBe(10_000_000 - 4096);
    expect(DEFAULT_MAX_HISTORY_BYTES).toBeGreaterThanOrEqual(4096);
    expect(DEFAULT_MAX_HISTORY_RECORDS).toBeGreaterThan(0);
  });

  it("rotates the JSONL file when it exceeds the byte cap and keeps the newest records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-mcp-history-"));
    const file = join(dir, "history.jsonl");
    try {
      for (let i = 0; i < 40; i += 1) {
        await persistRecords([{ i, timestamp: 1_789_700_000_000 + i, payload: "x".repeat(200) }], { path: file, maxBytes: 1024, maxRecords: 8 });
      }
      const info = await stat(file);
      expect(info.size).toBeLessThanOrEqual(1024);

      const loaded = await loadHistory({ path: file });
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded.length).toBeLessThanOrEqual(8);
      expect(loaded.at(-1)).toMatchObject({ i: 39 });

      const lastTwo = await loadHistory({ path: file, limit: 2 });
      expect(lastTwo).toHaveLength(2);
      expect(lastTwo.at(-1)).toMatchObject({ i: 39 });
      for (const record of loaded) expect(() => JSON.stringify(record)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps history intact while the file stays below the rotation cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-mcp-history-small-"));
    const file = join(dir, "history.jsonl");
    try {
      await persistRecords([{ i: 1 }], { path: file });
      await persistRecords([{ i: 2 }], { path: file });
      expect((await stat(file)).size).toBeLessThan(DEFAULT_MAX_HISTORY_BYTES);
      const loaded = await loadHistory({ path: file });
      expect(loaded).toEqual([{ i: 1 }, { i: 2 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
