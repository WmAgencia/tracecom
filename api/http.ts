/**
 * Adaptador serverless da API TRACECON — para Vercel (API Routes).
 *
 * Servidor leve e autocontido: não importa o bundle do runtime principal (que
 * usa node:sqlite / import.meta.url / WebSocket, inadequados p/ serverless).
 * Expõe apenas os endpoints REST públicos de snapshot (mercado, contexto,
 * análise, notícias) via fetch direto + lógica mínima, sem persistência e
 * SEM inventar dados (provedores indisponíveis → unavailable).
 *
 * Para o backend completo (WebSocket, cold store, aprendizado), use o Railway
 * (processo long-running: `npm run serve`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { NexxusVisionProvider } from "./vision-provider.js";
import { handleLiveApi } from "./live-api.js";
import { applyTrainingAnalysis, createTrainingSession, evaluateVirtualTrades, trainingSummary, type TrainingSession, type VirtualTrade } from "../src/training/session.js";
import { TrainingStore } from "../src/training/store.js";
import { validatePriceObservation, type AcceptedObservation } from "../src/vision/price-lock.js";
import { buildFastDecision } from "../src/engine/fast-path.js";
import { settleTrade } from "../src/training/settlement.js";
import { runAudit, type AuditInput } from "../src/research/audit-engine.js";
import { compareVariants, DEFAULT_VARIANTS, replayEvent, runVariants, type ReplayEvent, type Variant } from "../src/research/replay-engine.js";
import { runAutopsy } from "../src/research/session-autopsy.js";
import { buildAgentRuns } from "../src/research/agent-runs.js";
import { buildFeatureSnapshot } from "../src/quant-v2/feature-engine.js";
import { quantShadowDecision } from "../src/quant-v2/quant-fusion.js";
import { analyzeTechnicalState } from "../src/vision/technical-analyst.js";
import { OperationalController } from "../src/vision/operational-controller.js";
import { decideOperationalGate, horizonCompatibility, makeSelection, type LatestOperationalSignal, type StrategySelection } from "../src/strategies/selection.js";

type FableImage = { label: string; dataUrl: string; frameId?: string; mimeType?: string; byteLength?: number; width?: number; height?: number; imageHash?: string };
const ephemeralImages = new Map<string, { bytes: Buffer; contentType: string; expires: number }>();
// Training sessions are durable: the relay PostgreSQL is the source of truth
// so a session survives cold starts and different serverless instances.
const trainingStore = new TrainingStore({ relayUrl: process.env.TRACECOM_LIVE_RELAY_URL, adminSecret: process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET });
const trainingMetrics = { created: 0, recoveries: 0, misses: 0 };
const priceMetrics = { valid: 0, rejected: 0, outliers: 0 };
const decisionEvents: Array<Record<string, unknown>> = [];
/** Serverless-local operational channels. Their event/snapshot contract is
 * deliberately transport-neutral so the relay can persist/recover them without
 * changing the signal state machine. These endpoints are paper-only. */
const operationalSessions = new Map<string, OperationalController>();
const latencySamples = new Map<string, number[]>();
function recordLatency(stage: string, value: number) { const rows = latencySamples.get(stage) ?? []; rows.push(Math.max(0, Math.round(value))); latencySamples.set(stage, rows.slice(-100)); }
function latencyStats(stage: string) { const values = [...(latencySamples.get(stage) ?? [])].sort((a, b) => a - b); if (!values.length) return { count: 0, min: null, max: null, avg: null, p50: null, p95: null, p99: null }; const at = (fraction: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]!; return { count: values.length, min: values[0]!, max: values.at(-1)!, avg: values.reduce((sum, value) => sum + value, 0) / values.length, p50: at(.5), p95: at(.95), p99: at(.99) }; }
function allLatencyStats() { return Object.fromEntries([...latencySamples.keys()].map((stage) => [stage, latencyStats(stage)])); }

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 35_000_000) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error("invalid_json_body"); }
}

function parseJsonText(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const value = JSON.parse(match[0]) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch { return null; }
  }
}

function safeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
}

function bounded(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}
function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Defesa em profundidade: remove padrões de chave de textos livres (corpos de
 * erro de provider, details de resposta). A chave NUNCA deve aparecer em
 * log, erro ou JSON. (O bundle serverless não importa `src/`.)
 */
function redactSecretPatterns(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_\-]{6,})/g, "sk-***")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***")
    .replace(/((?:x-api-key|x-relay-admin|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^"',\s}]{8,}/gi, "$1***");
}

type DebateAgent = { name: string; score: number; evidence: string[]; invalidators: string[]; timedOut: boolean };

async function runStructuredDebate(observation: Record<string, unknown> | null, pBuy: number | null, pSell: number | null, decision: "BUY" | "SELL" | "WAIT") {
  const started = Date.now();
  const trend = String(observation?.trend || "UNCLEAR");
  const momentum = String(observation?.momentum || "UNCLEAR");
  const breakout = String(observation?.breakoutState || "UNCLEAR");
  const availability = String(observation?.availability || "UNAVAILABLE");
  const commonRisk = availability === "UNAVAILABLE" ? ["vision_observation_unavailable"] : [];
  const [bull, bear, structure, risk] = await Promise.all([
    Promise.resolve<DebateAgent>({ name: "BULL_AGENT", score: Math.max(0, Math.min(1, (pBuy ?? 0) * .65 + (trend === "BULLISH" ? .2 : 0) + (momentum === "UP" ? .1 : 0) + (breakout === "UP" ? .05 : 0))), evidence: [trend === "BULLISH" ? "visual_trend_bullish" : "no_bullish_trend", momentum === "UP" ? "momentum_up" : "no_up_momentum"], invalidators: trend === "BEARISH" ? ["bearish_structure"] : [], timedOut: false }),
    Promise.resolve<DebateAgent>({ name: "BEAR_AGENT", score: Math.max(0, Math.min(1, (pSell ?? 0) * .65 + (trend === "BEARISH" ? .2 : 0) + (momentum === "DOWN" ? .1 : 0) + (breakout === "DOWN" ? .05 : 0))), evidence: [trend === "BEARISH" ? "visual_trend_bearish" : "no_bearish_trend", momentum === "DOWN" ? "momentum_down" : "no_down_momentum"], invalidators: trend === "BULLISH" ? ["bullish_structure"] : [], timedOut: false }),
    Promise.resolve<DebateAgent>({ name: "STRUCTURE_MOMENTUM_AGENT", score: availability === "UNAVAILABLE" ? 0 : .5 + (trend !== "UNCLEAR" ? .2 : 0) + (momentum !== "UNCLEAR" ? .15 : 0), evidence: [trend, momentum, breakout], invalidators: [], timedOut: false }),
    Promise.resolve<DebateAgent>({ name: "RISK_NO_TRADE_AGENT", score: availability === "UNAVAILABLE" ? 1 : trend === "SIDEWAYS" || momentum === "NEUTRAL" || momentum === "UNCLEAR" ? .7 : .25, evidence: commonRisk.concat(trend === "SIDEWAYS" ? ["sideways_market"] : []), invalidators: ["conflicting_or_late_evidence"], timedOut: false }),
  ]);
  const lean = pBuy === null || pSell === null || pBuy === pSell ? "NONE" : pBuy > pSell ? "BUY" : "SELL";
  const leanConfidence = pBuy === null || pSell === null ? 0 : Math.max(pBuy, pSell);
  return { agents: [bull, bear, structure, risk], arbiter: { decision, directionalLean: lean, leanConfidence, latencyMs: Date.now() - started, agentsCompleted: 4, agentsTimedOut: 0 } };
}

async function runAdversarialAdvocates(debate: { agents: DebateAgent[]; arbiter: { directionalLean: string; leanConfidence: number } }, observation: Record<string, unknown> | null) {
  const started = Date.now();
  const risk = debate.agents.find((agent) => agent.name === "RISK_NO_TRADE_AGENT");
  const structure = debate.agents.find((agent) => agent.name === "STRUCTURE_MOMENTUM_AGENT");
  const [bull, bear] = await Promise.all([
    Promise.resolve({ name: "BULL_ADVOCATE", bullConfidence: debate.agents.find((agent) => agent.name === "BULL_AGENT")?.score || 0, evidence: ["fusion_bull_case", String(observation?.trend || "UNCLEAR")], invalidators: risk?.evidence || [], regimeCompatibility: String(observation?.trend || "UNCLEAR") === "BULLISH" ? "COMPATIBLE" : "UNCLEAR", timedOut: false }),
    Promise.resolve({ name: "BEAR_ADVOCATE", bearConfidence: debate.agents.find((agent) => agent.name === "BEAR_AGENT")?.score || 0, evidence: ["fusion_bear_case", String(observation?.trend || "UNCLEAR")], invalidators: risk?.evidence || [], regimeCompatibility: String(observation?.trend || "UNCLEAR") === "BEARISH" ? "COMPATIBLE" : "UNCLEAR", timedOut: false }),
  ]);
  return { bull, bear, latencyMs: Date.now() - started, structureScore: structure?.score || 0, agentsCompleted: 2, agentsTimedOut: 0 };
}

function validImage(item: unknown): item is FableImage {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  const bytes = match ? Buffer.from(match[2]!, "base64") : null;
  return typeof value.label === "string" && Boolean(match) && Boolean(bytes?.length) && dataUrl.length <= 7_500_000 && (value.mimeType === undefined || value.mimeType === match![1]) && (value.width === undefined || Number(value.width) > 0) && (value.height === undefined || Number(value.height) > 0);
}

function imageMeta(image: FableImage) {
  const match = image.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  const bytes = match ? Buffer.from(match[2]!, "base64") : Buffer.alloc(0);
  const hash = bytes.length ? createHash("sha256").update(bytes).digest("hex").slice(0, 16) : null;
  return { frameId: image.frameId || null, mimeType: match?.[1] || image.mimeType || null, byteLength: bytes.length, width: image.width || null, height: image.height || null, hash, providedHashMatches: image.imageHash ? image.imageHash === hash : null };
}

function visionProxyUrl(blobUrl: string, validUntil: number): string {
  const payload = Buffer.from(blobUrl).toString("base64url");
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new Error("vision_storage_not_configured");
  const signature = createHmac("sha256", secret).update(`${payload}.${validUntil}`).digest("base64url");
  const origin = process.env.VISION_PROXY_ORIGIN || "https://tracecom.consecom.com.br";
  return `${origin}/api/vision/image?p=${encodeURIComponent(payload)}&e=${validUntil}&s=${encodeURIComponent(signature)}`;
}

function validVisionProxy(payload: string, expiry: string, signature: string): string | null {
  const validUntil = Number(expiry);
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret || !Number.isFinite(validUntil) || validUntil < Date.now() || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(`${payload}.${validUntil}`).digest("base64url");
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) return null;
  try {
    const url = Buffer.from(payload, "base64url").toString("utf8");
    return /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url) ? url : null;
  } catch { return null; }
}

async function temporaryVisionUrls(images: FableImage[]): Promise<{ images: Array<{ label: string; url: string }>; cleanup: () => Promise<void> }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("vision_storage_not_configured");
  const uploaded: string[] = [];
  const visualImages: Array<{ label: string; url: string }> = [];
  try {
    for (const image of images) {
      const match = image.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) continue;
      const mediaType = match[1]!; const base64 = match[2]!;
      const extension = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
      const blob = await put(`vision-ephemeral/${Date.now()}-${crypto.randomUUID()}.${extension}`, Buffer.from(base64, "base64"), {
        access: "private", addRandomSuffix: false, contentType: mediaType, cacheControlMaxAge: 0,
      });
      uploaded.push(blob.url);
      visualImages.push({ label: image.label, url: visionProxyUrl(blob.url, Date.now() + 60_000) });
    }
    return { images: visualImages, cleanup: async () => { if (uploaded.length) await del(uploaded); } };
  } catch (error) {
    if (uploaded.length) await del(uploaded).catch(() => undefined);
    // Do not leak URLs from a partially completed Blob upload into the
    // fallback request. Mixing transports makes the provider see duplicate
    // frames and can produce a misleading multimodal 422.
    visualImages.length = 0;
    // Fallback for suspended Blob stores: same-origin, signed, short-lived memory transport.
    const fallback: string[] = [];
    for (const image of images) {
      const match = image.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/); if (!match) continue;
      const id = crypto.randomUUID(); const expires = Date.now() + 60_000;
      ephemeralImages.set(id, { bytes: Buffer.from(match[2]!, "base64"), contentType: match[1]!, expires }); fallback.push(id);
      visualImages.push({ label: image.label, url: `${process.env.VISION_PROXY_ORIGIN || "https://tracecom.consecom.com.br"}/api/vision/image?m=${id}&e=${expires}` });
    }
    if (visualImages.length) return { images: visualImages, cleanup: async () => { for (const id of fallback) ephemeralImages.delete(id); } };
    throw error;
  }
}

