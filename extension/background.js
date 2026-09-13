/* TRACE/CON — service worker (background).
 *
 * Funções:
 *   - executa TRACE_1M localmente; sync remoto é opcional e nunca participa do sinal
 *   - agenda alarm a cada 30s quando auto-update está on
 *   - armazena último sinal por ativo (signalStore)
 *   - notifica todas as abas com o resultado
 *
 * NÃO executa ordens. NÃO clica em nada. Apenas atualiza o sinal.
 */
importScripts("local-engine.js");
importScripts("experiment-runner.js");
importScripts("diagnostic-sanitizer.js");

const ALARM_NAME = "tcTick";
const SHADOW_ALARM = "tcShadowTick";
const TICK_MS = 30; // production: 30 seconds
const TICK_MS_MIN = 2; // dev
const SHADOW_TICK_MIN = 5; // verifica shadow a cada 5 min
const SHADOW_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h fecha trade aberto
// TRACE_1M is a contract, not a tab preference. A chart on another interval
// must not silently change the prediction or expiry the user sees.
const TRACE_1M_TIMEFRAME = "1m";
const TRACE_1M_HORIZON = 1;
const apiHeaders = (opts, extra = {}) => ({
  accept: "application/json",
  ...(opts?.apiToken ? { Authorization: `Bearer ${opts.apiToken}` } : {}),
  ...extra,
});
const TRACE_PREFIX = "[TRACE_CON]";
const IQ_MARKET_KEY = "tcIqMarketStore";
const IQ_INSTRUMENT_REGISTRY_KEY = "tcIqInstrumentRegistry";
const IQ_ASSET_DEBUG_KEY = "tcIqAssetDebug";
const REMOTE_STATE_KEY = "tcRemoteApiState";
const DEV_DIAGNOSTIC_CACHE_KEY = "tcDevDiagnosticCache";
const DEV_DIAGNOSTIC_CACHE_TTL_MS = 10 * 60 * 1000;
const FABLE_TRADER_CACHE_KEY = "tcFableTraderCache";
const FABLE_TRADER_CACHE_TTL_MS = 15_000;
const FABLE_WARMUP_KEY = "tcFableTraderWarmups";
const FABLE_WARMUP_MS = 5 * 60_000;

function traceLog(scope, message, meta = {}) {
  console.info(`${TRACE_PREFIX}[${scope}] ${message}`, meta);
}

function traceError(scope, operation, error, extra = {}) {
  const message = String(error?.message || error || "unknown error");
  const result = { component: scope, operation, errorClass: "NETWORK_ERROR", message, timestamp: Date.now(), ...extra };
  console.warn(`${TRACE_PREFIX}[${scope}] ${operation} failed`, result);
  return result;
}

function remoteErrorClass(error) {
  const message = String(error?.message || error || "");
  return /cors/i.test(message) ? "REMOTE_API_CORS_ERROR" : "REMOTE_API_OFFLINE";
}
async function remoteState(patch = {}) {
  const prior = await new Promise((resolve) => chrome.storage.local.get([REMOTE_STATE_KEY], (s) => resolve(s[REMOTE_STATE_KEY] || { status: "REMOTE_API_DISABLED", enabled: false })));
  const next = { ...prior, ...patch, updatedAt: Date.now() };
  await new Promise((resolve) => chrome.storage.local.set({ [REMOTE_STATE_KEY]: next }, resolve));
  return next;
}
async function remoteFetch(opts, caller, url, init) {
  if (!opts.remoteApiEnabled || !opts.backend) return { ok: false, disabled: true, state: await remoteState({ enabled: false, status: "REMOTE_API_DISABLED", url: null, error: null }) };
  const timeoutMs = init.timeoutMs || 5_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  traceLog("REMOTE_API", "request", { method: init.method || "GET", url, caller, timestamp: Date.now(), timeoutMs });
  try {
    const response = await fetch(url, { ...init, signal: ctrl.signal });
    const state = await remoteState({ enabled: true, status: response.ok ? "REMOTE_API_ONLINE" : "REMOTE_API_OFFLINE", url, error: response.ok ? null : `HTTP ${response.status}`, httpStatus: response.status, caller });
    return { ok: response.ok, response, state };
  } catch (error) {
    const errorClass = error?.name === "AbortError" ? "REMOTE_API_TIMEOUT" : remoteErrorClass(error);
    const detail = { url, caller, errorClass, name: error?.name || "Error", message: String(error?.message || error), stack: error?.stack || null, timestamp: Date.now() };
    console.warn(`${TRACE_PREFIX}[REMOTE_API][ERROR]`, detail);
    return { ok: false, error, state: await remoteState({ enabled: true, status: "REMOTE_API_OFFLINE", url, error: `${detail.name}: ${detail.message}`, errorClass, caller }) };
  } finally { clearTimeout(timer); }
}

