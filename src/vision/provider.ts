/**
 * Boundary between visual perception and the decision agent.
 * A vision provider may observe a frame, but it never emits or executes an
 * order. Unknown fields remain unavailable instead of being guessed.
 */
export type ObservationAvailability = "OBSERVED" | "UNAVAILABLE";

export interface MarketObservation {
  readonly symbol: string | null;
  readonly marketType: string | null;
  readonly timeframe: string | null;
  readonly price: number | null;
  readonly timestamp: number | null;
  readonly availability: ObservationAvailability;
  readonly sources: readonly string[];
  readonly notes: readonly string[];
}

export interface VisionProviderInput {
  readonly imageUrl?: string | null;
  readonly imageDataUrl?: string | null;
  readonly context?: Record<string, unknown>;
}

export interface VisionProvider {
  readonly id: string;
  observe(input: VisionProviderInput): Promise<MarketObservation>;
}

const unavailable: MarketObservation = Object.freeze({
  symbol: null, marketType: null, timeframe: null, price: null, timestamp: null,
  availability: "UNAVAILABLE", sources: [], notes: ["VISION_UNAVAILABLE"],
});

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Provider for a Nexxus-compatible JSON endpoint. It is deliberately opt-in. */
export class NexxusVisionProvider implements VisionProvider {
  readonly id = "nexxus-vision";
  constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {}

  async observe(input: VisionProviderInput): Promise<MarketObservation> {
    const image = input.imageUrl || input.imageDataUrl;
    if (!image) return unavailable;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const fetcher = this.options.fetch ?? globalThis.fetch;
      const response = await fetcher(`${this.options.baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" }, signal: controller.signal,
        body: JSON.stringify({ model: this.options.model, max_tokens: 700, messages: [{ role: "user", content: [
          { type: "text", text: "Return JSON only: symbol, marketType, timeframe, price, timestamp. Use null when the image does not prove a field." },
          { type: "image", source: input.imageUrl ? { type: "url", url: image } : { type: "base64", media_type: "image/jpeg", data: image.replace(/^data:image\/[^;]+;base64,/, "") } },
        ] }] }),
      });
      if (!response.ok) return { ...unavailable, notes: [`VISION_HTTP_${response.status}`] };
      const wire = await response.json() as { content?: Array<{ type?: string; text?: string }> };
      const text = (wire.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n").trim();
      let value: Record<string, unknown>;
      try { value = JSON.parse(text) as Record<string, unknown>; } catch { return { ...unavailable, notes: ["VISION_INVALID_JSON"] }; }
      const symbol = typeof value.symbol === "string" ? value.symbol.slice(0, 32) : null;
      const marketType = typeof value.marketType === "string" ? value.marketType.slice(0, 20) : null;
      const timeframe = typeof value.timeframe === "string" ? value.timeframe.slice(0, 16) : null;
      const price = finite(value.price);
      const timestamp = finite(value.timestamp);
      const observed = symbol !== null || marketType !== null || timeframe !== null || price !== null;
      return { symbol, marketType, timeframe, price, timestamp, availability: observed ? "OBSERVED" : "UNAVAILABLE", sources: ["nexxus-vision"], notes: observed ? [] : ["NO_VERIFIABLE_FIELDS"] };
    } finally { clearTimeout(timer); }
  }
}
