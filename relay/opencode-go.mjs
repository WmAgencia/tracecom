/**
 * OPENCODE GO — provider adapter server-side (proxy). A API key vive SOMENTE no Postgres do relay
 * (migration 018). Este modulo monta requisicoes, executa com timeout evidencial (~3-5s observados,
 * limite 20s) e normaliza MarketObservation com fail-closed. NUNCA retorna/loga a key.
 * Sem fallback silencioso: erro -> status ERROR (quem chama decide fail-closed).
 */
import crypto from "node:crypto";

export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const VISION_TIMEOUT_MS = 20_000; // evidencia real: 3,0-4,9s + margem
export const TEXT_TIMEOUT_MS = 20_000;
export const DEFAULT_MODEL = "qwen3.7-plus";

/** session id derivado da sessao/contexto (sem segredos, sem valor global eterno). */
export function sessionFor(context = {}) {
  const basis = [context.sessionId, context.traceId, context.segmentId, context.requestId].filter((value) => typeof value === "string" && value.length > 0).join("|");
  const digest = crypto.createHash("sha256").update(basis || crypto.randomUUID()).digest("hex").slice(0, 16);
  return `tc-${digest}`;
}

export function shouldUseOpenCodeGo(config) {
  return Boolean(config) && config.status === "CONFIGURED" && config.provider === "openCodeGo";
}

export function resolveModel(config) {
  const model = config && typeof config.model === "string" ? config.model.trim() : "";
  return /^[a-z0-9.\-]{2,64}$/i.test(model) ? model : DEFAULT_MODEL;
}

export function buildVisionRequest({ model, imageDataUrl, prompt, sessionId }) {
  return {
    url: `${OPENCODE_GO_BASE}/chat/completions`,
    headers: { "content-type": "application/json", "x-opencode-session": sessionId },
    body: { model, max_tokens: 900, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] }] },
  };
}

export function buildTextRequest({ model, system, prompt, sessionId, maxTokens = 1500 }) {
  return {
    url: `${OPENCODE_GO_BASE}/chat/completions`,
    headers: { "content-type": "application/json", "x-opencode-session": sessionId },
    body: { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] },
  };
}