async function readLocalMarket() {
  return new Promise((resolve) => chrome.storage.local.get([IQ_MARKET_KEY], (s) => resolve(s[IQ_MARKET_KEY] || {})));
}
async function writeLocalMarket(store) {
  return new Promise((resolve) => chrome.storage.local.set({ [IQ_MARKET_KEY]: store }, resolve));
}
const marketKey = (frame, tabId) => `${tabId ?? "unknown"}:${frame.domain || (/OTC/i.test(frame.symbol) ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX")}:${String(frame.symbol || "").toUpperCase()}:${TRACE_1M_TIMEFRAME}`;
async function persistIqFrame(frame, tabId) {
  if (!frame?.symbol || !["candle", "tick"].includes(frame.kind)) return;
  const store = await readLocalMarket();
  const key = marketKey(frame, tabId);
  const item = store[key] || { symbol: String(frame.symbol).toUpperCase(), domain: frame.domain || (/OTC/i.test(frame.symbol) ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX"), sourceTabId: tabId ?? null, activeId: frame.activeId ?? null, candles: [], ticks: [], lastFrameAt: null, source: "iqoption:browser-session" };
  if (frame.kind === "candle") {
    const existing = item.candles.findIndex((c) => c.timestamp === frame.timestamp && c.timeframe === frame.timeframe);
    if (existing >= 0) item.candles[existing] = { ...frame };
    else item.candles.push({ ...frame });
    item.candles.sort((a, b) => a.timestamp - b.timestamp);
    item.candles = item.candles.slice(-240);
  } else {
    item.ticks.push({ ...frame });
    item.ticks = item.ticks.slice(-500);
  }
  item.lastFrameAt = Number(frame.receivedAt) || Date.now();
  item.lastPrice = frame.kind === "tick" ? frame.price : frame.close;
  item.lastPriceTimestamp = Number(frame.timestamp) || item.lastFrameAt;
  item.activeId = frame.activeId ?? item.activeId;
  store[key] = item;
  await writeLocalMarket(store);
  return item;
}

async function localAnalyze(symbol, tabId = null) {
  const store = await readLocalMarket();
  const wanted = String(symbol || "").toUpperCase();
  const item = Object.values(store).find((entry) => entry?.symbol === wanted && (tabId == null || entry.sourceTabId === tabId)) || null;
  return globalThis.TraceConLocalEngine.analyze(symbol, item);
}
function traderSnapshot(symbol, item, analysis) {
  return globalThis.TraceConDiagnostic?.sanitize({ profile: "FABLE_TRADER", horizonSeconds: 60, asset: symbol, domain: item?.domain || null, activeId: item?.activeId || null, price: analysis.currentPrice, feed: analysis.feed, features: analysis.features, localContext: { decision: analysis.decision, confidence: analysis.confidence, reasons: analysis.reasons, counterReasons: analysis.counterReasons, regime: analysis.regime }, candles: analysis.snapshot?.candles?.slice(-30), ticks: analysis.snapshot?.ticks?.slice(-120), generatedAt: Date.now() }) || {};
}
async function captureChartImage(tab, chartRect) {
  if (!tab?.windowId || !chartRect || !Number.isFinite(Number(chartRect.width)) || !Number.isFinite(Number(chartRect.height))) return { image: null, status: "UNAVAILABLE" };
  try {
    const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 72 });
    const response = await fetch(full); const bitmap = await createImageBitmap(await response.blob());
    const ratioX = bitmap.width / Math.max(1, Number(chartRect.viewportWidth)); const ratioY = bitmap.height / Math.max(1, Number(chartRect.viewportHeight));
    const sx = Math.max(0, Math.floor(Number(chartRect.left) * ratioX)), sy = Math.max(0, Math.floor(Number(chartRect.top) * ratioY)); const sw = Math.min(bitmap.width - sx, Math.floor(Number(chartRect.width) * ratioX)), sh = Math.min(bitmap.height - sy, Math.floor(Number(chartRect.height) * ratioY));
    if (sw < 120 || sh < 120) return { image: null, status: "CROP_INVALID" };
    const canvas = new OffscreenCanvas(Math.min(1280, sw), Math.min(720, sh)); const ctx = canvas.getContext("2d"); if (!ctx) return { image: null, status: "CROP_UNAVAILABLE" };
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height); const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: .78 }); const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { image: `data:image/jpeg;base64,${btoa(binary)}`, status: "PASS", capturedAt: Date.now() };
  } catch (error) { return { image: null, status: "CAPTURE_FAILED", error: String(error?.message || error) }; }
}
async function readFableWarmups() { return new Promise((resolve) => chrome.storage.local.get([FABLE_WARMUP_KEY], (s) => resolve(s[FABLE_WARMUP_KEY] || {}))); }
async function startFableWarmup(tabId, activeId, symbol) {
  const warmups = await readFableWarmups(); const key = `${tabId}:${activeId}:${symbol}`;
  if (!warmups[key]) { warmups[key] = { tabId, activeId, symbol, startedAt: Date.now(), requiredMs: FABLE_WARMUP_MS }; await new Promise((resolve) => chrome.storage.local.set({ [FABLE_WARMUP_KEY]: warmups }, resolve)); }
  return warmups[key];
}
async function getFableWarmup(tabId, activeId, symbol) {
  const warmups = await readFableWarmups(); const row = warmups[`${tabId}:${activeId}:${symbol}`];
  if (!row) return null; const elapsedMs = Math.max(0, Date.now() - Number(row.startedAt)); return { ...row, elapsedMs, ready: elapsedMs >= FABLE_WARMUP_MS, remainingMs: Math.max(0, FABLE_WARMUP_MS - elapsedMs) };
}
function evidenceDirection(local) {
  const score = Number(local?.features?.momentum?.roc5 || 0) + Number(local?.features?.momentum?.roc10 || 0) + Number(local?.features?.trend?.emaSlope || 0) + Number(local?.features?.trend?.mediumSlope || 0);
  if (score > 0) return "BUY"; if (score < 0) return "SELL";
  return local?.features?.candle?.bullBear === "BEAR" ? "SELL" : "BUY";
}
async function fableTraderAnalyze(symbol, tabId, local, tab = null, chartRect = null) {
  const store = await readLocalMarket(); const item = Object.values(store).find((entry) => entry?.symbol === String(symbol).toUpperCase() && entry?.sourceTabId === tabId) || null;
  if (!item?.activeId) return { ...local, decision: "WAIT", shadowEligible: false, rationale: "FABLE_TRADER_ASSET_NOT_BOUND", fableTrader: { status: "SKIPPED", reason: "ASSET_NOT_BOUND" } };
  const warmup = await getFableWarmup(tabId, item.activeId, String(symbol).toUpperCase());
  if (!warmup?.ready) return { ...local, decision: "WAIT", shadowEligible: false, rationale: "FABLE_TRADER_WARMUP", fableTrader: { status: "WARMING_UP", warmupRemainingMs: warmup?.remainingMs ?? FABLE_WARMUP_MS } };
  const capture = await captureChartImage(tab, chartRect); const snapshot = { ...traderSnapshot(symbol, item, local), analysisId: `fable-${Date.now()}`, tabId, snapshotTimestamp: Date.now(), chartCapture: { status: capture.status, capturedAt: capture.capturedAt || null } }; const fingerprint = globalThis.TraceConDiagnostic?.fingerprint(snapshot) || `fable-${Date.now()}`;
  const cached = await new Promise((resolve) => chrome.storage.local.get([FABLE_TRADER_CACHE_KEY], (s) => resolve(s[FABLE_TRADER_CACHE_KEY] || {})));
  let record = cached[fingerprint];
  if (!record || Date.now() - Number(record.receivedAt || 0) >= FABLE_TRADER_CACHE_TTL_MS) {
    try {
      const opts = await getOpts();
      if (!opts.remoteApiEnabled || !opts.backend) throw new Error("FABLE_BACKEND_NOT_CONFIGURED");
      const request = await remoteFetch(opts, "fable-trader", `${opts.backend}/api/fable/trade`, {
        method: "POST",
        headers: apiHeaders(opts, { "content-type": "application/json" }),
        body: JSON.stringify({ snapshot, ...(capture.image ? { chartImage: capture.image } : {}) }),
        timeoutMs: 20_000,
      });
      if (!request.ok) throw new Error(request.state?.error || "FABLE_TRADER_HTTP_ERROR");
      const data = await request.response.json();
      record = { ...data, fingerprint, receivedAt: Date.now(), captureStatus: capture.status };
      await new Promise((resolve) => chrome.storage.local.set({ [FABLE_TRADER_CACHE_KEY]: { ...cached, [fingerprint]: record } }, resolve));
    }
    catch (error) { const status = /abort|timeout/i.test(String(error)) ? "TIMEOUT" : "OFFLINE"; await patchIqDiagnostics(tabId, { fableTraderStatus: status, fableTraderAt: Date.now() }); return { ...local, decision: "WAIT", shadowEligible: false, rationale: "FABLE_TRADER_UNAVAILABLE", fableTrader: { status, error: String(error?.message || error) } }; }
  }
  const verdict = record?.analysis || {}; const decision = ["BUY", "SELL", "WAIT"].includes(verdict.decision) ? verdict.decision : "WAIT"; const confidence = Number(verdict.confidence);
  const accepted = ["BUY", "SELL"].includes(decision);
  const fableTrader = { status: "ONLINE", model: record?.model?.displayName || null, modelId: record?.model?.modelId || null, cached: !!cached[fingerprint], dataQuality: verdict.dataQuality ?? 0, imageUsed: verdict.imageUsed === true, visionStatus: capture.status === "PASS" ? (verdict.imageUsed === true ? "ENABLED" : "UNSUPPORTED") : capture.status, rawDecision: decision, rawConfidence: confidence, fingerprint };
  await patchIqDiagnostics(tabId, { fableTraderStatus: "ONLINE", fableTrader, fableTraderAt: Date.now() });
  return { ...local, strategyVersion: "fable-trader-v1-fable-only", decision, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(.99, confidence)) : 0, shadowEligible: accepted, rationale: accepted ? "FABLE_TRADER_SHADOW" : "FABLE_TRADER_WAIT", reasons: (verdict.supportingFactors || []).slice(0, 8), counterReasons: (verdict.opposingFactors || []).slice(0, 8), fableTrader };
}
async function readInstrumentRegistry() {
  return new Promise((resolve) => chrome.storage.local.get([IQ_INSTRUMENT_REGISTRY_KEY], (s) => resolve(s[IQ_INSTRUMENT_REGISTRY_KEY] || {})));
}
async function registerInstrument(instrument) {
  if (!instrument?.symbol || !Number.isSafeInteger(Number(instrument.activeId)) || Number(instrument.activeId) <= 0) return null;
  const registry = await readInstrumentRegistry();
  const id = String(instrument.activeId);
  registry[id] = { activeId: Number(instrument.activeId), symbol: String(instrument.symbol).toUpperCase(), displaySymbol: instrument.displaySymbol || instrument.symbol, domain: instrument.domain || null, source: instrument.source || "OBSERVED", verifiedAt: Number(instrument.verifiedAt) || null, sessionId: typeof instrument.sessionId === "string" ? instrument.sessionId.slice(0, 64) : null, instrumentType: instrument.instrumentType || "unknown", observedAt: Date.now() };
  await new Promise((resolve) => chrome.storage.local.set({ [IQ_INSTRUMENT_REGISTRY_KEY]: registry }, resolve));
  return registry[id];
}
async function persistAssetDebug(tabId, payload) {
  const current = await new Promise((resolve) => chrome.storage.local.get([IQ_ASSET_DEBUG_KEY], (s) => resolve(s[IQ_ASSET_DEBUG_KEY] || {})));
  const rawActiveId = Number(payload?.activeId);
  const rawPaths = payload?.websocket?.structure?.paths;
  const safeStructure = Array.isArray(rawPaths) ? { paths: rawPaths.slice(0, 24).filter((item) => item && typeof item.path === "string" && /^(?!.*(?:token|ssid|session|authorization|cookie|password|email|phone|user|balance|account|profile))/i.test(item.path)).map((item) => ({ path: item.path.slice(0, 120), type: typeof item.type === "string" ? item.type.slice(0, 24) : "unknown", ...(typeof item.value === "string" || typeof item.value === "number" || typeof item.value === "boolean" ? { value: typeof item.value === "string" ? item.value.slice(0, 96) : item.value } : {}) })) } : null;
  const safe = { reason: String(payload?.reason || "unknown").slice(0, 48), visibleText: typeof payload?.visibleText === "string" ? payload.visibleText.slice(0, 48) : null, domCandidate: payload?.domCandidate || null, domCandidates: Array.isArray(payload?.domCandidates) ? payload.domCandidates.slice(0, 12) : [], domSource: typeof payload?.domSource === "string" ? payload.domSource.slice(0, 80) : null, activeId: Number.isSafeInteger(rawActiveId) && rawActiveId > 0 ? rawActiveId : null, activeIdConfidence: Number.isSafeInteger(rawActiveId) && rawActiveId > 0 ? "UNVERIFIED" : "LOW", registrySymbol: typeof payload?.registrySymbol === "string" ? payload.registrySymbol.slice(0, 32) : null, feedSymbol: typeof payload?.feedSymbol === "string" ? payload.feedSymbol.slice(0, 32) : null, lastPrice: Number.isFinite(Number(payload?.lastPrice)) && Number(payload.lastPrice) > 0 ? Number(payload.lastPrice) : null, status: ["UNKNOWN", "DOM_RESOLVED", "PARTIAL", "MATCH", "MISMATCH"].includes(payload?.status) ? payload.status : "UNKNOWN", websocket: payload?.websocket && typeof payload.websocket === "object" ? { eventName: String(payload.websocket.eventName || "unknown").slice(0, 48), activeIds: Array.isArray(payload.websocket.activeIds) ? payload.websocket.activeIds.slice(0, 24).map((item) => ({ activeId: Number(item?.activeId), symbol: typeof item?.symbol === "string" ? item.symbol.slice(0, 48) : null })).filter((item) => Number.isSafeInteger(item.activeId) && item.activeId > 0) : [], structure: safeStructure } : null, observedAt: Date.now() };
  const next = { ...current, [String(tabId)]: { ...(current[String(tabId)] || {}), latest: safe, events: [...(current[String(tabId)]?.events || []).slice(-39), safe] } };
  await new Promise((resolve) => chrome.storage.local.set({ [IQ_ASSET_DEBUG_KEY]: next }, resolve));
  return safe;
}