async function fableVisionTrade(body: unknown): Promise<unknown> {
  // Provider default: openCodeGo (chave server-side no relay). Anthropic é
  // legado e só roda com AI_PROVIDER=anthropic explícito + FABLE_API_KEY.
  const legacyAnthropic = (process.env.AI_PROVIDER || "openCodeGo").trim() === "anthropic";
  const legacyApiKey = process.env.FABLE_API_KEY?.trim() || null;
  if (legacyAnthropic && !legacyApiKey) throw new Error("anthropic_not_configured");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("bad_request");
  const payload = body as Record<string, unknown>;
  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("snapshot_required");
  const images = (Array.isArray(payload.chartImages) ? payload.chartImages.filter(validImage) : []).slice(0, 4);
  if (!images.length && validImage({ label: "current", dataUrl: payload.chartImage })) images.push({ label: "current", dataUrl: String(payload.chartImage) });
  if (validImage({ label: "context", dataUrl: payload.contextImage }) && images.length < 4) {
    images.push({ label: "context", dataUrl: String(payload.contextImage) });
  }
  const snapshotObject = snapshot as Record<string, unknown>;
  const chartFrame = snapshotObject.chartFrame && typeof snapshotObject.chartFrame === "object" ? snapshotObject.chartFrame as Record<string, unknown> : {};
  const crop = chartFrame.crop && typeof chartFrame.crop === "object" ? chartFrame.crop as Record<string, unknown> : {};
  const quantitative = snapshotObject.quantitativeFeatures && typeof snapshotObject.quantitativeFeatures === "object" ? snapshotObject.quantitativeFeatures as Record<string, unknown> : {};
  const imageUsed = images.length > 0;
  const receivedImage = images[0] ? imageMeta(images[0]) : null;
  console.info("VISION_API_RECEIVED", JSON.stringify({ requestId: typeof payload.requestId === "string" ? payload.requestId : null, hasImage: Boolean(receivedImage?.byteLength), ...receivedImage }));
  if (!imageUsed || !receivedImage?.byteLength) throw new Error("VISION_IMAGE_MISSING");
  const baseQuality = Math.min(1, (imageUsed ? 0.55 : 0) + (images.length >= 2 ? 0.15 : 0) + (images.length >= 4 ? 0.1 : 0) + (Number.isFinite(Number(crop.width)) ? 0.1 : 0) + (quantitative.availability === "READY" ? 0.1 : 0));
  const visionEnabled = process.env.TRACECOM_VISION_ENABLED !== "false";
  const defaultAiModel = process.env.AI_MODEL?.trim() || "deepseek-v4.1-flash";
  const visionModel = process.env.TRACECOM_VISION_MODEL || defaultAiModel;
  const aiConfig = await readAiProviderConfig();
  const openCodeGoActive = aiConfig?.status === "CONFIGURED" && aiConfig.provider === "openCodeGo";
  // Sem fallback silencioso: se nem OpenCode Go nem o modo Anthropic legado
  // (explícito) estão configurados, falha fechado em vez de trocar de provider.
  if (!openCodeGoActive && !legacyAnthropic) throw new Error("ai_provider_not_configured");
  const openCodeModel = openCodeGoActive && typeof aiConfig?.model === "string" ? aiConfig.model : defaultAiModel;
  const pipelineStarted = Date.now();
  let visionLatencyMs: number | null = null;
  if (imageUsed && !visionEnabled) throw new Error("VISION_PROVIDER_NOT_CONFIGURED");
  let visionObservation: Record<string, unknown> | null = null;
  if (visionEnabled && images[0] && openCodeGoActive) {
    const visionStarted = Date.now();
    const proxy = await relayAdminPost("/api/ai/go/vision", { imageDataUrl: images[0].dataUrl, frameId: images[0].frameId, requestId: typeof payload.requestId === "string" ? payload.requestId : null, sessionContext: { sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, traceId: typeof snapshotObject.traceId === "string" ? snapshotObject.traceId : null, segmentId: typeof snapshotObject.segmentId === "string" ? snapshotObject.segmentId : null } }, 46_000);
    if (!proxy || proxy.status !== "OK" || !proxy.observation) throw new Error(`OPENCODE_GO_VISION_FAILED:${String(proxy?.reason || proxy?.status || "relay_unreachable").slice(0, 120)}`);
    visionObservation = proxy.observation as Record<string, unknown>;
    visionLatencyMs = Number(proxy.latencyMs) || Date.now() - visionStarted;
    recordLatency("vision", visionLatencyMs);
    console.info("OPENCODE_GO_VISION_ACTIVE", JSON.stringify({ model: proxy.model || openCodeModel, requestId: typeof payload.requestId === "string" ? payload.requestId : null, latencyMs: visionLatencyMs, sessionId: proxy.sessionId || null }));
  }
  let decisionAgent: Record<string, unknown> | null = null;
  let decisionTimestamps: Record<string, unknown> | null = null;
  let decisionFreshness: Record<string, unknown> | null = null;
  if (openCodeGoActive && visionObservation !== null) {
    const decisionStarted = Date.now();
    const decisionProxy = await relayAdminPost("/api/ai/go/decision", { frameCapturedAt: pipelineStarted, visionObservation, requestId: typeof payload.requestId === "string" ? payload.requestId : null, sessionContext: { sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, traceId: typeof snapshotObject.traceId === "string" ? snapshotObject.traceId : null, segmentId: typeof snapshotObject.segmentId === "string" ? snapshotObject.segmentId : null } }, 35_000);
    const decisionCompleted = Date.now();
    decisionAgent = decisionProxy && decisionProxy.decision && typeof decisionProxy.decision === "object" ? decisionProxy.decision as Record<string, unknown> : { action: "UNAVAILABLE", analysisConfidence: 0, estimatedWinProbability: null, primaryRisk: "DECISION_AGENT_UNAVAILABLE" };
    decisionFreshness = decisionProxy && decisionProxy.freshness && typeof decisionProxy.freshness === "object" ? decisionProxy.freshness as Record<string, unknown> : { fresh: false, reason: "FRESHNESS_UNAVAILABLE" };
    decisionTimestamps = { pipelineStartedAt: pipelineStarted, visionLatencyMs, decisionStartedAt: decisionStarted, decisionCompletedAt: decisionCompleted, decisionLatencyMs: decisionCompleted - decisionStarted, observationAgeMs: decisionProxy?.freshness && typeof decisionProxy.freshness === "object" ? (decisionProxy.freshness as Record<string, unknown>).observationAgeMs ?? null : null };
    console.info("DECISION_AGENT_ACTIVE", JSON.stringify({ action: decisionAgent.action, confidence: decisionAgent.analysisConfidence, fresh: decisionFreshness.fresh, decisionLatencyMs: decisionTimestamps.decisionLatencyMs }));
  }
  if (visionEnabled && images[0] && !openCodeGoActive && legacyAnthropic) {
    const visionStarted = Date.now();
    console.info("CLAUDE_VISION_REQUEST_STARTED", JSON.stringify({ requestId: typeof payload.requestId === "string" ? payload.requestId : null, model: visionModel, hasImage: true, imageBytes: receivedImage?.byteLength || 0, imageHash: receivedImage?.hash || null }));
    const observation = await new NexxusVisionProvider({ apiKey: legacyApiKey!, baseUrl: process.env.NEXXUS_BASE_URL || process.env.FABLE_BASE_URL || "https://api.nexxus-pro.site", model: visionModel }).observe({ imageDataUrl: images[0].dataUrl, frameId: images[0].frameId, context: snapshotObject });
    console.info("VISION_MODEL_RESPONSE_RECEIVED", JSON.stringify({ availability: observation.availability, sources: observation.sources, notes: observation.notes }));
    visionObservation = observation as unknown as Record<string, unknown>;
    console.info("MARKET_OBSERVATION_CREATED", JSON.stringify({ availability: observation.availability, imageProvided: observation.imageProvided === true, imageBytes: observation.imageBytes || 0, imageHash: observation.imageHash || null }));
    visionLatencyMs = Date.now() - visionStarted; recordLatency("vision", visionLatencyMs); console.info("VISION_LATENCY", JSON.stringify({ frameId: receivedImage?.frameId || null, latencyMs: visionLatencyMs }));
  }
  const existingResolution = snapshotObject.assetResolution && typeof snapshotObject.assetResolution === "object" ? snapshotObject.assetResolution as Record<string, unknown> : {};
  const visionAsset = typeof visionObservation?.symbol === "string" ? visionObservation.symbol : null;
  const uiAsset = typeof existingResolution.uiAsset === "string" ? existingResolution.uiAsset : null;
  const sessionAsset = typeof existingResolution.sessionAsset === "string" ? existingResolution.sessionAsset : null;
  const assetStatus = visionAsset && uiAsset ? (visionAsset.toUpperCase() === uiAsset.toUpperCase() ? "MATCH" : "MISMATCH") : visionAsset ? "VISION_ONLY" : uiAsset || sessionAsset ? "SESSION_CONFIRMED" : "UNKNOWN";
  const assetResolution = { visionAsset, uiAsset, sessionAsset, status: assetStatus };
  const reasoningSnapshot = visionObservation ? { ...snapshotObject, visionObservation, assetResolution, imageStatus: visionObservation.imageProvided === true ? "IMAGE_PROVIDED_BUT_FIELDS_MAY_BE_UNREADABLE" : "IMAGE_NOT_PROVIDED" } : { ...snapshotObject, assetResolution };
  const content: Record<string, unknown>[] = [{ type: "text", text: [
    "Analyze the current IQ Option chart using 5-second candles, approximately 300 seconds visible, and a 60-second paper horizon (12 candles). Keep these time concepts distinct.",
    "Use only the supplied chart images and normalized market snapshot.",
    "Write human-readable fields in Brazilian Portuguese. Keep enum values BUY, SELL, WAIT, NEUTRAL and UNAVAILABLE unchanged.",
    "Return JSON only with decision, confidence, rawBuyScore, rawSellScore, rawWaitScore, pBuy, pSell, pWait, directionalLean, leanConfidence, dataQuality, imageUsed, framesUsed, visualBias, quantBias, confluence, trend, structure, momentum, volatility, supportResistance, candlePatterns, breakoutState, exhaustionState, supportingFactors, opposingFactors, observations, riskFlags, analysisQuality, agentAction, guidanceMessage, chartViewQualityScore, historicalContextScore, recentDetailScore, visibleCandleCount, summary, rationale and marketContext.",
    "marketContext must be an object with symbol, marketType, visualTimeframe, displayedStake, confidence and sources. Use UNAVAILABLE or null when the supplied sanitized crops do not prove a field. Never infer account balance, identity or broker controls.",
    "If visionObservation.imageProvided is true, the sanitized crop was delivered to Claude Vision. Distinguish IMAGE_PROVIDED_BUT_FIELDS_MAY_BE_UNREADABLE from IMAGE_NOT_PROVIDED; never claim that no image was supplied when imageProvided is true.",
    "If the image is missing, stale, ambiguous or the active asset is not trustworthy, return WAIT.",
    `NORMALIZED_SNAPSHOT=${JSON.stringify(reasoningSnapshot).slice(0, 45_000)}`,
  ].join("\n") }];
  // Fable remains text-only. Claude Vision receives the crop bytes above and
  // contributes only the structured MarketObservation to this request.
  const controller = new AbortController();
  const model = process.env.FABLE_MODEL || defaultAiModel;
  const fableTimeoutMs = Math.max(4_500, Math.min(15_000, Number(process.env.FABLE_TIMEOUT_MS) || 12_000));
  const textTimeout = setTimeout(() => controller.abort(), fableTimeoutMs);
  const fableStarted = Date.now();
  let agentRuns: ReturnType<typeof buildAgentRuns> | null = null;
  let answer = "";
  try {
    if (openCodeGoActive) {
      const proxy = await relayAdminPost("/api/ai/go/text", { system: "You are a cautious quantitative analyst. Do not provide execution instructions or claim data not present in the sanitized chart crops.", prompt: content[0]?.text ?? "", maxTokens: 1_500, requestId: typeof payload.requestId === "string" ? payload.requestId : null, sessionContext: { sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, traceId: typeof snapshotObject.traceId === "string" ? snapshotObject.traceId : null, segmentId: typeof snapshotObject.segmentId === "string" ? snapshotObject.segmentId : null } }, 25_000);
      if (!proxy || proxy.status !== "OK" || typeof proxy.text !== "string" || !proxy.text) throw new Error(`OPENCODE_GO_TEXT_FAILED:${String(proxy?.reason || proxy?.status || "relay_unreachable").slice(0, 120)}`);
      answer = proxy.text;
      recordLatency("fable", Date.now() - fableStarted);
      console.info("OPENCODE_GO_TEXT_ACTIVE", JSON.stringify({ model: proxy.model || openCodeModel, requestId: typeof payload.requestId === "string" ? payload.requestId : null, latencyMs: proxy.latencyMs ?? null, sessionId: proxy.sessionId ?? null }));
    } else {
    const baseUrl = (process.env.FABLE_BASE_URL || "https://api.nexxus-pro.site").replace(/\/$/, "");
    console.info("FABLE_REASONING_STARTED", JSON.stringify({ model, mode: visionObservation ? "text-only" : "legacy-multimodal" }));
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": legacyApiKey!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1_500, system: "You are Fable 5.1, a cautious quantitative analyst. Do not provide execution instructions or claim data not present in the sanitized chart crops.", messages: [{ role: "user", content }] }),
      signal: controller.signal,
    });
    const text = await response.text();
    recordLatency("fable", Date.now() - fableStarted); console.info("FABLE_LATENCY", JSON.stringify({ requestId: typeof payload.requestId === "string" ? payload.requestId : null, latencyMs: Date.now() - fableStarted, timeoutMs: fableTimeoutMs }));
    if (!response.ok) {
      // Keep the provider request id when present; it is safe diagnostics and
      // lets support correlate a production failure without exposing payloads.
      let providerRequestId = response.headers.get("request-id") || response.headers.get("x-request-id");
      try { providerRequestId ||= String((JSON.parse(text) as Record<string, unknown>).request_id || ""); } catch { /* non-json upstream */ }
      throw new Error(`FABLE_HTTP_${response.status}: ${providerRequestId ? `request_id=${providerRequestId} ` : ""}${redactSecretPatterns(text).slice(0, 300)}`);
    }
    const wire = JSON.parse(text) as { content?: Array<{ type?: string; text?: string }> };
    answer = (wire.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    console.info("FABLE_REASONING_RECEIVED", JSON.stringify({ status: response.status, textLength: answer.length }));
    }
    const parsed = parseJsonText(answer);
    const visualBias = parsed?.visualBias === "BUY" || parsed?.visualBias === "SELL" ? parsed.visualBias : "NEUTRAL";
    const rawQuantBias = String(parsed?.quantBias ?? "");
    const quantBias: "BUY" | "SELL" | "NEUTRAL" | "UNAVAILABLE" = rawQuantBias === "BUY" || rawQuantBias === "SELL" || rawQuantBias === "NEUTRAL" || rawQuantBias === "UNAVAILABLE" ? rawQuantBias : "UNAVAILABLE";
    const decision = parsed?.decision === "BUY" || parsed?.decision === "SELL" ? parsed.decision : "WAIT";
    const probabilities = [Number(parsed?.pBuy), Number(parsed?.pSell), Number(parsed?.pWait)];
    const probabilityTotal = probabilities.every((item) => Number.isFinite(item) && item >= 0) ? probabilities.reduce((sum, item) => sum + item, 0) : 0;
    const pBuy = probabilityTotal > 0 ? probabilities[0]! / probabilityTotal : null;
    const pSell = probabilityTotal > 0 ? probabilities[1]! / probabilityTotal : null;
    const pWait = probabilityTotal > 0 ? probabilities[2]! / probabilityTotal : null;
    const quantAvailable = (quantBias as string) !== "UNAVAILABLE";
    const debate = await runStructuredDebate(visionObservation, pBuy, pSell, decision);
    const advocates = await runAdversarialAdvocates(debate, visionObservation);
    const control = { decision, directionalLean: debate.arbiter.directionalLean, leanConfidence: debate.arbiter.leanConfidence, latencyMs: debate.arbiter.latencyMs };
    const challenger = { decision, directionalLean: debate.arbiter.directionalLean, leanConfidence: debate.arbiter.leanConfidence, latencyMs: debate.arbiter.latencyMs + advocates.latencyMs };
    const probabilitySource = probabilityTotal > 0 ? "MODEL_NATIVE" : "FALLBACK_UNAVAILABLE";
    agentRuns = buildAgentRuns({ debate, advocates, meta: {
      sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null,
      traceId: typeof snapshotObject.candleId === "string" ? `trace_${snapshotObject.candleId}` : null,
      marketEventId: typeof snapshotObject.candleId === "string" ? snapshotObject.candleId : null,
      frameId: typeof chartFrame.frameId === "string" ? chartFrame.frameId : null,
      candleId: typeof snapshotObject.candleId === "string" ? snapshotObject.candleId : null,
      decisionId: typeof snapshotObject.decisionId === "string" ? snapshotObject.decisionId : typeof snapshotObject.analysisId === "string" ? snapshotObject.analysisId : null,
      startedAt: pipelineStarted, completedAt: Date.now(), model: openCodeGoActive ? openCodeModel : visionModel, provider: openCodeGoActive ? "openCodeGo" : "nexxus",
    } });
    const agentRunsPersisted = await relayAdminSend("POST", "/api/debug/agent-runs", { sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, runs: agentRuns.runs });
    console.info("DEEP_AGENT_RUNS_PERSISTED", JSON.stringify({ runs: agentRuns.runs.length, persisted: agentRunsPersisted, arbiterRunId: agentRuns.arbiterRunId, fusionRunId: agentRuns.fusionRunId }));
    const totalMs = Date.now() - pipelineStarted;
    recordLatency("total", totalMs);
    return {
      model: { modelId: openCodeGoActive ? openCodeModel : model, displayName: openCodeGoActive ? `OpenCode Go (${openCodeModel})` : "Fable 5.1" },
      decisionAgent,
      decisionTimestamps,
      decisionFreshness,
      analysis: {
        decision, confidence: bounded(parsed?.confidence, 0), rawModelScores: { buy: finiteOrNull(parsed?.rawBuyScore), sell: finiteOrNull(parsed?.rawSellScore), wait: finiteOrNull(parsed?.rawWaitScore) }, pBuy, pSell, pWait, directionalLean: debate.arbiter.directionalLean, leanConfidence: debate.arbiter.leanConfidence, agentRunIds: agentRuns!.runIds, arbiterRunId: agentRuns!.arbiterRunId, fusionRunId: agentRuns!.fusionRunId, bullRunId: agentRuns!.bullRunId, bearRunId: agentRuns!.bearRunId, specialistRunIds: agentRuns!.specialistRunIds, multiAgent: { ...debate, advocates, mode: process.env.MULTI_AGENT_MODE || "TEXT_SPECIALISTS", control, challenger, agreement: control.decision === challenger.decision && control.directionalLean === challenger.directionalLean }, timing: { visionMs: visionLatencyMs, fableMs: Date.now() - fableStarted, totalMs }, latencyMetrics: allLatencyStats(), probabilitySource, candleSeconds: Number(snapshotObject.candleSeconds) || 5, expirationSeconds: Number(snapshotObject.horizonSeconds) || 60, dataQuality: Math.min(baseQuality, bounded(parsed?.dataQuality, baseQuality)), imageUsed: imageUsed && visionObservation?.imageProvided === true, imageStatus: imageUsed && visionObservation?.imageProvided === true ? "IMAGE_PROVIDED" : "IMAGE_NOT_PROVIDED", visionObservation, visionTransport: { frameId: receivedImage?.frameId || null, hasImage: imageUsed && visionObservation?.imageProvided === true, imageBytes: Number(visionObservation?.imageBytes) || receivedImage?.byteLength || 0, imageHash: visionObservation?.imageHash || receivedImage?.hash || null, provider: openCodeGoActive ? "opencode-go-vision" : "nexxus-vision", model: openCodeGoActive ? openCodeModel : visionModel },
        framesUsed: Math.min(4, Number(parsed?.framesUsed) || images.length), visualBias, quantBias, confluence: bounded(parsed?.confluence, quantAvailable && quantBias === visualBias ? .8 : 0),
        trend: typeof parsed?.trend === "string" ? parsed.trend.slice(0, 80) : "UNKNOWN", structure: typeof parsed?.structure === "string" ? parsed.structure.slice(0, 80) : "UNKNOWN", momentum: typeof parsed?.momentum === "string" ? parsed.momentum.slice(0, 80) : "UNKNOWN", volatility: typeof parsed?.volatility === "string" ? parsed.volatility.slice(0, 80) : "UNKNOWN",
        supportResistance: safeList(parsed?.supportResistance), candlePatterns: safeList(parsed?.candlePatterns), breakoutState: typeof parsed?.breakoutState === "string" ? parsed.breakoutState.slice(0, 80) : "UNKNOWN", exhaustionState: typeof parsed?.exhaustionState === "string" ? parsed.exhaustionState.slice(0, 80) : "UNKNOWN",
        supportingFactors: safeList(parsed?.supportingFactors), opposingFactors: safeList(parsed?.opposingFactors), observations: safeList(parsed?.observations), riskFlags: safeList(parsed?.riskFlags),
        summary: typeof parsed?.summary === "string" ? parsed.summary.slice(0, 260) : "WAIT: evidência insuficiente para uma decisão operacional.", rationale: typeof parsed?.rationale === "string" ? parsed.rationale.slice(0, 600) : "FABLE_INVALID_OR_INCOMPLETE_RESPONSE", analysisId: typeof snapshotObject.analysisId === "string" ? snapshotObject.analysisId : "unknown", decisionId: typeof snapshotObject.decisionId === "string" ? snapshotObject.decisionId : null, sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, traceId: typeof snapshotObject.traceId === "string" ? snapshotObject.traceId : (typeof snapshotObject.candleId === "string" ? `trace_${snapshotObject.candleId}` : null), marketEventId: typeof snapshotObject.marketEventId === "string" ? snapshotObject.marketEventId : (typeof snapshotObject.candleId === "string" ? snapshotObject.candleId : null), candleId: typeof snapshotObject.candleId === "string" ? snapshotObject.candleId : null, frameId: typeof chartFrame.frameId === "string" ? chartFrame.frameId : null, decisionSource: typeof snapshotObject.decisionSource === "string" ? snapshotObject.decisionSource : "DEEP_ONLY", deepRequested: snapshotObject.deepRequested === true, deepExecuted: true,
        pipeline: { dataValidation: imageUsed && Number.isFinite(Number(crop.width)) ? "PASS" : "WAIT", visualAnalysis: imageUsed ? "PASS" : "WAIT", quantAnalysis: quantitative.availability === "READY" ? "PASS" : "LIMITED", confluence: !quantAvailable ? "UNAVAILABLE" : quantBias === visualBias ? "PASS" : "CONFLICT", finalDecision: decision },
        analysisQuality: parsed?.analysisQuality === "HIGH" || parsed?.analysisQuality === "MEDIUM" ? parsed.analysisQuality : "LOW",
        agentAction: ["REQUEST_ZOOM_OUT", "REQUEST_ZOOM_IN", "CONTINUE_ANALYSIS"].includes(String(parsed?.agentAction)) ? parsed?.agentAction : "WAIT",
        guidanceMessage: typeof parsed?.guidanceMessage === "string" ? parsed.guidanceMessage.slice(0, 240) : null,
        chartView: { score: Math.round(Math.max(0, Math.min(100, Number(parsed?.chartViewQualityScore) || baseQuality * 100))), historicalContext: Math.round(Math.max(0, Math.min(100, Number(parsed?.historicalContextScore) || baseQuality * 100))), recentDetail: Math.round(Math.max(0, Math.min(100, Number(parsed?.recentDetailScore) || baseQuality * 100))), visibleCandleCount: Number.isFinite(Number(parsed?.visibleCandleCount)) ? Number(parsed?.visibleCandleCount) : null },
        marketContext: {
          symbol: typeof parsed?.marketContext === "object" && parsed.marketContext && typeof (parsed.marketContext as Record<string, unknown>).symbol === "string" ? String((parsed.marketContext as Record<string, unknown>).symbol).slice(0, 32) : "UNAVAILABLE",
          marketType: typeof parsed?.marketContext === "object" && parsed.marketContext && typeof (parsed.marketContext as Record<string, unknown>).marketType === "string" ? String((parsed.marketContext as Record<string, unknown>).marketType).slice(0, 20) : "UNAVAILABLE",
          visualTimeframe: typeof parsed?.marketContext === "object" && parsed.marketContext && typeof (parsed.marketContext as Record<string, unknown>).visualTimeframe === "string" ? String((parsed.marketContext as Record<string, unknown>).visualTimeframe).slice(0, 16) : "UNAVAILABLE",
          displayedStake: typeof parsed?.marketContext === "object" && parsed.marketContext && (typeof (parsed.marketContext as Record<string, unknown>).displayedStake === "string" || typeof (parsed.marketContext as Record<string, unknown>).displayedStake === "number") ? (parsed.marketContext as Record<string, unknown>).displayedStake : null,
          confidence: typeof parsed?.marketContext === "object" && parsed.marketContext ? bounded((parsed.marketContext as Record<string, unknown>).confidence, 0) : 0,
          sources: typeof parsed?.marketContext === "object" && parsed.marketContext ? safeList((parsed.marketContext as Record<string, unknown>).sources) : [],
        },
        assetResolution,
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
    if (!timedOut) throw error;
    const timeoutLatencyMs = Date.now() - pipelineStarted; recordLatency("fable", Date.now() - fableStarted); recordLatency("total", timeoutLatencyMs); console.warn("FABLE_TIMEOUT", JSON.stringify({ requestId: typeof payload.requestId === "string" ? payload.requestId : null, timeoutMs: fableTimeoutMs, latencyMs: timeoutLatencyMs }));
    return {
      model: { modelId: model, displayName: "Fable 5.1" },
      analysis: {
        decision: "WAIT", confidence: 0, pBuy: null, pSell: null, pWait: null, probabilitySource: "UNAVAILABLE", directionalLean: "NONE", leanConfidence: 0, agentRunIds: agentRuns?.runIds ?? [], arbiterRunId: agentRuns?.arbiterRunId ?? null, fusionRunId: agentRuns?.fusionRunId ?? null, bullRunId: agentRuns?.bullRunId ?? null, bearRunId: agentRuns?.bearRunId ?? null, specialistRunIds: agentRuns?.specialistRunIds ?? [], timing: { visionMs: visionLatencyMs, fableMs: Date.now() - fableStarted, totalMs: timeoutLatencyMs }, latencyMetrics: allLatencyStats(),
        dataQuality: baseQuality, imageUsed: imageUsed && visionObservation?.imageProvided === true, imageStatus: "IMAGE_PROVIDED", visionObservation,
        visionTransport: { frameId: receivedImage?.frameId || null, hasImage: true, imageBytes: receivedImage?.byteLength || 0, imageHash: receivedImage?.hash || null, provider: "nexxus-vision", model: visionModel },
        riskFlags: ["FABLE_TIMEOUT"], observations: ["Vision observation preserved; Fable response exceeded its deadline."], supportingFactors: [], opposingFactors: [], summary: "WAIT: Fable timeout; evidência visual preservada para coleta shadow.", rationale: "FABLE_TIMEOUT", analysisId: typeof snapshotObject.analysisId === "string" ? snapshotObject.analysisId : "unknown", decisionId: typeof snapshotObject.decisionId === "string" ? snapshotObject.decisionId : null, sessionId: typeof snapshotObject.sessionId === "string" ? snapshotObject.sessionId : null, traceId: typeof snapshotObject.traceId === "string" ? snapshotObject.traceId : null, marketEventId: typeof snapshotObject.marketEventId === "string" ? snapshotObject.marketEventId : null, candleId: typeof snapshotObject.candleId === "string" ? snapshotObject.candleId : null, frameId: typeof chartFrame.frameId === "string" ? chartFrame.frameId : null, decisionSource: typeof snapshotObject.decisionSource === "string" ? snapshotObject.decisionSource : "DEEP_ONLY", deepRequested: snapshotObject.deepRequested === true, deepExecuted: true, pipeline: { dataValidation: "PASS", visualAnalysis: "PASS", quantAnalysis: "LIMITED", confluence: "UNAVAILABLE", finalDecision: "WAIT" }, assetResolution,
      },
    };
  } finally { clearTimeout(textTimeout); }
}

/* ============================================================
   Tipos e primitivas inline (serverless bundle não inclui src/)
   ============================================================ */
type Direction = "up" | "down";
type Timeframe = "1m" | "3m" | "5m" | "15m" | "1h" | "4h" | "1d";
type TFSnapshot = { tf: Timeframe; candles: ReadonlyArray<{ close: number; high: number; low: number }> };
interface EmpiricalProbability {
  probability: number;
  sampleSize: number;
  favorable: number;
  baseline?: number;
  confidenceInterval?: { lower: number; upper: number; method?: string; level?: number };
  periodStart?: number;
  periodEnd?: number;
  similarityCriteria?: unknown;
  horizon?: string;
  methodology?: string;
  outOfSample?: boolean;
  limitations?: string[];
}

// Wilson CI para IC95% (z=1.96)
function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (center - margin) / denom);
}
function wilsonUpperBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.min(1, (center + margin) / denom);
}
function isActionable(p: number, ciLower: number, baseline: number, minMargin = 0.05): boolean {
  return ciLower > baseline + minMargin;
}
function expectedValue(prob: number, gain = 1, loss = 1): number {
  return prob * gain - (1 - prob) * loss;
}
function localRSI(closes: number[], p = 14): number | null {
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d; else l -= d;
  }
  const al = l / p;
  if (al === 0) return 100;
  const ag = g / p;
  return 100 - 100 / (1 + ag / al);
}

