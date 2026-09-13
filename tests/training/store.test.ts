import { describe, expect, it } from "vitest";
import { TrainingStore } from "../../src/training/store";
import { createTrainingSession } from "../../src/training/session";

/** Fake relay that keeps rows so two independent store instances (cold starts)
 * can read the same durable state. */
function fakeRelay() {
  const rows = new Map<string, unknown>();
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = String(input); const method = init?.method ?? "GET";
    const id = decodeURIComponent(url.split("/api/training/sessions/")[1] ?? "");
    if (method === "GET") return rows.has(id) ? new Response(JSON.stringify({ session: rows.get(id) }), { status: 200 }) : new Response(JSON.stringify({ error: "training_session_not_found" }), { status: 404 });
    if (method === "PUT") { const body = JSON.parse(String(init?.body)) as { session: unknown }; rows.set(id, body.session); return new Response(JSON.stringify({ stored: true }), { status: 200 }); }
    return new Response("bad", { status: 400 });
  }) as unknown as typeof fetch;
  return { rows, fetchImpl };
}

describe("durable training store", () => {
  it("survives a cold start: write on one instance, read on another", async () => {
    const relay = fakeRelay();
    const instanceA = new TrainingStore({ relayUrl: "https://relay.test", adminSecret: "test", fetchImpl: relay.fetchImpl });
    const instanceB = new TrainingStore({ relayUrl: "https://relay.test", adminSecret: "test", fetchImpl: relay.fetchImpl });
    const session = createTrainingSession({ id: "training_cold_start", symbol: "USD/CAD" });
    await instanceA.write(session);
    expect(instanceA.mode()).toBe("DURABLE_RELAY");
    expect(session.persistence).toBe("DURABLE_RELAY");
    const recovered = await instanceB.read("training_cold_start");
    expect(recovered?.id).toBe("training_cold_start");
    expect(recovered?.persistence).toBe("DURABLE_RELAY");
  });

  it("returns null for a truly missing session without masking with memory", async () => {
    const relay = fakeRelay();
    const store = new TrainingStore({ relayUrl: "https://relay.test", adminSecret: "test", fetchImpl: relay.fetchImpl });
    expect(await store.read("training_missing")).toBeNull();
  });

  it("falls back to memory only when the relay is not configured", async () => {
    const store = new TrainingStore({});
    const session = createTrainingSession({ id: "training_local" });
    await store.write(session);
    expect(store.mode()).toBe("LOCAL_MEMORY");
    expect((await store.read("training_local"))?.id).toBe("training_local");
  });
});
