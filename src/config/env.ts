/**
 * Configuração de ambiente da TRACECON.
 *
 * SEGURANÇA: este módulo é a ÚNICA fronteira de acesso às variáveis de
 * ambiente e, consequentemente, às secrets (OPENCODE_GO_API_KEY,
 * ANTHROPIC_API_KEY, etc.). Nenhum outro módulo deve ler `process.env`
 * diretamente. Código que roda no navegador (extensão, frontend) NUNCA deverá
 * importar este módulo.
 */
import "dotenv/config";
import { z } from "zod";
import { OPENCODE_GO_DEFAULT_MODEL } from "../ai/opencode-go";

const MODES = ["noop", "mocked", "binance", "forex", "auto", "iqoption"] as const;

const envSchema = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // --- Provider de IA ativo ----------------------------------------------
  // Default: openCodeGo. anthropic fica disponível, mas NÃO é default e não é
  // selecionado silenciosamente; exige AI_PROVIDER=anthropic explícito.
  AI_PROVIDER: z.enum(["openCodeGo", "anthropic", "static"]).default("openCodeGo"),
  // Modelo do provider ativo. Default por provider: deepseek-v4.1-flash
  // (openCodeGo) ou ANTHROPIC_MODEL (anthropic).
  AI_MODEL: z.string().trim().min(1).optional(),
  // --- OpenCode Go (IA principal / PADRÃO) --------------------------------
  // API OpenAI-compatible: POST {OPENCODE_GO_BASE_URL}/chat/completions.
  OPENCODE_GO_API_KEY: z.string().optional(),
  OPENCODE_GO_BASE_URL: z.string().url().default("https://opencode.ai/zen/go/v1"),
  OPENCODE_GO_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  OPENCODE_GO_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // --- Anthropic (IA LEGADA; só com AI_PROVIDER=anthropic) ----------------
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
  FABLE_API_KEY: z.string().optional(),
  FABLE_BASE_URL: z.string().url().default("https://api.nexxus-pro.site"),
  FABLE_MODEL: z.string().default("claude-fable-5-1"),
  // ----------------------------------------------------------------------
  // --- OANDA Forex v20 ---------------------------------------------------
  // Ambos são obrigatórios para ativar scans Forex reais. Se ausentes, a
  // camada fica explicitamente indisponível em vez de gerar dados de exemplo.
  OANDA_API_KEY: z.string().optional(),
  OANDA_ACCOUNT_ID: z.string().optional(),
  OANDA_BASE_URL: z.string().url().default("https://api-fxpractice.oanda.com/v3"),
  TRACE1M_PAIRS: z.string().default("EUR/USD,GBP/USD,USD/JPY,AUD/USD,USD/CAD,USD/CHF,NZD/USD"),
  TRACE1M_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(15000),
  DATABASE_PATH: z.string().default("tracecon.db"),
  MARKET_DATA_MODE: z.enum(MODES).default("noop"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRACECON_API_TOKEN: z.string().optional(),
});

export type AiProviderName = "openCodeGo" | "anthropic" | "static";

export interface EnvConfig {
  readonly logLevel: "debug" | "info" | "warn" | "error";
  /** Provider de IA ativo + modelo resolvido + chave ativa (nunca serializada). */
  readonly ai: {
    readonly provider: AiProviderName;
    readonly model: string;
    /** Chave do provider ativo; null quando ausente (degrada para dry-run). */
    readonly apiKey: string | null;
    readonly openCodeGo: {
      readonly baseUrl: string;
      readonly maxTokens: number;
      readonly timeoutMs: number;
    };
  };
  readonly anthropic: {
    readonly apiKey: string | null;
    readonly baseUrl: string;
    readonly model: string;
    readonly maxTokens: number;
    readonly extendedOutput: boolean;
    readonly thinkingEnabled: boolean;
    readonly thinkingBudget: number;
  };
  readonly fable: { readonly apiKey: string | null; readonly baseUrl: string; readonly model: string };
  readonly database: { readonly path: string };
  readonly oanda: { readonly apiKey: string | null; readonly accountId: string | null; readonly baseUrl: string };
  readonly trace1m: { readonly pairs: readonly string[]; readonly pollIntervalMs: number };
  readonly marketDataMode: (typeof MODES)[number];
  readonly nodeEnv: "development" | "test" | "production";
  /** Token opcional de API (server-side) exigido em /api/*. */
  readonly apiToken: string | null;
  /** true quando as secrets de IA estão disponíveis para uso real. */
  readonly aiConfigured: boolean;
}

