/* TRACE/CON — service worker (background).
 *
 * Funções:
 *   - chama o backend TRACECON em http://127.0.0.1:8788/api/analyze
 *   - agenda alarm a cada 30s quando auto-update está on
 *   - armazena último sinal por ativo (signalStore)
 *   - notifica todas as abas com o resultado
 *
 * NÃO executa ordens. NÃO clica em nada. Apenas atualiza o sinal.
 */
importScripts("local-engine.js");

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

function traceLog(scope, message, meta = {}) {
  console.info(`${TRACE_PREFIX}[${scope}] ${message}`, meta);
}

function traceError(scope, operation, error, extra = {}) {
  const message = String(error?.message || error || "unknown error");
  const result = { component: scope, operation, errorClass: "NETWORK_ERROR", message, timestamp: Date.now(), ...extra };
  console.warn(`${TRACE_PREFIX}[${scope}] ${operation} failed`, result);
  return result;
}

async function readLocalMarket() {
  return new Promise((resolve) => chrome.storage.local.get([IQ_MARKET_KEY], (s) => resolve(s[IQ_MARKET_KEY] || {})));
}
async function writeLocalMarket(store) {
  return new Promise((resolve) => chrome.storage.local.set({ [IQ_MARKET_KEY]: store }, resolve));
}
async function persistIqFrame(frame) {
  if (!frame?.symbol || !["candle", "tick"].includes(frame.kind)) return;
  const store = await readLocalMarket();
  const key = String(frame.symbol).toUpperCase();
  const item = store[key] || { symbol: key, candles: [], ticks: [], lastFrameAt: null, source: "iqoption:browser-session" };
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
  store[key] = item;
  await writeLocalMarket(store);
  return item;
}

async function localAnalyze(symbol) {
  const store = await readLocalMarket();
  return globalThis.TraceConLocalEngine.analyze(symbol, store[String(symbol || "").toUpperCase()]);
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
  const backend = (opts.backend || "http://127.0.0.1:8788").replace(/\/$/, "");
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
    const r = await fetch(`${backend}/api/analytics/shadow`, {
      method: "POST",
      headers: apiHeaders(opts, { "content-type": "application/json" }),
      body: JSON.stringify(trade),
    });
    if (r.ok) return { ok: true, route: "shadow", data: await r.json().catch(() => null) };
  } catch (e) { /* cai no fallback */ }
  // fallback: POST /api/analytics/record
  try {
    const r = await fetch(`${backend}/api/analytics/record?${params.toString()}`, {
      method: "POST",
      headers: apiHeaders(opts),
    });
    if (r.ok) return { ok: true, route: "record", data: await r.json().catch(() => null) };
    return { ok: false, error: `HTTP ${r.status}` };
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
  // envia pro backend
  const opts = await getOpts();
  await postShadowToBackend(closed, opts);
  // notifica tabs para atualizarem badge
  await broadcast({ type: "tc.shadowClosed", payload: closed });
}

