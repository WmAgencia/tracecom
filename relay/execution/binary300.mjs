export const OPERATIONAL_EXPIRY_SECONDS = 300;
export const OPERATIONAL_BUCKET_MS = OPERATIONAL_EXPIRY_SECONDS * 1000;
export const DEFAULT_MIN_LEAD_MS = 5_000;

export class ExpiryPolicyError extends Error {
  constructor(code, message = null) {
    super(message ?? code);
    this.name = "ExpiryPolicyError";
    this.code = code;
  }
}

export function assertOperationalExpiry(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value !== OPERATIONAL_EXPIRY_SECONDS) {
    throw new ExpiryPolicyError("EXPIRY_NOT_300S", `expiry ${String(seconds)} != ${OPERATIONAL_EXPIRY_SECONDS}`);
  }
  return OPERATIONAL_EXPIRY_SECONDS;
}

export function isOperationalExpiry(seconds) {
  try { assertOperationalExpiry(seconds); return true; } catch { return false; }
}

export class Binary300Timing {
  constructor({ now = () => Date.now(), minLeadMs = DEFAULT_MIN_LEAD_MS } = {}) {
    this.now = now;
    this.minLeadMs = Number.isFinite(Number(minLeadMs)) && Number(minLeadMs) >= 0 ? Number(minLeadMs) : DEFAULT_MIN_LEAD_MS;
    this.offsetMs = null;
    this.lastSyncAt = null;
    this.syncCount = 0;
  }

  syncServerTime(serverTimeMs, atMs = this.now()) {
    const value = Number(serverTimeMs);
    if (!Number.isFinite(value) || value <= 0) throw new ExpiryPolicyError("INVALID_SERVER_TIME");
    this.offsetMs = value - atMs;
    this.lastSyncAt = atMs;
    this.syncCount += 1;
    return this.offsetMs;
  }

  hasServerTime() { return this.offsetMs !== null; }

  serverNow(atMs = this.now()) {
    if (this.offsetMs === null) throw new ExpiryPolicyError("NO_SERVER_TIME");
    return atMs + this.offsetMs;
  }

  bucketStart(serverTimeMs = this.serverNow()) { return Math.floor(serverTimeMs / OPERATIONAL_BUCKET_MS) * OPERATIONAL_BUCKET_MS; }

  bucketEnd(serverTimeMs = this.serverNow()) { return this.bucketStart(serverTimeMs) + OPERATIONAL_BUCKET_MS; }

  targetExpiryAt(serverTimeMs = this.serverNow()) { return (Math.floor(serverTimeMs / OPERATIONAL_BUCKET_MS) + 1) * OPERATIONAL_BUCKET_MS; }

  deadlineAt(serverTimeMs = this.serverNow()) { return this.targetExpiryAt(serverTimeMs) - this.minLeadMs; }

  secondsToExpiry(serverTimeMs = this.serverNow()) {
    return Math.max(0, Math.round((this.targetExpiryAt(serverTimeMs) - serverTimeMs) / 1000));
  }

  snapshot() {
    return { expirySeconds: OPERATIONAL_EXPIRY_SECONDS, minLeadMs: this.minLeadMs, hasServerTime: this.hasServerTime(), offsetMs: this.offsetMs, syncCount: this.syncCount, lastSyncAt: this.lastSyncAt, expiryAt: this.hasServerTime() ? this.targetExpiryAt() : null };
  }

  canSubmit({ expirySeconds = null, serverTimeMs = null } = {}) {
    try {
      assertOperationalExpiry(expirySeconds);
    } catch (error) {
      return { ok: false, reason: error?.code ?? "EXPIRY_POLICY_ERROR", expirySeconds: null, expiryAt: null, deadlineAt: null, placedAt: null };
    }
    let t = serverTimeMs === null ? null : Number(serverTimeMs);
    if (t === null) {
      try { t = this.serverNow(); } catch (error) { return { ok: false, reason: error?.code ?? "NO_SERVER_TIME", expirySeconds: OPERATIONAL_EXPIRY_SECONDS, expiryAt: null, deadlineAt: null, placedAt: null }; }
    }
    if (!Number.isFinite(t)) return { ok: false, reason: "INVALID_SERVER_TIME", expirySeconds: OPERATIONAL_EXPIRY_SECONDS, expiryAt: null, deadlineAt: null, placedAt: null };
    const expiryAt = this.targetExpiryAt(t);
    const deadlineAt = expiryAt - this.minLeadMs;
    if (t >= deadlineAt) return { ok: false, reason: "ENTRY_WINDOW_CLOSED", expirySeconds: OPERATIONAL_EXPIRY_SECONDS, expiryAt, deadlineAt, placedAt: t };
    return { ok: true, reason: "ENTRY_WINDOW_OPEN", expirySeconds: OPERATIONAL_EXPIRY_SECONDS, expiryAt, deadlineAt, placedAt: t, secondsToExpiry: Math.round((expiryAt - t) / 1000) };
  }
}
