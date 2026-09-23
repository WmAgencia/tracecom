/**
 * A11 — o edge so repassa query params SANITIZADOS para os endpoints de estrategia.
 * Nenhuma query bruta: version/strategyHash por formato, days clampado, extras descartados.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/http";

const relayCalls: Array<{ path: string; query: Record<string, string>; admin: string | null }> = [];
const relayServers: Array<ReturnType<typeof createServer>> = [];
const appServers: Array<ReturnType<typeof createServer>> = [];
const OPERATOR_KEY = "test-operator-key-proxy-params";

beforeAll(async () => {
  process.env.TRACECOM_OPERATOR_KEY = OPERATOR_KEY;
  const relay = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");
    relayCalls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), admin: (req.headers["x-relay-admin"] as string) ?? null });
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });
  relayServers.push(relay);
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const relayAddress = relay.address(); if (!relayAddress || typeof relayAddress === "string") throw new Error("relay_address_missing");
  process.env.TRACECOM_LIVE_RELAY_URL = `http://127.0.0.1:${relayAddress.port}`;
  process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET = "test-admin-secret";
  const app = createServer((req, res) => { void handler(req, res); });
  appServers.push(app);
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const appAddress = app.address(); if (!appAddress || typeof appAddress === "string") throw new Error("app_address_missing");
  appBase = `http://127.0.0.1:${appAddress.port}`;
});

let appBase = "";
const previousEnv: Record<string, string | undefined> = {};
afterAll(async () => {
  for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await Promise.all([...relayServers, ...appServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function login(): Promise<string> {
  const response = await fetch(`${appBase}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }) });
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("A11 — proxy de query params (stats/observability)", () => {
  it("anonimo => 401 e nenhuma chamada ao relay", async () => {
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/strategy/observability?days=30`);
    expect(response.status).toBe(401);
    expect(relayCalls.length).toBe(0);
  });

  it("params validos sao repassados; extras/brutos sao descartados", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const hostile = "?version=PULLBACK_4060_300_AGENTIC_V2&strategyHash=sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0&days=99999&accountContext=REAL&limit=999999&raw=%3Cscript%3E";
    const response = await fetch(`${appBase}/api/iq/strategy/observability${hostile}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(relayCalls.length).toBe(1);
    const call = relayCalls[0]!;
    expect(call.path).toBe("/api/iq/strategy/observability");
    expect(call.query.version).toBe("PULLBACK_4060_300_AGENTIC_V2");
    expect(call.query.strategyHash).toBe("sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0");
    expect(call.query.days).toBe("365");
    expect(call.query.accountContext).toBeUndefined();
    expect(call.query.limit).toBeUndefined();
    expect(call.query.raw).toBeUndefined();
  });

  it("version/hash com formato invalido sao descartados (nunca injetados)", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/strategy/stats?version=..%2F..%2Fetc%2Fpasswd%20&strategyHash=${encodeURIComponent("<img src=x onerror=1>")}&days=abc`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const call = relayCalls[0]!;
    expect(call.path).toBe("/api/iq/strategy/stats");
    expect(call.query.version).toBeUndefined();
    expect(call.query.strategyHash).toBeUndefined();
    expect(call.query.days).toBe("30");
  });

  it("days e clampado no piso (1) e no teto (365)", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    await fetch(`${appBase}/api/iq/strategy/stats?days=-7`, { headers: { cookie } });
    await fetch(`${appBase}/api/iq/strategy/stats?days=100000`, { headers: { cookie } });
    expect(relayCalls[0]?.query.days).toBe("1");
    expect(relayCalls[1]?.query.days).toBe("365");
  });

  it("relay admin secret nunca vaza na resposta", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/strategy/observability?days=7`, { headers: { cookie } });
    const body = await response.text();
    expect(body).not.toContain("test-admin-secret");
    expect(relayCalls[0]?.admin).toBe("test-admin-secret");
  });
});
