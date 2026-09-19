#!/usr/bin/env node
/**
 * ENTRY TIMING AUDIT (Fase 1/2 — read-only) — reconstroi a timeline REAL das operacoes PRACTICE
 * a partir do Supabase Postgres: candidato -> revalidacao -> envio -> ACK -> entrada efetiva ->
 * expiracao solicitada/aceita, e quantifica quantos ms antes do limite real de compra entramos.
 *
 * Nao decide nada, nao altera nada e nao envia ordem. Saida versionada:
 *   docs/research/data/entry-timing-reconstruction.json
 *
 * Uso:
 *   railway run --service tracecom-live-relay --environment production -- node scripts/entry-timing-audit.mjs
 *   DATABASE_URL=... node scripts/entry-timing-audit.mjs [--since ISO] [--execution exec_id] [--out caminho]
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { computeExpiration } from "../relay/iqoption-ws.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "relay", "package.json"));
const { Pool } = require("pg");

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index > -1 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};

const SINCE = arg("--since", new Date(Date.now() - 72 * 3_600_000).toISOString());
const TARGET_EXECUTION = arg("--execution", "exec_1789770838656_a9hjsa");
const OUT = arg("--out", path.join("docs", "research", "data", "entry-timing-reconstruction.json"));
const LOCAL_TZ_OFFSET_MINUTES = Number(arg("--tz-offset-minutes", "-180")); // BRT (UTC-3) para a evidencia da Fase 2

/** Limite de compra da mesma expiracao conforme semantica IQ (1m turbo): corte exclusivo em E-30s. */
export const TURBO_1M_CUTOFF_MS = 30_000;
export function latestSameExpirySendAt(targetExpiryAt) { return Number(targetExpiryAt) - TURBO_1M_CUTOFF_MS; }