// ------------------------------------------------------------
// Shadow trading helpers
// ------------------------------------------------------------
async function readShadowOpen() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tcShadowOn"], (s) => {
      resolve(s.tcShadowOn || null);
    });
  });
}
async function postShadowToBackend(trade, opts) {
  if (!trade) return { ok: false, error: "no_trade" };
  if (!opts.remoteApiEnabled || !opts.backend) return { ok: false, disabled: true, remoteApi: "REMOTE_API_DISABLED" };
  const backend = opts.backend.replace(/\/$/, "");
  // Tenta primeiro POST /api/analytics/shadow (rota dedicada, se existir).
  // Fallback: usa POST /api/analytics/record.
  const params = new URLSearchParams({
    symbol: trade.symbol || "",
    timeframe: TRACE_1M_TIMEFRAME,
    direction: trade.direction || "up",
    decision: trade.decision || "WAIT",
    horizon: String(TRACE_1M_HORIZON),
    entryTime: String(trade.entryTime || Date.now()),
    entryPrice: trade.entryPrice != null ? String(trade.entryPrice) : "",
    score: trade.score != null ? String(trade.score) : "0",
    confidence: trade.confidence != null ? String(trade.confidence) : "0",
    probability: trade.probability != null ? String(trade.probability) : "",
    sampleSize: "0",
    regime: "",
    rationale: trade.closeReason ? `shadow:${trade.closeReason}` : "shadow",
  });
  if (trade.exitTime != null) params.set("exitTime", String(trade.exitTime));
  if (trade.exitPrice != null) params.set("exitPrice", String(trade.exitPrice));
  // tenta POST primeiro
  try {
    const request = await remoteFetch(opts, "shadow-sync", `${backend}/api/analytics/shadow`, {
      method: "POST",
      headers: apiHeaders(opts, { "content-type": "application/json" }),
      body: JSON.stringify(trade),
      timeoutMs: 5_000,
    });
    if (request.ok) return { ok: true, route: "shadow", data: await request.response.json().catch(() => null) };
  } catch (e) { /* cai no fallback */ }
  // fallback: POST /api/analytics/record
  try {
    const request = await remoteFetch(opts, "shadow-record-sync", `${backend}/api/analytics/record?${params.toString()}`, {
      method: "POST",
      headers: apiHeaders(opts),
      timeoutMs: 5_000,
    });
    if (request.ok) return { ok: true, route: "record", data: await request.response.json().catch(() => null) };
    return { ok: false, error: request.state?.error || "remote sync unavailable" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
async function closeShadowIfStale() {
  const open = await readShadowOpen();
  if (!open) return;
  const age = Date.now() - (open.entryTime || Date.now());
  if (age < SHADOW_MAX_AGE_MS) return;
  const closed = {
    ...open,
    exitTime: Date.now(),
    exitPrice: open.currentPrice ?? open.entryPrice ?? null,
    closeReason: "auto_24h",
  };
  // limpa storage local
  await new Promise((resolve) => {
    chrome.storage.local.set({ tcShadowOn: null, tcShadow: null }, resolve);
  });
  // Sync remoto é estritamente secundário; o histórico local já foi preservado.
  const opts = await getOpts();
  postShadowToBackend(closed, opts).catch(() => null);
  // notifica tabs para atualizarem badge
  await broadcast({ type: "tc.shadowClosed", payload: closed });
}

// ------------------------------------------------------------
// storage helpers
// ------------------------------------------------------------
async function getOpts() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["tcBackend", "tcApiToken", "tcAuto", "tcSymbols", "tcDirection", "tcRemoteApiEnabled"],
      (s) => {
        resolve({
          backend: typeof s.tcBackend === "string" && s.tcBackend.trim() ? s.tcBackend.trim().replace(/\/$/, "") : null,
          remoteApiEnabled: s.tcRemoteApiEnabled === true && typeof s.tcBackend === "string" && /^https?:\/\//i.test(s.tcBackend),
          apiToken: s.tcApiToken || "",
          auto: !!s.tcAuto,
          symbols: Array.isArray(s.tcSymbols) && s.tcSymbols.length ? s.tcSymbols : ["EURUSD", "GBPUSD", "USDJPY"],
          timeframe: TRACE_1M_TIMEFRAME,
          direction: s.tcDirection || "up",
          horizon: TRACE_1M_HORIZON,
        });
      },
    );
  });
}

