/**
 * Adaptador serverless da API TRACECON — para Vercel (API Routes).
 *
 * Observação: WebSocket em tempo real (Binance) não funciona em serverless.
 * Este adaptador expõe os endpoints REST (mercado/context/analyze/news/backtest)
 * usando cold store + REST snapshot. Para stream contínuo, use o Railway
 * (processo long-running: `npm run serve`).
 *
 * IMPORTANTE (Vercel): requer Node >= 22 (node:sqlite) e o cold store é
 * efêmero em serverless. O /health NÃO depende de DB (sempre responde).
 */
import { TraceconHttpApi } from "../src/http/api";
import { createMarketRuntime } from "../src/market/runtime";
import { loadConfig } from "../src/config/env";
import { join } from "node:path";
import { tmpdir } from "node:os";

const config = loadConfig();
let api: TraceconHttpApi | null = null;
let started = false;

async function ensure(): Promise<TraceconHttpApi> {
  if (api) return api;
  const runtime = createMarketRuntime(
    { marketDataMode: config.marketDataMode, nodeEnv: config.nodeEnv, database: { path: join(tmpdir(), "tracecon.db") } },
    { symbols: [{ symbol: "BTCUSDT", timeframe: "1h", native: true }] },
  );
  api = new TraceconHttpApi({ runtime, port: 0, host: "127.0.0.1", apiToken: config.apiToken });
  if (!started) {
    started = true;
    // Conectar é opcional; em serverless não faz streaming — apenas snapshot.
    try { await config.marketDataMode === "binance" ? runtime.start() : Promise.resolve(); } catch { /* offline */ }
  }
  return api;
}

export default async function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
  // health nunca depende de runtime (disponibilidade do endpoint).
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  try {
    const a = await ensure();
    await a.handleForVercel(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "erro" }));
  }
}

