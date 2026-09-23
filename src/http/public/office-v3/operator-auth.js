/**
 * TRACE/COM - OPERADOR (sessao autenticada por CHAVE, sem embutir segredo no frontend)
 *
 * Modelo fail-closed:
 * - Rotas privadas (mutations /api/* e GETs de /api/iq, /api/ai, /api/operational,
 *   /api/strategies, /api/debug) exigem sessao de operador (cookie HttpOnly assinado).
 * - A chave e pedida ao operador (prompt) e trocada por sessao em POST /api/auth/operator.
 *   A chave fica apenas em memoria durante a troca; nada e persistido no navegador.
 * - /api/auth/panel NAO abre sessao sem prova de chave no servidor.
 */
(() => {
  "use strict";
  const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const PRIVATE_GET_PREFIXES = ["/api/iq/", "/api/ai/", "/api/operational/", "/api/strategies/", "/api/debug/"];
  const PUBLIC_PATHS = new Set(["/health", "/api/auth/operator", "/api/auth/panel", "/api/auth/logout", "/api/auth/session"]);
  let sessionActive = false;
  let bootstrapInFlight = null;
  let promptDeclined = false;
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch) return;

  function needsOperatorAuth(input, options) {
    try {
      const rawUrl = typeof input === "string" ? input : input?.url ?? String(input);
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (!url.pathname.startsWith("/api/")) return false;
      if (PUBLIC_PATHS.has(url.pathname)) return false;
      if (url.pathname.startsWith("/api/live/")) return false;
      const method = String(options?.method ?? input?.method ?? "GET").toUpperCase();
      if (MUTATION_METHODS.has(method)) return true;
      return method === "GET" && PRIVATE_GET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    } catch {
      return false;
    }
  }

  async function loginWithKey(accessKey) {
    const response = await originalFetch("/api/auth/operator", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKey }),
    });
    sessionActive = response.ok;
    return sessionActive;
  }

  async function ensureOperatorSession() {
    if (sessionActive) return true;
    if (bootstrapInFlight) return bootstrapInFlight;
    bootstrapInFlight = (async () => {
      try {
        const current = await originalFetch("/api/auth/session", { method: "GET", credentials: "same-origin" });
        if (current.ok) { sessionActive = true; return true; }
        if (promptDeclined) return false;
        const key = window.prompt("Chave de operador do TraceCon (nao fica salva no navegador):");
        if (!key) { promptDeclined = true; return false; }
        const ok = await loginWithKey(key.trim());
        if (!ok) console.warn("[operator-auth] chave recusada ou autenticacao nao configurada");
        return ok;
      } catch {
        return false;
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  }

  async function operatorFetch(input, options = {}) {
    const response = await originalFetch(input, options);
    if (response.status !== 401 && response.status !== 403) return response;
    sessionActive = false;
    promptDeclined = false;
    const unlocked = await ensureOperatorSession();
    if (!unlocked) return response;
    return originalFetch(input, options);
  }

  window.fetch = (input, options) => (needsOperatorAuth(input, options) ? operatorFetch(input, options) : originalFetch(input, options));
  window.__tcOperator = {
    version: "operator-auth.3.0.0",
    login: (accessKey) => { promptDeclined = false; return loginWithKey(String(accessKey ?? "").trim()); },
    ensure: ensureOperatorSession,
    isSessionActive: () => sessionActive,
    logout: async () => {
      sessionActive = false;
      try { await originalFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* noop */ }
    },
  };
})();
