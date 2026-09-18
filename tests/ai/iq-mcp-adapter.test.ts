/** IQ Official MCP adapter — mocked-fetch contract tests (no network, zero orders). */
import { describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { HEALTH, IQOfficialMCPAdapter, READ_TOOLS, WRITE_TOOLS } from "../../relay/iq-mcp/adapter.mjs";

const TOKEN = "test-token-not-real-do-not-use";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<Response>;
type RpcRequest = { method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } };
type Recorded = { method?: string; id?: number; name?: string; args?: Record<string, unknown>; session: string | null; authorization: string | null };

const ASSETS = [
  { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 89, precision: 6, expirations: [1789695000, 1789695900, 1789696800, 1789697700, 1789698600] },
  { asset_id: 77, name: "EUR/GBP (OTC)", is_open: false, profit_percent: 87, precision: 6, expirations: [] },
];

const TOOL_PAYLOADS: Record<string, unknown> = {
  get_capabilities: { mode: "read-write", product: "binary-options" },
  get_limits: {
    buckets: [
      { bucket: "gateway", limit: 200, window_seconds: 60 },
      { bucket: "read", limit: 60, window_seconds: 60 },
      { bucket: "write", limit: 10, window_seconds: 60 },
    ],
    scope: "per-user",
    tools: { list_assets: "read", place_trade: "write" },
  },
  list_assets: { assets: ASSETS },
  list_balances: {
    balances: [
      { balance_id: 1, type: "regular", currency: "BRL", amount: 0, bonus_amount: 0 },
      { balance_id: 2, type: "training", currency: "USD", amount: 60, bonus_amount: 0 },
    ],
  },
  list_positions: { positions: [{ position_id: 501, asset_id: 76, balance_id: 2 }] },
  get_trade_history: { trades: [{ position_id: 900, asset_id: 76, win: "win", amount: 1 }] },
  get_candles: { candles: [[1789695000, 1.1, 1.2, 1.0, 1.15]] },
};

function rpcMessage(id: number | undefined, payload: unknown) {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

function mockTransport(handlers: { onTool?: (name: string, req: RpcRequest) => Response | Promise<Response> | null } = {}) {
  const requests: Recorded[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body ?? "{}") as RpcRequest;
    const headers = init.headers ?? {};
    requests.push({
      method: req.method,
      id: req.id,
      name: req.params?.name,
      args: req.params?.arguments,
      session: headers["mcp-session-id"] ?? null,
      authorization: headers.authorization ?? null,
    });
    if (req.method === "initialize") {
      return jsonResponse(
        { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "qc-mcp-binary-options", version: "1.7.8" } } },
        { "mcp-session-id": "sess-1" },
      );
    }
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (req.method === "tools/call") {
      const name = String(req.params?.name ?? "");
      if (handlers.onTool) {
        const custom = await handlers.onTool(name, req);
        if (custom) return custom;
      }
      return jsonResponse(rpcMessage(req.id, TOOL_PAYLOADS[name] ?? {}));
    }
    return jsonResponse({ jsonrpc: "2.0", id: req.id, result: {} });
  };
  return { fetchImpl, requests };
}

function newAdapter(fetchImpl: FetchLike, options: Record<string, unknown> = {}) {
  return new IQOfficialMCPAdapter({ product: "binary", enabled: true, token: TOKEN, fetchImpl, retryBaseMs: 1, maxRetries: 0, ...options });
}

