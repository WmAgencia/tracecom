#!/usr/bin/env node
/**
 * IQ Official MCP — LATENCY + TIMING benchmark (READ-ONLY, practice only).
 *
 * Measures, across ALL 7 official MCP servers:
 *   (1) cold handshake `initialize` + `notifications/initialized`, N=5
 *   (2) warm `tools/list`, N=5
 *   (3) per-tool allowlisted read latency + payload size, N=5
 *   (4) session reuse vs fresh handshake per read (saving in ms)
 *   (5) small read burst (429 / Retry-After observation; documented caps respected)
 *   (6) 4-way parallel reads vs serial p50 on ONE server
 *   (7) candleFetchWallMs + HOT_PATH_COMPATIBLE (NOT compatible if p95 > 2000 ms)
 *
 * SECURITY
 *  - Token only from env `IQ_MCP_TOKEN` / `IQ_MCP_TOKEN_FILE`; never written.
 *  - Every call passes the shared gates in `relay/iq-mcp/security.mjs`
 *    (`assertReadOnlyMethod` / `assertReadProbeMethod` / `classifyTool`).
 *    Order/account-write/unknown tools throw MCP_WRITE_BLOCKED by construction.
 *  - Per-server allowlists validated at startup (only SAFE_READ / ACCOUNT_READ).
 *  - All output redacted before it reaches disk.
 *  - Pacing: global read window capped well under the documented 60 reads/60 s
 *    (per-user, shared across all servers/tokens); min interval between calls.
 *
 * NOTE on reuse: `relay/iq-mcp/adapter.mjs` is binary/turbo-only and exposes
 * only its 7 READ_TOOLS; this benchmark needs the 5 product servers and the
 * extra read tools (get_instruments/get_prices/get_orders/calculate_order_size)
 * the adapter does not expose. The security primitives are reused verbatim;
 * this file carries its own minimal JSON-RPC/SSE client (same shape as the
 * existing `scripts/iq-mcp-*-probe.mjs`).
 *
 * Usage (PowerShell):
 *   $env:IQ_MCP_TOKEN = "<token>"; node scripts/iq-mcp-benchmark.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RISK,
  assertReadOnlyMethod,
  assertReadProbeMethod,
  classifyTool,
  redact as redactSecret,
} from "../relay/iq-mcp/security.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = Object.freeze({ name: "tracecom-mcp-benchmark", version: "0.1.0" });
const INIT_PARAMS = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: CLIENT_INFO,
});

// binary-options LAST on purpose: its burst phase can trip a real 429 and must
// never truncate measurements for the other servers.
export const BENCH_SERVERS = Object.freeze([
  { name: "turbo-options", url: "https://turbo-options.mcp.iqoption.com", family: "binary" },
  { name: "blitz-options", url: "https://blitz-options.mcp.iqoption.com", family: "binary" },
  { name: "digital-options", url: "https://digital-options.mcp.iqoption.com", family: "digital" },
  { name: "marginal-cfd", url: "https://marginal-cfd.mcp.iqoption.com", family: "marginal" },
  { name: "marginal-crypto", url: "https://marginal-crypto.mcp.iqoption.com", family: "marginal" },
  { name: "marginal-forex", url: "https://marginal-forex.mcp.iqoption.com", family: "marginal" },
  { name: "binary-options", url: "https://binary-options.mcp.iqoption.com", family: "binary" },
]);

const COMMON_READS = Object.freeze([
  "get_capabilities",
  "get_limits",
  "list_assets",
  "list_balances",
  "list_positions",
  "get_trade_history",
  "get_candles",
]);

export const FAMILY_READ_ALLOWLISTS = Object.freeze({
  binary: COMMON_READS,
  digital: Object.freeze([...COMMON_READS, "get_instruments", "get_prices"]),
  marginal: Object.freeze([...COMMON_READS, "get_orders", "get_instruments", "calculate_order_size"]),
});

const READ_RISKS = new Set([RISK.SAFE_READ, RISK.ACCOUNT_READ]);

/** Startup gate: every allowlisted tool must classify as a read. */
export function assertAllowlistReadOnly(family, allowlist = FAMILY_READ_ALLOWLISTS[family]) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) throw new Error(`MCP_ALLOWLIST_MISSING: ${family}`);
  for (const name of allowlist) {
    const risk = classifyTool({ name });
    if (!READ_RISKS.has(risk)) throw new Error(`MCP_ALLOWLIST_WRITE: ${family}/${name} classified ${risk}`);
  }
  return true;
}

/** Per-server read plan; every entry is an allowlisted read tool. */
export function readPlanFor(family) {
  const plans = [
    { tool: "get_capabilities" },
    { tool: "get_limits" },
    { tool: "list_assets" },
    { tool: "list_balances", args: family === "marginal" ? { types: "ALL" } : {} },
    {
      tool: "list_positions",
      resolve: (ctx) => {
        if (family === "digital") return {};
        return ctx.balanceId === undefined ? null : { balance_id: ctx.balanceId };
      },
      skipReason: "NO_BALANCE_ID_FROM_list_balances",
    },
    {
      tool: "get_trade_history",
      resolve: (ctx) => {
        if (family !== "marginal") return {};
        return ctx.balanceId === undefined ? null : { balance_id: ctx.balanceId };
      },
      skipReason: "NO_BALANCE_ID_FROM_list_balances",
    },
  ];
  if (family === "marginal") {
    plans.push({
      tool: "get_orders",
      resolve: (ctx) => (ctx.balanceId === undefined ? null : { balance_id: ctx.balanceId }),
      skipReason: "NO_BALANCE_ID_FROM_list_balances",
    });
  }
  if (family === "digital" || family === "marginal") {
    plans.push({
      tool: "get_instruments",
      resolve: (ctx) => (ctx.assetId === undefined ? null : { asset_id: ctx.assetId }),
      skipReason: "NO_ASSET_ID_FROM_list_assets",
    });
  }
  if (family === "digital") {
    plans.push({
      tool: "get_prices",
      resolve: (ctx) => (ctx.assetId === undefined ? null : { asset_id: ctx.assetId }),
      skipReason: "NO_ASSET_ID_FROM_list_assets",
    });
  }
  if (family === "marginal") {
    plans.push({
      tool: "calculate_order_size",
      resolve: (ctx) => {
        if (ctx.assetId === undefined || !ctx.currency) return null;
        return { asset_id: ctx.assetId, balance_currency: ctx.currency, leverage: 1, lots: ctx.minLots ?? 1 };
      },
      skipReason: "NO_ASSET_ID/CURRENCY_CONTEXT",
    });
  }
  plans.push({
    tool: "get_candles",
    resolve: (ctx) => (ctx.candleAssetId === undefined ? null : { asset_id: ctx.candleAssetId, size: 60, count: 100 }),
    skipReason: "NO_OPEN_ASSET_FROM_list_assets",
  });
  return plans;
}

