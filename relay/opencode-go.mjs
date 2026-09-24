/**
 * OPENCODE GO — provider adapter server-side (proxy). A API key vive SOMENTE no Postgres do relay
 * (migration 018). Este modulo monta requisicoes, executa com timeout evidencial (~3-5s observados,
 * limite 20s) e normaliza MarketObservation com fail-closed. NUNCA retorna/loga a key.
 * Sem fallback silencioso: erro -> status ERROR (quem chama decide fail-closed).
 */
import crypto from "node:crypto";

export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const OPENCODE_ZEN_BASE = "https://opencode.ai/zen/v1";
export const GROQ_BASE = "https://api.groq.com/openai/v1";
export const ALIBABA_BASE = "https://ws-yiugoy42gol8tmj8.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
export const VISION_TIMEOUT_MS = 40_000; // evidencia: crop real 250KB + JSON completo >30s; rota deep_background tolera 40s (limite, nunca infinito)
export const TEXT_TIMEOUT_MS = 20_000;
export const DEFAULT_MODEL = "deepseek-v4.1-flash";
export const ZEN_DEFAULT_MODEL = "space-bunny-free";
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
export const ALIBABA_DEFAULT_MODEL = "qwen3.5-flash";
export const DEFAULT_PROVIDER = "openCodeGo";

/** session id derivado da sessao/contexto (sem segredos, sem valor global eterno).
 *  `sessionKey` (quando presente) gera um id ESTAVEL por papel+opportunity (roteamento/cache). */
export function sessionFor(context = {}) {
  if (typeof context.sessionKey === "string" && context.sessionKey.length > 0) {
    return `tc-${crypto.createHash("sha256").update(context.sessionKey).digest("hex").slice(0, 16)}`;
  }
  const basis = [context.sessionId, context.traceId, context.segmentId, context.requestId].filter((value) => typeof value === "string" && value.length > 0).join("|");
  const digest = crypto.createHash("sha256").update(basis || crypto.randomUUID()).digest("hex").slice(0, 16);
  return `tc-${digest}`;
}

export function shouldUseOpenCodeGo(config) {
  return Boolean(config) && config.status === "CONFIGURED" && config.provider === "openCodeGo";
}

export function resolveModel(config) {
  const model = config && typeof config.model === "string" ? config.model.trim() : "";
  return /^[a-z0-9./\-]{2,96}$/i.test(model) ? model : (config?.provider === "groq" ? GROQ_DEFAULT_MODEL : config?.provider === "zen" ? ZEN_DEFAULT_MODEL : config?.provider === "alibaba" ? (process.env.ALIBABA_MODEL || ALIBABA_DEFAULT_MODEL) : DEFAULT_MODEL);
}

/** Mascara a key para qualquer serializacao publica (GET /api/ai/provider, logs). Nunca expoe o valor. */
export function maskProviderKey(key) {
  const value = typeof key === "string" ? key : "";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

/**
 * Resolve a config efetiva do provider: DB (autoritativa) > env (resiliencia a restart/recreate).
 * Env names lidos: AI_PROVIDER, AI_MODEL, OPENCODE_GO_API_KEY. Sem fallback para Anthropic.
 */
export function resolveProviderConfig({ dbConfig = null, env = process.env } = {}) {
  const dbKey = dbConfig && typeof dbConfig.apiKey === "string" && dbConfig.apiKey.trim().length >= 8 ? dbConfig.apiKey.trim() : "";
  if (dbKey) return { provider: (typeof dbConfig.provider === "string" && dbConfig.provider.trim()) || DEFAULT_PROVIDER, model: dbConfig.model ?? null, apiKey: dbKey };
  const envKeySource = (typeof env.GROQ_API_KEY === "string" ? env.GROQ_API_KEY.trim() : "") || (typeof env.OPENCODE_GO_API_KEY === "string" ? env.OPENCODE_GO_API_KEY.trim() : "");
  if (envKeySource.length < 8) return null;
  const provider = typeof env.AI_PROVIDER === "string" && env.AI_PROVIDER.trim() ? env.AI_PROVIDER.trim() : DEFAULT_PROVIDER;
  const model = typeof env.AI_MODEL === "string" && env.AI_MODEL.trim() ? env.AI_MODEL.trim() : (provider === "groq" ? GROQ_DEFAULT_MODEL : null);
  return { provider, model, apiKey: envKeySource };
}

export function buildVisionRequest({ model, imageDataUrl, prompt, sessionId }) {
  return {
    url: `${OPENCODE_GO_BASE}/chat/completions`,
    headers: { "content-type": "application/json", "x-opencode-session": sessionId },
    body: { model, max_tokens: 700, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] }] },
  };
}

