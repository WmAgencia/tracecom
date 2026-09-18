import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenCodeGoClient,
  OPENCODE_GO_DEFAULT_BASE_URL,
  OPENCODE_GO_DEFAULT_MODEL,
  sessionForOpenCodeGo,
} from "../../src/ai/opencode-go";
import { createAiClient } from "../../src/ai/client";
import { createLogger, redact } from "../../src/observability/logger";

/**
 * Testes do cliente OpenCode Go (provider PADRÃO) usando `fetch` mockado.
 * Não fazem rede. Cobrem: URL/headers/body, wire format OpenAI (tools),
 * parseamento, fallback para Static sem chave e redação de segredos.
 */
describe("OpenCodeGoClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: async () => JSON.stringify(body),
      json: async () => body,
    })) as unknown as typeof fetch;
    globalThis.fetch = fn as typeof fetch;
    return fn as unknown as ReturnType<typeof vi.fn>;
  }

  it("envia URL, headers (Bearer + session) e body corretos", async () => {
    const fetcher = mockFetchOnce({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });
    const client = new OpenCodeGoClient({ apiKey: "sk-test-key", model: OPENCODE_GO_DEFAULT_MODEL });
    const response = await client.chat(
      [
        { role: "system", content: "s" },
        { role: "user", content: "hi" },
      ],
      [
        {
          name: "get_candles",
          description: "candles",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        },
      ],
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${OPENCODE_GO_DEFAULT_BASE_URL}/chat/completions`);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-opencode-session"]).toMatch(/^tc-[0-9a-f]{16}$/);
    expect(headers["x-opencode-session"]).not.toContain("sk-test-key");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_candles",
          description: "candles",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        },
      },
    ]);
    expect(response.content).toBe("ok");
    expect(response.finishReason).toBe("stop");
    expect(response.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
  });

  it("converte tool_calls do assistente e tool results no wire OpenAI", async () => {
    const fetcher = mockFetchOnce({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] });
    const client = new OpenCodeGoClient({ apiKey: "k", model: "m" });
    await client.chat([
      { role: "user", content: "look" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", name: "get_candles", arguments: '{"symbol":"BTCUSDT"}' }],
      },
      { role: "tool", tool_call_id: "t1", content: '{"availability":"AVAILABLE"}' },
    ]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "t1", type: "function", function: { name: "get_candles", arguments: '{"symbol":"BTCUSDT"}' } }],
    });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "t1", content: '{"availability":"AVAILABLE"}' });
  });

  it("parseia tool_calls da resposta para toolCalls normalizados", async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "get_candles", arguments: '{"symbol":"ETHUSDT"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const client = new OpenCodeGoClient({ apiKey: "k", model: "m" });
    const response = await client.chat([{ role: "user", content: "olá" }]);
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toEqual([{ id: "call_1", name: "get_candles", arguments: '{"symbol":"ETHUSDT"}' }]);
  });

  it("nunca inclui a chave na mensagem de erro (redação)", async () => {
    const secret = "sk-test-SUPERSECRETVALUE1234567890";
    mockFetchOnce({ error: { message: `invalid key ${secret}`, authorization: `Bearer ${secret}` } }, 401);
    const client = new OpenCodeGoClient({ apiKey: secret, model: "m" });
    await expect(client.chat([{ role: "user", content: "x" }])).rejects.toThrow(/401/);
    try {
      await client.chat([{ role: "user", content: "x" }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).toContain("sk-***");
    }
  });

  it("sessionForOpenCodeGo não vaza a chave e é determinístico por base", () => {
    expect(sessionForOpenCodeGo("session-1")).toBe(sessionForOpenCodeGo("session-1"));
    expect(sessionForOpenCodeGo("session-1")).not.toBe(sessionForOpenCodeGo("session-2"));
    expect(sessionForOpenCodeGo("sk-secret")).not.toContain("sk-secret");
  });
});

describe("default provider (openCodeGo)", () => {
  const logger = createLogger({ logLevel: "error", nodeEnv: "test" });

  it("createAiClient default usa openCodeGo + AI_MODEL", () => {
    const ai = createAiClient({ apiKey: "sk-fake", model: OPENCODE_GO_DEFAULT_MODEL, logger });
    expect(ai.mode).toBe("openCodeGo");
    expect(ai.model).toBe("deepseek-v4.1-flash");
  });

  it("sem chave degrada para StaticAiClient (nunca crasha o trading)", () => {
    const ai = createAiClient({ apiKey: null, model: OPENCODE_GO_DEFAULT_MODEL, logger });
    expect(ai.mode).toBe("static");
  });

  it("redact remove segredos embutidos em strings de erro/log", () => {
    const secret = "sk-test-SUPERSECRETVALUE1234567890";
    const out = redact({ event: `OpenCode Go API 401: invalid ${secret}`, authorization: `Bearer ${secret}` }) as Record<string, unknown>;
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("sk-***");
  });
});