async function flush(ms = 1) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("IQ MCP adapter — transport", () => {
  it("does initialize → notifications/initialized → tools/call and reuses mcp-session-id", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    expect(adapter.health()).toBe(HEALTH.UNAVAILABLE);
    const caps = await adapter.discoverCapabilities();

    expect(caps.ok).toBe(true);
    expect(caps.data).toEqual({ mode: "read-write", product: "binary-options" });
    expect(requests.map((r) => r.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests[0]?.session).toBeNull();
    expect(requests[2]?.session).toBe("sess-1");
    expect(adapter.health()).toBe(HEALTH.CONNECTED);

    const limits = await adapter.getLimits();
    expect(limits.ok).toBe(true);
    expect(requests.filter((r) => r.method === "initialize")).toHaveLength(1);
    expect(requests.filter((r) => r.method === "tools/call").at(-1)?.session).toBe("sess-1");
  });

  it("parses text/event-stream responses (initialize and tools/call)", async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      const req = JSON.parse(init.body ?? "{}") as RpcRequest;
      if (req.method === "initialize") {
        const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } })}\n\n`;
        return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "sse-session" } });
      }
      if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
      const frame = `event: message\ndata: ${JSON.stringify(rpcMessage(req.id, { mode: "read-only", product: "binary-options" }))}\n\n`;
      return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const res = await newAdapter(fetchImpl).discoverCapabilities();
    expect(res.ok).toBe(true);
    expect(res.data.mode).toBe("read-only");
  });

  it("times out as MCP_TIMEOUT and stays fail-soft", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = (_url, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    };
    const adapter = newAdapter(fetchImpl, { timeoutMs: 20, maxRetries: 0 });

    const res = await adapter.getLimits();
    expect(attempts).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_TIMEOUT");
    expect(res.health).toBe(HEALTH.DEGRADED);
    expect(adapter.health()).toBe(HEALTH.DEGRADED);
  });

  it("retries 5xx with backoff and succeeds", async () => {
    let toolAttempts = 0;
    const { fetchImpl, requests } = mockTransport({
      onTool: (name) => {
        if (name !== "get_limits") return null;
        toolAttempts += 1;
        return toolAttempts < 3 ? new Response("server error", { status: 503 }) : null;
      },
    });
    const adapter = newAdapter(fetchImpl, { maxRetries: 3, retryBaseMs: 1 });

    const res = await adapter.getLimits();
    expect(res.ok).toBe(true);
    expect(toolAttempts).toBe(3);
    expect(requests.filter((r) => r.method === "tools/call")).toHaveLength(3);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });

  it("gives up after max retries when every attempt is 5xx", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("boom", { status: 502 });
    };
    const res = await newAdapter(fetchImpl, { maxRetries: 3, retryBaseMs: 1 }).listAssets();
    expect(calls).toBe(4);
    expect(res.ok).toBe(false);
    expect(res.health).toBe(HEALTH.UNAVAILABLE);
  });

  it("maps 401 to AUTH_ERROR without a retry loop", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } });
    };
    const adapter = newAdapter(fetchImpl, { maxRetries: 3, retryBaseMs: 1 });

    const res = await adapter.listAssets();
    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_AUTH");
    expect(res.health).toBe(HEALTH.AUTH_ERROR);
    expect(adapter.health()).toBe(HEALTH.AUTH_ERROR);
  });

  it("maps 429 to RATE_LIMITED without retrying", async () => {
    let toolCalls = 0;
    const { fetchImpl } = mockTransport({
      onTool: (name) => {
        if (name !== "get_limits") return null;
        toolCalls += 1;
        return new Response("slow down", { status: 429, headers: { "retry-after": "60" } });
      },
    });
    const adapter = newAdapter(fetchImpl, { maxRetries: 3, retryBaseMs: 1 });

    const res = await adapter.getLimits();
    expect(toolCalls).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_RATE_LIMITED");
    expect(adapter.health()).toBe(HEALTH.RATE_LIMITED);
  });

  it("enforces the local read bucket without a second fetch", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl, { rateLimits: { read: { limit: 1, windowMs: 60_000 } }, maxRateWaitMs: 10 });

    const first = await adapter.listAssets();
    expect(first.ok).toBe(true);
    const second = await adapter.getLimits();
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("MCP_RATE_LIMITED");
    expect(requests.filter((r) => r.method === "tools/call")).toHaveLength(1);
    expect(adapter.health()).toBe(HEALTH.RATE_LIMITED);
  });
});

describe("IQ MCP adapter — malformed payloads", () => {
  it("rejects a non-JSON body as MCP_MALFORMED (DEGRADED)", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (name) => (name === "list_assets" ? new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }) : null),
    });
    const res = await newAdapter(fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
    expect(res.health).toBe(HEALTH.DEGRADED);
  });

  it("surfaces JSON-RPC errors redacted", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (_name, req) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `invalid params for ${TOKEN}` } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const res = await newAdapter(fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_RPC_ERROR");
    expect(res.error.message).toContain("<REDACTED>");
    expect(res.error.message).not.toContain(TOKEN);
    expect(res.health).toBe(HEALTH.DEGRADED);
  });
});

describe("IQ MCP adapter — cache & dedup", () => {
  it("serves the second listAssets from cache (no second fetch)", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    const first = await adapter.listAssets();
    const second = await adapter.listAssets();
    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(requests.filter((r) => r.method === "tools/call")).toHaveLength(1);
  });

  it("coalesces concurrent identical calls into one in-flight request", async () => {
    let toolCalls = 0;
    const gate: { resolve?: () => void } = {};
    let capturedId: number | undefined;
    const { fetchImpl } = mockTransport({
      onTool: (_name, req) => {
        toolCalls += 1;
        capturedId = req.id;
        return new Promise<Response>((resolve) => {
          gate.resolve = () => resolve(jsonResponse(rpcMessage(capturedId, TOOL_PAYLOADS.list_assets)));
        });
      },
    });
    const adapter = newAdapter(fetchImpl);

    const p1 = adapter.invokeTool("list_assets");
    const p2 = adapter.invokeTool("list_assets");
    await flush(5);
    expect(toolCalls).toBe(1);
    gate.resolve?.();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1.ok).toBe(true);
    expect(toolCalls).toBe(1);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });
});

describe("IQ MCP adapter — security gates", () => {
  it("throws MCP_WRITE_BLOCKED for every write tool, even with IQ_MCP_WRITE_ENABLED", () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl, { writeEnabled: true });

    for (const tool of WRITE_TOOLS) {
      expect(() => adapter.invokeTool(tool, {})).toThrow(/MCP_WRITE_BLOCKED/);
    }
    expect(() => adapter.invokeTool("mystery_tool", {})).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => adapter.invokeTool("get_prices", {})).toThrow(/MCP_TOOL_NOT_ALLOWLISTED/);
    expect(requests).toHaveLength(0);
  });

  it("keeps the public read surface limited to the verified binary/turbo tools", () => {
    const { fetchImpl } = mockTransport();
    const adapter = newAdapter(fetchImpl);
    for (const method of [
      "discoverCapabilities",
      "listAssets",
      "getMarketStatus",
      "getPayout",
      "getExpirations",
      "getCandles",
      "getAccountState",
      "getPositions",
      "getSettlement",
      "getLimits",
      "health",
    ]) {
      expect(typeof adapter[method]).toBe("function");
    }
    expect(READ_TOOLS).toEqual(["get_capabilities", "get_limits", "list_assets", "list_balances", "list_positions", "get_trade_history", "get_candles"]);
  });
});

describe("IQ MCP adapter — config & fail-soft", () => {
  it("is inert when IQ_MCP_ENABLED is not set (default false)", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = new IQOfficialMCPAdapter({ env: {}, fetchImpl });

    expect(adapter.enabled).toBe(false);
    const res = await adapter.listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_DISABLED");
    expect(res.health).toBe(HEALTH.UNAVAILABLE);
    expect(adapter.health()).toBe(HEALTH.UNAVAILABLE);
    expect(requests).toHaveLength(0);
  });

  it("reads enable/timeout/token from env and fails closed without a token", async () => {
    const transport = mockTransport();
    const enabled = new IQOfficialMCPAdapter({ env: { IQ_MCP_ENABLED: "1", IQ_MCP_TOKEN: TOKEN }, fetchImpl: transport.fetchImpl, retryBaseMs: 1, maxRetries: 0 });
    expect(enabled.enabled).toBe(true);
    expect((await enabled.discoverCapabilities()).ok).toBe(true);

    const tokenless = new IQOfficialMCPAdapter({ env: { IQ_MCP_ENABLED: "true" }, fetchImpl: transport.fetchImpl });
    const res = await tokenless.listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_NO_TOKEN");
    expect(res.health).toBe(HEALTH.AUTH_ERROR);
  });

  it("rejects products that are not binary/turbo", () => {
    expect(() => new IQOfficialMCPAdapter({ product: "digital" })).toThrow(/MCP_PRODUCT_NOT_SUPPORTED/);
    expect(() => new IQOfficialMCPAdapter({ product: "marginal-cfd" })).toThrow(/MCP_PRODUCT_NOT_SUPPORTED/);
    const turbo = new IQOfficialMCPAdapter({ product: "turbo", env: {} });
    expect(turbo.baseUrl).toContain("turbo-options.mcp.iqoption.com");
  });
});

describe("IQ MCP adapter — read projections", () => {
  it("projects market status, payout and expirations from list_assets", async () => {
    const { fetchImpl } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    const status = await adapter.getMarketStatus(76);
    expect(status.ok).toBe(true);
    expect(status.data).toMatchObject({ assetId: 76, status: "OPEN", payout: 89 });
    expect(status.data.expirations).toHaveLength(5);

    const closed = await adapter.getMarketStatus(77);
    expect(closed.data.status).toBe("DISABLED");

    const missing = await adapter.getMarketStatus(999);
    expect(missing.ok).toBe(true);
    expect(missing.data).toEqual({ assetId: 999, status: "NOT_OFFERED" });

    const payout = await adapter.getPayout(76);
    expect(payout.ok).toBe(true);
    expect(payout.data).toBe(89);
    const noPayout = await adapter.getPayout(999);
    expect(noPayout.ok).toBe(false);
    expect(noPayout.error.code).toBe("MCP_ASSET_NOT_FOUND");

    const expirations = await adapter.getExpirations(76);
    expect(expirations.ok).toBe(true);
    expect(expirations.data).toHaveLength(5);
    expect((await adapter.getExpirations()).error.code).toBe("MCP_INVALID_ARGS");
  });

  it("forwards candles args and never caches candles", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    await adapter.getCandles(76, 60, 100);
    await adapter.getCandles(76, 60, 100);
    const calls = requests.filter((r) => r.method === "tools/call");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual({ asset_id: 76, size: 60, count: 100 });
    expect((await adapter.getCandles()).error.code).toBe("MCP_INVALID_ARGS");
  });

  it("maps balances to account mode and defaults positions to the training balance", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    const account = await adapter.getAccountState();
    expect(account.ok).toBe(true);
    expect(account.data.mode).toBe("MIXED");
    expect(account.data.practiceOnly).toBe(true);
    expect(account.data.balances).toHaveLength(2);

    const positions = await adapter.getPositions();
    expect(positions.ok).toBe(true);
    expect(positions.data).toHaveLength(1);
    const positionCall = requests.find((r) => r.name === "list_positions");
    expect(positionCall?.args).toEqual({ balance_id: 2 });
  });

  it("clamps settlement limit and reads it from get_trade_history", async () => {
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    const res = await adapter.getSettlement(9999);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(requests.find((r) => r.name === "get_trade_history")?.args).toEqual({ limit: 500 });

    await adapter.getSettlement();
    expect(requests.findLast((r) => r.name === "get_trade_history")?.args).toEqual({ limit: 50 });
  });
});
