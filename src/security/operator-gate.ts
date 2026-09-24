/**
 * OPERATOR GATE — decisao de autenticacao do edge (api/http.ts), pura e testavel.
 *
 * Modelo fail-closed:
 * - Rotas privadas (mutations /api/* e GETs de prefixos privados) exigem sessao de operador
 *   (cookie assinado) OU chave de pesquisa nos caminhos research/shadow.
 * - Nenhuma rota privada e liberada por same-origin/Sec-Fetch-Site: isso e apenas CSRF.
 * - /api/auth/panel NUNCA emite sessao sem prova de chave; sem chave configurada -> 503.
 */

export const PRIVATE_GET_PREFIXES: readonly string[] = Object.freeze([
  "/api/iq/",
  "/api/ai/",
  "/api/operational/",
  "/api/strategies/",
  "/api/debug/",
]);

export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  "/health",
  "/api/auth/operator",
  "/api/auth/panel",
  "/api/auth/logout",
  "/api/auth/session",
]);

/** GETs read-only do painel (grid.html): liberados SEM sessao de operador.
 *  O edge injeta o segredo do relay server-side; nenhum segredo vai ao browser.
 *  Mutations e demais GETs de /api/iq/* continuam privados. */
export const PANEL_PUBLIC_GET_PATHS: ReadonlySet<string> = new Set([
  "/api/iq/status",
  "/api/iq/intelligence/assets",
  "/api/iq/strategy/stats",
  "/api/iq/performance",
  "/api/iq/candles",
  "/api/iq/executions",
  "/api/iq/v3/status",
  "/api/iq/v3/opportunities",
  "/api/iq/mesas",
  "/api/iq/account/context",
  "/api/iq/mcp/config",
]);

/** Mutations POST dos CONTROLES do grid, liberadas SEM cookie de operador (o edge injeta
 *  o segredo do relay server-side; nenhum segredo vai ao browser). Requerem origem/host validos
 *  (same-origin); JSON/tamanho/schema sao validados no fluxo edge+relay. Ainda NÃO autenticam
 *  pessoa (CSRF reduzido; nao e identidade). As demais rotas administrativas seguem privadas. */
export const PANEL_ACTION_POSTS: ReadonlySet<string> = new Set([
  "/api/iq/config/global-stake",
  "/api/iq/kill-switch",
  "/api/iq/config/auto-execute",
  "/api/iq/arm",
  "/api/iq/disarm",
  "/api/iq/account/select",
  "/api/iq/mode",
  "/api/iq/real/arm",
  "/api/iq/real/disarm",
]);

export function isPanelActionPost(method: string, pathname: string): boolean {
  return method === "POST" && PANEL_ACTION_POSTS.has(pathname);
}

const MUTATION_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isPrivateGetPath(pathname: string): boolean {
  if (PANEL_PUBLIC_GET_PATHS.has(pathname)) return false;
  return PRIVATE_GET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function operatorGateRequired(method: string, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/api/live/")) return false; // auth propria por Bearer key (handleLiveApi)
  if (MUTATION_METHODS.has(method)) return true;
  return method === "GET" && isPrivateGetPath(pathname);
}

export type OperatorGateResult = { mode: "public" | "operator" | "research" | "deny"; status?: number; error?: string };

export function operatorGateDecision({ method, pathname, operatorCookieValid, researchKeyValid = false }: { method: string; pathname: string; operatorCookieValid: boolean; researchKeyValid?: boolean }): OperatorGateResult {
  if (!operatorGateRequired(method, pathname)) return { mode: "public" };
  if (operatorCookieValid) return { mode: "operator" };
  const researchPath = pathname.startsWith("/api/research/") || pathname.startsWith("/api/shadow/");
  if (researchPath && researchKeyValid) return { mode: "research" };
  return { mode: "deny", status: 401, error: "operator_auth_required" };
}

export function panelSessionDecision({ keyConfigured, keyValid, sameOrigin }: { keyConfigured: boolean; keyValid: boolean; sameOrigin: boolean }): { allow: boolean; status: number; error: string | null } {
  if (!sameOrigin) return { allow: false, status: 403, error: "cross_origin_blocked" };
  if (!keyConfigured) return { allow: false, status: 503, error: "operator_auth_not_configured" };
  if (!keyValid) return { allow: false, status: 401, error: "operator_key_required" };
  return { allow: true, status: 200, error: null };
}
