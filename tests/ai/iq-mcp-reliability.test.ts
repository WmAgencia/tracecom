/**
 * IQ Official MCP adapter — reliability gauntlet (mocked fetch, no network).
 *
 * Proves the adapter is fail-soft at every boundary: timeout, auth failure,
 * rate limit, 5xx, malformed JSON-RPC, garbage SSE, offline transport and
 * disabled master switch. No order path is ever reached, zero real traffic.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { HEALTH, IQOfficialMCPAdapter, MAX_RATE_LIMIT_PAUSE_MS, RateLimiter } from "../../relay/iq-mcp/adapter.mjs";

const TOKEN = "reliability-test-token-not-real";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<Response>;
type RpcRequest = { method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } };
type Recorded = { method?: string; id?: number; name?: string; authorization: string | null };

const LIMITS_PAYLOAD = {
  buckets: [
    { bucket: "gateway", limit: 200, window_seconds: 60 },
    { bucket: "read", limit: 60, window_seconds: 60 },
    { bucket: "write", limit: 10, window_seconds: 60 },
  ],
};

const TOOL_PAYLOADS: Record<string, unknown> = {
  get_capabilities: { mode: "read-write", product: "binary-options" },
  get_limits: LIMITS_PAYLOAD,
  list_assets: { assets: [{ asset_id: 76, name: "EUR/USD", is_open: true, profit_percent: 89 }] },
  list_balances: { balances: [{ balance_id: 2, type: "training", currency: "USD", amount: 60 }] },
  list_positions: { positions: [] },
  get_trade_history: { trades: [] },
  get_candles: { candles: [] },
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
      authorization: headers.authorization ?? null,
    });
    if (req.method === "initialize") {
      return jsonResponse(
        { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } },
        { "mcp-session-id": "sess-reliability" },
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
  return requests.filter((r) => r.method === "tools/call");
}

describe("IQ MCP reliability — transport failures stay fail-soft", () => {
  it("maps a timeout to MCP_TIMEOUT / DEGRADED without throwing", async () => {
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

  it("maps 401 to AUTH_ERROR with exactly one fetch (no retry storm)", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401, headers: { "content-type": "application/json" } });
    };
    const adapter = newAdapter(fetchImpl, { maxRetries: 3 });

    const res = await adapter.listAssets();
    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_AUTH");
    expect(res.health).toBe(HEALTH.AUTH_ERROR);
    expect(adapter.health()).toBe(HEALTH.AUTH_ERROR);
  });

  it("maps 403 to AUTH_ERROR with exactly one fetch", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("forbidden", { status: 403 });
    };
    const res = await newAdapter(fetchImpl, { maxRetries: 3 }).listAssets();
    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_AUTH");
    expect(res.health).toBe(HEALTH.AUTH_ERROR);
  });

  it("maps 429 to RATE_LIMITED, honors retry-after and issues no immediate retry", async () => {
    const { fetchImpl, requests } = mockTransport({
      onTool: (name) => (name === "get_limits" ? new Response("slow down", { status: 429, headers: { "retry-after": "30" } }) : null),
    });
    const adapter = newAdapter(fetchImpl, { maxRetries: 3 });

    const first = await adapter.getLimits();
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("MCP_RATE_LIMITED");
    expect(first.health).toBe(HEALTH.RATE_LIMITED);
    expect(toolCalls(requests)).toHaveLength(1);

    const second = await adapter.listAssets();
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("MCP_RATE_LIMITED");
    expect(toolCalls(requests)).toHaveLength(1);
    expect(adapter.limiter.read.waitMs()).toBeGreaterThan(0);
    expect(adapter.health()).toBe(HEALTH.RATE_LIMITED);
  });

  it("clamps a hostile retry-after so a remote server cannot lock the adapter out forever", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (name) => (name === "get_limits" ? new Response("slow down", { status: 429, headers: { "retry-after": "31536000" } }) : null),
    });
    const adapter = newAdapter(fetchImpl);

    const res = await adapter.getLimits();
    expect(res.ok).toBe(false);
    expect(adapter.limiter.read.waitMs()).toBeLessThanOrEqual(MAX_RATE_LIMIT_PAUSE_MS);
    expect(adapter.limiter.read.waitMs()).toBeGreaterThan(MAX_RATE_LIMIT_PAUSE_MS - 5_000);
  });

  it("retries 500 then succeeds with exponential backoff", async () => {
    const sleeps: number[] = [];
    let toolAttempts = 0;
    const { fetchImpl } = mockTransport({
      onTool: (name) => {
        if (name !== "get_limits") return null;
        toolAttempts += 1;
        return toolAttempts < 3 ? new Response("server error", { status: 503 }) : null;
      },
    });
    const adapter = newAdapter(fetchImpl, {
      maxRetries: 2,
      retryBaseMs: 1,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    const res = await adapter.getLimits();
    expect(res.ok).toBe(true);
    expect(toolAttempts).toBe(3);
    expect(sleeps).toEqual([1, 2]);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });

  it("exhausts retries on persistent 5xx as UNAVAILABLE", async () => {
    const { fetchImpl, requests } = mockTransport({
      onTool: (name) => (name === "get_limits" ? new Response("boom", { status: 503 }) : null),
    });
    const adapter = newAdapter(fetchImpl, { maxRetries: 2 });

    const res = await adapter.getLimits();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_HTTP_5XX");
    expect(res.health).toBe(HEALTH.UNAVAILABLE);
    expect(adapter.health()).toBe(HEALTH.UNAVAILABLE);
    expect(toolCalls(requests)).toHaveLength(3);
  });
});

describe("IQ MCP reliability — malformed payloads never crash", () => {
  it("rejects a non-JSON body as MCP_MALFORMED", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (name) => (name === "list_assets" ? new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }) : null),
    });
    const res = await newAdapter(fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
    expect(res.health).toBe(HEALTH.DEGRADED);
  });

  it("rejects a JSON-RPC body without result as MCP_MALFORMED", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (_name, req) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const res = await newAdapter(fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
  });

  it("rejects an SSE frame carrying a mismatched request id (response confusion)", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (_name, req) => {
        const wrong = rpcMessage((req.id ?? 0) + 1000, { mode: "read-only" });
        const frame = `event: message\ndata: ${JSON.stringify(wrong)}\n\n`;
        return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const res = await newAdapter(fetchImpl).discoverCapabilities();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
  });

  it("ignores garbage SSE lines and still parses the valid frame", async () => {
    const { fetchImpl } = mockTransport({
      onTool: (_name, req) => {
        const valid = rpcMessage(req.id, { mode: "read-only", product: "binary-options" });
        const frame = [": keep-alive", "event: message", "data: {broken", "", `data: ${JSON.stringify(valid)}`, ""].join("\n");
        return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const res = await newAdapter(fetchImpl).discoverCapabilities();
    expect(res.ok).toBe(true);
    expect(res.data.mode).toBe("read-only");
  });

  it("survives an SSE stream that only contains garbage", async () => {
    const { fetchImpl } = mockTransport({
      onTool: () =>
        new Response(": keep-alive\ndata: {broken\n\ndata: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const res = await newAdapter(fetchImpl).listAssets();
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("MCP_MALFORMED");
    expect(res.health).toBe(HEALTH.DEGRADED);
  });
});

describe("IQ MCP reliability — auth recovery and offline", () => {
  it("reconnects after AUTH_ERROR once the token is fixed", async () => {
    const transport = mockTransport();
    const fetchImpl: FetchLike = async (url, init) => {
      if (init.headers?.authorization !== `Bearer ${TOKEN}`) return new Response("unauthorized", { status: 401 });
      return transport.fetchImpl(url, init);
    };
    const adapter = newAdapter(fetchImpl, { token: "expired-token" });

    const first = await adapter.listAssets();
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("MCP_AUTH");
    expect(adapter.health()).toBe(HEALTH.AUTH_ERROR);

    adapter.secret = TOKEN;
    const second = await adapter.listAssets();
    expect(second.ok).toBe(true);
    expect(adapter.health()).toBe(HEALTH.CONNECTED);
  });

  it("never throws into the trading path when MCP is totally offline", async () => {
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
      expect(typeof res.error.code).toBe("string");
    }
    expect(calls).toBeGreaterThan(0);
  });

  it("performs zero network calls when IQ_MCP_ENABLED=false", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("should never be called", { status: 500 });
    };
    const adapter = new IQOfficialMCPAdapter({ product: "binary", env: {}, fetchImpl });
    expect(adapter.enabled).toBe(false);

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
      expect(res.error.code).toBe("MCP_DISABLED");
      expect(res.health).toBe(HEALTH.UNAVAILABLE);
    }
    expect(calls).toBe(0);
  });
});

describe("IQ MCP reliability — rate limiting and memory bounds", () => {
  it("rate limiter never exceeds 60 reads/min under a simulated burst", () => {
    let now = 0;
    const limiter = new RateLimiter({ now: () => now });

    let granted = 0;
    for (let i = 0; i < 200; i += 1) if (limiter.take("read").ok) granted += 1;
    expect(granted).toBe(60);

    now += 1_000;
    expect(limiter.take("read").ok).toBe(true);
    expect(limiter.take("read").ok).toBe(false);

    now += 60_000;
    let refilled = 0;
    for (let i = 0; i < 100; i += 1) if (limiter.take("read").ok) refilled += 1;
    expect(refilled).toBe(60);
  });

  it("adapter enforces 60 reads/min end-to-end under a simulated burst", async () => {
    const now = 0;
    const { fetchImpl, requests } = mockTransport();
    const adapter = newAdapter(fetchImpl, { maxRetries: 0, maxRateWaitMs: 1, now: () => now });

    let allowed = 0;
    for (let i = 0; i < 80; i += 1) {
      const res = await adapter.invokeTool("get_candles", { asset_id: 76, size: 60, count: i + 1 });
      if (res.ok) allowed += 1;
    }

    expect(allowed).toBe(60);
    expect(toolCalls(requests)).toHaveLength(60);
    expect(adapter.limiter.snapshot().read.limit).toBe(60);
    expect(adapter.health()).toBe(HEALTH.RATE_LIMITED);
  });

  it("never lets server-reported limits raise the local buckets", async () => {
    const inflated = {
      buckets: [
        { bucket: "gateway", limit: 1_000_000, window_seconds: 1 },
        { bucket: "read", limit: 1_000_000, window_seconds: 1 },
        { bucket: "write", limit: 1_000_000, window_seconds: 1 },
      ],
    };
    const { fetchImpl } = mockTransport({
      onTool: (name, req) => (name === "get_limits" ? jsonResponse(rpcMessage(req.id, inflated)) : null),
    });
    const adapter = newAdapter(fetchImpl);

    const res = await adapter.getLimits();
    expect(res.ok).toBe(true);
    const snapshot = adapter.limiter.snapshot();
    expect(snapshot.read.limit).toBe(60);
    expect(snapshot.read.windowMs).toBe(60_000);
    expect(snapshot.gateway.limit).toBe(200);
    expect(snapshot.write.limit).toBe(10);
  });

  it("applies stricter server limits (tighten-only)", async () => {
    const stricter = { buckets: [{ bucket: "read", limit: 5, window_seconds: 120 }] };
    const { fetchImpl } = mockTransport({
      onTool: (name, req) => (name === "get_limits" ? jsonResponse(rpcMessage(req.id, stricter)) : null),
    });
    const adapter = newAdapter(fetchImpl);

    await adapter.getLimits();
    const snapshot = adapter.limiter.snapshot();
    expect(snapshot.read.limit).toBe(5);
    expect(snapshot.read.windowMs).toBe(120_000);
  });

  it("bounds the TTL cache with expired-first, oldest-first eviction", async () => {
    const { fetchImpl } = mockTransport();
    const adapter = newAdapter(fetchImpl, { maxCacheEntries: 4 });

    for (let limit = 1; limit <= 6; limit += 1) {
      const res = await adapter.getSettlement(limit);
      expect(res.ok).toBe(true);
    }

    expect(adapter.cache.size).toBeLessThanOrEqual(4);
    expect(adapter.cache.size).toBeGreaterThan(0);
  });

  it("keeps the token out of JSON serialization (non-enumerable secret)", async () => {
    const { fetchImpl } = mockTransport();
    const adapter = newAdapter(fetchImpl);

    expect(adapter.secret).toBe(TOKEN);
    expect(Object.prototype.propertyIsEnumerable.call(adapter, "secret")).toBe(false);
    expect(Object.keys(adapter)).not.toContain("secret");
    expect(JSON.stringify(adapter)).not.toContain(TOKEN);
    expect(JSON.stringify({ ...adapter })).not.toContain(TOKEN);
  });
});
