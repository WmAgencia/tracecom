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

const MUTATION_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isPrivateGetPath(pathname: string): boolean {
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
