/**
 * INGESTÃO IDEMPOTENTE: `resultados-v15.json` (do bot) → ledger do painel.
 * Um settlement entra EXATAMENTE uma vez (chave estável), mesmo que o arquivo
 * seja reescrito várias vezes pelo bot e que o servidor reinicie no meio.
 */
import { classifyOutcome } from './stats.mjs';

export const LEDGER_SCHEMA = 'tracecom-trade-ledger-v1';

export function tradeKey(record) {
  if (record?.orderId !== undefined && record?.orderId !== null && Number.isFinite(Number(record.orderId))) {
    return `order:${Number(record.orderId)}`;
  }
  if (record?.requestId) return `req:${record.requestId}`;
  return `key:${record?.active ?? record?.key ?? '?'}|${record?.sentAtMs ?? '?'}|${record?.direction ?? '?'}`;
}

const settled = (record) => record && typeof record.result === 'string' && record.result.length > 0;

export function recordTimeMs(record) {
  const sent = Number(record?.sentAtMs);
  if (Number.isFinite(sent) && sent > 0) return sent;
  const parsed = Date.parse(record?.timestamp ?? record?.settledAt ?? '');
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizeRecord(record, { sessionId = null, currency = 'R$' } = {}) {
  const profit = Number(record.profit);
  return {
    id: tradeKey(record),
    orderId: record.orderId ?? null,
    requestId: record.requestId ?? null,
    sessionId,
    assetId: record.assetId ?? null,
    asset: record.key ?? record.active ?? null,
    activeName: record.active ?? null,
    direction: record.direction ?? null,
    kind: record.kind ?? null,
    stake: Number(record.stake) || 0,
    entryPrice: Number.isFinite(Number(record.entryPrice)) ? Number(record.entryPrice) : null,
    expiration: record.expiration ?? null,
    sentAtMs: record.sentAtMs ?? null,
    sentAt: record.timestamp ?? null,
    settledAt: record.settledAt ?? null,
    result: record.result ?? null,
    outcome: classifyOutcome(profit),
    profit: Number.isFinite(profit) ? Math.round(profit * 100) / 100 : 0,
    earlySell: record.earlySell === true,
    sellReturn: Number.isFinite(Number(record.sellReturn)) ? Number(record.sellReturn) : null,
    sellKind: record.sellKind ?? null,
    profitSource: record.profitSource ?? null,
    currency,
  };
}

/**
 * Faz o merge dos registros no ledger. Idempotente:
 *  - registro sem settlement → não entra (fica pendente até fechar);
 *  - chave já existente → nunca duplica nem altera (settlement entra uma vez só);
 *  - ordem enviada ANTES do início da sessão (sinceMs) nunca é atribuída a ela
 *    (o `resultados-v15.json` guarda o run corrente: sem essa fronteira, o resto do
 *    run anterior cairia na sessão nova).
 * @returns {{ledger: object, added: number, pending: number, skipped: number}}
 */
export function ingestRecords(ledger, records = [], { sessionId = null, sinceMs = NaN, currency = 'R$', now = Date.now() } = {}) {
  const base = {
    schema: LEDGER_SCHEMA,
    updatedAt: new Date(now).toISOString(),
    trades: Array.isArray(ledger?.trades) ? ledger.trades.map((t) => ({ ...t })) : [],
  };
  const seen = new Set(base.trades.map((t) => t.id));
  let added = 0, pending = 0, skipped = 0;

  for (const record of records ?? []) {
    if (!record) continue;
    if (!settled(record)) { pending++; continue; }
    const at = recordTimeMs(record);
    const mine = sessionId && (!Number.isFinite(sinceMs) || !Number.isFinite(at) || at >= sinceMs) ? sessionId : null;
    const next = normalizeRecord(record, { sessionId: mine, currency });
    if (seen.has(next.id)) { skipped++; continue; }   // já entrou: settlement não duplica
    seen.add(next.id);
    base.trades.push(next);
    added++;
  }
  base.updatedAt = new Date(now).toISOString();
  return { ledger: base, added, pending, skipped };
}

export function emptyLedger(now = Date.now()) {
  return { schema: LEDGER_SCHEMA, updatedAt: new Date(now).toISOString(), trades: [] };
}
