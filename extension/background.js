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
const TICK_MS = 30; // production: 30 seconds
const TICK_MS_MIN = 2; // dev

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
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_NAME) runTick(true);
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
    sendResponse({ ok: false, error: "tipo desconhecido" });
  })();
  return true; // async
});