/**
 * Adaptador serverless da API TRACECON — para Vercel (API Routes).
 *
 * Observação: WebSocket em tempo real (Binance) não funciona em serverless.
 * Este adaptador expõe os endpoints REST (mercado/context/analyze/news/backtest)
 * usando cold store + REST snapshot. Para stream contínuo, use o Railway
 * (processo long-running: `npm run serve`).
 *
 * O runtime cria o cold store (SQLite) — em serverless sem disco persistente
 * isto é efêmero; Railway é o destino recomendado para produção.
 */
import { TraceconHttpApi } from "../src/http/api";
import { createMarketRuntime } from "../src/market/runtime";
import { loadConfig } from "../src/config/env";
import { join } from "node:path";
import { tmpdir } from "node:os";

const config = loadConfig();
const runtime = createMarketRuntime(
  { marketDataMode: config.marketDataMode, nodeEnv: config.nodeEnv, database: { path: join(tmpdir(), "tracecon.db") } },
  { symbols: [{ symbol: "BTCUSDT", timeframe: "1h", native: true }] },
);
const api = new TraceconHttpApi({ runtime, port: 0, host: "127.0.0.1", apiToken: config.apiToken });

let started = false;

export default async function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
  if (!started) {
    started = true;
    await runtime.start().catch(() => void 0);
  }
  // Encaminha para o TraceconHttpApi (criamos um túnel simples reutilizando o método público).
  await api.handleForVercel(req, res).catch((e) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "erro" }));
  });
  runtime.stop(); // efêmero
}
