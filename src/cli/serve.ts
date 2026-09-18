/**
 * CLI do serviço HTTP (Etapa 7).
 *
 *   npm run serve            → http://127.0.0.1:8788
 *   TRACECON_API_TOKEN=xxx   → protege /api/*
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";
import { TraceconHttpApi } from "../http/api";
import { createOutcomeScheduler } from "../analytics/scheduler";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { FableTraderClient } from "../ai/fable-trader";

const here = dirname(fileURLToPath(import.meta.url));
/** Resolve o publicDir ok em dev (src/http/public) ou build (dist/http/public). */
function resolvePublicDir(): string {
  const candidates = [
    join(here, "..", "http", "public"),
    join(here, "..", "..", "src", "http", "public"),
    join(process.cwd(), "src", "http", "public"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}
const publicDir = resolvePublicDir();

async function main(): Promise<void> {
  const config = loadConfig();
  // PaaS (Railway/Vercel) injetam PORT; usamos HTTP_PORT com fallback em PORT.
  const port = Number(process.env.PORT ?? process.env.HTTP_PORT ?? 8788);
  // P-R: intervalo do scheduler configurável por env (default 30s).
  const schedulerMs = Number(process.env.TRACECON_SCHEDULER_MS ?? 30_000);
  const symbols = config.marketDataMode === "forex" || config.marketDataMode === "auto"
    ? ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"].flatMap((symbol) => [
      { symbol, timeframe: "1m" as const, native: true },
      { symbol, timeframe: "5m" as const, native: true },
      { symbol, timeframe: "15m" as const, native: true },
      { symbol, timeframe: "1h" as const, native: true },
    ])
    : [
      { symbol: "BTCUSDT", timeframe: "1m" as const, native: true },
      { symbol: "BTCUSDT", timeframe: "15m" as const, native: true },
      { symbol: "BTCUSDT", timeframe: "1h" as const, native: true },
      { symbol: "BTCUSDT", timeframe: "4h" as const, native: true },
      { symbol: "ETHUSDT", timeframe: "1h" as const, native: true },
    ];

  const rt = createMarketRuntime(config, {
    symbols,
  });
  // Trader de visão: OpenCode Go (default) quando há chave; Anthropic/Nexxus é
  // legado e só roda com AI_PROVIDER=anthropic + FABLE_API_KEY.
  const fableTrader = config.ai.provider === "openCodeGo" && config.ai.apiKey
    ? new FableTraderClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.openCodeGo.baseUrl, model: config.ai.model, provider: "openCodeGo" })
    : config.ai.provider === "anthropic" && config.fable.apiKey
      ? new FableTraderClient({ apiKey: config.fable.apiKey, baseUrl: config.fable.baseUrl, model: config.fable.model, provider: "anthropic" })
      : undefined;

  const api = new TraceconHttpApi({
    runtime: rt,
    port,
    host: process.env.HOST ?? (config.nodeEnv === "production" || process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    apiToken: config.apiToken,
    publicDir,
    ...(fableTrader ? { fableTrader } : {}),
    logger: {
      info: (m, meta) => console.log(JSON.stringify({ event: m, ...(meta as object) })),
      error: (m, meta) => console.error(JSON.stringify({ event: m, level: "error", ...(meta as object) })),
    },
  });

  if (rt.configured) await rt.start();
  api.listen();

  // P-R: iniciar scheduler de outcomes que avalia pending periodicamente.
  // Sem scheduler, decisões nunca são avaliadas em produção silente.
  const scheduler = createOutcomeScheduler(rt.analytics, {
    intervalMs: schedulerMs,
    providerId: rt.provider?.id ?? null,
    logger: {
      info: (m, meta) => console.log(JSON.stringify({ event: m, ...(meta as object) })),
      warn: (m, meta) => console.error(JSON.stringify({ event: m, level: "warn", ...(meta as object) })),
      error: (m, meta) => console.error(JSON.stringify({ event: m, level: "error", ...(meta as object) })),
    },
  });
  scheduler.start();

  console.log(`TRACECON HTTP API → http://127.0.0.1:${port}`);
  console.log(`TRACECON outcome scheduler → every ${schedulerMs}ms`);
  if (config.apiToken) console.log("Token de API habilitado (/api/* exige Authorization: Bearer <token>).");
  else console.log("Sem TRACECON_API_TOKEN: /api/* aberto (somente dev).");

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "shutdown.start", signal }));
    await scheduler.stop();
    api.close();
    rt.stop();
    console.log(JSON.stringify({ event: "shutdown.done" }));
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
