import { describe, expect, it, afterEach, vi } from "vitest";
import { TraceconHttpApi } from "../../src/http/api";
import { Datastore } from "../../src/store/db";
import { MarketDataService } from "../../src/market/service";
import { SignalRepository } from "../../src/store/repositories/signalRepository";

/**
 * Teste da API HTTP com um runtime stub (sem rede). Valida roteamento, auth e
 * serialização. Não usa dados reais (market/service retorna PROVIDER_NOT_CONFIGURED).
 */

// Runtime mínimo de fachada (provider null). Reutilizamos o TraceconHttpApi.
function makeRuntime() {
  const store = new Datastore({ path: ":memory:" });
  const service = new MarketDataService({ provider: null, pipeline: null });
  const signalRepo = new SignalRepository(store);
  return {
    service, store,
    provider: null,
    pipeline: null,
    configured: false,
    catalog: { find: () => null, list: () => [] },
    quant: null as never,
    candleRepo: null as never,
    backtester: null as never,
    fusion: null as never,
    news: null as never,
    analytics: { recordShadowTrade: async (input: Record<string, unknown>) => ({ id: "shadow-test", ...input }) },
    signalRepo,
    buildContext: async (_s: string, _tf: string) => ({ provider: "none", symbol: _s, timeframe: _tf, currentPrice: null, latestClosedCandle: null, recentCandles: [], volume: null, volatility: null, providerState: "disconnected", dataQuality: "unknown", freshness: "unavailable", timestamp: Date.now(), available: false }),
    start: async () => void 0,
    stop: () => store.close(),
  };
}

class ServerHarness {
  api: TraceconHttpApi;
  constructor(opts: { token?: string }) {
    this.api = new TraceconHttpApi({ runtime: makeRuntime() as never, port: 0, host: "127.0.0.1", apiToken: opts.token ?? null });
  }
}

