/**
 * MARKET STATE CLASSIFIER — política de evidência para diagnóstico de disponibilidade (READ-ONLY).
 *
 * NÃO faz parte do state machine de trading e NÃO é importado pelo runtime.
 * NÃO emite ordens, NÃO toca Brain/Feature Engine/Critic/Consensus/Quality Gate/JIT/
 * Entry Location/MicroVeto/Portfolio/Execution Gate. É usado por scripts de diagnóstico
 * e pelos testes de regressão.
 *
 * Regra arquitetural (lição do incidente 2026-09-17/18):
 *  - ausência/parcialidade/staleness de feed NUNCA vira SUSPENDED/NOT_OFFERED;
 *  - estado definitivo exige evidência corrente de DUAS fontes independentes:
 *    WS fresco (get-initialization-data de conexão nova) E o MCP do MESMO produto;
 *  - MCP dizendo OPEN com WS dizendo SUSPENDED => CONFLICT (nunca override silencioso);
 *  - NORMAL ≠ OTC: o casamento é sempre por canonical + tipo, nunca por horário/sessão.
 */

export const MARKET_STATE_CLASSIFIER_VERSION = "market-state-classifier-v1";

export const MARKET_STATE = Object.freeze({
  BROKER_CONFIRMED_OPEN: "BROKER_CONFIRMED_OPEN",
  BROKER_CONFIRMED_SUSPENDED: "BROKER_CONFIRMED_SUSPENDED",
  CONFLICT: "CONFLICT",
  SESSION_DATA_STALE: "SESSION_DATA_STALE",
  NOT_OFFERED_FOR_PRODUCT: "NOT_OFFERED_FOR_PRODUCT",
  UNKNOWN: "UNKNOWN",
});

function normalizeProducts(ws, mcp) {
  const fromCandidates = Array.isArray(ws?.candidates) ? ws.candidates.map((c) => c?.section ?? c?.product).filter(Boolean) : [];
  const fromWs = Array.isArray(ws?.products) ? ws.products.filter(Boolean) : [];
  const fromMcp = mcp && typeof mcp === "object" ? Object.keys(mcp) : [];
  return [...new Set([...fromWs, ...fromCandidates, ...fromMcp])];
}

/**
 * @param {object} input
 * @param {object|null} input.ws  evidência da sessão WS fresca:
 *   { fresh:boolean, complete:boolean, staleSnapshot:boolean, availability:string,
 *     activeId:number|null, products?:string[], candidates?:{section|product,activeId,enabled,suspended}[] }
 * @param {object|null} input.mcp mapa por produto -> { present:boolean, isOpen:boolean, assetId?:number }
 *   (vem de list_assets(only_enabled:false) do MESMO produto: turbo->turbo, binary->binary, digital->digital)
 */
export function classifyMarketState({ ws = null, mcp = null } = {}) {
  if (!ws || ws.fresh !== true) {
    return { classification: MARKET_STATE.SESSION_DATA_STALE, reason: "WS fresco indisponível: feed ausente/desconhecido => UNKNOWN/SESSION_DATA_STALE, nunca SUSPENDED." };
  }
  if (ws.complete === false) {
    return { classification: MARKET_STATE.SESSION_DATA_STALE, reason: "Snapshot WS incompleto (feed parcial/reconectando) => UNKNOWN, nunca SUSPENDED/NOT_OFFERED." };
  }
  if (ws.staleSnapshot === true) {
    return { classification: MARKET_STATE.SESSION_DATA_STALE, reason: "Resolver marcou staleSnapshot (snapshot incompleto): downgrade para UNKNOWN até confirmação do broker." };
  }

  const products = normalizeProducts(ws, mcp);
  const entries = products.map((product) => ({ product, evidence: (mcp && mcp[product]) || null }));
  const present = entries.filter((e) => e.evidence && e.evidence.present === true);
  const openClaims = present.filter((e) => e.evidence.isOpen === true);
  const closedClaims = present.filter((e) => e.evidence.isOpen === false);
  const availability = String(ws.availability ?? "UNKNOWN").toUpperCase();

  if (openClaims.length && availability === "SUSPENDED") {
    return {
      classification: MARKET_STATE.CONFLICT,
      reason: `WS fresco diz SUSPENDED para activeId ${ws.activeId ?? "?"} mas MCP do produto diz OPEN: ${openClaims.map((e) => `${e.product}#${e.evidence.assetId ?? "?"}`).join(", ")}. Não sobrescrever silenciosamente.`,
      openClaims: openClaims.map((e) => e.product),
    };
  }

  if (availability === "OPEN") {
    if (closedClaims.length && !openClaims.length) {
      return { classification: MARKET_STATE.CONFLICT, reason: `WS fresco diz OPEN mas MCP do(s) produto(s) ${closedClaims.map((e) => e.product).join(", ")} diz is_open=false.`, closedClaims: closedClaims.map((e) => e.product) };
    }
    if (openClaims.length) return { classification: MARKET_STATE.BROKER_CONFIRMED_OPEN, reason: "WS fresco e MCP do produto concordam: OPEN.", openClaims: openClaims.map((e) => e.product) };
    return { classification: MARKET_STATE.UNKNOWN, reason: "WS fresco diz OPEN, porém sem contraparte MCP do produto (nem aberta nem fechada): evidência insuficiente." };
  }

  if (availability === "SUSPENDED" || availability === "DISABLED" || availability === "CLOSED") {
    if (closedClaims.length) {
      const absent = entries.filter((e) => !e.evidence || e.evidence.present !== true).map((e) => e.product);
      return {
        classification: MARKET_STATE.BROKER_CONFIRMED_SUSPENDED,
        reason: `WS fresco is_suspended=true (activeId ${ws.activeId ?? "?"}) e MCP do produto confirma is_open=false: ${closedClaims.map((e) => `${e.product}#${e.evidence.assetId ?? "?"}`).join(", ")}.${absent.length ? ` Sem entrada MCP em: ${absent.join(", ")}.` : ""}`,
        closedClaims: closedClaims.map((e) => e.product),
      };
    }
    if (present.length === 0) {
      const consulted = mcp !== null && typeof mcp === "object" && Object.keys(mcp).length > 0;
      if (!consulted) return { classification: MARKET_STATE.UNKNOWN, reason: "WS fresco diz SUSPENDED sem consulta MCP do produto (ausência de evidência): UNKNOWN, nunca SUSPENDED." };
      return { classification: MARKET_STATE.NOT_OFFERED_FOR_PRODUCT, reason: "WS fresco diz SUSPENDED, mas nenhum MCP de produto oferece o ativo (catálogo completo, only_enabled:false): produto não oferece." };
    }
    return { classification: MARKET_STATE.UNKNOWN, reason: "WS fresco diz SUSPENDED sem confirmação is_open=false do MCP do produto: evidência insuficiente." };
  }

  if (availability === "NOT_OFFERED") {
    if (openClaims.length) return { classification: MARKET_STATE.SESSION_DATA_STALE, reason: "Resolver omite o ativo, mas o MCP do produto o reporta OPEN: catálogo WS stale/omisso, não 'não oferecido'." };
    return { classification: MARKET_STATE.NOT_OFFERED_FOR_PRODUCT, reason: "Ativo ausente do catálogo WS e sem MCP OPEN: não oferecido no produto." };
  }

  if (openClaims.length) return { classification: MARKET_STATE.CONFLICT, reason: "MCP do produto reporta OPEN enquanto o estado WS é desconhecido: conflito sem override silencioso." };
  return { classification: MARKET_STATE.UNKNOWN, reason: "Estado WS desconhecido e sem evidência MCP conclusiva." };
}