export function buildTextRequest({ model, system, prompt, sessionId, maxTokens = 1500, temperature = null, responseFormat = null, reasoningEffort = null }) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] };
  if (temperature !== null) body.temperature = temperature;
  if (responseFormat !== null) body.response_format = responseFormat;
  if (reasoningEffort !== null) body.reasoning_effort = reasoningEffort;
  return { url: `${OPENCODE_GO_BASE}/chat/completions`, headers: { "content-type": "application/json", "x-opencode-session": sessionId }, body };
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
/** Mensagem de erro do provider, redigida contra segredos (nunca contem a key; defesa em profundidade). */
export function safeProviderError(text, max = 200) {
  if (typeof text !== "string" || !text) return null;
  return text.replace(/sk-[A-Za-z0-9_\-]+/g, "sk-***").slice(0, max);
}
function numberOrNull(value) { if (value === null || value === undefined) return null; const raw = String(value).replace(",", ".").trim(); if (!raw) return null; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : null; }
function boolOrNull(value) { return typeof value === "boolean" ? value : null; }
function enumOrNull(value, allowed) { const normalized = typeof value === "string" ? value.toUpperCase() : ""; return allowed.includes(normalized) ? normalized : null; }
function bounded100(value) { const parsed = numberOrNull(value); return parsed === null ? null : Math.max(0, Math.min(100, Math.round(parsed))); }
function stringList(value, max = 6) { return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).slice(0, max).map((item) => item.trim().slice(0, 200)) : []; }
function normalizeCandles(value) { return Array.isArray(value) ? value.slice(-40).map((candle, index) => ({ index: numberOrNull(candle?.index) ?? index, x: numberOrNull(candle?.x), bodyTopY: numberOrNull(candle?.bodyTopY), bodyBottomY: numberOrNull(candle?.bodyBottomY), wickTopY: numberOrNull(candle?.wickTopY), wickBottomY: numberOrNull(candle?.wickBottomY), direction: candle?.direction === "UP" || candle?.direction === "DOWN" ? candle.direction : "DOJI", open: numberOrNull(candle?.open), high: numberOrNull(candle?.high), low: numberOrNull(candle?.low), close: numberOrNull(candle?.close), confidence: numberOrNull(candle?.confidence) })) : []; }
function normalizeGeometry(value) { return Array.isArray(value) ? value.slice(0, 80).map((point) => ({ x: numberOrNull(point?.x), y: numberOrNull(point?.y) })).filter((point) => point.x !== null && point.y !== null) : []; }
function normalizeVisualIndicators(value) { const indicators = value && typeof value === "object" ? value : {}; const line = (item, extra) => ({ visible: item?.visible === true, period: numberOrNull(item?.period), ...(extra ? extra(item) : {}), geometry: normalizeGeometry(item?.geometry), confidence: numberOrNull(item?.confidence) }); const slope = (value2) => (["RISING", "FALLING", "FLAT"].includes(value2) ? value2 : null); return { donchian: line(indicators.donchian, null), rsi: line(indicators.rsi, (item) => ({ displayedValue: numberOrNull(item?.displayedValue), relativePosition: textOrNull(item?.relativePosition, 40), slopeVisual: slope(item?.slopeVisual) })), atr: line(indicators.atr, (item) => ({ displayedValue: numberOrNull(item?.displayedValue) })), adx: line(indicators.adx, (item) => ({ displayedValue: numberOrNull(item?.displayedValue), plusDI: numberOrNull(item?.plusDI), minusDI: numberOrNull(item?.minusDI), slopeVisual: slope(item?.slopeVisual) })) }; }

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
    ask: numberOrNull(parsed.ask),
    bid: numberOrNull(parsed.bid),
    payout: numberOrNull(parsed.payout),
    platformTime: textOrNull(parsed.platformTime, 24),
    displayedWindow: textOrNull(parsed.displayedWindow, 24),
    expirationDisplayed: textOrNull(parsed.expirationDisplayed, 24),
    sentiment: { abovePercent: numberOrNull(parsed.sentiment?.abovePercent ?? null), belowPercent: numberOrNull(parsed.sentiment?.belowPercent ?? null) },
    chartBounds: parsed.chartBounds && typeof parsed.chartBounds === "object" ? { x: numberOrNull(parsed.chartBounds.x), y: numberOrNull(parsed.chartBounds.y), width: numberOrNull(parsed.chartBounds.width), height: numberOrNull(parsed.chartBounds.height) } : null,
    candles: normalizeCandles(parsed.candles),
    visualIndicators: normalizeVisualIndicators(parsed.visualIndicators),
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
  const dbConfig = row && typeof row.api_key === "string" && row.api_key.length >= 8 ? { provider: row.provider || DEFAULT_PROVIDER, model: row.model, apiKey: row.api_key } : null;
  return resolveProviderConfig({ dbConfig });
}

