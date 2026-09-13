/** Server-side Fable vision adapter. The API key never reaches the extension. */

export type FableDecision = "BUY" | "SELL" | "WAIT";

export interface FableTraderInput {
  readonly snapshot: Record<string, unknown>;
  readonly chartImage?: string | null;
  readonly chartImages?: readonly { readonly label: string; readonly dataUrl: string }[];
}

export interface FableTraderAnalysis {
  readonly decision: FableDecision;
  readonly confidence: number;
  readonly pBuy: number | null;
  readonly pSell: number | null;
  readonly pWait: number | null;
  readonly dataQuality: number;
  readonly imageUsed: boolean;
  readonly supportingFactors: readonly string[];
  readonly opposingFactors: readonly string[];
  readonly rationale: string;
  readonly trend: string;
  readonly structure: string;
  readonly momentum: string;
  readonly volatility: string;
  readonly supportResistance: readonly string[];
  readonly candlePatterns: readonly string[];
  readonly breakoutState: string;
  readonly exhaustionState: string;
  readonly observations: readonly string[];
  readonly riskFlags: readonly string[];
  readonly visualBias: "BUY" | "SELL" | "NEUTRAL";
  readonly quantBias: "BUY" | "SELL" | "NEUTRAL" | "UNAVAILABLE";
  readonly confluence: number;
  readonly framesUsed: number;
  readonly summary: string;
  readonly analysisId: string;
  readonly pipeline: {
    readonly dataValidation: "PASS" | "WAIT";
    readonly visualAnalysis: "PASS" | "WAIT";
    readonly quantAnalysis: "PASS" | "LIMITED";
    readonly confluence: "PASS" | "CONFLICT" | "UNAVAILABLE";
    readonly finalDecision: FableDecision;
  };
  readonly analysisQuality: "HIGH" | "MEDIUM" | "LOW";
  readonly agentAction: "CONTINUE_ANALYSIS" | "REQUEST_ZOOM_OUT" | "REQUEST_ZOOM_IN" | "WAIT";
  readonly guidanceMessage: string | null;
  readonly chartView: { readonly score: number; readonly historicalContext: number; readonly recentDetail: number; readonly visibleCandleCount: number | null };
  readonly marketContext: { readonly symbol: string; readonly marketType: string; readonly visualTimeframe: string; readonly displayedStake: string; readonly expiration: string; readonly payout: string; readonly confidence: number; readonly sources: readonly string[] };
}

export interface FableTraderResponse {
  readonly analysis: FableTraderAnalysis;
  readonly model: { readonly modelId: string; readonly displayName: string };
}

interface FableTraderOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

const jsonHeaders = {
  "content-type": "application/json",
  "anthropic-version": "2023-06-01",
};

