import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";

describe("loadConfig", () => {
  it("sem GROQ_API_KEY configura aiConfigured=false (dry-run, sem inventar)", () => {
    const cfg = loadConfig({
      GROQ_API_KEY: undefined,
      LOG_LEVEL: "info",
      MARKET_DATA_MODE: "noop",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(false);
    expect(cfg.groq.apiKey).toBeNull();
    expect(cfg.marketDataMode).toBe("noop");
  });

  it("com GROQ_API_KEY configura aiConfigured=true", () => {
    const cfg = loadConfig({
      GROQ_API_KEY: "   sk-fake  ",
      NODE_ENV: "test",
    });
    expect(cfg.aiConfigured).toBe(true);
    expect(cfg.groq.apiKey).toBe("sk-fake");
    expect(cfg.groq.model).toBe("openai/gpt-oss-120b");
  });

  it("aceita defaults quando env vazio", () => {
    const cfg = loadConfig({});
    expect(cfg.marketDataMode).toBe("noop");
    expect(cfg.database.path).toBe("tracecon.db");
    expect(cfg.nodeEnv).toBe("development");
  });

  it("rejeita MARKET_DATA_MODE inválido", () => {
    expect(() => loadConfig({ MARKET_DATA_MODE: "foo" })).toThrow();
  });
});