/**
 * Lê e valida o ambiente. Lança erro apenas para violações de schema;
 * chave de IA ausente (OPENCODE_GO_API_KEY por padrão; ANTHROPIC_API_KEY no
 * modo legado) é aceita e resulta em `aiConfigured = false` (dry-run, sem
 * inventar dados). A ausência de chave NUNCA derruba o boot/trading.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const raw = envSchema.parse({
    LOG_LEVEL: env.LOG_LEVEL,
    AI_PROVIDER: env.AI_PROVIDER,
    AI_MODEL: env.AI_MODEL,
    OPENCODE_GO_API_KEY: env.OPENCODE_GO_API_KEY,
    OPENCODE_GO_BASE_URL: env.OPENCODE_GO_BASE_URL,
    OPENCODE_GO_MAX_TOKENS: env.OPENCODE_GO_MAX_TOKENS,
    OPENCODE_GO_TIMEOUT_MS: env.OPENCODE_GO_TIMEOUT_MS,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
    ANTHROPIC_MAX_TOKENS: env.ANTHROPIC_MAX_TOKENS,
    ANTHROPIC_EXTENDED_OUTPUT: env.ANTHROPIC_EXTENDED_OUTPUT,
    ANTHROPIC_THINKING_ENABLED: env.ANTHROPIC_THINKING_ENABLED,
    ANTHROPIC_THINKING_BUDGET: env.ANTHROPIC_THINKING_BUDGET,
    FABLE_API_KEY: env.FABLE_API_KEY,
    FABLE_BASE_URL: env.FABLE_BASE_URL,
    FABLE_MODEL: env.FABLE_MODEL,
    OANDA_API_KEY: env.OANDA_API_KEY,
    OANDA_ACCOUNT_ID: env.OANDA_ACCOUNT_ID,
    OANDA_BASE_URL: env.OANDA_BASE_URL,
    TRACE1M_PAIRS: env.TRACE1M_PAIRS,
    TRACE1M_POLL_INTERVAL_MS: env.TRACE1M_POLL_INTERVAL_MS,
    DATABASE_PATH: env.DATABASE_PATH,
    MARKET_DATA_MODE: env.MARKET_DATA_MODE,
    NODE_ENV: env.NODE_ENV,
    TRACECON_API_TOKEN: env.TRACECON_API_TOKEN,
  });

  const apiKey = raw.ANTHROPIC_API_KEY?.trim() || null;
  const baseUrl = raw.ANTHROPIC_BASE_URL.trim().replace(/\/$/, "");
  const openCodeGoApiKey = raw.OPENCODE_GO_API_KEY?.trim() || null;
  // Modelo do provider ativo: AI_MODEL explícito vence; senão o default de
  // cada provider (deepseek-v4.1-flash no OpenCode Go; ANTHROPIC_MODEL legado).
  const aiModel =
    raw.AI_MODEL ?? (raw.AI_PROVIDER === "anthropic" ? raw.ANTHROPIC_MODEL : OPENCODE_GO_DEFAULT_MODEL);
  const activeAiKey =
    raw.AI_PROVIDER === "openCodeGo"
      ? openCodeGoApiKey
      : raw.AI_PROVIDER === "anthropic"
        ? apiKey
        : null;

  return {
    logLevel: raw.LOG_LEVEL,
    ai: {
      provider: raw.AI_PROVIDER,
      model: aiModel,
      apiKey: activeAiKey,
      openCodeGo: {
        baseUrl: raw.OPENCODE_GO_BASE_URL.replace(/\/$/, ""),
        maxTokens: raw.OPENCODE_GO_MAX_TOKENS,
        timeoutMs: raw.OPENCODE_GO_TIMEOUT_MS,
      },
    },
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
    oanda: {
      apiKey: raw.OANDA_API_KEY?.trim() || null,
      accountId: raw.OANDA_ACCOUNT_ID?.trim() || null,
      baseUrl: raw.OANDA_BASE_URL.replace(/\/$/, ""),
    },
    fable: {
      apiKey: raw.FABLE_API_KEY?.trim() || null,
      baseUrl: raw.FABLE_BASE_URL.replace(/\/$/, ""),
      model: raw.FABLE_MODEL,
    },
    trace1m: { pairs: raw.TRACE1M_PAIRS.split(",").map((pair) => pair.trim()).filter(Boolean), pollIntervalMs: raw.TRACE1M_POLL_INTERVAL_MS },
    marketDataMode: raw.MARKET_DATA_MODE,
    nodeEnv: raw.NODE_ENV,
    apiToken: raw.TRACECON_API_TOKEN?.trim() || null,
    aiConfigured: activeAiKey !== null,
  };
}