function clamp(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed: unknown = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function normalizeAnalysis(value: Record<string, unknown> | null, imageUsed: boolean, framesUsed: number, analysisId: string, baseQuality: number, quantitativeAvailable: boolean, cropValid: boolean): FableTraderAnalysis {
  const decision = value?.decision === "BUY" || value?.decision === "SELL" ? value.decision : "WAIT";
  const rawProbabilities = [Number(value?.pBuy), Number(value?.pSell), Number(value?.pWait)];
  const probabilityTotal = rawProbabilities.every((item) => Number.isFinite(item) && item >= 0) ? rawProbabilities.reduce((sum, item) => sum + item, 0) : 0;
  const probabilities = probabilityTotal > 0 ? rawProbabilities.map((item) => item / probabilityTotal) : [null, null, null];
  const visualBias = value?.visualBias === "BUY" || value?.visualBias === "SELL" ? value.visualBias : "NEUTRAL";
  const quantBias = value?.quantBias === "BUY" || value?.quantBias === "SELL" || value?.quantBias === "NEUTRAL" ? value.quantBias : "UNAVAILABLE";
  return {
    decision,
    confidence: clamp(value?.confidence, 0),
    pBuy: probabilities[0] ?? null,
    pSell: probabilities[1] ?? null,
    pWait: probabilities[2] ?? null,
    dataQuality: Math.min(baseQuality, clamp(value?.dataQuality, baseQuality)),
    imageUsed: value?.imageUsed === true && imageUsed,
    supportingFactors: list(value?.supportingFactors),
    opposingFactors: list(value?.opposingFactors),
    rationale: typeof value?.rationale === "string" ? value.rationale.slice(0, 600) : "FABLE_INVALID_OR_INCOMPLETE_RESPONSE",
    trend: typeof value?.trend === "string" ? value.trend.slice(0, 80) : "UNKNOWN",
    structure: typeof value?.structure === "string" ? value.structure.slice(0, 80) : "UNKNOWN",
    momentum: typeof value?.momentum === "string" ? value.momentum.slice(0, 80) : "UNKNOWN",
    volatility: typeof value?.volatility === "string" ? value.volatility.slice(0, 80) : "UNKNOWN",
    supportResistance: list(value?.supportResistance),
    candlePatterns: list(value?.candlePatterns),
    breakoutState: typeof value?.breakoutState === "string" ? value.breakoutState.slice(0, 80) : "UNKNOWN",
    exhaustionState: typeof value?.exhaustionState === "string" ? value.exhaustionState.slice(0, 80) : "UNKNOWN",
    observations: list(value?.observations),
    riskFlags: list(value?.riskFlags),
    visualBias,
    quantBias,
    confluence: clamp(value?.confluence, visualBias !== "NEUTRAL" && quantBias === visualBias ? 0.8 : 0),
    framesUsed: Math.max(0, Math.min(4, Number(value?.framesUsed) || framesUsed)),
    summary: typeof value?.summary === "string" ? value.summary.slice(0, 260) : "WAIT: evidência insuficiente para uma decisão operacional.",
    analysisId,
    pipeline: {
      dataValidation: imageUsed && cropValid && framesUsed > 0 ? "PASS" : "WAIT",
      visualAnalysis: imageUsed ? "PASS" : "WAIT",
      quantAnalysis: quantitativeAvailable ? "PASS" : "LIMITED",
      confluence: quantBias === "UNAVAILABLE" ? "UNAVAILABLE" : quantBias === visualBias ? "PASS" : "CONFLICT",
      finalDecision: decision,
    },
    analysisQuality: value?.analysisQuality === "HIGH" || value?.analysisQuality === "MEDIUM" ? value.analysisQuality : "LOW",
    agentAction: value?.agentAction === "REQUEST_ZOOM_OUT" || value?.agentAction === "REQUEST_ZOOM_IN" || value?.agentAction === "CONTINUE_ANALYSIS" ? value.agentAction : "WAIT",
    guidanceMessage: typeof value?.guidanceMessage === "string" ? value.guidanceMessage.slice(0, 240) : null,
    chartView: {
      score: Math.round(Math.max(0, Math.min(100, Number(value?.chartViewQualityScore) || baseQuality * 100))),
      historicalContext: Math.round(Math.max(0, Math.min(100, Number(value?.historicalContextScore) || baseQuality * 100))),
      recentDetail: Math.round(Math.max(0, Math.min(100, Number(value?.recentDetailScore) || baseQuality * 100))),
      visibleCandleCount: Number.isFinite(Number(value?.visibleCandleCount)) ? Number(value?.visibleCandleCount) : null,
    },
    marketContext: {
      symbol: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).symbol === "string" ? String((value.marketContext as Record<string, unknown>).symbol) : "UNAVAILABLE",
      marketType: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).marketType === "string" ? String((value.marketContext as Record<string, unknown>).marketType) : "UNAVAILABLE",
      visualTimeframe: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).visualTimeframe === "string" ? String((value.marketContext as Record<string, unknown>).visualTimeframe) : "UNAVAILABLE",
      displayedStake: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).displayedStake === "string" ? String((value.marketContext as Record<string, unknown>).displayedStake) : "UNAVAILABLE",
      expiration: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).expiration === "string" ? String((value.marketContext as Record<string, unknown>).expiration) : "UNAVAILABLE",
      payout: typeof value?.marketContext === "object" && value.marketContext && typeof (value.marketContext as Record<string, unknown>).payout === "string" ? String((value.marketContext as Record<string, unknown>).payout) : "UNAVAILABLE",
      confidence: typeof value?.marketContext === "object" && value.marketContext ? clamp((value.marketContext as Record<string, unknown>).confidence, 0) : 0,
      sources: typeof value?.marketContext === "object" && value.marketContext ? list((value.marketContext as Record<string, unknown>).sources) : [],
    },
  };
}

