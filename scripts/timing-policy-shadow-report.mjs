#!/usr/bin/env node
/**
 * TIMING POLICY SHADOW REPORT (Fase 4 — read-only) — compara CURRENT_V1 x LATE_WINDOW_V2 a partir de
 * iq_timing_policy_observations (migration 030), sem misturar com iq_shadow_observations (029).
 *
 * Saida versionada: docs/research/data/timing-policy-shadow-report.json
 * Uso:
 *   railway run --service tracecom-live-relay --environment production -- node scripts/timing-policy-shadow-report.mjs
 *   DATABASE_URL=... node scripts/timing-policy-shadow-report.mjs [--since ISO] [--out caminho]
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TIMING_POLICY_CURRENT, TIMING_POLICY_LATE, TURBO_1M_CUTOFF_MS } from "../relay/late-window-timing.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "relay", "package.json"));
const { Pool } = require("pg");

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index > -1 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const SINCE = arg("--since", new Date(Date.now() - 7 * 24 * 3_600_000).toISOString());
const OUT = arg("--out", path.join("docs", "research", "data", "timing-policy-shadow-report.json"));
const MARGIN_VARIANTS_MS = [1_000, 2_000, 3_000, 4_000, 5_000];

const percentile = (values, fraction) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil(fraction * list.length) - 1))];
};
const stats = (values) => {
  const list = values.filter((value) => Number.isFinite(value));
  return { n: list.length, p50: percentile(list, 0.5), p95: percentile(list, 0.95), min: list.length ? Math.min(...list) : null, max: list.length ? Math.max(...list) : null };
};
const fromDbMs = (value) => (value === null || value === undefined ? null : value instanceof Date ? value.getTime() : Date.parse(value));

/** Veredito da politica NOVA para uma margem qualquer, usando APENAS avaliacoes em/antes do deadline. */
export function verdictAtMargin(observation, marginMs) {
  const cutoff = observation.target_expiry_at ? fromDbMs(observation.target_expiry_at) - TURBO_1M_CUTOFF_MS : null;
  if (cutoff === null) return { decision: "UNKNOWN", reason: "NO_TARGET_EXPIRY", evaluationAt: null, score: null };
  const deadline = cutoff - marginMs;
  const evaluations = Array.isArray(observation.evaluations) ? observation.evaluations : [];
  const eligible = evaluations.filter((row) => Number(row?.at) <= deadline);
  const last = eligible[eligible.length - 1] ?? null;
  if (!last) return { decision: "CANCEL_NO_EVALUATION", reason: "NO_EVALUATION_BEFORE_DEADLINE", evaluationAt: null, score: null };
  return {
    decision: last.valid === true ? "ACCEPT" : "CANCEL",
    reason: last.valid === true ? null : (last.revalidationOk === false ? (last.revalidationReason ?? "REVALIDATION_FAILED") : (last.gateReason ?? "GATE_REJECT")),
    evaluationAt: Number(last.at), evaluationAfterDeadline: last.afterDeadline === true, score: last.score ?? null, price: last.price ?? null,
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const out = {
    meta: {
      schema: "timing-policy-shadow-report-v1", generatedAt: new Date().toISOString(), since: SINCE,
      policies: { current: TIMING_POLICY_CURRENT, late: TIMING_POLICY_LATE },
      source: "Supabase Postgres iq_timing_policy_observations (Railway DATABASE_URL)", readOnly: true,
      note: "LATE_WINDOW_V2 e observacional: nunca envia ordem. Liquidacao do braco LATE e CAUSAL_COUNTERFACTUAL; resultado CURRENT vem do broker (join com iq_trade_journal).",
    },
    errors: [],
    totals: null,
    margins: [],
    outcomes: null,
    observations: [],
  };
  try {
    const rows = (await pool.query(
      "SELECT observation_id, timing_policy_version, current_policy_version, market_key, market_type, candidate_id, target_entry_at, target_expiry_at, product_kind, direction, payout, policy, current_policy, late_policy, evaluations, comparison, outcome, outcome_reason, created_at FROM iq_timing_policy_observations WHERE created_at >= $1 ORDER BY created_at",
      [SINCE],
    )).rows;
    const executionIds = [...new Set(rows.map((row) => row.current_policy?.executionId).filter(Boolean))];
    const journals = executionIds.length ? (await pool.query(
      "SELECT trade_id, result, profit, stake, payout, entry_at, settlement_at FROM iq_trade_journal WHERE trade_id = ANY($1::text[])",
      [executionIds],
    )).rows : [];
    const journalByTrade = new Map(journals.map((row) => [row.trade_id, row]));

    out.totals = {
      observations: rows.length,
      finalized: rows.filter((row) => row.outcome !== "OBSERVING").length,
      observing: rows.filter((row) => row.outcome === "OBSERVING").length,
      staleObserving: rows.filter((row) => row.outcome === "OBSERVING" && (fromDbMs(row.created_at) ?? 0) < Date.now() - 5 * 60_000).length,
      distinctMarkets: new Set(rows.map((row) => row.market_key)).size,
      policyVersions: [...new Set(rows.map((row) => row.timing_policy_version))],
    };
    out.outcomes = Object.fromEntries([...new Set(rows.map((row) => row.outcome))].map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length]));

    const finalizedRows = rows.filter((row) => row.outcome !== "OBSERVING");
    const comparisons = finalizedRows.map((row) => row.comparison).filter((row) => row && typeof row === "object");
    out.aggregate = {
      additionalObservedMsVsCurrentSubmit: stats(comparisons.map((row) => row.additionalObservedMsVsCurrentSubmit)),
      additionalObservedMsVsCurrentEntry: stats(comparisons.map((row) => row.additionalObservedMsVsCurrentEntry)),
      additionalCandles5s: stats(comparisons.map((row) => row.additionalCandles5s)),
      additionalTickPrices: stats(comparisons.map((row) => row.additionalTickPrices)),
      becameInvalid: comparisons.filter((row) => row.becameInvalid === true).length,
      recovered: comparisons.filter((row) => row.recovered === true).length,
      actionChangedToWait: comparisons.filter((row) => row.actionChangedToWait === true).length,
      directionFlipped: comparisons.filter((row) => row.directionFlipped === true).length,
      criticChanged: comparisons.filter((row) => row.criticChanged === true).length,
      gateChanged: comparisons.filter((row) => row.gateChanged === true).length,
      locationChanged: comparisons.filter((row) => row.locationChanged === true).length,
      degraded: comparisons.filter((row) => row.degraded === true).length,
      keptSameExpirationViolations: comparisons.filter((row) => row.keptSameExpiration !== true).length,
      expirationMismatchObserved: comparisons.filter((row) => row.expirationMismatchObserved === true).length,
      lateSettled: rows.filter((row) => row.late_policy?.result).length,
    };
    out.margins = MARGIN_VARIANTS_MS.map((marginMs) => {
      const verdicts = rows.map((row) => ({ row, verdict: verdictAtMargin(row, marginMs) }));
      const accepted = verdicts.filter((entry) => entry.verdict.decision === "ACCEPT");
      return {
        marginMs, evaluated: rows.length, accepted: accepted.length, cancelled: verdicts.filter((entry) => entry.verdict.decision === "CANCEL").length,
        noEvaluation: verdicts.filter((entry) => entry.verdict.decision === "CANCEL_NO_EVALUATION").length,
        averageAdditionalMs: accepted.length ? Math.round(accepted.reduce((sum, entry) => sum + ((fromDbMs(entry.row.target_expiry_at) - TURBO_1M_CUTOFF_MS - marginMs) - (entry.row.current_policy?.submitAt ?? 0)), 0) / accepted.length) : null,
      };
    });

    out.observations = rows.map((row) => ({
      observationId: row.observation_id, marketKey: row.market_key, marketType: row.market_type, candidateId: row.candidate_id,
      timingPolicyVersion: row.timing_policy_version, currentPolicyVersion: row.current_policy_version,
      targetEntryAt: fromDbMs(row.target_entry_at), targetExpiryAt: fromDbMs(row.target_expiry_at), direction: row.direction, payout: row.payout,
      outcome: row.outcome, outcomeReason: row.outcome_reason,
      current: row.current_policy ?? {}, late: { verdict: row.late_policy?.verdict ?? null, result: row.late_policy?.result ?? null, normalizedPnl: row.late_policy?.normalizedPnl ?? null, entryPriceWouldBe: row.late_policy?.entryPriceWouldBe ?? null, deadlineAt: row.late_policy?.deadlineAt ?? null },
      broker: journalByTrade.get(row.current_policy?.executionId) ?? null,
      comparison: row.comparison ?? null,
      margins: Object.fromEntries(MARGIN_VARIANTS_MS.map((marginMs) => [marginMs, verdictAtMargin(row, marginMs)])),
      evaluations: Array.isArray(row.evaluations) ? row.evaluations.length : 0,
    }));
  } catch (error) {
    out.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 1500));
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(JSON.stringify({ ok: out.errors.length === 0, outPath: OUT, totals: out.totals, outcomes: out.outcomes, aggregate: out.aggregate, margins: out.margins, errors: out.errors }, null, 1));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