async function callProvider(request, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(request.url, { method: "POST", headers: { ...request.headers, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request.body), signal: controller.signal });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    const headers = {};
    for (const name of ["retry-after", "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-requests"]) {
      const value = response.headers.get(name);
      if (value !== null && value !== undefined) headers[name] = value;
    }
    return { status: response.status, latencyMs, text, headers };
  } finally { clearTimeout(timer); }
}

/** VISUAL MARKET OBSERVER — extracao factual. NAO decide, NAO opina, NAO recomenda direcao. */
export const VISION_PROMPT = [
  "You are the TraceCom VISUAL MARKET OBSERVER. Extract ONLY objectively visible facts from this sanitized IQ Option crop. Do NOT decide BUY/SELL/WAIT, do NOT estimate win probability, do NOT give operational recommendations, do NOT reason about entries or confluence.",
  "Extract: market fields (symbol, marketType, OTC, platformTime, candleTimeframe, displayedWindow, expirationDisplayed, investmentValue, payout), price fields (currentPrice, ask, bid), sentiment (abovePercent, belowPercent), chart (chartBounds, visibleCandleCount), and EVERY identifiable candle as visual geometry.",
  "For each candle give: {\"index\":number,\"x\":number,\"bodyTopY\":number,\"bodyBottomY\":number,\"wickTopY\":number,\"wickBottomY\":number,\"direction\":\"UP\"|\"DOWN\"|\"DOJI\",\"confidence\":number} plus optional numeric OHLC ONLY if exact digits are read; otherwise omit/null. NEVER invent numbers; if OHLC cannot be determined visually, keep geometry only.",
  "For indicators visible on screen (Donchian, RSI, ATR, ADX, +DI, -DI) report presence and geometry ONLY: {\"visible\":boolean,\"period\":number|null,\"displayedValue\":number|null,\"relativePosition\":string|null,\"slopeVisual\":\"RISING\"|\"FALLING\"|\"FLAT\"|null,\"geometry\":[{\"x\":number,\"y\":number}],\"confidence\":number|null}. Never conclude anything from them.",
  "Use null when not visible. Never use future information. Report visualQuality (candlesReadable, assetReadable, priceReadable) and evidence strings.",
  "RETURN JSON ONLY (no markdown). Shape: {\"symbol\":string|null,\"marketType\":\"OTC\"|\"FIXED\"|null,\"platformTime\":string|null,\"timeframeSeconds\":number|null,\"displayedWindow\":string|null,\"expirationDisplayed\":string|null,\"investmentValue\":number|null,\"payout\":number|null,\"price\":number|null,\"ask\":number|null,\"bid\":number|null,\"sentiment\":{\"abovePercent\":number|null,\"belowPercent\":number|null},\"chartBounds\":{\"x\":number,\"y\":number,\"width\":number,\"height\":number}|null,\"visibleCandleCount\":number|null,\"candles\":[{\"index\":number,\"x\":number,\"bodyTopY\":number,\"bodyBottomY\":number,\"wickTopY\":number,\"wickBottomY\":number,\"direction\":\"UP\"|\"DOWN\"|\"DOJI\",\"open\":number|null,\"high\":number|null,\"low\":number|null,\"close\":number|null,\"confidence\":number}],\"visualIndicators\":{\"donchian\":{\"visible\":boolean,\"period\":number|null,\"geometry\":[{\"x\":number,\"y\":number}],\"confidence\":number|null},\"rsi\":{\"visible\":boolean,\"period\":number|null,\"displayedValue\":number|null,\"relativePosition\":string|null,\"slopeVisual\":\"RISING\"|\"FALLING\"|\"FLAT\"|null,\"geometry\":[{\"x\":number,\"y\":number}],\"confidence\":number|null},\"atr\":{\"visible\":boolean,\"period\":number|null,\"displayedValue\":number|null,\"confidence\":number|null},\"adx\":{\"visible\":boolean,\"period\":number|null,\"displayedValue\":number|null,\"plusDI\":number|null,\"minusDI\":number|null,\"slopeVisual\":\"RISING\"|\"FALLING\"|\"FLAT\"|null,\"confidence\":number|null}},\"manualPosition\":{\"hasOpenPosition\":boolean,\"state\":string,\"direction\":\"BUY\"|\"SELL\"|\"UNKNOWN\",\"confidence\":number|null,\"evidence\":string[]},\"visualQuality\":{\"candlesReadable\":boolean,\"assetReadable\":boolean,\"priceReadable\":boolean},\"evidence\":string[]}",
].join("\n");