function imageBlock(chartImage: string | null | undefined): { block: Record<string, unknown>; included: boolean } {
  if (typeof chartImage !== "string") return { block: {}, included: false };
  const match = chartImage.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  const mediaType = match?.[1];
  const data = match?.[2];
  if (!mediaType || !data || data.length > 7_000_000) return { block: {}, included: false };
  return { block: { type: "image", source: { type: "base64", media_type: mediaType, data } }, included: true };
}

export class FableTraderClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: FableTraderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async analyze(input: FableTraderInput): Promise<FableTraderResponse> {
    const images = (input.chartImages?.length ? input.chartImages : input.chartImage ? [{ label: "current", dataUrl: input.chartImage }] : [])
      .slice(0, 4)
      .map((item) => ({ label: item.label, ...imageBlock(item.dataUrl) }))
      .filter((item) => item.included);
    const currentImage = images.find((item) => item.label === "current") || images[0];
    const imageUsed = !!currentImage;
    const framesUsed = images.length;
    const snapshot = input.snapshot;
    const chartFrame = snapshot.chartFrame && typeof snapshot.chartFrame === "object" ? snapshot.chartFrame as Record<string, unknown> : {};
    const quantitative = snapshot.quantitativeFeatures && typeof snapshot.quantitativeFeatures === "object" ? snapshot.quantitativeFeatures as Record<string, unknown> : {};
    const crop = chartFrame.crop && typeof chartFrame.crop === "object" ? chartFrame.crop as Record<string, unknown> : {};
    const baseQuality = Math.min(1, (imageUsed ? 0.55 : 0) + (framesUsed >= 2 ? 0.15 : 0) + (framesUsed >= 4 ? 0.1 : 0) + (Number.isFinite(Number(crop.width)) ? 0.1 : 0) + (quantitative.availability === "READY" ? 0.1 : 0));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const prompt = [
      "Analyze the current IQ Option chart for a one-minute paper signal.",
      "Use only the supplied chart image and normalized market snapshot.",
      "Write all human-readable fields in Brazilian Portuguese. Keep enum values BUY, SELL, WAIT, NEUTRAL and UNAVAILABLE unchanged.",
      "Return JSON only with exactly: decision (BUY, SELL, or WAIT), confidence (0..1), pBuy (0..1), pSell (0..1), pWait (0..1), dataQuality (0..1), imageUsed (boolean), framesUsed (integer), visualBias (BUY, SELL, NEUTRAL), quantBias (BUY, SELL, NEUTRAL, UNAVAILABLE), confluence (0..1), trend, structure, momentum, volatility, supportResistance (string[]), candlePatterns (string[]), breakoutState, exhaustionState, supportingFactors (string[]), opposingFactors (string[]), observations (string[]), riskFlags (string[]), analysisQuality (HIGH, MEDIUM, LOW), agentAction (CONTINUE_ANALYSIS, REQUEST_ZOOM_OUT, REQUEST_ZOOM_IN, WAIT), guidanceMessage, chartViewQualityScore, historicalContextScore, recentDetailScore, visibleCandleCount, marketContext (symbol, marketType, visualTimeframe, displayedStake, expiration, payout, confidence, sources), summary (maximum two short sentences), rationale (string). Ensure pBuy+pSell+pWait equals 1 when data is sufficient.",
      "If the image is missing, stale, ambiguous, or the active asset is not trustworthy, return WAIT.",
      `NORMALIZED_SNAPSHOT=${JSON.stringify(input.snapshot).slice(0, 45_000)}`,
    ].join("\n");
    const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
    for (const image of images) {
      content.push({ type: "text", text: `TEMPORAL_FRAME=${image.label}` });
      content.push(image.block);
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { ...jsonHeaders, "x-api-key": this.apiKey },
        body: JSON.stringify({ model: this.model, max_tokens: 1_500, messages: [{ role: "user", content }] }),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`FABLE_HTTP_${response.status}: ${body.slice(0, 300)}`);
      const parsed = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }> };
      const text = (parsed.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
      return { analysis: normalizeAnalysis(extractJson(text), imageUsed, framesUsed, typeof snapshot.analysisId === "string" ? snapshot.analysisId : "unknown", baseQuality, quantitative.availability === "READY", Number.isFinite(Number(crop.width)) && Number.isFinite(Number(crop.height))), model: { modelId: this.model, displayName: "Fable 5.1" } };
    } finally {
      clearTimeout(timer);
    }
  }
}