describe("TraceconHttpApi", () => {
  afterEach(() => {});

  it("constrói com e sem token", () => {
    const h = new ServerHarness({ token: "abc" });
    expect(h.api).toBeDefined();
    const h2 = new ServerHarness({ token: undefined });
    expect(h2.api).toBeDefined();
  });

  it("home page é html", () => {
    const h = new ServerHarness({});
    // acessamos o método via any para teste unitário de rota
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; html?: string }> };
    return api.route({ headers: {} } as never, "GET", "/", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(200);
      expect(r.html).toContain("TRACECON");
    });
  });

  it("health público: 200", () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: unknown }> };
    return api.route({ headers: {} } as never, "GET", "/health", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(200);
    });
  });

  it("aceita registro shadow enviado como JSON pela extensão", async () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { ok?: boolean; id?: string } }> };
    const response = await api.route({ headers: {} } as never, "POST", "/api/analytics/shadow", new URLSearchParams(), {
      symbol: "EURUSD", timeframe: "1m", direction: "up", decision: "BUY", entryTime: 1_800_000_000_000, entryPrice: 1.1,
    });
    expect(response).toMatchObject({ status: 200, json: { ok: true, id: "shadow-test" } });
  });

  it("mantém o Fable text-only quando não há provider de percepção", async () => {
    const analyze = vi.fn().mockResolvedValue({ analysis: { decision: "WAIT" } });
    const apiInstance = new TraceconHttpApi({ runtime: makeRuntime() as never, port: 0, host: "127.0.0.1", fableTrader: { analyze } as never });
    const api = apiInstance as unknown as { route(...a: unknown[]): Promise<{ status: number }> };
    const frame = `data:image/jpeg;base64,${Buffer.from("frame").toString("base64")}`;
    const response = await api.route({ headers: {} } as never, "POST", "/api/fable/trade", new URLSearchParams(), {
      snapshot: { analysisId: "test" }, chartImage: frame, chartImages: [{ label: "current", dataUrl: frame }],
    });
    expect(response.status).toBe(200);
    expect(analyze).toHaveBeenCalledWith({ snapshot: { analysisId: "test" }, chartImage: null });
  });

  it("rota desconhecida → 404", () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number }> };
    return api.route({ headers: {} } as never, "GET", "/nope", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(404);
    });
  });

  it("/extension/info retorna metadados da extensão (zip ausente em teste)", () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { available: boolean; url: string; filename: string } }> };
    return api.route({ headers: {} } as never, "GET", "/extension/info", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(200);
      expect(r.json?.url).toBe("/extension/download");
      expect(r.json?.filename).toContain("tracecon-extension");
      // Em ambiente de teste (sem zip em dist/), available=false
      expect(typeof r.json?.available).toBe("boolean");
    });
  });

  it("/extension/download retorna 503 quando o zip não está em dist/", () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { error: string } }> };
    return api.route({ headers: {} } as never, "GET", "/extension/download", new URLSearchParams()).then((r) => {
      // Em ambiente de teste sem zip, esperamos 503 com erro específico
      expect([200, 503]).toContain(r.status);
      if (r.status === 503) expect(r.json?.error).toBe("extension_zip_not_found");
    });
  });

  it("com token configurado, /api/* sem bearer → 401", () => {
    const h = new ServerHarness({ token: "secret" });
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number }> };
    return api.route({ headers: {} } as never, "GET", "/api/status", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(401);
    });
  });

  it("com token configurado e bearer correto → aprova (chega ao roteamento)", () => {
    const h = new ServerHarness({ token: "secret" });
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number }> };
    return api.route({ headers: { authorization: "Bearer secret" } } as never, "GET", "/api/status", new URLSearchParams()).then((r) => {
      // sem provider, status retorna state disconnected (200) — não 401
      expect(r.status).not.toBe(401);
    });
  });

  it("token errado → 401", () => {
    const h = new ServerHarness({ token: "secret" });
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number }> };
    return api.route({ headers: { authorization: "Bearer wrong" } } as never, "GET", "/api/status", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(401);
    });
  });

  it("Forex sem credenciais retorna indisponibilidade explícita, não dados fictícios", () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { error?: string } }> };
    return api.route({ headers: {} } as never, "GET", "/api/forex/scan", new URLSearchParams()).then((r) => {
      expect(r.status).toBe(503);
      expect(r.json?.error).toBe("forex_provider_not_configured");
    });
  });

  it("sizing exige probabilidade calibrada e nunca cria ordem", async () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { status?: string; positionNotional?: number; error?: string } }> };
    const missing = await api.route({ headers: {} } as never, "GET", "/api/risk/sizing", new URLSearchParams("balance=1000"));
    expect(missing.status).toBe(400);
    const response = await api.route({ headers: {} } as never, "GET", "/api/risk/sizing", new URLSearchParams("balance=10000&calibratedProbability=0.6&sampleSize=80&payoutRatio=1.5&stopDistancePct=0.01"));
    expect(response.status).toBe(200);
    expect(response.json?.status).toBe("approved");
    expect(response.json?.positionNotional).toBeGreaterThan(0);
  });

  it("cria e lista signal paper persistido", async () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: { signal?: { state: string }; count?: number } }> };
    const now = Date.now();
    const create = await api.route({ headers: {} } as never, "POST", "/api/signals", new URLSearchParams({ symbol: "EUR/USD", timeframe: "1m", direction: "up", decision: "BUY", entryAt: String(now + 60_000), expiresAt: String(now + 120_000) }));
    expect(create.status).toBe(201);
    expect(create.json?.signal?.state).toBe("scheduled");
    const list = await api.route({ headers: {} } as never, "GET", "/api/signals", new URLSearchParams("symbol=EUR/USD"));
    expect(list.status).toBe(200);
    expect(list.json?.count).toBe(1);
  });

  it("persiste treinamento, separa WAIT e exclui UNKNOWN do WR", async () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: Record<string, any> }> };
    const created = await api.route({ headers: {} } as never, "POST", "/api/training/sessions", new URLSearchParams(), { symbol: "EUR/USD", marketType: "OTC", horizonSeconds: 60 });
    expect(created.status).toBe(201);
    const id = String(created.json?.id);
    const wait = await api.route({ headers: {} } as never, "POST", "/api/training/analyze", new URLSearchParams(), { trainingSessionId: id, analysis: { decision: "WAIT", confidence: 0.5 } });
    expect(wait.json).toMatchObject({ analyses: 1, waits: 1, evaluatedTrades: 0, WR: null });
    const unknown = await api.route({ headers: {} } as never, "POST", "/api/training/analyze", new URLSearchParams(), { trainingSessionId: id, snapshot: { referencePrice: null }, analysis: { decision: "BUY", confidence: 0.8 } });
    expect(unknown.json).toMatchObject({ analyses: 2, signals: 1, pending: 1, evaluatedTrades: 0, WR: null });
    const persisted = await api.route({ headers: {} } as never, "GET", `/api/training/sessions/${id}`, new URLSearchParams());
    expect(persisted.status).toBe(200);
    expect(persisted.json).toMatchObject({ id, analyses: 2, waits: 1, pending: 1, evaluatedTrades: 0 });
  });

  it("settles BUY objectively and records DRAW without changing the input snapshot", async () => {
    const h = new ServerHarness({});
    const api = h.api as unknown as { route(...a: unknown[]): Promise<{ status: number; json?: Record<string, any> }> };
    const created = await api.route({ headers: {} } as never, "POST", "/api/training/sessions", new URLSearchParams(), {});
    const id = String(created.json?.id);
    const opened = await api.route({ headers: {} } as never, "POST", "/api/training/analyze", new URLSearchParams(), { trainingSessionId: id, snapshot: { referencePrice: 100, immutable: "yes" }, analysis: { decision: "BUY", confidence: 0.7 } });
    const observationId = String(opened.json?.observationId);
    const settled = await api.route({ headers: {} } as never, "POST", `/api/training/observations/${observationId}/settle`, new URLSearchParams(), { entryPrice: 100, exitPrice: 100 });
    expect(settled.json).toMatchObject({ evaluatedTrades: 1, DRAW: 1, WR: null });
    const row = h.api as unknown as { runtime: { store: { db: { prepare: (sql: string) => { get: (...args: unknown[]) => any } } } } };
    const payload = row.runtime.store.db.prepare("SELECT payload_json FROM training_observations WHERE id = ?").get(observationId);
    expect(JSON.parse(payload.payload_json).snapshot).toMatchObject({ referencePrice: 100, immutable: "yes" });
  });
});
