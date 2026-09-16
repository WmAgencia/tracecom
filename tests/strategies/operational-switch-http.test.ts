/** E2E CRITICO — selecao manual REALMENTE muda o agente operacional.
 * Fluxo exercitado: UI (PUT /api/strategies/selection) → API → relay (fake persistente) → runtime
 * (gate do /api/operational/lock) → decisao operacional. Cenario A/B/C da missao.
 */
import { createServer, type IncomingMessage } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/http";

const HASHES: Record<string, string> = { V1: "70a7bfcb568bec8c", V2: "6f8b9001c63b7597", V3: "acf733a866146537", V8: "712373de3372e158" };

interface RelayState {
  selection: { mode: string; family: string; horizon_seconds: number; entry_logic_hash: string; variant_id: string; reason: string; updated_at: string };
  signals: Array<Record<string, unknown>>;
}

const state: RelayState = {
  selection: { mode: "MANUAL", family: "V3", horizon_seconds: 60, entry_logic_hash: HASHES.V3 as string, variant_id: "V3-60", reason: "test", updated_at: new Date().toISOString() },
  signals: [],
};

function signal(family: string, horizon: number, direction: string) {
  const now = Date.now();
  return { family, horizon_seconds: horizon, direction, signal_bucket: now - 1000, entry_price: 1.1, entry_timestamp: now - 200, strategy_hash: HASHES[family] };
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => { let raw = ""; for await (const part of req) raw += part; return raw ? JSON.parse(raw) as Record<string, unknown> : {}; };

const relayServers: Array<ReturnType<typeof createServer>> = [];
const appServers: Array<ReturnType<typeof createServer>> = [];
const operationalSnapshots = new Map<string, Record<string, unknown>>();

async function startRelay(): Promise<string> {
  const relay = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      res.setHeader("content-type", "application/json");
      const reply = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
      if (url.pathname === "/api/strategies/selection" && req.method === "GET") return reply(200, { selection: state.selection, audit: [] });
      if (url.pathname === "/api/strategies/selection" && req.method === "PUT") {
        const input = await readJson(req);
        const family = String(input.family ?? "").toUpperCase();
        const horizon = Number(input.horizonSeconds);
        if (!HASHES[family] || ![45, 60, 120, 180, 300].includes(horizon)) return reply(400, { error: "invalid_variant" });
        const allowed: Record<string, number[]> = { V1: [300], V2: [60, 120], V3: [45, 60, 120, 180, 300], V8: [45, 60] };
        if (!(allowed[family] ?? []).includes(horizon)) return reply(400, { error: "invalid_variant" });
        state.selection = { mode: String(input.mode ?? "MANUAL"), family, horizon_seconds: horizon, entry_logic_hash: HASHES[family] as string, variant_id: `${family}-${horizon}`, reason: String(input.reason ?? "ui"), updated_at: new Date().toISOString() };
        return reply(200, { ok: true, selection: state.selection });
      }
      if (url.pathname === "/api/strategies/latest-signal" && req.method === "GET") return reply(200, { signals: state.signals });
      if (url.pathname === "/api/strategies/stats" && req.method === "GET") return reply(200, { selection: state.selection, variants: [], audit: [] });
      if (url.pathname.startsWith("/api/strategies/history") && req.method === "GET") return reply(200, { history: [] });
      if (url.pathname === "/api/strategies/promotion" && req.method === "GET") return reply(200, { state: null, audit: [] });
      if (url.pathname.startsWith("/api/operational/") && req.method === "PUT") {
        const input = await readJson(req);
        const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        operationalSnapshots.set(sessionId, (input.snapshot as Record<string, unknown>) ?? input);
        return reply(200, { stored: true });
      }
      if (url.pathname.startsWith("/api/operational/") && req.method === "GET") {
        const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const snapshot = operationalSnapshots.get(sessionId);
        if (!snapshot) return reply(404, { error: "operational_session_not_found" });
        return reply(200, { ...snapshot, sessionId });
      }
      return reply(404, { error: "not_found" });
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

async function post(base: string, path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function put(base: string, path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${base}${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

let appBase = "";
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  previousEnv.TRACECOM_LIVE_RELAY_URL = process.env.TRACECOM_LIVE_RELAY_URL;
  previousEnv.TRACECOM_LIVE_RELAY_ADMIN_SECRET = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET;
  const relayBase = await startRelay();
  process.env.TRACECOM_LIVE_RELAY_URL = relayBase;
  process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET = "test-admin-secret";
  appBase = await startApp();
});
afterAll(async () => {
  process.env.TRACECOM_LIVE_RELAY_URL = previousEnv.TRACECOM_LIVE_RELAY_URL;
  process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET = previousEnv.TRACECOM_LIVE_RELAY_ADMIN_SECRET;
  await Promise.all([...relayServers, ...appServers].splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
afterEach(() => {
  state.selection = { mode: "MANUAL", family: "V3", horizon_seconds: 60, entry_logic_hash: HASHES.V3 as string, variant_id: "V3-60", reason: "reset", updated_at: new Date().toISOString() };
  state.signals = [];
});

describe("E2E manual switch — a selecao controla o agente (nao e selecao fake)", () => {
  it("CENARIO A: V3 selecionada (V3=BUY) aceita; trocar para V8-45 (V8=WAIT) REJEITA o BUY", async () => {
    state.signals = [signal("V3", 60, "BUY")];
    const first = await post(appBase, "/api/operational/lock", { sessionId: `sw-a-${Date.now()}`, signalId: "a1", idempotencyKey: "a1", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 60_000, countdownMs: 10_000 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "SIGNAL_LOCKED", shadowOnly: true, brokerAutomation: "NONE" });
    // UI troca para V8-45 via API (persistido no relay)
    const putResult = await put(appBase, "/api/strategies/selection", { family: "V8", horizonSeconds: 45, reason: "ui-switch" });
    expect(putResult.status).toBe(200);
    expect(putResult.body).toMatchObject({ appliesFromNextSignal: true });
    // V8 = WAIT (sem sinal) → operacional bloqueado, mesmo com request BUY
    const blocked = await post(appBase, "/api/operational/lock", { sessionId: `sw-a2-${Date.now()}`, signalId: "a2", idempotencyKey: "a2", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 45_000, countdownMs: 10_000 });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "strategy_gate_rejected", reason: "NO_FRESH_SIGNAL" });
  });

  it("CENARIO B: V3=WAIT com V3 selecionada → WAIT; trocar para V8-45 com V8=SELL → SELL aceito", async () => {
    state.signals = [];
    const blocked = await post(appBase, "/api/operational/lock", { sessionId: `sw-b-${Date.now()}`, signalId: "b1", idempotencyKey: "b1", direction: "SELL", originSymbol: "USD/CAD (OTC)", horizonMs: 60_000, countdownMs: 10_000 });
    expect(blocked.status).toBe(409);
    await put(appBase, "/api/strategies/selection", { family: "V8", horizonSeconds: 45, reason: "ui-switch" });
    state.signals = [signal("V8", 45, "SELL")];
    const accepted = await post(appBase, "/api/operational/lock", { sessionId: `sw-b2-${Date.now()}`, signalId: "b2", idempotencyKey: "b2", direction: "SELL", originSymbol: "USD/CAD (OTC)", horizonMs: 45_000, countdownMs: 10_000 });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ state: "SIGNAL_LOCKED", signal: { direction: "SELL" } });
  });

  it("CENARIO C: V3=BUY vs V8=SELL discordam → selecao decide a direcao da operacao", async () => {
    state.signals = [signal("V3", 60, "BUY"), signal("V8", 45, "SELL")];
    const withV3 = await post(appBase, "/api/operational/lock", { sessionId: `sw-c-${Date.now()}`, signalId: "c1", idempotencyKey: "c1", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 60_000, countdownMs: 10_000 });
    expect(withV3.status).toBe(200);
    expect(withV3.body).toMatchObject({ signal: { direction: "BUY" } });
    await put(appBase, "/api/strategies/selection", { family: "V8", horizonSeconds: 45, reason: "ui-switch" });
    const withV8 = await post(appBase, "/api/operational/lock", { sessionId: `sw-c2-${Date.now()}`, signalId: "c2", idempotencyKey: "c2", direction: "SELL", originSymbol: "USD/CAD (OTC)", horizonMs: 45_000, countdownMs: 10_000 });
    expect(withV8.status).toBe(200);
    expect(withV8.body).toMatchObject({ signal: { direction: "SELL" } });
    // direcao errada para a selecao vigente (V8=SELL) e rejeitada
    const wrong = await post(appBase, "/api/operational/lock", { sessionId: `sw-c3-${Date.now()}`, signalId: "c3", idempotencyKey: "c3", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 45_000, countdownMs: 10_000 });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ reason: "DIRECTION_MISMATCH" });
  });

  it("horizonte incompativel com o broker bloqueia a operacao (shadow continua)", async () => {
    state.signals = [signal("V3", 60, "BUY")];
    const blocked = await post(appBase, "/api/operational/lock", { sessionId: `sw-h-${Date.now()}`, signalId: "h1", idempotencyKey: "h1", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 60_000, countdownMs: 10_000, brokerHorizonSeconds: 45 });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ reason: "HORIZON_INCOMPATIBLE" });
  });

  it("reload/persistencia: GET /api/strategies/selection reflete a selecao persistida no relay", async () => {
    await put(appBase, "/api/strategies/selection", { family: "V2", horizonSeconds: 120, reason: "ui-switch" });
    const response = await fetch(`${appBase}/api/strategies/selection`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ selection: { family: "V2", horizonSeconds: 120, variantId: "V2-120" } });
  });

  it("operacao ativa permanece imutavel apos troca de selecao", async () => {
    state.signals = [signal("V3", 60, "BUY")];
    const sessionId = `sw-imm-${Date.now()}`;
    const locked = await post(appBase, "/api/operational/lock", { sessionId, signalId: "i1", idempotencyKey: "i1", direction: "BUY", originSymbol: "USD/CAD (OTC)", horizonMs: 60_000, countdownMs: 10_000 });
    expect(locked.status).toBe(200);
    await put(appBase, "/api/strategies/selection", { family: "V8", horizonSeconds: 45, reason: "ui-switch-during-op" });
    const lockedSignal = locked.body.signal as Record<string, unknown>;
    expect(lockedSignal).toMatchObject({ direction: "BUY", signalId: "i1" });
    const snapshotResponse = await fetch(`${appBase}/api/operational/${encodeURIComponent(sessionId)}`);
    const snapshot = await snapshotResponse.json() as Record<string, unknown>;
    const frozenSignal = snapshot.signal as Record<string, unknown> | undefined;
    expect(frozenSignal).toMatchObject({ direction: "BUY", signalId: "i1" });
    expect(frozenSignal?.settlementAt).toBe(lockedSignal.settlementAt);
    expect(frozenSignal?.countdownEndsAt).toBe(lockedSignal.countdownEndsAt);
    expect(snapshot).toMatchObject({ state: "SIGNAL_LOCKED" });
  });
});
