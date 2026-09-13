import { createHash } from "node:crypto";

type VisionInput = {
  imageUrl?: string | null;
  imageDataUrl?: string | null;
  context?: Record<string, unknown>;
  frameId?: string | null;
};

type ImagePayload = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string; byteLength: number; hash: string };

type ParseResult = { value: Record<string, unknown> | null; mode: "DIRECT" | "REPAIRED" | "FAILED" };

function parseObject(text: string): ParseResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    return { value: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null, mode: "DIRECT" };
  } catch { /* controlled envelope repair below */ }
  const start = cleaned.indexOf("{");
  if (start >= 0) {
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index]!;
      if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        try {
          const value = JSON.parse(cleaned.slice(start, index + 1)) as unknown;
          return { value: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null, mode: "REPAIRED" };
        } catch { break; }
      }
    }
  }
  return { value: null, mode: "FAILED" };
}

function textOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null; }
function numberOrNull(value: unknown): number | null { const parsed = typeof value === "string" && value.trim() ? Number(value.replace(",", ".")) : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function boolOrNull(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function enumOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null { const normalized = typeof value === "string" ? value.toUpperCase() : ""; return allowed.includes(normalized as T) ? normalized as T : null; }

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
      const text = `RETURN JSON ONLY. No markdown fences, no explanation. Return this shape: {"status":"AVAILABLE|PARTIAL|UNAVAILABLE","asset":{"value":string|null,"confidence":number|null},"symbol":string|null,"marketType":string|null,"timeframe":string|null,"timeframeSeconds":number|null,"visibleWindowSeconds":number|null,"price":number|null,"timestamp":number|null,"trend":"BULLISH|BEARISH|SIDEWAYS|UNCLEAR|null","structure":string|null,"momentum":"UP|DOWN|NEUTRAL|UNCLEAR|null","volatility":"LOW|NORMAL|HIGH|UNCLEAR|null","supportResistance":[],"breakoutState":"UP|DOWN|NONE|UNCLEAR|null","visibleCandleCount":number|null,"visualQuality":{"candlesReadable":boolean|null,"assetReadable":boolean|null,"priceReadable":boolean|null},"manualPosition":{"state":"NO_POSITION|POSSIBLE_POSITION|POSITION_CONFIRMED|WAITING_SETTLEMENT|SETTLED","direction":"BUY|SELL|UNKNOWN","confidence":number|null,"evidence":[]},"evidence":[]}. Only confirm a manual position when platform-specific visual evidence exists; never infer it from generic pixel movement. Use null/UNCLEAR when unreadable. The image is a sanitized chart crop. Sanitized context: ${JSON.stringify(input.context ?? {}).slice(0, 4000)}`;
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
      const parsed = parseObject(answer);
      const value = parsed.value ?? {};
      const asset = value.asset && typeof value.asset === "object" ? value.asset as Record<string, unknown> : {};
      const symbol = textOrNull(value.symbol) || textOrNull(asset.value);
      const marketType = textOrNull(value.marketType);
      const timeframe = textOrNull(value.timeframe);
      const timeframeSeconds = numberOrNull(value.timeframeSeconds) ?? (timeframe === "5s" ? 5 : timeframe === "1m" ? 60 : null);
      const price = numberOrNull(value.price);
      const timestamp = numberOrNull(value.timestamp);
      const trend = enumOrNull(value.trend, ["BULLISH", "BEARISH", "SIDEWAYS", "UNCLEAR"] as const);
      const momentum = enumOrNull(value.momentum, ["UP", "DOWN", "NEUTRAL", "UNCLEAR"] as const);
      const volatility = enumOrNull(value.volatility, ["LOW", "NORMAL", "HIGH", "UNCLEAR"] as const);
      const breakoutState = enumOrNull(value.breakoutState, ["UP", "DOWN", "NONE", "UNCLEAR"] as const);
      const visualQuality = value.visualQuality && typeof value.visualQuality === "object" ? value.visualQuality as Record<string, unknown> : {};
      const evidence = Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
      const hasUsefulFields = Boolean(symbol || marketType || timeframe || timeframeSeconds || price || trend || momentum || volatility || breakoutState || textOrNull(value.structure) || evidence.length);
      const availability = parsed.mode === "FAILED" ? "UNAVAILABLE" : hasUsefulFields ? "PARTIAL" : "UNAVAILABLE";
      const manualRaw = value.manualPosition && typeof value.manualPosition === "object" ? value.manualPosition as Record<string, unknown> : {};
      const manualState = ["NO_POSITION", "POSSIBLE_POSITION", "POSITION_CONFIRMED", "WAITING_SETTLEMENT", "SETTLED"].includes(String(manualRaw.state)) ? String(manualRaw.state) : "NO_POSITION";
      const manualDirection = manualRaw.direction === "BUY" || manualRaw.direction === "SELL" ? manualRaw.direction : "UNKNOWN";
      const observation = { symbol, marketType, timeframe, timeframeSeconds, visibleWindowSeconds: numberOrNull(value.visibleWindowSeconds), price, timestamp, trend, structure: textOrNull(value.structure), momentum, volatility, supportResistance: Array.isArray(value.supportResistance) ? value.supportResistance.slice(0, 8) : [], breakoutState, visibleCandleCount: numberOrNull(value.visibleCandleCount), visualQuality: { candlesReadable: boolOrNull(visualQuality.candlesReadable), assetReadable: boolOrNull(visualQuality.assetReadable), priceReadable: boolOrNull(visualQuality.priceReadable) }, manualPosition: { state: manualState, direction: manualDirection, confidence: numberOrNull(manualRaw.confidence), evidence: Array.isArray(manualRaw.evidence) ? manualRaw.evidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [] }, evidence, availability, imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, parseMode: parsed.mode, sources: ["nexxus-vision", "sanitized-crop-base64"], notes: parsed.mode === "FAILED" ? ["VISION_INVALID_JSON"] : availability === "PARTIAL" ? [parsed.mode === "REPAIRED" ? "VISION_PARSE_REPAIRED" : "VISION_PARSE_DIRECT"] : ["IMAGE_PROVIDED_FIELDS_UNREADABLE"] };
      if (parsed.mode === "FAILED") console.info("VISION_PARSE_FAILED", JSON.stringify({ ...meta, status: response.status }));
      console.info(parsed.mode === "DIRECT" ? "VISION_PARSE_DIRECT" : "VISION_PARSE_REPAIRED", JSON.stringify({ ...meta, status: response.status, availability: observation.availability }));
      console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, status: response.status, parsed: parsed.mode !== "FAILED", parseMode: parsed.mode, availability: observation.availability }));
      return observation;
    } catch (error) {
      console.info("VISION_PROVIDER_RESPONSE", JSON.stringify({ ...meta, parsed: false, error: error instanceof Error ? error.name : "VISION_ERROR" }));
      return { availability: "UNAVAILABLE", imageProvided: true, imageBytes: image!.byteLength, imageHash: image!.hash, sources: [], notes: ["VISION_ERROR"] };
    } finally { clearTimeout(timer); }
  }
}
