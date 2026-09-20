/**
 * TRACE/COM - OPERADOR (mutacoes autenticadas sem digitar chave)
 *
 * As mutacoes /api/iq/* exigem sessao de operador (cookie HttpOnly assinado).
 * O painel abre a sessao sozinho via POST /api/auth/panel (mesma origem), sem
 * prompt e sem guardar nada no navegador. A chave por prompt so existe se o
 * servidor exigir (TRACECOM_OPERATOR_REQUIRE_KEY=true) — nesse modo o painel
 * informa o erro, mas continua sem embutir segredo nenhum no frontend.
 *
 * GET nunca e afetado.
 */
(() => {
  "use strict";
  const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  let sessionActive = false;
  let bootstrapInFlight = null;
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch) return;

  function sameOriginApiMutation(input, options) {
    try {
      const rawUrl = typeof input === "string" ? input : input?.url ?? String(input);
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (!url.pathname.startsWith("/api/")) return false;
      const method = String(options?.method ?? input?.method ?? "GET").toUpperCase();
      return MUTATION_METHODS.has(method);
    } catch {
      return false;
    }
  }

  async function ensurePanelSession() {
    if (sessionActive) return true;
    if (bootstrapInFlight) return bootstrapInFlight;
    bootstrapInFlight = (async () => {
      try {
        const response = await originalFetch("/api/auth/panel", { method: "POST", credentials: "same-origin" });
        sessionActive = response.ok;
        if (!response.ok && response.status !== 401) {
          console.warn("[operator-auth] sessao de painel indisponivel", response.status);
        }
        return sessionActive;
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
    if (response.status !== 401) return response;
    sessionActive = false;
    const unlocked = await ensurePanelSession();
    if (!unlocked) return response;
    return originalFetch(input, options);
  }

  window.fetch = (input, options) => (sameOriginApiMutation(input, options) ? operatorFetch(input, options) : originalFetch(input, options));
  window.__tcOperator = {
    version: "operator-auth.2.0.0",
    ensure: ensurePanelSession,
    isSessionActive: () => sessionActive,
    logout: async () => {
      sessionActive = false;
      try { await originalFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* noop */ }
    },
  };
})();
