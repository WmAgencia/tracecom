import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import handler from "../../api/http.js";

class MockRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket = { remoteAddress: "127.0.0.1" };
  chunks: Buffer[];

  constructor({ method = "GET", url, headers = {}, body = "" }: { method?: string; url: string; headers?: Record<string, string>; body?: string }) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.chunks = body ? [Buffer.from(body)] : [];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    for (const chunk of this.chunks) yield chunk;
  }
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string | string[]> = {};
  body = "";

  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  end(chunk?: unknown): void {
    if (chunk !== undefined) this.body += String(chunk);
  }

  json(): Record<string, unknown> | null {
    try { return JSON.parse(this.body) as Record<string, unknown>; } catch { return null; }
  }
}

const call = async (request: MockRequest): Promise<{ status: number; body: Record<string, unknown> | null; setCookie: string | null }> => {
  const response = new MockResponse();
  await handler(request as never, response as never);
  const cookie = (response.headers["set-cookie"] as string | undefined) ?? null;
  return { status: response.statusCode, body: response.json(), setCookie: cookie };
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.OPERATOR_KEY = process.env.TRACECOM_OPERATOR_KEY;
  saved.ADMIN_KEY = process.env.LIVE_API_ADMIN_KEY;
  saved.SIGNING = process.env.TOKEN_SIGNING_SECRET;
  saved.RELAY = process.env.TRACECOM_LIVE_RELAY_URL;
  saved.RELAY_ADMIN = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET;
  process.env.TRACECOM_OPERATOR_KEY = "test-operator-key-123456";
  delete process.env.LIVE_API_ADMIN_KEY;
  delete process.env.TOKEN_SIGNING_SECRET;
  delete process.env.TRACECOM_LIVE_RELAY_URL;
  delete process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET;
});

afterEach(() => {
  for (const [key, value] of Object.entries({ TRACECOM_OPERATOR_KEY: saved.OPERATOR_KEY, LIVE_API_ADMIN_KEY: saved.ADMIN_KEY, TOKEN_SIGNING_SECRET: saved.SIGNING, TRACECOM_LIVE_RELAY_URL: saved.RELAY, TRACECOM_LIVE_RELAY_ADMIN_SECRET: saved.RELAY_ADMIN })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("edge HTTP — rotas privadas anonimas", () => {
  const privateGets = ["/api/iq/strategy/observability", "/api/iq/intelligence", "/api/iq/real/preflight", "/api/iq/agents/log", "/api/iq/lab/status", "/api/iq/research/scoreboard"];

  it.each(privateGets)("GET %s anonimo -> 401", async (url) => {
    const result = await call(new MockRequest({ method: "GET", url }));
    expect(result.status).toBe(401);
    expect(result.body?.error).toBe("operator_auth_required");
  });

  const panelPublicGets = ["/api/iq/status", "/api/iq/intelligence/assets", "/api/iq/strategy/stats", "/api/iq/performance", "/api/iq/candles?keys=EURUSD:OTC&limit=10", "/api/iq/executions?accountContext=PRACTICE&limit=10", "/api/iq/v3/status", "/api/iq/v3/opportunities?limit=10", "/api/iq/mesas", "/api/iq/account/context"];

  it.each(panelPublicGets)("GET painel %s anonimo NAO exige operador", async (url) => {
    const result = await call(new MockRequest({ method: "GET", url }));
    expect(result.status).not.toBe(401);
    expect(result.body?.error).not.toBe("operator_auth_required");
  });

  const privateMutations: Array<[string, string]> = [
    ["/api/iq/connect", JSON.stringify({ email: "x@y.z", password: "senha" })],
    ["/api/iq/disconnect", "{}"],
    ["/api/iq/test-order", JSON.stringify({ marketKey: "EURUSD:OTC", direction: "BUY", stake: 2 })],
    ["/api/iq/verify-2fa", JSON.stringify({ code: "123456" })],
    ["/api/iq/mesas/bulk", JSON.stringify({ filter: { instrumentType: "BINARY" }, enabled: false })],
    ["/api/ai/provider", JSON.stringify({ provider: "groq", apiKey: "chave-bem-longa", model: "x" })],
    ["/api/strategies/selection", JSON.stringify({ family: "V3" })],
    ["/api/iq/mcp/config", JSON.stringify({ token: "abc" })],
  ];

  it.each(privateMutations)("POST %s anonimo -> 401", async (url, body) => {
    const result = await call(new MockRequest({ method: "POST", url, headers: { "content-type": "application/json" }, body }));
    expect(result.status).toBe(401);
    expect(result.body?.error).toBe("operator_auth_required");
  });

  it("mesma origem (Origin + Sec-Fetch-Site) NAO cria sessao nem autoriza rota privada", async () => {
    const headers = { origin: "https://tracecom.consecom.com.br", host: "tracecom.consecom.com.br", "sec-fetch-site": "same-origin" };
    const panel = await call(new MockRequest({ method: "POST", url: "/api/auth/panel", headers, body: "{}" }));
    expect(panel.status).toBe(401);
    expect(panel.body?.error).toBe("operator_key_required");
    expect(panel.setCookie).toBeNull();
    const status = await call(new MockRequest({ method: "GET", url: "/api/iq/strategy/observability", headers }));
    expect(status.status).toBe(401);
  });
});

describe("edge HTTP — panel/operator com chave", () => {
  it("panel com chave errada -> 401 sem cookie", async () => {
    const result = await call(new MockRequest({ method: "POST", url: "/api/auth/panel", headers: { "x-operator-key": "errada" }, body: "{}" }));
    expect(result.status).toBe(401);
    expect(result.setCookie).toBeNull();
  });

  it("panel com chave correta -> 200 com cookie HttpOnly; GET privado passa a autenticar", async () => {
    const panel = await call(new MockRequest({ method: "POST", url: "/api/auth/panel", headers: { "x-operator-key": "test-operator-key-123456" }, body: "{}" }));
    expect(panel.status).toBe(200);
    expect(panel.setCookie).toContain("tc_op=");
    expect(panel.setCookie).toContain("HttpOnly");
    const cookie = String(panel.setCookie).split(";")[0] ?? "";
    const status = await call(new MockRequest({ method: "GET", url: "/api/iq/status", headers: { cookie } }));
    expect(status.status).not.toBe(401);
    expect(status.body?.error).not.toBe("operator_auth_required");
  });

  it("chave correta via /api/auth/operator tambem abre sessao", async () => {
    const login = await call(new MockRequest({ method: "POST", url: "/api/auth/operator", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: "test-operator-key-123456" }) }));
    expect(login.status).toBe(200);
    expect(login.setCookie).toContain("tc_op=");
  });

  it("sem chave configurada no servidor -> 503 fail-closed (panel e rotas privadas)", async () => {
    delete process.env.TRACECOM_OPERATOR_KEY;
    const panel = await call(new MockRequest({ method: "POST", url: "/api/auth/panel", headers: { "x-operator-key": "qualquer" }, body: "{}" }));
    expect(panel.status).toBe(503);
    expect(panel.body?.error).toBe("operator_auth_not_configured");
    const status = await call(new MockRequest({ method: "GET", url: "/api/iq/strategy/observability" }));
    expect(status.status).toBe(503);
  });
});
