import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

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
export function createLiveApiKey(): { id: string; key: string } { const key = `tc_live_${randomBytes(24).toString("base64url")}`; const id = `key_${randomUUID()}`; keys.set(id, { id, hash: hash(key), createdAt: Date.now() }); return { id, key }; }
export function revokeLiveApiKey(id: string): boolean { const k = keys.get(id); if (!k) return false; k.revokedAt = Date.now(); return true; }
export function emitLiveEvent(sessionId: string, event: Record<string, unknown>) { const s = sessions.get(sessionId); if (!s) return; s.updatedAt = Date.now(); s.events.push({ ...event, ts: Date.now() }); while (s.events.length > 500) s.events.shift(); for (const fn of listeners.get(sessionId) ?? []) fn(event); }

export async function handleLiveApi(req: IncomingMessage, res: ServerResponse, path: string, body: unknown, query: URLSearchParams): Promise<boolean> {
  if (!path.startsWith("/api/live/")) return false;
  const ip = req.socket.remoteAddress ?? "unknown"; if (!allowed(ip)) { send(res, 429, { error: "rate_limited" }); return true; }
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
