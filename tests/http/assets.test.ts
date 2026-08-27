import { describe, expect, it } from "vitest";
import { TraceconHttpApi } from "../../src/http/api";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Datastore } from "../../src/store/db";
import { MarketDataService } from "../../src/market/service";

function stubRuntime() {
  const store = new Datastore({ path: ":memory:" });
  const service = new MarketDataService({ provider: null, pipeline: null });
  return {
    service, store, provider: null, pipeline: null, configured: false,
    catalog: { find: () => null, list: () => [] },
    quant: null, candleRepo: null, backtester: null, fusion: null, news: null,
    buildContext: async (_s: string, _tf: string) => ({ provider: "none" }),
    start: async () => void 0, stop: () => store.close(),
  };
}

function makeTmpPublic(): string {
  const dir = join(tmpdir(), `tcutil-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>TRACECON</h1>");
  writeFileSync(join(dir, "app.js"), "/* app */");
  writeFileSync(join(dir, "styles.css"), "body{}");
  return dir;
}

interface HResp { status: number; html?: string; body?: Buffer; contentType?: string }

async function route(api: TraceconHttpApi, path: string): Promise<HResp> {
  return (api as unknown as { route(...a: unknown[]): Promise<HResp> }).route({ headers: {} } as never, "GET", path, new URLSearchParams());
}

describe("TraceconHttpApi assets", () => {
  it("serve index.html quando publicDir configurado (via body ou html)", async () => {
    const dir = makeTmpPublic();
    const api = new TraceconHttpApi({ runtime: stubRuntime() as never, port: 0, host: "127.0.0.1", publicDir: dir });
    const r = await route(api, "/");
    expect(r.status).toBe(200);
    const text = r.html ?? r.body?.toString() ?? "";
    expect(text).toContain("TRACECON");
  });

  it("serve app.js com content-type js", async () => {
    const dir = makeTmpPublic();
    const api = new TraceconHttpApi({ runtime: stubRuntime() as never, port: 0, host: "127.0.0.1", publicDir: dir });
    const r = await route(api, "/app.js");
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("javascript");
    expect(r.body?.toString()).toContain("app");
  });

  it("bloqueia path traversal (não lê fora do publicDir)", async () => {
    const dir = makeTmpPublic();
    const api = new TraceconHttpApi({ runtime: stubRuntime() as never, port: 0, host: "127.0.0.1", publicDir: dir });
    const r = await route(api, "/../package.json");
    // loadAsset remove '..'; 'package.json' não existe no publicDir → asset null → apiRoute 404
    expect(r.status).toBe(404);
    if (r.html) expect(r.html).not.toMatch(/private/);
  });

  it("asset inexistente → 404 (não vaza conteúdo)", async () => {
    const dir = makeTmpPublic();
    const api = new TraceconHttpApi({ runtime: stubRuntime() as never, port: 0, host: "127.0.0.1", publicDir: dir });
    const r = await route(api, "/missing.css");
    expect(r.status).toBe(404);
    const json = (r as unknown as { json?: { error?: string } }).json;
    expect(json?.error).toBe("not_found");
  });
});
