/**
 * IQ Official MCP — adapter (Fase 5).
 *
 * Binary + Turbo ONLY (tools verified in docs/iq-mcp/discovery.md and
 * docs/iq-mcp/binary-turbo-probe.md). Read-only by construction: every
 * tools/call passes through the hard gates in `security.mjs`; write-classified
 * tools always throw MCP_WRITE_BLOCKED, even if a caller asks for them.
 *
 * Fail-soft: transport failures never throw into the caller's hot path — every
 * public method resolves to { ok:false, health, error }. The incumbent
 * WS/catalog path remains the executor and fallback.
 *
 * Shadow-first: IQ_MCP_ENABLED defaults to false. No timers, no intervals, no
 * polling per tick — calls happen only on demand, with a token-bucket limiter
 * (gateway 200/60s, read 60/60s, write 10/60s), TTL cache and in-flight
 * request coalescing. Timeout is 15–20s (default 20000ms).
 */

import { readFileSync } from "node:fs";
import { RISK, assertReadProbeMethod, classifyTool, redact as redactSecret } from "./security.mjs";

export const PROTOCOL_VERSION = "2024-11-05";
export const CLIENT_NAME = "tracecom-iq-mcp-adapter";
export const CLIENT_VERSION = "0.1.0";

export const HEALTH = Object.freeze({
  CONNECTED: "CONNECTED",
  DEGRADED: "DEGRADED",
  RATE_LIMITED: "RATE_LIMITED",
  AUTH_ERROR: "AUTH_ERROR",
  UNAVAILABLE: "UNAVAILABLE",
});

export const IQ_MCP_PRODUCTS = Object.freeze({
  binary: "https://binary-options.mcp.iqoption.com",
  turbo: "https://turbo-options.mcp.iqoption.com",
});

export const READ_TOOLS = Object.freeze([
  "get_capabilities",
  "get_limits",
  "list_assets",
  "list_balances",
  "list_positions",
  "get_trade_history",
  "get_candles",
]);

export const WRITE_TOOLS = Object.freeze(["place_trade", "sell_position", "rollover_position"]);

const DEFAULT_TTL_MS = Object.freeze({
  capabilities: 300_000,
  assets: 30_000,
  balances: 15_000,
  positions: 10_000,
  settlement: 30_000,
  limits: 60_000,
  candles: 0,
});

const DEFAULT_LIMITS = Object.freeze({
  gateway: Object.freeze({ limit: 200, windowMs: 60_000 }),
  read: Object.freeze({ limit: 60, windowMs: 60_000 }),
  write: Object.freeze({ limit: 10, windowMs: 60_000 }),
});

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_MAX_RATE_WAIT_MS = 2_500;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

/** Remote `Retry-After` can never lock the adapter out for longer than this. */
export const MAX_RATE_LIMIT_PAUSE_MS = 15 * 60_000;

/** Hard ceiling for the TTL cache; prevents remote/arg-driven memory growth. */
export const MAX_CACHE_ENTRIES = 256;

function envBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function parseSseEvents(text) {
  const events = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* non-JSON SSE frame is ignored */
    }
  }
  return events;
}

function interpretRpcMessage(message) {
  if (!message || typeof message !== "object") {
    return { ok: false, code: "MCP_MALFORMED", message: "malformed JSON-RPC message" };
  }
  if (message.error) {
    const detail = typeof message.error?.message === "string" ? message.error.message : JSON.stringify(message.error);
    return { ok: false, code: "MCP_RPC_ERROR", rpcCode: message.error?.code ?? null, message: detail };
  }
  if (message.result === undefined) {
    return { ok: false, code: "MCP_MALFORMED", message: "JSON-RPC message without result" };
  }
  return { ok: true, result: message.result };
}

