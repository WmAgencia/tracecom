/**
 * Serviço HTTP da TRACECON (Etapa 7) — API interna para web/extensão.
 *
 * Expõe mercado, quant, análise (fusão), backtest e notícias de forma
 * consumível, sem que o cliente conheça detalhes de provider. Autenticação é
 * separada da lógica (multi-tenancy-ready): a rota /api/* valida um token
 * simples de API (server-side) e o núcleo permanece independente.
 *
 * SEM segredo exposto: tokens/keys nunca chegam ao browser.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MarketRuntime } from "../market/runtime";
import type { Direction } from "../backtest/types";
import type { Timeframe } from "../market/model";
import type { FusedDecisionInput } from "../analytics/service";

export interface HttpApiOptions {
  readonly runtime: MarketRuntime;
  readonly port: number;
  /** Token de API exigido em /api/* (server-side). Vazio = rotas públicas abertas (dev). */
  readonly apiToken?: string | null;
  /** Host para bind (default localhost). */
  readonly host?: string;
  /** Diretório de assets estáticos (web app). Se omitido, só API. */
  readonly publicDir?: string;
  readonly logger?: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
}

interface HttpResponse {
  status: number;
  json?: unknown;
  html?: string;
  /** corpo binário (assets estáticos). */
  body?: Buffer;
  contentType?: string;
}

export class TraceconHttpApi {
  private readonly server: ReturnType<typeof createServer>;
  private readonly runtime: MarketRuntime;
  private readonly port: number;
  private readonly host: string;
  private readonly token: string | null;
  private readonly publicDir: string | null;
  private readonly log?: HttpApiOptions["logger"];

  constructor(opts: HttpApiOptions) {
    this.runtime = opts.runtime;
    this.port = opts.port;
    this.host = opts.host ?? "127.0.0.1";
    this.token = opts.apiToken?.trim() ? opts.apiToken : null;
    this.publicDir = opts.publicDir ? resolve(opts.publicDir) : null;
    this.log = opts.logger;
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  listen(): void {
    this.server.listen(this.port, this.host, () => {
      this.log?.info("http.listen", { host: this.host, port: this.port });
    });
  }

  close(): void {
    this.server.close();
  }

  /** Permite reutilizar o roteador em ambientes serverless (Vercel). */
  async handleForVercel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.handle(req, res);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    try {
      const resp = await this.route(req, req.method ?? "GET", url.pathname, url.searchParams);
      this.write(res, resp);
    } catch (err) {
      this.log?.error("http.error", { path: url.pathname, error: err instanceof Error ? err.message : String(err) });
      this.write(res, { status: 500, json: { error: err instanceof Error ? err.message : "erro interno" } });
    }
  }

  private async route(req: IncomingMessage, method: string, path: string, q: URLSearchParams): Promise<HttpResponse> {
    // Assets estáticos da web app (públicos, sem token).
    if (this.publicDir && method === "GET") {
      const asset = this.asset(path);
      if (asset) return asset;
    }

    if (path === "/" || path === "/index.html") {
      if (this.publicDir) {
        const html = this.loadAsset("index.html");
        if (html) return { status: 200, html: html.toString("utf-8"), contentType: "text/html" };
        const spa = this.loadAsset("app.html");
        if (spa) return { status: 200, html: spa.toString("utf-8"), contentType: "text/html" };
      }
      return { status: 200, html: this.homePage() };
    }

    // Rota pública para baixar a extensão do navegador empacotada.
    if (path === "/extension/download" && method === "GET") {
      return this.extensionDownload();
    }
    if (path === "/extension/info" && method === "GET") {
      return { status: 200, json: this.extensionInfo() };
    }

    // Rotas públicas (sem token): health e status.
    if (path === "/health" && method === "GET") {
      return { status: 200, json: { ok: true, ts: Date.now() } };
    }

    // Rotas de API exigem token (quando configurado).
    if (path.startsWith("/api/")) {
      if (!this.authorized(req)) {
        return { status: 401, json: { error: "unauthorized" } };
      }
    }

    return this.apiRoute(method, path, q);
  }

  /**
   * Resolve o caminho do zip da extensão empacotada. Procura em
   * `dist/` (build), `../dist/` (a partir de src/http) e `../../dist/`.
   * Se não existir, retorna erro 503 com instrução de build.
   */
  private resolveExtensionZip(): { path: string; size: number } | null {
    const candidates = [
      join(process.cwd(), "dist", "tracecon-extension-v0.2.0.zip"),
      join(process.cwd(), "dist", "tracecon-extension-v0.1.0.zip"),
      join(process.cwd(), "..", "dist", "tracecon-extension-v0.2.0.zip"),
      join(process.cwd(), "..", "dist", "tracecon-extension-v0.1.0.zip"),
    ];
    for (const p of candidates) {
      try {
        if (existsSync(p) && statSync(p).isFile()) {
          const size = statSync(p).size;
          return { path: p, size };
        }
      } catch {
        // ignora
      }
    }
    return null;
  }

