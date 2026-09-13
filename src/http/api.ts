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
import type { FableTraderClient } from "../ai/fable-trader";
import type { VisionProvider } from "../vision/provider";
import type { Direction } from "../backtest/types";
import type { Timeframe } from "../market/model";
import type { FusedDecisionInput } from "../analytics/service";
import { recommendPaperPosition } from "../risk/bankroll";
import { advanceSignal, cancelSignal, createPaperSignal, evaluatePaperSignal, executePaperSignal, scheduleSignal, type SignalState } from "../signals/lifecycle";

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
  readonly fableTrader?: FableTraderClient;
  /** Optional perception stage. When present, Fable receives structured text only. */
  readonly visionProvider?: VisionProvider;
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
  private readonly fableTrader?: FableTraderClient;
  private readonly visionProvider?: VisionProvider;

  constructor(opts: HttpApiOptions) {
    this.runtime = opts.runtime;
    this.port = opts.port;
    this.host = opts.host ?? "127.0.0.1";
    this.token = opts.apiToken?.trim() ? opts.apiToken : null;
    this.publicDir = opts.publicDir ? resolve(opts.publicDir) : null;
    this.log = opts.logger;
    this.fableTrader = opts.fableTrader;
    this.visionProvider = opts.visionProvider;
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
      const body = await readJsonBody(req);
      const resp = await this.route(req, req.method ?? "GET", url.pathname, url.searchParams, body);
      this.write(res, resp);
    } catch (err) {
      this.log?.error("http.error", { path: url.pathname, error: err instanceof Error ? err.message : String(err) });
      this.write(res, { status: 500, json: { error: err instanceof Error ? err.message : "erro interno" } });
    }
  }

  private async route(req: IncomingMessage, method: string, path: string, q: URLSearchParams, body: unknown = null): Promise<HttpResponse> {
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

    if (path === "/api/training/sessions" && method === "POST") {
      const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const now = Date.now();
      const id = crypto.randomUUID();
      this.runtime.store.db.prepare(`
        INSERT INTO training_sessions (id,status,symbol,market_type,horizon_seconds,max_evaluated_trades,agent_version,prompt_version,feature_version,vision_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, "ACTIVE", typeof input.symbol === "string" ? input.symbol : null, typeof input.marketType === "string" ? input.marketType : null,
        Number(input.horizonSeconds) || 60, Number(input.maxEvaluatedTrades) || 100, String(input.agentVersion || "FABLE_TRADER_V1"), String(input.promptVersion || "vision-v1"), String(input.featureVersion || "screen-motion-v1"), String(input.visionVersion || "sanitized-crop-v1"), now, now,
      );
      return { status: 201, json: this.trainingStats(id) };
    }

    const trainingSessionGet = path.match(/^\/api\/training\/sessions\/([^/]+)$/);
    if (trainingSessionGet && method === "GET") {
      if (!this.trainingSession(trainingSessionGet[1]!)) return { status: 404, json: { error: "training_session_not_found" } };
      return { status: 200, json: this.trainingStats(trainingSessionGet[1]!) };
    }

    const trainingAnalyze = path.match(/^\/api\/training\/analyze$/);
    if (trainingAnalyze && method === "POST") {
      const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const sessionId = typeof input.trainingSessionId === "string" ? input.trainingSessionId : "";
      const session = this.trainingSession(sessionId);
      if (!session) return { status: 404, json: { error: "training_session_not_found" } };
      const analysis = input.analysis && typeof input.analysis === "object" ? input.analysis as Record<string, unknown> : {};
      const decision = ["BUY", "SELL", "WAIT"].includes(String(analysis.decision)) ? String(analysis.decision) : "WAIT";
      const now = Date.now();
      const observationId = crypto.randomUUID();
      const entryPrice = Number((input.snapshot as Record<string, unknown> | undefined)?.referencePrice);
      const outcome = decision === "WAIT" ? "WAIT" : Number.isFinite(entryPrice) && entryPrice > 0 ? "PENDING" : "UNKNOWN";
      this.runtime.store.db.prepare(`
        INSERT INTO training_observations (id,session_id,analysis_id,decision,confidence,p_buy,p_sell,p_wait,outcome,payload_json,created_at,evaluated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        observationId, sessionId, typeof analysis.analysisId === "string" ? analysis.analysisId : null, decision,
        Number.isFinite(Number(analysis.confidence)) ? Number(analysis.confidence) : null,
        Number.isFinite(Number(analysis.pBuy)) ? Number(analysis.pBuy) : null, Number.isFinite(Number(analysis.pSell)) ? Number(analysis.pSell) : null, Number.isFinite(Number(analysis.pWait)) ? Number(analysis.pWait) : null,
        outcome, JSON.stringify(input).slice(0, 200_000), now, null,
      );
      this.runtime.store.db.prepare("UPDATE training_sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
      return { status: 200, json: { ...this.trainingStats(sessionId), observationId } };
    }

    const trainingSettle = path.match(/^\/api\/training\/observations\/([^/]+)\/settle$/);
    if (trainingSettle && method === "POST") {
      const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const observationId = trainingSettle[1]!;
      const row = this.runtime.store.db.prepare("SELECT * FROM training_observations WHERE id = ?").get(observationId) as { session_id: string; decision: string; outcome: string } | undefined;
      if (!row) return { status: 404, json: { error: "training_observation_not_found" } };
      const entry = Number(input.entryPrice); const exit = Number(input.exitPrice);
      if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) {
        this.runtime.store.db.prepare("UPDATE training_observations SET outcome = ?, evaluated_at = ? WHERE id = ?").run("UNKNOWN", Date.now(), observationId);
      } else {
        const delta = (exit - entry) / entry;
        const win = row.decision === "BUY" ? delta > 0 : row.decision === "SELL" ? delta < 0 : false;
        const flat = Math.abs(delta) < 0.00001;
        this.runtime.store.db.prepare("UPDATE training_observations SET outcome = ?, evaluated_at = ? WHERE id = ?").run(flat ? "DRAW" : win ? "WIN" : "LOSS", Date.now(), observationId);
      }
      return { status: 200, json: this.trainingStats(row.session_id) };
    }

    return this.apiRoute(method, path, q, body);
  }

  private trainingSession(id: string): unknown {
    if (!id) return null;
    return this.runtime.store.db.prepare("SELECT id FROM training_sessions WHERE id = ?").get(id) ?? null;
  }

  private trainingStats(id: string): Record<string, unknown> {
    const session = this.runtime.store.db.prepare("SELECT * FROM training_sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    const row = this.runtime.store.db.prepare(`
      SELECT COUNT(*) analyses,
        SUM(CASE WHEN decision != 'WAIT' THEN 1 ELSE 0 END) signals,
        SUM(CASE WHEN decision = 'WAIT' THEN 1 ELSE 0 END) waits,
        SUM(CASE WHEN outcome IN ('PENDING','UNKNOWN') THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN outcome IN ('WIN','LOSS','DRAW') THEN 1 ELSE 0 END) evaluated,
        SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) wins,
        SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) losses,
        SUM(CASE WHEN outcome='DRAW' THEN 1 ELSE 0 END) draws
      FROM training_observations WHERE session_id = ?
    `).get(id) as Record<string, number | null>;
    const wins = Number(row.wins ?? 0); const losses = Number(row.losses ?? 0); const evaluated = Number(row.evaluated ?? 0);
    return { id, status: session?.status ?? "UNKNOWN", analyses: Number(row.analyses ?? 0), signals: Number(row.signals ?? 0), waits: Number(row.waits ?? 0), pending: Number(row.pending ?? 0), evaluatedTrades: evaluated, WIN: wins, LOSS: losses, DRAW: Number(row.draws ?? 0), WR: wins + losses > 0 ? wins / (wins + losses) : null, maxEvaluatedTrades: session?.max_evaluated_trades ?? 100 };
  }

  /**
   * Resolve o caminho do zip da extensão empacotada. Procura em
   * `dist/` (build), `../dist/` (a partir de src/http) e `../../dist/`.
   * Se não existir, retorna erro 503 com instrução de build.
   */
  private resolveExtensionZip(): { path: string; size: number } | null {
    const candidates = [
      join(process.cwd(), "dist", "tracecon-extension-v0.4.7.zip"),
      join(process.cwd(), "..", "dist", "tracecon-extension-v0.4.7.zip"),
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
      filename: zip ? zip.path.split(/[\\/]/).pop() : "tracecon-extension-v0.4.7.zip",
      sizeBytes: zip?.size ?? null,
      note: zip
        ? `Empacotada em ${zip.path}. Carregue em chrome://extensions com Modo do desenvolvedor.`
        : "Zip não encontrado. Rode npm run build:extension para gerar o pacote instalável.",
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

  private async apiRoute(method: string, path: string, q: URLSearchParams, body: unknown = null): Promise<HttpResponse> {
    const rt = this.runtime;
    const symbol = q.get("symbol") ?? "BTCUSDT";
    const timeframe = (q.get("timeframe") ?? "1h") as Timeframe;

    // Transições de lifecycle usam rota dinâmica, mas continuam somente paper.
    const signalAction = path.match(/^\/api\/signals\/([^/]+)\/(advance|cancel|invalidate|execute|evaluate)$/);
    if (method === "POST" && signalAction) {
      if (!rt.signalRepo) return { status: 503, json: { error: "signal_persistence_unavailable" } };
      const [, id, action] = signalAction;
      const current = rt.signalRepo.find(id!);
      if (!current) return { status: 404, json: { error: "signal_not_found" } };
      const now = Date.now();
      try {
        let next;
        if (action === "advance") next = advanceSignal(current, now);
        else if (action === "cancel") next = cancelSignal(current, q.get("reason") ?? "", now);
        else if (action === "invalidate") next = advanceSignal(current, now, q.get("reason") ?? "STRUCTURE_INVALIDATED");
        else if (action === "evaluate") next = evaluatePaperSignal(current, now);
        else {
          const executionKey = q.get("idempotencyKey") ?? "";
          if (current.state === "executed" && current.executionKey === executionKey) return { status: 200, json: { signal: current, idempotent: true } };
          const ready = advanceSignal(current, now);
          const entryPrice = Number(q.get("entryPrice"));
          if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
            return { status: 400, json: { error: "bad_request", note: "entryPrice positivo é obrigatório para executar paper trade." } };
          }
          const trade = await rt.analytics.recordShadowTrade({
            symbol: ready.symbol, timeframe: ready.timeframe, direction: ready.direction,
            decision: ready.decision, entryTime: now, entryPrice,
            confidence: q.get("confidence") ? Number(q.get("confidence")) : undefined,
            probability: q.get("calibratedProbability") ? Number(q.get("calibratedProbability")) : undefined,
            providerId: rt.provider?.id ?? null,
          });
          if (!trade) return { status: 503, json: { error: "paper_executor_unavailable" } };
          next = executePaperSignal(ready, executionKey, trade.id, now);
        }
        rt.signalRepo.save(next);
        return { status: 200, json: { signal: next } };
      } catch (error) {
        return { status: 409, json: { error: "invalid_signal_transition", message: error instanceof Error ? error.message : String(error) } };
      }
    }

    switch (`${method} ${path}`) {
      case "POST /api/fable/trade": {
        if (!this.fableTrader) return { status: 503, json: { error: "fable_not_configured" } };
        if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, json: { error: "bad_request" } };
        const payload = body as { snapshot?: unknown; chartImage?: unknown; chartImages?: unknown };
        if (!payload.snapshot || typeof payload.snapshot !== "object" || Array.isArray(payload.snapshot)) return { status: 400, json: { error: "snapshot_required" } };
        const chartImages = Array.isArray(payload.chartImages)
          ? payload.chartImages.filter((item): item is { label: string; dataUrl: string } => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).dataUrl === "string")).slice(0, 4)
          : undefined;
        let snapshot = payload.snapshot as Record<string, unknown>;
        let chartImage = typeof payload.chartImage === "string" ? payload.chartImage : null;
        let images = chartImages;
        if (this.visionProvider) {
          const candidate = chartImages?.find((item) => item.label === "current") ?? chartImages?.[0] ?? (chartImage ? { label: "current", dataUrl: chartImage } : null);
          const observation = await this.visionProvider.observe(candidate ? { imageDataUrl: candidate.dataUrl, context: snapshot } : {});
          snapshot = { ...snapshot, visionObservation: observation };
          // Perception and reasoning are separate stages. Do not send the crop
          // to Fable when a provider is configured; only its normalized result.
          chartImage = null;
          images = undefined;
        } else {
          // The decision agent is text-only in the production pipeline. If no
          // explicit perception provider is configured, never forward raw
          // crops to Fable (the provider may reject multimodal payloads and
          // the agent must not silently become the perception layer).
          chartImage = null;
          images = undefined;
        }
        const result = await this.fableTrader.analyze({ snapshot, chartImage, ...(images ? { chartImages: images } : {}) });
        return { status: 200, json: result };
      }
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
      case "GET /api/forex/scan": {
        if (!rt.forexScanner) {
          return {
            status: 503,
            json: {
              error: "forex_provider_not_configured",
              note: "Defina OANDA_API_KEY e OANDA_ACCOUNT_ID no servidor; nenhum dado sintético é usado.",
            },
          };
        }
        const snapshots = await rt.forexScanner.runOnce();
        return { status: 200, json: { provider: "oanda", scannedAt: Date.now(), snapshots } };
      }
      case "POST /api/iq-option/ingest": {
        // The server never sees IQ credentials, cookies, SSID or raw protocol
        // frames. Only a normalized read-only market frame is accepted.
        if (rt.provider?.id !== "iqoption") return { status: 503, json: { error: "iqoption_provider_not_active", note: "Use MARKET_DATA_MODE=iqoption and the read-only extension bridge." } };
        const iq = rt.provider as typeof rt.provider & { ingest?: (frame: unknown) => boolean };
        if (typeof iq.ingest !== "function") return { status: 503, json: { error: "iqoption_ingest_unavailable" } };
        const accepted = iq.ingest(body);
        return accepted ? { status: 202, json: { accepted: true } } : { status: 400, json: { error: "invalid_iqoption_market_frame" } };
      }
      case "GET /api/signals": {
        if (!rt.signalRepo) return { status: 503, json: { error: "signal_persistence_unavailable" } };
        const state = q.get("state");
        const states: readonly SignalState[] = ["created", "scheduled", "countdown", "ready", "executed", "expired", "cancelled", "invalidated", "evaluated"];
        if (state !== null && !states.includes(state as SignalState)) return { status: 400, json: { error: "bad_request", note: "state inválido" } };
        const signals = rt.signalRepo.list({ ...(state ? { state: state as SignalState } : {}), ...(q.get("symbol") ? { symbol: q.get("symbol")! } : {}) });
        return { status: 200, json: { count: signals.length, signals } };
      }
      case "POST /api/signals": {
        if (!rt.signalRepo) return { status: 503, json: { error: "signal_persistence_unavailable" } };
        const now = Date.now();
        const entryAt = Number(q.get("entryAt"));
        const expiresAt = Number(q.get("expiresAt"));
        try {
          const signal = scheduleSignal(createPaperSignal({
            symbol: q.get("symbol") ?? "",
            timeframe: q.get("timeframe") ?? "1m",
            direction: q.get("direction") === "down" ? "down" : "up",
            decision: q.get("decision") === "SELL" ? "SELL" : "BUY",
            countdownAt: q.get("countdownAt") ? Number(q.get("countdownAt")) : entryAt - 60_000,
            entryAt,
            expiresAt,
            now,
          }), now);
          rt.signalRepo.save(signal);
          return { status: 201, json: { signal } };
        } catch (error) {
          return { status: 400, json: { error: "bad_request", message: error instanceof Error ? error.message : String(error) } };
        }
      }
      case "GET /api/risk/sizing": {
        // Endpoint puro de paper sizing. Não cria trade, não envia ordem e
        // exige probabilidade explicitamente identificada como calibrada.
        const probabilityRaw = q.get("calibratedProbability") ?? q.get("probability");
        if (probabilityRaw === null) {
          return { status: 400, json: { error: "bad_request", note: "calibratedProbability é obrigatória; probabilidade não calibrada não deve dimensionar risco." } };
        }
        const result = recommendPaperPosition({
          balance: Number(q.get("balance")),
          calibratedProbability: Number(probabilityRaw),
          sampleSize: Number(q.get("sampleSize")),
          payoutRatio: Number(q.get("payoutRatio")),
          stopDistancePct: Number(q.get("stopDistancePct")),
          state: {
            realizedDailyLossPct: Number(q.get("realizedDailyLossPct") ?? 0),
            currentDrawdownPct: Number(q.get("currentDrawdownPct") ?? 0),
            openPositions: Number(q.get("openPositions") ?? 0),
            killSwitch: q.get("killSwitch") === "true",
          },
        });
        return { status: result.status === "invalid_input" ? 400 : 200, json: result };
      }
      case "GET /api/analytics/stats": {
        const sym = q.get("symbol") ?? undefined;
        const tf = q.get("timeframe") ?? undefined;
        // avalia pendentes primeiro (dados reais) e retorna estatística.
        await rt.analytics.evaluatePending({ symbol: sym, timeframe: tf });
        const stats = await rt.analytics.stats({ symbol: sym, timeframe: tf });
        return { status: 200, json: stats };
      }
      case "GET /api/decisions": {
        // B2: lista todas as decisões registradas, incluindo `probabilityCalibrated`
        // (Platt-scaled) propagado end-to-end. Filtros opcionais por symbol/timeframe
        // e janela temporal (sinceMs). Implementação simples: usa o repositório
        // interno do `AnalyticsService` (mesmo de `/api/analytics/stats`).
        const sym = q.get("symbol") ?? undefined;
        const tf = q.get("timeframe") ?? undefined;
        const sinceMsQ = q.get("sinceMs");
        const sinceMs = sinceMsQ ? Number(sinceMsQ) : undefined;
        // Garante que os pendentes foram avaliados antes de devolver a lista.
        await rt.analytics.evaluatePending({ symbol: sym, timeframe: tf });
        const all = await (rt.analytics as unknown as {
          persist: { listAll(filter: { sinceMs?: number }): Promise<import("../analytics/types").DecisionRecord[]> };
        }).persist.listAll({ sinceMs });
        const filtered = (sym || tf)
          ? all.filter((r) =>
            (!sym || r.symbol === sym) &&
            (!tf || r.timeframe === tf))
          : all;
        return { status: 200, json: { count: filtered.length, decisions: filtered } };
      }
      case "POST /api/analytics/record": {
        const inputBody = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const field = (name: string, fallback: unknown = null): unknown => q.get(name) ?? inputBody[name] ?? fallback;
        const decision = String(field("decision", "WAIT"));
        const direction = String(field("direction", "up"));
        const horizonValue = Number(field("horizon", 12));
        const entryTimeValue = Number(field("entryTime", Date.now()));
        const entryPriceRaw = field("entryPrice");
        const entryPriceValue = entryPriceRaw === null || entryPriceRaw === undefined || entryPriceRaw === "" ? null : Number(entryPriceRaw);
        const confidenceValue = Number(field("confidence", 0));
        const probabilityRaw = field("probability");
        const probabilityValue = probabilityRaw === null || probabilityRaw === undefined || probabilityRaw === "" ? null : Number(probabilityRaw);
        const pBuyRaw = field("pBuy"); const pSellRaw = field("pSell"); const pWaitRaw = field("pWait");
        if (
          !["BUY", "SELL", "WAIT"].includes(decision) ||
          !["up", "down"].includes(direction) ||
          !Number.isInteger(horizonValue) || horizonValue < 1 || horizonValue > 10_000 ||
          !Number.isFinite(entryTimeValue) ||
          (entryPriceValue !== null && (!Number.isFinite(entryPriceValue) || entryPriceValue <= 0)) ||
          !Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1 ||
          (probabilityValue !== null && (!Number.isFinite(probabilityValue) || probabilityValue < 0 || probabilityValue > 1))
        ) {
          return { status: 400, json: { error: "bad_request", note: "campos de decisão inválidos" } };
        }
        const input: FusedDecisionInput = {
          symbol: symbol,
          timeframe,
          direction,
          decision: decision as FusedDecisionInput["decision"],
          horizon: horizonValue,
          entryTime: entryTimeValue,
          entryPrice: entryPriceValue,
          score: Number(q.get("score") ?? 0),
          confidence: confidenceValue,
          probability: probabilityValue,
          pBuy: pBuyRaw == null ? null : Number(pBuyRaw),
          pSell: pSellRaw == null ? null : Number(pSellRaw),
          pWait: pWaitRaw == null ? null : Number(pWaitRaw),
          sampleSize: Number(q.get("sampleSize") ?? 0),
          regime: q.get("regime") ?? null,
          rationale: q.get("rationale") ?? "",
          providerId: q.get("providerId") ?? rt.provider?.id ?? null,
          modelVersion: q.get("modelVersion") ?? null,
          featureVersion: q.get("featureVersion") ?? null,
        };
        const record = await rt.analytics.recordDecision(input);
        return { status: 200, json: record };
      }
      case "GET /api/analytics/calibration": {
        const days = q.get("days") ? Number(q.get("days")) : undefined;
        const report = await rt.analytics.calibration(days ? { days } : undefined);
        return { status: 200, json: report };
      }
      case "GET /api/analytics/calibration/bins": {
        // B-R: reliability diagram (10 bins) derivado do mesmo store do
        // /api/analytics/calibration. Retorna apenas `reliabilityDiagram`
        // para clientes que precisam do histograma sem o report completo.
        const days = q.get("days") ? Number(q.get("days")) : undefined;
        const report = await rt.analytics.calibration(days ? { days } : undefined);
        return {
          status: 200,
          json: {
            ece: report.ece,
            brierScore: report.brierScore,
            reliabilityDiagram: report.reliabilityDiagram ?? { bins: [], ece: 0 },
            windowDays: days ?? null,
            snapshotAt: report.snapshotAt,
          },
        };
      }
      case "GET /api/analytics/perf-snapshot": {
        const days = Number(q.get("days") ?? 30);
        const signalFilter = (q.get("signal") as "BUY" | "SELL" | null) ?? null;
        const snap = await rt.analytics.perfSnapshot({ lookbackDays: days, signalFilter });
        return { status: 200, json: snap };
      }
      case "GET /api/analytics/shadow": {
        const days = q.get("days") ? Number(q.get("days")) : undefined;
        const sinceMs = days ? Date.now() - days * 86400_000 : undefined;
        const signal = (q.get("signal") as "BUY" | "SELL" | null) ?? null;
        const data = await rt.analytics.shadowStats({ sinceMs: sinceMs ?? undefined, signal: signal ?? undefined });
        if (!data) {
          return { status: 503, json: { error: "shadow_unavailable", note: "backend Node com SQLite necessário" } };
        }
        return { status: 200, json: data };
      }
      case "POST /api/analytics/shadow": {
        try {
          const shadowBody: Record<string, unknown> = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
          for (const [k, v] of q.entries()) if (!(k in shadowBody)) shadowBody[k] = v;
          if (!shadowBody.symbol || !shadowBody.decision || shadowBody.entryPrice == null) {
            return { status: 400, json: { error: "bad_request", required: ["symbol", "decision", "entryPrice"] } };
          }
          const trade = await rt.analytics.recordShadowTrade({
            symbol: String(shadowBody.symbol),
            timeframe: String(shadowBody.timeframe ?? "1m"),
            direction: shadowBody.direction === "down" ? "down" : "up",
            decision: String(shadowBody.decision) as "BUY" | "SELL" | "WAIT",
            entryTime: shadowBody.entryTime ? Number(shadowBody.entryTime) : Date.now(),
             entryPrice: Number(shadowBody.entryPrice),
             horizon: shadowBody.horizon != null ? Number(shadowBody.horizon) : undefined,
            confidence: shadowBody.confidence != null ? Number(shadowBody.confidence) : undefined,
            probability: shadowBody.probability != null ? Number(shadowBody.probability) : undefined,
            cooldownMinutes: 0,
            providerId: rt.provider?.id ?? null,
          });
          if (!trade) {
            return { status: 503, json: { error: "shadow_unavailable" } };
          }
          return { status: 200, json: { ok: true, id: trade.id } };
        } catch (e) {
          return { status: 500, json: { error: "shadow_save_failed", message: e instanceof Error ? e.message : String(e) } };
        }
      }
      case "POST /api/analytics/reset-breaker": {
        if (!rt.guardRepo) {
          return { status: 404, json: { error: "guard_persistence_unavailable" } };
        }
        rt.resetBreaker();
        return { status: 200, json: { ok: true, resetAt: new Date().toISOString() } };
      }
      case "GET /api/analytics/drift": {
        // B7: lista alertas de drift desde `sinceMs` (ms epoch). Default: últimos 7 dias.
        if (!rt.adaptiveRepo) {
          return { status: 503, json: { error: "adaptive_repo_unavailable" } };
        }
        const sinceQuery = q.get("sinceMs");
        const sinceMs = sinceQuery
          ? Number(sinceQuery)
          : Date.now() - 7 * 86_400_000;
        if (!Number.isFinite(sinceMs)) {
          return { status: 400, json: { error: "bad_request", note: "sinceMs inválido" } };
        }
        const alerts = rt.adaptiveRepo.listDriftAlerts({ sinceMs });
        return {
          status: 200,
          json: {
            alerts,
            sinceMs,
            count: alerts.length,
            snapshotAt: new Date().toISOString(),
          },
        };
      }
      case "GET /api/analytics/ensemble": {
        // B7: snapshot atual do ensemble_weights (singleton). Aceita ?key=
        if (!rt.adaptiveRepo) {
          return { status: 503, json: { error: "adaptive_repo_unavailable" } };
        }
        const keyFilter = q.get("key") ?? undefined;
        const row = rt.adaptiveRepo.getEnsembleWeights(keyFilter);
        if (!row) {
          return { status: 404, json: { error: "not_found" } };
        }
        return { status: 200, json: row };
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
<li><code>/api/forex/scan</code> — scanner multi-par real (requer OANDA_API_KEY + OANDA_ACCOUNT_ID)</li>
<li><code>/api/risk/sizing?balance=...&amp;calibratedProbability=...&amp;sampleSize=...&amp;payoutRatio=...&amp;stopDistancePct=...</code> — sizing paper, sem enviar ordens</li>
<li><code>POST /api/signals</code> e <code>POST /api/signals/:id/(advance|cancel|invalidate|execute|evaluate)</code> — lifecycle paper persistido</li>
<li><code>/api/analytics/stats?symbol=BTCUSDT&amp;timeframe=1h</code></li>
<li><code>/api/decisions?symbol=BTCUSDT&amp;sinceMs=...</code> — lista decisões registradas (inclui <code>probabilityCalibrated</code> Platt)</li>
<li><code>POST /api/analytics/record?symbol=...&amp;decision=BUY&amp;direction=up&amp;horizon=12&amp;entryPrice=...</code></li>
<li><code>/api/analytics/calibration?days=30</code> — relatório de calibração do motor</li>
<li><code>/api/analytics/calibration/bins?days=30</code> — apenas reliability diagram (10 bins + ECE)</li>
<li><code>/api/analytics/perf-snapshot?days=30</code> — PnL observado no período</li>
<li><code>POST /api/analytics/reset-breaker</code> — zera manualmente o circuit breaker persistido</li>
<li><code>/extension/info</code> — metadados do zip da extensão</li>
<li><code>/extension/download</code> — baixa o pacote atual da extensão TraceCon</li>
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

/** Bounded JSON parser for local extension ingest; never logs request bodies. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > 64 * 1024) throw new Error("request body exceeds 64KB");
    chunks.push(data);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid JSON request body");
  }
}

/** Comparação de tempo constante para tokens (evita timing attack). */
function timedSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
