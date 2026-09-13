import { afterEach, describe, expect, it, vi } from "vitest";
import { NexxusVisionProvider } from "../../src/vision/provider";
import { NexxusVisionProvider as ServerlessVisionProvider } from "../../api/vision-provider";

afterEach(() => vi.unstubAllGlobals());

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

  it("sends real sanitized crop bytes to the serverless Claude Vision adapter", async () => {
    const dataUrl = "data:image/jpeg;base64,AAECAwQF";
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"symbol":"USDCAD","timeframe":"1m"}' }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new ServerlessVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "claude-opus-5" }).observe({ imageDataUrl: dataUrl, frameId: "frame-real-bytes" });
    const call = fetch.mock.calls[0] as unknown as [unknown, { body?: unknown }];
    const request = JSON.parse(String(call[1].body));
    const image = request.messages[0].content.find((block: { type: string }) => block.type === "image");
    expect(result).toMatchObject({ availability: "PARTIAL", imageProvided: true, imageBytes: 6, imageHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(image).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAECAwQF" } });
  });

  it("repairs a fenced/prefixed response and preserves partial visual facts", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: 'Here is the visual read:\n```json\n{"trend":"BEARISH","momentum":"DOWN","asset":{"value":"USDCAD","confidence":"0.8"}}\n```' }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new ServerlessVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "claude-opus-5" }).observe({ imageDataUrl: "data:image/jpeg;base64,AAECAwQF", frameId: "frame-repaired" });
    expect(result).toMatchObject({ availability: "PARTIAL", parseMode: "REPAIRED", symbol: "USDCAD", trend: "BEARISH", momentum: "DOWN", imageProvided: true });
  });

  it("keeps image provenance when the provider returns malformed JSON", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{trend: BEARISH" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new ServerlessVisionProvider({ apiKey: "redacted", baseUrl: "https://provider.test", model: "claude-opus-5" }).observe({ imageDataUrl: "data:image/jpeg;base64,AAECAwQF", frameId: "frame-invalid" });
    expect(result).toMatchObject({ availability: "UNAVAILABLE", parseMode: "FAILED", imageProvided: true, imageBytes: 6 });
    expect(result.notes).toContain("VISION_INVALID_JSON");
  });
});
