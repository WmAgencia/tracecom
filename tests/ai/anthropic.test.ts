import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient } from "../../src/ai/anthropic";

/**
 * Testes do cliente Anthropic usando `fetch` mockado. Não fazem rede.
 * Cobre: cabeçalhos, wire format (tool_use + tool_result), parseamento,
 * thinking blocks, extended output (>8k tokens) e fallbacks graciosos.
 */
describe("AnthropicClient", () => {
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

  it("envia headers e URL esperados para um gateway custom (ex.: nexxus-pro)", async () => {
    const fetcher = mockFetchOnce({
      id: "msg_1",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const c = new AnthropicClient({
      apiKey: "sk-test",
      model: "claude-opus-5",
      baseUrl: "https://api.nexxus-pro.site",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await c.chat([
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.nexxus-pro.site/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["extra-allow-large-output-tokens"]).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-opus-5");
    expect(body.system).toBe("s");
    expect(body.thinking).toBeUndefined();
  });

  it("envia thinking blocks quando habilitado (budget_tokens + temperature=1)", async () => {
    const fetcher = mockFetchOnce({
      content: [
        { type: "thinking", thinking: "raciocinei aqui..." },
        { type: "text", text: "resposta final" },
      ],
      stop_reason: "end_turn",
    });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: true, budgetTokens: 8000 },
    });
    const resp = await c.chat([{ role: "user", content: "x" }]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    expect(body.temperature).toBe(1);
    // max_tokens precisa acomodar thinking + resposta visível
    expect(body.max_tokens).toBeGreaterThan(8000);
    expect(resp.content).toBe("resposta final");
    expect(resp.thinking).toBe("raciocinei aqui...");
  });

  it("envia extended-output headers quando max_tokens > 8192", async () => {
    const fetcher = mockFetchOnce({ content: [], stop_reason: "end_turn" });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      maxTokens: 64000,
      extendedOutput: true,
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await c.chat([{ role: "user", content: "x" }]);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["extra-allow-large-output-tokens"]).toBe("true");
    expect(headers["anthropic-beta"]).toContain("extended-output");
  });

  it("faz fallback automático quando o gateway rejeita thinking", async () => {
    // 1ª chamada rejeitada (400 com "thinking" no erro); 2ª aceita
    let n = 0;
    const fetcher = vi.fn(async () => {
      n++;
      if (n === 1) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => JSON.stringify({ error: "thinking not supported" }),
          json: async () => ({ error: "thinking not supported" }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
        json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
      };
    });
    globalThis.fetch = fetcher as unknown as typeof fetch;
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: true, budgetTokens: 8000 },
    });
    const resp = await c.chat([{ role: "user", content: "x" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // 2ª chamada NÃO tem thinking
    const body2 = JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body2.thinking).toBeUndefined();
    expect(resp.content).toBe("ok");
    // Após fallback, cliente desliga thinking pra próximas chamadas
    const body3 = await c.chat([{ role: "user", content: "y" }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const body3wire = JSON.parse((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body as string);
    expect(body3wire.thinking).toBeUndefined();
  });

  it("faz fallback automático quando o gateway rejeita extended output (max_tokens > 8k)", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => {
      n++;
      if (n === 1) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => JSON.stringify({ error: "max_tokens too large for this account" }),
          json: async () => ({ error: "max_tokens too large for this account" }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
        json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
      };
    });
    globalThis.fetch = fetcher as unknown as typeof fetch;
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      maxTokens: 64000,
      extendedOutput: true,
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    const resp = await c.chat([{ role: "user", content: "x" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // 2ª chamada com max_tokens=8192 e sem headers extended
    const body2 = JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body2.max_tokens).toBe(8192);
    const headers2 = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers2["extra-allow-large-output-tokens"]).toBeUndefined();
    expect(resp.content).toBe("ok");
  });

  it("converte tool_calls do assistente em blocos tool_use no wire", async () => {
    const fetcher = mockFetchOnce({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
    });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await c.chat([
      { role: "system", content: "sys" },
      { role: "user", content: "look" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", name: "get_candles", arguments: '{"symbol":"BTCUSDT"}' }],
      },
      { role: "tool", tool_call_id: "t1", content: '{"availability":"AVAILABLE"}' },
    ]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "look" }] });
    expect(body.messages[1].content[0]).toMatchObject({
      type: "tool_use",
      id: "t1",
      name: "get_candles",
      input: { symbol: "BTCUSDT" },
    });
    expect(body.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      content: '{"availability":"AVAILABLE"}',
    });
  });

  it("parseia tool_use blocks na resposta para toolCalls normalizados", async () => {
    mockFetchOnce({
      content: [
        { type: "text", text: "Vou consultar." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "get_candles",
          input: { symbol: "ETHUSDT", timeframe: "1h" },
        },
      ],
      stop_reason: "tool_use",
    });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    const resp = await c.chat([{ role: "user", content: "olá" }], [
      { name: "get_candles", description: "d", parameters: { type: "object", properties: {} } },
    ]);
    expect(resp.content).toBe("Vou consultar.");
    expect(resp.stopReason).toBe("tool_use");
    expect(resp.toolCalls).toEqual([
      { id: "toolu_1", name: "get_candles", arguments: '{"symbol":"ETHUSDT","timeframe":"1h"}' },
    ]);
  });

  it("lança erro com corpo da resposta em HTTP não-2xx sem fallback aplicável", async () => {
    mockFetchOnce({ error: "invalid_api_key" }, 401);
    const c = new AnthropicClient({
      apiKey: "bad",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await expect(c.chat([{ role: "user", content: "x" }])).rejects.toThrow(/401/);
  });

  it("concatena múltiplos blocos de texto na resposta", async () => {
    mockFetchOnce({
      content: [{ type: "text", text: "abc" }, { type: "text", text: "def" }],
      stop_reason: "end_turn",
    });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    const resp = await c.chat([{ role: "user", content: "x" }]);
    expect(resp.content).toBe("abcdef");
  });

  it("envia tools com input_schema quando fornecidas", async () => {
    const fetcher = mockFetchOnce({ content: [], stop_reason: "end_turn" });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await c.chat([{ role: "user", content: "x" }], [
      {
        name: "get_volume",
        description: "vol",
        parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
      },
    ]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools).toEqual([
      {
        name: "get_volume",
        description: "vol",
        input_schema: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
      },
    ]);
  });

  it("envia max_tokens default 8192 quando sem thinking e sem extended", async () => {
    const fetcher = mockFetchOnce({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    const c = new AnthropicClient({
      apiKey: "k",
      model: "m",
      thinking: { enabled: false, budgetTokens: 8000 },
    });
    await c.chat([{ role: "user", content: "x" }]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.max_tokens).toBe(8192);
  });
});