export async function runVisionProvider(pool, { imageDataUrl, frameId = null, requestId = null, sessionContext = {} }) {
  const config = await loadProviderConfig(pool);
  const sessionId = sessionFor({ ...sessionContext, requestId });
  const provenanceBase = { provider: "openCodeGo", model: config ? resolveModel(config) : null, requestId, frameId, sessionId, timestamp: new Date().toISOString(), status: "PENDING", latencyMs: null };
  if (!config || config.provider !== "openCodeGo") return failedObservation({ ...provenanceBase, status: "ERROR" }, "PROVIDER_NOT_CONFIGURED");
  const model = resolveModel(config);
  const prompt = VISION_PROMPT;
  const request = buildVisionRequest({ model, imageDataUrl, prompt, sessionId });
  try {
    const result = await callProvider(request, config.apiKey, VISION_TIMEOUT_MS);
    const body = (() => { try { return JSON.parse(result.text); } catch { return null; } })();
    const answer = body?.choices?.[0]?.message?.content;
    const parsed = parseStructured(typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((part) => part?.text ?? "").join("") : "");
    const status = result.status === 200 && parsed ? "OK" : "ERROR";
    const provenance = { ...provenanceBase, status, latencyMs: result.latencyMs, parseMode: parsed ? "DIRECT" : "FAILED" };
    if (status !== "OK") { console.info("OPENCODE_GO_VISION_FAILED", JSON.stringify({ requestId, frameId, httpStatus: result.status, latencyMs: result.latencyMs, sessionId, providerError: safeProviderError(result.text) })); return failedObservation(provenance, result.status === 200 ? "VISION_INVALID_JSON" : `OPENCODE_GO_HTTP_${result.status}`); }
    console.info("OPENCODE_GO_VISION_OK", JSON.stringify({ model, requestId, frameId, latencyMs: result.latencyMs, sessionId }));
    return normalizeObservation(parsed, provenance);
  } catch (error) {
    const reason = error?.name === "AbortError" ? "OPENCODE_GO_TIMEOUT" : "OPENCODE_GO_ERROR";
    console.info("OPENCODE_GO_VISION_FAILED", JSON.stringify({ requestId, frameId, reason, sessionId }));
    return failedObservation({ ...provenanceBase, status: "ERROR" }, reason);
  }
}

