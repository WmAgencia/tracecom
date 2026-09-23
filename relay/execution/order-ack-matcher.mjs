/**
 * Correlacao de eventos de ordem/settlement do broker com as execucoes locais.
 * Funcoes puras (sem I/O): usadas pelo runtime e pelos testes.
 * Regra: casar por evidencia forte (requestId/brokerOrderId/tupla ativo+expiry+direcao) e
 * NUNCA por chute quando houver ambiguidade.
 */

export const ACK_CORRELATION_WINDOW_MS = 10 * 60_000;
export const SETTLEMENT_GRACE_MS = 90_000;

/** Pendencias candidatas: nao resolvidas e dentro da janela de correlacao (independente da conexao). */
export function pendingCandidates(pendings = [], { now = Date.now(), windowMs = ACK_CORRELATION_WINDOW_MS } = {}) {
  return (Array.isArray(pendings) ? pendings : []).filter((pending) => pending
    && pending.ackResolved !== true
    && Number.isFinite(Number(pending.requestedAt))
    && now - Number(pending.requestedAt) <= windowMs);
}

/** Correlaciona eventos de ACK (option/buyComplete/socket-option-opened) com a ordem pendente. */
export function matchPendingOrder({ kind, event = null, pendings = [], now = Date.now(), windowMs = ACK_CORRELATION_WINDOW_MS } = {}) {
  const msg = event?.msg ?? {};
  const candidates = pendingCandidates(pendings, { now, windowMs });
  const requestId = event?.requestId ?? null;
  if (kind === "option") {
    if (requestId === null || requestId === undefined || requestId === "") return null;
    return candidates.find((pending) => String(requestId) === String(pending.requestId)) ?? null;
  }
  if (kind === "buyComplete") {
    if (msg.isSuccessful === false || msg.result?.id === undefined) return null;
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (kind === "socket-option-opened") {
    const activeId = msg.active_id === undefined || msg.active_id === null ? null : Number(msg.active_id);
    const expired = msg.expired === undefined || msg.expired === null ? null : Number(msg.expired);
    const price = msg.price === undefined || msg.price === null ? null : Number(msg.price);
    const tupleMatches = candidates.filter((pending) => (activeId === null || activeId === Number(pending.activeId))
      && (expired === null || expired === Number(pending.expirationSec))
      && (price === null || price === Number(pending.stake)));
    if (tupleMatches.length === 1) return tupleMatches[0];
    if (tupleMatches.length > 1) return null;
    return candidates.length === 1 ? candidates[0] : null;
  }
  return null;
}

/** Correlaciona uma execucao local (maria/orfa) com as opcoes fechadas do broker. Sem evidencia => null. */
export function matchClosedOption(row, closedOptions = []) {
  const entries = Array.isArray(closedOptions) ? closedOptions : [];
  if (!row) return null;
  if (row.broker_order_id) {
    const byId = entries.find((entry) => String(entry?.id?.[0] ?? entry?.id ?? "") === String(row.broker_order_id));
    return byId ? { entry: byId, basis: "BROKER_ORDER_ID" } : null;
  }
  const activeId = Number(row.active_id);
  const expiredSec = row.expiration_at ? Math.round(new Date(row.expiration_at).getTime() / 1000) : null;
  if (!Number.isFinite(activeId) || expiredSec === null) return null;
  const direction = String(row.direction ?? "").toUpperCase();
  const stake = Number(row.stake);
  const matches = entries.filter((entry) => {
    if (Number(entry?.active_id) !== activeId) return false;
    if (Number(entry?.expired) !== expiredSec) return false;
    const entryDirection = String(entry?.direction ?? entry?.dir ?? "").toUpperCase();
    if (entryDirection && direction && entryDirection !== direction) return false;
    const entryPrice = Number(entry?.price ?? entry?.amount);
    if (Number.isFinite(entryPrice) && Number.isFinite(stake) && entryPrice !== stake) return false;
    return true;
  });
  if (matches.length !== 1) return null;
  return { entry: matches[0], basis: "TUPLE_ACTIVE_EXPIRED_DIRECTION" };
}
