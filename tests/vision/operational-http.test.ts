import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import handler from "../../api/http";

const servers: Array<ReturnType<typeof createServer>> = [];
async function endpoint() {
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("test_server_missing_address");
  return `http://127.0.0.1:${address.port}`;
}
async function post(base: string, path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe("operational HTTP paper channel", () => {
  it("uses persisted operational state instead of trusting a stale serverless cache", () => {
    const source = readFileSync("api/http.ts", "utf8");
    expect(source).toContain("const operationalController = async");
    expect(source).not.toContain("operationalSessions.get(operationalSessionId) ?? new OperationalController()");
  });

  it("locks, settles and exposes a session snapshot without any broker action", async () => {
    const base = await endpoint(); const sessionId = `operational-http-${Date.now()}`;
    const locked = await post(base, "/api/operational/lock", { sessionId, signalId: "s-http", idempotencyKey: "key-http", direction: "BUY", originSymbol: "USD/CAD (OTC)", now: 1_000, countdownMs: 10_000, horizonMs: 60_000 });
    expect(locked.status).toBe(200); expect(locked.body).toMatchObject({ shadowOnly: true, brokerAutomation: "NONE", state: "SIGNAL_LOCKED" });
    const duplicate = await post(base, "/api/operational/lock", { sessionId, signalId: "s-http", idempotencyKey: "key-http", direction: "BUY", originSymbol: "USD/CAD (OTC)", now: 1_001, countdownMs: 1, horizonMs: 1 });
    expect(duplicate.body).toMatchObject({ metrics: { locked: 1, duplicateRequests: 1 } });
    const entry = await post(base, "/api/operational/entry", { sessionId, signalId: "s-http", price: 1.2, timestamp: 11_000, symbol: "USD/CAD (OTC)" });
    expect(entry.status).toBe(200); expect(entry.body).toMatchObject({ state: "POSITION_CONFIRMED", signal: { entryPrice: 1.2, direction: "BUY" } });
    const settled = await post(base, "/api/operational/settle", { sessionId, signalId: "s-http", price: 1.3, timestamp: 71_000, symbol: "USD/CAD (OTC)" });
    expect(settled.status).toBe(200); expect(settled.body).toMatchObject({ state: "SETTLED", signal: { outcome: "WIN", settlementReason: "DIRECTIONAL_MOVE" } });
    const snapshot = await fetch(`${base}/api/operational/${encodeURIComponent(sessionId)}`);
    expect(await snapshot.json()).toMatchObject({ sessionId, shadowOnly: true, brokerAutomation: "NONE", metrics: { WIN: 1, settled: 1 } });
    const events = await fetch(`${base}/api/operational/${encodeURIComponent(sessionId)}/events?after=2`);
    expect(await events.json()).toMatchObject({ sessionId, after: 2, cursor: 4, events: [{ sequence: 3 }, { sequence: 4 }], brokerAutomation: "NONE" });
  });

  it("fails closed on cross-symbol settlement rather than mixing feeds", async () => {
    const base = await endpoint(); const sessionId = `operational-cross-${Date.now()}`;
    await post(base, "/api/operational/lock", { sessionId, signalId: "s-cross", idempotencyKey: "key-cross", direction: "SELL", originSymbol: "USD/CAD (OTC)", now: 1_000, countdownMs: 0, horizonMs: 60_000 });
    await post(base, "/api/operational/entry", { sessionId, signalId: "s-cross", price: 1.2, timestamp: 1_000, symbol: "USD/CAD (OTC)" });
    const settled = await post(base, "/api/operational/settle", { sessionId, signalId: "s-cross", price: 1.1, timestamp: 61_000, symbol: "EUR/USD (OTC)" });
    expect(settled.status).toBe(200); expect(settled.body).toMatchObject({ signal: { outcome: "UNKNOWN", settlementReason: "SYMBOL_MISMATCH" }, brokerAutomation: "NONE" });
  });
});
