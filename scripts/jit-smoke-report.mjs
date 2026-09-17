/**
 * JIT SMOKE REPORT (Fase 6.2) — le o dump de producao (audit-g2-data.json) e reconstroi a cadeia de timing.
 *
 * Uso: node scripts/jit-smoke-report.mjs [--since ISO]
 * Entrada: audit-g2-data.json (scripts/diag-g2-audit.mjs). Saida: JSON com cadeia por trade, drift e latencias.
 */
import fs from "node:fs/promises";

const sinceArg = process.argv.includes("--since") ? process.argv[process.argv.indexOf("--since") + 1] : null;
const since = sinceArg ? Date.parse(sinceArg) : 0;
const raw = JSON.parse(await fs.readFile("audit-g2-data.json", "utf8"));

const auditByCorrelation = new Map();
for (const row of raw.audit ?? []) {
  const list = auditByCorrelation.get(row.correlation_id) ?? [];
  list.push(row);
  auditByCorrelation.set(row.correlation_id, list);
}
const stageTime = (correlationId, stage, field = "created_at") => {
  const row = (auditByCorrelation.get(correlationId) ?? []).find((item) => item.stage === stage);
  return row ? Date.parse(row[field]) : null;
};
const chainOf = (correlationId) => {
  const rows = (auditByCorrelation.get(correlationId) ?? []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return Object.fromEntries(rows.map((row) => [row.stage, { at: Date.parse(row.created_at), detail: row.detail }]));
};

const percentile = (values, p) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil(p * list.length) - 1));
  return list[index];
};

const trades = [];
for (const row of raw.journal ?? []) {
  const settled = row.settlement_at ? Date.parse(row.settlement_at) : null;
  if (!settled || settled < since) continue;
  const execution = (raw.executions ?? []).find((item) => item.execution_id === row.trade_id);
  const meta = execution?.meta ?? {};
  const timing = meta.entryTiming ?? row.payload?.entryTiming ?? null;
  const chain = chainOf(row.correlation_id);
  trades.push({
    tradeId: row.trade_id, marketKey: row.market_key, direction: row.direction, result: row.result, stake: row.stake, payout: row.payout,
    candidateId: timing?.candidateId ?? row.payload?.entryTiming?.candidateId ?? null,
    t0SnapshotSource: row.payload?.snapshotSource ?? null,
    timestamps: {
      candidateCreatedAt: chain.CANDIDATE_CREATED?.at ?? null,
      finalRevalidationAt: chain.FINAL_REVALIDATION?.at ?? null,
      submitAtPlanned: timing?.submitAt ?? null,
      orderSentAt: chain.ORDER_SENT?.at ?? null,
      brokerAckAt: chain.BROKER_ACK?.at ?? null,
      effectiveEntryAt: meta.effectiveEntryAt ?? chain.BROKER_ACK?.detail?.effectiveEntryAt ?? null,
      targetEntryAt: timing?.targetEntryAt ?? chain.BROKER_ACK?.detail?.targetEntryAt ?? null,
      targetExpiryAt: timing?.targetExpiryAt ?? null,
      settlementAt: settled,
    },
    entryLeadMs: timing?.entryLeadMs ?? null,
    entryDriftMs: meta.entryDriftMs ?? chain.BROKER_ACK?.detail?.entryDriftMs ?? null,
    candidateChangedBeforeEntry: timing?.candidateChangedBeforeEntry ?? null,
    revalidationOk: chain.FINAL_REVALIDATION?.detail?.ok ?? null,
    ackMs: execution?.requested_at && execution?.acked_at ? Date.parse(execution.acked_at) - Date.parse(execution.requested_at) : null,
    settlementMsAfterEntry: meta.effectiveEntryAt && settled ? settled - meta.effectiveEntryAt : null,
  });
}

const cancellations = {};
for (const row of raw.audit ?? []) {
  if (row.stage !== "CANDIDATE_CANCELLED") continue;
  const reason = row.detail?.reason ?? "UNKNOWN";
  cancellations[reason] = (cancellations[reason] ?? 0) + 1;
}
const candidatesCreated = (raw.audit ?? []).filter((row) => row.stage === "CANDIDATE_CREATED").length;
const revalidations = (raw.audit ?? []).filter((row) => row.stage === "FINAL_REVALIDATION");
const ackLatencies = trades.map((trade) => trade.ackMs).filter((value) => Number.isFinite(value));
const drifts = trades.map((trade) => trade.entryDriftMs).filter((value) => Number.isFinite(value));

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), since: since ? new Date(since).toISOString() : null,
  trades: trades.length, candidatesCreated, cancellations,
  revalidation: { total: revalidations.length, ok: revalidations.filter((row) => row.detail?.ok === true).length, cancelled: revalidations.filter((row) => row.detail?.ok !== true).length },
  ackMs: { p50: percentile(ackLatencies, 0.5), p95: percentile(ackLatencies, 0.95), p99: percentile(ackLatencies, 0.99), max: ackLatencies.length ? Math.max(...ackLatencies) : null },
  entryDriftMs: { p50: percentile(drifts, 0.5), p95: percentile(drifts, 0.95), max: drifts.length ? Math.max(...drifts) : null, min: drifts.length ? Math.min(...drifts) : null },
  chain: trades,
}, null, 2));