export async function runTextProvider(pool, { system = "You are a cautious quantitative analyst. Do not provide execution instructions.", prompt, maxTokens = 1500, requestId = null, sessionContext = {}, temperature = null, responseFormat = null, reasoningEffort = null, timeoutMs = null, provider = null, model = null } = {}) {
  const dbConfig = await loadProviderConfig(pool);
  const requestedProvider = typeof provider === "string" && provider.trim() ? provider.trim() : (dbConfig?.provider ?? DEFAULT_PROVIDER);
  const apiKey = requestedProvider === "groq"
    ? (process.env.GROQ_API_KEY || (dbConfig?.provider === "groq" ? dbConfig.apiKey : null))
    : requestedProvider === "alibaba"
      ? (process.env.ALIBABA_API_KEY || (dbConfig?.provider === "alibaba" ? dbConfig.apiKey : null))
      : (process.env.OPENCODE_GO_API_KEY || (dbConfig?.provider === "openCodeGo" || dbConfig?.provider === "zen" ? dbConfig.apiKey : null));
  const config = { provider: requestedProvider, model: typeof model === "string" && model.trim() ? model.trim() : (requestedProvider === (dbConfig?.provider ?? DEFAULT_PROVIDER) ? dbConfig?.model ?? null : null), apiKey };
  const sessionId = sessionFor({ ...sessionContext, requestId });
  if (!apiKey || (config.provider !== "openCodeGo" && config.provider !== "groq" && config.provider !== "zen" && config.provider !== "alibaba")) return { status: "ERROR", reason: "PROVIDER_NOT_CONFIGURED", requestId, sessionId, model: null, text: null, parsed: null, latencyMs: null, usage: null, finishReason: null };
  const model_ = resolveModel(config);
  const request = config.provider === "groq"
    ? { url: `${GROQ_BASE}/chat/completions`, headers: { "content-type": "application/json" }, body: { model: model_, max_tokens: Math.max(Number(maxTokens) || 512, 4096), messages: [{ role: "system", content: system }, { role: "user", content: prompt }], ...(temperature !== null ? { temperature } : {}) } }
    : config.provider === "alibaba"
      ? { url: `${process.env.ALIBABA_BASE || ALIBABA_BASE}/chat/completions`, headers: { "content-type": "application/json" }, body: { model: model_, max_tokens: Math.max(Number(maxTokens) || 512, 2048), messages: [{ role: "system", content: system }, { role: "user", content: prompt }], ...(temperature !== null ? { temperature } : {}) } }
      : config.provider === "zen"
        ? { url: `${OPENCODE_ZEN_BASE}/chat/completions`, headers: { "content-type": "application/json", "x-opencode-session": sessionId }, body: { model: model_, max_tokens: Number(maxTokens) || 1500, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], ...(temperature !== null ? { temperature } : {}) } }
        : buildTextRequest({ model: model_, system, prompt, sessionId, maxTokens, temperature, responseFormat, reasoningEffort });
  try {
    const result = await callProvider(request, config.apiKey, Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : TEXT_TIMEOUT_MS);
    const body = (() => { try { return JSON.parse(result.text); } catch { return null; } })();
    const answer = body?.choices?.[0]?.message?.content;
    const text = typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((part) => part?.text ?? "").join("") : null;
    const parsed = parseStructured(text ?? "");
    const status = result.status === 200 && text ? "OK" : "ERROR";
    console.info("OPENCODE_GO_TEXT_RESULT", JSON.stringify({ provider: config.provider, model: model_, requestId, status, latencyMs: result.latencyMs, sessionId, parsed: Boolean(parsed), finishReason: body?.choices?.[0]?.finish_reason ?? null, httpStatus: result.status }));
    return { status, reason: status === "OK" ? null : result.status === 200 ? "INVALID_JSON" : `HTTP_${result.status}`, requestId, sessionId, model: model_, provider: config.provider, limits: result.headers ?? {}, text, parsed, latencyMs: result.latencyMs, usage: body?.usage ?? null, finishReason: body?.choices?.[0]?.finish_reason ?? null, httpStatus: result.status };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "TIMEOUT" : "ERROR";
    console.info("OPENCODE_GO_TEXT_RESULT", JSON.stringify({ provider: config.provider, model: model_, requestId, status: "ERROR", reason, sessionId }));
    return { status: "ERROR", reason, requestId, sessionId, model: model_, provider: config.provider, limits: {}, text: null, parsed: null, latencyMs: null, usage: null, finishReason: null, httpStatus: null };
  }
}

