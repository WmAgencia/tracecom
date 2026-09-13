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

  it("keeps a 503 unavailable and never leaks stale fields", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ symbol: "EURUSD", price: 1.2 }), { status: 503 }));
    const provider = new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch });
    const result = await provider.observe({ imageUrl: "https://example.test/frame.jpg" });
    expect(result).toMatchObject({ availability: "UNAVAILABLE", symbol: null, price: null, timestamp: null });
    expect(result.notes).toContain("VISION_HTTP_503");
  });

  it("contains malformed/flickering provider output instead of inventing a decision", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{\"symbol\":\"EURUSD\"" }] }), { status: 200 }));
    const result = await new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch }).observe({ imageUrl: "https://example.test/frame.jpg" });
    expect(result).toMatchObject({ availability: "UNAVAILABLE", symbol: null, marketType: null, price: null });
    expect(result.notes).toContain("VISION_INVALID_JSON");
  });

  it("isolates concurrent frame requests", async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      const id = ++call;
      await new Promise((resolve) => setTimeout(resolve, id === 1 ? 5 : 0));
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ symbol: id === 1 ? "EURUSD" : "GBPUSD", price: id }) }] }), { status: 200 });
    });
    const provider = new NexxusVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "vision", fetch });
    const [first, second] = await Promise.all([
      provider.observe({ imageUrl: "https://example.test/a.jpg" }),
      provider.observe({ imageUrl: "https://example.test/b.jpg" }),
    ]);
    expect(first.symbol).toBe("EURUSD");
    expect(second.symbol).toBe("GBPUSD");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
