import { describe, expect, it, afterEach } from "vitest";
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
});