/** Config efetiva do provider (DB > env), sem expor a key. */
export async function effectiveProviderConfig(pool) {
  try { return await loadProviderConfig(pool); } catch { return resolveProviderConfig({ env: process.env }); }
}

/** Retry-After em ms a partir dos headers sanitizados do provider. */
export function retryAfterMs(headers = {}) {
  const raw = headers?.["retry-after"];
  if (raw === null || raw === undefined) return null;
  const value = Number(String(raw).trim());
  if (Number.isFinite(value)) return Math.max(0, value * 1000);
  const parsed = new Date(String(raw)).getTime();
  return Number.isFinite(parsed) ? Math.max(0, parsed - Date.now()) : null;
}

/** DECISION AGENT (text-only) — recebe numeros JA CALCULADOS; nunca pede ao LLM para calcular. */
export const DECISION_RULES = [
  "Pipeline: REGIME->STRUCTURE->LOCATION->MOMENTUM->VOLATILITY->TREND_STRENGTH->MICROSTRUCTURE->TRIGGER->DECISION. WAIT-FIRST: context/bias/trend are NOT entry; BUY/SELL requires a recent TRIGGER plus confluence; WAIT is valid and preferred when evidence is weak.",
  "Donchian = location only (touch never triggers; never chase extended moves; price pinned near lower band after a big drop = exhaustion risk, near upper after a big rally = exhaustion risk). RSI 70/30 are not triggers (use value/slope/divergence). ATR has no direction (expansion/contraction/climax). ADX is strength only (direction from structure and +DI/-DI; weak/converging = reduce continuation confidence). 60s horizon makes microstructure/timing critical. You may be right about regime and still lose on timing.",
  "The numeric indicator values in the context are mathematically calculated by the backend. USE THEM AS GIVEN; never recompute, adjust, or invent other numbers. estimatedWinProbability MUST be null (no calibrated model). referencePrice must be the causal price from the context (null if unavailable). Do not use future information. Freeze the analysis before outcome.",
].join("\n");