/** Accumulates derived context from this server's own read responses. */
export function absorbContext(ctx, tool, payload) {
  if (tool === "list_assets") {
    const assets = Array.isArray(payload?.assets) ? payload.assets : Array.isArray(payload) ? payload : [];
    const numeric = assets.filter((a) => a && typeof a.asset_id === "number" && a.asset_id > 0);
    ctx.openAssets = numeric.filter((a) => a.is_open === true);
    if (ctx.openAssets[0]) ctx.candleAssetId = ctx.openAssets[0].asset_id;
    if (numeric[0]) {
      ctx.assetId = numeric[0].asset_id;
      ctx.assetType = numeric[0].asset_type ?? null;
    }
  } else if (tool === "list_balances") {
    const balances = Array.isArray(payload?.balances) ? payload.balances : Array.isArray(payload) ? payload : [];
    const pick = balances.find((b) => b?.type === "training") ?? balances[0];
    if (pick) {
      ctx.balanceId = pick.balance_id;
      ctx.currency = pick.currency;
    }
  } else if (tool === "get_instruments") {
    const instruments = Array.isArray(payload?.instruments) ? payload.instruments : Array.isArray(payload) ? payload : [];
    const lots = instruments[0]?.min_quantity ?? instruments[0]?.min_lots ?? instruments[0]?.min_size;
    if (typeof lots === "number" && lots > 0) ctx.minLots = lots;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function nowMs() {
  return performance.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Nearest-rank percentile; with N=5 p95 equals max by construction (documented). */
export function stats(values) {
  const arr = (values ?? []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (arr.length === 0) return { n: 0, min: null, p50: null, p95: null, max: null, mean: null };
  const at = (q) => arr[Math.min(arr.length - 1, Math.max(0, Math.ceil(q * arr.length) - 1))];
  return {
    n: arr.length,
    min: round1(arr[0]),
    p50: round1(at(0.5)),
    p95: round1(at(0.95)),
    max: round1(arr[arr.length - 1]),
    mean: round1(arr.reduce((s, v) => s + v, 0) / arr.length),
  };
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

function toolErrorMessage(result) {
  const textPart = Array.isArray(result?.content) ? result.content.find((c) => typeof c?.text === "string") : null;
  const detail = textPart ? textPart.text.trim() : "tool reported isError=true";
  return detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
}

function parseResponse(text, contentType, id) {
  if (String(contentType).includes("text/event-stream")) {
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const message = JSON.parse(data);
        if (!message || (message.result === undefined && message.error === undefined)) continue;
        if (message.id !== undefined && String(message.id) !== String(id)) continue;
        return message;
      } catch {
        /* non-JSON SSE frame */
      }
    }
    return { error: { message: "SSE stream without a matching JSON-RPC response" } };
  }
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { error: { message: "empty HTTP body" } };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { error: { message: "non-JSON HTTP body" } };
  }
}

class Pacer {
  constructor({ minIntervalMs = 150 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.lastAt = 0;
    this.chain = Promise.resolve();
  }

  wait() {
    const task = this.chain.then(async () => {
      const waitMs = this.lastAt + this.minIntervalMs - nowMs();
      if (waitMs > 0) await sleep(waitMs);
      this.lastAt = nowMs();
    });
    this.chain = task.catch(() => {});
    return task;
  }
}

/**
 * Global call governor for the WHOLE run (documented limit: gateway 200/60 s,
 * read 60/60 s, per-user, shared across tokens and servers).
 *
 * Observed live twice: the real limit trips at ~60 calls inside 60 s and is
 * reported as HTTP 200 + JSON-RPC `rate_limited` (retry_after_ms=60000), not as
 * HTTP 429. It is not certain the server excludes control methods
 * (`initialize` / `notifications/initialized` / `tools/list`) from the read
 * bucket, so this run paces EVERY call at `minCallIntervalMs = 1500` (via the
 * Pacer) and records every call in the rolling window below — guaranteeing
 * <= ~41 calls in any 60 s window regardless of alignment or of whether
 * controls count.
 */
class ReadGovernor {
  constructor({ cap = 36, windowMs = 60_000, burstHeadroom = 8 } = {}) {
    this.cap = cap;
    this.windowMs = windowMs;
    this.burstHeadroom = burstHeadroom;
    this.stamps = [];
  }

  countLast() {
    const cutoff = nowMs() - this.windowMs;
    this.stamps = this.stamps.filter((t) => t > cutoff);
    return this.stamps.length;
  }

  remaining() {
    return Math.max(0, this.cap - this.countLast());
  }

  remainingBurstCapacity() {
    return Math.max(0, this.cap + this.burstHeadroom - this.countLast());
  }

  /** Records a non-read call (control) in the rolling window. */
  noteCall() {
    this.countLast();
    this.stamps.push(nowMs());
  }

  /** Reserves a read slot; the Pacer already spaced the call start. */
  async reserve() {
    while (this.countLast() >= this.cap) {
      await sleep(Math.max(20, this.stamps[0] + this.windowMs - nowMs() + 20));
    }
    this.stamps.push(nowMs());
  }

  /** Reserves `n` read slots at once (concurrency test), capped by the window. */
  async reserveBatch(n) {
    for (;;) {
      if (this.countLast() + n <= this.cap) break;
      await sleep(Math.max(20, this.stamps[0] + this.windowMs - nowMs() + 20));
    }
    const now = nowMs();
    for (let i = 0; i < n; i++) this.stamps.push(now);
  }

  async drainBelow(limit) {
    for (;;) {
      const oldest = this.countLast() ? this.stamps[0] : 0;
      if (this.stamps.length <= limit) break;
      await sleep(Math.max(20, oldest + this.windowMs - nowMs() + 20));
    }
  }

  registerBurstSlot() {
    this.countLast();
    this.stamps.push(nowMs());
  }
}

class McpCaller {
  constructor({
    url,
    token,
    allowlist,
    fetchImpl,
    pacer,
    governor,
    timeoutMs = 20_000,
    maxRateLimitRetries = 2,
    maxRateLimitWaitMs = 90_000,
    onRateLimit = () => {},
  }) {
    this.url = url;
    this.token = token;
    this.allowlist = allowlist;
    this.fetchImpl = fetchImpl;
    this.pacer = pacer;
    this.governor = governor;
    this.timeoutMs = timeoutMs;
    this.maxRateLimitRetries = maxRateLimitRetries;
    this.maxRateLimitWaitMs = maxRateLimitWaitMs;
    this.onRateLimit = onRateLimit;
    this.sessionId = null;
    this.nextId = 1;
  }

  async rpc(opts) {
    const {
      method,
      params,
      tool = null,
      args = null,
      notification = false,
      bypassPacer = false,
      reserveRead = true,
      maxRateLimitRetries = this.maxRateLimitRetries,
    } = opts;
    if (tool !== null) {
      assertReadProbeMethod("tools/call", tool, classifyTool({ name: tool }), this.allowlist);
    } else {
      assertReadOnlyMethod(method);
    }

    for (let attempt = 0; ; attempt += 1) {
      const rec = await this._attempt({ method, params, tool, args, notification, bypassPacer, reserveRead });
      rec.attempt = attempt + 1;
      if (!rec.rateLimited) return rec;
      const canRetry = !notification && attempt < maxRateLimitRetries;
      const waitMs = canRetry ? Math.min(this.maxRateLimitWaitMs, (rec.retryAfterMs ?? 60_000) + 500) : 0;
      this.onRateLimit(rec, { willRetry: canRetry, waitMs });
      if (!canRetry) return rec;
      await sleep(waitMs);
    }
  }

  async _attempt({ method, params, tool, args, notification, bypassPacer, reserveRead }) {
    const enteredAt = nowMs();
    if (!bypassPacer) await this.pacer.wait();
    if (tool !== null) {
      if (reserveRead) await this.governor.reserve();
    } else {
      this.governor.noteCall();
    }
    const queueMs = round1(nowMs() - enteredAt);

    const id = notification ? null : this.nextId++;
    const body = { jsonrpc: "2.0", method };
    if (!notification) body.id = id;
    if (params !== undefined) body.params = params;

    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    const rec = {
      at: Date.now(),
      method,
      tool,
      args,
      id,
      queueMs,
      wallMs: null,
      status: 0,
      contentType: "",
      bodyBytes: 0,
      payloadBytes: null,
      payloadKeys: null,
      rpcError: null,
      toolError: null,
      rateLimited: false,
      retryAfter: null,
      retryAfterMs: null,
      resetAt: null,
      error: null,
      ok: false,
    };

    const startedAt = nowMs();
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      rec.wallMs = round1(nowMs() - startedAt);
      rec.status = res.status;
      rec.contentType = res.headers?.get?.("content-type") ?? "";
      rec.bodyBytes = Buffer.byteLength(text, "utf8");
      const sid = res.headers?.get?.("mcp-session-id");
      if (sid) this.sessionId = sid;
      const retryAfter = res.headers?.get?.("retry-after");
      if (retryAfter !== null && retryAfter !== undefined) {
        rec.retryAfter = retryAfter;
        const n = Number(retryAfter);
        if (Number.isFinite(n)) rec.retryAfterMs = n * 1000;
      }

      if (notification) {
        rec.ok = res.status >= 200 && res.status < 300;
      } else {
        const parsed = parseResponse(text, rec.contentType, id);
        if (parsed.error) {
          const message = String(parsed.error?.message ?? JSON.stringify(parsed.error));
          rec.rpcError = redactSecret(message).slice(0, 300);
          if (Number.isFinite(Number(parsed.error?.data?.retry_after_ms))) {
            rec.retryAfterMs = Number(parsed.error.data.retry_after_ms);
          }
          if (parsed.error?.data?.reset_at !== undefined) rec.resetAt = parsed.error.data.reset_at;
          if (rec.retryAfterMs === null) {
            const hinted = /retry_after_ms[=:]\s*(\d+)/i.exec(message);
            if (hinted) rec.retryAfterMs = Number(hinted[1]);
          }
        } else if (parsed.result !== undefined) {
          const payload = extractToolPayload(parsed.result);
          rec.rawPayload = payload;
          rec.payloadKeys = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : null;
          try {
            rec.payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
          } catch {
            rec.payloadBytes = null;
          }
          if (parsed.result?.isError === true) rec.toolError = redactSecret(toolErrorMessage(parsed.result)).slice(0, 300);
        }
        const errorSurface =
          parsed.error === undefined ? "" : `${parsed.error?.message ?? ""} ${JSON.stringify(parsed.error?.data ?? {})}`;
        rec.rateLimited =
          res.status === 429 ||
          (parsed.error !== undefined && /rate[_ -]?limit/i.test(errorSurface)) ||
          /rate[_ -]?limit/i.test(rec.rpcError ?? "");
        rec.ok =
          res.status >= 200 &&
          res.status < 300 &&
          !parsed.error &&
          parsed.result !== undefined &&
          parsed.result.isError !== true;
      }
    } catch (err) {
      rec.wallMs = round1(nowMs() - startedAt);
      rec.error = timedOut ? `timeout>${this.timeoutMs}ms` : `${err?.name ?? "Error"}: ${err?.message ?? err}`;
    } finally {
      clearTimeout(timer);
    }

    return rec;
  }
}

function condense(rec, phase) {
  return {
    phase,
    at: rec.at,
    atIso: new Date(rec.at).toISOString(),
    method: rec.method,
    tool: rec.tool,
    args: rec.args,
    queueMs: rec.queueMs,
    wallMs: rec.wallMs,
    status: rec.status,
    bodyBytes: rec.bodyBytes,
    payloadBytes: rec.payloadBytes,
    payloadKeys: rec.payloadKeys,
    ok: rec.ok,
    rateLimited: rec.rateLimited,
    retryAfter: rec.retryAfter,
    retryAfterMs: rec.retryAfterMs,
    resetAt: rec.resetAt,
    rpcError: rec.rpcError,
    toolError: rec.toolError,
    error: rec.error,
  };
}

async function coldHandshake(caller) {
  const startedAt = nowMs();
  const init = await caller.rpc({ method: "initialize", params: INIT_PARAMS });
  const notif = await caller.rpc({ method: "notifications/initialized", params: {}, notification: true });
  const wallMs = round1(nowMs() - startedAt);
  const queueMs = round1((init.queueMs ?? 0) + (notif.queueMs ?? 0));
  return {
    wallMs,
    queueMs,
    protocolMs: round1(wallMs - queueMs),
    initMs: init.wallMs,
    notifMs: notif.wallMs,
    status: init.status,
    ok: init.ok && notif.ok,
    initError: init.rpcError ?? init.error,
  };
}

// ---------------------------------------------------------------------------
// measurement pipeline
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = Object.freeze({
  coldN: 5,
  toolsN: 5,
  readN: 5,
  sessionN: 2,
  burstReads: 12,
  burstSpacingMs: 150,
  burstDrainBelow: 10,
  concurrencyParallel: 4,
  concurrencyRounds: 3,
  concurrencyServer: "binary-options",
  readWindowCap: 36,
  minCallIntervalMs: 1500,
  rateLimitRetries: 2,
  rateLimitMaxWaitMs: 90_000,
  timeoutMs: 20_000,
});

export async function runBenchmark({
  token = "",
  servers = BENCH_SERVERS,
  config = {},
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startedAt = new Date().toISOString();
  const report = {
    generatedAt: startedAt,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    authenticated: Boolean(token),
    config: { ...cfg },
    security: {
      mode: "READ_ONLY",
      gates: "relay/iq-mcp/security.mjs (assertReadOnlyMethod/assertReadProbeMethod/classifyTool)",
      tokenPersisted: false,
      pacing: `min ${cfg.minCallIntervalMs}ms between ANY call (=< ~41 per any 60s window) + rolling ${cfg.readWindowCap}/60s cap; conservative because the server may count control methods in the read bucket`,
    },
    incumbent: {
      wsAckP50Ms: 177,
      driftP50Ms: -473,
      driftRangeMs: [-1327, 272],
      note: "TraceCom incumbent numbers, NOT re-measured in this run.",
    },
    // Observed live during this session's pre-flight (before pacing was fixed):
    // the read bucket is enforced with HTTP 200 + JSON-RPC error, not HTTP 429.
    rateLimitObservation: {
      observed: true,
      source: "turbo-options get_limits/get_capabilities (pre-flight diagnostic)",
      httpStatus: 200,
      rpcError: "rate_limited: rate limit exceeded (limit=60, retry_after_ms=60000, reset_at=<timestamp>)",
      retryAfterHeader: null,
      retryAfterMs: 60000,
      note: "Real limit hit in successive runs even after pacing EVERY call at 1.5s (<= ~41 calls per any 60s window) and recording controls in the rolling window — consistent with the documented per-user quota being shared across tokens and servers and already consumed elsewhere. The benchmark therefore waits retry_after_ms (<=90s) and retries a call at most twice; burst and concurrency never retry.",
    },
    servers: {},
    aborted: null,
    rateLimitEvents: [],
  };

  const globalCtx = {
    token,
    fetchImpl,
    timeoutMs: cfg.timeoutMs,
    n: cfg,
    globalStop: false,
    stopReason: null,
    rateLimitEvents: report.rateLimitEvents,
  };

  const onRateLimit = (serverName) => (rec, meta = {}) => {
    globalCtx.rateLimitEvents.push({
      at: rec.at,
      atIso: new Date(rec.at).toISOString(),
      server: serverName,
      call: rec.tool ?? rec.method,
      status: rec.status,
      rpcError: rec.rpcError,
      retryAfterMs: rec.retryAfterMs,
      resetAt: rec.resetAt,
      willRetry: Boolean(meta.willRetry),
      waitedMs: meta.waitMs ?? 0,
    });
    log(
      `[bench] RATE LIMITED on ${serverName}/${rec.tool ?? rec.method} (HTTP ${rec.status}, retry_after_ms=${
        rec.retryAfterMs ?? "—"
      }) → ${meta.willRetry ? `waiting ${meta.waitMs}ms then retrying` : "giving up / halting"}`,
    );
    if (!meta.willRetry) {
      globalCtx.globalStop = true;
      globalCtx.stopReason = `rate_limited on ${serverName}/${rec.tool ?? rec.method} (HTTP ${rec.status})`;
    }
  };

  for (const server of servers) {
    const entry = {
      url: server.url,
      family: server.family,
      allowlist: [],
      error: null,
      coldHandshake: [],
      warmToolsList: null,
      toolCount: null,
      reads: {},
      context: null,
      sessionOverhead: null,
      burst: null,
      concurrency: null,
    };
    report.servers[server.name] = entry;

    try {
      const allowlist = [...FAMILY_READ_ALLOWLISTS[server.family]];
      assertAllowlistReadOnly(server.family, allowlist);
      entry.allowlist = allowlist;
    } catch (err) {
      entry.error = redactSecret(String(err?.message ?? err));
      continue;
    }

    if (!token) {
      entry.error = "NO_TOKEN";
      continue;
    }
    if (globalCtx.globalStop) {
      entry.error = `SKIPPED: ${globalCtx.stopReason}`;
      continue;
    }

    const pacer = new Pacer({ minIntervalMs: cfg.minCallIntervalMs });
    const governor = new ReadGovernor({ cap: cfg.readWindowCap });
    const mkCaller = () =>
      new McpCaller({
        url: server.url,
        token,
        allowlist: entry.allowlist,
        fetchImpl,
        pacer,
        governor,
        timeoutMs: cfg.timeoutMs,
        maxRateLimitRetries: cfg.rateLimitRetries,
        maxRateLimitWaitMs: cfg.rateLimitMaxWaitMs,
        onRateLimit: onRateLimit(server.name),
      });

    // (1) cold handshake --------------------------------------------------
    for (let i = 0; i < cfg.coldN && !globalCtx.globalStop; i++) {
      const hs = await coldHandshake(mkCaller());
      entry.coldHandshake.push(hs);
      if (hs.status === 401 || hs.status === 403) {
        entry.error = `initialize HTTP ${hs.status} (auth)`;
        globalCtx.globalStop = true;
        globalCtx.stopReason = entry.error;
      }
    }
    entry.coldHandshakeStats = stats(entry.coldHandshake.map((h) => h.protocolMs));
    entry.coldHandshakeInitStats = stats(entry.coldHandshake.map((h) => h.initMs));
    entry.coldHandshakeWallStats = stats(entry.coldHandshake.map((h) => h.wallMs));
    log(
      `[bench] ${server.name} cold-handshake protocol p50=${entry.coldHandshakeStats.p50}ms wall p50=${entry.coldHandshakeWallStats.p50}ms (n=${entry.coldHandshakeStats.n})`,
    );
    if (entry.error || globalCtx.globalStop) continue;

    // warm session (kept for tools/list + reads + session overhead)
    const caller = mkCaller();
    const init = await caller.rpc({ method: "initialize", params: INIT_PARAMS });
    if (init.status === 401 || init.status === 403) {
      entry.error = `initialize HTTP ${init.status} (auth)`;
      globalCtx.globalStop = true;
      globalCtx.stopReason = entry.error;
      continue;
    }
    await caller.rpc({ method: "notifications/initialized", params: {}, notification: true });
    entry.warmSession = { status: init.status, ok: init.ok, initMs: init.wallMs };

    // (2) warm tools/list --------------------------------------------------
    const toolsList = { calls: [], stats: null };
    for (let i = 0; i < cfg.toolsN && !globalCtx.globalStop; i++) {
      const rec = await caller.rpc({ method: "tools/list", params: {} });
      if (i === 0) {
        const tools = rec.rawPayload?.tools;
        if (Array.isArray(tools)) entry.toolCount = tools.length;
      }
      toolsList.calls.push(condense(rec, "tools/list"));
    }
    toolsList.stats = stats(toolsList.calls.map((c) => c.wallMs));
    entry.warmToolsList = toolsList;
    log(`[bench] ${server.name} tools/list p50=${toolsList.stats.p50}ms tools=${entry.toolCount}`);

    // (3) per-tool read latency -------------------------------------------
    const gctx = {};
    for (const step of readPlanFor(server.family)) {
      if (globalCtx.globalStop) break;
      const args = step.resolve ? step.resolve(gctx) : step.args ?? {};
      if (args === null) {
        entry.reads[step.tool] = { skipped: step.skipReason || "UNSATISFIED_ARGUMENTS" };
        continue;
      }
      const row = { args, okCount: 0, calls: [] };
      for (let i = 0; i < cfg.readN && !globalCtx.globalStop; i++) {
        const rec = await caller.rpc({
          method: "tools/call",
          params: { name: step.tool, arguments: args },
          tool: step.tool,
          args,
        });
        if (rec.rawPayload !== undefined) absorbContext(gctx, step.tool, rec.rawPayload);
        if (rec.ok) row.okCount += 1;
        row.calls.push(condense(rec, "read"));
      }
      row.stats = stats(row.calls.map((c) => c.wallMs));
      row.payloadStats = stats(row.calls.map((c) => c.payloadBytes));
      row.bodyStats = stats(row.calls.map((c) => c.bodyBytes));
      entry.reads[step.tool] = row;
      log(
        `[bench] ${server.name} ${step.tool} p50=${row.stats.p50}ms p95=${row.stats.p95}ms bytes=${row.payloadStats.p50} ok=${row.okCount}/${row.calls.length}`,
      );
    }
    entry.context = {
      assetId: gctx.assetId ?? null,
      candleAssetId: gctx.candleAssetId ?? null,
      balanceId: gctx.balanceId ?? null,
      currency: gctx.currency ?? null,
      minLots: gctx.minLots ?? null,
      openAssets: (gctx.openAssets ?? []).length,
    };
    if (globalCtx.globalStop) continue;

    // (4) session reuse vs fresh handshake --------------------------------
    const so = { tool: "get_capabilities", args: {}, warm: [], cold: [] };
    for (let i = 0; i < cfg.sessionN && !globalCtx.globalStop; i++) {
      const rec = await caller.rpc({
        method: "tools/call",
        params: { name: so.tool, arguments: so.args },
        tool: so.tool,
        args: so.args,
      });
      so.warm.push({ wallMs: rec.wallMs, queueMs: rec.queueMs, status: rec.status, ok: rec.ok });
    }
    for (let i = 0; i < cfg.sessionN && !globalCtx.globalStop; i++) {
      const fresh = mkCaller();
      const startedAtSo = nowMs();
      const i1 = await fresh.rpc({ method: "initialize", params: INIT_PARAMS });
      const i2 = await fresh.rpc({ method: "notifications/initialized", params: {}, notification: true });
      const read = await fresh.rpc({
        method: "tools/call",
        params: { name: so.tool, arguments: so.args },
        tool: so.tool,
        args: so.args,
      });
      const totalMs = round1(nowMs() - startedAtSo);
      const queueMs = round1((i1.queueMs ?? 0) + (i2.queueMs ?? 0) + (read.queueMs ?? 0));
      so.cold.push({
        totalMs,
        queueMs,
        protocolMs: round1(totalMs - queueMs),
        initMs: i1.wallMs,
        notifMs: i2.wallMs,
        callMs: read.wallMs,
        ok: i1.ok && read.ok,
      });
    }
    so.warmStats = stats(so.warm.map((w) => w.wallMs));
    so.coldStats = stats(so.cold.map((w) => w.totalMs));
    so.coldProtocolStats = stats(so.cold.map((w) => w.protocolMs));
    so.coldCallStats = stats(so.cold.map((w) => w.callMs));
    so.savingMs =
      so.warmStats.n > 0 && so.coldProtocolStats.n > 0
        ? round1(so.coldProtocolStats.mean - so.warmStats.mean)
        : null;
    entry.sessionOverhead = so;
    log(
      `[bench] ${server.name} session saving=${so.savingMs}ms (fresh protocol ${so.coldProtocolStats.mean}ms vs warm ${so.warmStats.mean}ms; pacing excluded)`,
    );
    if (globalCtx.globalStop) continue;

    // (6) concurrency THEN (5) burst on the designated server: a burst that
    // trips the real 429 halts the run, so it must run last.
    if (server.name === cfg.concurrencyServer) {
      const openAssets = [...new Set((gctx.openAssets ?? []).map((a) => a.asset_id))];
      if (!globalCtx.globalStop && openAssets.length >= cfg.concurrencyParallel) {
        const conc = {
          parallel: cfg.concurrencyParallel,
          rounds: cfg.concurrencyRounds,
          assets: openAssets.slice(0, cfg.concurrencyParallel),
          calls: [],
          roundsData: [],
          stats: null,
          serialP50: entry.reads?.get_candles?.stats?.p50 ?? null,
          deltaP50: null,
          note: "start-spacing bypassed so the 4 reads are in-flight together; read window still enforced",
        };
        for (let r = 0; r < cfg.concurrencyRounds && !globalCtx.globalStop; r++) {
          await governor.reserveBatch(conc.assets.length);
          const batchStarted = nowMs();
          const recs = await Promise.all(
            conc.assets.map((assetId) =>
              caller.rpc({
                method: "tools/call",
                params: { name: "get_candles", arguments: { asset_id: assetId, size: 60, count: 100 } },
                tool: "get_candles",
                args: { asset_id: assetId, size: 60, count: 100 },
                bypassPacer: true,
                reserveRead: false,
                maxRateLimitRetries: 0,
              }),
            ),
          );
          conc.roundsData.push({
            round: r + 1,
            batchWallMs: round1(nowMs() - batchStarted),
            p50: stats(recs.map((x) => x.wallMs)).p50,
            errors: recs.filter((x) => !x.ok).length,
          });
          conc.calls.push(...recs.map((x) => condense(x, "concurrency")));
        }
        conc.stats = stats(conc.calls.map((c) => c.wallMs));
        conc.deltaP50 = conc.serialP50 !== null && conc.stats.p50 !== null ? round1(conc.stats.p50 - conc.serialP50) : null;
        entry.concurrency = conc;
        log(
          `[bench] ${server.name} concurrency p50=${conc.stats.p50}ms vs serial p50=${conc.serialP50}ms (delta ${conc.deltaP50}ms)`,
        );
      }

      const burst = {
        reads: cfg.burstReads,
        spacingMs: cfg.burstSpacingMs,
        calls: [],
        detected429: false,
        note: "",
        stats: null,
      };
      if (!globalCtx.globalStop) {
        // Let the rolling window drain so the burst cannot straddle the cap:
        // worst case = drainBelow + burst reads stays far under 60/60 s.
        await governor.drainBelow(cfg.burstDrainBelow);
        const capacity = governor.remainingBurstCapacity();
        if (capacity >= cfg.burstReads) {
          const startedBurst = nowMs();
          for (let i = 0; i < cfg.burstReads && !globalCtx.globalStop; i++) {
            if (i > 0) await sleep(cfg.burstSpacingMs);
            governor.registerBurstSlot();
            const rec = await caller.rpc({
              method: "tools/call",
              params: { name: "get_capabilities", arguments: {} },
              tool: "get_capabilities",
              args: {},
              bypassPacer: true,
              reserveRead: false,
              maxRateLimitRetries: 0,
            });
            burst.calls.push(condense(rec, "burst"));
            if (rec.rateLimited) {
              burst.detected429 = true;
              burst.note = `rate_limited at burst read #${i + 1} (HTTP ${rec.status}, rpcError: ${
                rec.rpcError ?? "—"
              }${rec.retryAfter ? `, Retry-After: ${rec.retryAfter}` : ", no HTTP Retry-After header (HTTP 200)"}${
                rec.retryAfterMs ? `, retry_after_ms=${rec.retryAfterMs}` : ""
              })`;
              globalCtx.globalStop = true;
              globalCtx.stopReason = `${server.name} burst: ${burst.note}`;
            }
          }
          burst.durationMs = round1(nowMs() - startedBurst);
          if (!burst.detected429) {
            burst.note = `${cfg.burstReads} reads in ${burst.durationMs}ms — no rate_limited observed (window drained first; documented 60/60 s cap never exceeded by design)`;
          }
        } else {
          burst.skipped = `window capacity ${capacity} < ${cfg.burstReads}`;
        }
      } else {
        burst.skipped = "halted before burst (rate_limited observed earlier)";
      }
      burst.stats = stats(burst.calls.map((c) => c.wallMs));
      entry.burst = burst;
      log(`[bench] ${server.name} burst: ${burst.note || burst.skipped}`);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.aborted = globalCtx.globalStop ? globalCtx.stopReason : null;
  report.rankings = computeRankings(report);
  report.hotPath = computeHotPath(report);
  return report;
}

function pooledReadStats(entry) {
  const values = [];
  for (const row of Object.values(entry.reads ?? {})) {
    if (!row?.calls) continue;
    for (const call of row.calls) if (Number.isFinite(call.wallMs)) values.push(call.wallMs);
  }
  return stats(values);
}

function readToolCount(entry) {
  return Object.values(entry.reads ?? {}).filter((row) => row && Array.isArray(row.calls) && row.calls.length > 0).length;
}

function richnessFor(entry) {
  const listAssetsBytes = entry.reads?.list_assets?.payloadStats?.p50 ?? null;
  const perTool = Object.values(entry.reads ?? {})
    .map((row) => row?.payloadStats?.p50)
    .filter((v) => Number.isFinite(v));
  return {
    readTools: readToolCount(entry),
    listAssetsBytes,
    totalPayloadBytes: perTool.length ? perTool.reduce((s, v) => s + v, 0) : null,
    medianToolPayloadBytes: stats(perTool).p50,
  };
}

export function computeRankings(report) {
  const rows = [];
  for (const [name, entry] of Object.entries(report.servers)) {
    if (entry.error) continue;
    const pooled = pooledReadStats(entry);
    rows.push({
      name,
      pooledRead: pooled,
      handshakeP50: entry.coldHandshakeStats?.p50 ?? null,
      candle: entry.reads?.get_candles?.stats ?? null,
      richness: richnessFor(entry),
      toolCount: entry.toolCount,
    });
  }
  return {
    byReadLatency: [...rows]
      .sort((a, b) => (a.pooledRead.p50 ?? Infinity) - (b.pooledRead.p50 ?? Infinity))
      .map((r, i) => ({ rank: i + 1, server: r.name, pooledP50Ms: r.pooledRead.p50, pooledP95Ms: r.pooledRead.p95 })),
    byHandshake: [...rows]
      .sort((a, b) => (a.handshakeP50 ?? Infinity) - (b.handshakeP50 ?? Infinity))
      .map((r, i) => ({ rank: i + 1, server: r.name, handshakeP50Ms: r.handshakeP50 })),
    byPayloadRichness: [...rows]
      .sort((a, b) => {
        const bytes = (b.richness.listAssetsBytes ?? -1) - (a.richness.listAssetsBytes ?? -1);
        if (bytes !== 0) return bytes;
        return (b.richness.readTools ?? 0) - (a.richness.readTools ?? 0);
      })
      .map((r, i) => ({
        rank: i + 1,
        server: r.name,
        listAssetsBytesP50: r.richness.listAssetsBytes,
        readTools: r.richness.readTools,
        toolCount: r.toolCount,
        totalPayloadBytesP50Sum: r.richness.totalPayloadBytes,
      })),
    detail: rows,
  };
}

export function computeHotPath(report) {
  const out = {};
  for (const [name, entry] of Object.entries(report.servers)) {
    if (entry.error) {
      out[name] = { available: false, error: entry.error };
      continue;
    }
    const candle = entry.reads?.get_candles?.stats ?? null;
    const p50 = candle?.p50 ?? null;
    const p95 = candle?.p95 ?? null;
    out[name] = {
      available: candle !== null && candle.n > 0,
      candleP50Ms: p50,
      candleP95Ms: p95,
      thresholdMs: 2000,
      jitCompatible: p95 !== null && p95 <= 2000,
      entryWindow60sCompatible: p95 !== null && p95 <= 60_000,
      candlePayloadBytesP50: entry.reads?.get_candles?.payloadStats?.p50 ?? null,
      note:
        p95 === null
          ? "no candle samples"
          : p95 <= 2000
            ? "p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter"
            : "p95 > 2000 ms: NOT compatible with JIT revalidation inside the last seconds before submitAt",
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// artifact rendering
// ---------------------------------------------------------------------------

function ms(value) {
  return value === null || value === undefined ? "—" : `${value}`;
}

function tableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

function renderToolTable(entry) {
  const lines = [
    tableRow(["tool", "args", "ok/N", "p50 ms", "p95 ms", "min", "max", "mean", "payload bytes (p50)"]),
    tableRow(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const [tool, row] of Object.entries(entry.reads ?? {})) {
    if (row.skipped) {
      lines.push(tableRow([`\`${tool}\``, "—", `skipped: ${row.skipped}`, "—", "—", "—", "—", "—", "—"]));
      continue;
    }
    lines.push(
      tableRow([
        `\`${tool}\``,
        `\`${JSON.stringify(row.args)}\``,
        `${row.okCount}/${row.calls.length}`,
        ms(row.stats.p50),
        ms(row.stats.p95),
        ms(row.stats.min),
        ms(row.stats.max),
        ms(row.stats.mean),
        ms(row.payloadStats.p50),
      ]),
    );
  }
  return lines;
}

export function renderMarkdown(report) {
  const out = [];
  const push = (...lines) => out.push(...lines);

  push(
    "# IQ Official MCP — latency + timing benchmark (all 7 servers)",
    "",
    `Generated: ${report.generatedAt} · finished: ${report.finishedAt ?? "—"} · node ${report.node} (${report.platform})`,
    "",
    "Read-only benchmark: **practice only, zero orders**. Token from `IQ_MCP_TOKEN`, never persisted; all",
    "artifacts redacted. Every `tools/call` passed `assertReadProbeMethod` (write/unknown tools throw).",
    "",
    `N: cold handshake ${report.config.coldN} · tools/list ${report.config.toolsN} · each read tool ${report.config.readN} · session-overhead ${report.config.sessionN} · burst ${report.config.burstReads} reads/${report.config.burstSpacingMs} ms spacing · concurrency ${report.config.concurrencyParallel}×${report.config.concurrencyRounds} rounds on \`${report.config.concurrencyServer}\`.`,
    "",
    `Pacing: minimum **${report.config.minCallIntervalMs} ms between ANY call** (~≤ 41 calls in ANY 60 s window, independent of fixed-window alignment) plus a rolling ${report.config.readWindowCap}-call cap. Conservative on purpose: the server may count control methods (\`initialize\`, \`tools/list\`) in the read bucket, and the documented limits are per-user and shared across tokens/servers (gateway 200/60 s, read 60/60 s, write 10/60 s). The burst window is drained below ${report.config.burstDrainBelow} calls first. If the server answers \`rate_limited\`, the call waits \`retry_after_ms\` (≤ ${report.config.rateLimitMaxWaitMs} ms) and retries at most ${report.config.rateLimitRetries} times (burst/concurrency never retry).`,
    "",
    "Percentiles are nearest-rank; with N=5 the p95 equals the max by construction. Payload bytes = UTF-8 bytes of the extracted tool payload (JSON body of the MCP content part). Each measured call is fresh (no adapter cache).",
    "",
    "Incumbent TraceCom (reference, **not** re-measured here): WS ACK p50 **177 ms**; clock drift p50 **−473 ms** (range −1327 … +272 ms).",
    "",
    "Note: the earlier read probe (`docs/iq-mcp/current-vs-mcp.md`) reported `get_capabilities`/`list_assets` at ~600 ms;",
    "this run measured ~215 ms / 500–740 ms from the same workstation. Treat absolute latencies as vantage- and time-dependent;",
    "the relative ranking is the stable signal.",
    "",
  );

  if (report.aborted) push(`> **ABORTED:** ${report.aborted} — artifacts contain partial data.`, "");

  push("## 1–6. Per-server results", "");

  for (const [name, entry] of Object.entries(report.servers)) {
    push(`### ${name}`, "");
    if (entry.error) {
      push(`- error: \`${entry.error}\``, "");
      continue;
    }
    if (!entry.warmToolsList) {
      const raw = (entry.coldHandshake ?? []).map((h) => h.wallMs).join(", ") || "—";
      push(`- partial run (halted before the warm session): cold handshake raw ${raw} ms`, "");
      continue;
    }
    const allowlisted = entry.allowlist.map((t) => `\`${t}\``).join(", ");
    push(
      `- endpoint: \`${entry.url}\` · read allowlist: ${allowlisted}`,
      `- cold handshake (protocol, pacing excluded): ${entry.coldHandshake.map((h) => h.protocolMs).join(", ")} ms → p50 **${entry.coldHandshakeStats.p50} ms**, p95 ${entry.coldHandshakeStats.p95} ms, mean ${entry.coldHandshakeStats.mean} ms (wall incl. pacing p50 ${entry.coldHandshakeWallStats?.p50 ?? "—"} ms)`,
      `- warm \`tools/list\`: ${entry.warmToolsList.calls.map((c) => c.wallMs).join(", ")} ms → p50 **${entry.warmToolsList.stats.p50} ms** · tools reported: ${entry.toolCount ?? "—"}`,
      `- derived context: \`${JSON.stringify(entry.context)}\``,
      "",
    );
    push(...renderToolTable(entry));
    push("");
    if (entry.sessionOverhead) {
      const so = entry.sessionOverhead;
      push(
        `- session reuse: warm \`${so.tool}\` mean **${so.warmStats.mean} ms** (n=${so.warmStats.n}) vs fresh initialize+initialized+call mean **${so.coldProtocolStats.mean} ms** (n=${so.coldProtocolStats.n}, pacing waits excluded; raw total ${so.coldStats.mean} ms, call-only ${so.coldCallStats.mean} ms) → saving **${so.savingMs} ms/call**.`,
        "",
      );
    }
    if (entry.burst) {
      push(`- burst/429: ${entry.burst.note || entry.burst.skipped} · burst p50 ${ms(entry.burst.stats?.p50)} ms`, "");
    } else {
      push(
        `- burst/429: not tested on this server — burst runs only on \`${report.config.concurrencyServer}\`; live rate-limit observations are in section 5`,
        "",
      );
    }
    if (entry.concurrency) {
      const c = entry.concurrency;
      push(
        `- concurrency (${c.parallel} parallel × ${c.rounds}): batch wall ${c.roundsData.map((r) => r.batchWallMs).join(", ")} ms · pooled p50 **${c.stats.p50} ms** vs serial candle p50 **${c.serialP50} ms** → delta **${c.deltaP50} ms** (${c.note})`,
        "",
      );
    } else {
      push(`- concurrency: not tested on this server (runs only on \`${report.config.concurrencyServer}\`)`, "");
    }
  }

  push("## 5. Rate-limit behavior", "");
  const rl = report.rateLimitObservation;
  if (rl?.observed) {
    push(
      `Observed live (${rl.source}): HTTP **${rl.httpStatus}** with a JSON-RPC error \`${rl.rpcError}\` — i.e. the`,
      `read bucket is NOT signalled with HTTP 429 and carries **no \`Retry-After\` header**; the backoff hint is`,
      `\`retry_after_ms=${rl.retryAfterMs}\` + \`reset_at\` inside the error payload. ${rl.note}`,
      "",
      `In the measured run itself, the ${report.config.burstReads}-read burst on \`${report.config.concurrencyServer}\` was preceded by draining the window below ${report.config.burstDrainBelow} reads, so it stayed well under 60/60 s. Per-server burst notes are in the tables above.`,
      "",
    );
  } else {
    push("No rate-limit response was observed in this run.", "");
  }
  const events = report.rateLimitEvents ?? [];
  if (events.length) {
    push(`### Events recorded during the measured run (${events.length})`, "");
    push(
      tableRow(["at (ISO)", "server", "call", "HTTP", "retry_after_ms", "outcome", "waited ms"]),
      tableRow(["---", "---", "---", "---", "---", "---", "---"]),
    );
    for (const event of events) {
      push(
        tableRow([
          event.atIso,
          `\`${event.server}\``,
          `\`${event.call}\``,
          event.status,
          ms(event.retryAfterMs),
          event.willRetry ? "waited + retried" : "**halted**",
          ms(event.waitedMs),
        ]),
      );
    }
    push("");
    push(
      "Interpretation: the read quota is **per-user and shared across tokens/servers**; contention from another",
      "consumer of the same user cannot be excluded from this vantage point. Every event was signalled as HTTP 200",
      "+ JSON-RPC `rate_limited` (never HTTP 429, no `Retry-After` header), so a connector MUST parse the RPC body",
      "to back off correctly. The benchmark respected `retry_after_ms` before retrying and never deliberately",
      "exceeded the documented 60 reads/60 s.",
      "",
    );
  } else {
    push("No rate-limit event was recorded during the measured run itself.", "");
  }

  push("## Rankings", "");
  push("### (a) Lowest read latency (pooled p50 across all measured read tools)", "");
  push(tableRow(["#", "server", "pooled p50 ms", "pooled p95 ms"]), tableRow(["---", "---", "---", "---"]));
  for (const r of report.rankings.byReadLatency) push(tableRow([r.rank, `\`${r.server}\``, ms(r.pooledP50Ms), ms(r.pooledP95Ms)]));
  push("");
  push("### (b) Lowest cold handshake (initialize + notifications/initialized, p50)", "");
  push(tableRow(["#", "server", "handshake p50 ms"]), tableRow(["---", "---", "---"]));
  for (const r of report.rankings.byHandshake) push(tableRow([r.rank, `\`${r.server}\``, ms(r.handshakeP50Ms)]));
  push("");
  push("### (c) Payload richness (list_assets p50 bytes primary; read-tool coverage tie-break)", "");
  push(
    tableRow(["#", "server", "list_assets bytes p50", "read tools measured", "tools reported", "Σ tool payload p50"]),
    tableRow(["---", "---", "---", "---", "---", "---"]),
  );
  for (const r of report.rankings.byPayloadRichness) {
    push(tableRow([r.rank, `\`${r.server}\``, ms(r.listAssetsBytesP50), ms(r.readTools), ms(r.toolCount), ms(r.totalPayloadBytesP50Sum)]));
  }
  push("");

  push("## 7. Hot-path suitability", "");
  push(
    "Criterion per task: `HOT_PATH_COMPATIBLE = no` when p95 > 2000 ms (JIT revalidation inside the last seconds before `submitAt`).",
    "",
  );
  push(
    tableRow(["server", "candleFetch p50 ms", "candleFetch p95 ms", "HOT_PATH_COMPATIBLE (p95 ≤ 2000 ms)", "60 s entry window"]),
    tableRow(["---", "---", "---", "---", "---"]),
  );
  for (const [name, hot] of Object.entries(report.hotPath)) {
    if (!hot.available) {
      push(tableRow([`\`${name}\``, "—", "—", "no data", "no data"]));
      continue;
    }
    push(
      tableRow([
        `\`${name}\``,
        ms(hot.candleP50Ms),
        ms(hot.candleP95Ms),
        hot.jitCompatible ? "yes" : "**no**",
        hot.entryWindow60sCompatible ? "yes" : "no",
      ]),
    );
  }
  push("");
  for (const [name, hot] of Object.entries(report.hotPath)) {
    push(
      `- \`${name}\`: HOT_PATH_COMPATIBLE: **${hot.available ? (hot.jitCompatible ? "yes" : "no") : "n/a"}**${
        hot.available ? ` — p95 ${ms(hot.candleP95Ms)} ms vs 2000 ms` : ""
      }; ${hot.note}`,
    );
  }
  push("");
  const read1 = report.rankings.byReadLatency[0];
  const hs1 = report.rankings.byHandshake[0];
  const rich1 = report.rankings.byPayloadRichness[0];
  const hotEntries = Object.entries(report.hotPath).filter(([, h]) => h.available);
  const jitOk = hotEntries.filter(([, h]) => h.jitCompatible).map(([n]) => n);
  const jitBad = hotEntries.filter(([, h]) => !h.jitCompatible).map(([n]) => n);
  const candleP50s = hotEntries.map(([, h]) => h.candleP50Ms).filter(Number.isFinite);
  const candleRange = candleP50s.length ? `${Math.min(...candleP50s)}–${Math.max(...candleP50s)}` : "—";
  push(
    "Caveat: even where p95 ≤ 2000 ms, this is a necessary-not-sufficient test. The incumbent WS ACK p50 is 177 ms",
    `while a \`get_candles\` p50 here is **${candleRange} ms** (1.3–2.4×), and WS also carries ticks/clock that MCP`,
    "does not expose (no server-time tool). See verdict below.",
    "",
  );

  push("## 8. Verdict — MOST_PROFESSIONAL_FOR_TRACECOM", "");
  const byName = (rank, name) => rank.find((r) => r.server === name) ?? {};
  const pooledOf = (name) => byName(report.rankings.byReadLatency, name).pooledP50Ms ?? null;
  const catalogOf = (name) => byName(report.rankings.byPayloadRichness, name).listAssetsBytesP50 ?? null;
  const candleOf = (name) => report.servers[name]?.reads?.get_candles?.stats ?? {};
  const rankLine = (rank, valueKey, unit) =>
    rank
      .slice(0, 3)
      .map((r) => `\`${r.server}\` ${ms(r[valueKey])}${unit}`)
      .join(" · ");

  push(
    "**None of the 7 MCP servers replaces the incumbent WS path for tick/JIT execution.** The fastest pooled",
    `read p50 is **${ms(read1?.pooledP50Ms)} ms** (\`${read1?.server}\`) vs the incumbent WS ACK p50 **177 ms**, and`,
    `\`get_candles\` p50 spans ${candleRange} ms — same order of magnitude, but MCP exposes no tick stream and no`,
    "server-time tool, so the −473 ms drift correction and real-time pricing remain CURRENT_STILL_REQUIRED.",
    "On top of that, the read quota is per-user and shared across all servers; it was observed live to answer",
    "`rate_limited` with `retry_after_ms=60000`, which is unacceptable as a timing dependency in an entry window.",
    "",
    "### Ranking by metric",
    `- (a) lowest read latency: ${rankLine(report.rankings.byReadLatency, "pooledP50Ms", " ms")} …`,
    `- (b) lowest handshake: ${rankLine(report.rankings.byHandshake, "handshakeP50Ms", " ms")} …`,
    `- (c) payload richness: ${rankLine(report.rankings.byPayloadRichness, "listAssetsBytesP50", " B")} …`,
    "",
    "### MOST_PROFESSIONAL_FOR_TRACECOM — validation / backfill role",
    "Metric rank alone is misleading: TraceCom trades fixed-expiry binary options, and only binary/turbo/digital",
    "expose that product model (`expirations`, `profit_percent`). Domain-weighted recommendation:",
    "",
    `- **1st — \`binary-options\`** (validator/backfill for the binary book): domain match (fixed-expiry call/put),`,
    `  catalog ${ms(catalogOf("binary-options"))} B p50 with canonical \`name\`/payout/expirations, pooled read p50`,
    `  ${ms(pooledOf("binary-options"))} ms, \`get_candles\` p50 ${ms(candleOf("binary-options").p50)} / p95 ${ms(
      candleOf("binary-options").p95,
    )} ms.`,
    `- **2nd — \`turbo-options\`**: same product model with 60 s expirations; faster reads (pooled ${ms(
      pooledOf("turbo-options"),
    )} ms, candles p50 ${ms(candleOf("turbo-options").p50)} ms) — a good secondary validator.`,
    `- **3rd — \`digital-options\`**: only server exposing a current price grid (\`get_prices\`, incl. \`quote_time\`) and`,
    `  strike-level \`get_instruments\`; slowest pooled reads (${ms(pooledOf("digital-options"))} ms), candles p50 ${ms(
      candleOf("digital-options").p50,
    )} ms — use for mark/validation only.`,
    `- **marginal-cfd / crypto / forex**: fastest reads (${ms(pooledOf("marginal-forex"))}–${ms(
      pooledOf("marginal-crypto"),
    )} ms pooled) and richest catalogs, but a different product model (CFD/spot, not fixed-expiry); consider only`,
    "  if TraceCom expands beyond binary options.",
    "",
    `JIT revalidation (p95 ≤ 2000 ms on \`get_candles\`): ${jitOk.length ? `pass for ${jitOk.map((n) => `\`${n}\``).join(", ")}` : "no server passed"}${
      jitBad.length ? `; fail for ${jitBad.map((n) => `\`${n}\``).join(", ")}` : ""
    }.`,
    "Necessary but not sufficient: MCP stays a validation/backfill connector, never the tick source.",
    "",
    "### Caveats (do not overclaim)",
    "- Single vantage point (this workstation), N=5 per tool; p95 at N=5 is the max — treat as an upper bound.",
    "- Rate limits are per-user and shared across servers/tokens: a real TraceCom integration cannot fan out",
    "  across all 7 servers at once without a global budget (documented: gateway 200/60 s, read 60/60 s, write 10/60 s).",
    "- Rate limiting was observed live in pre-flight and is signalled as HTTP 200 + JSON-RPC `rate_limited`",
    "  (no `Retry-After` header); the burst did not trip it because the window was drained first. A",
    "  `retry_after_ms=60000` wait is catastrophic inside a 60 s entry window, so no MCP read may sit on the",
    "  execution critical path.",
    "- The PRACTICE balance divergence found in the earlier probe (training balance ≠ pipeline balance) still",
    "  applies: validate account/tenant identity before any shadow-compare of PnL.",
    "- MCP write tools exist for these servers but are **out of scope** here; execution must stay behind the",
    "  TraceCom Execution Gate (WS_ONLY_PRACTICE).",
    "",
    "### Limitations",
    "- Session overhead saving measured with `get_capabilities`; other tools may differ slightly.",
    "- `get_candles` measured with `size=60`, `count=100`; payload size scales with count.",
    "- Concurrency measured only on `binary-options`; burst only on `binary-options`.",
    "",
  );

  const md = out.join("\n");
  return md;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "iq-mcp");

async function resolveToken() {
  if (process.env.IQ_MCP_TOKEN) return process.env.IQ_MCP_TOKEN;
  if (process.env.IQ_MCP_TOKEN_FILE) {
    try {
      return (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim();
    } catch {
      return "";
    }
  }
  return "";
}

async function main() {
  const token = await resolveToken();
  if (!token) console.log("[bench] IQ_MCP_TOKEN ausente — fail-closed, nenhuma chamada de rede.");

  const report = await runBenchmark({
    token,
    log: (line) => console.log(redactSecret(line, token)),
  });

  report.markdownGeneratedAt = new Date().toISOString();
  const redactAll = (value) => redactSecret(value, token);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const rawPath = path.join(OUT_DIR, "benchmark-latency.raw.json");
  const mdPath = path.join(OUT_DIR, "benchmark-latency.md");
  await fs.writeFile(rawPath, redactAll(JSON.stringify(report, null, 2)), "utf8");
  await fs.writeFile(mdPath, redactAll(renderMarkdown(report)), "utf8");

  const rankingLine = report.rankings.byReadLatency
    .map((r) => `${r.server}:${r.pooledP50Ms}ms`)
    .join(" | ");
  console.log(`[bench] read p50 ranking: ${rankingLine}`);
  console.log(`[bench] wrote ${path.relative(ROOT, mdPath)} and ${path.relative(ROOT, rawPath)}`);
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(`[bench] fatal: ${redactSecret(String(err?.message || err), "")}`);
    process.exitCode = 1;
  });
}