export function parseStructured(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { const parsed = JSON.parse(cleaned.slice(start, end + 1)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

function textOrNull(value, max = 120) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function numberOrNull(value) { if (value === null || value === undefined) return null; const raw = String(value).replace(",", ".").trim(); if (!raw) return null; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : null; }
function boolOrNull(value) { return typeof value === "boolean" ? value : null; }

/** Normaliza para o contrato de MarketObservation consumido pelo pipeline (UNKNOWN/null preservados). */
export function normalizeObservation(parsed, provenance) {
  if (!parsed) return failedObservation(provenance, "VISION_INVALID_JSON");
  const manual = parsed.manualPosition && typeof parsed.manualPosition === "object" ? parsed.manualPosition : {};
  const visual = parsed.visualQuality && typeof parsed.visualQuality === "object" ? parsed.visualQuality : {};
  const symbol = textOrNull(parsed.symbol) || textOrNull(parsed.asset);
  const hasUseful = Boolean(symbol || textOrNull(parsed.marketType) || numberOrNull(parsed.price) || numberOrNull(parsed.investmentValue) !== null || numberOrNull(parsed.expirationSeconds) !== null);
  const observation = {
    symbol,
    marketType: textOrNull(parsed.marketType),
    timeframeSeconds: numberOrNull(parsed.timeframeSeconds),
    price: numberOrNull(parsed.price),
    investmentValue: numberOrNull(parsed.investmentValue),
    expirationSeconds: numberOrNull(parsed.expirationSeconds),
    trend: textOrNull(parsed.trend, 40),
    structure: textOrNull(parsed.structure, 80),
    momentum: textOrNull(parsed.momentum, 40),
    volatility: textOrNull(parsed.volatility, 40),
    visibleCandleCount: numberOrNull(parsed.visibleCandleCount),
    visualQuality: { candlesReadable: boolOrNull(visual.candlesReadable), assetReadable: boolOrNull(visual.assetReadable), priceReadable: boolOrNull(visual.priceReadable) },
    manualPosition: { hasOpenPosition: manual.hasOpenPosition === true, state: textOrNull(manual.state, 32) || "NO_POSITION", direction: manual.direction === "BUY" || manual.direction === "SELL" ? manual.direction : "UNKNOWN", confidence: numberOrNull(manual.confidence), evidence: Array.isArray(manual.evidence) ? manual.evidence.filter((item) => typeof item === "string").slice(0, 6) : [] },
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((item) => typeof item === "string").slice(0, 8) : [],
    availability: hasUseful ? "PARTIAL" : "UNAVAILABLE",
    imageProvided: true,
    parseMode: "DIRECT",
    sources: ["opencode-go", "sanitized-crop-base64"],
    notes: hasUseful ? ["OPENCODE_GO_VISION_OK"] : ["IMAGE_PROVIDED_FIELDS_UNREADABLE"],
    provenance,
  };
  return observation;
}

export function failedObservation(provenance, note) {
  return { symbol: null, marketType: null, investmentValue: null, expirationSeconds: null, availability: "UNAVAILABLE", imageProvided: true, parseMode: "FAILED", sources: ["opencode-go"], notes: [note], provenance };
}

async function loadProviderConfig(pool) {
  const row = (await pool.query("SELECT provider, model, api_key FROM ai_provider_config WHERE id=1")).rows[0];
  if (!row || typeof row.api_key !== "string" || row.api_key.length < 8) return null;
  return { provider: row.provider || "openCodeGo", model: row.model, apiKey: row.api_key };
}

async function callProvider(request, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(request.url, { method: "POST", headers: { ...request.headers, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request.body), signal: controller.signal });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    return { status: response.status, latencyMs, text };
  } finally { clearTimeout(timer); }
}

export async function runVisionProvider(pool, { imageDataUrl, frameId = null, requestId = null, sessionContext = {} }) {
  const config = await loadProviderConfig(pool);
  const sessionId = sessionFor({ ...sessionContext, requestId });
  const provenanceBase = { provider: "openCodeGo", model: config ? resolveModel(config) : null, requestId, frameId, sessionId, timestamp: new Date().toISOString(), status: "PENDING", latencyMs: null };
  if (!config || config.provider !== "openCodeGo") return failedObservation({ ...provenanceBase, status: "ERROR" }, "PROVIDER_NOT_CONFIGURED");
  const model = resolveModel(config);
  const prompt = "RETURN JSON ONLY. Analyze this sanitized IQ Option chart crop. Shape: {\"symbol\":string|null,\"marketType\":\"OTC\"|\"FIXED\"|null,\"timeframeSeconds\":number|null,\"price\":number|null,\"investmentValue\":number|null,\"expirationSeconds\":number|null,\"trend\":\"BULLISH\"|\"BEARISH\"|\"SIDEWAYS\"|null,\"structure\":string|null,\"momentum\":\"UP\"|\"DOWN\"|\"NEUTRAL\"|null,\"volatility\":\"LOW\"|\"NORMAL\"|\"HIGH\"|null,\"visibleCandleCount\":number|null,\"visualQuality\":{\"candlesReadable\":boolean,\"assetReadable\":boolean,\"priceReadable\":boolean},\"manualPosition\":{\"hasOpenPosition\":boolean,\"state\":string,\"direction\":\"BUY\"|\"SELL\"|\"UNKNOWN\",\"confidence\":number|null,\"evidence\":string[]},\"evidence\":string[]}. Use null when a field is not visible in the crop. Never infer account balance, identity, broker controls or position direction from candle color. The crop may omit fields; null is valid and preferred over guessing.";
  const request = buildVisionRequest({ model, imageDataUrl, prompt, sessionId });
  try {
    const result = await callProvider(request, config.apiKey, VISION_TIMEOUT_MS);
    const body = (() => { try { return JSON.parse(result.text); } catch { return null; } })();
    const answer = body?.choices?.[0]?.message?.content;
    const parsed = parseStructured(typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((part) => part?.text ?? "").join("") : "");
    const status = result.status === 200 && parsed ? "OK" : "ERROR";
    const provenance = { ...provenanceBase, status, latencyMs: result.latencyMs, parseMode: parsed ? "DIRECT" : "FAILED" };
    if (status !== "OK") { console.info("OPENCODE_GO_VISION_FAILED", JSON.stringify({ requestId, frameId, httpStatus: result.status, latencyMs: result.latencyMs, sessionId })); return failedObservation(provenance, result.status === 200 ? "VISION_INVALID_JSON" : `OPENCODE_GO_HTTP_${result.status}`); }
    console.info("OPENCODE_GO_VISION_OK", JSON.stringify({ model, requestId, frameId, latencyMs: result.latencyMs, sessionId }));
    return normalizeObservation(parsed, provenance);
  } catch (error) {
    const reason = error?.name === "AbortError" ? "OPENCODE_GO_TIMEOUT" : "OPENCODE_GO_ERROR";
    console.info("OPENCODE_GO_VISION_FAILED", JSON.stringify({ requestId, frameId, reason, sessionId }));
    return failedObservation({ ...provenanceBase, status: "ERROR" }, reason);
  }
}

export async function runTextProvider(pool, { system = "You are a cautious quantitative analyst. Do not provide execution instructions.", prompt, maxTokens = 1500, requestId = null, sessionContext = {} }) {
  const config = await loadProviderConfig(pool);
  const sessionId = sessionFor({ ...sessionContext, requestId });
  if (!config || config.provider !== "openCodeGo") return { status: "ERROR", reason: "PROVIDER_NOT_CONFIGURED", requestId, sessionId, model: null, text: null, parsed: null, latencyMs: null };
  const model = resolveModel(config);
  const request = buildTextRequest({ model, system, prompt, sessionId, maxTokens });
  try {
    const result = await callProvider(request, config.apiKey, TEXT_TIMEOUT_MS);
    const body = (() => { try { return JSON.parse(result.text); } catch { return null; } })();
    const answer = body?.choices?.[0]?.message?.content;
    const text = typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((part) => part?.text ?? "").join("") : null;
    const parsed = parseStructured(text ?? "");
    const status = result.status === 200 && text ? "OK" : "ERROR";
    console.info("OPENCODE_GO_TEXT_RESULT", JSON.stringify({ model, requestId, status, latencyMs: result.latencyMs, sessionId, parsed: Boolean(parsed) }));
    return { status, reason: status === "OK" ? null : result.status === 200 ? "INVALID_JSON" : `HTTP_${result.status}`, requestId, sessionId, model, text, parsed, latencyMs: result.latencyMs };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "TIMEOUT" : "ERROR";
    console.info("OPENCODE_GO_TEXT_RESULT", JSON.stringify({ model, requestId, status: "ERROR", reason, sessionId }));
    return { status: "ERROR", reason, requestId, sessionId, model, text: null, parsed: null, latencyMs: null };
  }
}
