/** Signed admin session cookie (HttpOnly) derived from the existing admin
 * credential. No new secrets: the admin secret itself is the HMAC key. */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "tc_admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

function sign(adminSecret: string, payload: string): string {
  return createHmac("sha256", adminSecret).update(payload).digest("base64url");
}

export function issueAdminSession(adminSecret: string, now = Date.now(), ttlMs = ADMIN_SESSION_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ttlMs })).toString("base64url");
  return `${payload}.${sign(adminSecret, payload)}`;
}

export function verifyAdminSession(adminSecret: string, token: string | undefined | null, now = Date.now()): boolean {
  if (!adminSecret || !token) return false;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return false;
  const expected = sign(adminSecret, payload);
  if (expected.length !== signature.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return Number(value.exp) > now;
  } catch { return false; }
}

/** Auto-authorization gate for the panel: the session cookie is only issued to
 * same-origin browser POSTs. No manual credential is ever typed in the UI.
 * Anonymous non-browser callers (no Origin) stay rejected. */
export function sameOriginAllowed(input: { origin?: string | null; host?: string | null; fetchSite?: string | null; allowedOrigins: string[] }): boolean {
  const site = String(input.fetchSite ?? "").toLowerCase();
  if (site && site !== "same-origin" && site !== "same-site") return false;
  const origin = String(input.origin ?? "").replace(/\/$/, "");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (input.host && url.host === input.host) return true;
  } catch { return false; }
  return input.allowedOrigins.includes(origin);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function adminCookieHeader(token: string, ttlMs = ADMIN_SESSION_TTL_MS): string {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/live; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

export function clearAdminCookieHeader(): string {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/live; Max-Age=0`;
}