const TF_WEIGHTS: Record<string, number> = { "15m": 0.7, "1h": 1.0, "4h": 0.9 };
function analyzeConfluenceLocal(snapshots: TFSnapshot[], direction: Direction): {
  direction: Direction | "neutral";
  agreementScore: number;
  confidenceBoost: number;
  reason: string;
} {
  if (snapshots.length < 2) {
    return { direction: "neutral", agreementScore: 0, confidenceBoost: 0, reason: "menos de 2 TFs elegíveis" };
  }
  let totalWeight = 0, alignedWeight = 0, alignedCount = 0, perTfCount = 0;
  for (const s of snapshots) {
    const w = TF_WEIGHTS[s.tf] ?? 0.8;
    totalWeight += w;
    const closes = s.candles.map((c) => c.close);
    if (closes.length < 30) continue;
    perTfCount++;
    let sma = 0;
    for (let i = closes.length - 20; i < closes.length; i++) sma += closes[i]!;
    sma /= 20;
    const tech = closes[closes.length - 1]! - sma;
    const rsi = localRSI(closes);
    const aligned = rsi !== null && rsi > 30 && rsi < 70 && Math.sign(tech) === (direction === "up" ? 1 : -1);
    if (aligned) { alignedWeight += w; alignedCount++; }
  }
  const agreement = totalWeight > 0 ? alignedWeight / totalWeight : 0;
  if (agreement < 0.5 || alignedCount < 2) {
    return { direction: "neutral", agreementScore: agreement, confidenceBoost: 0, reason: `confluência insuficiente: ${alignedCount}/${perTfCount} TFs alinhados, agreement=${agreement.toFixed(3)}` };
  }
  return {
    direction,
    agreementScore: agreement,
    confidenceBoost: agreement * 0.3,
    reason: `confluência ${direction} confirmada: ${alignedCount}/${perTfCount} TFs alinhados, agreement=${agreement.toFixed(3)}`,
  };
}

interface GuardState {
  consecutiveLosses: number; cooldownUntil: number | null; dailyLossPct: number;
  lastLossAt: number | null; circuitTrippedAt: number | null; lastUpdatedDay: string;
}
function freshGuardState(now: number): GuardState {
  return {
    consecutiveLosses: 0, cooldownUntil: null, dailyLossPct: 0,
    lastLossAt: null, circuitTrippedAt: null,
    lastUpdatedDay: new Date(now).toISOString().slice(0, 10),
  };
}
function evaluateGuardsLocal(input: { atrPct: number | null; lastCandleAgeMs: number | null; now: number }): { allow: boolean; reason?: string } {
  if (input.atrPct !== null && input.atrPct > 8) return { allow: false, reason: `volatilidade extrema (ATR%=${input.atrPct.toFixed(2)})` };
  if (input.lastCandleAgeMs !== null && input.lastCandleAgeMs > 5 * 60 * 1000) return { allow: false, reason: "dados stale (>5min)" };
  return { allow: true };
}

const CC = "https://cryptocurrency.cv/api";
const BINANCE = "https://api.binance.com/api/v3";
const TF_MS: Record<string, number> = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

async function binanceKlines(symbol: string, timeframe: string, limit = 200): Promise<Candle[]> {
  const res = await fetch(`${BINANCE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`, { headers: { "User-Agent": "tracecon" } });
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((r) => {
    const a = r as unknown[];
    return { timestamp: Number(a[0]), open: Number(a[1]), high: Number(a[2]), low: Number(a[3]), close: Number(a[4]), volume: Number(a[5]) };
  });
}

function sma(v: number[], p: number): number | null {
  if (v.length < p) return null;
  let s = 0; for (let i = v.length - p; i < v.length; i++) s += v[i]!;
  return s / p;
}
function rsiLast(closes: number[], p = 14): number | null {
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d; else l -= d;
  }
  const ag = g / p, al = l / p;
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
}

function toDecision(score: number, suff: boolean, counter: boolean): "BUY" | "SELL" | "WAIT" {
  if (!suff || Math.abs(score) < 0.18 || counter) return "WAIT";
  return score > 0 ? "BUY" : "SELL";
}

