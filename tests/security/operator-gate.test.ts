import { describe, expect, it } from "vitest";
import { operatorGateDecision, operatorGateRequired, panelSessionDecision, isPrivateGetPath, isPanelActionPost } from "../../src/security/operator-gate.js";

describe("operator gate (fail-closed)", () => {
  const privateGets = [
    "/api/iq/strategy/observability",
    "/api/iq/intelligence",
    "/api/iq/agents/log",
    "/api/iq/real/preflight",
    "/api/iq/lab/status",
    "/api/iq/config/global-stake",
    "/api/iq/signals?limit=10",
    "/api/ai/provider",
    "/api/operational/snapshot",
    "/api/strategies/selection",
    "/api/debug/agents",
  ];

  it("nenhuma configuracao de mesma origem transforma GET privado anonimo em allow", () => {
    for (const pathname of privateGets) {
      const decision = operatorGateDecision({ method: "GET", pathname, operatorCookieValid: false });
      expect(decision.mode, pathname).toBe("deny");
      expect(decision.status, pathname).toBe(401);
    }
  });

  it("GETs publicos e /api/live (auth propria) ficam fora do gate", () => {
    expect(operatorGateRequired("GET", "/health")).toBe(false);
    expect(operatorGateRequired("GET", "/api/auth/session")).toBe(false);
    expect(operatorGateRequired("GET", "/api/live/session")).toBe(false);
    expect(operatorGateDecision({ method: "GET", pathname: "/health", operatorCookieValid: false }).mode).toBe("public");
  });

  it("mutations privadas exigem operador mesmo em paths nao-GET", () => {
    for (const pathname of ["/api/iq/arm", "/api/iq/disarm", "/api/iq/account/select", "/api/iq/config/global-stake", "/api/iq/mode", "/api/iq/real/arm"]) {
      expect(operatorGateDecision({ method: "POST", pathname, operatorCookieValid: false }).mode).toBe("deny");
    }
    expect(operatorGateDecision({ method: "POST", pathname: "/api/iq/arm", operatorCookieValid: true }).mode).toBe("operator");
  });

  it("GETs do painel sao publicos (sem sessao); mutations nos mesmos paths continuam privadas", () => {
    for (const pathname of ["/api/iq/status", "/api/iq/intelligence/assets", "/api/iq/strategy/stats", "/api/iq/performance", "/api/iq/candles", "/api/iq/executions", "/api/iq/v3/status", "/api/iq/v3/opportunities", "/api/iq/mesas", "/api/iq/account/context"]) {
      const decision = operatorGateDecision({ method: "GET", pathname, operatorCookieValid: false });
      expect(decision.mode, pathname).toBe("public");
    }
    expect(operatorGateDecision({ method: "PUT", pathname: "/api/iq/mesas", operatorCookieValid: false }).mode).toBe("deny");
    expect(operatorGateDecision({ method: "PUT", pathname: "/api/iq/mcp/config", operatorCookieValid: false }).mode).toBe("deny");
  });

  it("cookie de operador autoriza GET privado; chave de pesquisa so vale em research/shadow", () => {
    expect(operatorGateDecision({ method: "GET", pathname: "/api/iq/strategy/observability", operatorCookieValid: true }).mode).toBe("operator");
    expect(operatorGateDecision({ method: "GET", pathname: "/api/research/lab/overview", operatorCookieValid: false }).mode).toBe("public");
    expect(operatorGateDecision({ method: "POST", pathname: "/api/research/shadow/run", operatorCookieValid: false, researchKeyValid: true }).mode).toBe("research");
    expect(operatorGateDecision({ method: "POST", pathname: "/api/iq/arm", operatorCookieValid: false, researchKeyValid: true }).mode).toBe("deny");
  });

  it("isPanelActionPost libera somente os controles do grid e o login; resto permanece privado", () => {
    for (const pathname of ["/api/iq/config/global-stake", "/api/iq/kill-switch", "/api/iq/config/auto-execute", "/api/iq/arm", "/api/iq/disarm", "/api/iq/account/select", "/api/iq/mode", "/api/iq/real/arm", "/api/iq/real/disarm", "/api/iq/connect"]) {
      expect(isPanelActionPost("POST", pathname), pathname).toBe(true);
    }
    expect(isPanelActionPost("GET", "/api/iq/arm")).toBe(false);
    expect(isPanelActionPost("PUT", "/api/iq/arm")).toBe(false);
    expect(isPanelActionPost("POST", "/api/iq/test-order")).toBe(false);
    expect(isPanelActionPost("POST", "/api/iq/disconnect")).toBe(false);
    expect(isPanelActionPost("PUT", "/api/iq/mcp/config")).toBe(false);
    expect(isPanelActionPost("POST", "/api/iq/mesas/bulk")).toBe(false);
  });

  it("isPrivateGetPath cobre os prefixos privados e nao cobre publicos do painel", () => {
    expect(isPrivateGetPath("/api/iq/strategy/observability")).toBe(true);
    expect(isPrivateGetPath("/api/iq/status")).toBe(false);
    expect(isPrivateGetPath("/api/iq/intelligence/assets")).toBe(false);
    expect(isPrivateGetPath("/api/ai/provider")).toBe(true);
    expect(isPrivateGetPath("/api/live/session")).toBe(false);
    expect(isPrivateGetPath("/health")).toBe(false);
  });
});

describe("panel session (prova de chave obrigatoria)", () => {
  it("sem chave configurada -> 503 (fail-closed, nunca abre sessao)", () => {
    const decision = panelSessionDecision({ keyConfigured: false, keyValid: false, sameOrigin: true });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(503);
    expect(decision.error).toBe("operator_auth_not_configured");
  });

  it("same-origin sem chave valida -> 401 (mesma origem nao e identidade)", () => {
    const decision = panelSessionDecision({ keyConfigured: true, keyValid: false, sameOrigin: true });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
    expect(decision.error).toBe("operator_key_required");
  });

  it("chave valida mas origem cruzada -> 403", () => {
    const decision = panelSessionDecision({ keyConfigured: true, keyValid: true, sameOrigin: false });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
    expect(decision.error).toBe("cross_origin_blocked");
  });

  it("chave valida + mesma origem -> sessao permitida", () => {
    const decision = panelSessionDecision({ keyConfigured: true, keyValid: true, sameOrigin: true });
    expect(decision.allow).toBe(true);
    expect(decision.error).toBeNull();
  });
});