export function buildDecisionPrompt(context) {
  const indicators = context?.deterministicIndicators ?? {};
  const values = {};
  for (const [key, entry] of Object.entries(indicators)) values[key] = entry && typeof entry === "object" ? { value: entry.value ?? null, source: entry.source ?? "UNAVAILABLE" } : null;
  const payload = {
    market: context?.market ?? null,
    causalPrice: context?.causalPrice?.value ?? null,
    deterministicIndicators: values,
    microstructure: context?.microstructure ?? null,
    visualObservation: context?.visualObservation ? { symbol: context.visualObservation.symbol ?? null, marketType: context.visualObservation.marketType ?? null, price: context.visualObservation.price ?? null, ask: context.visualObservation.ask ?? null, bid: context.visualObservation.bid ?? null, sentiment: context.visualObservation.sentiment ?? null, visualIndicators: context.visualObservation.visualIndicators ?? null } : null,
    freshness: context?.freshness ?? null,
    provenance: context?.provenance ?? null,
  };
  return [
    DECISION_RULES,
    "CONTEXT (backend-calculated; numbers are authoritative):",
    JSON.stringify(payload).slice(0, 20_000),
    "RETURN JSON ONLY (no markdown): {\"action\":\"BUY\"|\"SELL\"|\"WAIT\",\"analysisConfidence\":number,\"estimatedWinProbability\":null,\"referencePrice\":number|null,\"horizonSeconds\":60,\"regime\":string,\"structuralBias\":string,\"trigger\":string|null,\"supportingEvidence\":string[],\"contradictingEvidence\":string[],\"primaryRisk\":string,\"waitReason\":string|null,\"whatWouldChange\":string[]}",
  ].join("\n");
}

export function parseDecision(text) {
  const parsed = parseStructured(typeof text === "string" ? text : "");
  if (!parsed || (parsed.action !== "BUY" && parsed.action !== "SELL" && parsed.action !== "WAIT")) {
    return { action: "UNAVAILABLE", analysisConfidence: 0, estimatedWinProbability: null, referencePrice: null, horizonSeconds: 60, regime: null, structuralBias: null, trigger: null, supportingEvidence: [], contradictingEvidence: [], primaryRisk: "DECISION_AGENT_INVALID_JSON", waitReason: "DECISION_AGENT_UNAVAILABLE", whatWouldChange: [] };
  }
  const confidence = numberOrNull(parsed.analysisConfidence);
  return {
    action: parsed.action,
    analysisConfidence: confidence === null ? 0 : Math.max(0, Math.min(100, Math.round(confidence))),
    estimatedWinProbability: null,
    referencePrice: numberOrNull(parsed.referencePrice),
    horizonSeconds: numberOrNull(parsed.horizonSeconds) ?? 60,
    regime: textOrNull(parsed.regime, 40),
    structuralBias: textOrNull(parsed.structuralBias, 40),
    trigger: textOrNull(parsed.trigger, 200),
    supportingEvidence: stringList(parsed.supportingEvidence),
    contradictingEvidence: stringList(parsed.contradictingEvidence),
    primaryRisk: textOrNull(parsed.primaryRisk, 200) ?? "",
    waitReason: textOrNull(parsed.waitReason, 200),
    whatWouldChange: stringList(parsed.whatWouldChange, 8),
  };
}

export async function runDecisionAgent(pool, { context, requestId = null, sessionContext = {} }) {
  const sessionId = sessionFor({ ...sessionContext, requestId });
  if (!context) return { status: "ERROR", reason: "CONTEXT_REQUIRED", requestId, sessionId, model: null, latencyMs: null, decision: parseDecision("") };
  const result = await runTextProvider(pool, { system: "You are the TraceCom Decision Agent. Cautious, WAIT-first, never invent numbers.", prompt: buildDecisionPrompt(context), maxTokens: 1200, requestId, sessionContext });
  if (result.status !== "OK" || typeof result.text !== "string") return { status: "ERROR", reason: result.reason ?? "TEXT_FAILED", requestId, sessionId: result.sessionId ?? sessionId, model: result.model, latencyMs: result.latencyMs, decision: parseDecision("") };
  const decision = parseDecision(result.text);
  console.info("DECISION_AGENT_RESULT", JSON.stringify({ action: decision.action, confidence: decision.analysisConfidence, model: result.model, latencyMs: result.latencyMs, sessionId: result.sessionId }));
  return { status: decision.action === "UNAVAILABLE" ? "ERROR" : "OK", reason: decision.action === "UNAVAILABLE" ? "INVALID_DECISION_JSON" : null, requestId, sessionId: result.sessionId ?? sessionId, model: result.model, latencyMs: result.latencyMs, decision };
}