function safeKeyEquals(expected: string | undefined, received: string): boolean {
  const e = expected?.trim() ?? "";
  return Boolean(e && received && e.length === received.length && timingSafeEqual(Buffer.from(e), Buffer.from(received)));
}
async function researchAuthorized(req: IncomingMessage): Promise<boolean> {
  const suppliedAdmin = req.headers["x-live-admin-key"]?.toString() ?? "";
  const bearer = (req.headers.authorization ?? "").toString().replace(/^Bearer\s+/i, "");
  if (safeKeyEquals(process.env.LIVE_API_ADMIN_KEY, suppliedAdmin) || safeKeyEquals(process.env.LIVE_API_KEY, bearer)) return true;
  if (bearer.startsWith("tc_live_")) {
    const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
    if (!base) return false;
    try { const response = await fetch(`${base}/api/debug/verify-key`, { method: "POST", headers: { authorization: bearer }, signal: AbortSignal.timeout(8_000) }); return response.ok; } catch { return false; }
  }
  return false;
}
const researchLimits = new Map<string, { at: number; count: number }>();
function researchRateOk(bucket: string, limit: number, windowMs = 60_000): boolean { const now = Date.now(); const hit = researchLimits.get(bucket) ?? { at: now, count: 0 }; if (now - hit.at > windowMs) { hit.at = now; hit.count = 0; } hit.count += 1; researchLimits.set(bucket, hit); return hit.count <= limit; }
const shadowJobs = new Map<string, { status: string; createdAt: number; result: unknown }>();
const shadowIdempotency = new Map<string, { createdAt: number; result: unknown }>();

async function relayAdminSend(method: "POST" | "PUT", path: string, payload: unknown): Promise<boolean> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (!base || !admin) return false;
  try { const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-relay-admin": admin }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000) }); return response.ok; } catch { return false; }
}
async function relayAdminPost(path: string, payload: unknown, timeoutMs = 25_000): Promise<Record<string, unknown> | null> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (!base || !admin) return null;
  try { const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-relay-admin": admin }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) }); if (!response.ok) return null; return await response.json() as Record<string, unknown>; } catch { return null; }
}
/** Igual ao relayAdminPost, mas devolve status/body reais (erros do relay nao viram 502 cego). */
async function relayAdminExchange(path: string, payload: unknown, timeoutMs = 20_000): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (!base || !admin) return null;
  try {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-relay-admin": admin }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  } catch { return null; }
}
/** Metodo generico com corpo/status reais (multi-market). */
async function relayAdminJson(method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload?: unknown, timeoutMs = 20_000): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (!base || !admin) return null;
  try {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-relay-admin": admin }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  } catch { return null; }
}
async function relayAdminGet(path: string): Promise<Record<string, unknown>> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, ""); const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim(); if (!base || !admin) throw new Error("relay_not_configured");
  const response = await fetch(`${base}${path}`, { headers: { "x-relay-admin": admin }, signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`relay_${response.status}`); return await response.json() as Record<string, unknown>;
}
async function relayOperationalSnapshot(sessionId: string, snapshot?: unknown): Promise<Record<string, unknown>> {
  if (snapshot !== undefined) { if (!process.env.TRACECOM_LIVE_RELAY_URL) return snapshot as Record<string, unknown>; const stored = await relayAdminSend("PUT", `/api/operational/${encodeURIComponent(sessionId)}`, snapshot); if (!stored) throw new Error("operational_snapshot_persist_failed"); return snapshot as Record<string, unknown>; }
  if (!process.env.TRACECOM_LIVE_RELAY_URL) throw new Error("relay_not_configured"); return relayAdminGet(`/api/operational/${encodeURIComponent(sessionId)}`);
}

async function fetchStrategySelection(): Promise<{ selection: StrategySelection | null; latestSignals: LatestOperationalSignal[] }> {
  if (!process.env.TRACECOM_LIVE_RELAY_URL || !process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET) return { selection: null, latestSignals: [] };
  try {
    const [selectionBody, signalsBody] = await Promise.all([relayAdminGet("/api/strategies/selection"), relayAdminGet("/api/strategies/latest-signal")]);
    const row = selectionBody.selection as Record<string, unknown> | undefined;
    let selection: StrategySelection | null = null;
    if (row && typeof row === "object") {
      const base = makeSelection(String(row.family) as never, Number(row.horizon_seconds), String(row.reason ?? "relay"));
      if (base) selection = { ...base, mode: row.mode === "AUTO" ? "AUTO" : "MANUAL", updatedAt: typeof row.updated_at === "string" ? row.updated_at : base.updatedAt };
    }
    const signals = Array.isArray(signalsBody.signals) ? (signalsBody.signals as Array<Record<string, unknown>>) : [];
    const latestSignals: LatestOperationalSignal[] = signals.map((signal) => ({
      family: String(signal.family) as LatestOperationalSignal["family"],
      horizonSeconds: Number(signal.horizon_seconds),
      direction: (signal.direction === "SELL" ? "SELL" : "BUY") as LatestOperationalSignal["direction"],
      signalBucket: Number(signal.signal_bucket),
      entryPrice: Number(signal.entry_price),
      strategyHash: String(signal.strategy_hash ?? ""),
      entryTimestamp: Number(signal.entry_timestamp),
    })).filter((signal) => Number.isFinite(signal.horizonSeconds) && Number.isFinite(signal.signalBucket) && Number.isFinite(signal.entryPrice));
    return { selection, latestSignals };
  } catch { return { selection: null, latestSignals: [] }; }
}

async function fetchStrategyStats(): Promise<Record<string, unknown>> {
  const [stats, history, promotion] = await Promise.all([
    relayAdminGet("/api/strategies/stats"),
    relayAdminGet("/api/strategies/history?limit=200"),
    relayAdminGet("/api/strategies/promotion").catch(() => ({ state: null, audit: [] })),
  ]);
  return { ...stats, history: history.history ?? [], promotion };
}


