/**
 * TRACE/COM - OPERADOR (autenticacao de mutacoes)
 *
 * As mutacoes /api/iq/* exigem sessao de operador (cookie HttpOnly emitido por
 * POST /api/auth/operator). Este shim:
 *   - intercepta SOMENTE mutacoes same-origin para /api/*;
 *   - em 401/403 pede a chave de acesso UMA vez (window.prompt) e troca por cookie;
 *   - repete a requisicao original apos autenticar;
 *   - nunca grava a chave no codigo, localStorage ou logs.
 *
 * A chave e a configurada no servidor: TRACECOM_OPERATOR_KEY (preferida) ou LIVE_API_ADMIN_KEY.
 * GET nunca e afetado.
 */
(() => {
  "use strict";
  const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  let sessionActive = false;
  let promptInFlight = null;
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

  async function unlockOperatorSession() {
    if (sessionActive) return true;
    if (promptInFlight) return promptInFlight;
    promptInFlight = (async () => {
      try {
        const key = window.prompt("Acesso de operador: informe a chave (ela nao fica salva no navegador).");
        if (!key) return false;
        const response = await originalFetch("/api/auth/operator", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessKey: key }),
          credentials: "same-origin",
        });
        if (response.ok) {
          sessionActive = true;
          return true;
        }
        if (response.status === 429) window.alert("Muitas tentativas. Aguarde um minuto e tente novamente.");
        else window.alert("Chave de operador invalida ou ausente no servidor. Nenhuma alteracao foi aplicada.");
        return false;
      } catch {
        return false;
      } finally {
        promptInFlight = null;
      }
    })();
    return promptInFlight;
  }

  async function operatorFetch(input, options = {}) {
    const response = await originalFetch(input, options);
    if (response.status !== 401) return response;
    const unlocked = await unlockOperatorSession();
    if (!unlocked) return response;
    return originalFetch(input, options);
  }

  window.fetch = (input, options) => (sameOriginApiMutation(input, options) ? operatorFetch(input, options) : originalFetch(input, options));
  window.__tcOperator = {
    version: "operator-auth.1.0.0",
    ensure: unlockOperatorSession,
    isSessionActive: () => sessionActive,
    logout: async () => {
      sessionActive = false;
      try { await originalFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* noop */ }
    },
  };
})();
