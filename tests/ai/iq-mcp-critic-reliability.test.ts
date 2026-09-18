/**
 * IQ Official MCP — adversarial critic reliability suite (fresh, not the builder).
 *
 * Counterexamples for timeout/session integrity, mid-run token revocation,
 * hostile Retry-After, 5xx bursts, malformed JSON-RPC (incl. the isError
 * false-success path), concurrency/rate limits, session expiry and offline
 * isolation. Every transport is mocked: zero real network, zero orders.
 *
 * Also enforces the exported-surface inventory (every export has a test) and
 * pins three mutation gaps the previous suite would not have caught.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import * as adapterModule from "../../relay/iq-mcp/adapter.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import * as reconciliationModule from "../../relay/iq-mcp/reconciliation.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import * as shadowModule from "../../relay/iq-mcp/shadow.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import * as llmGuardModule from "../../relay/iq-mcp/llm-guard.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import * as securityModule from "../../relay/iq-mcp/security.mjs";

const {
  HEALTH,
  IQ_MCP_PRODUCTS,
  IQOfficialMCPAdapter,
  MAX_CACHE_ENTRIES,
  MAX_RATE_LIMIT_PAUSE_MS,
  PROTOCOL_VERSION,
  RateLimiter,
  READ_TOOLS,
  TokenBucket,
  WRITE_TOOLS,
} = adapterModule;
const {
  AVAILABILITY_STATES,
  DEFAULT_MAX_HISTORY_BYTES,
  DEFAULT_MAX_HISTORY_RECORDS,
  assetMarketType,
  normalizeInternalAccount,
  normalizeMcpAccount,
} = reconciliationModule;
const { DEFAULT_INTERVAL_MS, DEFAULT_JITTER_MS, DEFAULT_OFFICE_URL, DEFAULT_TIMEOUT_MS, IQMCPShadowRunner } = shadowModule;

const TOKEN = "critic-reliability-token-not-real";
const NOW = 1_789_700_000_000;

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<Response>;
type RpcRequest = { jsonrpc?: string; method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } };
type Recorded = { method?: string; id?: number; name?: string; session: string | null; at: number };

const ASSETS = [
  { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 89, precision: 6, expirations: [1, 2, 3] },
  { asset_id: 81, name: "GBP/USD (OTC)", is_open: false, profit_percent: 86, precision: 6, expirations: [] },
];

const TOOL_PAYLOADS: Record<string, unknown> = {
  get_capabilities: { mode: "read-write", product: "binary-options" },
  get_limits: { buckets: [{ bucket: "read", limit: 60, window_seconds: 60 }] },
  list_assets: { assets: ASSETS },
  list_balances: { balances: [{ balance_id: 2, type: "training", currency: "USD", amount: 60 }] },
  list_positions: { positions: [] },
  get_trade_history: { trades: [] },
  get_candles: { candles: [] },
};

const tempDirs: string[] = [];

function tempFilePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "iq-mcp-critic-"));
  tempDirs.push(dir);
  return join(dir, "reconciliation.jsonl");
}

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function rpcMessage(id: number | undefined, payload: unknown) {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function neverResolves(): FetchLike {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort);
    });
}

type TransportOptions = {
  sessionId?: string;
  now?: () => number;
  onRequest?: (req: RpcRequest, nowMs: number) => Response | null;
  onTool?: (name: string, req: RpcRequest, nowMs: number) => Response | Promise<Response> | null;
};

function mockTransport(options: TransportOptions = {}) {
  const sessionId = options.sessionId ?? "sess-critic";
  const now = options.now ?? (() => 0);
  const requests: Recorded[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body ?? "{}") as RpcRequest;
    const headers = init.headers ?? {};
    requests.push({ method: req.method, id: req.id, name: req.params?.name, session: headers["mcp-session-id"] ?? null, at: now() });
    if (options.onRequest) {
      const custom = options.onRequest(req, now());
      if (custom) return custom;
    }
    if (req.method === "initialize") {
      return jsonResponse({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } }, { "mcp-session-id": sessionId });
    }
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (req.method === "tools/call") {
      const name = String(req.params?.name ?? "");
      if (options.onTool) {
        const custom = await options.onTool(name, req, now());
        if (custom) return custom;
      }
      return jsonResponse(rpcMessage(req.id, TOOL_PAYLOADS[name] ?? {}));
    }
    return jsonResponse({ jsonrpc: "2.0", id: req.id, result: {} });
  };
  return { fetchImpl, requests };
}

function newAdapter(fetchImpl: FetchLike, options: Record<string, unknown> = {}) {
  return new IQOfficialMCPAdapter({
    product: "binary",
    enabled: true,
    token: TOKEN,
    fetchImpl,
    retryBaseMs: 1,
    maxRetries: 0,
    sleep: async () => {},
    ...options,
  });
}

function toolCalls(requests: Recorded[]) {
  return requests.filter((request) => request.method === "tools/call");
}

function officeResponse(body: unknown = OFFICE, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OFFICE = {
  at: NOW,
  mode: "PRACTICE",
  markets: [],
  modeState: { practice: { balance: 60, currency: "USD" } },
};

function fakeAdapter(options: { assetsOk?: boolean; accountOk?: boolean; health?: string; errorCode?: string; throwOnAssets?: boolean } = {}) {
  const { assetsOk = true, accountOk = true, health = "CONNECTED", errorCode = "MCP_NETWORK", throwOnAssets = false } = options;
  return {
    health: () => health,
    listAssets: async () => {
      if (throwOnAssets) throw new Error("adapter contract violation");
      return assetsOk
        ? { ok: true, data: ASSETS, health }
        : { ok: false, error: { code: errorCode, message: `${errorCode} while listing assets` }, health: "UNAVAILABLE" };
    },
    getAccountState: async () =>
      accountOk ? { ok: true, data: TOOL_PAYLOADS.list_balances, health } : { ok: false, error: { code: "MCP_AUTH", message: "auth failed" }, health: "AUTH_ERROR" },
  };
}

describe("critic reliability — timeouts and session integrity (counterexample 1)", () => {
  it("timeout mid-initialize leaves no session behind and the next call initializes from scratch", async () => {
    let firstInitialize = true;
    const transport = mockTransport();
    const fetchImpl: FetchLike = (url, init) => {
      const req = JSON.parse(init.body ?? "{}") as RpcRequest;
      if (req.method === "initialize" && firstInitialize) {
        firstInitialize = false;
        return neverResolves()(url, init);
      }
      return transport.fetchImpl(url, init);
    };
    const adapter = newAdapter(fetchImpl, { timeoutMs: 15, maxRetries: 0 });

    const first = await adapter.listAssets();
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("MCP_TIMEOUT");
    expect(first.health).toBe(HEALTH.DEGRADED);
    expect(adapter.health()).toBe(HEALTH.DEGRADED);
    expect(adapter.sessionId).toBeNull();
    expect(adapter.inflight.size).toBe(0);

    const second = await adapter.listAssets();
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(false);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
    expect(adapter.sessionId).toBe("sess-critic");
    expect(transport.requests.map((request) => request.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  });

  it("timeout mid-tools/call keeps the valid session, reports DEGRADED and never claims CONNECTED", async () => {
    let firstToolCall = true;
    const transport = mockTransport();
    const fetchImpl: FetchLike = (url, init) => {
      const req = JSON.parse(init.body ?? "{}") as RpcRequest;
      if (req.method === "tools/call" && firstToolCall) {
        firstToolCall = false;
        return neverResolves()(url, init);
      }
      return transport.fetchImpl(url, init);
    };
    const adapter = newAdapter(fetchImpl, { timeoutMs: 15, maxRetries: 0 });

    const first = await adapter.invokeTool("get_candles", { asset_id: 76, size: 60, count: 1 });
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("MCP_TIMEOUT");
    expect(first.health).toBe(HEALTH.DEGRADED);
    expect(adapter.health()).toBe(HEALTH.DEGRADED);
    expect(adapter.sessionId).toBe("sess-critic");

    const second = await adapter.invokeTool("get_candles", { asset_id: 76, size: 60, count: 2 });
    expect(second.ok).toBe(true);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
    expect(transport.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(transport.requests.filter((request) => request.method === "tools/call")).toHaveLength(1);
  });
});

describe("critic reliability — token revoked mid-session (counterexample 2)", () => {
  it("401 after a working session: AUTH_ERROR with one fetch per call, no retry storm", async () => {
    let revoked = false;
    const transport = mockTransport({
      onTool: (name) => (revoked && name === "get_candles" ? new Response("unauthorized", { status: 401 }) : null),
    });
    const adapter = newAdapter(transport.fetchImpl, { maxRetries: 3, retryBaseMs: 1 });

    const before = await adapter.invokeTool("get_candles", { asset_id: 76, size: 60, count: 1 });
    expect(before.ok).toBe(true);
    const baselineRequests = transport.requests.length;
    const baselineRetries = adapter.stats.retries;

    revoked = true;
    for (let call = 0; call < 3; call += 1) {
      const count = transport.requests.length;
      const res = await adapter.invokeTool("get_candles", { asset_id: 76, size: 60, count: 10 + call });
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe("MCP_AUTH");
      expect(res.health).toBe(HEALTH.AUTH_ERROR);
      expect(transport.requests.length - count).toBe(1);
    }

    expect(transport.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(adapter.stats.retries).toBe(baselineRetries);
    expect(adapter.health()).toBe(HEALTH.AUTH_ERROR);
    expect(baselineRequests).toBe(3);
  });
});

describe("critic reliability — hostile Retry-After (counterexample 3)", () => {
  it.each(["0", "-5", "not-a-number", "Wed, 21 Oct 2026 07:28:00 GMT", "31536000"])(
    "429 retry-after %s is bounded and never a permanent lockout",
    async (value: string) => {
      let nowMs = 0;
      let limited = true;
      const transport = mockTransport({
        now: () => nowMs,
        onTool: (name) => {
          if (name === "get_limits" && limited) return new Response("slow down", { status: 429, headers: { "retry-after": value } });
          return null;
        },
      });
      const adapter = newAdapter(transport.fetchImpl, { maxRetries: 3, now: () => nowMs, maxRateWaitMs: 1 });

      const res = await adapter.getLimits();
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe("MCP_RATE_LIMITED");
      expect(adapter.health()).toBe(HEALTH.RATE_LIMITED);
      expect(toolCalls(transport.requests)).toHaveLength(1);

      const waitMs = adapter.limiter.read.waitMs();
      expect(Number.isFinite(waitMs)).toBe(true);
      expect(waitMs).toBeGreaterThan(0);
      expect(waitMs).toBeLessThanOrEqual(MAX_RATE_LIMIT_PAUSE_MS);
      if (value === "31536000") expect(waitMs).toBe(MAX_RATE_LIMIT_PAUSE_MS);

      nowMs += waitMs + 1;
      expect(adapter.limiter.read.waitMs()).toBe(0);

      limited = false;
      const recovered = await adapter.listAssets();
      expect(recovered.ok).toBe(true);
      expect(adapter.health()).toBe(HEALTH.CONNECTED);
    },
  );
});

describe("critic reliability — 5xx burst and recovery (counterexample 4)", () => {
  it("capped retries end in UNAVAILABLE and the next call recovers to CONNECTED", async () => {
    let failing = true;
    const transport = mockTransport({
      onRequest: () => (failing ? new Response("boom", { status: 503 }) : null),
    });
    const adapter = newAdapter(transport.fetchImpl, { maxRetries: 2 });

    const down = await adapter.listAssets();
    expect(down.ok).toBe(false);
    expect(down.error.code).toBe("MCP_HTTP_5XX");
    expect(down.health).toBe(HEALTH.UNAVAILABLE);
    expect(adapter.health()).toBe(HEALTH.UNAVAILABLE);
    expect(transport.requests).toHaveLength(3);

    failing = false;
    const up = await adapter.listAssets();
    expect(up.ok).toBe(true);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });

  it("shadow runner: degraded run reconnects on the next scheduled run", async () => {
    let failing = true;
    const transport = mockTransport({
      onRequest: () => (failing ? new Response("boom", { status: 503 }) : null),
    });
    const adapter = newAdapter(transport.fetchImpl, { maxRetries: 1 });
    const runner = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter,
      fetchImpl: async () => officeResponse(),
      now: () => NOW,
      persist: false,
    });

    const first = await runner.runOnce({ trigger: "schedule" });
    expect(first.ok).toBe(false);
    expect(first.mcpHealth).toBe(HEALTH.UNAVAILABLE);
    expect(runner.getShadowStatus().consecutiveFailures).toBe(1);

    failing = false;
    const second = await runner.runOnce({ trigger: "schedule" });
    expect(second.ok).toBe(true);
    expect(second.mcpHealth).toBe(HEALTH.CONNECTED);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
    expect(runner.getShadowStatus().consecutiveFailures).toBe(0);
  });
});

describe("critic reliability — malformed JSON-RPC never a false success (counterexample 5)", () => {
  it("JSON body with the wrong id is MCP_MALFORMED", async () => {
    const transport = mockTransport({
      onTool: (_name, req) =>
        jsonResponse({
          jsonrpc: "2.0",
          id: (req.id ?? 0) + 7,
          result: { content: [{ type: "text", text: JSON.stringify({ assets: ASSETS }) }] },
        }),
    });
    const res = await newAdapter(transport.fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
    expect(res.health).toBe(HEALTH.DEGRADED);
    expect(res.data).toBeUndefined();
  });

  it("empty HTTP body is MCP_EMPTY", async () => {
    const transport = mockTransport({
      onTool: () => new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    });
    const res = await newAdapter(transport.fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_EMPTY");
    expect(res.health).toBe(HEALTH.DEGRADED);
  });

  it("an HTML body is MCP_MALFORMED and never parsed as data", async () => {
    const transport = mockTransport({
      onTool: () => new Response("<html><body>gateway error</body></html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const res = await newAdapter(transport.fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
  });

  it("a truncated SSE stream is MCP_MALFORMED (no events survive)", async () => {
    const transport = mockTransport({
      onTool: () => new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"resu', { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const res = await newAdapter(transport.fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
    expect(res.health).toBe(HEALTH.DEGRADED);
  });

  it("a JSON-RPC error object is MCP_RPC_ERROR, not a success", async () => {
    const transport = mockTransport({
      onTool: (_name, req) => jsonResponse({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "tool failed" } }),
    });
    const res = await newAdapter(transport.fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_RPC_ERROR");
    expect(res.error.message).toContain("tool failed");
  });

  it("tools/call result with isError:true is a typed MCP_TOOL_ERROR, never a success", async () => {
    const transport = mockTransport({
      onTool: (_name, req) =>
        jsonResponse({ jsonrpc: "2.0", id: req.id, result: { isError: true, content: [{ type: "text", text: `cannot read with ${TOKEN}` }] } }),
    });
    const res = await newAdapter(transport.fetchImpl).getPositions(2);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_TOOL_ERROR");
    expect(res.health).toBe(HEALTH.DEGRADED);
    expect(res.error.message).not.toContain(TOKEN);
    expect(res.error.message).toContain("<REDACTED>");
  });
});

describe("critic reliability — concurrency and local rate limit (counterexample 6)", () => {
  it("two simultaneous calls for the same asset coalesce into exactly one fetch", async () => {
    let toolFetches = 0;
    let release!: () => void;
    const transport = mockTransport({
      onTool: (_name, req) => {
        toolFetches += 1;
        return new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(rpcMessage(req.id, { candles: [] })));
        });
      },
    });
    const adapter = newAdapter(transport.fetchImpl);

    const p1 = adapter.getCandles(76, 60, 10);
    const p2 = adapter.getCandles(76, 60, 10);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(toolFetches).toBe(1);

    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r1).toBe(r2);
    expect(toolFetches).toBe(1);
  });

  it("100 simultaneous differing reads queue through the limiter and respect 60 burst + 1/s refill", async () => {
    let nowMs = 0;
    const grants: number[] = [];
    const transport = mockTransport({ now: () => nowMs });
    const adapter = newAdapter(transport.fetchImpl, {
      maxRetries: 0,
      maxRateWaitMs: 60_000,
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    });
    const originalTake = adapter.limiter.take.bind(adapter.limiter);
    adapter.limiter.take = (kind: string, cost?: number) => {
      const ticket = originalTake(kind, cost);
      if (ticket.ok && kind === "read") grants.push(nowMs);
      return ticket;
    };

    const results = await Promise.all(Array.from({ length: 100 }, (_value, index) => adapter.getCandles(76, 60, index + 1)));
    expect(results.every((res: { ok: boolean }) => res.ok)).toBe(true);
    expect(adapter.stats.rateLimited).toBe(0);
    expect(nowMs).toBeGreaterThanOrEqual(40_000);

    expect(grants).toHaveLength(100);
    expect(grants.filter((at) => at === 0)).toHaveLength(60);
    const spanMs = Math.max(...grants) - Math.min(...grants);
    expect(grants.length).toBeLessThanOrEqual(60 + spanMs / 1000);
    expect(toolCalls(transport.requests)).toHaveLength(100);
  });
});

describe("critic reliability — session expiry 404 (counterexample 7)", () => {
  it("re-initializes once and retries the call once with the fresh session", async () => {
    let initializeCount = 0;
    let stale404 = 0;
    const transport = mockTransport({
      onRequest: (req) => {
        if (req.method === "initialize") {
          initializeCount += 1;
          return jsonResponse(
            { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } },
            { "mcp-session-id": initializeCount === 1 ? "sess-expired" : "sess-fresh" },
          );
        }
        return null;
      },
    });
    const fetchImpl: FetchLike = (url, init) => {
      const req = JSON.parse(init.body ?? "{}") as RpcRequest;
      if (req.method === "tools/call" && init.headers?.["mcp-session-id"] === "sess-expired") {
        stale404 += 1;
        return Promise.resolve(new Response("session not found", { status: 404, headers: { "content-type": "application/json" } }));
      }
      return transport.fetchImpl(url, init);
    };
    const adapter = newAdapter(fetchImpl);

    const res = await adapter.getLimits();
    expect(res.ok).toBe(true);
    expect(stale404).toBe(1);
    expect(initializeCount).toBe(2);
    const calls = toolCalls(transport.requests);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.session).toBe("sess-fresh");
    expect(adapter.sessionId).toBe("sess-fresh");
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });

  it("persistent 404s stay bounded: one re-init + one retry per call, no infinite loop", async () => {
    let initializeCount = 0;
    const transport = mockTransport({
      onRequest: (req) => {
        if (req.method === "initialize") {
          initializeCount += 1;
          return jsonResponse(
            { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } },
            { "mcp-session-id": `sess-${initializeCount}` },
          );
        }
        if (req.method === "tools/call") return new Response("gone", { status: 404, headers: { "content-type": "application/json" } });
        return null;
      },
    });
    const adapter = newAdapter(transport.fetchImpl);

    const first = await adapter.listAssets();
    expect(first.ok).toBe(false);
    expect(initializeCount).toBe(2);
    expect(toolCalls(transport.requests)).toHaveLength(2);

    const second = await adapter.listAssets();
    expect(second.ok).toBe(false);
    expect(initializeCount).toBe(3);
    expect(toolCalls(transport.requests)).toHaveLength(4);
    expect(adapter.health()).toBe(HEALTH.DEGRADED);
  });
});

describe("critic reliability — offline isolation (counterexample 8)", () => {
  it("a rejecting fetch yields {ok:false}/UNAVAILABLE for every read and never throws", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
    };
    const adapter = newAdapter(fetchImpl, { maxRetries: 0 });

    const results = [
      await adapter.discoverCapabilities(),
      await adapter.listAssets(),
      await adapter.getMarketStatus(76),
      await adapter.getPayout(76),
      await adapter.getExpirations(76),
      await adapter.getCandles(76, 60, 10),
      await adapter.getAccountState(),
      await adapter.getPositions(),
      await adapter.getSettlement(50),
      await adapter.getLimits(),
      await adapter.invokeTool("list_assets"),
    ];

    for (const res of results) {
      expect(res.ok).toBe(false);
      expect(res.health).toBe(HEALTH.UNAVAILABLE);
      expect(res.error.code).toBe("MCP_NETWORK");
    }
    expect(adapter.health()).toBe(HEALTH.UNAVAILABLE);
    expect(calls).toBeGreaterThan(0);
  });

  it("shadow runner stays fail-soft with a down MCP, persists nothing and recovers cleanly", async () => {
    let down = true;
    const adapter = {
      health: () => (down ? "UNAVAILABLE" : "CONNECTED"),
      listAssets: async () =>
        down
          ? { ok: false, error: { code: "MCP_NETWORK", message: "offline" }, health: "UNAVAILABLE" }
          : { ok: true, data: ASSETS, health: "CONNECTED" },
      getAccountState: async () => ({ ok: true, data: TOOL_PAYLOADS.list_balances, health: down ? "UNAVAILABLE" : "CONNECTED" }),
    };
    const file = tempFilePath();
    const runner = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter,
      fetchImpl: async () => officeResponse(),
      now: () => NOW,
      persistPath: file,
      persist: true,
    });

    const failed = await runner.runOnce({ trigger: "schedule" });
    expect(failed.ok).toBe(false);
    expect(failed.mcpHealth).toBe("UNAVAILABLE");
    expect(failed.persisted).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    expect(runner.getShadowStatus().failures).toBe(1);

    down = false;
    const recovered = await runner.runOnce({ trigger: "schedule" });
    expect(recovered.ok).toBe(true);
    expect(recovered.persisted?.written).toBe(recovered.records);
    expect(runner.getShadowStatus().consecutiveFailures).toBe(0);
  });

  it("shadow runner catches a throwing adapter instead of leaking the exception", async () => {
    const runner = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter: fakeAdapter({ throwOnAssets: true }),
      fetchImpl: async () => officeResponse(),
      now: () => NOW,
      persist: false,
    });
    const res = await runner.runOnce();
    expect(res.ok).toBe(false);
    expect(res.code).toBe("MCP_SHADOW_ERROR");
    expect(String(res.error.message)).toContain("adapter contract violation");
  });
});

describe("critic mutation gaps — regressions the previous suite could not catch", () => {
  it("M1: a malformed initialize response cannot poison the session id", async () => {
    let initializeCount = 0;
    const transport = mockTransport({
      onRequest: (req) => {
        if (req.method === "initialize") {
          initializeCount += 1;
          if (initializeCount === 1) {
            return new Response("{truncated", {
              status: 200,
              headers: { "content-type": "application/json", "mcp-session-id": "sess-poisoned" },
            });
          }
        }
        return null;
      },
    });
    const adapter = newAdapter(transport.fetchImpl);

    const first = await adapter.listAssets();
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("MCP_MALFORMED");
    expect(adapter.sessionId).toBeNull();

    const second = await adapter.listAssets();
    expect(second.ok).toBe(true);
    expect(initializeCount).toBe(2);
    expect(adapter.sessionId).toBe("sess-critic");
    expect(transport.requests.some((request) => request.session === "sess-poisoned")).toBe(false);
  });

  it("M1b: a failing 5xx response carrying a session header cannot seed a session", async () => {
    const transport = mockTransport({
      onRequest: (req) =>
        req.method === "initialize" ? new Response("boom", { status: 503, headers: { "mcp-session-id": "sess-poisoned" } }) : null,
    });
    const adapter = newAdapter(transport.fetchImpl);
    const res = await adapter.listAssets();
    expect(res.ok).toBe(false);
    expect(adapter.sessionId).toBeNull();
  });

  it("M2: TTL cache actually expires (stale data is not served forever)", async () => {
    let nowMs = 0;
    const transport = mockTransport({ now: () => nowMs });
    const adapter = newAdapter(transport.fetchImpl, { now: () => nowMs });

    const first = await adapter.listAssets();
    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);
    expect(toolCalls(transport.requests)).toHaveLength(1);

    nowMs += 30_001;
    const second = await adapter.listAssets();
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(false);
    expect(toolCalls(transport.requests)).toHaveLength(2);
  });

  it("M5: cache keys include the tool arguments", async () => {
    const transport = mockTransport();
    const adapter = newAdapter(transport.fetchImpl);

    await adapter.getSettlement(10);
    await adapter.getSettlement(20);
    expect(toolCalls(transport.requests)).toHaveLength(2);
    expect(toolCalls(transport.requests).map((call) => call.name)).toEqual(["get_trade_history", "get_trade_history"]);

    const cached = await adapter.getSettlement(10);
    expect(cached.cached).toBe(true);
    expect(toolCalls(transport.requests)).toHaveLength(2);
  });

  it("M4: account mode is derived from the balances, not hardcoded", async () => {
    const cases: Array<{ balances: unknown[]; mode: string }> = [
      { balances: [{ type: "training", currency: "USD", amount: 60 }], mode: "PRACTICE" },
      { balances: [{ type: "regular", currency: "USD", amount: 0 }], mode: "REAL" },
      { balances: [{ type: "training" }, { type: "regular" }], mode: "MIXED" },
      { balances: [], mode: "UNKNOWN" },
    ];
    for (const testCase of cases) {
      const transport = mockTransport({
        onTool: (name, req) => (name === "list_balances" ? jsonResponse(rpcMessage(req.id, { balances: testCase.balances })) : null),
      });
      const account = await newAdapter(transport.fetchImpl).getAccountState();
      expect(account.ok, testCase.mode).toBe(true);
      expect(account.data.mode, testCase.mode).toBe(testCase.mode);
      expect(account.data.practiceOnly).toBe(true);
    }
  });
});

describe("critic surface — exported modules and untested exports", () => {
  it("every relay/iq-mcp module exports exactly the inventoried surface (new exports must get tests)", () => {
    const expected: Record<string, string[]> = {
      adapter: [
        "CLIENT_NAME",
        "CLIENT_VERSION",
        "HEALTH",
        "IQOfficialMCPAdapter",
        "IQ_MCP_PRODUCTS",
        "MAX_CACHE_ENTRIES",
        "MAX_RATE_LIMIT_PAUSE_MS",
        "PROTOCOL_VERSION",
        "READ_TOOLS",
        "RateLimiter",
        "TokenBucket",
        "WRITE_TOOLS",
        "default",
      ],
      reconciliation: [
        "AVAILABILITY_STATES",
        "BALANCE_TOLERANCE",
        "CLASSIFICATION",
        "DEFAULT_MAX_HISTORY_BYTES",
        "DEFAULT_MAX_HISTORY_RECORDS",
        "DEFAULT_RECONCILIATION_PATH",
        "FIELD",
        "STALE_SKEW_MS",
        "assetMarketKey",
        "assetMarketType",
        "buildComparisons",
        "classifyNumeric",
        "loadHistory",
        "normalizeCanonical",
        "normalizeInternalAccount",
        "normalizeMcpAccount",
        "persistRecords",
        "summarize",
      ],
      shadow: ["DEFAULT_INTERVAL_MS", "DEFAULT_JITTER_MS", "DEFAULT_OFFICE_URL", "DEFAULT_TIMEOUT_MS", "IQMCPShadowRunner", "default", "shadowEnabled"],
      "llm-guard": ["AGENTS", "READ_TOOL_ALLOWLIST", "assertAgentAllowed", "assertReadTool", "createAgentToolGateway", "default", "normalizeToolName"],
      security: ["RISK", "assertReadOnlyMethod", "assertReadProbeMethod", "assertToolAllowed", "classifyTool", "containsSecret", "redact"],
    };
    const modules: Record<string, Record<string, unknown>> = {
      adapter: adapterModule,
      reconciliation: reconciliationModule,
      shadow: shadowModule,
      "llm-guard": llmGuardModule,
      security: securityModule,
    };
    for (const [name, module] of Object.entries(modules)) {
      expect(Object.keys(module).sort(), name).toEqual([...(expected[name] ?? [])].sort());
    }
    expect(adapterModule.default).toBe(IQOfficialMCPAdapter);
    expect(shadowModule.default).toBe(IQMCPShadowRunner);
    expect(llmGuardModule.default).toBe(llmGuardModule.createAgentToolGateway);
  });

  it("adapter constants pin the verified protocol/client contract", () => {
    expect(PROTOCOL_VERSION).toBe("2024-11-05");
    expect(adapterModule.CLIENT_NAME).toBe("tracecom-iq-mcp-adapter");
    expect(adapterModule.CLIENT_VERSION).toBe("0.1.0");
    expect(MAX_CACHE_ENTRIES).toBe(256);
    expect(MAX_RATE_LIMIT_PAUSE_MS).toBe(15 * 60_000);
    expect(IQ_MCP_PRODUCTS.binary).toBe("https://binary-options.mcp.iqoption.com");
    expect(IQ_MCP_PRODUCTS.turbo).toBe("https://turbo-options.mcp.iqoption.com");
    expect(Object.isFrozen(IQ_MCP_PRODUCTS)).toBe(true);
    expect(READ_TOOLS).toHaveLength(7);
    expect(WRITE_TOOLS).toEqual(["place_trade", "sell_position", "rollover_position"]);
  });

  it("TokenBucket: capacity, continuous refill, pause and setCapacity", () => {
    let nowMs = 0;
    const bucket = new TokenBucket({ limit: 3, windowMs: 3_000, now: () => nowMs });
    expect(bucket.take().ok).toBe(true);
    expect(bucket.take().ok).toBe(true);
    expect(bucket.take().ok).toBe(true);
    const denied = bucket.take();
    expect(denied.ok).toBe(false);
    expect(denied.waitMs).toBe(1_000);
    nowMs += 1_000;
    expect(bucket.take().ok).toBe(true);

    nowMs += 10_000;
    expect(bucket.waitMs()).toBe(0);
    expect(bucket.tokens).toBe(3);

    bucket.pause(2_000);
    expect(bucket.waitMs()).toBe(2_000);
    expect(bucket.take().ok).toBe(false);
    nowMs += 2_000;
    expect(bucket.take().ok).toBe(true);

    const tight = new TokenBucket({ limit: 5, windowMs: 60_000, now: () => nowMs });
    tight.take(4);
    tight.setCapacity(2, 60_000);
    expect(tight.limit).toBe(2);
    expect(tight.tokens).toBe(1);
    expect(tight.take(2).ok).toBe(false);
    expect(tight.take(2).waitMs).toBe(30_000);
    nowMs += 30_000;
    expect(tight.take(2).ok).toBe(true);
  });

  it("RateLimiter: shared gateway, pause across buckets and setLimit", () => {
    let nowMs = 0;
    const limiter = new RateLimiter({
      limits: { gateway: { limit: 10, windowMs: 60_000 }, read: { limit: 5, windowMs: 60_000 } },
      now: () => nowMs,
    });
    expect(limiter.take("read").ok).toBe(true);
    expect(limiter.take("control").ok).toBe(true);
    expect(limiter.snapshot().gateway.limit).toBe(10);
    expect(limiter.snapshot().read.limit).toBe(5);

    limiter.setLimit("read", 1, 90_000);
    expect(limiter.snapshot().read.limit).toBe(1);
    expect(limiter.snapshot().read.windowMs).toBe(90_000);
    limiter.setLimit("unknown", 99, 1);
    expect(limiter.snapshot().read.limit).toBe(1);

    limiter.pause(5_000);
    expect(limiter.read.waitMs()).toBe(5_000);
    expect(limiter.write.waitMs()).toBe(5_000);
    expect(limiter.gateway.waitMs()).toBe(5_000);
    nowMs += 5_000;
    expect(limiter.read.waitMs()).toBe(0);
  });

  it("reconciliation helpers cover the previously untested exports", () => {
    expect(AVAILABILITY_STATES).toEqual(["OPEN", "DISABLED", "SUSPENDED", "NOT_OFFERED", "UNKNOWN"]);
    expect(Object.isFrozen(AVAILABILITY_STATES)).toBe(true);
    expect(DEFAULT_MAX_HISTORY_BYTES).toBe(2 * 1024 * 1024);
    expect(DEFAULT_MAX_HISTORY_RECORDS).toBe(20_000);

    expect(assetMarketType({ name: "EUR/USD (OTC)" })).toBe("OTC");
    expect(assetMarketType({ name: "EUR/USD" })).toBe("NORMAL");
    expect(assetMarketType(null)).toBe("NORMAL");

    const internal = normalizeInternalAccount({
      at: 123,
      mode: "practice",
      modeState: { practice: { balance: "1000.5", currency: "usd" } },
    });
    expect(internal).toEqual({ mode: "PRACTICE", balance: 1000.5, currency: "USD", at: 123 });
    expect(normalizeInternalAccount(null)).toBeNull();
    expect(normalizeInternalAccount("nope")).toBeNull();

    const asArray = normalizeMcpAccount([{ type: "training", currency: "usd", amount: 1000 }]);
    expect(asArray?.mode).toBe("PRACTICE");
    expect(asArray?.training?.amount).toBe(1000);
    const mixed = normalizeMcpAccount({ data: { balances: [{ type: "regular", amount: "5" }, { type: "training", amount: "6" }] } });
    expect(mixed?.mode).toBe("MIXED");
    expect(normalizeMcpAccount({})?.mode).toBe("UNKNOWN");
    expect(normalizeMcpAccount(null)).toBeNull();
  });

  it("shadow constants and untested runner behaviors", async () => {
    expect(DEFAULT_INTERVAL_MS).toBe(60_000);
    expect(DEFAULT_JITTER_MS).toBe(5_000);
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    expect(DEFAULT_OFFICE_URL).toBe("https://tracecom.consecom.com.br/api/iq/office");

    const file = tempFilePath();
    const persistOff = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter: fakeAdapter(),
      fetchImpl: async () => officeResponse(),
      now: () => NOW,
      persistPath: file,
      persist: false,
    });
    const offResult = await persistOff.runOnce();
    expect(offResult.ok).toBe(true);
    expect(offResult.persisted).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(persistOff.getShadowStatus().persistence.writes).toBe(0);

    const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const runner = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter: fakeAdapter(),
      fetchImpl: async () => officeResponse(),
      now: () => NOW,
      random: () => 0.5,
      persist: false,
      setTimer: (fn: () => void, ms: number) => {
        const entry = { fn, ms, cleared: false };
        timers.push(entry);
        return entry;
      },
      clearTimer: (entry: { cleared: boolean }) => {
        entry.cleared = true;
      },
    });
    expect(runner.start({ immediate: true })).toMatchObject({ ok: true, alreadyRunning: false });
    await vi.waitFor(() => expect(runner.getShadowStatus().runs).toBe(1));
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(timers[0]?.ms).toBe(62_500);
    runner.stop();
    expect(timers[0]?.cleared).toBe(true);
  });

  it("shadow office fetch timeout is OFFICE_TIMEOUT and never touches the adapter", async () => {
    let adapterCalls = 0;
    const adapter = {
      health: () => "UNAVAILABLE",
      listAssets: async () => {
        adapterCalls += 1;
        return { ok: true, data: ASSETS, health: "CONNECTED" };
      },
      getAccountState: async () => {
        adapterCalls += 1;
        return { ok: true, data: TOOL_PAYLOADS.list_balances, health: "CONNECTED" };
      },
    };
    const runner = new IQMCPShadowRunner({
      env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
      adapter,
      fetchImpl: neverResolves(),
      now: () => NOW,
      timeoutMs: 15,
      persist: false,
    });
    const res = await runner.runOnce();
    expect(res.ok).toBe(false);
    expect(res.code).toBe("OFFICE_TIMEOUT");
    expect(adapterCalls).toBe(0);
  });

  it("shadow office malformed bodies map to OFFICE_MALFORMED", async () => {
    for (const body of ["<html>maintenance</html>", "null"]) {
      const runner = new IQMCPShadowRunner({
        env: { IQ_MCP_ENABLED: "true", IQ_MCP_SHADOW: "true" },
        adapter: fakeAdapter(),
        fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        now: () => NOW,
        persist: false,
      });
      const res = await runner.runOnce();
      expect(res.ok, body).toBe(false);
      expect(res.code, body).toBe("OFFICE_MALFORMED");
    }
  });

  it("constructor resolves the token from IQ_MCP_TOKEN_FILE and fails closed when absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iq-mcp-critic-"));
    tempDirs.push(dir);
    const tokenFile = join(dir, "token.txt");
    writeFileSync(tokenFile, `  ${TOKEN}\n`, "utf8");

    const transport = mockTransport();
    const fromFile = new IQOfficialMCPAdapter({
      product: "binary",
      env: { IQ_MCP_ENABLED: "1", IQ_MCP_TOKEN_FILE: tokenFile },
      fetchImpl: transport.fetchImpl,
    });
    expect(fromFile.secret).toBe(TOKEN);
    expect((await fromFile.discoverCapabilities()).ok).toBe(true);

    let calls = 0;
    const missing = new IQOfficialMCPAdapter({
      product: "binary",
      env: { IQ_MCP_ENABLED: "1", IQ_MCP_TOKEN_FILE: join(dir, "missing.txt") },
      fetchImpl: async () => {
        calls += 1;
        return officeResponse();
      },
    });
    const res = await missing.listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_NO_TOKEN");
    expect(res.health).toBe(HEALTH.AUTH_ERROR);
    expect(calls).toBe(0);
  });

  it("projection edge cases: list projections, missing balance and non-JSON tool text", async () => {
    const transport = mockTransport({
      onTool: (name, req) => {
        if (name === "list_balances") return jsonResponse(rpcMessage(req.id, { balances: [{ balance_id: 1, type: "regular", currency: "USD", amount: 0 }] }));
        if (name === "get_capabilities") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "not-json-payload" }] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return null;
      },
    });
    const adapter = newAdapter(transport.fetchImpl);

    const statuses = await adapter.getMarketStatus();
    expect(statuses.data).toHaveLength(2);
    expect(statuses.data[0]).toMatchObject({ assetId: 76, status: "OPEN", payout: 89 });

    const payouts = await adapter.getPayout();
    expect(payouts.data).toEqual([
      { assetId: 76, payout: 89 },
      { assetId: 81, payout: 86 },
    ]);

    const noBalance = await adapter.getPositions();
    expect(noBalance.ok).toBe(false);
    expect(noBalance.error.code).toBe("MCP_NO_PRACTICE_BALANCE");

    const text = await adapter.discoverCapabilities();
    expect(text.ok).toBe(true);
    expect(text.data).toEqual({ text: "not-json-payload" });
  });
});
