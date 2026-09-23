/**
 * SEGURANCA — mutacoes /api/iq/* exigem sessao de operador (cookie HttpOnly).
 *
 * Cobre: acesso anonimo (401, sem tocar o relay), cross-origin (403), metodo
 * errado em GET (405), login com chave invalida/valida, e o caminho autorizado
 * legítimo (PUT /mesas e bulk com filtro preservado + confirmZeroUniverse).
 */
import { createServer, type IncomingMessage } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/http";

const relayCalls: Array<{ method: string; path: string; headers: Record<string, unknown>; body: Record<string, unknown> }> = [];
const relayServers: Array<ReturnType<typeof createServer>> = [];
const appServers: Array<ReturnType<typeof createServer>> = [];

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => { let raw = ""; for await (const part of req) raw += part; return raw ? JSON.parse(raw) as Record<string, unknown> : {}; };

async function startRelay(): Promise<string> {
  const relay = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      const body = req.method === "GET" ? {} : await readJson(req);
      relayCalls.push({ method: req.method ?? "?", path: url.pathname, headers: { actor: req.headers["x-tracecom-actor"] ?? null, requestId: req.headers["x-request-id"] ?? null }, body });
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/api/iq/arm" && req.method === "POST") { res.statusCode = 200; res.end(JSON.stringify({ armed: true, mode: "PRACTICE" })); return; }
      if (url.pathname === "/api/iq/mesas" && req.method === "GET") { res.statusCode = 200; res.end(JSON.stringify({ rows: [], totals: { total: 0, enabled: 0 } })); return; }
      if (url.pathname === "/api/iq/mesas" && req.method === "PUT") { res.statusCode = 200; res.end(JSON.stringify({ instrument: { market_key: body?.marketKey ?? null, enabled: body?.enabled === true } })); return; }
      if (url.pathname === "/api/iq/mesas/bulk" && req.method === "POST") { res.statusCode = 200; res.end(JSON.stringify({ changed: 1, enabled: body?.enabled === true, received: body })); return; }
      if (url.pathname === "/api/iq/broker-audit" && req.method === "GET") { res.statusCode = 200; res.end(JSON.stringify({ ok: true, probe: { marketKey: url.searchParams.get("probe") ?? null, orderProbe: url.searchParams.get("orderProbe") ?? null } })); return; }
      if (url.pathname === "/api/ai/provider" && req.method === "PUT") { res.statusCode = 200; res.end(JSON.stringify({ ok: true })); return; }
      res.statusCode = 404; res.end(JSON.stringify({ error: "not_found" }));
    })();
  });
  relayServers.push(relay);
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address(); if (!address || typeof address === "string") throw new Error("relay_address_missing");
  return `http://127.0.0.1:${address.port}`;
}

async function startApp(): Promise<string> {
  const server = createServer((req, res) => { void handler(req, res); });
  appServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("app_address_missing");
  return `http://127.0.0.1:${address.port}`;
}

function cookiesFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

let appBase = "";
const previousEnv: Record<string, string | undefined> = {};
const OPERATOR_KEY = "test-operator-key-1234567890";