  private extensionInfo(): unknown {
    const zip = this.resolveExtensionZip();
    return {
      available: zip !== null,
      url: "/extension/download",
      filename: zip ? zip.path.split(/[\\/]/).pop() : "tracecon-extension-v0.2.0.zip",
      sizeBytes: zip?.size ?? null,
      note: zip
        ? `Empacotada em ${zip.path}. Carregue em chrome://extensions com Modo do desenvolvedor.`
        : "Zip não encontrado. Rode: (cd extension && powershell Compress-Archive -Path * -DestinationPath ../dist/tracecon-extension-v0.2.0.zip) — ou use o caminho local.",
    };
  }

  private extensionDownload(): HttpResponse {
    const zip = this.resolveExtensionZip();
    if (!zip) {
      return {
        status: 503,
        json: {
          error: "extension_zip_not_found",
          message:
            "O .zip da extensão não foi encontrado em dist/. Rode o build da extensão para disponibilizar o download.",
        },
      };
    }
    try {
      const body = readFileSync(zip.path);
      return {
        status: 200,
        body,
        contentType: "application/zip",
      };
    } catch (err) {
      return {
        status: 500,
        json: { error: "extension_read_failed", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /** true = autorizado (sem token configurado => sempre autorizado). */
  private authorized(req: IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    return timedSafeEqual(provided, this.token);
  }

  private async apiRoute(method: string, path: string, q: URLSearchParams): Promise<HttpResponse> {
    const rt = this.runtime;
    const symbol = q.get("symbol") ?? "BTCUSDT";
    const timeframe = (q.get("timeframe") ?? "1h") as Timeframe;

    switch (`${method} ${path}`) {
      case "GET /api/status":
        return { status: 200, json: await this.status() };
      case "GET /api/market":
        return { status: 200, json: await rt.service.getMarketData({ symbol, timeframe }) };
      case "GET /api/market/context":
        return { status: 200, json: await rt.buildContext(symbol, timeframe) };
      case "GET /api/market/candles": {
        const candles = rt.pipeline?.state.getCandles(symbol, timeframe) ?? [];
        return { status: 200, json: { symbol, timeframe, count: candles.length, candles } };
      }
      case "GET /api/quant":
        return { status: 200, json: await rt.buildContext(symbol, timeframe) };
      case "GET /api/analyze": {
        const direction = (q.get("direction") ?? "up") as Direction;
        const horizon = Number(q.get("horizon") ?? 12);
        const result = await rt.fusion.analyze({ symbol, timeframe, direction, horizon });
        return { status: 200, json: result };
      }
      case "GET /api/backtest": {
        const direction = (q.get("direction") ?? "up") as Direction;
        const horizon = Number(q.get("horizon") ?? 12);
        const result = await rt.backtester.run({
          symbol, timeframe,
          target: { direction, horizon, minMovePct: Number(q.get("minMove") ?? 0.5) },
          criteria: { similarityThreshold: Number(q.get("threshold") ?? 0.85) },
          oosRatio: 0.25,
          source: rt.candleRepo.source(),
        });
        return { status: 200, json: result };
      }
      case "GET /api/news": {
        const asset = q.get("asset") ?? symbol;
        const res = await rt.news.searchNews({ query: asset, asset, limit: 8 });
        return { status: 200, json: { source: res.source, available: res.available, note: res.note, bias: res.available ? rt.news.deriveBias(res.items) : null, items: res.items } };
      }
      case "GET /api/catalog": {
        return { status: 200, json: { assets: rt.catalog.list() } };
      }
      case "GET /api/analytics/stats": {
        const sym = q.get("symbol") ?? undefined;
        const tf = q.get("timeframe") ?? undefined;
        // avalia pendentes primeiro (dados reais) e retorna estatística.
        await rt.analytics.evaluatePending({ symbol: sym, timeframe: tf });
        const stats = await rt.analytics.stats({ symbol: sym, timeframe: tf });
        return { status: 200, json: stats };
      }
      case "GET /api/analytics/record": {
        const input: FusedDecisionInput = {
          symbol: symbol,
          timeframe,
          direction: q.get("direction") ?? "up",
          decision: (q.get("decision") ?? "WAIT") as FusedDecisionInput["decision"],
          horizon: Number(q.get("horizon") ?? 12),
          entryTime: Number(q.get("entryTime") ?? Date.now()),
          entryPrice: q.get("entryPrice") ? Number(q.get("entryPrice")) : null,
          score: Number(q.get("score") ?? 0),
          confidence: Number(q.get("confidence") ?? 0),
          probability: q.get("probability") ? Number(q.get("probability")) : null,
          sampleSize: Number(q.get("sampleSize") ?? 0),
          regime: q.get("regime") ?? null,
          rationale: q.get("rationale") ?? "",
        };
        const record = await rt.analytics.recordDecision(input);
        return { status: 200, json: record };
      }
      default:
        return { status: 404, json: { error: "not_found", path } };
    }
  }

  private async status(): Promise<unknown> {
    const rt = this.runtime;
    return {
      provider: rt.provider?.id ?? "none",
      state: rt.provider?.getStatus() ?? "disconnected",
      configured: rt.configured,
      connectedAt: rt.provider?.connectedAt ?? null,
    };
  }

  private homePage(): string {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>TRACECON API</title>
<style>body{font:14px ui-monospace,Menlo,monospace;background:#0e1117;color:#e6e6e6;padding:24px;max-width:900px}
code{background:#161b24;padding:2px 6px;border-radius:4px;color:#79c0ff}a{color:#58a6ff}</style></head><body>
<h1>TRACECON HTTP API</h1><p>Endpoints (GET, JSON):</p>
<ul>
<li><code>/health</code></li>
<li><code>/api/status</code></li>
<li><code>/api/market?symbol=BTCUSDT&amp;timeframe=1h</code></li>
<li><code>/api/market/context?symbol=...&amp;timeframe=...</code></li>
<li><code>/api/market/candles?symbol=...&amp;timeframe=...</code></li>
<li><code>/api/quant?symbol=...&amp;timeframe=...</code></li>
<li><code>/api/analyze?symbol=...&amp;timeframe=...&amp;direction=up&amp;horizon=12</code></li>
<li><code>/api/backtest?symbol=...&amp;timeframe=...&amp;direction=up&amp;horizon=12</code></li>
<li><code>/api/news?asset=BTC</code></li>
<li><code>/api/catalog</code></li>
<li><code>/api/analytics/stats?symbol=BTCUSDT&amp;timeframe=1h</code></li>
<li><code>/api/analytics/record?symbol=...&amp;decision=BUY&amp;direction=up&amp;horizon=12&amp;entryPrice=...</code></li>
<li><code>/extension/info</code> — metadados do zip da extensão</li>
<li><code>/extension/download</code> — baixa <code>tracecon-extension-v0.1.0.zip</code></li>
</ul>
<p style="color:#7a8494">Se <code>TRACECON_API_TOKEN</code> estiver setado, envie <code>Authorization: Bearer &lt;token&gt;</code> em /api/*.</p>
</body></html>`;
  }

  private write(res: ServerResponse, r: HttpResponse): void {
    res.statusCode = r.status;
    if (r.body) {
      res.setHeader("Content-Type", r.contentType ?? "application/octet-stream");
      res.end(r.body);
      return;
    }
    if (typeof r.html === "string") {
      res.setHeader("Content-Type", r.contentType ?? "text/html; charset=utf-8");
      res.end(r.html);
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(r.json ?? {}));
  }

  /** Resolve um asset estático com segurança (sem path traversal). */
  private loadAsset(relative: string): Buffer | null {
    if (!this.publicDir) return null;
    const safe = relative.replace(/\.\./g, "").replace(/^[\\/]+/, "");
    const full = join(this.publicDir, safe);
    if (!existsSync(full) || !statSync(full).isFile()) return null;
    try {
      return readFileSync(full);
    } catch {
      return null;
    }
  }

  private asset(path: string): HttpResponse | null {
    if (!this.publicDir) return null;
    let relative = path === "/" ? "index.html" : path.slice(1);
    if (!relative) relative = "index.html";
    const body = this.loadAsset(relative);
    if (!body) return null;
    return { status: 200, body, contentType: contentTypeFor(relative) };
  }
}

/** Mapeia extensão → Content-Type (subset). */
function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html": return "text/html; charset=utf-8";
    case "css": return "text/css; charset=utf-8";
    case "js": case "mjs": return "text/javascript; charset=utf-8";
    case "json": return "application/json";
    case "png": return "image/png";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    default: return "text/plain; charset=utf-8";
  }
}

/** Comparação de tempo constante para tokens (evita timing attack). */
function timedSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
