import { createHash } from "node:crypto";

type VisionInput = {
  imageUrl?: string | null;
  imageDataUrl?: string | null;
  context?: Record<string, unknown>;
  frameId?: string | null;
};

type ImagePayload = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string; byteLength: number; hash: string };

function parseImage(input: VisionInput): ImagePayload | null {
  if (typeof input.imageDataUrl !== "string") return null;
  const match = input.imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mediaType = match[1] as ImagePayload["mediaType"];
  const base64 = match[2]!;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return null;
  return { mediaType, base64, byteLength: bytes.length, hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
}

export class NexxusVisionProvider {
  constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; timeoutMs?: number }) {}

  async observe(input: VisionInput): Promise<Record<string, unknown>> {
    const image = parseImage(input);
    if (!image && !input.imageUrl) {
      console.warn("VISION_IMAGE_MISSING", JSON.stringify({ frameId: input.frameId || null }));
      return { availability: "UNAVAILABLE", imageProvided: false, sources: [], notes: ["VISION_IMAGE_MISSING"] };
    }
    if (!image && input.imageUrl) {
      console.warn("VISION_IMAGE_URL_REJECTED", JSON.stringify({ frameId: input.frameId || null }));
      return { availability: "UNAVAILABLE", imageProvided: false, sources: [], notes: ["VISION_IMAGE_DATA_REQUIRED"] };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    const meta = { frameId: input.frameId || null, provider: "nexxus", model: this.options.model, hasImage: true, mimeType: image!.mediaType, imageBytes: image!.byteLength, imageHash: image!.hash };
    console.info("VISION_IMAGE_RECEIVED", JSON.stringify(meta));
    console.info("VISION_PROVIDER_REQUEST", JSON.stringify(meta));
    try {
      const text = `Return JSON only: symbol, marketType, timeframe, price, timestamp, trend, structure, momentum, volatility, supportResistance, breakoutState, visibleCandleCount. Use null when a field is not readable. The image was provided as a sanitized chart crop. Sanitized context: ${JSON.stringify(input.context ?? {}).slice(0, 4000)}`;
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
        signal: controller.signal,
        body: JSON.stringify({ model: this.options.model, max_tokens: 700, messages: [{ role: "user", content: [{ type: "text", text }, { type: "image", source: { type: "base64", media_type: image!.mediaType, data: image!.base64 } }] }] }),
      });
      if (!response.ok) {
        console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, status: response.status, parsed: false }));
        return { availability: "UNAVAILABLE", imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, sources: [], notes: [`VISION_HTTP_${response.status}`] };
      }
      const wire = await response.json() as { content?: Array<{ type?: string; text?: string }> };
      const answer = (wire.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
      let value: Record<string, unknown>;
      try { value = JSON.parse(answer) as Record<string, unknown>; } catch {
        console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, status: response.status, parsed: false }));
        return { availability: "UNAVAILABLE", imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, sources: [], notes: ["VISION_INVALID_JSON"] };
      }
      const symbol = typeof value.symbol === "string" ? value.symbol.slice(0, 32) : null;
      const marketType = typeof value.marketType === "string" ? value.marketType.slice(0, 20) : null;
      const timeframe = typeof value.timeframe === "string" ? value.timeframe.slice(0, 16) : null;
      const price = Number.isFinite(Number(value.price)) ? Number(value.price) : null;
      const timestamp = Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : null;
      const observed = symbol !== null || marketType !== null || timeframe !== null || price !== null;
      const observation = { symbol, marketType, timeframe, price, timestamp, trend: value.trend ?? null, structure: value.structure ?? null, momentum: value.momentum ?? null, volatility: value.volatility ?? null, supportResistance: value.supportResistance ?? [], breakoutState: value.breakoutState ?? null, visibleCandleCount: Number.isFinite(Number(value.visibleCandleCount)) ? Number(value.visibleCandleCount) : null, availability: observed ? "OBSERVED" : "UNAVAILABLE", imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, sources: ["nexxus-vision", "sanitized-crop-base64"], notes: observed ? [] : ["IMAGE_PROVIDED_FIELDS_UNREADABLE"] };
      console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, status: response.status, parsed: true, availability: observation.availability }));
      return observation;
    } catch (error) {
      console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, parsed: false, error: error instanceof Error ? error.name : "VISION_ERROR" }));
      return { availability: "UNAVAILABLE", imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, sources: [], notes: ["VISION_ERROR"] };
    } finally { clearTimeout(timer); }
  }
}