// ------------------------------------------------------------
// storage helpers
// ------------------------------------------------------------
async function getOpts() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["tcBackend", "tcApiToken", "tcAuto", "tcSymbols", "tcDirection"],
      (s) => {
        resolve({
          backend: s.tcBackend || "http://127.0.0.1:8788",
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
// API client
// ------------------------------------------------------------
async function callAnalyze(symbol, timeframe, direction, horizon, backend, opts) {
  const url = `${backend.replace(/\/$/, "")}/api/analyze?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&direction=${encodeURIComponent(direction)}&horizon=${encodeURIComponent(horizon)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: apiHeaders(opts), signal: ctrl.signal });
  } catch (error) {
    const diagnostic = traceError("NETWORK", "analyze", error, { url, errorClass: error?.name === "AbortError" ? "TIMEOUT" : "TRACE_API_UNREACHABLE" });
    return { ...(await localAnalyze(symbol)), diagnostic, backend: "UNREACHABLE" };
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ...(await localAnalyze(symbol)), diagnostic: { component: "NETWORK", operation: "analyze", errorClass: "INVALID_RESPONSE", message: t.slice(0, 120), httpStatus: r.status, url, timestamp: Date.now() }, backend: "HTTP_ERROR" };
  }
  try { return await r.json(); }
  catch (error) { return { ...(await localAnalyze(symbol)), diagnostic: traceError("NETWORK", "analyze-response", error, { errorClass: "INVALID_RESPONSE", url }), backend: "HTTP_ERROR" }; }
}

async function forwardIqMarket(frame, tabId, backend, opts) {
  // Frame is already whitelisted/normalized by the bridge. Do not forward raw
  // page messages, cookies, credentials, SSID, account or trade information.
  const body = { ...frame, tabId, receivedAt: Number(frame.receivedAt) || Date.now() };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const r = await fetch(`${backend.replace(/\/$/, "")}/api/iq-option/ingest`, {
      method: "POST", headers: apiHeaders(opts, { "content-type": "application/json" }), body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, diagnostic: { component: "NETWORK", operation: "iq-option/ingest", errorClass: "TRACE_API_UNREACHABLE", message: `HTTP ${r.status}`, httpStatus: r.status, timestamp: Date.now() } };
    return { ok: true };
  } catch (error) {
    return { ok: false, diagnostic: traceError("NETWORK", "iq-option/ingest", error, { errorClass: error?.name === "AbortError" ? "TIMEOUT" : "TRACE_API_UNREACHABLE" }) };
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
async function backendHealth(backend) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_000);
    const response = await fetch(`${backend.replace(/\/$/, "")}/health`, { headers: { accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(timer);
    return { online: response.ok };
  } catch { return { online: false }; }
}
async function extensionDiagnostics() {
  const opts = await getOpts();
  const current = await readIqDiagnostics();
  const tabs = Object.values(current.tabs).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { ...(tabs[0] || {}), downbarEnabled: current.downbarEnabled, backend: await backendHealth(opts.backend) };
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
  if (!opts.auto && !triggeredByTimer === false) return; // manual só se triggeredByTimer false
  // Manual (não timer): ignora o auto e roda sempre que o content pedir
  if (!triggeredByTimer && !opts.auto) {
    // ok, manual
  }
  if (triggeredByTimer && !opts.auto) return; // timer só se auto=on

  for (const symbol of opts.symbols) {
    try {
      const data = await callAnalyze(symbol, opts.timeframe, opts.direction, opts.horizon, opts.backend, opts);
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
        const data = await callAnalyze(symbol, timeframe || opts.timeframe, opts.direction, opts.horizon, opts.backend, opts);
        if (sender.tab?.id && data) await patchIqDiagnostics(sender.tab.id, { lastShadowDecision: data.decision || "WAIT", lastError: data.diagnostic?.message || null });
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: true, data: { decision: "WAIT", symbol, timeframe: TRACE_1M_TIMEFRAME, confidence: 0, rationale: "TRACE_EXTENSION_ERROR", diagnostic: traceError("SERVICE_WORKER", "analyze", e) } });
      }
      return;
    }
    if (msg.type === "tc.iq.market") {
      if (!sender.tab?.id || !sender.tab.url || !/^https:\/\/([a-z0-9-]+\.)?iqoption\.com\//i.test(sender.tab.url)) {
        sendResponse({ ok: false, error: "untrusted_iq_sender" });
        return;
      }
      try {
        const opts = await getOpts();
        await persistIqFrame(msg.payload);
        const upstream = await forwardIqMarket(msg.payload, sender.tab.id, opts.backend, opts);
        await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: true, symbol: msg.payload?.symbol || null, timeframe: msg.payload?.timeframe || null, lastFrameAt: Date.now(), lastIngestAt: Date.now(), lastIngestOk: true, lastIngestError: upstream.ok ? null : upstream.diagnostic?.message || "backend unavailable", networkStatus: upstream.ok ? "BACKEND_SYNCED" : "LOCAL_FALLBACK" });
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
      await patchIqDiagnostics(sender.tab.id, { pageDetected: true, bridgeActive: !!msg.payload?.bridgeActive, symbol: msg.payload?.symbol || null, timeframe: msg.payload?.timeframe || null });
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
      for (const k of ["backend", "apiToken", "auto", "symbols", "direction"]) {
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
      const result = await postShadowToBackend(trade, opts);
      sendResponse(result);
      return;
    }
    if (msg.type === "tc.shadowClose") { sendResponse({ ok: true, localOnly: true }); return; }
    sendResponse({ ok: false, error: "tipo desconhecido" });
  })();
  return true; // async
});
