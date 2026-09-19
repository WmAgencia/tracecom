#!/usr/bin/env node
/**
 * SCENARIO SHADOW REPORT (read-only) — observacoes do Critic independente / engine de cenarios
 * (migration 031), SEM misturar com o Prospective Shadow Lab (029) nem com timing (030).
 *
 * Saida versionada: docs/research/data/scenario-shadow-report.json
 * Uso:
 *   railway run --service tracecom-live-relay --environment production -- node scripts/scenario-shadow-report.mjs
 *   DATABASE_URL=... node scripts/scenario-shadow-report.mjs [--since ISO] [--out caminho]
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SCENARIO_ENGINE_V3_SHADOW, CURRENT_G2, SETTLEMENT_BASES } from "../relay/scenario-shadow.mjs";
import { TIMING_POLICY_CURRENT, TIMING_POLICY_LATE } from "../relay/late-window-timing.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "relay", "package.json"));
const { Pool } = require("pg");

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index > -1 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const SINCE = arg("--since", new Date(Date.now() - 14 * 24 * 3_600_000).toISOString());
const OUT = arg("--out", path.join("docs", "research", "data", "scenario-shadow-report.json"));
const CHECKPOINT_N = 30;

const fromDbMs = (value) => (value === null || value === undefined ? null : value instanceof Date ? value.getTime() : Date.parse(value));
const countBy = (rows, pick) => rows.reduce((acc, row) => { const key = pick(row) ?? "UNSPECIFIED"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
const summarizeOutcomes = (rows) => {
  const decided = rows.filter((row) => ["WIN", "LOSS", "DRAW"].includes(row.result));
  const wins = decided.filter((row) => row.result === "WIN").length;
  const losses = decided.filter((row) => row.result === "LOSS").length;
  const draws = decided.filter((row) => row.result === "DRAW").length;
  const pnl = rows.reduce((sum, row) => sum + (Number(row.normalizedPnl) || 0), 0);
  return {
    n: rows.length, decided: decided.length, wins, losses, draws,
    wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null,
    normalizedPnl: Number(pnl.toFixed(4)),
    expectancyPerTrade: decided.length ? Number((pnl / decided.length).toFixed(4)) : null,
  };
};

/** Separa as secoes exigidas sem nunca somar contrafactual ao broker. */
export function scenarioShadowSections(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const broker = list.filter((row) => row.settlement_basis === "BROKER_EXECUTED");
  const counterfactual = list.filter((row) => row.settlement_basis === "CAUSAL_COUNTERFACTUAL");
  const historical = list.filter((row) => row.provenance === "HISTORICAL");
  const prospective = list.filter((row) => (row.provenance ?? "PROSPECTIVE") === "PROSPECTIVE");
  const toOutcome = (row) => ({ result: row.outcome?.result ?? null, normalizedPnl: row.outcome?.normalizedPnl ?? null });
  return {
    BROKER_EXECUTED: { rows: broker.length, summary: summarizeOutcomes(broker.map(toOutcome)) },
    COUNTERFACTUAL: { rows: counterfactual.length, summary: summarizeOutcomes(counterfactual.map(toOutcome)) },
    HISTORICAL: { rows: historical.length, summary: summarizeOutcomes(historical.map(toOutcome)) },
    PROSPECTIVE: {
      rows: prospective.length,
      settled: prospective.filter((row) => row.outcome !== null && row.outcome !== undefined).length,
      summary: summarizeOutcomes(prospective.filter((row) => row.outcome !== null && row.outcome !== undefined).map(toOutcome)),
    },
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const out = {
    meta: {
      schema: "scenario-shadow-report-v1", generatedAt: new Date().toISOString(), since: SINCE,
      policies: { scenario: SCENARIO_ENGINE_V3_SHADOW, current: CURRENT_G2, timing: TIMING_POLICY_LATE, currentTiming: TIMING_POLICY_CURRENT },
      source: "Supabase Postgres iq_scenario_shadow_observations (Railway DATABASE_URL)", readOnly: true,
      note: "SHADOW_ONLY: nunca envia ordem. Series scenario/timing versionadas separadamente; outcome nunca realimenta a classificacao.",
    },
    errors: [],
    totals: null,
    sections: null,
    critic: null,
    agreement: null,
    divergences: null,
    distributions: null,
    persistence: null,
    observations: [],
  };
  try {
    const rows = (await pool.query(
      `SELECT observation_id, version, scenario_policy_version, scenario_engine_version, current_policy_version, timing_policy_version, provenance,
              market_key, market_type, candidate_id, correlation_id, candidate_at, final_entry_at, target_entry_at, target_expiry_at, direction, payout,
              current_decision, scenario_decision, trader_scenario, critic_scenario, critic_freeze, comparison, agreement, divergence, persistence,
              scenario_at_candidate, scenario_at_revalidation1, scenario_at_revalidation2, scenario_at_final_entry,
              scenario_changed, scenario_change_count, playbook_at_candidate, playbook_at_entry,
              final_action, reasons_for_wait, t0_integrity, engine_info, outcome, settlement_basis
         FROM iq_scenario_shadow_observations WHERE created_at >= $1 ORDER BY created_at`,
      [SINCE],
    )).rows;

    const prospective = rows.filter((row) => (row.provenance ?? "PROSPECTIVE") === "PROSPECTIVE");
    const settled = prospective.filter((row) => row.outcome);
    out.totals = {
      observations: rows.length,
      prospective: prospective.length,
      settled: settled.length,
      distinctMarkets: new Set(rows.map((row) => row.market_key)).size,
      scenarioPolicyVersions: [...new Set(rows.map((row) => row.scenario_policy_version))],
      scenarioEngineVersions: [...new Set(rows.map((row) => row.scenario_engine_version))],
      timingPolicyVersions: [...new Set(rows.map((row) => row.timing_policy_version))],
      series: Object.entries(countBy(rows, (row) => `${row.scenario_policy_version}|${row.scenario_engine_version}|${row.timing_policy_version}`)).map(([key, count]) => ({ key, count })),
    };
    out.sections = scenarioShadowSections(rows);
    out.critic = {
      mode: "INDEPENDENT_TWO_PHASE",
      frozenBeforeTrader: prospective.filter((row) => row.critic_freeze?.criticSawTraderConclusion === false).length,
      violations: prospective.filter((row) => row.critic_freeze?.criticSawTraderConclusion !== false).length,
      engineModes: countBy(rows, (row) => row.engine_info?.mode),
      degradedToFallback: countBy(rows, (row) => row.engine_info?.mode === "FALLBACK"),
    };
    const agreed = prospective.filter((row) => row.agreement === true);
    out.agreement = {
      n: prospective.length, agreed: agreed.length,
      rate: prospective.length ? Number((agreed.length / prospective.length).toFixed(4)) : null,
      byDivergence: countBy(prospective, (row) => row.divergence?.divergence ?? row.comparison?.divergence),
    };
    out.divergences = {
      investigations: prospective.filter((row) => row.divergence?.investigation === true).length,
      forcedWaitInconclusive: prospective.filter((row) => row.divergence?.investigation === true && row.final_action === "WAIT").length,
      directionFlipForbidden: prospective.filter((row) => row.divergence?.directionFlipForbidden === true).length,
      reasonsForWait: prospective.reduce((acc, row) => { for (const reason of row.reasons_for_wait ?? []) acc[reason] = (acc[reason] ?? 0) + 1; return acc; }, {}),
    };
    out.distributions = {
      traderScenario: countBy(prospective, (row) => row.trader_scenario?.primaryScenario),
      criticScenario: countBy(prospective, (row) => row.critic_scenario?.primaryScenario),
      finalAction: countBy(prospective, (row) => row.final_action),
      marketType: countBy(rows, (row) => row.market_type),
    };
    out.persistence = {
      scenarioChanged: prospective.filter((row) => row.scenario_changed === true).length,
      changeCountTotal: prospective.reduce((sum, row) => sum + (Number(row.scenario_change_count) || 0), 0),
      playbookChangedCandidateToEntry: prospective.filter((row) => row.playbook_at_candidate && row.playbook_at_entry && row.playbook_at_candidate !== row.playbook_at_entry).length,
      cancelledByScenario: prospective.filter((row) => row.scenario_decision?.cancelled === true).length,
      stageCompleteness: {
        candidate: prospective.filter((row) => row.scenario_at_candidate).length,
        revalidation1: prospective.filter((row) => row.scenario_at_revalidation1).length,
        revalidation2: prospective.filter((row) => row.scenario_at_revalidation2).length,
        finalEntry: prospective.filter((row) => row.scenario_at_final_entry).length,
      },
      settlementBases: Object.fromEntries(SETTLEMENT_BASES.map((basis) => [basis, rows.filter((row) => row.settlement_basis === basis).length])),
    };
    out.observations = rows.map((row) => ({
      observationId: row.observation_id, marketKey: row.market_key, marketType: row.market_type,
      scenarioPolicyVersion: row.scenario_policy_version, currentPolicyVersion: row.current_policy_version, timingPolicyVersion: row.timing_policy_version,
      candidateId: row.candidate_id, correlationId: row.correlation_id, direction: row.direction, payout: row.payout,
      candidateAt: fromDbMs(row.candidate_at), finalEntryAt: fromDbMs(row.final_entry_at), targetEntryAt: fromDbMs(row.target_entry_at), targetExpiryAt: fromDbMs(row.target_expiry_at),
      currentDecision: row.current_decision ?? null, scenarioDecision: row.scenario_decision ?? null,
      traderScenario: row.trader_scenario ?? null, criticScenario: row.critic_scenario ?? null,
      criticFreeze: row.critic_freeze ? { frozenHash: row.critic_freeze.frozenHash ?? null, frozenAt: row.critic_freeze.frozenAt ?? null, criticSawTraderConclusion: row.critic_freeze.criticSawTraderConclusion ?? null } : null,
      agreement: row.agreement === true, divergence: row.divergence ?? null,
      persistence: {
        scenarioAtCandidate: row.scenario_at_candidate, scenarioAtRevalidation1: row.scenario_at_revalidation1,
        scenarioAtRevalidation2: row.scenario_at_revalidation2, scenarioAtFinalEntry: row.scenario_at_final_entry,
        scenarioChanged: row.scenario_changed === true, scenarioChangeCount: row.scenario_change_count,
        playbookAtCandidate: row.playbook_at_candidate, playbookAtEntry: row.playbook_at_entry,
        transitions: row.persistence?.transitions ?? [],
      },
      finalAction: row.final_action, reasonsForWait: row.reasons_for_wait ?? [],
      t0Integrity: row.t0_integrity ?? null,
      outcome: row.outcome ?? null, settlementBasis: row.settlement_basis ?? null,
    }));
    out.sampleSize = { checkpointN: CHECKPOINT_N, prospective: prospective.length, reachedCheckpoint: prospective.length >= CHECKPOINT_N };
  } catch (error) {
    out.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 1500));
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(JSON.stringify({ ok: out.errors.length === 0, outPath: OUT, totals: out.totals, sections: out.sections, critic: out.critic, agreement: out.agreement, persistence: out.persistence, errors: out.errors }, null, 1));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
