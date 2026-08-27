/* TRACECON extension — background service worker (MV3).
 *
 * Responsabilidades:
 *  - manter/configuração (API URL + token) em chrome.storage;
 *  - rotear mensagens do side panel → API local da Tracecon;
 *  - NUNCA armazenar segredos de terceiros; apenas o token opcional da própria
 *    API (armazenado em chrome.storage.local, nunca logado).
 */

const DEFAULTS = {
  apiBase: "http://127.0.0.1:8788",
  token: "",
};

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(["apiBase", "token"]);
  await chrome.storage.local.set({
    apiBase: cur.apiBase ?? DEFAULTS.apiBase,
    token: cur.token ?? "",
  });
  // Abre o side panel na primeira instalação (melhor descoberta).
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn("setPanelBehavior indisponível:", e);
  }
});

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

/** Busca na API local. Retorna {ok, status, data|error}. */
async function callApi(base, token, path) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  try {
    const res = await fetch(base.replace(/\/$/, "") + path, { headers });
    const text = res.status === 200 ? await res.text() : "";
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") { sendResponse({ ok: false, error: "msg inválido" }); return; }
    const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
    const base = apiBase || DEFAULTS.apiBase;
    const t = token || "";

    switch (msg.type) {
      case "TRACECON_HEALTH": {
        const r = await callApi(base, t, "/health");
        sendResponse({ ok: r.ok, status: r.status, data: r.data ?? { error: r.error } });
        return;
      }
      case "TRACECON_STATUS": {
        const r = await callApi(base, t, "/api/status");
        sendResponse({ ok: r.ok, status: r.status, data: r.data ?? { error: r.error } });
        return;
      }
      case "TRACECON_ANALYZE": {
        const q = `symbol=${encodeURIComponent(msg.symbol)}&timeframe=${encodeURIComponent(msg.timeframe)}&direction=${encodeURIComponent(msg.direction)}&horizon=${encodeURIComponent(msg.horizon)}`;
        const r = await callApi(base, t, "/api/analyze?" + q);
        sendResponse({ ok: r.ok, status: r.status, data: r.data ?? { error: r.error } });
        return;
      }
      case "TRACECON_CONTEXT": {
        const q = `symbol=${encodeURIComponent(msg.symbol)}&timeframe=${encodeURIComponent(msg.timeframe)}`;
        const r = await callApi(base, t, "/api/market/context?" + q);
        sendResponse({ ok: r.ok, status: r.status, data: r.data ?? { error: r.error } });
        return;
      }
      case "TRACECON_NEWS": {
        const asset = (msg.symbol || "BTC").replace(/USDT$/, "");
        const q = `asset=${encodeURIComponent(asset)}`;
        const r = await callApi(base, t, "/api/news?" + q);
        sendResponse({ ok: r.ok, status: r.status, data: r.data ?? { error: r.error } });
        return;
      }
      default:
        sendResponse({ ok: false, error: "tipo desconhecido: " + msg.type });
        return;
    }
  })();
  return true; // async sendResponse
});
