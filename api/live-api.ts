import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildTraceTree, sanitizeHop, type Hop, type Span } from "../src/research/trace-tree.js";

type LiveSession = { id: string; createdAt: number; updatedAt: number; events: Record<string, unknown>[]; frame: Record<string, unknown> | null };
type KeyRecord = { id: string; hash: string; createdAt: number; revokedAt?: number };
const keys = new Map<string, KeyRecord>();
const sessions = new Map<string, LiveSession>();
const rate = new Map<string, { at: number; count: number }>();
const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function auth(req: IncomingMessage): KeyRecord | null {
  const value = req.headers.authorization ?? "";
  const token = value.startsWith("Bearer ") ? value.slice(7).trim() : (req.headers["x-tracecon-api-key"]?.toString() ?? "");
  if (!token) return null;
  // Vercel instances are ephemeral; a deployment-scoped token provides a
  // stable read-only integration credential without persisting secrets.
  const configured = process.env.LIVE_API_KEY?.trim();
  if (configured && configured.length === token.length && timingSafeEqual(Buffer.from(configured), Buffer.from(token))) {
    return { id: "env", hash: hash(configured), createdAt: 0 };
  }
  const h = hash(token);
  for (const record of keys.values()) if (!record.revokedAt && record.hash.length === h.length && timingSafeEqual(Buffer.from(record.hash), Buffer.from(h))) return record;
  return null;
}
function allowed(ip: string): boolean { const now = Date.now(); const x = rate.get(ip); if (!x || now - x.at >= 60_000) { rate.set(ip, { at: now, count: 1 }); return true; } x.count++; return x.count <= 120; }
function send(res: ServerResponse, status: number, value: unknown) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); }
function adminAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.LIVE_API_ADMIN_KEY?.trim();
  const supplied = req.headers["x-live-admin-key"]?.toString() ?? "";
  return Boolean(expected && supplied && expected.length === supplied.length && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)));
}
async function relay(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  if (!base) throw new Error("relay_not_configured");
  return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(12_000), headers: { "content-type": "application/json", ...(init.headers || {}) } });
}
async function relayJson(res: ServerResponse, response: Response): Promise<void> {
  const raw = await response.text();
  res.statusCode = response.status; res.setHeader("Content-Type", response.headers.get("content-type") || "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(raw);
}
const browserEventTypes = new Set(["SESSION_STARTED", "VISION_MARKET_SAMPLE", "DECISION", "COUNTDOWN", "SHADOW_UPDATE", "SETTLEMENT", "PIPELINE_ERROR", "HEARTBEAT", "SESSION_ENDED"]);
function containsSensitive(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => /password|cookie|credential|authorization|token|balance|saldo/i.test(key) || containsSensitive(nested, depth + 1));
}
async function ingestToken(sessionId: string, relayAdmin: string): Promise<string> {
  const response = await relay("/api/live/ingest-token", { method: "POST", headers: { "x-relay-admin": relayAdmin }, body: JSON.stringify({ sessionId }) });
  if (!response.ok) throw new Error("ingest_token_failed");
  const value = await response.json() as { token?: string };
  if (!value.token) throw new Error("ingest_token_missing");
  return value.token;
}
export function createLiveApiKey(): { id: string; key: string } { const key = `tc_live_${randomBytes(24).toString("base64url")}`; const id = `key_${randomUUID()}`; keys.set(id, { id, hash: hash(key), createdAt: Date.now() }); return { id, key }; }
export function revokeLiveApiKey(id: string): boolean { const k = keys.get(id); if (!k) return false; k.revokedAt = Date.now(); return true; }
export function emitLiveEvent(sessionId: string, event: Record<string, unknown>) { const s = sessions.get(sessionId); if (!s) return; s.updatedAt = Date.now(); s.events.push({ ...event, ts: Date.now() }); while (s.events.length > 500) s.events.shift(); for (const fn of listeners.get(sessionId) ?? []) fn(event); }