const percentile = (values, fraction) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil(fraction * list.length) - 1))];
};
const stats = (values) => {
  const list = values.filter((value) => Number.isFinite(value));
  return { n: list.length, p50: percentile(list, 0.5), p90: percentile(list, 0.9), p95: percentile(list, 0.95), p99: percentile(list, 0.99), min: list.length ? Math.round(Math.min(...list)) : null, max: list.length ? Math.round(Math.max(...list)) : null };
};
const iso = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);
const local = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms) + LOCAL_TZ_OFFSET_MINUTES * 60_000).toISOString().replace("Z", `-${String(Math.abs(LOCAL_TZ_OFFSET_MINUTES) / 60).padStart(2, "0")}:${String(Math.abs(LOCAL_TZ_OFFSET_MINUTES) % 60).padStart(2, "0")}`) : null);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
/** pg devolve Date (ms truncado no toString); normaliza para epoch ms sem perder precisao. */
const toMs = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const out = {
    meta: {
      schema: "entry-timing-reconstruction-v1",
      generatedAt: new Date().toISOString(), since: SINCE, targetExecution: TARGET_EXECUTION,
      source: "Supabase Postgres (Railway DATABASE_URL)", readOnly: true,
      note: "Reconstrucao deterministica; nenhum dado e alterado. Limite de compra turbo 1m = expiracao - 30s (exclusivo), derivado de relay/iqoption-ws.mjs computeExpiration (referencia iqoptionapi/expiration.py).",
    },
    errors: [],
    runtimeConfig: null,
    target: null,
    trades: [],
    cancellations: [],
    latencies: null,
    semanticsChecks: null,
  };
  try {
    out.runtimeConfig = (await pool.query(
      "SELECT mode, auto_execute, brain_generation, jit_enabled, entry_lead_ms, entry_window_max_drift_ms, quality_gate_enabled, min_trade_quality_score, revision FROM iq_runtime_config",
    )).rows[0] ?? null;

    const executions = (await pool.query(
      `SELECT execution_id, market_key, direction, stake, state, broker_order_id, symbol, active_id, expiration_at,
              entry_price, broker_result, profit, requested_at, acked_at, settled_at, error, meta
         FROM iq_executions
        WHERE requested_at >= $1
        ORDER BY requested_at`,
      [SINCE],
    )).rows;
    const jitExecutions = executions.filter((row) => row.meta?.entryTiming?.candidateId);
    const executionIds = jitExecutions.map((row) => row.execution_id);
    const journalRows = executionIds.length ? (await pool.query(
      "SELECT trade_id, correlation_id FROM iq_trade_journal WHERE trade_id = ANY($1::text[])",
      [executionIds],
    )).rows : [];
    const correlationByExecution = new Map(journalRows.map((row) => [row.trade_id, row.correlation_id]));
    const correlationIds = [...new Set(jitExecutions.map((row) => row.meta?.correlationId ?? correlationByExecution.get(row.execution_id)).filter(Boolean))];
    const candidateIds = [...new Set(jitExecutions.map((row) => row.meta?.entryTiming?.candidateId).filter(Boolean))];
    const targetRow = executions.find((row) => row.execution_id === TARGET_EXECUTION) ?? (await pool.query("SELECT * FROM iq_executions WHERE execution_id=$1", [TARGET_EXECUTION])).rows[0] ?? null;

    const auditRows = (correlationIds.length || candidateIds.length) ? (await pool.query(
      `SELECT correlation_id, market_key, stage, detail, created_at
         FROM iq_audit_trail
        WHERE correlation_id = ANY($1::text[]) OR detail->>'candidateId' = ANY($2::text[])
        ORDER BY id`,
      [correlationIds, candidateIds.length ? candidateIds : [""]],
    )).rows : [];
    const auditByCorrelation = new Map();
    const candidateAudit = new Map();
    for (const row of auditRows) {
      const list = auditByCorrelation.get(row.correlation_id) ?? [];
      list.push(row); auditByCorrelation.set(row.correlation_id, list);
      const candidateId = row.detail?.candidateId;
      if (candidateId) {
        const entries = candidateAudit.get(candidateId) ?? [];
        entries.push(row); candidateAudit.set(candidateId, entries);
      }
    }
    const stageAt = (correlationId, stage) => {
      const row = (auditByCorrelation.get(correlationId) ?? []).find((item) => item.stage === stage);
      return row ? { at: toMs(row.created_at), detail: row.detail } : null;
    };

    const buildTrade = (execution) => {
      const timing = execution.meta?.entryTiming ?? {};
      const correlationId = execution.meta?.correlationId ?? correlationByExecution.get(execution.execution_id) ?? null;
      const candidateId = timing.candidateId ?? null;
      const created = candidateId ? (candidateAudit.get(candidateId) ?? []).find((row) => row.stage === "CANDIDATE_CREATED") : null;
      const revalidation = candidateId ? (candidateAudit.get(candidateId) ?? []).find((row) => row.stage === "FINAL_REVALIDATION") : null;
      const orderSent = stageAt(correlationId, "ORDER_SENT");
      const brokerAck = stageAt(correlationId, "BROKER_ACK");
      const candidateAt = created ? toMs(created.created_at) : null;
      const revalidatedAt = num(timing.revalidatedAt);
      const submitAtMs = num(timing.submitAtMs) ?? num(orderSent?.detail?.submitAtMs);
      const requestedAt = toMs(execution.requested_at);
      const ackedAt = toMs(execution.acked_at);
      const targetEntryAt = num(timing.targetEntryAt);
      const targetExpiryAt = num(timing.targetExpiryAt);
      const effectiveEntryAt = num(execution.meta?.effectiveEntryAt) ?? num(timing.effectiveEntryAt) ?? ackedAt;
      const expirationAt = toMs(execution.expiration_at);
      const requestedExpirySec = num(timing.targetExpirySec) ?? (targetExpiryAt ? Math.round(targetExpiryAt / 1000) : null);
      const cutoffAt = targetExpiryAt ? latestSameExpirySendAt(targetExpiryAt) : null;
      return {
        executionId: execution.execution_id, brokerOrderId: execution.broker_order_id, marketKey: execution.market_key, direction: execution.direction,
        stake: num(execution.stake), state: execution.state, result: execution.broker_result, profit: num(execution.profit), entryPrice: num(execution.entry_price),
        candidateId, correlationId, setup: execution.meta?.setup ?? null, optionKind: orderSent?.detail?.optionKind ?? null,
        timestamps: {
          candidateAt, candidateLocal: local(candidateAt), decisionAt: revalidatedAt, decisionLocal: local(revalidatedAt),
          submitAtMs, submitAtLocal: local(submitAtMs), requestSentAt: requestedAt, requestSentLocal: local(requestedAt),
          ackAt: ackedAt, ackLocal: local(ackedAt), effectiveEntryAt, effectiveEntryLocal: local(effectiveEntryAt),
          targetEntryAt, targetEntryLocal: local(targetEntryAt), targetExpiryAt, targetExpiryLocal: local(targetExpiryAt),
          brokerExpirationAt: expirationAt, brokerExpirationLocal: local(expirationAt), cutoffAt, cutoffLocal: local(cutoffAt),
        },
        requestedExpirationSec: requestedExpirySec, brokerExpirationSec: expirationAt ? Math.round(expirationAt / 1000) : null,
        brokerExpirationObservedSec: num(execution.meta?.brokerExpirationSec),
        brokerExpirationMismatch: execution.meta?.expirationMismatch === true,
        expirationRequestedEqualsAccepted: expirationAt !== null && requestedExpirySec !== null ? Math.round(expirationAt / 1000) === requestedExpirySec : null,
        entryLeadMs: num(timing.entryLeadMs),
        d1_candidateToDecisionMs: candidateAt !== null && revalidatedAt !== null ? revalidatedAt - candidateAt : null,
        d2_decisionToSubmitMs: revalidatedAt !== null && submitAtMs !== null ? submitAtMs - revalidatedAt : null,
        d3_submitToRequestMs: submitAtMs !== null && requestedAt !== null ? requestedAt - submitAtMs : null,
        d4_requestToAckMs: num(execution.meta?.ackMs) ?? (requestedAt !== null && ackedAt !== null ? ackedAt - requestedAt : null),
        d5_ackToEffectiveMs: ackedAt !== null && effectiveEntryAt !== null ? effectiveEntryAt - ackedAt : null,
        entryDriftMs: num(execution.meta?.entryDriftMs) ?? num(timing.entryDriftMs),
        candidateChangedBeforeEntry: timing.candidateChangedBeforeEntry === true,
        directionChanges: num(timing.directionChanges) ?? 0,
        msBeforeCutoffAtEntry: cutoffAt !== null && effectiveEntryAt !== null ? cutoffAt - effectiveEntryAt : null,
        unusedObservationMs: cutoffAt !== null && submitAtMs !== null ? cutoffAt - submitAtMs : null,
        sameExpiryJustBeforeCutoff: targetExpiryAt ? (computeExpiration((latestSameExpirySendAt(targetExpiryAt) - 1) / 1000, 1).expiration === Math.round(targetExpiryAt / 1000)) : null,
        sameExpiryAtCutoffExclusive: targetExpiryAt ? (computeExpiration(latestSameExpirySendAt(targetExpiryAt) / 1000, 1).expiration === Math.round(targetExpiryAt / 1000)) : null,
        revalidationOk: revalidation?.detail?.ok ?? null,
        revalidationReason: revalidation?.detail?.reason ?? null,
        changedFields: (revalidation?.detail?.changedFields ?? []).map((change) => change.field),
        candidateEvaluations: candidateId ? (candidateAudit.get(candidateId) ?? []).filter((row) => row.stage === "CANDIDATE_UPDATED").length : null,
      };
    };

    out.trades = jitExecutions.map(buildTrade);
    out.cancellations = (await pool.query(
      `SELECT stage, detail->>'reason' AS reason, count(*)::int AS n
         FROM iq_audit_trail
        WHERE stage = 'CANDIDATE_CANCELLED' AND created_at >= $1
        GROUP BY 1, 2 ORDER BY n DESC`,
      [SINCE],
    )).rows;

    if (targetRow) {
      const target = buildTrade(targetRow);
      const journal = (await pool.query("SELECT trade_id, correlation_id, market_key, direction, result, stake, payout, entry_at, settlement_at FROM iq_trade_journal WHERE trade_id=$1", [TARGET_EXECUTION])).rows[0] ?? null;
      const targetAudit = target.correlationId ? (auditByCorrelation.get(target.correlationId) ?? []).map((row) => ({ stage: row.stage, at: row.created_at, detail: row.detail })) : [];
      out.target = {
        identified: true,
        execution: targetRow.execution_id, brokerOrderId: targetRow.broker_order_id, marketKey: targetRow.market_key, symbol: targetRow.symbol, direction: targetRow.direction,
        stake: num(targetRow.stake), entryPrice: num(targetRow.entry_price), result: targetRow.broker_result, profit: num(targetRow.profit),
        expirationUtc: targetRow.expiration_at, expirationLocal: local(Date.parse(targetRow.expiration_at)),
        requestedLocalWindow: { from: local(target.cutoffAt - 60_000), to: local(target.cutoffAt) },
        proof: {
          market: targetRow.market_key === "EURUSD:OTC",
          directionPut: targetRow.direction === "PUT",
          stake10: Number(targetRow.stake) === 10,
          expirationLocal1935: local(Date.parse(targetRow.expiration_at))?.startsWith("2026-09-18T19:35"),
          entryPriceNear114329: Math.abs(num(targetRow.entry_price) - 1.14329) < 0.001,
          brokerOrderId: targetRow.broker_order_id,
        },
        timeline: target,
        audit: targetAudit,
        journal,
      };
    } else {
      out.target = { identified: false, reason: "EXECUTION_NOT_FOUND", targetExecution: TARGET_EXECUTION };
    }

    out.latencies = {
      ackMs: stats(out.trades.map((trade) => trade.d4_requestToAckMs)),
      decisionToSubmitMs: stats(out.trades.map((trade) => trade.d2_decisionToSubmitMs)),
      submitToRequestMs: stats(out.trades.map((trade) => trade.d3_submitToRequestMs)),
      candidateToDecisionMs: stats(out.trades.map((trade) => trade.d1_candidateToDecisionMs)),
      entryDriftMs: stats(out.trades.map((trade) => trade.entryDriftMs)),
      msBeforeCutoffAtEntry: stats(out.trades.map((trade) => trade.msBeforeCutoffAtEntry)),
      unusedObservationMs: stats(out.trades.map((trade) => trade.unusedObservationMs)),
    };
    out.semanticsChecks = {
      reference: "relay/iqoption-ws.mjs computeExpiration(serverSec, 1)",
      turbo1mCutoffMs: TURBO_1M_CUTOFF_MS,
      rule: "turbo 1m: a mesma expiracao E e compravel em serverTime S quando E-90s <= S < E-30s (corte exclusivo em E-30s).",
      boundaryCases: [
        { label: "windowStart(E-90s)", serverSec: (Date.UTC(2026, 8, 18, 22, 35, 0) - 90_000) / 1000, expectedExpiration: 1789770900, actual: computeExpiration((Date.UTC(2026, 8, 18, 22, 35, 0) - 90_000) / 1000, 1).expiration },
        { label: "justBeforeWindowStart(E-90s-1ms)", serverSec: (Date.UTC(2026, 8, 18, 22, 35, 0) - 90_001) / 1000, expectedExpiration: 1789770840, actual: computeExpiration((Date.UTC(2026, 8, 18, 22, 35, 0) - 90_001) / 1000, 1).expiration },
        { label: "justBeforeCutoff(E-30s-1ms)", serverSec: (latestSameExpirySendAt(Date.UTC(2026, 8, 18, 22, 35, 0)) - 1) / 1000, expectedExpiration: 1789770900, actual: computeExpiration((latestSameExpirySendAt(Date.UTC(2026, 8, 18, 22, 35, 0)) - 1) / 1000, 1).expiration },
        { label: "cutoffExclusive(E-30s)", serverSec: latestSameExpirySendAt(Date.UTC(2026, 8, 18, 22, 35, 0)) / 1000, expectedExpiration: 1789770960, actual: computeExpiration(latestSameExpirySendAt(Date.UTC(2026, 8, 18, 22, 35, 0)) / 1000, 1).expiration },
      ],
      allJitExpirationsMatchRequested: out.trades.every((trade) => trade.expirationRequestedEqualsAccepted === true),
      allBrokerObservedExpirationsMatch: out.trades.filter((trade) => trade.brokerExpirationObservedSec !== null).every((trade) => trade.brokerExpirationObservedSec === trade.requestedExpirationSec),
      brokerObservedSamples: out.trades.filter((trade) => trade.brokerExpirationObservedSec !== null).length,
      allJitSameExpiryJustBeforeCutoff: out.trades.every((trade) => trade.sameExpiryJustBeforeCutoff === true),
      allJitFlippedAtCutoff: out.trades.every((trade) => trade.sameExpiryAtCutoffExclusive === false),
    };
  } catch (error) {
    out.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 1500));
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
  const summary = {
    ok: out.errors.length === 0, outPath: OUT, trades: out.trades.length, target: out.target ? { identified: out.target.identified, execution: out.target.execution, brokerOrderId: out.target.brokerOrderId, expirationLocal: out.target.expirationLocal } : null,
    latencies: out.latencies, semanticsChecks: out.semanticsChecks ? { allJitExpirationsMatchRequested: out.semanticsChecks.allJitExpirationsMatchRequested, allBrokerObservedExpirationsMatch: out.semanticsChecks.allBrokerObservedExpirationsMatch, brokerObservedSamples: out.semanticsChecks.brokerObservedSamples, allJitSameExpiryJustBeforeCutoff: out.semanticsChecks.allJitSameExpiryJustBeforeCutoff, allJitFlippedAtCutoff: out.semanticsChecks.allJitFlippedAtCutoff } : null,
    cancellations: out.cancellations, errors: out.errors,
  };
  console.log(JSON.stringify(summary, null, 1));
  await new Promise((resolve) => setTimeout(resolve, 250)); // drena inserts do pool antes de encerrar
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
