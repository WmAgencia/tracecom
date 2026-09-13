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
});