const AI_PROVIDER_CONFIG_PATH = "ai-provider/config.json";
async function readAiProviderConfig(): Promise<Record<string, unknown> | null> {
  if (!process.env.TRACECOM_LIVE_RELAY_URL || !process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET) return null;
  try { return await relayAdminGet("/api/ai/provider"); } catch { return null; }
}
function maskApiKey(key: string): string { const trimmed = key.trim(); return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`; }

async function fetchRelayBundle(sessionId: string): Promise<Record<string, unknown> | null> {
  const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
  const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim();
  if (!base || !admin) return null;
  const get = async (suffix: string) => { try { const response = await fetch(`${base}/api/live/sessions/${encodeURIComponent(sessionId)}/${suffix}`, { headers: { "x-relay-admin": admin }, signal: AbortSignal.timeout(8_000) }); return response.ok ? await response.json() as Record<string, unknown> : null; } catch { return null; } };
  const [timeline, logs, runs] = await Promise.all([get("timeline"), get("logs"), get("agent-runs")]);
  if (!timeline && !logs && !runs) return null;
  return { timeline, logs, agentRuns: runs };
}
async function fetchCausalTrainingPrices(sessionId: string | null): Promise<Array<{ observedAt: number; value: number; priceObservationId?: string; source: string; confidence?: number }>> {
  if (!sessionId) return []; const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, ""); const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim(); if (!base || !admin) return [];
  try { const response = await fetch(`${base}/api/live/sessions/${encodeURIComponent(sessionId)}/prices?status=ACCEPTED`, { headers: { "x-relay-admin": admin }, signal: AbortSignal.timeout(8_000) }); if (!response.ok) return []; const body = await response.json() as { prices?: Array<Record<string, unknown>> }; return (body.prices ?? []).map((p) => ({ observedAt: Date.parse(String(p.observedAt)), value: Number(p.value), priceObservationId: typeof p.priceObservationId === "string" ? p.priceObservationId : undefined, source: typeof p.source === "string" ? p.source : "UNKNOWN", confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : undefined })).filter((p) => p.observedAt > 0 && Number.isFinite(p.value)).sort((a, b) => a.observedAt - b.observedAt); } catch { return []; }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = req.headers["x-request-id"]?.toString().slice(0, 128) || randomUUID();
  res.setHeader("X-TraceCon-Request-Id", requestId);
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams;
  const symbol = (q.get("symbol") ?? "BTCUSDT").toUpperCase();
  const timeframe = q.get("timeframe") ?? "1h";

  res.setHeader("Content-Type", "application/json");

  const json = (status: number, body: unknown): void => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };

  // Binance bloqueia alguns IPs de nuvem (HTTP 451). Retornamos disponível:false.
  const safeKlines = async (): Promise<Candle[] | string> => {
    try {
      return await binanceKlines(symbol, timeframe, 200);
    } catch (e) {
      return e instanceof Error ? e.message : "erro";
    }
  };

  try {
    const path = url.pathname;
    const body = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" ? await readBody(req) : null;
    if (await handleLiveApi(req, res, path, body, q)) return;
    const operationalInput = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const operationalSessionId = typeof operationalInput.sessionId === "string" ? operationalInput.sessionId.trim().slice(0, 128) : "";
    const operationalResponse = (controller: OperationalController) => ({ ...controller.snapshot(), sessionId: operationalSessionId, shadowOnly: true, brokerAutomation: "NONE" });
    const operationalController = async (sessionId: string): Promise<OperationalController | null> => {
      if (!process.env.TRACECOM_LIVE_RELAY_URL) return operationalSessions.get(sessionId) ?? null;
      try { const persisted = await relayOperationalSnapshot(sessionId); const restored = OperationalController.restore((persisted.snapshot || persisted) as never); operationalSessions.set(sessionId, restored); return restored; } catch { return null; }
    };
    if (path === "/api/operational/lock" && req.method === "POST") {
      if (!operationalSessionId) { json(400, { error: "session_id_required" }); return; }
      const controller = await operationalController(operationalSessionId) ?? new OperationalController();
      try {
        const direction = operationalInput.direction === "BUY" || operationalInput.direction === "SELL" ? operationalInput.direction : null;
        if (!direction) throw new Error("invalid_direction");
        const horizonMs = Number.isFinite(Number(operationalInput.horizonMs)) ? Number(operationalInput.horizonMs) : 60_000;
        if (process.env.TRACECOM_LIVE_RELAY_URL) {
          const { selection, latestSignals } = await fetchStrategySelection();
          const latestSignal = selection ? latestSignals.find((signal) => signal.family === selection.family && signal.horizonSeconds === selection.horizonSeconds) ?? null : null;
          const brokerHorizonSeconds = Number.isFinite(Number(operationalInput.brokerHorizonSeconds)) ? Number(operationalInput.brokerHorizonSeconds) : null;
          const gate = decideOperationalGate({ direction, horizonMs }, { selection, latestSignal, brokerHorizonSeconds });
          if (!gate.allowed) { json(409, { error: "strategy_gate_rejected", reason: gate.reason, detail: gate.detail, selection, shadowOnly: true, brokerAutomation: "NONE" }); return; }
        }
        controller.lock({
          signalId: typeof operationalInput.signalId === "string" ? operationalInput.signalId : "",
          idempotencyKey: typeof operationalInput.idempotencyKey === "string" ? operationalInput.idempotencyKey : "",
          direction,
          originSymbol: typeof operationalInput.originSymbol === "string" ? operationalInput.originSymbol : "",
          now: Number(operationalInput.now) || Date.now(),
          countdownMs: Number.isFinite(Number(operationalInput.countdownMs)) ? Number(operationalInput.countdownMs) : 10_000,
          confirmationMs: Number.isFinite(Number(operationalInput.confirmationMs)) ? Number(operationalInput.confirmationMs) : 20_000,
          horizonMs: Number.isFinite(Number(operationalInput.horizonMs)) ? Number(operationalInput.horizonMs) : horizonMs,
        });
        operationalSessions.set(operationalSessionId, controller); await relayOperationalSnapshot(operationalSessionId, controller.snapshot());
        json(200, operationalResponse(controller));
      } catch (error) { json(409, { error: error instanceof Error ? error.message : "operational_lock_rejected", shadowOnly: true, brokerAutomation: "NONE" }); }
      return;
    }
    if (path === "/api/operational/entry" && req.method === "POST") {
      if (!operationalSessionId) { json(400, { error: "session_id_required" }); return; }
      const controller = await operationalController(operationalSessionId);
      if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      try {
        controller.lockEntry({ signalId: typeof operationalInput.signalId === "string" ? operationalInput.signalId : "", price: operationalInput.price === null ? null : Number(operationalInput.price), timestamp: Number(operationalInput.timestamp) || Date.now(), symbol: typeof operationalInput.symbol === "string" ? operationalInput.symbol : "" });
        await relayOperationalSnapshot(operationalSessionId, controller.snapshot()); json(200, operationalResponse(controller));
      } catch (error) { json(409, { error: error instanceof Error ? error.message : "operational_entry_rejected", shadowOnly: true, brokerAutomation: "NONE" }); }
      return;
    }
    if (path === "/api/operational/invalidate" && req.method === "POST") {
      if (!operationalSessionId) { json(400, { error: "session_id_required" }); return; }
      const controller = await operationalController(operationalSessionId); if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      try { controller.invalidate(typeof operationalInput.signalId === "string" ? operationalInput.signalId : "", typeof operationalInput.reason === "string" ? operationalInput.reason : "market_context_changed", Number(operationalInput.timestamp) || Date.now()); await relayOperationalSnapshot(operationalSessionId, controller.snapshot()); json(200, operationalResponse(controller)); } catch (error) { json(409, { error: error instanceof Error ? error.message : "operational_invalidation_rejected", shadowOnly: true, brokerAutomation: "NONE" }); } return;
    }
    if (path === "/api/operational/tick" && req.method === "POST") {
      if (!operationalSessionId) { json(400, { error: "session_id_required" }); return; }
      const controller = await operationalController(operationalSessionId); if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      controller.tick(Number(operationalInput.now) || Date.now()); await relayOperationalSnapshot(operationalSessionId, controller.snapshot()); json(200, operationalResponse(controller)); return;
    }
    if (path === "/api/operational/settle" && req.method === "POST") {
      if (!operationalSessionId) { json(400, { error: "session_id_required" }); return; }
      const controller = await operationalController(operationalSessionId);
      if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      try {
        controller.settle({ signalId: typeof operationalInput.signalId === "string" ? operationalInput.signalId : "", price: operationalInput.price === null ? null : Number(operationalInput.price), timestamp: Number(operationalInput.timestamp) || Date.now(), symbol: typeof operationalInput.symbol === "string" ? operationalInput.symbol : "" });
        await relayOperationalSnapshot(operationalSessionId, controller.snapshot()); json(200, operationalResponse(controller));
      } catch (error) { json(409, { error: error instanceof Error ? error.message : "operational_settlement_rejected", shadowOnly: true, brokerAutomation: "NONE" }); }
      return;
    }
    // Frontends consume this cursor feed plus the snapshot endpoint; they do
    // not calculate, mutate, or settle an operational decision locally.
    const operationalEventsMatch = path.match(/^\/api\/operational\/([^/]+)\/events$/);
    if (operationalEventsMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(operationalEventsMatch[1]!);
      const controller = await operationalController(sessionId);
      if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      const after = Math.max(0, Number(q.get("after")) || 0);
      json(200, { sessionId, after, events: controller.replay(after), cursor: controller.snapshot().nextSequence - 1, shadowOnly: true, brokerAutomation: "NONE" });
      return;
    }
    const operationalSnapshotMatch = path.match(/^\/api\/operational\/([^/]+)$/);
    if (operationalSnapshotMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(operationalSnapshotMatch[1]!);
      const controller = await operationalController(sessionId);
      if (!controller) { json(404, { error: "operational_session_not_found", recovery: "OPERATION_RECOVERY_FAILED" }); return; }
      json(200, { ...controller.snapshot(), sessionId, shadowOnly: true, brokerAutomation: "NONE" });
      return;
    }
    if (path === "/api/ai/provider" && req.method === "GET") {
      const config = await readAiProviderConfig();
      if (!config || config.status !== "CONFIGURED" || typeof config.maskedKey !== "string") { json(200, { status: "NOT_CONFIGURED", provider: "openCodeGo", model: null, maskedKey: null, updatedAt: null }); return; }
      json(200, { status: "CONFIGURED", provider: typeof config.provider === "string" ? config.provider : "openCodeGo", model: typeof config.model === "string" ? config.model : null, maskedKey: config.maskedKey, updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : null, shadowOnly: true });
      return;
    }
    if (path === "/api/ai/provider" && req.method === "PUT") {
      const apiKey = String(operationalInput.apiKey ?? "").trim();
      const model = typeof operationalInput.model === "string" && /^[a-z0-9.\-]{2,64}$/i.test(operationalInput.model.trim()) ? operationalInput.model.trim() : null;
      if (apiKey.length < 20 || apiKey.length > 300 || /\s/.test(apiKey)) { json(400, { error: "invalid_api_key" }); return; }
      const stored = await relayAdminSend("PUT", "/api/ai/provider", { provider: "openCodeGo", apiKey, model });
      if (!stored) { json(502, { error: "provider_store_unavailable" }); return; }
      const config = await readAiProviderConfig();
      json(200, { status: "CONFIGURED", provider: "openCodeGo", model: config && typeof config.model === "string" ? config.model : model, maskedKey: maskApiKey(apiKey), updatedAt: new Date().toISOString(), shadowOnly: true });
      return;
    }
    if (path.startsWith("/api/iq/") && (req.method === "GET" || req.method === "POST" || req.method === "PUT")) {
      const getPaths = ["/api/iq/status", "/api/iq/executions", "/api/iq/office", "/api/iq/markets", "/api/iq/events", "/api/iq/asset-map", "/api/iq/diagnostic/options", "/api/iq/broker-audit", "/api/iq/signals", "/api/iq/intelligence", "/api/iq/research/scoreboard", "/api/iq/research/shadow-lab", "/api/iq/research/timing-policy", "/api/iq/research/scenario-shadow", "/api/iq/quality", "/api/iq/entry", "/api/iq/supervisor", "/api/iq/journal", "/api/iq/journal/agent", "/api/iq/knowledge", "/api/iq/knowledge/search", "/api/iq/second-brain", "/api/iq/hypotheses", "/api/iq/audit", "/api/iq/apprentice", "/api/iq/apprentice/trades", "/api/iq/stress/report"];
      const postPaths = ["/api/iq/connect", "/api/iq/verify-2fa", "/api/iq/disconnect", "/api/iq/arm", "/api/iq/disarm", "/api/iq/kill-switch", "/api/iq/test-order", "/api/iq/config/global-stake", "/api/iq/config/auto-execute", "/api/iq/mode", "/api/iq/real/confirm", "/api/iq/real/revoke", "/api/iq/stress/run", "/api/iq/stress/cancel", "/api/iq/knowledge/rebuild", "/api/iq/hypotheses", "/api/iq/hypotheses/evaluate", "/api/iq/journal/daily"];
      const putPaths = ["/api/iq/market", "/api/iq/supervisor/config", "/api/iq/entry/config", "/api/iq/apprentice/config"];
      const known = [...getPaths, ...postPaths, ...putPaths];
      if (!known.includes(path)) { json(404, { error: "not_found" }); return; }
      if (req.method === "GET") {
        if (!getPaths.includes(path)) { json(405, { error: "method_not_allowed" }); return; }
        const query = path === "/api/iq/executions"
          ? `?limit=${Math.max(1, Math.min(200, Number(q.get("limit")) || 50))}${q.get("marketKey") ? `&marketKey=${encodeURIComponent(q.get("marketKey") as string)}` : ""}`
          : path === "/api/iq/events" ? `?after=${Number(q.get("after")) || 0}&limit=${Math.max(1, Math.min(500, Number(q.get("limit")) || 200))}`
          : path === "/api/iq/audit" ? `?limit=${Math.max(1, Math.min(500, Number(q.get("limit")) || 100))}${q.get("correlationId") ? `&correlationId=${encodeURIComponent(q.get("correlationId") as string)}` : ""}${q.get("marketKey") ? `&marketKey=${encodeURIComponent(q.get("marketKey") as string)}` : ""}${q.get("stage") ? `&stage=${encodeURIComponent(q.get("stage") as string)}` : ""}`
          : path === "/api/iq/research/scoreboard" && q.get("marketKey") ? `?marketKey=${encodeURIComponent(q.get("marketKey") as string)}`
          : path === "/api/iq/broker-audit" ? `?live=${q.get("live") === "0" ? "0" : "1"}${q.get("probe") ? `&probe=${encodeURIComponent(q.get("probe") as string)}` : ""}${q.get("orderProbe") === "1" ? "&orderProbe=1" : ""}${q.get("deep") === "1" ? "&deep=1" : ""}`
          : path === "/api/iq/signals" ? `?limit=${Math.max(1, Math.min(200, Number(q.get("limit")) || 50))}${q.get("marketKey") ? `&marketKey=${encodeURIComponent(q.get("marketKey") as string)}` : ""}`
          : path === "/api/iq/apprentice/trades" ? `?limit=${Math.max(1, Math.min(200, Number(q.get("limit")) || 30))}`
          : path === "/api/iq/knowledge/search" ? `?q=${encodeURIComponent(String(q.get("q") || ""))}${q.get("regime") ? `&regime=${encodeURIComponent(q.get("regime") as string)}` : ""}${q.get("setup") ? `&setup=${encodeURIComponent(q.get("setup") as string)}` : ""}&limit=${Math.max(1, Math.min(20, Number(q.get("limit")) || 5))}`
          : path === "/api/iq/journal/agent" ? `?agentId=${encodeURIComponent(String(q.get("agentId") || ""))}`
          : "";
        const result = await relayAdminJson("GET", `${path}${query}`);
        if (!result) { if (path === "/api/iq/status") { json(200, { state: "DISCONNECTED", hasSession: false, lastError: "RELAY_UNAVAILABLE", practiceOnly: true }); return; } json(502, { error: "iq_relay_unavailable" }); return; }
        json(result.status, { ...result.body, ...(path === "/api/iq/office" ? {} : { practiceOnly: true }), brokerAutomation: "WS_ONLY_PRACTICE" });
        return;
      }
      if (req.method === "PUT" && !putPaths.includes(path)) { json(405, { error: "method_not_allowed" }); return; }
      if (req.method === "POST" && !postPaths.includes(path)) { json(405, { error: "method_not_allowed" }); return; }
      const payload: Record<string, unknown> = path === "/api/iq/connect" ? { email: String(operationalInput.email ?? "").trim(), password: String(operationalInput.password ?? "") }
        : path === "/api/iq/verify-2fa" ? { code: String(operationalInput.code ?? "").trim() }
        : path === "/api/iq/arm" ? { limitBrl: Number(operationalInput.limitBrl), confirmation: String(operationalInput.confirmation ?? "").slice(0, 40) }
        : path === "/api/iq/kill-switch" ? { engaged: operationalInput.engaged === true }
        : path === "/api/iq/market" ? { marketKey: String(operationalInput.marketKey ?? "").slice(0, 40), enabled: operationalInput.enabled === undefined ? undefined : operationalInput.enabled === true, paused: operationalInput.paused === undefined ? undefined : operationalInput.paused === true, maxStake: operationalInput.maxStake === undefined ? undefined : Number(operationalInput.maxStake), configuredStake: operationalInput.configuredStake === undefined ? undefined : Number(operationalInput.configuredStake), strategy: operationalInput.strategy === undefined ? undefined : String(operationalInput.strategy).slice(0, 8), strategyVariantId: operationalInput.strategyVariantId === undefined ? undefined : String(operationalInput.strategyVariantId).slice(0, 12) }
        : path === "/api/iq/config/global-stake" ? { value: Number(operationalInput.value ?? operationalInput.globalMaxStake), keys: Array.isArray(operationalInput.keys) ? (operationalInput.keys as unknown[]).map(String) : null }
        : path === "/api/iq/config/auto-execute" ? { enabled: operationalInput.enabled === true }
        : path === "/api/iq/mode" ? { mode: operationalInput.mode === "REAL" ? "REAL" : "PRACTICE" }
        : path === "/api/iq/real/confirm" ? { phrase: String(operationalInput.phrase ?? "").slice(0, 40), acknowledgeRisk: operationalInput.acknowledgeRisk === true, maxStake: Number(operationalInput.maxStake) }
        : path === "/api/iq/stress/run" ? { stages: Array.isArray(operationalInput.stages) ? (operationalInput.stages as unknown[]).map(Number) : [1, 3, 5, 10], secondsPerStage: Number(operationalInput.secondsPerStage) || 45 }
        : path === "/api/iq/apprentice/config" ? { enabled: operationalInput.enabled === undefined ? undefined : operationalInput.enabled === true, reviewEverySettlements: operationalInput.reviewEverySettlements === undefined ? undefined : Number(operationalInput.reviewEverySettlements), minCandidateSamples: operationalInput.minCandidateSamples === undefined ? undefined : Number(operationalInput.minCandidateSamples), minPerformanceDelta: operationalInput.minPerformanceDelta === undefined ? undefined : Number(operationalInput.minPerformanceDelta), maxCandidates: operationalInput.maxCandidates === undefined ? undefined : Number(operationalInput.maxCandidates), cooldownSettlements: operationalInput.cooldownSettlements === undefined ? undefined : Number(operationalInput.cooldownSettlements) }
        : path === "/api/iq/entry/config" ? { jitEnabled: operationalInput.jitEnabled === undefined ? undefined : operationalInput.jitEnabled === true, entryLeadMs: operationalInput.entryLeadMs === undefined ? undefined : Number(operationalInput.entryLeadMs), entryWindowMaxDriftMs: operationalInput.entryWindowMaxDriftMs === undefined ? undefined : Number(operationalInput.entryWindowMaxDriftMs), qualityGateEnabled: operationalInput.qualityGateEnabled === undefined ? undefined : operationalInput.qualityGateEnabled === true, minTradeQualityScore: operationalInput.minTradeQualityScore === undefined ? undefined : Number(operationalInput.minTradeQualityScore) }
        : path === "/api/iq/supervisor/config" ? { minSamples: operationalInput.minSamples === undefined ? undefined : Number(operationalInput.minSamples), maxDrawdown: operationalInput.maxDrawdown === undefined ? undefined : Number(operationalInput.maxDrawdown), maxConsecutiveLosses: operationalInput.maxConsecutiveLosses === undefined ? undefined : Number(operationalInput.maxConsecutiveLosses), minDecisionQuality: operationalInput.minDecisionQuality === undefined ? undefined : Number(operationalInput.minDecisionQuality), reviewCooldownMs: operationalInput.reviewCooldownMs === undefined ? undefined : Number(operationalInput.reviewCooldownMs) }
        : path === "/api/iq/hypotheses" ? { originAgent: typeof operationalInput.originAgent === "string" ? operationalInput.originAgent.slice(0, 80) : null, marketKey: typeof operationalInput.marketKey === "string" ? operationalInput.marketKey.slice(0, 40) : null, statement: String(operationalInput.statement ?? "").slice(0, 300), observedEffect: typeof operationalInput.observedEffect === "string" ? operationalInput.observedEffect.slice(0, 300) : null, sample: Number(operationalInput.sample) || 0, regime: typeof operationalInput.regime === "string" ? operationalInput.regime.slice(0, 24) : null, setup: typeof operationalInput.setup === "string" ? operationalInput.setup.slice(0, 32) : null, markets: Array.isArray(operationalInput.markets) ? (operationalInput.markets as unknown[]).map(String).slice(0, 10) : [] }
        : path === "/api/iq/hypotheses/evaluate" ? { id: String(operationalInput.id ?? "").slice(0, 80) }
        : path === "/api/iq/test-order" ? { marketKey: typeof operationalInput.marketKey === "string" ? operationalInput.marketKey.slice(0, 40) : null, direction: String(operationalInput.direction ?? "").slice(0, 8), stake: Number(operationalInput.stake), horizonSeconds: Number(operationalInput.horizonSeconds) || 60, decisionId: typeof operationalInput.decisionId === "string" ? operationalInput.decisionId.slice(0, 120) : null, idempotencyKey: typeof operationalInput.idempotencyKey === "string" ? operationalInput.idempotencyKey.slice(0, 120) : null }
        : {};
      if (path === "/api/iq/connect" && (!payload.email || !payload.password)) { json(400, { error: "email_password_required" }); return; }
      if (path === "/api/iq/verify-2fa" && !payload.code) { json(400, { error: "code_required" }); return; }
      if (path === "/api/iq/arm" && (!Number.isFinite(Number(payload.limitBrl)) || Number(payload.limitBrl) <= 0 || Number(payload.limitBrl) > 100)) { json(400, { error: "invalid_limit_brl" }); return; }
      if (path === "/api/iq/test-order" && (payload.direction !== "BUY" && payload.direction !== "SELL")) { json(400, { error: "direction_required" }); return; }
      if (path === "/api/iq/test-order" && (!Number.isFinite(Number(payload.stake)) || Number(payload.stake) <= 0 || Number(payload.stake) > 100)) { json(400, { error: "invalid_stake" }); return; }
      if (path === "/api/iq/market" && !String(payload.marketKey ?? "")) { json(400, { error: "market_key_required" }); return; }
      if (path === "/api/iq/config/global-stake" && (!Number.isFinite(Number(payload.value)) || Number(payload.value) <= 0 || Number(payload.value) > 100)) { json(400, { error: "invalid_global_stake" }); return; }
      if (path === "/api/iq/real/confirm" && !String(payload.phrase ?? "")) { json(400, { error: "real_confirmation_required" }); return; }
      const result = await relayAdminJson(path === "/api/iq/market" || path === "/api/iq/supervisor/config" || path === "/api/iq/entry/config" || path === "/api/iq/apprentice/config" ? "PUT" : "POST", path, payload, 20_000);
      if (!result) { json(502, { error: "iq_relay_unavailable" }); return; }
      if (!result.ok) { json(result.status >= 400 && result.status < 500 ? result.status : 502, { ...result.body, practiceOnly: true, brokerAutomation: "WS_ONLY_PRACTICE" }); return; }
      json(200, { state: result.body.state ?? (path === "/api/iq/disarm" ? "CONNECTED_PRACTICE" : "OK"), twoFactorRequired: result.body.twoFactorRequired === true, email: result.body.email ?? null, connectedAt: result.body.connectedAt ?? null, lastError: result.body.lastError ?? null, hasSession: result.body.hasSession === true, ...(path === "/api/iq/connect" || path === "/api/iq/verify-2fa" ? {} : result.body), practiceOnly: path === "/api/iq/real/confirm" || path === "/api/iq/mode" ? false : true, brokerAutomation: path === "/api/iq/connect" || path === "/api/iq/verify-2fa" ? "NONE" : "WS_ONLY_PRACTICE" });
      return;
    }
    if (path === "/api/strategies/stats" && req.method === "GET") {
      if (!process.env.TRACECOM_LIVE_RELAY_URL) { json(503, { error: "relay_not_configured" }); return; }
      try { json(200, await fetchStrategyStats()); } catch (error) { json(502, { error: error instanceof Error ? error.message : "strategy_stats_failed" }); }
      return;
    }
    if (path === "/api/strategies/history" && req.method === "GET") {
      if (!process.env.TRACECOM_LIVE_RELAY_URL) { json(503, { error: "relay_not_configured" }); return; }
      try { const history = await relayAdminGet(`/api/strategies/history?limit=${Math.max(10, Math.min(500, Number(q.get("limit")) || 200))}`); json(200, { ...history, shadowOnly: true, brokerAutomation: "NONE" }); } catch (error) { json(502, { error: error instanceof Error ? error.message : "strategy_history_failed" }); }
      return;
    }
    if (path === "/api/strategies/selection" && req.method === "GET") {
      const { selection, latestSignals } = await fetchStrategySelection();
      const brokerParam = q.get("brokerHorizonSeconds");
      const brokerHorizonSeconds = brokerParam === null || brokerParam.trim() === "" || !Number.isFinite(Number(brokerParam)) ? null : Number(brokerParam);
      json(200, { selection, latestSignals, compatibility: selection ? horizonCompatibility(selection, brokerHorizonSeconds) : null, shadowOnly: true });
      return;
    }
    if (path === "/api/strategies/selection" && req.method === "PUT") {
      const family = String(operationalInput.family ?? "").toUpperCase();
      const horizonSeconds = Number(operationalInput.horizonSeconds);
      const mode = operationalInput.mode === "AUTO" ? "AUTO" : "MANUAL";
      const candidate = makeSelection(family as never, horizonSeconds, "ui");
      if (!candidate) { json(400, { error: "invalid_variant", family, horizonSeconds }); return; }
      if (!process.env.TRACECOM_LIVE_RELAY_URL) { json(503, { error: "relay_not_configured" }); return; }
      const sent = await relayAdminSend("PUT", "/api/strategies/selection", { family: candidate.family, horizonSeconds: candidate.horizonSeconds, reason: String(operationalInput.reason ?? "ui").slice(0, 200), actor: String(operationalInput.actor ?? "ui").slice(0, 64), mode });
      if (!sent) { json(502, { error: "relay_persist_failed" }); return; }
      const { selection } = await fetchStrategySelection();
      json(200, { selection, requested: { ...candidate, mode }, appliesFromNextSignal: true, notice: "Aplicada a partir do proximo sinal se houver operacao ativa.", shadowOnly: true, brokerAutomation: "NONE" });
      return;
    }
    if (path === "/health" || path === "/api/health") {
      json(200, { ok: true, ts: Date.now() });
      return;
    }
    if (path === "/api/version" && req.method === "GET") {
      json(200, { commitSha: process.env.VERCEL_GIT_COMMIT_SHA || "unknown", dataCollectionFreeze: "DATA_COLLECTION_FREEZE", strategyAutoChange: false, buildTimestamp: process.env.VERCEL_GIT_COMMIT_SHA ? (process.env.VERCEL_DEPLOYMENT_ID || "unknown") : "unknown", visionProviderEnabled: process.env.TRACECOM_VISION_ENABLED !== "false", visionModel: process.env.TRACECOM_VISION_MODEL || process.env.AI_MODEL?.trim() || "deepseek-v4.1-flash", visionEndpoint: "/v1/messages", fableMode: "text-only", pipelineVersion: "vision-observation-fable-text-v1" });
      return;
    }

    if (path === "/api/vision/image" && req.method === "GET") {
      const memoryId = q.get("m"); const memory = memoryId ? ephemeralImages.get(memoryId) : null;
      if (memory && Number(q.get("e")) >= Date.now()) { res.statusCode = 200; res.setHeader("Content-Type", memory.contentType); res.setHeader("Cache-Control", "no-store"); res.end(memory.bytes); return; }
      const blobUrl = validVisionProxy(q.get("p") ?? "", q.get("e") ?? "", q.get("s") ?? "");
      if (!blobUrl) { res.statusCode = 403; res.end("forbidden"); return; }
      const object = await get(blobUrl, { access: "private", useCache: false });
      if (!object || object.statusCode !== 200) { res.statusCode = 404; res.end("not_found"); return; }
      const bytes = await new Response(object.stream).arrayBuffer();
      res.statusCode = 200;
      res.setHeader("Content-Type", object.blob.contentType || "image/jpeg");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.end(Buffer.from(bytes));
      return;
    }

    if (path === "/api/vision/price" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const dataUrl = input.dataUrl;
      if (!validImage({ label: "price-axis", dataUrl, mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined })) { json(400, { error: "price_crop_invalid" }); return; }
      const apiKey = (process.env.NEXXUS_API_KEY || process.env.FABLE_API_KEY || "").trim();
      if (!apiKey) { json(503, { error: "vision_provider_not_configured" }); return; }
      const provider = new NexxusVisionProvider({ apiKey, baseUrl: process.env.NEXXUS_BASE_URL || process.env.FABLE_BASE_URL || "https://api.nexxus-pro.site", model: process.env.TRACECOM_VISION_MODEL || process.env.AI_MODEL?.trim() || "deepseek-v4.1-flash", timeoutMs: 3_000 });
      let observation = await provider.observe({ imageDataUrl: String(dataUrl), frameId: typeof input.frameId === "string" ? input.frameId : null, task: "PRICE_LABEL_ONLY" });
      if (!(Number.isFinite(Number(observation.price)) && Number(observation.priceConfidence) >= .6)) observation = await provider.observe({ imageDataUrl: String(dataUrl), frameId: `${String(input.frameId || "price")}_retry`, task: "PRICE_LABEL_ONLY" });
      const frameId = typeof input.frameId === "string" ? input.frameId : null;
      const numericPrice = Number(observation.price);
      const asHistory = (value: unknown): AcceptedObservation[] => Array.isArray(value) ? value.filter((item): item is AcceptedObservation => Boolean(item) && typeof item === "object" && Number.isFinite(Number((item as AcceptedObservation).value)) && Number.isFinite(Number((item as AcceptedObservation).timestamp))).slice(-12) : [];
      const validation = Number.isFinite(numericPrice) && numericPrice > 0
        ? validatePriceObservation({ value: numericPrice, timestamp: Date.now(), confidence: Number(observation.priceConfidence) || 0, history: asHistory(input.history), outlierCandidates: asHistory(input.outlierCandidates), maxRelativeDeviation: Number(process.env.PRICE_OUTLIER_MAX_DEVIATION) || undefined })
        : { status: "UNAVAILABLE" as const, reason: "PRICE_UNREADABLE", rollingMedian: null, relativeDeviation: null, previousPrice: null, confirmations: 0 };
      const accepted = validation.status === "ACCEPTED" || validation.status === "REGIME_CHANGE_ACCEPTED";
      if (Number.isFinite(numericPrice) && numericPrice > 0) {
        if (accepted) priceMetrics.valid += 1;
        else { priceMetrics.rejected += 1; if (validation.reason === "TEMPORAL_OUTLIER") priceMetrics.outliers += 1; console.warn("PRICE_OBSERVATION_REJECTED", JSON.stringify({ frameId, reason: validation.reason, rawPrice: numericPrice, previousPrice: validation.previousPrice, rollingMedian: validation.rollingMedian, relativeDeviation: validation.relativeDeviation, confidence: observation.priceConfidence ?? 0 })); }
      }
      json(200, {
        priceObservation: { value: Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : null, confidence: observation.priceConfidence ?? 0, source: observation.priceSource || "UNAVAILABLE", labelVisible: observation.labelVisible === true, bbox: observation.bbox || null, timestamp: Date.now(), frameId, imageHash: observation.imageHash || null, accepted },
        validation,
        metrics: { ...priceMetrics },
      });
      return;
    }

    if (path === "/api/fast/decision" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const asPrices = (value: unknown) => Array.isArray(value) ? value.filter((item): item is { value: number; timestamp: number } => Boolean(item) && typeof item === "object" && Number.isFinite(Number((item as Record<string, unknown>).value)) && Number.isFinite(Number((item as Record<string, unknown>).timestamp))).slice(-120) : [];
      const asFrames = (value: unknown) => Array.isArray(value) ? value.filter((item): item is { capturedAt: number; frameDifference?: number | null; averageLuma?: number | null } => Boolean(item) && typeof item === "object" && Number.isFinite(Number((item as Record<string, unknown>).capturedAt))).slice(-24) : [];
      const deepContext = input.deepContext && typeof input.deepContext === "object" && !Array.isArray(input.deepContext) ? input.deepContext as { version: number; at: number; trend?: string | null; momentum?: string | null; regime?: string | null } : null;
      const result = buildFastDecision({
        now: Number(input.now) || Date.now(),
        prices: asPrices(input.prices),
        frames: asFrames(input.frames),
        deepContext,
        profile: input.profile === "CONSERVATIVE" || input.profile === "BALANCED" || input.profile === "AGGRESSIVE" ? input.profile : undefined,
        previousDecision: typeof input.previousDecision === "string" ? input.previousDecision : null,
        previousLean: typeof input.previousLean === "string" ? input.previousLean : null,
        previousMacroState: input.previousMacroState && typeof input.previousMacroState === "object" && !Array.isArray(input.previousMacroState) ? input.previousMacroState as { trend: "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN" | "UNCERTAIN"; confidence: number; pending: "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN" | "UNCERTAIN"; pendingCount: number; updatedAt: number; transitions: number; evidence: string[] } : null,
      });
      recordLatency("fast_total", result.timings.totalMs);
      console.info(result.fastPathStatus, JSON.stringify({ candleId: typeof input.candleId === "string" ? input.candleId : null, decision: result.decision, profile: result.selectedProfile, regime: result.regime, rawConfidence: result.rawConfidence, latencyMs: result.timings.totalMs }));
      json(200, { fast: { ...result, decisionId: typeof input.decisionId === "string" ? input.decisionId : null, sessionId: typeof input.sessionId === "string" ? input.sessionId : null, traceId: typeof input.traceId === "string" ? input.traceId : null, marketEventId: typeof input.marketEventId === "string" ? input.marketEventId : (typeof input.candleId === "string" ? input.candleId : null), candleId: typeof input.candleId === "string" ? input.candleId : null, frameId: typeof input.frameId === "string" ? input.frameId : null, decisionSource: typeof input.decisionSource === "string" ? input.decisionSource : "FAST", deepRequested: input.deepRequested === true, deepExecuted: false }, predictionHorizonSeconds: result.predictionHorizonSeconds });
      return;
    }

    if (path === "/api/research/audit" && req.method === "POST") {
      if (!(await researchAuthorized(req))) { json(403, { error: "research_auth_required" }); return; }
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const audits = runAudit(input as AuditInput, Array.isArray(input.checks) ? input.checks.filter((item): item is string => typeof item === "string").slice(0, 40) : undefined);
      let replay: Record<string, unknown> | null = null;
      if (Array.isArray(input.marketEvents) && input.marketEvents.length) {
        const requestedVariants = Array.isArray(input.variants) && input.variants.length ? input.variants as Variant[] : DEFAULT_VARIANTS;
        const report = await runVariants((input.marketEvents as ReplayEvent[]).slice(0, 500), requestedVariants.slice(0, 64), { concurrency: 8 });
        replay = { evaluations: report.evaluations.length, uniqueMarketEvents: report.uniqueMarketEvents, uniqueGroundTruths: report.uniqueGroundTruths, brokerSideEffects: report.brokerSideEffects, perVariant: report.perVariant };
      }
      console.info("RESEARCH_AUDIT_COMPLETED", JSON.stringify({ checks: audits.length, failures: audits.filter((item) => item.status === "FAIL").length, warnings: audits.filter((item) => item.status === "WARN").length, evaluations: replay ? replay.evaluations : 0 }));
      json(200, { audits, replay, predictionHorizonSeconds: 60, brokerAutomation: "NONE", generatedAt: Date.now() });
      return;
    }

    if (path.startsWith("/api/shadow/jobs") && req.method === "GET") {
      const base = process.env.TRACECOM_LIVE_RELAY_URL?.replace(/\/$/, "");
      const admin = process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET?.trim() ?? "";
      const token = (req.headers.authorization ?? "").toString();
      if (!base) { json(503, { error: "relay_not_configured" }); return; }
      try {
        const response = await fetch(`${base}${path}`, { headers: token ? { authorization: token } : { "x-relay-admin": admin }, signal: AbortSignal.timeout(8_000) });
        const payload = await response.text();
        res.statusCode = response.status; res.setHeader("Content-Type", "application/json"); res.end(payload);
      } catch { json(502, { error: "relay_unreachable" }); }
      return;
    }
    if (path.startsWith("/api/research/") || path.startsWith("/api/shadow/")) {
      if (!(await researchAuthorized(req))) { json(403, { error: "research_auth_required" }); return; }
      const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      if (path === "/api/research/session-autopsy" && req.method === "POST") {
        if (!researchRateOk(`autopsy:${ip}`, 30)) { json(429, { error: "rate_limited", bucket: "autopsy" }); return; }
        let bundle = input as Record<string, unknown>;
        let source = "provided_bundle";
        const sessionId = typeof input.sessionId === "string" ? input.sessionId : null;
        if (sessionId && !Array.isArray(input.events) && !Array.isArray(input.settlements)) {
          const relay = await fetchRelayBundle(sessionId);
          if (!relay) { json(404, { error: "session_bundle_unavailable", sessionId }); return; }
          source = "relay";
          const items = Array.isArray((relay.timeline as Record<string, unknown> | null)?.items) ? (relay.timeline as { items: Array<Record<string, unknown>> }).items : [];
          const events = items.filter((item) => item.kind === "event").map((item) => ({ t: new Date(String(item.at)).getTime(), type: String(item.type), data: item.data }));
          const settlements = items.filter((item) => item.kind === "settlement").map((item) => ({ signalId: item.decisionId ?? null, entryPrice: item.entry_price === null ? null : Number(item.entry_price), exitPrice: item.settlement_price === null ? null : Number(item.settlement_price), entryTimestamp: new Date(String(item.at)).getTime() - 60_000, exitTimestamp: new Date(String(item.at)).getTime(), result: String(item.result ?? "UNKNOWN") }));
          const samples = items.filter((item) => item.kind === "market_sample" && Number.isFinite(Number(item.price))).map((item) => ({ value: Number(item.price), timestamp: new Date(String(item.at)).getTime(), accepted: true, source: "RELAY_MARKET_SAMPLE" }));
          const logs = Array.isArray((relay.logs as Record<string, unknown> | null)?.logs) ? (relay.logs as { logs: Array<Record<string, unknown>> }).logs : [];
          const runs = Array.isArray((relay.agentRuns as Record<string, unknown> | null)?.runs) ? (relay.agentRuns as { runs: Array<Record<string, unknown>> }).runs : [];
          const signals = items.filter((item) => item.kind === "event" && item.type === "OPERATIONAL_SIGNAL_LOCKED").map((item) => { const payload = (item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {}) as Record<string, unknown>; const nested = payload.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : payload; return { signalId: String(nested.signalId ?? item.id ?? "unknown"), direction: String(nested.direction ?? "UNKNOWN"), createdAt: new Date(String(item.at)).getTime(), countdownEndsAt: Number(nested.countdownEndsAt) || new Date(String(item.at)).getTime() + 10_000, profile: typeof nested.profile === "string" ? nested.profile : undefined, rawConfidence: Number.isFinite(Number(nested.rawConfidence)) ? Number(nested.rawConfidence) : undefined, trendAlignment: typeof nested.trendAlignment === "string" ? nested.trendAlignment : undefined, macroTrend: typeof nested.macroTrend === "string" ? nested.macroTrend : undefined }; });
          bundle = { sessionId, events, settlements, prices: samples, agentRuns: runs, logs, signals };
        }
        const autopsy = runAutopsy({ ...(bundle as Record<string, unknown>), sessionId } as never);
        json(200, { autopsy, source, brokerAutomation: "NONE" });
        return;
      }
      if (path === "/api/research/compare" && req.method === "POST") {
        if (!researchRateOk(`compare:${ip}`, 30)) { json(429, { error: "rate_limited", bucket: "compare" }); return; }
        const evaluateVariant = async (variant: Variant) => { if (Array.isArray(input.marketEvents)) return (await runVariants((input.marketEvents as ReplayEvent[]).slice(0, 500), [variant], { concurrency: 4 })).evaluations; return []; };
        const variantA = (input.variantA as Variant) ?? DEFAULT_VARIANTS[0]!;
        const variantB = (input.variantB as Variant) ?? DEFAULT_VARIANTS[2]!;
        const [rowsA, rowsB] = await Promise.all([evaluateVariant(variantA), evaluateVariant(variantB)]);
        json(200, { comparison: compareVariants(rowsA, rowsB), variantA, variantB, brokerAutomation: "NONE" });
        return;
      }
      if (path === "/api/research/replay" && req.method === "POST") {
        if (!researchRateOk(`replay:${ip}`, 30)) { json(429, { error: "rate_limited", bucket: "replay" }); return; }
        const events = Array.isArray(input.marketEvents) ? input.marketEvents as ReplayEvent[] : input.marketEvent ? [input.marketEvent as ReplayEvent] : [];
        if (!events.length) { json(400, { error: "market_events_required" }); return; }
        const variants = Array.isArray(input.variants) && input.variants.length ? input.variants as Variant[] : DEFAULT_VARIANTS;
        const report = await runVariants(events.slice(0, 500), variants.slice(0, 64), { concurrency: 8 });
        json(200, { evaluations: report.evaluations.slice(0, 500), uniqueMarketEvents: report.uniqueMarketEvents, uniqueGroundTruths: report.uniqueGroundTruths, perVariant: report.perVariant, causalOnly: true, brokerAutomation: "NONE" });
        return;
      }
      if (path === "/api/shadow/evaluate" && req.method === "POST") {
        if (!researchRateOk(`shadow-single:${ip}`, 120)) { json(429, { error: "rate_limited", bucket: "shadow" }); return; }
        const event = input.marketEvent as ReplayEvent | undefined;
        if (!event || typeof event.marketEventId !== "string") { json(400, { error: "market_event_required" }); return; }
        const variant = (input.variant as Variant) ?? DEFAULT_VARIANTS[1]!;
        json(200, { evaluation: replayEvent(event, variant), brokerAutomation: "NONE" });
        return;
      }
      if (path === "/api/shadow/batch" && req.method === "POST") {
        const events = Array.isArray(input.marketEvents) ? input.marketEvents as ReplayEvent[] : [];
        const variants = Array.isArray(input.variants) && input.variants.length ? input.variants as Variant[] : DEFAULT_VARIANTS;
        if (!events.length) { json(400, { error: "market_events_required" }); return; }
        const evaluationsPlanned = Math.min(events.length, 500) * Math.min(variants.length, 64);
        if (!researchRateOk(`shadow-batch:${ip}`, 10) || evaluationsPlanned > 6_400) { json(429, { error: "batch_throttled", bucket: "shadow-batch", evaluationsPlanned, maxEvaluations: 6_400 }); return; }
        const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.slice(0, 80) : null;
        const cached = idempotencyKey ? shadowIdempotency.get(idempotencyKey) : null;
        if (cached && Date.now() - cached.createdAt < 600_000) { json(200, { ...(cached.result as Record<string, unknown>), idempotent: true }); return; }
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        shadowJobs.set(jobId, { status: "RUNNING", createdAt: Date.now(), result: null });
        await relayAdminSend("POST", "/api/shadow/jobs", { jobId, status: "RUNNING", requestedCount: evaluationsPlanned, queueDepth: 0, concurrency: Math.max(1, Math.min(8, Number(input.concurrency) || 8)), idempotencyKey });
        const report = await runVariants(events.slice(0, 500), variants.slice(0, 64), { concurrency: Math.max(1, Math.min(8, Number(input.concurrency) || 8)) });
        const result = { jobId, status: "COMPLETED", evaluations: report.evaluations.length, uniqueMarketEvents: report.uniqueMarketEvents, uniqueGroundTruths: report.uniqueGroundTruths, brokerSideEffects: report.brokerSideEffects, perVariant: report.perVariant, predictionHorizonSeconds: 60, brokerAutomation: "NONE" };
        shadowJobs.set(jobId, { status: "COMPLETED", createdAt: Date.now(), result });
        await relayAdminSend("PUT", `/api/shadow/jobs/${encodeURIComponent(jobId)}`, { status: "COMPLETED", processedCount: report.evaluations.length, failedCount: 0, queueDepth: 0, result: { evaluations: report.evaluations.length, uniqueMarketEvents: report.uniqueMarketEvents, uniqueGroundTruths: report.uniqueGroundTruths } });
        if (idempotencyKey) shadowIdempotency.set(idempotencyKey, { createdAt: Date.now(), result });
        console.info("SHADOW_BATCH_COMPLETED", JSON.stringify({ jobId, evaluations: report.evaluations.length, uniqueMarketEvents: report.uniqueMarketEvents }));
        json(200, result);
        return;
      }
      json(404, { error: "research_route_not_found", path });
      return;
    }

    if (path === "/api/settlement" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const direction = input.direction === "BUY" || input.direction === "SELL" ? input.direction : null;
      const entryPrice = Number(input.entryPrice);
      const exitPrice = input.exitPrice === null || input.exitPrice === undefined ? null : Number(input.exitPrice);
      const entryTimestamp = Number(input.entryTimestamp);
      const exitTimestamp = Number(input.exitTimestamp);
      const dueTimestamp = Number(input.dueTimestamp);
      if (!direction || !Number.isFinite(entryPrice) || !Number.isFinite(entryTimestamp) || !Number.isFinite(exitTimestamp) || !Number.isFinite(dueTimestamp)) { json(400, { error: "invalid_settlement_input" }); return; }
      if (exitTimestamp < dueTimestamp) { json(409, { error: "early_settlement_rejected", dueTimestamp, exitTimestamp }); return; }
      const result = settleTrade({ direction, entryPrice, exitPrice, entryTimestamp, exitTimestamp, dueTimestamp });
      console.info("TRADE_SETTLED", JSON.stringify({ source: "manual_operational_channel", direction, outcome: result.outcome, reason: result.reason }));
      json(200, { outcome: result.outcome, reason: result.reason });
      return;
    }

    if (path === "/api/fable/trade" && req.method === "POST") {
      try {
        json(200, await fableVisionTrade(body));
      } catch (error) {
        const message = error instanceof Error ? error.message : "fable_unavailable";
        if (message.startsWith("FABLE_HTTP_")) {
          const status = Number(message.match(/^FABLE_HTTP_(\d+)/)?.[1] || 0);
          const code = status === 401 || status === 403 ? "FABLE_AUTH_ERROR" : status === 404 ? "FABLE_MODEL_NOT_FOUND" : status === 422 ? "FABLE_INVALID_MULTIMODAL_PAYLOAD" : status === 429 ? "FABLE_RATE_LIMIT" : status >= 500 ? "FABLE_UPSTREAM_ERROR" : "FABLE_PROVIDER_BAD_REQUEST";
          json(422, {
            error: code,
            upstreamStatus: status,
            detail: redactSecretPatterns(message).slice(0, 420),
            analysisStatus: "ERROR",
            requestId,
            stage: "FABLE_REASONING",
          });
        } else {
          const timeout = error instanceof Error && (error.name === "AbortError" || message.includes("aborted"));
          const vision = message.startsWith("VISION_") || message.startsWith("vision_");
          json(503, { error: timeout ? "FABLE_TIMEOUT" : vision ? "VISION_UNAVAILABLE" : "FABLE_UNAVAILABLE", detail: redactSecretPatterns(message).slice(0, 420), analysisStatus: "ERROR", requestId, stage: vision ? "VISION_PERCEPTION" : "FABLE_REASONING" });
        }
      }
      return;
    }

    if (path === "/api/quant/research/dataset-summary" && req.method === "GET") {
      try { json(200, await relayAdminGet("/api/quant/research/dataset-summary")); } catch { json(503, { error: "quant_research_unavailable" }); } return;
    }
    if (path === "/api/technical/analyst" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const candles = Array.isArray(input.candles) ? input.candles : [];
      const mapped = candles.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object").map((c) => ({ provider: String(c.provider || "structured"), symbol: String(c.symbol || "UNKNOWN"), timeframe: "1m" as const, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume || 0), timestamp: Number(c.timestamp), receivedAt: Number(c.receivedAt || c.timestamp), isClosed: c.isClosed !== false, source: String(c.source || "structured"), quality: "high" as const })).filter((c) => [c.open, c.high, c.low, c.close, c.timestamp].every(Number.isFinite));
      const result = analyzeTechnicalState({ candles: mapped, marketContextId: String(input.marketContextId || ""), segmentId: String(input.segmentId || ""), referencePrice: Number.isFinite(Number(input.referencePrice)) ? Number(input.referencePrice) : null, observationsAvailable: Number(input.observationsAvailable) || 0 });
      json(200, { analyst: result, shadowOnly: true, brokerAutomation: "NONE" }); return;
    }
    if (path === "/api/quant/shadow" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const raw = Array.isArray(input.candles) ? input.candles : [];
      const candles = raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((c) => ({ provider: String(c.provider || "shadow"), symbol: String(c.symbol || "UNKNOWN"), timeframe: "1m" as const, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume || 0), timestamp: Number(c.timestamp), receivedAt: Number(c.receivedAt || c.timestamp), isClosed: c.isClosed !== false, source: String(c.source || "shadow"), quality: "high" as const })).filter((c) => [c.open, c.high, c.low, c.close, c.timestamp].every(Number.isFinite));
      if (!candles.length) { json(400, { error: "causal_candles_required", shadowOnly: true }); return; }
      const snapshot = buildFeatureSnapshot(candles);
      const decision = quantShadowDecision({ snapshot, labels: Array.isArray(input.labels) ? input.labels.filter((x): x is number => x === 0 || x === 1) : [] });
      try { await relayAdminSend("POST", "/api/quant/shadow/decisions", { decision, featureSnapshot: snapshot, sessionId: typeof input.sessionId === "string" ? input.sessionId : null, marketEventId: typeof input.marketEventId === "string" ? input.marketEventId : null }); } catch { /* shadow persistence is best effort and never blocks operation */ }
      json(200, { decision, featureSnapshot: snapshot, operationalStrategyChanged: false, brokerAutomation: "NONE", shadowOnly: true }); return;
    }

    if (path === "/api/analytics/record" && req.method === "POST") {
      if (body && typeof body === "object" && !Array.isArray(body)) decisionEvents.push({ ...(body as Record<string, unknown>), recordedAt: Date.now() });
      while (decisionEvents.length > 500) decisionEvents.shift();
      json(200, { ok: true, persisted: false, persistence: "BEST_EFFORT_SERVERLESS", note: "accepted_in_memory; durable persistence requires the local/managed datastore" });
      return;
    }

    if (path === "/api/training/sessions" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const requestedId = typeof input.sessionId === "string" && /^training_[A-Za-z0-9_]{4,90}$/.test(input.sessionId) ? input.sessionId : null;
      let session = requestedId ? await trainingStore.read(requestedId) : null;
      let recovered = false, created = false;
      if (session) recovered = true;
      if (!session) {
        created = true;
        session = createTrainingSession({
          id: requestedId ?? `training_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
          symbol: typeof input.symbol === "string" ? input.symbol : null,
          marketType: typeof input.marketType === "string" ? input.marketType : null,
          horizonSeconds: Number(input.horizonSeconds) || 60,
          maxEvaluatedTrades: Number(input.maxEvaluatedTrades) || 100,
          agentVersion: typeof input.agentVersion === "string" ? input.agentVersion : undefined,
          promptVersion: typeof input.promptVersion === "string" ? input.promptVersion : undefined,
          featureVersion: typeof input.featureVersion === "string" ? input.featureVersion : undefined,
          visionVersion: typeof input.visionVersion === "string" ? input.visionVersion : undefined,
        });
        await trainingStore.write(session);
        if (requestedId) { trainingMetrics.recoveries += 1; console.info("TRAINING_SESSION_RECOVERED", JSON.stringify({ sessionId: session.id, store: session.persistence })); }
        else { trainingMetrics.created += 1; console.info("TRAINING_SESSION_CREATED", JSON.stringify({ sessionId: session.id, store: session.persistence })); }
      }
      json(created ? 201 : 200, { ...trainingSummary(session), recovered, execution: "VIRTUAL_ONLY", brokerAutomation: "NONE" });
      return;
    }

    const trainingStopMatch = path.match(/^\/api\/training\/sessions\/([^/]+)\/stop$/);
    if (trainingStopMatch && req.method === "POST") {
      const session = await trainingStore.read(decodeURIComponent(trainingStopMatch[1]!));
      if (!session) { trainingMetrics.misses += 1; json(404, { error: "training_session_not_found" }); return; }
      session.status = "COMPLETED"; session.updatedAt = Date.now();
      await trainingStore.write(session);
      json(200, trainingSummary(session));
      return;
    }

    const trainingSessionMatch = path.match(/^\/api\/training\/sessions\/([^/]+)$/);
    if (trainingSessionMatch && req.method === "GET") {
      const session = await trainingStore.read(decodeURIComponent(trainingSessionMatch[1]!));
      if (!session) { trainingMetrics.misses += 1; json(404, { error: "training_session_not_found", recovery: "post the same sessionId to /api/training/sessions", store: trainingStore.mode() }); return; }
       if (session.status === "COMPLETED") { json(200, { ...trainingSummary(session), execution: "VIRTUAL_ONLY", brokerAutomation: "NONE" }); return; }
       const causalPrices = await fetchCausalTrainingPrices(session.sessionId ?? null);
       evaluateVirtualTrades(session, Date.now(), null, "UNAVAILABLE", null, (trade) => { const target = trade.entryTimestamp + trade.horizonSeconds * 1_000; const row = causalPrices.find((price) => price.observedAt >= target); return row ? { value: row.value, source: row.source, confidence: row.confidence } : null; });
      session.updatedAt = Date.now();
      await trainingStore.write(session);
      json(200, { ...trainingSummary(session), execution: "VIRTUAL_ONLY", brokerAutomation: "NONE" });
      return;
    }

    if (path === "/api/training/analyze" && req.method === "POST") {
      const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const sessionId = typeof input?.trainingSessionId === "string" ? input.trainingSessionId : "";
      if (!sessionId) { json(400, { error: "training_session_id_required" }); return; }
      const session = await trainingStore.read(sessionId);
      if (!session) { trainingMetrics.misses += 1; json(404, { error: "training_session_not_found", recovery: "post the same sessionId to /api/training/sessions", store: trainingStore.mode() }); return; }
      if (session.status === "COMPLETED" || session.status === "EXPIRED") { json(409, { error: "training_session_not_active", status: session.status }); return; }
      const snapshot = input?.snapshot && typeof input.snapshot === "object" && !Array.isArray(input.snapshot) ? input.snapshot as Record<string, unknown> : {};
      const analysis = input?.analysis && typeof input.analysis === "object" && !Array.isArray(input.analysis) ? input.analysis as Record<string, unknown> : {};
      const timestamp = Number(snapshot.timestampMs) || Date.now();
      const rawReference = snapshot.referencePrice;
      const reference = (typeof rawReference === "number" || typeof rawReference === "string") && String(rawReference).trim() !== "" && Number.isFinite(Number(rawReference)) ? Number(rawReference) : null;
       const causalPrices = await fetchCausalTrainingPrices(session.sessionId ?? (typeof snapshot.sessionId === "string" ? snapshot.sessionId : null));
       const virtualTrade = applyTrainingAnalysis(session, {
        timestamp, analysis, reference,
        referenceSource: typeof snapshot.referencePriceSource === "string" ? snapshot.referencePriceSource : "UNAVAILABLE",
        priceConfidence: finiteOrNull(snapshot.priceConfidence),
        suggestedStake: Number.isFinite(Number(input?.suggestedStake)) ? Number(input?.suggestedStake) : null,
        symbol: typeof snapshot.symbol === "string" ? snapshot.symbol : null,
        features: snapshot.features ?? null,
        framesHash: typeof snapshot.framesHash === "string" ? snapshot.framesHash : null,
        profiles: input?.profiles && typeof input.profiles === "object" && !Array.isArray(input.profiles) ? input.profiles as Record<string, { decision: string; confidence: number | null }> : undefined,
        selectedProfile: typeof input?.selectedProfile === "string" ? input.selectedProfile : null,
        regime: typeof input?.regime === "string" ? input.regime : null,
        rawConfidence: finiteOrNull(input?.rawConfidence),
        calibratedConfidence: finiteOrNull(input?.calibratedConfidence),
        synthetic: input?.synthetic === true,
        payoutAtDecision: finiteOrNull(input?.payoutAtDecision),
         breakEvenWinRate: finiteOrNull(input?.breakEvenWinRate),
         settlementResolver: (trade) => { const target = trade.entryTimestamp + trade.horizonSeconds * 1_000; const row = causalPrices.find((price) => price.observedAt >= target); return row ? { value: row.value, source: row.source, confidence: row.confidence } : null; },
       });
      session.updatedAt = Date.now();
      await trainingStore.write(session);
      json(200, { ...trainingSummary(session), virtualTrade, execution: "VIRTUAL_ONLY", brokerAutomation: "NONE" });
      return;
    }

    if (path === "/api/metrics" && req.method === "GET") {
      json(200, { training: { ...trainingMetrics, store: trainingStore.mode() }, price: { ...priceMetrics }, latency: allLatencyStats(), generatedAt: Date.now() });
      return;
    }

    if (path.endsWith("/status")) {
      json(200, { provider: "binance", state: "connected", configured: true });
      return;
    }

    if (path === "/api/catalog") {
      json(200, { assets: [
        { id: "binance:BTCUSDT", symbol: "BTCUSDT", name: "Bitcoin", market: "crypto", provider: "binance", baseAsset: "BTC", quoteAsset: "USDT", status: "active", metadata: {} },
        { id: "binance:ETHUSDT", symbol: "ETHUSDT", name: "Ethereum", market: "crypto", provider: "binance", baseAsset: "ETH", quoteAsset: "USDT", status: "active", metadata: {} },
        { id: "binance:SOLUSDT", symbol: "SOLUSDT", name: "Solana", market: "crypto", provider: "binance", baseAsset: "SOL", quoteAsset: "USDT", status: "active", metadata: {} },
      ]});
      return;
    }

    if (path.endsWith("/context") || path.endsWith("/market")) {
      const k = await safeKlines();
      if (typeof k === "string") {
        json(200, { provider: "binance", symbol, timeframe, available: false, currentPrice: null, dataQuality: "unknown", note: `provedor de mercado indisponível (${k})` });
        return;
      }
      if (k.length === 0) { json(200, { symbol, timeframe, available: false, note: "sem dados" }); return; }
      const candles = k;
      const closes = candles.map((c) => c.close);
      const last = candles[candles.length - 1]!;
      const prev = candles[candles.length - 2]!.close;
      const rsi = rsiLast(closes);
      const sma20 = sma(closes, 20);
      const volPct = Math.abs((last.close - prev) / prev) * 100;
      const regime = rsi === null ? null : rsi > 60 ? "uptrend" : rsi < 40 ? "downtrend" : "range";
      const sd = stdev(closes);
      json(200, {
        provider: "binance", symbol, timeframe, available: true,
        currentPrice: last.close,
        latestClosedCandle: last,
        volume: candles.reduce((s, c) => s + c.volume, 0),
        dataQuality: "high",
        quant: {
          technicalScore: sma20 !== null ? Math.max(-1, Math.min(1, ((last.close - sma20) / sma20) * 20)) : null,
          rsi,
          marketRegime: regime,
          structureTrend: last.close >= prev ? "up" : "down",
          atrPct: null,
          volatilityAnnualized: sd !== 0 ? sd * 1.732 : null,
          supports: candles.slice(-20).map((c) => c.low), resistances: candles.slice(-20).map((c) => c.high),
          sampleSize: closes.length,
          note: `volatilidade ${volPct.toFixed(2)}% no último candle`,
        },
      });
      return;
    }

    if (path.endsWith("/analyze")) {
      const now = Date.now();
      const rawDirection = (q.get("direction") ?? "up").toLowerCase();
      const direction: Direction = rawDirection === "down" ? "down" : "up";
      const horizon = Number(q.get("horizon") ?? DEFAULT_HORIZON);

      // Candles do TF operacional (maior amostra p/ probability + técnico).
      const k = await binanceKlinesSafe(symbol, timeframe, 300);
      if (typeof k === "string") {
        json(200, {
          decision: "WAIT", dataSufficient: false,
          rationale: `provedor indisponível (${k})`,
          note: "use Railway p/ backend completo",
          calibration: null,
          guards: { allowed: false, reason: "provedor indisponível" },
          confluence: null,
        });
        return;
      }
      if (k.length < 30) {
        json(200, {
          decision: "WAIT", dataSufficient: false, rationale: "dados insuficientes",
          calibration: null,
          guards: { allowed: true, reason: null },
          confluence: null,
        });
        return;
      }

      // --- Técnico (camada clássica) ---
      const closes = k.map((c) => c.close);
      const last = closes[closes.length - 1]!;
      const avg20 = sma(closes, 20)!;
      const tech = Math.max(-1, Math.min(1, ((last - avg20) / avg20) * 20));
      const counter = Math.abs(tech) < 0.18;
      const baseDecision = toDecision(tech, true, counter);

      // --- 3 TFs para confluência ---
      let confluence: { direction: "up" | "down" | "neutral"; agreementScore: number; confidenceBoost: number; reason: string } | null = null;
      try {
        const perTf = await fetchCandlesMultiTf(symbol);
        const { snapshots, direction: confDir } = buildConfluenceSnapshots(perTf, direction);
        if (snapshots.length >= 2 && confDir !== null) {
          const r = analyzeConfluenceLocal(snapshots, direction);
          confluence = {
            direction: r.direction,
            agreementScore: r.agreementScore,
            confidenceBoost: r.confidenceBoost,
            reason: r.reason,
          };
        }
      } catch {
        confluence = null;
      }

      // --- Probabilidade empírica (in-memory, sem persistência) ---
      const probability = quickEmpiricalProbability(k, direction, horizon, DEFAULT_MIN_MOVE_PCT);

      // --- Calibração Wilson ---
      let calibration: { calibratedProb: number; ciLower: number; ciUpper: number; baseline: number; expectedValue: number; actionable: boolean } | null = null;
      if (probability.sampleSize >= MIN_PROB_SAMPLE) {
        const p = probability.probability;
        const base = probability.baseline ?? 0.5;
        const ciLower = probability.confidenceInterval?.lower ?? wilsonLowerBound(probability.favorable, probability.sampleSize);
        const ciUpper = probability.confidenceInterval?.upper ?? (1 - ciLower);
        calibration = {
          calibratedProb: p,
          ciLower,
          ciUpper,
          baseline: base,
           expectedValue: expectedValue(p, 1, 1),
           actionable: isActionable(p, ciLower, base),
        };
      }

      // --- Guards (estado fresh — serverless não persiste) ---
      const guardState = freshGuardState(now);
      const sd = stdev(closes);
      // Vol anualizada como proxy p/ atrPct (em %); se volatilidade baixa, sem bloqueio.
      const atrPct = sd !== 0 ? sd * 1.732 / Math.max(last, 1e-9) * 100 : null;
      const age = lastCandleAgeMs(k, now, timeframe);
       const guardDecision = evaluateGuardsLocal({ atrPct, lastCandleAgeMs: age, now });
      const guards = { allowed: guardDecision.allow, reason: guardDecision.reason ?? null };

      // --- Combinação final: qualquer camada bloqueando → WAIT ---
      const blockedReasons: string[] = [];
      if (!guards.allowed) blockedReasons.push(guards.reason ?? "guards bloqueou");
      if (confluence && confluence.direction === "neutral") {
        blockedReasons.push(`confluência insuficiente (${confluence.reason})`);
      }
      if (calibration && !calibration.actionable && baseDecision !== "WAIT") {
        blockedReasons.push(
          `calibração não acionável (ci_lower ${(calibration.ciLower * 100).toFixed(1)}% ≤ baseline ${(calibration.baseline * 100).toFixed(1)}% + margem)`,
        );
      }
      const decision: "BUY" | "SELL" | "WAIT" = blockedReasons.length > 0 ? "WAIT" : baseDecision;
      const rationale = blockedReasons.length > 0
        ? `Bloqueado por: ${blockedReasons.join("; ")}. Técnico ${tech.toFixed(2)}. Provedor Binance (snapshot serverless).`
        : `${decision === "WAIT" ? "Contraponto insuficiente" : "Direcionamento"} — técnico ${tech.toFixed(2)}. Provedor Binance (snapshot).`;

      json(200, {
        decision,
        direction: decision === "WAIT" ? null : direction,
        score: tech,
        confidence: Math.min(0.9, 0.4 + Math.abs(tech)),
        dataSufficient: true,
        blockedByCounterEvidence: counter,
        rationale,
        factors: {
          favorable: [],
          counter: counter ? [{ text: `Score técnico ${tech.toFixed(2)} < limite` }] : [],
          invalidators: ["edge histórico não avaliado em serverless"],
        },
        calibration,
        guards,
        confluence,
        sampleSize: probability.sampleSize,
      });
      return;
    }

    if (path.endsWith("/news")) {
      const asset = (symbol.replace(/USDT$/, "") || "bitcoin").toLowerCase();
      try {
        const resN = await fetch(`${CC}/news?category=${encodeURIComponent(asset)}&lang=en`, { headers: { "User-Agent": "tracecon" } });
        const j = (await resN.json()) as { articles?: { title: string; link: string; pubDate?: string; source?: string; credibility?: number }[] };
        const items = (j.articles ?? []).slice(0, 8);
        json(200, { available: items.length > 0, source: "free-crypto-news", bias: null, items });
      } catch {
        json(200, { available: false, note: "fonte indisponível", items: [] });
      }
      return;
    }

    if (path.endsWith("/analytics/calibration")) {
      // Serverless: SQLite não está disponível. Devolve zeros honestos.
      json(200, {
        totalDecisions: 0, evaluated: 0, wins: 0, misses: 0, winRate: 0,
        brierScore: 0, ece: 0,
        perSignal: { BUY: { n: 0, wins: 0, winRate: 0, avgReturn: null }, SELL: { n: 0, wins: 0, winRate: 0, avgReturn: null }, WAIT: { n: 0, wins: 0, winRate: 0, avgReturn: null } },
        perTimeframe: {}, topSetups: [],
        drawdownObserved: 0, drawdownMax: 5,
        guardStatus: { circuitBreaker: "ok", dailyLossPct: 0, lastLossAt: null },
        snapshotAt: new Date().toISOString(),
        note: "em serverless a calibração real requer o backend Node local (npm run serve)",
      });
      return;
    }

    if (path.endsWith("/analytics/shadow")) {
      // Serverless: SQLite não está disponível. Devolve zeros honestos.
      json(200, {
        available: false,
        note: "shadow trades requerem backend Node local (npm run serve)",
        stats: { total: 0, evaluated: 0, wins: 0, winRate: 0, netReturn: 0, avgReturn: 0 },
        trades: [],
      });
      return;
    }

    if (path.endsWith("/analytics/perf-snapshot")) {
      json(200, {
        pnlTotal: 0, pnlPct: 0, sharpe: 0, maxDrawdown: 0,
        nTrades: 0, winRate: 0, periodStart: null, periodEnd: null,
        note: "em serverless a PnL real requer o backend Node local",
      });
      return;
    }

    if (path === "/extension/info") {
      json(200, {
        available: false,
        url: "/extension/download",
        filename: "tracecon-extension-v0.2.0.zip",
        sizeBytes: null,
        note: "em serverless o zip binário não pode ser servido; use o release do GitHub",
      });
      return;
    }
    if (path === "/extension/download") {
      json(503, { error: "extension_zip_unsupported_in_serverless" });
      return;
    }

    json(404, { error: "not_found", path });
  } catch (e) {
    json(500, { error: e instanceof Error ? e.message : "erro", note: "use Railway p/ backend completo" });
  }
}