async function setOpt(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ------------------------------------------------------------
// Local signal path — deliberately zero HTTP.
// ------------------------------------------------------------
async function callAnalyze(symbol, tabId = null, tab = null, chartRect = null) {
  const local = await localAnalyze(symbol, tabId);
  return { ...(await fableTraderAnalyze(symbol, tabId, local, tab, chartRect)), backend: "LOCAL_FABLE", remoteApi: await remoteState() };
}

async function forwardIqMarket(frame, tabId, backend, opts) {
  if (!opts.remoteApiEnabled || !backend) return { ok: false, disabled: true, state: await remoteState({ enabled: false, status: "REMOTE_API_DISABLED", url: null, error: null }) };
  // Frame is already whitelisted/normalized by the bridge. Do not forward raw
  // page messages, cookies, credentials, SSID, account or trade information.
  const body = { ...frame, tabId, receivedAt: Number(frame.receivedAt) || Date.now() };
  try {
    const request = await remoteFetch(opts, "iq-market-sync", `${backend.replace(/\/$/, "")}/api/iq-option/ingest`, {
      method: "POST", headers: apiHeaders(opts, { "content-type": "application/json" }), body: JSON.stringify(body),
      timeoutMs: 5_000,
    });
    if (!request.ok) return { ok: false, diagnostic: { component: "REMOTE_API", operation: "iq-option/ingest", errorClass: request.state?.errorClass || "REMOTE_API_OFFLINE", message: request.state?.error || "remote sync unavailable", url: request.state?.url || null, timestamp: Date.now() } };
    return { ok: true };
  } catch (error) {
    return { ok: false, diagnostic: traceError("REMOTE_API", "iq-option/ingest", error, { errorClass: remoteErrorClass(error) }) };
  }
}

// Diagnostics contain only extension transport state. They intentionally never
// include account data, page content, cookies, SSID, or raw broker messages.
async function readIqDiagnostics() {
  return new Promise((resolve) => chrome.storage.local.get(["tcIqDiagnostics", "tcDownbarEnabled"], (s) => resolve({ tabs: s.tcIqDiagnostics || {}, downbarEnabled: s.tcDownbarEnabled !== false })));
}
async function patchIqDiagnostics(tabId, patch) {
  const current = await readIqDiagnostics();
  const tabs = { ...current.tabs, [String(tabId)]: { ...(current.tabs[String(tabId)] || {}), ...patch, updatedAt: Date.now() } };
  await new Promise((resolve) => chrome.storage.local.set({ tcIqDiagnostics: tabs }, resolve));
  return tabs[String(tabId)];
}
async function extensionDiagnostics() {
  const current = await readIqDiagnostics();
  const tabs = Object.entries(current.tabs).map(([tabId, value]) => ({ tabId: Number(tabId), ...value })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const remoteApi = await remoteState();
  const local = await readLocalMarket();
  const activeMarket = Object.values(local).filter((item) => !tabs[0] || item?.sourceTabId === tabs[0].tabId).sort((a, b) => (b.lastFrameAt || 0) - (a.lastFrameAt || 0))[0] || null;
  const debug = await new Promise((resolve) => chrome.storage.local.get([IQ_ASSET_DEBUG_KEY], (s) => resolve(s[IQ_ASSET_DEBUG_KEY]?.[String(tabs[0]?.tabId)]?.latest || null)));
  return { ...(tabs[0] || {}), assetDebug: debug, downbarEnabled: current.downbarEnabled, remoteApi, backend: { online: remoteApi.status === "REMOTE_API_ONLINE" }, states: { iqAdapter: tabs[0]?.bridgeActive ? "LIVE" : "WAITING", marketData: activeMarket ? "LIVE" : "WAITING", localEngine: "READY", shadowEngine: "ACTIVE", history: "READY", remoteApi: remoteApi.status }, market: activeMarket ? { price: activeMarket.lastPrice ?? null, candles: activeMarket.candles?.length || 0, ticks: activeMarket.ticks?.length || 0 } : { price: null, candles: 0, ticks: 0 } };
}

// ------------------------------------------------------------
// signal store
// ------------------------------------------------------------
async function readStore() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tcStore"], (s) => {
      resolve(s.tcStore || {});
    });
  });
}
async function writeStore(store) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ tcStore: store }, resolve);
  });
}

