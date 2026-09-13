import { describe, expect, it, vi } from "vitest";
import { NexxusVisionProvider } from "../../src/vision/provider";

describe("NexxusVisionProvider", () => {
  it("normalizes a verified observation", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"symbol":"EURUSD","marketType":"OTC","timeframe":"1m","price":1.1234,"timestamp":1700000000}' }] }), { status: 200 }));
    const result = await new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch }).observe({ imageUrl: "https://example.test/frame.jpg" });
    expect(result).toMatchObject({ symbol: "EURUSD", marketType: "OTC", timeframe: "1m", price: 1.1234, availability: "OBSERVED" });
  });
  it("does not fabricate on provider errors", async () => {
    const fetch = vi.fn(async () => new Response("bad", { status: 400 }));
    const result = await new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch }).observe({ imageUrl: "https://example.test/frame.jpg" });
    expect(result.availability).toBe("UNAVAILABLE");
    expect(result.symbol).toBeNull();
  });
  it("does not request without an image", async () => {
    const fetch = vi.fn();
    const result = await new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch }).observe({});
    expect(result.availability).toBe("UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
  });
});
