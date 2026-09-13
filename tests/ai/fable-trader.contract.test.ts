import { afterEach, describe, expect, it, vi } from "vitest";
import { FableTraderClient } from "../../src/ai/fable-trader";

const snapshot = { analysisId: "contract", chartFrame: { crop: { width: 100, height: 100 } } };
const image = (label: string) => ({ label, dataUrl: `data:image/jpeg;base64,${Buffer.from(label).toString("base64")}` });

afterEach(() => vi.restoreAllMocks());

describe("Fable vision frame contract", () => {
  it.each([0, 1, 2, 3, 4])("serializes %i frame(s) without inventing image evidence", async (count) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: count ? "BUY" : "WAIT", confidence: count ? .7 : 0, pBuy: count ? .7 : 0, pSell: 0, pWait: count ? .3 : 1, imageUsed: count > 0, framesUsed: count, visualBias: count ? "BUY" : "NEUTRAL", quantBias: "UNAVAILABLE" }) }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await new FableTraderClient({ apiKey: "test", baseUrl: "https://provider.invalid", model: "claude-fable-5-1" }).analyze({ snapshot, chartImages: Array.from({ length: count }, (_, i) => image(`f${i}`)) });
    expect(result.analysis.framesUsed).toBe(count);
    expect(result.analysis.imageUsed).toBe(count > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const content = request.messages[0].content as Array<{ type: string; source?: { type: string; data?: string } }>;
    expect(content.filter((part) => part.type === "image")).toHaveLength(count);
    expect(content.filter((part) => part.type === "image").every((part) => part.source?.type === "base64")).toBe(true);
  });

  it("uses the Anthropic messages endpoint and preserves the selected model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: "WAIT", confidence: 0, pWait: 1, imageUsed: false, visualBias: "NEUTRAL", quantBias: "UNAVAILABLE" }) }] }), { status: 200 }));
    const client = new FableTraderClient({ apiKey: "test", baseUrl: "https://provider.invalid/", model: "claude-fable-5-1" });
    await client.analyze({ snapshot, chartImage: image("current").dataUrl });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://provider.invalid/v1/messages");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test");
    expect(JSON.parse(String(init?.body)).model).toBe("claude-fable-5-1");
  });

  it("does not invent probabilities or image evidence from malformed structured output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "not-json" }] }), { status: 200 }));
    const result = await new FableTraderClient({ apiKey: "test", baseUrl: "https://provider.invalid", model: "claude-fable-5-1" }).analyze({ snapshot, chartImage: image("current").dataUrl });
    expect(result.analysis.decision).toBe("WAIT");
    expect(result.analysis.pBuy).toBeNull();
    expect(result.analysis.pSell).toBeNull();
    expect(result.analysis.pWait).toBeNull();
    expect(result.analysis.imageUsed).toBe(false);
    expect(result.analysis.pipeline.finalDecision).toBe("WAIT");
  });

  it("keeps provider failures as errors instead of converting them into WAIT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid payload" } }), { status: 400 }));
    await expect(new FableTraderClient({ apiKey: "test", baseUrl: "https://provider.invalid", model: "claude-fable-5-1" }).analyze({ snapshot, chartImage: image("current").dataUrl })).rejects.toThrow("FABLE_HTTP_400");
  });

  it("preserves visual market metadata and normalizes its probability distribution", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: "BUY", confidence: .8, pBuy: 8, pSell: 1, pWait: 1, imageUsed: true, visualBias: "BUY", quantBias: "BUY", marketContext: { symbol: "EUR/USD", marketType: "OTC", visualTimeframe: "1m", displayedStake: "$20", expiration: "60s", payout: "91%", confidence: .9, sources: ["header", "chart"] } }) }] }), { status: 200 }));
    const result = await new FableTraderClient({ apiKey: "test", baseUrl: "https://provider.invalid", model: "claude-fable-5-1" }).analyze({ snapshot, chartImage: image("current").dataUrl });
    expect(result.analysis.marketContext).toMatchObject({ symbol: "EUR/USD", marketType: "OTC", visualTimeframe: "1m", expiration: "60s", payout: "91%" });
    expect((result.analysis.pBuy ?? 0) + (result.analysis.pSell ?? 0) + (result.analysis.pWait ?? 0)).toBeCloseTo(1);
    expect(result.analysis.pBuy).toBeCloseTo(.8);
  });
});