async function broadcast(msg) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    try { chrome.tabs.sendMessage(t.id, msg); } catch {}
  }
}

async function runTick(triggeredByTimer) {
  const opts = await getOpts();
  // IQ Option shadow decisions are always tied to the active chart tab. A
  // global timer has no trustworthy tab/asset identity, so it must not scan
  // the configured symbol list and accidentally publish a stale cross-tab
  // result. Fresh accepted IQ frames trigger analysis from their own tab.
  if (triggeredByTimer) return;
  if (!opts.auto && !triggeredByTimer === false) return; // manual só se triggeredByTimer false
  // Manual (não timer): ignora o auto e roda sempre que o content pedir
  if (!triggeredByTimer && !opts.auto) {
    // ok, manual
  }
  if (triggeredByTimer && !opts.auto) return; // timer só se auto=on

  for (const symbol of opts.symbols) {
    try {
      const data = await callAnalyze(symbol);
      const key = `${symbol}-${opts.timeframe}`;
      const store = await readStore();
      const prev = store[key];
      store[key] = {
        decision: data.decision,
        score: data.score,
        confidence: data.confidence,
        probability: data.probability,
        currentPrice: data.currentPrice,
        ts: Date.now(),
      };
      await writeStore(store);
      // atualiza currentPrice no shadow aberto se símbolo/TF baterem
      const open = await readShadowOpen();
      if (open && open.symbol === symbol && open.timeframe === opts.timeframe && data.currentPrice != null) {
        const updated = { ...open, currentPrice: data.currentPrice };
        await new Promise((resolve) => {
          chrome.storage.local.set({ tcShadowOn: updated, tcShadow: updated }, resolve);
        });
      }
      // notifica mudança se o sinal mudou
      if (!prev || prev.decision !== data.decision) {
        await broadcast({ type: "tc.notifySignal", payload: { ...store[key], symbol, timeframe: opts.timeframe } });
      }
    } catch (e) {
      await broadcast({ type: "tc.error", payload: { symbol, error: String(e?.message || e) } });
    }
  }
}

// ------------------------------------------------------------
// alarm lifecycle
// ------------------------------------------------------------
async function ensureAlarm() {
  const opts = await getOpts();
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (opts.auto && !existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: TICK_MS_MIN, delayInMinutes: 0 });
  } else if (!opts.auto && existing) {
    chrome.alarms.clear(ALARM_NAME);
  } else if (opts.auto && existing) {
    chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: TICK_MS_MIN, delayInMinutes: 0 });
  }
  // alarm do shadow: sempre roda para auto-fechar trades >24h
  const shadowExisting = await chrome.alarms.get(SHADOW_ALARM);
  if (!shadowExisting) {
    chrome.alarms.create(SHADOW_ALARM, { periodInMinutes: SHADOW_TICK_MIN, delayInMinutes: 0 });
  }
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.tabs.onRemoved.addListener((tabId) => {
  ProgressiveExperimentRunner.disconnect(tabId);
  chrome.storage.local.get(["tcIqDiagnostics"], (s) => {
    const tabs = { ...(s.tcIqDiagnostics || {}) };
    delete tabs[String(tabId)];
    chrome.storage.local.set({ tcIqDiagnostics: tabs });
  });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_NAME) runTick(true);
  if (a.name === SHADOW_ALARM) closeShadowIfStale();
});

