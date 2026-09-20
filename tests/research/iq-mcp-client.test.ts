/**
 * IQ MCP CLIENT — testes do payload oficial (place_trade) e limites, com fetch mockado.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const mcp = await import("../../relay/iq-mcp-client.mjs");

const { IqMcpClient, IQ_MCP_ENDPOINTS } = mcp;

const mockFetch = (handler: any) => {
  const calls: any[] = [];
  const impl = async (url: string, options: any) => { const body = JSON.parse(options.body); calls.push({ url, headers: options.headers, body }); return handler(body, calls.length); };
  return { impl, calls };
};

const jsonResponse = (payload: any, headers: Record<string, string> = {}) => ({ status: 200, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(payload) });

describe("IQ MCP client — Blitz oficial", () => {
  it("faz handshake (initialize + initialized) antes do tools/call e usa a sessao", async () => {
    const { impl, calls } = mockFetch((body: any, n: number) => {
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05" } }, { "mcp-session-id": "sess-1" });
      if (body.method === "notifications/initialized") return jsonResponse({});
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { assets: [{ asset_id: 77, name: "EUR/GBP (OTC)", is_open: true, profit_percent: 91, expiration_sizes_seconds: [30, 45, 60] }] } } });
    });
    const client = new IqMcpClient({ token: "tok", endpoint: IQ_MCP_ENDPOINTS.blitz, fetchImpl: impl } as any);
    (client as any).fetchImpl = impl;
    globalThis.fetch = impl as any;
    const assets = await client.listAssets();
    expect(assets).toHaveLength(1);
    expect(calls.map((call: any) => call.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(calls[2].headers["mcp-session-id"]).toBe("sess-1");
  });

  it("place_trade envia exatamente os campos oficiais e normaliza direcao", async () => {
    const { impl, calls } = mockFetch((body: any) => {
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} }, { "mcp-session-id": "s" });
      if (body.method === "notifications/initialized") return jsonResponse({});
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { position_id: 12345 } } });
    });
    globalThis.fetch = impl as any;
    const client = new IqMcpClient({ token: "tok", endpoint: IQ_MCP_ENDPOINTS.blitz });
    const result = await client.placeTrade({ balanceId: 9, assetId: 77, direction: "SELL", amount: 10, profitPercent: 91, expirationSize: 45 });
    expect(result.position_id).toBe(12345);
    const call = calls.find((entry: any) => entry.body.method === "tools/call");
    expect(call.body.params.name).toBe("place_trade");
    expect(call.body.params.arguments).toEqual({ balance_id: 9, asset_id: 77, direction: "put", amount: 10, profit_percent: 91, expiration_size: 45 });
  });

  it("sem token falha fail-closed e nunca inventa ativo", async () => {
    const client = new IqMcpClient({ token: null, endpoint: IQ_MCP_ENDPOINTS.blitz });
    expect(client.enabled).toBe(false);
    await expect(client.listAssets()).rejects.toMatchObject({ code: "IQ_MCP_TOKEN_MISSING" });
  });

  it("limite de escrita 10/min e respeitado", async () => {
    const { impl } = mockFetch((body: any) => {
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} }, { "mcp-session-id": "s" });
      if (body.method === "notifications/initialized") return jsonResponse({});
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { position_id: 1 } } });
    });
    globalThis.fetch = impl as any;
    let clock = 1_000_000;
    const client = new IqMcpClient({ token: "tok", endpoint: IQ_MCP_ENDPOINTS.blitz, now: () => clock });
    for (let index = 0; index < 10; index += 1) await client.placeTrade({ balanceId: 1, assetId: 77, direction: "BUY", amount: 10, profitPercent: 90, expirationSize: 45 });
    await expect(client.placeTrade({ balanceId: 1, assetId: 77, direction: "BUY", amount: 10, profitPercent: 90, expirationSize: 45 })).rejects.toMatchObject({ code: "IQ_MCP_WRITE_RATE_LIMIT" });
    clock += 61_000;
    await expect(client.placeTrade({ balanceId: 1, assetId: 77, direction: "BUY", amount: 10, profitPercent: 90, expirationSize: 45 })).resolves.toBeTruthy();
  });
});
