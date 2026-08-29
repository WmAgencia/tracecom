import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";

describe("loadConfig", () => {
  it("sem ANTHROPIC_API_KEY configura aiConfigured=false (dry-run, sem inventar)", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: undefined,
      LOG_LEVEL: "info",
      MARKET_DATA_MODE: "noop",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(false);
    expect(cfg.anthropic.apiKey).toBeNull();
    expect(cfg.marketDataMode).toBe("noop");
  });

  it("com ANTHROPIC_API_KEY configura aiConfigured=true", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "   sk-fake  ",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(true);
    expect(cfg.anthropic.apiKey).toBe("sk-fake");
    expect(cfg.anthropic.model).toBe("claude-opus-5");
    expect(cfg.anthropic.maxTokens).toBe(8192);
  });

  it("respeita ANTHROPIC_MAX_TOKENS custom", () => {
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
});