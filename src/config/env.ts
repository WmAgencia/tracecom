/**
 * Configuração de ambiente da TRACECON.
 *
 * SEGURANÇA: este módulo é a ÚNICA fronteira de acesso às variáveis de
 * ambiente e, consequentemente, às secrets (GROQ_API_KEY, etc.). Nenhum
 * outro módulo deve ler `process.env` diretamente. Código que roda no
 * navegador (extensão, frontend) NUNCA deverá importar este módulo.
 */
import "dotenv/config";
import { z } from "zod";

const MODES = ["noop", "mocked", "binance"] as const;

const envSchema = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  DATABASE_PATH: z.string().default("tracecon.db"),
  MARKET_DATA_MODE: z.enum(MODES).default("noop"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRACECON_API_TOKEN: z.string().optional(),
});

export interface EnvConfig {
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly groq: {
    readonly apiKey: string | null;
    readonly model: string;
  };
  readonly database: { readonly path: string };
  readonly marketDataMode: (typeof MODES)[number];
  readonly nodeEnv: "development" | "test" | "production";
  /** Token opcional de API (server-side) exigido em /api/*. */
  readonly apiToken: string | null;
  /** true quando as secrets de IA estão disponíveis para uso real. */
  readonly aiConfigured: boolean;
}

/**
 * Lê e valida o ambiente. Lança erro apenas para violações de schema;
 * `GROQ_API_KEY` ausente é aceito (não é violação) e resulta em
 * `aiConfigured = false` (modo dry-run, sem inventar dados).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const raw = envSchema.parse({
    LOG_LEVEL: env.LOG_LEVEL,
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_MODEL: env.GROQ_MODEL,
    DATABASE_PATH: env.DATABASE_PATH,
    MARKET_DATA_MODE: env.MARKET_DATA_MODE,
    NODE_ENV: env.NODE_ENV,
    TRACECON_API_TOKEN: env.TRACECON_API_TOKEN,
  });

  const apiKey = raw.GROQ_API_KEY?.trim() || null;

  return {
    logLevel: raw.LOG_LEVEL,
    groq: {
      apiKey,
      model: raw.GROQ_MODEL,
    },
    database: { path: raw.DATABASE_PATH },
    marketDataMode: raw.MARKET_DATA_MODE,
    nodeEnv: raw.NODE_ENV,
    apiToken: raw.TRACECON_API_TOKEN?.trim() || null,
    aiConfigured: apiKey !== null,
  };
}