async function binanceKlinesSafe(symbol: string, timeframe: string, limit: number): Promise<Candle[] | string> {
  try {
    return await binanceKlines(symbol, timeframe, limit);
  } catch (e) {
    return e instanceof Error ? e.message : "erro";
  }
}

/**
 * Probabilidade empírica derivada em memória, sem persistência.
 * Conta quantas janelas rolling (entryIndex → entryIndex+horizon) produziram
 * retorno na direção solicitada acima de `minMovePct`%.
 *
 * Não inventa dados: se a amostra for insuficiente (< MIN_SAMPLE), o caller
 * deve tratar `probability.sampleSize < 30` como ausência de calibração.
 */
const MIN_PROB_SAMPLE = 30;
const DEFAULT_HORIZON = 12;
const DEFAULT_MIN_MOVE_PCT = 0.3;

function quickEmpiricalProbability(
  candles: readonly Candle[],
  direction: Direction,
  horizon: number = DEFAULT_HORIZON,
  minMovePct: number = DEFAULT_MIN_MOVE_PCT,
): EmpiricalProbability {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const periodStart = n > 0 ? candles[0]!.timestamp : 0;
  const periodEnd = n > 0 ? candles[n - 1]!.timestamp : 0;

  let favorable = 0;
  let sampleSize = 0;
  for (let i = 0; i + horizon < n; i++) {
    const entry = closes[i]!;
    const exit = closes[i + horizon]!;
    if (entry === 0) continue;
    const pct = ((exit - entry) / entry) * 100;
    if (Math.abs(pct) < minMovePct) continue; // flat — exclui
    sampleSize++;
    if (direction === "up" ? pct > 0 : pct < 0) favorable++;
  }

  const prob = sampleSize > 0 ? favorable / sampleSize : 0;
  return {
    probability: prob,
    sampleSize,
    favorable,
    periodStart,
    periodEnd,
    similarityCriteria: "rolling-window-direction",
    horizon: `${horizon} candles`,
    methodology: "contagem direta em candles Binance (snapshot, sem similaridade)",
    confidenceInterval: sampleSize > 0
      ? {
          lower: wilsonLowerBound(favorable, sampleSize),
          upper: 1 - wilsonLowerBound(sampleSize - favorable, sampleSize),
          method: "wilson",
          level: 0.95,
        }
       : undefined,
    outOfSample: false,
    baseline: 0.5,
    limitations: [
      "amostra in-sample (sem split OOS)",
      "snapshot serverless: sem cold store",
      "sem filtro de similaridade",
    ],
  };
}