// ------------------------------------------------------------
// messages from content
// ------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "tc.analyze") {
      const opts = await getOpts();
      const { symbol, timeframe } = msg.payload || {};
      try {
        const tabId = sender.tab?.id ?? null;
        const iqSender = !!sender.tab?.url && /^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url);
        const diagnostics = tabId != null ? await readIqDiagnostics() : null;
        const tabState = tabId != null ? diagnostics.tabs[String(tabId)] : null;
        const requestedSymbol = String(symbol || "").toUpperCase();
        if (iqSender && (!tabState || tabState.assetSync !== "ASSET_SYNCED" || tabState.symbol !== requestedSymbol)) {
          const reason = tabState?.assetSync || "ASSET_UNKNOWN";
          const data = { decision: "WAIT", symbol: requestedSymbol, timeframe: TRACE_1M_TIMEFRAME, confidence: 0, probability: null, rationale: reason, shadowEligible: false, backend: "LOCAL", remoteApi: await remoteState() };
          await patchIqDiagnostics(tabId, { lastShadowDecision: "WAIT", lastError: reason });
          sendResponse({ ok: true, data });
          return;
        }
        const data = await callAnalyze(symbol, tabId, sender.tab, msg.payload?.chartRect || null);
        if (sender.tab?.id && data) await patchIqDiagnostics(sender.tab.id, { lastShadowDecision: data.decision || "WAIT", lastError: data.diagnostic?.message || null });
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: true, data: { decision: "WAIT", symbol, timeframe: TRACE_1M_TIMEFRAME, confidence: 0, rationale: "TRACE_EXTENSION_ERROR", diagnostic: traceError("SERVICE_WORKER", "analyze", e) } });
      }
      return;
    }
    if (msg.type === "tc.iq.instrument") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const registered = await registerInstrument(msg.payload);
      await patchIqDiagnostics(sender.tab.id, { activeId: registered?.activeId ?? null, registrySymbol: registered?.symbol ?? null, domain: registered?.domain ?? null, instrumentRegistry: registered ? "OBSERVED" : "UNAVAILABLE" });
      sendResponse({ ok: !!registered });
      return;
    }
    if (msg.type === "tc.iq.assetDebug") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const debug = await persistAssetDebug(sender.tab.id, msg.payload);
      await patchIqDiagnostics(sender.tab.id, { assetDebugStatus: debug.status, visibleSymbol: debug.visibleText || null, registrySymbol: debug.registrySymbol || null, activeId: debug.activeId ?? null });
      console.info(`${TRACE_PREFIX}[ASSET_DEBUG]`, { tabId: sender.tab.id, status: debug.status, visibleText: debug.visibleText, activeId: debug.activeId, registrySymbol: debug.registrySymbol, eventName: debug.websocket?.eventName || null });
      await chrome.tabs.sendMessage(sender.tab.id, { type: "tc.iq.assetDebugState", payload: debug }).catch(() => null);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.iq.sync") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      // A sync window clears only the tab's transient binding diagnostics. It
      // deliberately preserves market history and previously proven registry entries.
      await patchIqDiagnostics(sender.tab.id, { syncState: "SYNCING", assetSync: "SYNCING", lastError: null, syncStartedAt: Number(msg.payload?.startedAt) || Date.now(), syncWindowMs: Math.min(10_000, Math.max(5_000, Number(msg.payload?.windowMs) || 8_000)), activeId: null, symbol: null, feedSymbol: null });
      traceLog("SYNC", "IQ current-instrument sync requested", { tabId: sender.tab.id });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.iq.syncResult") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const result = msg.payload || {};
      const synced = result.state === "SYNCED" && Number.isSafeInteger(Number(result.activeId)) && Number(result.activeId) > 0 && typeof result.symbol === "string" && Number.isFinite(Number(result.lastPrice)) && Number(result.lastPrice) > 0;
      const streamPending = result.state === "STREAM_FOUND_MAPPING_PENDING" && Number.isSafeInteger(Number(result.activeId)) && Number(result.activeId) > 0 && Number.isFinite(Number(result.lastPrice)) && Number(result.lastPrice) > 0;
      const warmup = synced ? await startFableWarmup(sender.tab.id, Number(result.activeId), String(result.symbol).toUpperCase()) : null;
      await patchIqDiagnostics(sender.tab.id, synced ? { syncState: "SYNCED", assetSync: "ASSET_SYNCED", activeId: Number(result.activeId), symbol: result.symbol, feedSymbol: result.symbol, domain: result.domain || null, lastPrice: Number(result.lastPrice), syncSource: result.source || "iq-sync-window-registry", fableTraderStatus: "WARMING_UP", fableWarmupStartedAt: warmup?.startedAt || Date.now(), fableWarmupEndsAt: Number(warmup?.startedAt || Date.now()) + FABLE_WARMUP_MS, lastError: null } : streamPending ? { syncState: "STREAM_FOUND_MAPPING_PENDING", assetSync: "WAITING_FOR_ACTIVE_ID_MAPPING", activeId: Number(result.activeId), lastPrice: Number(result.lastPrice), lastError: null } : { syncState: String(result.state || "SYNC_FAILED").slice(0, 48), assetSync: "WAITING_FOR_ACTIVE_ID_MAPPING", lastError: String(result.state || "SYNC_FAILED").slice(0, 48) });
      traceLog("SYNC", synced ? "IQ binding verified" : "IQ binding not resolved", { tabId: sender.tab.id, state: result.state, activeId: result.activeId ?? null, symbol: result.symbol ?? null });
      sendResponse({ ok: true, synced });
      return;
    }
    if (msg.type === "tc.iq.syncSummary") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const summary = globalThis.TraceConDiagnostic?.sanitize(msg.payload || {}) || {};
      await patchIqDiagnostics(sender.tab.id, { syncSummary: summary, syncFailureReason: summary.syncFailureReason || null });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.iq.userConfirmedMapping") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const registered = await registerInstrument({ ...(msg.payload || {}), source: "USER_CONFIRMED_MAPPING", instrumentType: "user-confirmed" });
      if (registered) { registered.source = "USER_CONFIRMED_MAPPING"; registered.verifiedAt = Number(msg.payload?.verifiedAt) || Date.now(); registered.sessionId = typeof msg.payload?.sessionId === "string" ? msg.payload.sessionId.slice(0, 64) : null; const registry = await readInstrumentRegistry(); registry[String(registered.activeId)] = registered; await new Promise((resolve) => chrome.storage.local.set({ [IQ_INSTRUMENT_REGISTRY_KEY]: registry }, resolve)); }
      await patchIqDiagnostics(sender.tab.id, { activeId: registered?.activeId ?? null, registrySymbol: registered?.symbol ?? null, domain: registered?.domain ?? null, instrumentRegistry: registered ? "USER_CONFIRMED_MAPPING" : "UNAVAILABLE" });
      sendResponse({ ok: !!registered, data: registered });
      return;
    }
    if (msg.type === "tc.dev.diagnose") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const snapshot = globalThis.TraceConDiagnostic?.sanitize(msg.payload || {}) || {};
      const fingerprint = globalThis.TraceConDiagnostic?.fingerprint(snapshot) || `tcdiag-${Date.now()}`;
      const stored = await new Promise((resolve) => chrome.storage.local.get([DEV_DIAGNOSTIC_CACHE_KEY], (s) => resolve(s[DEV_DIAGNOSTIC_CACHE_KEY] || {})));
      if (stored[fingerprint] && Date.now() - Number(stored[fingerprint].receivedAt || 0) < DEV_DIAGNOSTIC_CACHE_TTL_MS) { await patchIqDiagnostics(sender.tab.id, { aiDiagnosis: stored[fingerprint], fableStatus: "ONLINE" }); sendResponse({ ok: true, cached: true, data: stored[fingerprint] }); return; }
      try {
        const response = await fetch("http://127.0.0.1:8789/diagnose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snapshot) });
        const data = await response.json(); if (!response.ok) throw new Error(data?.error || `DIAGNOSTIC_HTTP_${response.status}`);
        const next = { ...stored, [fingerprint]: { ...data, fingerprint, receivedAt: Date.now() } }; await new Promise((resolve) => chrome.storage.local.set({ [DEV_DIAGNOSTIC_CACHE_KEY]: next }, resolve));
        await patchIqDiagnostics(sender.tab.id, { aiDiagnosis: next[fingerprint], fableStatus: "ONLINE" });
        sendResponse({ ok: true, cached: false, data: next[fingerprint] });
      } catch (error) { const message = String(error?.message || error); await patchIqDiagnostics(sender.tab.id, { fableStatus: /abort|timeout/i.test(message) ? "TIMEOUT" : "OFFLINE", aiDiagnosis: { status: "UNAVAILABLE", receivedAt: Date.now() } }); sendResponse({ ok: false, error: message }); }
      return true;
    }
    if (msg.type === "tc.iq.protocol") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) { sendResponse({ ok: false, error: "untrusted_iq_sender" }); return; }
      const signal = msg.payload || {};
      const direction = signal.direction === "OUT" ? "WS_OUT" : "WS_IN";
      traceLog(direction, "redacted market protocol", { tabId: sender.tab.id, transport: signal.transport, eventName: String(signal.eventName || "unknown").slice(0, 80), activeIds: Array.isArray(signal.activeIds) ? signal.activeIds.filter((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0).slice(0, 24) : [], symbols: Array.isArray(signal.symbols) ? signal.symbols.filter((value) => typeof value === "string").map((value) => value.slice(0, 48)).slice(0, 24) : [] });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.iq.market") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) {
        sendResponse({ ok: false, error: "untrusted_iq_sender" });
        return;
      }
      try {
        const opts = await getOpts();
        const registry = await readInstrumentRegistry();
        const registered = msg.payload?.activeId != null ? registry[String(msg.payload.activeId)] : null;
        if (!msg.payload?.visibleConfirmed || !registered?.symbol) {
          await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, symbol: msg.payload?.symbol || null, visibleSymbol: msg.payload?.visibleSymbol || null, activeId: msg.payload?.activeId ?? null, registrySymbol: registered?.symbol || null, assetSync: !msg.payload?.visibleConfirmed ? "WAITING_FOR_VISIBLE_ASSET" : "WAITING_FOR_ACTIVE_ID_MAPPING", lastError: !msg.payload?.visibleConfirmed ? "WAITING_FOR_VISIBLE_ASSET" : "WAITING_FOR_ACTIVE_ID_MAPPING" });
          sendResponse({ ok: true, localOnly: true, assetPending: true });
          return;
        }
        if (registered?.symbol && registered.symbol !== String(msg.payload.symbol || "").toUpperCase()) {
          await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, visibleSymbol: msg.payload.visibleSymbol || null, activeId: msg.payload.activeId, feedSymbol: registered.symbol, symbol: msg.payload.symbol || null, assetSync: "ASSET_MISMATCH", lastError: "ASSET_MISMATCH" });
          sendResponse({ ok: true, localOnly: true, assetMismatch: true });
          return;
        }
        const experimentItem = await persistIqFrame(msg.payload, sender.tab.id);
        const feedPrice = Number(experimentItem?.lastPrice);
        const uiPrice = Number(msg.payload?.uiPrice);
        const priceDelta = Number.isFinite(feedPrice) && Number.isFinite(uiPrice) ? Math.abs(feedPrice - uiPrice) : null;
        const priceTolerance = Number.isFinite(feedPrice) ? Math.max(Math.abs(feedPrice) * 0.002, 0.00001) : null;
        if (priceDelta != null && priceTolerance != null && priceDelta > priceTolerance) {
          await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, symbol: msg.payload?.symbol || null, activeId: msg.payload?.activeId ?? null, assetSync: "PRICE_MISMATCH", uiPrice, feedPrice, priceDelta, priceTolerance, lastError: "PRICE_MISMATCH" });
          sendResponse({ ok: true, localOnly: true, priceMismatch: true });
          return;
        }
        if (experimentItem) await ProgressiveExperimentRunner.ingest(experimentItem, sender.tab.id);
        await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, symbol: msg.payload?.symbol || null, visibleSymbol: msg.payload?.visibleSymbol || msg.payload?.symbol || null, feedSymbol: registered?.symbol || msg.payload?.symbol || null, activeId: msg.payload?.activeId ?? null, domain: msg.payload?.domain || null, assetResolutionConfidence: msg.payload?.assetResolutionConfidence ?? 0, assetSync: "ASSET_SYNCED", uiPrice: Number.isFinite(uiPrice) ? uiPrice : null, feedPrice: Number.isFinite(feedPrice) ? feedPrice : null, priceDelta, priceTolerance, timeframe: msg.payload?.timeframe || null, lastFrameAt: Date.now(), lastIngestAt: Date.now(), lastIngestOk: true, lastIngestError: null, networkStatus: "LOCAL_SHADOW_ACTIVE" });
        console.info(`${TRACE_PREFIX}[MARKET]`, { symbol: msg.payload?.symbol, price: experimentItem?.lastPrice ?? null, timeframe: msg.payload?.timeframe, timestamp: msg.payload?.timestamp, candleCount: experimentItem?.candles?.length || 0, tickCount: experimentItem?.ticks?.length || 0 });
        // Remote ingestion is observational and must never delay local shadow.
        if (opts.remoteApiEnabled) forwardIqMarket(msg.payload, sender.tab.id, opts.backend, opts).then((upstream) => patchIqDiagnostics(sender.tab.id, { remoteSync: upstream.ok ? "SYNCED" : "OFFLINE" })).catch(() => null);
        await chrome.tabs.sendMessage(sender.tab.id, { type: "tc.iq.marketAccepted", payload: { symbol: msg.payload?.symbol || null, timeframe: msg.payload?.timeframe || null } }).catch(() => null);
        sendResponse({ ok: true });
      } catch (e) {
        const diagnostic = traceError("IQ_ADAPTER", "persist-frame", e, { errorClass: "DATA_ADAPTER_ERROR" });
        await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, lastFrameAt: Date.now(), lastIngestAt: Date.now(), lastIngestOk: true, lastIngestError: diagnostic.message, networkStatus: "LOCAL_ONLY" });
        sendResponse({ ok: true, localOnly: true, diagnostic });
      }
      return;
    }
    if (msg.type === "tc.iq.status") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) {
        sendResponse({ ok: false, error: "untrusted_iq_sender" });
        return;
      }
      const status = msg.payload?.assetMismatch ? "ASSET_MISMATCH" : !msg.payload?.visibleConfirmed ? "WAITING_FOR_VISIBLE_ASSET" : !msg.payload?.mappingConfirmed ? "WAITING_FOR_ACTIVE_ID_MAPPING" : msg.payload?.symbol ? "PENDING_FEED" : "ASSET_UNKNOWN";
      await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: !!msg.payload?.bridgeActive, symbol: msg.payload?.symbol || null, visibleSymbol: msg.payload?.visibleSymbol || null, registrySymbol: msg.payload?.registrySymbol || null, visibleSource: msg.payload?.visibleSource || null, activeId: msg.payload?.activeId ?? null, assetSync: status, assetResolutionConfidence: msg.payload?.assetResolutionConfidence ?? 0, timeframe: msg.payload?.timeframe || null });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.diagnostics" || msg.type === "tc.testConnection") {
      sendResponse({ ok: true, data: await extensionDiagnostics() });
      return;
    }
    if (msg.type === "tc.toggleDownbar") {
      const current = await readIqDiagnostics();
      const enabled = !current.downbarEnabled;
      await new Promise((resolve) => chrome.storage.local.set({ tcDownbarEnabled: enabled }, resolve));
      await broadcast({ type: "tc.downbarPreference", payload: { enabled } });
      sendResponse({ ok: true, data: { enabled } });
      return;
    }
    if (msg.type === "tc.openIq") {
      await chrome.tabs.create({ url: "https://iqoption.com/" });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.setAuto") {
      await setOpt("tcAuto", !!msg.payload?.auto);
      await ensureAlarm();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.setOpts") {
      for (const k of ["backend", "apiToken", "auto", "symbols", "direction", "remoteApiEnabled"]) {
        if (k in (msg.payload || {})) {
          await setOpt("tc" + k[0].toUpperCase() + k.slice(1), msg.payload[k]);
        }
      }
      await ensureAlarm();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.getStore") {
      sendResponse({ ok: true, data: await readStore() });
      return;
    }
    if (msg.type === "tc.shadowOpen") {
      const trade = msg.payload;
      const opts = await getOpts();
      if (opts.remoteApiEnabled) postShadowToBackend(trade, opts).catch(() => null);
      sendResponse({ ok: true, localOnly: true, remoteApi: opts.remoteApiEnabled ? "QUEUED" : "REMOTE_API_DISABLED" });
      return;
    }
    if (msg.type === "tc.experiment.start") {
      const diagnostics = await extensionDiagnostics();
      if (diagnostics.states.iqAdapter !== "LIVE" || diagnostics.states.marketData !== "LIVE") {
        sendResponse({ ok: false, error: "IQ_MARKET_NOT_READY", data: diagnostics });
        return;
      }
      sendResponse({ ok: true, data: await ProgressiveExperimentRunner.start() });
      return;
    }
    if (msg.type === "tc.experiment.pause") { sendResponse({ ok: true, data: await ProgressiveExperimentRunner.pause() }); return; }
    if (msg.type === "tc.experiment.resume") { sendResponse({ ok: true, data: await ProgressiveExperimentRunner.resume() }); return; }
    if (msg.type === "tc.experiment.stop") { sendResponse({ ok: true, data: await ProgressiveExperimentRunner.stop() }); return; }
    if (msg.type === "tc.experiment.reset") { sendResponse({ ok: true, data: await ProgressiveExperimentRunner.reset() }); return; }
    if (msg.type === "tc.experiment.status") { sendResponse({ ok: true, data: await ProgressiveExperimentRunner.read() }); return; }
    if (msg.type === "tc.shadowClose") { sendResponse({ ok: true, localOnly: true }); return; }
    sendResponse({ ok: false, error: "tipo desconhecido" });
  })();
  return true; // async
});
