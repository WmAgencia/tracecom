/** Durable training-session store.
 *
 * Vercel functions are ephemeral: a session created on one instance must be
 * readable from any other instance or after a cold start. When the live relay
 * (PostgreSQL) is configured, it is the source of truth; the in-process map is
 * only a best-effort fallback so local development keeps working.
 */
import type { TrainingSession } from "./session.js";

type StoreOptions = {
  relayUrl?: string | null;
  adminSecret?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class TrainingStore {
  private readonly memory = new Map<string, TrainingSession>();
  constructor(private readonly options: StoreOptions = {}) {}

  mode(): "DURABLE_RELAY" | "MEMORY_FALLBACK" | "LOCAL_MEMORY" {
    if (this.remote()) return "DURABLE_RELAY";
    return this.options.fetchImpl ? "MEMORY_FALLBACK" : "LOCAL_MEMORY";
  }

  private remote(): { base: string; admin: string } | null {
    const base = this.options.relayUrl?.replace(/\/$/, "");
    const admin = this.options.adminSecret?.trim();
    return base && admin ? { base, admin } : null;
  }

  private request(remote: { base: string; admin: string }, path: string, init: RequestInit): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    return fetchImpl(`${remote.base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      headers: { "content-type": "application/json", "x-relay-admin": remote.admin, ...(init.headers || {}) },
    }) as Promise<Response>;
  }

  async read(id: string): Promise<TrainingSession | null> {
    const remote = this.remote();
    if (remote) {
      try {
        const response = await this.request(remote, `/api/training/sessions/${encodeURIComponent(id)}`, { method: "GET" });
        if (response.status === 404) return null;
        if (response.ok) {
          const value = await response.json() as { session?: TrainingSession };
          const session = value.session ?? null;
          if (session) { session.persistence = "DURABLE_RELAY"; this.memory.set(id, session); return session; }
        }
      } catch { /* fall through to the local fallback */ }
    }
    const local = this.memory.get(id) ?? null;
    if (local) local.persistence = "MEMORY_FALLBACK";
    return local;
  }

  async write(session: TrainingSession): Promise<void> {
    const remote = this.remote();
    if (remote) {
      try {
        const response = await this.request(remote, `/api/training/sessions/${encodeURIComponent(session.id)}`, { method: "PUT", body: JSON.stringify({ session }) });
        if (response.ok) { session.persistence = "DURABLE_RELAY"; this.memory.set(session.id, session); return; }
      } catch { /* fall through to the local fallback */ }
    }
    session.persistence = "MEMORY_FALLBACK";
    this.memory.set(session.id, session);
  }
}