beforeAll(async () => {
  previousEnv.TRACECOM_LIVE_RELAY_URL = process.env.TRACECOM_LIVE_RELAY_URL;
  previousEnv.TRACECOM_LIVE_RELAY_ADMIN_SECRET = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET;
  previousEnv.TRACECOM_OPERATOR_KEY = process.env.TRACECOM_OPERATOR_KEY;
  process.env.TRACECOM_LIVE_RELAY_URL = await startRelay();
  process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET = "test-admin-secret";
  process.env.TRACECOM_OPERATOR_KEY = OPERATOR_KEY;
  appBase = await startApp();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all([...relayServers, ...appServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

afterEach(() => { relayCalls.length = 0; });

async function login(): Promise<string> {
  const response = await fetch(`${appBase}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }) });
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

describe("SEGURANCA — mutacoes /api/iq/*", () => {
  it("arm anonimo => 401 e NENHUMA chamada ao relay", async () => {
    const response = await fetch(`${appBase}/api/iq/arm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limitBrl: 10, confirmation: "ARM_PRACTICE" }) });
    expect(response.status).toBe(401);
    expect(relayCalls.length).toBe(0);
  });

  it("toggle MESAS anonimo => 401; bulk anonimo => 401; stake anonimo => 401; auto anonimo => 401", async () => {
    const putMesas = await fetch(`${appBase}/api/iq/mesas`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketKey: "EURUSD:OTC" }) });
    const postBulk = await fetch(`${appBase}/api/iq/mesas/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filter: { instrumentType: "BINARY" }, enabled: false }) });
    const postStake = await fetch(`${appBase}/api/iq/config/global-stake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: 50 }) });
    const postAuto = await fetch(`${appBase}/api/iq/config/auto-execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect([putMesas.status, postBulk.status, postStake.status, postAuto.status]).toEqual([401, 401, 401, 401]);
    expect(relayCalls.length).toBe(0);
  });

  it("token invalido/sessao expirada => 401", async () => {
    const response = await fetch(`${appBase}/api/iq/arm`, { method: "POST", headers: { "content-type": "application/json", cookie: "tc_op=9999999999.abc.assinatura-falsa" }, body: JSON.stringify({ limitBrl: 10, confirmation: "ARM_PRACTICE" }) });
    expect(response.status).toBe(401);
    expect(relayCalls.length).toBe(0);
  });

  it("cross-origin com cookie valido => 403 e sem mutacao", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/arm`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://evil.example" }, body: JSON.stringify({ limitBrl: 10, confirmation: "ARM_PRACTICE" }) });
    expect(response.status).toBe(403);
    expect(relayCalls.length).toBe(0);
  });

  it("GET privado anonimo nunca muta e exige operador: GET /api/iq/arm => 401 sem relay", async () => {
    const response = await fetch(`${appBase}/api/iq/arm`, { method: "GET" });
    expect(response.status).toBe(401);
    expect(relayCalls.length).toBe(0);
  });

  it("GETs privados anonimos => 401 (status/account/context/stats/observability) sem relay", async () => {
    const urls = ["/api/iq/status", "/api/iq/account/context", "/api/iq/strategy/stats", "/api/iq/strategy/observability"];
    for (const url of urls) {
      const response = await fetch(`${appBase}${url}`);
      expect(response.status, url).toBe(401);
    }
    expect(relayCalls.length).toBe(0);
  });

  it("mutacoes FORA de /api/iq tambem exigem operador: /api/ai/provider e /api/strategies/selection", async () => {
    const ai = await fetch(`${appBase}/api/ai/provider`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openCodeGo", apiKey: "chave-do-atacante-com-tamanho-suficiente", model: "x" }) });
    const selection = await fetch(`${appBase}/api/strategies/selection`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ family: "V3", horizonSeconds: 60, mode: "AUTO" }) });
    expect([ai.status, selection.status]).toEqual([401, 401]);
    expect(relayCalls.length).toBe(0);
  });

  it("GET broker-audit com orderProbe=1 (cria posicao) exige operador", async () => {
    const anonymous = await fetch(`${appBase}/api/iq/broker-audit?probe=EURUSD:OTC&orderProbe=1`);
    expect(anonymous.status).toBe(401);
    expect(relayCalls.length).toBe(0);
    const cookie = await login();
    const authorized = await fetch(`${appBase}/api/iq/broker-audit?probe=EURUSD:OTC&orderProbe=1`, { headers: { cookie } });
    expect(authorized.status).toBe(200);
    expect(relayCalls[0]?.method).toBe("GET");
    expect(relayCalls[0]?.headers.actor).toBe("operator");
  });

  it("sessao de PAINEL sem chave => 401 fail-closed (same-origin NAO e identidade)", async () => {
    const panel = await fetch(`${appBase}/api/auth/panel`, { method: "POST", headers: { origin: appBase, "sec-fetch-site": "same-origin" } });
    expect(panel.status).toBe(401);
    expect((panel.headers.get("set-cookie") ?? "").startsWith("tc_op=")).toBe(false);
    const status = await fetch(`${appBase}/api/iq/status`, { headers: { origin: appBase, "sec-fetch-site": "same-origin" } });
    expect(status.status).toBe(401);
    expect(relayCalls.length).toBe(0);
  });

  it("sessao de PAINEL com prova de chave (x-operator-key) => sessao valida; GET privado autenticado", async () => {
    const panel = await fetch(`${appBase}/api/auth/panel`, { method: "POST", headers: { origin: appBase, "sec-fetch-site": "same-origin", "x-operator-key": OPERATOR_KEY } });
    expect(panel.status).toBe(200);
    const cookie = cookiesFrom(panel);
    expect(cookie.startsWith("tc_op=")).toBe(true);
    const session = await fetch(`${appBase}/api/auth/session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    const body = await session.json() as Record<string, unknown>;
    expect(["operator", "panel"]).toContain(body.actor);
    const anonymous = await fetch(`${appBase}/api/auth/session`);
    expect(anonymous.status).toBe(401);
    relayCalls.length = 0;
    const mutation = await fetch(`${appBase}/api/iq/mesas`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ marketKey: "EURUSD:OTC", instrumentType: "BINARY", durationSeconds: 300, enabled: true }) });
    expect(mutation.status).toBe(200);
    expect(relayCalls.length).toBe(1);
    expect(relayCalls[0]?.method).toBe("PUT");
  });

  it("sessao de painel cross-origin => 403 (sem cookie emitido)", async () => {
    const cross = await fetch(`${appBase}/api/auth/panel`, { method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
  });

  it("TRACECOM_OPERATOR_REQUIRE_KEY nao altera o contrato: painel SEMPRE exige prova de chave; chave segue valida", async () => {
    process.env.TRACECOM_OPERATOR_REQUIRE_KEY = "true";
    try {
      const panel = await fetch(`${appBase}/api/auth/panel`, { method: "POST", headers: { origin: appBase } });
      expect(panel.status).toBe(401);
      const login = await fetch(`${appBase}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }) });
      expect(login.status).toBe(200);
      const cookie = cookiesFrom(login);
      const mutation = await fetch(`${appBase}/api/iq/arm`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ limitBrl: 10, confirmation: "ARM_PRACTICE" }) });
      expect(mutation.status).toBe(200);
    } finally {
      delete process.env.TRACECOM_OPERATOR_REQUIRE_KEY;
    }
  });

  it("login com chave errada => 401; chave certa => cookie HttpOnly/SameSite=Strict", async () => {
    const wrong = await fetch(`${appBase}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: "chave-errada" }) });
    expect(wrong.status).toBe(401);
    const right = await fetch(`${appBase}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }) });
    expect(right.status).toBe(200);
    const setCookie = right.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
  });

  it("caminho autorizado: arm com cookie chega ao relay como POST com actor/requestId", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/arm`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ limitBrl: 10, confirmation: "ARM_PRACTICE" }) });
    expect(response.status).toBe(200);
    expect(relayCalls.length).toBe(1);
    expect(relayCalls[0]?.method).toBe("POST");
    expect(relayCalls[0]?.path).toBe("/api/iq/arm");
    expect(relayCalls[0]?.headers.actor).toBe("operator");
    expect(typeof relayCalls[0]?.headers.requestId).toBe("string");
  });

  it("caminho autorizado: toggle MESAS chega ao relay como PUT (regressao do 404)", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/mesas`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ marketKey: "EURUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: true }) });
    expect(response.status).toBe(200);
    expect(relayCalls[0]?.method).toBe("PUT");
    expect(relayCalls[0]?.path).toBe("/api/iq/mesas");
  });

  it("bulk autorizado sem filtro => 400 e NENHUMA mutacao no relay", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const noFilter = await fetch(`${appBase}/api/iq/mesas/bulk`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ enabled: false }) });
    const badEnabled = await fetch(`${appBase}/api/iq/mesas/bulk`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ filter: { instrumentType: "BINARY" } }) });
    expect(noFilter.status).toBe(400);
    expect(badEnabled.status).toBe(400);
    expect(relayCalls.length).toBe(0);
  });

  it("bulk autorizado com filtro preserva filter/enabled/confirmZeroUniverse", async () => {
    const cookie = await login();
    relayCalls.length = 0;
    const response = await fetch(`${appBase}/api/iq/mesas/bulk`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ filter: { marketKey: "EURUSD:OTC", unknown: "x" }, enabled: false, confirmZeroUniverse: true }) });
    expect(response.status).toBe(200);
    expect(relayCalls[0]?.body).toMatchObject({ filter: { marketKey: "EURUSD:OTC" }, enabled: false, confirmZeroUniverse: true });
    const withoutConfirm = await fetch(`${appBase}/api/iq/mesas/bulk`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ filter: { instrumentType: "BINARY" }, enabled: false }) });
    expect(withoutConfirm.status).toBe(200);
    expect(relayCalls[1]?.body).toMatchObject({ confirmZeroUniverse: false });
  });
});
