import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";

describe("loadConfig", () => {
  it("sem chave de IA configura aiConfigured=false (dry-run, sem inventar)", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: undefined,
      OPENCODE_GO_API_KEY: undefined,
      LOG_LEVEL: "info",
      MARKET_DATA_MODE: "noop",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(false);
    expect(cfg.ai.provider).toBe("openCodeGo");
    expect(cfg.ai.apiKey).toBeNull();
    expect(cfg.ai.model).toBe("deepseek-v4.1-flash");
    expect(cfg.marketDataMode).toBe("noop");
  });

  it("boota sem ANTHROPIC_API_KEY: provider default é openCodeGo", () => {
    const cfg = loadConfig({ NODE_ENV: "test" });
    expect(cfg.ai.provider).toBe("openCodeGo");
    expect(cfg.ai.model).toBe("deepseek-v4.1-flash");
    expect(cfg.anthropic.apiKey).toBeNull();
    expect(cfg.aiConfigured).toBe(false);
  });

  it("com OPENCODE_GO_API_KEY configura aiConfigured=true e normaliza espaços", () => {
    const cfg = loadConfig({
      OPENCODE_GO_API_KEY: "   sk-fake  ",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(true);
    expect(cfg.ai.provider).toBe("openCodeGo");
    expect(cfg.ai.apiKey).toBe("sk-fake");
    expect(cfg.ai.model).toBe("deepseek-v4.1-flash");
    expect(cfg.ai.openCodeGo.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(cfg.ai.openCodeGo.maxTokens).toBe(8192);
    expect(cfg.ai.openCodeGo.timeoutMs).toBe(60_000);
  });

  it("ANTHROPIC_API_KEY sozinha NÃO configura o provider default (legado não é fallback silencioso)", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "sk-ant", NODE_ENV: "test" });
    expect(cfg.aiConfigured).toBe(false);
    expect(cfg.ai.apiKey).toBeNull();
    expect(cfg.ai.provider).toBe("openCodeGo");
    // A chave legada continua disponível para re-habilitação explícita.
    expect(cfg.anthropic.apiKey).toBe("sk-ant");
  });

  it("AI_PROVIDER=anthropic + ANTHROPIC_API_KEY habilita o modo legado", () => {
    const cfg = loadConfig({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(true);
    expect(cfg.ai.provider).toBe("anthropic");
    expect(cfg.ai.apiKey).toBe("sk-ant");
    expect(cfg.ai.model).toBe("claude-opus-5");
  });

  it("respeita AI_MODEL explícito para qualquer provider", () => {
    const cfg = loadConfig({
      OPENCODE_GO_API_KEY: "sk-test",
      AI_MODEL: "deepseek-v4.1-flash-preview",
      NODE_ENV: "test",
    });
    expect(cfg.ai.model).toBe("deepseek-v4.1-flash-preview");
  });

  it("respeita OPENCODE_GO_BASE_URL/MAX_TOKENS/TIMEOUT custom", () => {
    const cfg = loadConfig({
      OPENCODE_GO_BASE_URL: "https://gateway.example.test/v1/",
      OPENCODE_GO_MAX_TOKENS: "4096",
      OPENCODE_GO_TIMEOUT_MS: "15000",
      NODE_ENV: "test",
    });
    expect(cfg.ai.openCodeGo.baseUrl).toBe("https://gateway.example.test/v1");
    expect(cfg.ai.openCodeGo.maxTokens).toBe(4096);
    expect(cfg.ai.openCodeGo.timeoutMs).toBe(15000);
  });

  it("AI_PROVIDER inválido é rejeitado", () => {
    expect(() => loadConfig({ AI_PROVIDER: "openai" })).toThrow();
  });

  it("respeita ANTHROPIC_MAX_TOKENS custom (legado)", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "sk-test",
      ANTHROPIC_MAX_TOKENS: "32000",
      NODE_ENV: "test",
    });
    expect(cfg.anthropic.maxTokens).toBe(32000);
  });

  it("extendedOutput e thinking têm defaults seguros (true / 8000)", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "sk-test", NODE_ENV: "test" });
    expect(cfg.anthropic.extendedOutput).toBe(true);
    expect(cfg.anthropic.thinkingEnabled).toBe(true);
    expect(cfg.anthropic.thinkingBudget).toBe(8000);
  });

  it("aceita desabilitar thinking/extended via env", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "sk-test",
      ANTHROPIC_THINKING_ENABLED: "false",
      ANTHROPIC_EXTENDED_OUTPUT: "0",
      ANTHROPIC_THINKING_BUDGET: "2000",
      NODE_ENV: "test",
    });
    expect(cfg.anthropic.thinkingEnabled).toBe(false);
    expect(cfg.anthropic.extendedOutput).toBe(false);
    expect(cfg.anthropic.thinkingBudget).toBe(2000);
  });

  it("respeita ANTHROPIC_BASE_URL custom (ex.: gateway nexxus-pro)", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "sk-test",
      ANTHROPIC_BASE_URL: "https://api.nexxus-pro.site/",
      NODE_ENV: "test",
    });
    expect(cfg.anthropic.baseUrl).toBe("https://api.nexxus-pro.site");
  });

  it("aceita defaults quando env vazio", () => {
    const cfg = loadConfig({});
    expect(cfg.marketDataMode).toBe("noop");
    expect(cfg.database.path).toBe("tracecon.db");
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.anthropic.baseUrl).toBe("https://api.anthropic.com");
  });

  it("rejeita MARKET_DATA_MODE inválido", () => {
    expect(() => loadConfig({ MARKET_DATA_MODE: "foo" })).toThrow();
  });

  it("mantém Forex indisponível sem as duas credenciais OANDA", () => {
    const cfg = loadConfig({ OANDA_API_KEY: " key ", NODE_ENV: "test" });
    expect(cfg.oanda.apiKey).toBe("key");
    expect(cfg.oanda.accountId).toBeNull();
    expect(cfg.oanda.baseUrl).toBe("https://api-fxpractice.oanda.com/v3");
  });
});