export async function handleLiveApi(req: IncomingMessage, res: ServerResponse, path: string, body: unknown, query: URLSearchParams): Promise<boolean> {
  if (!path.startsWith("/api/live/") && !path.startsWith("/api/debug/")) return false;
  const ip = req.socket?.remoteAddress ?? req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ?? "vercel"; if (!allowed(ip)) { send(res, 429, { error: "rate_limited" }); return true; }
  const relayAdmin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (path === "/api/live/admin/status" && req.method === "GET") {
    try { const response = await relay("/health"); const value = await response.json() as Record<string, unknown>; send(res, response.status, { ...value, relayStatus: response.ok ? "ONLINE" : "ERROR" }); }
    catch { send(res, 503, { relayStatus: "OFFLINE", db: false }); }
    return true;
  }
  if (path.startsWith("/api/live/admin/")) {
    if (!adminAuthorized(req)) { send(res, 403, { error: "admin_auth_required" }); return true; }
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    try {
      if (path === "/api/live/admin/keys" && (req.method === "GET" || req.method === "POST")) {
        const response = await relay("/api/live/keys", { method: req.method, headers: { "x-relay-admin": relayAdmin }, body: req.method === "POST" ? JSON.stringify(body || {}) : undefined }); await relayJson(res, response); return true;
      }
      const revoke = path.match(/^\/api\/live\/admin\/keys\/([^/]+)\/revoke$/);
      if (revoke && req.method === "POST") { const response = await relay(`/api/live/keys/${encodeURIComponent(revoke[1]!)}`, { method: "DELETE", headers: { "x-relay-admin": relayAdmin } }); await relayJson(res, response); return true; }
      if (path === "/api/live/admin/ingest-token" && req.method === "POST") { const response = await relay("/api/live/ingest-token", { method: "POST", headers: { "x-relay-admin": relayAdmin }, body: JSON.stringify(body || {}) }); await relayJson(res, response); return true; }
      if (path === "/api/live/admin/snapshot" && req.method === "GET") {
        const liveKey = req.headers["x-tracecon-live-key"]?.toString() || process.env.TRACECOM_LIVE_RELAY_READ_KEY || "";
        if (!liveKey) { send(res, 400, { error: "live_read_key_required" }); return true; }
        const response = await relay("/api/live/session", { headers: { authorization: `Bearer ${liveKey}` } }); await relayJson(res, response); return true;
      }
    } catch { send(res, 502, { error: "relay_unreachable" }); return true; }
    send(res, 404, { error: "admin_route_not_found" }); return true;
  }
  if (path === "/api/live/browser/ingest" && req.method === "POST") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!input || typeof input.sessionId !== "string" || !/^vision_[a-zA-Z0-9_-]{8,100}$/.test(input.sessionId) || typeof input.type !== "string" || !browserEventTypes.has(input.type) || containsSensitive(input)) { send(res, 400, { error: "invalid_browser_telemetry" }); return true; }
    try { const token = await ingestToken(input.sessionId, relayAdmin); const response = await relay("/api/live/ingest", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/live/browser/frame" && req.method === "PUT") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!input || typeof input.sessionId !== "string" || !/^vision_[a-zA-Z0-9_-]{8,100}$/.test(input.sessionId) || containsSensitive(input)) { send(res, 400, { error: "invalid_crop_frame" }); return true; }
    try { const token = await ingestToken(input.sessionId, relayAdmin); const response = await relay("/api/live/frame/latest", { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  const browserWriteTargets: Record<string, { target: string; method: string; key: string }> = {
    "/api/live/browser/logs": { target: "logs", method: "POST", key: "logs" },
    "/api/live/browser/agent-runs": { target: "agent-runs", method: "PUT", key: "runs" },
    "/api/live/browser/spans": { target: "spans", method: "POST", key: "spans" },
    "/api/live/browser/network-hops": { target: "network-hops", method: "POST", key: "hops" },
    "/api/live/browser/state-transitions": { target: "state-transitions", method: "POST", key: "transitions" },
    "/api/live/browser/provenance": { target: "decision-provenance", method: "POST", key: "provenance" },
  };
  const browserWrite = browserWriteTargets[path];
  if (browserWrite && req.method === "POST") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!input || typeof input.sessionId !== "string" || !/^vision_[a-zA-Z0-9_-]{8,100}$/.test(input.sessionId) || containsSensitive(input)) { send(res, 400, { error: "invalid_diagnostics" }); return true; }
    const rows = input[browserWrite.key];
    if (Array.isArray(rows) && rows.length > 200) { send(res, 413, { error: "diagnostics_batch_too_large" }); return true; }
    try {
      const token = await ingestToken(input.sessionId, relayAdmin);
      const isSessionScoped = browserWrite.target === "logs" || browserWrite.target === "agent-runs";
      const target = isSessionScoped ? `/api/live/sessions/${encodeURIComponent(input.sessionId)}/${browserWrite.target}` : `/api/debug/${browserWrite.target}`;
      const response = await relay(target, { method: browserWrite.method, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
      await relayJson(res, response);
    } catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  const bundlePost = path.match(/^\/api\/live\/sessions\/([^/]+)\/diagnostic-bundle$/);
  if (bundlePost && req.method === "POST") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const sessionId = decodeURIComponent(bundlePost[1]!);
    const getAdmin = async (suffix: string) => { try { const response = await relay(`/api/live/sessions/${encodeURIComponent(sessionId)}/${suffix}`, { headers: { "x-relay-admin": relayAdmin } }); return response.ok ? await response.json() : null; } catch { return null; } };
    const [timeline, logs, runs, stateHistory, provenance] = await Promise.all([getAdmin("timeline"), getAdmin("logs"), getAdmin("agent-runs"), getAdmin("state-history"), getAdmin("decision-provenance")]);
    send(res, 200, {
      bundle: { sessionId, generatedAt: Date.now(), timeline, logs, agentRuns: runs, stateHistory, provenance,
        frameRefs: { policy: "sanitized-crop-only", desktopExported: false },
        versions: { apiVersion: "vision-observation-fable-text-v1", thresholdVersion: "profiles-experimental-v1", settlementPolicy: "settleTrade-v1", promptVersion: "sanitized-crop-base64-v1" },
        configSummary: { candleSeconds: 5, visibleWindowSeconds: 900, predictionHorizonSeconds: 60, entryWindowSeconds: 10 }, secrets: "omitted" },
      brokerAutomation: "NONE",
    });
    return true;
  }
  const sessionReadProxy = path.match(/^\/api\/live\/sessions\/([^/]+)\/(state-history|decision-provenance)$/);
  if (sessionReadProxy && req.method === "GET") {
    const token = req.headers.authorization?.toString() || "";
    try { const response = await relay(`/api/live/sessions/${encodeURIComponent(sessionReadProxy[1]!)}/${sessionReadProxy[2]}${query.toString() ? `?${query}` : ""}`, { headers: token ? { authorization: token } : { "x-relay-admin": relayAdmin ?? "" } }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path.startsWith("/api/shadow/jobs") && req.method === "GET") {
    const token = req.headers.authorization?.toString() || "";
    try { const response = await relay(`${path}${query.toString() ? `?${query}` : ""}`, { headers: token ? { authorization: token } : { "x-relay-admin": relayAdmin ?? "" } }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  const sessionDebugRead = path.match(/^\/api\/live\/sessions\/([^/]+)\/(logs|agent-runs(?:\/[^/]+)?|timeline|debug-snapshot)$/);
  if (sessionDebugRead && req.method === "GET") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const token = req.headers.authorization?.toString() || "";
    try {
      const suffix = query.toString() ? `?${query}` : "";
      const response = await relay(`/api/live/sessions/${encodeURIComponent(sessionDebugRead[1]!)}/${sessionDebugRead[2]}${suffix}`, { headers: { authorization: token } });
      await relayJson(res, response);
    } catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/debug/agents" && req.method === "GET") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    try { const response = await relay("/api/debug/agents", { headers: { "x-relay-admin": relayAdmin } }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  const debugAgentDetail = path.match(/^\/api\/debug\/agents\/([^/]+)$/);
  if (debugAgentDetail && req.method === "GET") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    try { const response = await relay(`/api/debug/agents/${encodeURIComponent(debugAgentDetail[1]!)}`, { headers: { "x-relay-admin": relayAdmin } }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  const debugRunDetail = path.match(/^\/api\/debug\/agent-runs\/([^/]+)$/);
  if (debugRunDetail && req.method === "GET") {
    const token = req.headers.authorization?.toString() || "";
    try { const response = await relay(`/api/debug/agent-runs/${encodeURIComponent(debugRunDetail[1]!)}`, { headers: token ? { authorization: token } : { "x-relay-admin": relayAdmin ?? "" } }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/debug/config" && req.method === "GET") {
    const secretPresent = (name: string) => Boolean(process.env[name] && String(process.env[name]).trim());
    send(res, 200, {
      profileThresholds: { CONSERVATIVE: "EXPERIMENTAL", BALANCED: "EXPERIMENTAL", AGGRESSIVE: "EXPERIMENTAL" },
      featureFlags: { multiAgentMode: process.env.MULTI_AGENT_MODE || "TEXT_SPECIALISTS", visionEnabled: process.env.TRACECOM_VISION_ENABLED !== "false", fableMode: "text-only" },
      timeouts: { fableTimeoutMs: Number(process.env.FABLE_TIMEOUT_MS) || 12_000, fastDeadlineMs: 5_000, priceTimeoutMs: 3_000 },
      windows: { candleSeconds: 5, visibleWindowSeconds: 900, predictionHorizonSeconds: 60, entryWindowSeconds: 10, confirmationWindowSeconds: 20 },
      outlier: { maxRelativeDeviation: Number(process.env.PRICE_OUTLIER_MAX_DEVIATION) || .005, madGate: true },
      scheduler: { deepIntervalMs: 30_000, oneInFlight: true, latestStateWins: true },
      agents: { specialists: ["PRICE_ACTION", "CANDLE_MOMENTUM", "QUANT_GEOMETRY", "RISK_CONTRARIAN"], advocates: ["BULL_ADVOCATE", "BEAR_ADVOCATE"], fusion: true, arbiter: true },
      models: { vision: process.env.TRACECOM_VISION_MODEL || "claude-opus-5", fable: process.env.FABLE_MODEL || "claude-fable-5-1" },
      versions: { apiVersion: "vision-observation-fable-text-v1", settlementPolicy: "settleTrade-v1", promptVersions: { vision: "sanitized-crop-base64-v1", fable: "vision-observation-fable-text-v1" }, calibration: "empirical-buckets-v1" },
      rateLimits: { stream: 20, frame: 30, ingest: 240, keys: 60, default: 60 },
      secrets: { nexxusApiKey: { secretPresent: secretPresent("NEXXUS_API_KEY") }, fableApiKey: { secretPresent: secretPresent("FABLE_API_KEY") }, relayAdmin: { secretPresent: secretPresent("TRACECOM_LIVE_RELAY_ADMIN_SECRET") }, database: { secretPresent: secretPresent("DATABASE_URL") } },
    });
    return true;
  }
  const traceRead = path.match(/^\/api\/debug\/traces\/([^/]+)$/);
  if (traceRead && req.method === "GET") {
    if (!relayAdmin) { send(res, 503, { error: "relay_admin_not_configured" }); return true; }
    const token = req.headers.authorization?.toString() || "";
    try {
      const response = await relay(`/api/debug/traces/${encodeURIComponent(traceRead[1]!)}/spans`, { headers: token ? { authorization: token } : { "x-relay-admin": relayAdmin } });
      if (!response.ok) { await relayJson(res, response); return true; }
      const data = await response.json() as { spans?: Span[]; hops?: Hop[] };
      send(res, 200, buildTraceTree(data.spans ?? [], (data.hops ?? []).map(sanitizeHop)));
    } catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/live/relay/ingest" && req.method === "POST") {
    const token = req.headers.authorization?.toString() || "";
    try { const response = await relay("/api/live/ingest", { method: "POST", headers: { authorization: token }, body: JSON.stringify(body || {}) }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/live/relay/frame/latest" && (req.method === "GET" || req.method === "PUT")) {
    const token = req.headers.authorization?.toString() || "";
    try { const response = await relay(`/api/live/frame/latest${query.toString() ? `?${query}` : ""}`, { method: req.method, headers: { authorization: token }, body: req.method === "PUT" ? JSON.stringify(body || {}) : undefined }); await relayJson(res, response); }
    catch { send(res, 502, { error: "relay_unreachable" }); }
    return true;
  }
  if (path === "/api/live/keys" && req.method === "POST") {
    const admin = process.env.LIVE_API_ADMIN_KEY?.trim(); const supplied = req.headers["x-live-admin-key"]?.toString() ?? "";
    if (!admin || supplied !== admin) { send(res, 403, { error: "admin_auth_required" }); return true; }
    send(res, 201, createLiveApiKey()); return true;
  }
  const key = auth(req); if (!key) { send(res, 401, { error: "invalid_live_api_key" }); return true; }
  const match = path.match(/^\/api\/live\/session(?:\/([^/]+))?(?:\/(stream|frame\/latest|export))?$/);
  if (!match) { send(res, 404, { error: "live_route_not_found" }); return true; }
  let session = match[1] ? sessions.get(match[1]) : undefined;
  if (req.method === "POST" && !match[1]) { const id = `live_${randomUUID()}`; session = { id, createdAt: Date.now(), updatedAt: Date.now(), events: [], frame: null }; sessions.set(id, session); send(res, 201, { id, status: "ACTIVE", readOnly: true }); return true; }
  if (!session) { send(res, 404, { error: "live_session_not_found" }); return true; }
  const action = match[2];
  if (action === "frame/latest" && req.method === "PUT") {
    if (!body || typeof body !== "object" || Array.isArray(body)) { send(res, 400, { error: "invalid_frame" }); return true; }
    const input = body as Record<string, unknown>; if (typeof input.imageData === "string" || typeof input.dataUrl === "string") { send(res, 400, { error: "crop_only_frame_required" }); return true; }
    session.frame = { ...input, receivedAt: Date.now(), cropOnly: true }; emitLiveEvent(session.id, { type: "FRAME_UPDATED", frame: session.frame }); send(res, 200, { ok: true, cropOnly: true, receivedAt: session.frame.receivedAt }); return true;
  }
  if (action === "stream" && req.method === "GET") {
    res.statusCode = 200; res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-store"); res.setHeader("Connection", "keep-alive"); res.write(`event: ready\ndata: ${JSON.stringify({ sessionId: session.id, readOnly: true })}\n\n`);
    const fn = (event: Record<string, unknown>) => { if (!res.writableEnded) res.write(`event: ${String(event.type ?? "update").toLowerCase()}\ndata: ${JSON.stringify(event)}\n\n`); }; const set = listeners.get(session.id) ?? new Set(); set.add(fn); listeners.set(session.id, set);
    req.on("close", () => { set.delete(fn); }); return true;
  }
  if (action === "export" && req.method === "GET") { send(res, 200, { sessionId: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, events: session.events, latestFrame: session.frame, exportVersion: "live-readonly-v1" }); return true; }
  if (!action && req.method === "GET") { send(res, 200, { id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, status: "ACTIVE", readOnly: true, eventCount: session.events.length, latestFrame: session.frame }); return true; }
  send(res, 405, { error: "method_not_allowed" }); return true;
}
