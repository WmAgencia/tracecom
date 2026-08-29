/**
 * Configuração de ambiente da TRACECON.
 *
 * SEGURANÇA: este módulo é a ÚNICA fronteira de acesso às variáveis de
 * ambiente e, consequentemente, às secrets (ANTHROPIC_API_KEY, etc.). Nenhum
 * outro módulo deve ler `process.env` diretamente. Código que roda no
 * navegador (extensão, frontend) NUNCA deverá importar este módulo.
 */
import "dotenv/config";
import { z } from "zod";

const MODES = ["noop", "mocked", "binance"] as const;

const envSchema = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // --- Anthropic (IA principal) -----------------------------------------
  // Aponta para qualquer base_url compatível com o Anthropic Messages API.
  // Default: api.anthropic.com. Gateways compatíveis (ex.: nexxus-pro)
  // sobrescrevem via ANTHROPIC_BASE_URL.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com"),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  // Limite de output tokens por chamada. Default 8192 (máximo padrão do
  // Anthropic Messages API). Até 64000 se a conta suportar extended output.
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  // Tenta liberar output estendido (>8k) via header `extra-allow-large-output-tokens`.
  // Default true: o cliente adiciona o header automaticamente quando maxTokens > 8192.
  ANTHROPIC_EXTENDED_OUTPUT: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  // Thinking blocks (raciocínio profundo antes da resposta visível). Default ON
  // com 8000 tokens de budget. Se o gateway rejeitar, o cliente faz fallback
  // automático sem thinking.
  ANTHROPIC_THINKING_ENABLED: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  ANTHROPIC_THINKING_BUDGET: z.coerce.number().int().positive().default(8000),
  // ----------------------------------------------------------------------
  DATABASE_PATH: z.string().default("tracecon.db"),
  MARKET_DATA_MODE: z.enum(MODES).default("noop"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRACECON_API_TOKEN: z.string().optional(),
});

export interface EnvConfig {
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly anthropic: {
    readonly apiKey: string | null;
    readonly baseUrl: string;
    readonly model: string;
    readonly maxTokens: number;
    readonly extendedOutput: boolean;
    readonly thinkingEnabled: boolean;
    readonly thinkingBudget: number;
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
 * `ANTHROPIC_API_KEY` ausente é aceito (não é violação) e resulta em
 * `aiConfigured = false` (modo dry-run, sem inventar dados).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const raw = envSchema.parse({
    LOG_LEVEL: env.LOG_LEVEL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
    ANTHROPIC_MAX_TOKENS: env.ANTHROPIC_MAX_TOKENS,
    ANTHROPIC_EXTENDED_OUTPUT: env.ANTHROPIC_EXTENDED_OUTPUT,
    ANTHROPIC_THINKING_ENABLED: env.ANTHROPIC_THINKING_ENABLED,
    ANTHROPIC_THINKING_BUDGET: env.ANTHROPIC_THINKING_BUDGET,
    DATABASE_PATH: env.DATABASE_PATH,
    MARKET_DATA_MODE: env.MARKET_DATA_MODE,
    NODE_ENV: env.NODE_ENV,
    TRACECON_API_TOKEN: env.TRACECON_API_TOKEN,
  });

  const apiKey = raw.ANTHROPIC_API_KEY?.trim() || null;
  const baseUrl = raw.ANTHROPIC_BASE_URL.trim().replace(/\/$/, "");

  return {
    logLevel: raw.LOG_LEVEL,
    anthropic: {
      apiKey,
      baseUrl,
      model: raw.ANTHROPIC_MODEL,
      maxTokens: raw.ANTHROPIC_MAX_TOKENS,
      extendedOutput: raw.ANTHROPIC_EXTENDED_OUTPUT,
      thinkingEnabled: raw.ANTHROPIC_THINKING_ENABLED,
      thinkingBudget: raw.ANTHROPIC_THINKING_BUDGET,
    },
    database: { path: raw.DATABASE_PATH },
    marketDataMode: raw.MARKET_DATA_MODE,
    nodeEnv: raw.NODE_ENV,
    apiToken: raw.TRACECON_API_TOKEN?.trim() || null,
    aiConfigured: apiKey !== null,
  };
}