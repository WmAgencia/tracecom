/**
 * CLI do serviço HTTP (Etapa 7).
 *
 *   npm run serve            → http://127.0.0.1:8788
 *   TRACECON_API_TOKEN=xxx   → protege /api/*
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";
import { TraceconHttpApi } from "../http/api";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

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

  const rt = createMarketRuntime(config, {
    symbols: [
      { symbol: "BTCUSDT", timeframe: "1m", native: true },
      { symbol: "BTCUSDT", timeframe: "1h", native: true },
      { symbol: "ETHUSDT", timeframe: "1h", native: true },
    ],
  });

  const api = new TraceconHttpApi({
    runtime: rt,
    port,
    apiToken: config.apiToken,
    publicDir,
    logger: {
      info: (m, meta) => console.log(JSON.stringify({ event: m, ...(meta as object) })),
      error: (m, meta) => console.error(JSON.stringify({ event: m, level: "error", ...(meta as object) })),
    },
  });

  if (rt.configured) await rt.start();
  api.listen();

  console.log(`TRACECON HTTP API → http://127.0.0.1:${port}`);
  if (config.apiToken) console.log("Token de API habilitado (/api/* exige Authorization: Bearer <token>).");
  else console.log("Sem TRACECON_API_TOKEN: /api/* aberto (somente dev).");

  process.on("SIGINT", () => {
    api.close();
    rt.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