const CONFLUENCE_TFS: ReadonlyArray<Timeframe> = ["15m", "1h", "4h"];

async function fetchCandlesMultiTf(symbol: string): Promise<Record<Timeframe, Candle[]>> {
  const entries = await Promise.all(
    CONFLUENCE_TFS.map(async (tf) => {
      const k = await binanceKlinesSafe(symbol, tf, 120);
      const candles = typeof k === "string" ? [] : k;
      return [tf, candles] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Timeframe, Candle[]>;
}

function buildConfluenceSnapshots(
  perTf: Record<Timeframe, Candle[]>,
  direction: Direction,
): { snapshots: TFSnapshot[]; direction: "up" | "down" | "neutral" | null } {
  // Só calcula se ao menos 2 TFs têm 30+ candles (regra da fusão clássica).
  const eligible = CONFLUENCE_TFS.filter((tf) => perTf[tf] && perTf[tf]!.length >= 30);
  if (eligible.length < 2) return { snapshots: [], direction: null };
  const snapshots: TFSnapshot[] = eligible.map((tf) => ({
    tf,
    candles: perTf[tf]!.map((c) => ({ close: c.close, high: c.high, low: c.low })),
  }));
  return { snapshots, direction };
}

function lastCandleAgeMs(candles: readonly Candle[], now: number, timeframe: string): number | null {
  if (candles.length === 0) return null;
  const tfMs = TF_MS[timeframe];
  if (!tfMs) return null;
  const lastClose = candles[candles.length - 1]!.timestamp + tfMs;
  return Math.max(0, now - lastClose);
}
