/**
 * Provider swap: Anthropic retirado do runtime do relay; openCodeGo/deepseek-v4.1-flash e o primario.
 * Prova: default do provider/modelo, fallback de env (AI_PROVIDER/AI_MODEL/OPENCODE_GO_API_KEY),
 * ausencia de ANTHROPIC_API_KEY nao quebra o boot e a key nunca e serializada (redaction).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const goModule = await import("../../relay/opencode-go.mjs");
const {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  maskProviderKey,
  resolveProviderConfig,
  safeProviderError,
} = goModule as unknown as {
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
  maskProviderKey: (key: unknown) => string;
  resolveProviderConfig: (input: { dbConfig?: Record<string, unknown> | null; env?: Record<string, unknown> }) => { provider: string; model: string | null; apiKey: string } | null;
  safeProviderError: (text: unknown) => string | null;
};

const relayDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../relay");
const readRelay = (name: string) => readFileSync(path.join(relayDir, name), "utf8");

describe("default do provider — openCodeGo / deepseek-v4.1-flash", () => {
  it("provider e modelo default sao os validados em producao", () => {
    expect(DEFAULT_PROVIDER).toBe("openCodeGo");
    expect(DEFAULT_MODEL).toBe("deepseek-v4.1-flash");
  });
  it("sem DB e sem env nao existe fallback algum (nem Anthropic)", () => {
    expect(resolveProviderConfig({ dbConfig: null, env: {} })).toBeNull();
    expect(resolveProviderConfig({ dbConfig: null, env: { ANTHROPIC_API_KEY: "sk-ant-legacy" } })).toBeNull();
  });
});

describe("resolucao de config — DB autoritativa, env como resiliencia", () => {
  const env = { OPENCODE_GO_API_KEY: "sk-env-1234567890abcdef", AI_PROVIDER: "openCodeGo", AI_MODEL: "deepseek-v4.1-flash" };
  it("DB CONFIGURED vence o env", () => {
    const resolved = resolveProviderConfig({ dbConfig: { provider: "openCodeGo", model: "db-model", apiKey: "sk-db-1234567890" }, env });
    expect(resolved).toMatchObject({ provider: "openCodeGo", model: "db-model", apiKey: "sk-db-1234567890" });
  });
  it("sem DB valido usa env (OPENCODE_GO_API_KEY/AI_PROVIDER/AI_MODEL)", () => {
    expect(resolveProviderConfig({ dbConfig: null, env })).toMatchObject({ provider: "openCodeGo", model: "deepseek-v4.1-flash", apiKey: env.OPENCODE_GO_API_KEY });
    expect(resolveProviderConfig({ dbConfig: { provider: "openCodeGo", model: "x", apiKey: "curta" }, env })).toMatchObject({ provider: "openCodeGo", model: "deepseek-v4.1-flash" });
  });
  it("env sem key valida → null (fail-closed, nunca inventa provider)", () => {
    expect(resolveProviderConfig({ dbConfig: null, env: { OPENCODE_GO_API_KEY: "short" } })).toBeNull();
    expect(resolveProviderConfig({ dbConfig: null, env: { AI_PROVIDER: "openCodeGo" } })).toBeNull();
    expect(resolveProviderConfig({ dbConfig: null, env: {} })).toBeNull();
  });
  it("AI_PROVIDER default e openCodeGo quando ausente", () => {
    const resolved = resolveProviderConfig({ dbConfig: null, env: { OPENCODE_GO_API_KEY: "sk-env-1234567890abcdef" } });
    expect(resolved?.provider).toBe("openCodeGo");
  });
});

describe("seguranca — a key nunca e serializada", () => {
  it("maskProviderKey so devolve os 4 ultimos caracteres", () => {
    const key = "sk-1234567890abcdefGHIJ";
    const masked = maskProviderKey(key);
    expect(masked).toBe("••••GHIJ");
    expect(masked).not.toContain(key);
    expect(JSON.stringify({ status: "CONFIGURED", maskedKey: masked })).not.toContain("1234567890abcdef");
  });
  it("key curta/ausente nao vaza valor", () => {
    expect(maskProviderKey("")).toBe("••••");
    expect(maskProviderKey(null)).toBe("••••");
    expect(maskProviderKey(undefined)).toBe("••••");
  });
  it("erro do provider e redigido (defesa em profundidade)", () => {
    const error = safeProviderError('{"error":{"message":"invalid api key sk-fixture-NOT-A-REAL-KEY-1234567890"}}');
    expect(error).not.toContain("sk-fixture");
    expect(error).toContain("sk-***");
  });
  it("server.mjs usa o mascaramento compartilhado e nao corta a key inline", () => {
    const server = readRelay("server.mjs");
    const providerRoute = server.slice(server.indexOf("'/api/ai/provider' && req.method === 'GET'"), server.indexOf("'/api/iq/connect'"));
    expect(providerRoute).toContain("maskProviderKey(");
    expect(providerRoute).not.toContain("slice(-4)");
  });
});

describe("boot — ANTHROPIC_API_KEY nao e mais requisito do relay", () => {
  it("runtime do relay nao referencia ANTHROPIC", () => {
    const adapter = readRelay("opencode-go.mjs");
    const server = readRelay("server.mjs");
    expect(adapter).not.toMatch(/ANTHROPIC_API_KEY|process\.env\.ANTHROPIC/);
    expect(server).not.toMatch(/ANTHROPIC_API_KEY|process\.env\.ANTHROPIC/);
  });
  it("importar o adapter sem ANTHROPIC_API_KEY nao lanca", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // @ts-expect-error - relay ESM sem tipagem (validado em runtime)
      const fresh = await import("../../relay/opencode-go.mjs");
      expect(fresh.DEFAULT_MODEL).toBe("deepseek-v4.1-flash");
      expect(fresh.resolveProviderConfig({ dbConfig: { provider: "openCodeGo", model: "deepseek-v4.1-flash", apiKey: "sk-db-1234567890" } })).toMatchObject({ provider: "openCodeGo" });
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
