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

const ALARM_NAME = "tcTick";
const SHADOW_ALARM = "tcShadowTick";
const TICK_MS = 30; // production: 30 seconds
const TICK_MS_MIN = 2; // dev
const SHADOW_TICK_MIN = 5; // verifica shadow a cada 5 min
const SHADOW_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h fecha trade aberto

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
  // Fallback: usa GET /api/analytics/record (rota existente no backend).
  const params = new URLSearchParams({
    symbol: trade.symbol || "",
    timeframe: trade.timeframe || "1h",
    direction: trade.direction || "up",
    decision: trade.decision || "WAIT",
    horizon: "12",
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
      headers: { "accept": "application/json", "content-type": "application/json" },
      body: JSON.stringify(trade),
    });
    if (r.ok) return { ok: true, route: "shadow", data: await r.json().catch(() => null) };
  } catch (e) { /* cai no fallback */ }
  // fallback: GET /api/analytics/record
  try {
    const r = await fetch(`${backend}/api/analytics/record?${params.toString()}`, {
      method: "GET",
      headers: { "accept": "application/json" },
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
      ["tcBackend", "tcAuto", "tcSymbols", "tcTimeframe", "tcDirection", "tcHorizon"],
      (s) => {
        resolve({
          backend: s.tcBackend || "http://127.0.0.1:8788",
          auto: !!s.tcAuto,
          symbols: Array.isArray(s.tcSymbols) && s.tcSymbols.length ? s.tcSymbols : ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
          timeframe: s.tcTimeframe || "1h",
          direction: s.tcDirection || "up",
          horizon: s.tcHorizon || 12,
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
async function callAnalyze(symbol, timeframe, direction, horizon, backend) {
  const url = `${backend.replace(/\/$/, "")}/api/analyze?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&direction=${encodeURIComponent(direction)}&horizon=${encodeURIComponent(horizon)}`;
  const r = await fetch(url, { method: "GET", headers: { "accept": "application/json" } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`);
  }
  return r.json();
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
      const data = await callAnalyze(symbol, opts.timeframe, opts.direction, opts.horizon, opts.backend);
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
        await broadcast({ type: "tc.notifySignal", payload: { ...store[key], symbol } });
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
        const data = await callAnalyze(symbol, timeframe || opts.timeframe, opts.direction, opts.horizon, opts.backend);
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return;
    }
    if (msg.type === "tc.setAuto") {
      await setOpt("tcAuto", !!msg.payload?.auto);
      await ensureAlarm();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "tc.setOpts") {
      for (const k of ["backend", "auto", "symbols", "timeframe", "direction", "horizon"]) {
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
    if (msg.type === "tc.shadowClose") {
      const trade = msg.payload;
      const opts = await getOpts();
      const result = await postShadowToBackend(trade, opts);
      sendResponse(result);
      return;
    }
    sendResponse({ ok: false, error: "tipo desconhecido" });
  })();
  return true; // async
});