function parseRpcBody(text, contentType, id) {
  if (String(contentType).includes("text/event-stream")) {
    const events = parseSseEvents(text);
    if (!events.length) return { ok: false, code: "MCP_MALFORMED", message: "empty SSE stream" };
    const match =
      events.find((m) => m && m.id !== undefined && String(m.id) === String(id)) ??
      events.find((m) => m && m.id === undefined && (m.result !== undefined || m.error !== undefined));
    if (!match) return { ok: false, code: "MCP_MALFORMED", message: "no JSON-RPC response for this request id" };
    return interpretRpcMessage(match);
  }
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, code: "MCP_EMPTY", message: "empty HTTP body" };
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return { ok: false, code: "MCP_MALFORMED", message: "HTTP body is not valid JSON" };
  }
  if (
    id !== undefined &&
    id !== null &&
    message &&
    typeof message === "object" &&
    message.id !== undefined &&
    String(message.id) !== String(id)
  ) {
    return { ok: false, code: "MCP_MALFORMED", message: "JSON-RPC response id mismatch" };
  }
  return interpretRpcMessage(message);
}

function extractToolPayload(result) {
  if (!result || typeof result !== "object") return result;
  if (Array.isArray(result.content)) {
    const textPart = result.content.find((c) => typeof c?.text === "string");
    if (textPart) {
      const text = textPart.text.trim();
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  return result;
}

/** First text content of an MCP `isError:true` result, bounded and safe to surface. */
function toolErrorMessage(result) {
  const textPart = Array.isArray(result?.content) ? result.content.find((c) => typeof c?.text === "string") : null;
  const detail = textPart ? textPart.text.trim() : "tool reported isError=true";
  const bounded = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
  return bounded || "tool reported isError=true";
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["positions", "trades", "history", "candles", "rows", "items"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

function findAsset(assets, assetId) {
  return (assets ?? []).find((a) => String(a?.asset_id) === String(assetId));
}

function healthFor(code) {
  switch (code) {
    case "MCP_AUTH":
    case "MCP_NO_TOKEN":
      return HEALTH.AUTH_ERROR;
    case "MCP_RATE_LIMITED":
      return HEALTH.RATE_LIMITED;
    case "MCP_NETWORK":
    case "MCP_HTTP_5XX":
    case "MCP_DISABLED":
      return HEALTH.UNAVAILABLE;
    case "MCP_TIMEOUT":
    default:
      return HEALTH.DEGRADED;
  }
}

export class TokenBucket {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.tokens = limit;
    this.updatedAt = now();
    this.pausedUntil = 0;
  }

  _refill() {
    const t = this.now();
    const elapsed = Math.max(0, t - this.updatedAt);
    this.tokens = Math.min(this.limit, this.tokens + (elapsed * this.limit) / this.windowMs);
    this.updatedAt = t;
  }

  _deficitMs(cost) {
    if (this.tokens >= cost) return 0;
    return Math.ceil(((cost - this.tokens) * this.windowMs) / this.limit);
  }

  waitMs(cost = 1) {
    this._refill();
    const deficit = this._deficitMs(cost);
    const paused = Math.max(0, this.pausedUntil - this.now());
    return paused + deficit;
  }

  take(cost = 1) {
    const wait = this.waitMs(cost);
    if (wait > 0) return { ok: false, waitMs: wait };
    this._refill();
    this.tokens -= cost;
    return { ok: true, waitMs: 0 };
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  setCapacity(limit, windowMs) {
    this._refill();
    this.limit = limit;
    this.windowMs = windowMs;
    this.tokens = Math.min(this.tokens, limit);
  }
}

export class RateLimiter {
  constructor({ limits = {}, now = Date.now } = {}) {
    const pick = (name) => ({ limit: limits?.[name]?.limit ?? DEFAULT_LIMITS[name].limit, windowMs: limits?.[name]?.windowMs ?? DEFAULT_LIMITS[name].windowMs });
    this.gateway = new TokenBucket({ ...pick("gateway"), now });
    this.read = new TokenBucket({ ...pick("read"), now });
    this.write = new TokenBucket({ ...pick("write"), now });
  }

  _bucket(kind) {
    if (kind === "read") return this.read;
    if (kind === "write") return this.write;
    return null;
  }

  take(kind = "control", cost = 1) {
    const g = this.gateway.waitMs(cost);
    const specific = this._bucket(kind);
    const s = specific ? specific.waitMs(cost) : 0;
    const waitMs = Math.max(g, s);
    if (waitMs > 0) return { ok: false, waitMs };
    this.gateway.take(cost);
    if (specific) specific.take(cost);
    return { ok: true, waitMs: 0 };
  }

  pause(ms) {
    this.gateway.pause(ms);
    this.read.pause(ms);
    this.write.pause(ms);
  }

  setLimit(name, limit, windowMs) {
    const bucket = this._bucket(name) ?? (name === "gateway" ? this.gateway : null);
    if (bucket) bucket.setCapacity(limit, windowMs);
  }

  snapshot() {
    return {
      gateway: { limit: this.gateway.limit, windowMs: this.gateway.windowMs, tokens: this.gateway.tokens },
      read: { limit: this.read.limit, windowMs: this.read.windowMs, tokens: this.read.tokens },
      write: { limit: this.write.limit, windowMs: this.write.windowMs, tokens: this.write.tokens },
    };
  }
}

export class IQOfficialMCPAdapter {
  constructor(options = {}) {
    const env = options.env ?? process.env;
    const product = String(options.product ?? "binary").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(IQ_MCP_PRODUCTS, product)) {
      throw new Error(`MCP_PRODUCT_NOT_SUPPORTED: ${product} (binary/turbo only)`);
    }

    this.product = product;
    this.baseUrl = options.baseUrl ?? IQ_MCP_PRODUCTS[product];
    this.enabled = options.enabled ?? envBool(env.IQ_MCP_ENABLED, false);
    this.shadow = options.shadow ?? envBool(env.IQ_MCP_SHADOW, true);
    this.writeEnabled = options.writeEnabled ?? envBool(env.IQ_MCP_WRITE_ENABLED, false);
    this.timeoutMs = positiveNumber(options.timeoutMs ?? env.IQ_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.maxRetries = Number.isFinite(Number(options.maxRetries)) ? Math.max(0, Number(options.maxRetries)) : DEFAULT_MAX_RETRIES;
    this.retryBaseMs = positiveNumber(options.retryBaseMs, DEFAULT_RETRY_BASE_MS);
    this.maxRateWaitMs = positiveNumber(options.maxRateWaitMs, DEFAULT_MAX_RATE_WAIT_MS);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.fetchImpl = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

    Object.defineProperty(this, "secret", {
      value: this._resolveToken(options, env),
      writable: true,
      enumerable: false,
      configurable: true,
    });
    this.limiter = new RateLimiter({ limits: options.rateLimits, now: this.now });
    this.ttl = { ...DEFAULT_TTL_MS, ...(options.ttlMs ?? {}) };

    const maxCacheEntries = Number(options.maxCacheEntries);
    this.maxCacheEntries = Number.isFinite(maxCacheEntries) && maxCacheEntries > 0 ? Math.trunc(maxCacheEntries) : MAX_CACHE_ENTRIES;
    this.cache = new Map();
    this.inflight = new Map();
    this.sessionId = null;
    this._initPromise = null;
    this._rpcId = 0;
    this.healthState = HEALTH.UNAVAILABLE;
    this.stats = { requests: 0, calls: 0, cacheHits: 0, retries: 0, rateLimited: 0 };
  }

  _resolveToken(options, env) {
    if (typeof options.token === "string" && options.token.length > 0) return options.token;
    if (typeof env.IQ_MCP_TOKEN === "string" && env.IQ_MCP_TOKEN.length > 0) return env.IQ_MCP_TOKEN;
    const file = options.tokenFile ?? env.IQ_MCP_TOKEN_FILE;
    if (file) {
      try {
        const fromFile = readFileSync(file, "utf8").trim();
        if (fromFile) return fromFile;
      } catch {
        return "";
      }
    }
    return "";
  }

  health() {
    return this.healthState;
  }

  _nextId() {
    this._rpcId += 1;
    return this._rpcId;
  }

  _gate(method, toolName) {
    if (method === "tools/call") {
      const risk = classifyTool({ name: toolName });
      assertReadProbeMethod(method, toolName, risk, READ_TOOLS);
      return risk;
    }
    assertReadProbeMethod(method);
    return null;
  }

  _fail(code, message, health = this.healthState) {
    this.healthState = health;
    return {
      ok: false,
      health,
      error: { code, message: redactSecret(String(message ?? code), this.secret) },
    };
  }

  _transportFail(info) {
    const health = healthFor(info?.code ?? "MCP_INTERNAL");
    return this._fail(info?.code ?? "MCP_INTERNAL", info?.message ?? info?.code ?? "unknown MCP failure", health);
  }

  async _acquire(kind) {
    let ticket = this.limiter.take(kind);
    while (!ticket.ok && ticket.waitMs <= this.maxRateWaitMs) {
      const stepMs = Math.max(1, Math.ceil(ticket.waitMs));
      await this.sleep(stepMs);
      ticket = this.limiter.take(kind);
    }
    if (!ticket.ok) this.stats.rateLimited += 1;
    return ticket;
  }

  async _singleRpc(method, params, opts) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.secret) headers.authorization = `Bearer ${this.secret}`;
    if (this.sessionId && method !== "initialize") headers["mcp-session-id"] = this.sessionId;

    const body = { jsonrpc: "2.0", method };
    if (opts.id !== null && opts.id !== undefined) body.id = opts.id;
    if (params !== undefined) body.params = params;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let res;
    let text;
    try {
      res = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      const code = timedOut ? "MCP_TIMEOUT" : "MCP_NETWORK";
      return { ok: false, code, status: 0, message: timedOut ? `timeout after ${this.timeoutMs}ms` : String(err?.message ?? err), retryable: true };
    }
    clearTimeout(timer);
    this.stats.requests += 1;

    const sessionId = res.headers?.get?.("mcp-session-id");
    const status = res.status;
    if (status === 401 || status === 403) {
      return { ok: false, code: "MCP_AUTH", status, message: `HTTP ${status}`, retryable: false };
    }
    if (status === 429) {
      const retryAfterHeader = Number(res.headers?.get?.("retry-after"));
      const requestedMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : DEFAULT_RATE_LIMIT_PAUSE_MS;
      const pauseMs = Math.min(MAX_RATE_LIMIT_PAUSE_MS, requestedMs);
      this.limiter.pause(pauseMs);
      return { ok: false, code: "MCP_RATE_LIMITED", status, message: `HTTP 429 (retry-after ${pauseMs}ms)`, retryable: false };
    }
    if (status >= 500) {
      return { ok: false, code: "MCP_HTTP_5XX", status, message: `HTTP ${status}`, retryable: true };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, code: "MCP_HTTP_ERROR", status, message: `HTTP ${status}`, retryable: false };
    }
    if (opts.notification) {
      if (sessionId) this.sessionId = sessionId;
      return { ok: true, status, sessionId: this.sessionId, result: null };
    }

    const parsed = parseRpcBody(text, res.headers?.get?.("content-type") ?? "", opts.id);
    if (!parsed.ok) return { ...parsed, status, retryable: false };
    if (sessionId) this.sessionId = sessionId;
    return { ok: true, status, sessionId: this.sessionId, result: parsed.result };
  }

  async _rpc(method, params, opts = {}) {
    this._gate(method, opts.toolName);
    const kind = opts.kind ?? "control";
    const id = opts.notification ? null : this._nextId();
    let last = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        this.stats.retries += 1;
        await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      }
      const ticket = await this._acquire(kind);
      if (!ticket.ok) {
        last = { ok: false, code: "MCP_RATE_LIMITED", status: 0, message: `local rate limit (retry in ${ticket.waitMs}ms)`, retryable: false };
        break;
      }
      const single = await this._singleRpc(method, params, { ...opts, id, kind });
      if (single.ok) {
        this.healthState = HEALTH.CONNECTED;
        return single;
      }
      last = single;
      if (!single.retryable) break;
    }

    this.healthState = healthFor(last?.code ?? "MCP_INTERNAL");
    return last;
  }

  async _ensureSession() {
    if (this.sessionId) return { ok: true };
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const init = await this._rpc(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        },
        { kind: "control" },
      );
      if (!init.ok) return init;
      await this._rpc("notifications/initialized", undefined, { notification: true, kind: "control" });
      return { ok: true };
    })().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  async _callToolRpc(tool, args) {
    const rpc = await this._rpc("tools/call", { name: tool, arguments: args ?? {} }, { kind: "read", toolName: tool });
    if (!rpc.ok) return rpc;
    if (rpc.result?.isError === true) {
      return { ok: false, code: "MCP_TOOL_ERROR", status: rpc.status, message: toolErrorMessage(rpc.result), retryable: false };
    }
    return { ok: true, payload: extractToolPayload(rpc.result) };
  }

  /** Schema do tool (inputSchema) via tools/list — usado para montar args corretos. */
  async toolSchema(toolName) {
    const rpc = await this._rpc("tools/list", {}, { kind: "control" });
    if (!rpc.ok) return null;
    const tools = Array.isArray(rpc.result?.tools) ? rpc.result.tools : [];
    return tools.find((tool) => tool.name === toolName)?.inputSchema ?? null;
  }

  /** EXECUCAO via MCP oficial (place_trade). So quando writeEnabled=true (fail-closed). */
  async placeTrade(args = {}) {
    if (this.writeEnabled !== true) return { ok: false, code: "MCP_WRITE_BLOCKED", message: "IQ_MCP_WRITE_ENABLED=false", health: this.healthState };
    return this._callToolRpc("place_trade", args);
  }

  _cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  _cacheSet(key, value, ttlMs) {
    const now = this.now();
    if (this.cache.size >= this.maxCacheEntries) {
      for (const [k, v] of this.cache) {
        if (now >= v.expiresAt) this.cache.delete(k);
      }
      while (this.cache.size >= this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: now + ttlMs });
  }

  _readTool(tool, args = {}, opts = {}) {
    this._gate("tools/call", tool);

    if (!this.enabled) {
      return Promise.resolve(this._fail("MCP_DISABLED", "IQ_MCP_ENABLED=false — adapter inert", HEALTH.UNAVAILABLE));
    }
    if (!this.secret) {
      return Promise.resolve(this._fail("MCP_NO_TOKEN", "no IQ_MCP_TOKEN / IQ_MCP_TOKEN_FILE configured", HEALTH.AUTH_ERROR));
    }

    const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : 0;
    const key = `${this.product}|${tool}|${stableStringify(args)}`;

    if (ttlMs > 0) {
      const cached = this._cacheGet(key);
      if (cached !== undefined) {
        this.stats.cacheHits += 1;
        return Promise.resolve({ ok: true, health: this.healthState, data: cached, cached: true });
      }
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const task = (async () => {
      const session = await this._ensureSession();
      if (!session.ok) return this._transportFail(session);

      let call = await this._callToolRpc(tool, args);
      if (!call.ok && call.status === 404 && this.sessionId) {
        this.sessionId = null;
        const renewed = await this._ensureSession();
        if (renewed.ok) call = await this._callToolRpc(tool, args);
      }
      if (!call.ok) return this._transportFail(call);

      this.healthState = HEALTH.CONNECTED;
      this.stats.calls += 1;
      if (ttlMs > 0) this._cacheSet(key, call.payload, ttlMs);
      return { ok: true, health: this.healthState, data: call.payload, cached: false };
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, task);
    return task;
  }

  invokeTool(toolName, args = {}) {
    const name = String(toolName ?? "");
    const risk = classifyTool({ name });
    if (this.writeEnabled && (risk === RISK.ORDER_WRITE || risk === RISK.ACCOUNT_WRITE)) {
      throw new Error(`MCP_WRITE_BLOCKED: ${name} — writes are not implemented in this phase (IQ_MCP_WRITE_ENABLED ignored)`);
    }
    assertReadProbeMethod("tools/call", name, risk, READ_TOOLS);
    return this._readTool(name, args, { ttlMs: 0 });
  }

  async discoverCapabilities() {
    return this._readTool("get_capabilities", {}, { ttlMs: this.ttl.capabilities });
  }

  async listAssets() {
    const res = await this._readTool("list_assets", {}, { ttlMs: this.ttl.assets });
    if (!res.ok) return res;
    const assets = Array.isArray(res.data?.assets) ? res.data.assets : Array.isArray(res.data) ? res.data : [];
    return { ...res, data: assets };
  }

  async getMarketStatus(assetId) {
    const res = await this.listAssets();
    if (!res.ok) return res;
    const assets = res.data;
    if (assetId === undefined || assetId === null) {
      return {
        ...res,
        data: assets.map((a) => ({
          assetId: a?.asset_id ?? null,
          name: a?.name ?? null,
          status: a?.is_open === true ? "OPEN" : "CLOSED",
          isOpen: typeof a?.is_open === "boolean" ? a.is_open : null,
          payout: a?.profit_percent ?? null,
          expirations: a?.expirations ?? [],
        })),
      };
    }
    const asset = findAsset(assets, assetId);
    if (!asset) return { ...res, data: { assetId, status: "NOT_OFFERED" } };
    return {
      ...res,
      data: {
        assetId: asset.asset_id,
        name: asset.name ?? null,
        status: asset.is_open === true ? "OPEN" : "CLOSED",
        isOpen: typeof asset.is_open === "boolean" ? asset.is_open : null,
        payout: asset.profit_percent ?? null,
        expirations: asset.expirations ?? [],
      },
    };
  }

  async getPayout(assetId) {
    const res = await this.listAssets();
    if (!res.ok) return res;
    if (assetId === undefined || assetId === null) {
      return { ...res, data: res.data.map((a) => ({ assetId: a?.asset_id ?? null, payout: a?.profit_percent ?? null })) };
    }
    const asset = findAsset(res.data, assetId);
    if (!asset) return this._fail("MCP_ASSET_NOT_FOUND", `asset ${assetId} is not offered by ${this.product}`);
    return { ...res, data: asset.profit_percent ?? null };
  }

  async getExpirations(assetId) {
    if (assetId === undefined || assetId === null) {
      return this._fail("MCP_INVALID_ARGS", "getExpirations requires assetId");
    }
    const res = await this.listAssets();
    if (!res.ok) return res;
    const asset = findAsset(res.data, assetId);
    if (!asset) return this._fail("MCP_ASSET_NOT_FOUND", `asset ${assetId} is not offered by ${this.product}`);
    return { ...res, data: Array.isArray(asset.expirations) ? asset.expirations : [] };
  }

  async getCandles(assetId, size, count) {
    if (assetId === undefined || assetId === null || size === undefined || size === null) {
      return this._fail("MCP_INVALID_ARGS", "getCandles requires assetId and size");
    }
    const args = { asset_id: assetId, size };
    if (count !== undefined && count !== null) args.count = count;
    return this._readTool("get_candles", args, { ttlMs: this.ttl.candles });
  }

  async getAccountState() {
    const res = await this._readTool("list_balances", {}, { ttlMs: this.ttl.balances });
    if (!res.ok) return res;
    const balances = Array.isArray(res.data?.balances) ? res.data.balances : Array.isArray(res.data) ? res.data : [];
    const hasTraining = balances.some((b) => b?.type === "training");
    const hasRegular = balances.some((b) => b?.type === "regular");
    const mode = balances.length === 0 ? "UNKNOWN" : hasTraining && hasRegular ? "MIXED" : hasTraining ? "PRACTICE" : hasRegular ? "REAL" : "UNKNOWN";
    return { ...res, data: { balances, mode, practiceOnly: true } };
  }

  async getPositions(balanceId) {
    let id = balanceId;
    if (id === undefined || id === null) {
      const account = await this.getAccountState();
      if (!account.ok) return account;
      const training = account.data.balances.find((b) => b?.type === "training");
      if (!training) return this._fail("MCP_NO_PRACTICE_BALANCE", "no training balance available — refusing to guess a balance");
      id = training.balance_id;
    }
    const res = await this._readTool("list_positions", { balance_id: id }, { ttlMs: this.ttl.positions });
    if (!res.ok) return res;
    return { ...res, data: rowsFrom(res.data) };
  }

  async getSettlement(limit) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.trunc(parsed))) : 50;
    const res = await this._readTool("get_trade_history", { limit: safeLimit }, { ttlMs: this.ttl.settlement });
    if (!res.ok) return res;
    return { ...res, data: rowsFrom(res.data) };
  }

  async getLimits() {
    const res = await this._readTool("get_limits", {}, { ttlMs: this.ttl.limits });
    if (res.ok) this._applyServerLimits(res.data);
    return res;
  }

  _applyServerLimits(payload) {
    const buckets = payload?.buckets;
    if (!Array.isArray(buckets)) return;
    for (const bucket of buckets) {
      const name = String(bucket?.bucket ?? "").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_LIMITS, name)) continue;
      const safe = DEFAULT_LIMITS[name];
      const limit = Number(bucket?.limit);
      const windowMs = Number(bucket?.window_seconds) * 1000;
      if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) continue;
      this.limiter.setLimit(name, Math.min(limit, safe.limit), Math.max(windowMs, safe.windowMs));
    }
  }
}

export default IQOfficialMCPAdapter;
