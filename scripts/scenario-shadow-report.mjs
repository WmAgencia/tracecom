#!/usr/bin/env node
/**
 * SCENARIO SHADOW CHECKPOINT REPORT (read-only) — observacoes do Critic independente / engine de
 * cenarios V3 (migration 031/032), separando SEMPRE:
 *
 *   BROKER_EXECUTED (trades reais) != COUNTERFACTUAL (resultado teorico) != PROSPECTIVE (observacao)
 *   e nunca somando PnL/WR entre eles.
 *
 * Regras:
 *  - read-only (nenhuma escrita, nenhuma ordem);
 *  - observacao INVALIDA (feed stale, T0 ausente, clock inconsistente, marketKey ambiguo,
 *    NORMAL/OTC mismatch, settlement incerto, restart sem associacao, feature critica indisponivel)
 *    NAO entra nas metricas principais; continua persistida e e contada como descartada;
 *  - checkpoints disparam em N=30, 60, 100 e a cada +100 (N=30 e exploratorio; sem promocao automatica);
 *  - nenhum edge e concluido por WR alto em N pequeno.
 *
 * Saida default: docs/research/data/scenario-shadow-report.json (use `--out` para outro caminho).
 * Use `--include-observations` para anexar as observacoes cruas (arquivo grande; diagnostico).
 * Uso:
 *   railway run --service tracecom-live-relay --environment production -- node scripts/scenario-shadow-report.mjs
 *   DATABASE_URL=... node scripts/scenario-shadow-report.mjs [--since ISO] [--out caminho] [--include-observations]
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SCENARIO_ENGINE_V3_SHADOW, CURRENT_G2, SETTLEMENT_BASES, playbookOf } from "../relay/scenario-shadow.mjs";
import { TIMING_POLICY_CURRENT, TIMING_POLICY_LATE } from "../relay/late-window-timing.mjs";
import { SCENARIOS, PLAYBOOK_DEFINITIONS } from "../relay/scenario-engine.mjs";
import { parseMarketKey, wilsonInterval } from "../relay/shadow-lab.mjs";
import {
  assessScenarioObservationQuality, partitionObservationsByQuality, summarizeInvalidReasons,
  OBSERVATION_QUALITY_VERSION,
} from "../relay/scenario-observation-quality.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "relay", "package.json"));
let Pool = null;
try { ({ Pool } = require("pg")); } catch { Pool = null; }

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index > -1 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

export const REPORT_SCHEMA = "scenario-shadow-checkpoint-report-v2";
export const CHECKPOINT_BASE_THRESHOLDS = Object.freeze([30, 60, 100]);
export const CHECKPOINT_STEP = 100;
export const QUALITY_VERSION = OBSERVATION_QUALITY_VERSION;
const ACTIONS = Object.freeze(["BUY", "SELL", "WAIT"]);
const DECIDED = Object.freeze(["WIN", "LOSS", "DRAW"]);
const SCENARIO_ORDER = Object.freeze(Object.values(SCENARIOS));
const PLAYBOOK_ORDER = Object.freeze(Object.values(PLAYBOOK_DEFINITIONS).map((definition) => definition.id));

/** Limiar de checkpoint: N=30, 60, 100 e a cada +100 (200, 300, ...). Sem promocao automatica. */
export function checkpointThresholds(reachedN) {
  const n = Math.max(0, Math.floor(Number(reachedN) || 0));
  const thresholds = CHECKPOINT_BASE_THRESHOLDS.filter((threshold) => threshold <= n);
  for (let threshold = 200; threshold <= n; threshold += CHECKPOINT_STEP) thresholds.push(threshold);
  return thresholds;
}

export function nextCheckpoint(n) {
  const value = Math.max(0, Math.floor(Number(n) || 0));
  if (value < 30) return 30;
  if (value < 60) return 60;
  if (value < 100) return 100;
  return Math.floor(value / CHECKPOINT_STEP) * CHECKPOINT_STEP + CHECKPOINT_STEP;
}

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const rate = (count, total) => (total > 0 ? round(count / total) : null);
const countBy = (rows, pick) => rows.reduce((acc, row) => { const key = pick(row) ?? "UNSPECIFIED"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
const fromDbMs = (value) => (value === null || value === undefined ? null : value instanceof Date ? value.getTime() : Date.parse(value));
const isTrade = (action) => action === "BUY" || action === "SELL";

export function mapObservationRow(row = {}) {
  return {
    id: row.observation_id,
    version: row.version,
    provenance: row.provenance ?? "PROSPECTIVE",
    scenarioPolicyVersion: row.scenario_policy_version,
    scenarioEngineVersion: row.scenario_engine_version,
    currentPolicyVersion: row.current_policy_version,
    timingPolicyVersion: row.timing_policy_version,
    marketKey: row.market_key,
    marketType: row.market_type,
    candidateId: row.candidate_id,
    correlationId: row.correlation_id,
    executionId: row.execution_id,
    tradeId: row.trade_id,
    candidateAt: fromDbMs(row.candidate_at),
    decisionAt: fromDbMs(row.decision_at),
    jitAt: fromDbMs(row.jit_at),
    finalEntryAt: fromDbMs(row.final_entry_at),
    targetEntryAt: fromDbMs(row.target_entry_at),
    targetExpiryAt: fromDbMs(row.target_expiry_at),
    direction: row.direction,
    payout: num(row.payout),
    currentDecision: row.current_decision ?? null,
    scenarioDecision: row.scenario_decision ?? null,
    traderScenario: row.trader_scenario ?? null,
    criticScenario: row.critic_scenario ?? null,
    criticFreeze: row.critic_freeze ?? null,
    comparison: row.comparison ?? null,
    agreement: row.agreement === true,
    divergence: row.divergence ?? null,
    persistence: row.persistence ?? null,
    scenarioAtCandidate: row.scenario_at_candidate ?? null,
    scenarioAtRevalidation1: row.scenario_at_revalidation1 ?? null,
    scenarioAtRevalidation2: row.scenario_at_revalidation2 ?? null,
    scenarioAtFinalEntry: row.scenario_at_final_entry ?? null,
    scenarioChanged: row.scenario_changed === true,
    scenarioChangeCount: row.scenario_change_count ?? 0,
    playbookAtCandidate: row.playbook_at_candidate ?? null,
    playbookAtEntry: row.playbook_at_entry ?? null,
    finalAction: row.final_action ?? null,
    reasonsForWait: row.reasons_for_wait ?? [],
    t0: row.t0 ?? null,
    t0Integrity: row.t0_integrity ?? null,
    engineInfo: row.engine_info ?? null,
    outcome: row.outcome ?? null,
    settlementBasis: row.settlement_basis ?? null,
    brokerResult: row.broker_result ?? null,
    brokerProfit: num(row.broker_profit),
    theoreticalResult: row.theoretical_result ?? null,
    theoreticalPnl: num(row.theoretical_pnl),
    createdAt: fromDbMs(row.created_at),
    persistState: "LOADED",
  };
}

const actionOf = (row) => {
  const action = row.finalAction ?? row.scenarioDecision?.action ?? null;
  return ACTIONS.includes(action) ? action : null;
};
const g2ActionOf = (row) => {
  const action = row.currentDecision?.action ?? null;
  return ACTIONS.includes(action) ? action : null;
};
const resultOf = (row) => row.outcome?.result ?? null;
const isSettled = (row) => DECIDED.includes(resultOf(row));
const pnlOf = (row) => num(row.outcome?.normalizedPnl) ?? 0;
const timeOf = (row) => num(row.outcome?.at) ?? num(row.createdAt) ?? 0;
const scenarioOf = (row) => row.traderScenario?.primaryScenario ?? null;
const criticScenarioOf = (row) => row.criticScenario?.primaryScenario ?? null;
const playbookOfRow = (row) => row.playbookAtCandidate ?? playbookOf(row.traderScenario) ?? null;

function outcomeSummary(rows = []) {
  const settled = rows.filter(isSettled);
  const wins = settled.filter((row) => resultOf(row) === "WIN").length;
  const losses = settled.filter((row) => resultOf(row) === "LOSS").length;
  const draws = settled.filter((row) => resultOf(row) === "DRAW").length;
  const pnl = settled.reduce((sum, row) => sum + pnlOf(row), 0);
  const payouts = settled.map((row) => num(row.payout)).filter((value) => value !== null);
  const ordered = [...settled].sort((a, b) => timeOf(a) - timeOf(b));
  let maxLossStreak = 0;
  let streak = 0;
  for (const row of ordered) {
    if (resultOf(row) === "LOSS") { streak += 1; maxLossStreak = Math.max(maxLossStreak, streak); } else { streak = 0; }
  }
  return {
    settled: settled.length, wins, losses, draws,
    wr: settled.length ? round(wins / settled.length) : null,
    ci95: wilsonInterval(wins, settled.length),
    expectancyPerTrade: settled.length ? round(pnl / settled.length) : null,
    normalizedPnl: round(pnl),
    avgPayout: payouts.length ? round(payouts.reduce((sum, value) => sum + value, 0) / payouts.length, 2) : null,
    maxLossStreak,
  };
}

/** Outcomes NUNCA misturados: um bloco por settlement_basis; sem basis fica em UNSPECIFIED. */
export function separatedOutcomes(rows = []) {
  const byBasis = {
    BROKER_EXECUTED: outcomeSummary(rows.filter((row) => row.settlementBasis === "BROKER_EXECUTED")),
    CAUSAL_COUNTERFACTUAL: outcomeSummary(rows.filter((row) => row.settlementBasis === "CAUSAL_COUNTERFACTUAL")),
    UNSPECIFIED: outcomeSummary(rows.filter((row) => !SETTLEMENT_BASES.includes(row.settlementBasis))),
  };
  return {
    policy: "NUNCA_SOMAR_BROKER_EXECUTED_COUNTERFACTUAL_UNSPECIFIED",
    byBasis,
    coverage: rows.length ? round(rows.filter(isSettled).length / rows.length) : null,
  };
}

function actionDistribution(rows = []) {
  const counts = countBy(rows, actionOf);
  const total = rows.filter((row) => actionOf(row) !== null).length;
  return {
    n: total,
    actions: { BUY: counts.BUY ?? 0, SELL: counts.SELL ?? 0, WAIT: counts.WAIT ?? 0 },
    waitRate: rate(counts.WAIT ?? 0, total),
  };
}

export function computeG2VsV3(rows = []) {
  const comparable = rows.filter((row) => g2ActionOf(row) !== null && actionOf(row) !== null);
  let agreed = 0;
  let g2TradeV3Wait = 0;
  let g2WaitV3Trade = 0;
  let bothTradeSameDirection = 0;
  let bothTradeDifferentDirection = 0;
  let bothWait = 0;
  for (const row of comparable) {
    const g2 = g2ActionOf(row);
    const v3 = actionOf(row);
    if (g2 === v3) agreed += 1;
    if (isTrade(g2) && v3 === "WAIT") g2TradeV3Wait += 1;
    if (g2 === "WAIT" && isTrade(v3)) g2WaitV3Trade += 1;
    if (isTrade(g2) && isTrade(v3)) { if (g2 === v3) bothTradeSameDirection += 1; else bothTradeDifferentDirection += 1; }
    if (g2 === "WAIT" && v3 === "WAIT") bothWait += 1;
  }
  return {
    n: comparable.length,
    agreed,
    agreementRate: rate(agreed, comparable.length),
    ci95: wilsonInterval(agreed, comparable.length),
    g2TradeV3Wait,
    g2WaitV3Trade,
    bothTradeSameDirection,
    bothTradeDifferentDirection,
    bothWait,
    note: "CURRENT_G2 (producao, intocado) x V3 (shadow). Divergencia e dado observacional; o V3 nunca vota.",
  };
}

function bucketStats(rows = []) {
  const distribution = actionDistribution(rows);
  return {
    n: rows.length,
    actions: distribution.actions,
    waitRate: distribution.waitRate,
    coverage: rows.length ? rate(rows.filter(isSettled).length, rows.length) : null,
    outcomes: separatedOutcomes(rows),
  };
}

export function computeTraderVsCritic(rows = []) {
  const comparable = rows.filter((row) => scenarioOf(row) !== null && criticScenarioOf(row) !== null);
  const scenarioAgreed = comparable.filter((row) => scenarioOf(row) === criticScenarioOf(row)).length;
  const actionComparable = rows.filter((row) => row.traderScenario?.action && row.criticScenario?.action);
  const actionAgreed = actionComparable.filter((row) => row.traderScenario.action === row.criticScenario.action).length;
  const matrix = {};
  for (const row of comparable) {
    const key = `${scenarioOf(row)} × ${criticScenarioOf(row)}`;
    if (!matrix[key]) matrix[key] = { traderScenario: scenarioOf(row), criticScenario: criticScenarioOf(row), n: 0, finalAction: { BUY: 0, SELL: 0, WAIT: 0 }, outcomes: null, waitRate: null, rows: [] };
    const cell = matrix[key];
    cell.n += 1;
    const action = actionOf(row);
    if (action) cell.finalAction[action] += 1;
    cell.rows.push(row);
  }
  const orderedKeys = Object.keys(matrix).sort((a, b) => {
    const indexA = SCENARIO_ORDER.indexOf(matrix[a].traderScenario);
    const indexB = SCENARIO_ORDER.indexOf(matrix[b].traderScenario);
    return indexA - indexB || SCENARIO_ORDER.indexOf(matrix[a].criticScenario) - SCENARIO_ORDER.indexOf(matrix[b].criticScenario);
  });
  const orderedMatrix = {};
  for (const key of orderedKeys) {
    const cell = matrix[key];
    const wait = cell.finalAction.WAIT;
    orderedMatrix[key] = {
      traderScenario: cell.traderScenario,
      criticScenario: cell.criticScenario,
      n: cell.n,
      finalAction: cell.finalAction,
      waitRate: rate(wait, cell.n),
      outcomes: separatedOutcomes(cell.rows),
    };
  }
  return {
    n: comparable.length,
    scenarioAgreementRate: rate(scenarioAgreed, comparable.length),
    scenarioAgreementCi95: wilsonInterval(scenarioAgreed, comparable.length),
    actionN: actionComparable.length,
    actionAgreementRate: rate(actionAgreed, actionComparable.length),
    actionAgreementCi95: wilsonInterval(actionAgreed, actionComparable.length),
    matrix: orderedMatrix,
    note: "Matriz TraderScenario x CriticScenario com finalAction, outcome posterior (por basis) e WAIT rate.",
  };
}

export const STABILITY_CLASSES = Object.freeze(["STABLE_SCENARIO", "SCENARIO_CHANGED", "MULTIPLE_CHANGES"]);

export function classifyStability(row = {}) {
  const changeCount = Number(row.persistence?.scenarioChangeCount ?? row.scenarioChangeCount ?? 0) || 0;
  const changed = row.persistence?.scenarioChanged === true || row.scenarioChanged === true || changeCount > 0;
  if (changeCount >= 2) return "MULTIPLE_CHANGES";
  if (changed) return "SCENARIO_CHANGED";
  return "STABLE_SCENARIO";
}

export function computeStability(rows = []) {
  const blocks = {};
  for (const klass of STABILITY_CLASSES) {
    const bucket = rows.filter((row) => classifyStability(row) === klass);
    const stats = bucketStats(bucket);
    blocks[klass] = {
      n: stats.n,
      waitRate: stats.waitRate,
      coverage: stats.coverage,
      outcomes: stats.outcomes,
      changeCountTotal: bucket.reduce((sum, row) => sum + (Number(row.persistence?.scenarioChangeCount ?? row.scenarioChangeCount ?? 0) || 0), 0),
    };
  }
  return { classes: blocks, note: "STABLE/CHANGED/MULTIPLE nunca somados entre si." };
}

export function computeLateWindow(rows = [], intersectionsByCandidate = new Map()) {
  const matched = rows.filter((row) => {
    const intersection = row.candidateId ? intersectionsByCandidate.get(row.candidateId) : null;
    return intersection?.lateOutcome === "LATE_ACCEPT" || intersection?.lateOutcome === "LATE_CANCEL";
  });
  const matrix = { BUY: { ACCEPT: 0, CANCEL: 0 }, SELL: { ACCEPT: 0, CANCEL: 0 }, WAIT: { ACCEPT: 0, CANCEL: 0 } };
  const quadrants = { ENTRY_LATE_ACCEPT: 0, ENTRY_LATE_CANCEL: 0, WAIT_LATE_ACCEPT: 0, WAIT_LATE_CANCEL: 0 };
  for (const row of matched) {
    const action = actionOf(row);
    const intersection = intersectionsByCandidate.get(row.candidateId);
    const verdict = intersection.lateOutcome === "LATE_ACCEPT" ? "ACCEPT" : "CANCEL";
    if (!action || !(action in matrix)) continue;
    matrix[action][verdict] += 1;
    if (action === "WAIT") quadrants[`WAIT_LATE_${verdict}`] += 1;
    else quadrants[`ENTRY_LATE_${verdict}`] += 1;
  }
  const totalCancel = matrix.BUY.CANCEL + matrix.SELL.CANCEL + matrix.WAIT.CANCEL;
  return {
    matched: matched.length,
    matrix,
    quadrants,
    cancelRate: rate(totalCancel, matched.length),
    unmatched: rows.length - matched.length,
    note: "V3 x LATE_WINDOW_V2 observacional; ACCEPT/CANCEL vem da interseccao (nunca controle).",
  };
}

export function computePlaybooks(rows = []) {
  const byPlaybook = {};
  for (const playbookId of PLAYBOOK_ORDER) {
    const bucket = rows.filter((row) => playbookOfRow(row) === playbookId);
    const distribution = actionDistribution(bucket);
    const stats = bucketStats(bucket);
    const reasonCounts = {};
    for (const row of bucket) {
      const reasons = [
        ...(Array.isArray(row.traderScenario?.invalidationReasons) ? row.traderScenario.invalidationReasons : []),
        ...(Array.isArray(row.reasonsForWait) ? row.reasonsForWait : []),
      ];
      for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    byPlaybook[playbookId] = {
      n: bucket.length,
      actions: distribution.actions,
      waitRate: distribution.waitRate,
      coverage: stats.coverage,
      outcomes: stats.outcomes,
      topInvalidationReasons: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([reason, count]) => ({ reason, count })),
    };
  }
  return byPlaybook;
}

function computeByMarketType(rows = []) {
  const types = ["NORMAL", "OTC"];
  const byMarketType = {};
  for (const type of types) byMarketType[type] = bucketStats(rows.filter((row) => row.marketType === type));
  byMarketType.UNSPECIFIED = bucketStats(rows.filter((row) => !types.includes(row.marketType)));
  return byMarketType;
}

function computeByAsset(rows = []) {
  const buckets = {};
  for (const row of rows) {
    const canonical = parseMarketKey(row.marketKey).canonical ?? "UNSPECIFIED";
    if (!buckets[canonical]) buckets[canonical] = [];
    buckets[canonical].push(row);
  }
  return Object.entries(buckets)
    .map(([asset, bucket]) => ({ asset, ...bucketStats(bucket), n: bucket.length }))
    .sort((a, b) => b.n - a.n || a.asset.localeCompare(b.asset))
    .slice(0, 50);
}

function computeByHourUtc(rows = []) {
  const buckets = new Map();
  for (const row of rows) {
    const at = num(row.candidateAt) ?? num(row.createdAt);
    if (at === null) continue;
    const hour = new Date(at).getUTCHours();
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(row);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([hour, bucket]) => ({ hourUtc: hour, ...bucketStats(bucket) }));
}

function computeByRegime(rows = []) {
  const buckets = {};
  for (const row of rows) {
    const regime = row.traderScenario?.marketRegime ?? "UNSPECIFIED";
    if (!buckets[regime]) buckets[regime] = [];
    buckets[regime].push(row);
  }
  return Object.fromEntries(Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0])).map(([regime, bucket]) => [regime, bucketStats(bucket)]));
}

/**
 * Bloco de metricas de um conjunto de observacoes. Metricas principais SEMPRE excluem observacao
 * invalida (que fica em `quality.discarded`). WR/PnL ficam separados por settlement basis.
 */
export function computeMetricBlock(rows = [], { intersectionsByCandidate = new Map(), limit = null } = {}) {
  const quality = partitionObservationsByQuality(rows);
  const valid = limit === null ? quality.valid : quality.valid.slice(0, limit);
  const distribution = actionDistribution(valid);
  const scenarioChanged = valid.filter((row) => classifyStability(row) !== "STABLE_SCENARIO").length;
  const disagreement = valid.filter((row) => row.agreement === false).length;
  return {
    n: rows.length,
    nValid: quality.valid.length,
    nInvalid: quality.invalid.length,
    discarded: quality.discarded,
    invalidReasons: quality.invalidReasons,
    direction: distribution,
    scenarioDistribution: countBy(valid, (row) => scenarioOf(row)),
    criticScenarioDistribution: countBy(valid, (row) => criticScenarioOf(row)),
    g2VsV3: computeG2VsV3(valid),
    traderVsCritic: computeTraderVsCritic(valid),
    stability: computeStability(valid),
    lateWindow: computeLateWindow(valid, intersectionsByCandidate),
    playbooks: computePlaybooks(valid),
    marketType: computeByMarketType(valid),
    byAsset: computeByAsset(valid),
    byHourUtc: computeByHourUtc(valid),
    byRegime: computeByRegime(valid),
    outcomes: separatedOutcomes(valid),
    rates: {
      waitRate: distribution.waitRate,
      scenarioChangeRate: rate(scenarioChanged, valid.length),
      disagreementRate: rate(disagreement, valid.length),
      lateWindowCancelRate: rate(
        valid.length ? valid.filter((row) => {
          const intersection = row.candidateId ? intersectionsByCandidate.get(row.candidateId) : null;
          return intersection?.lateOutcome === "LATE_CANCEL";
        }).length : 0,
        valid.length,
      ),
    },
    invalidDetail: summarizeInvalidReasons(rows),
  };
}

function separatedSection(rows = [], basis) {
  const list = rows.filter((row) => row.settlementBasis === basis);
  const quality = partitionObservationsByQuality(list);
  return {
    basis,
    observations: list.length,
    valid: quality.valid.length,
    discarded: quality.discarded,
    settled: list.filter(isSettled).length,
    summary: separatedOutcomes(quality.valid).byBasis[basis === "BROKER_EXECUTED" ? "BROKER_EXECUTED" : "CAUSAL_COUNTERFACTUAL"],
    metrics: computeMetricBlock(list),
  };
}

/** Relatorio completo (sem IO): totais, qualidade, secoes separadas, headline prospectivo e checkpoints. */
export function buildScenarioShadowReport({ rows = [], intersections = [], since = null, generatedAt = null } = {}) {
  const observations = rows.map((row) => (row && row.traderScenario !== undefined && row.id ? row : mapObservationRow(row)));
  const intersectionsByCandidate = new Map();
  for (const intersection of intersections) {
    if (intersection?.candidateId) intersectionsByCandidate.set(intersection.candidateId, intersection);
  }
  const quality = partitionObservationsByQuality(observations);
  const prospective = observations.filter((row) => (row.provenance ?? "PROSPECTIVE") === "PROSPECTIVE");
  const validProspective = prospective.filter((row) => assessScenarioObservationQuality(row).valid).sort((a, b) => (num(a.createdAt) ?? 0) - (num(b.createdAt) ?? 0));
  const thresholds = checkpointThresholds(validProspective.length);
  const checkpoints = thresholds.map((checkpointN) => ({
    checkpointN,
    exploratory: checkpointN === 30,
    promotion: "NONE",
    metrics: computeMetricBlock(validProspective.slice(0, checkpointN), { intersectionsByCandidate }),
  }));
  return {
    meta: {
      schema: REPORT_SCHEMA,
      generatedAt: generatedAt ?? new Date().toISOString(),
      since,
      policies: { scenario: SCENARIO_ENGINE_V3_SHADOW, current: CURRENT_G2, timing: TIMING_POLICY_LATE, currentTiming: TIMING_POLICY_CURRENT },
      source: "iq_scenario_shadow_observations + iq_scenario_timing_intersections (Postgres; read-only)",
      qualityVersion: OBSERVATION_QUALITY_VERSION,
      note: "SHADOW_ONLY: nunca envia ordem. BROKER_EXECUTED != COUNTERFACTUAL != PROSPECTIVE; nunca somados.",
    },
    totals: {
      observations: observations.length,
      prospective: prospective.length,
      valid: quality.valid.length,
      invalid: quality.invalid.length,
      discarded: quality.discarded,
      distinctMarkets: new Set(observations.map((row) => row.marketKey)).size,
      provenance: countBy(observations, (row) => row.provenance),
      settlementBases: Object.fromEntries(SETTLEMENT_BASES.map((basis) => [basis, observations.filter((row) => row.settlementBasis === basis).length])),
      series: Object.entries(countBy(observations, (row) => `${row.scenarioPolicyVersion}|${row.scenarioEngineVersion}|${row.timingPolicyVersion}`)).map(([key, count]) => ({ key, count })),
      scenarioPolicyVersions: [...new Set(observations.map((row) => row.scenarioPolicyVersion))],
      scenarioEngineVersions: [...new Set(observations.map((row) => row.scenarioEngineVersion))],
      timingPolicyVersions: [...new Set(observations.map((row) => row.timingPolicyVersion))],
    },
    quality: {
      version: OBSERVATION_QUALITY_VERSION,
      total: quality.total,
      valid: quality.valid.length,
      discarded: quality.discarded,
      invalidReasons: quality.invalidReasons,
      note: "Observacao invalida continua persistida e e contada como descartada; nunca entra nas metricas principais.",
    },
    sections: {
      BROKER_EXECUTED: separatedSection(observations, "BROKER_EXECUTED"),
      COUNTERFACTUAL: separatedSection(observations, "CAUSAL_COUNTERFACTUAL"),
      HISTORICAL: {
        observations: observations.filter((row) => row.provenance === "HISTORICAL").length,
        note: "Backfill/arquivo; nunca misturado com prospectivo.",
      },
      PROSPECTIVE: {
        observations: prospective.length,
        valid: validProspective.length,
        settled: prospective.filter(isSettled).length,
        pendingOutcome: prospective.filter((row) => !isSettled(row)).length,
        outcomes: separatedOutcomes(validProspective),
      },
    },
    headline: {
      scope: "PROSPECTIVE_VALID",
      n: validProspective.length,
      metrics: computeMetricBlock(validProspective, { intersectionsByCandidate }),
      note: "Metricas principais = observacoes PROSPECTIVE validas; invalidas descartadas; WR/PnL por basis.",
    },
    criticIndependence: {
      mode: "INDEPENDENT_TWO_PHASE",
      frozenBeforeTrader: validProspective.filter((row) => row.criticFreeze?.criticSawTraderConclusion === false).length,
      violations: validProspective.filter((row) => row.criticFreeze?.criticSawTraderConclusion !== false).length,
      engineModes: countBy(validProspective, (row) => row.engineInfo?.mode),
      degradedToFallback: countBy(validProspective, (row) => row.engineInfo?.mode === "FALLBACK"),
    },
    intersections: {
      total: intersections.length,
      matchedByCandidate: intersectionsByCandidate.size,
      byVerdict: countBy(intersections, (row) => row.verdict),
      byLateOutcome: countBy(intersections, (row) => row.lateOutcome),
    },
    checkpoints: {
      thresholdRule: "N=30, 60, 100 e a cada +100; N=30 exploratorio; sem promocao automatica",
      reached: thresholds,
      next: nextCheckpoint(validProspective.length),
      automaticPromotion: false,
      reports: checkpoints,
    },
    sampleSize: {
      prospective: prospective.length,
      validProspective: validProspective.length,
      reachedCheckpoint: validProspective.length >= 30,
      nextCheckpoint: nextCheckpoint(validProspective.length),
    },
  };
}

/** Compat: secoes por provenance/basis (nunca somando contrafactual ao broker). */
export function scenarioShadowSections(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const broker = list.filter((row) => row.settlementBasis === "BROKER_EXECUTED");
  const counterfactual = list.filter((row) => row.settlementBasis === "CAUSAL_COUNTERFACTUAL");
  const historical = list.filter((row) => row.provenance === "HISTORICAL");
  const prospective = list.filter((row) => (row.provenance ?? "PROSPECTIVE") === "PROSPECTIVE");
  return {
    BROKER_EXECUTED: { rows: broker.length, summary: outcomeSummary(broker) },
    COUNTERFACTUAL: { rows: counterfactual.length, summary: outcomeSummary(counterfactual) },
    HISTORICAL: { rows: historical.length, summary: outcomeSummary(historical) },
    PROSPECTIVE: { rows: prospective.length, settled: prospective.filter(isSettled).length, summary: outcomeSummary(prospective) },
  };
}

async function main() {
  const SINCE = arg("--since", new Date(Date.now() - 14 * 24 * 3_600_000).toISOString());
  const OUT = arg("--out", path.join("docs", "research", "data", "scenario-shadow-report.json"));
  const includeObservations = flag("--include-observations");
  const out = {
    errors: [],
    warnings: [],
    totals: null,
    quality: null,
    sections: null,
    headline: null,
    checkpoints: null,
  };
  if (!Pool) { out.errors.push("pg indisponivel: instale as dependencias do relay para rodar o relatorio."); }
  let pool = null;
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const rows = (await pool.query(
      `SELECT observation_id, version, scenario_policy_version, scenario_engine_version, current_policy_version, timing_policy_version, provenance,
              market_key, market_type, candidate_id, correlation_id, execution_id, trade_id, candidate_at, decision_at, final_entry_at, target_entry_at, target_expiry_at, direction, payout,
              current_decision, scenario_decision, trader_scenario, critic_scenario, critic_freeze, comparison, agreement, divergence, persistence,
              scenario_at_candidate, scenario_at_revalidation1, scenario_at_revalidation2, scenario_at_final_entry,
              scenario_changed, scenario_change_count, playbook_at_candidate, playbook_at_entry,
              final_action, reasons_for_wait, t0, t0_integrity, engine_info, outcome, settlement_basis,
              broker_result, broker_profit, theoretical_result, theoretical_pnl, created_at
         FROM iq_scenario_shadow_observations WHERE created_at >= $1 ORDER BY created_at`,
      [SINCE],
    )).rows;
    let intersections = [];
    try {
      intersections = (await pool.query(
        `SELECT intersection_id, market_key, market_type, candidate_id, correlation_id, execution_id, scenario_observation_id, timing_observation_id,
                scenario_policy_version, scenario_engine_version, timing_policy_version, scenario_final_action, late_deadline_at, late_outcome,
                late_verdict, late_valid_at_deadline, verdict, direction_agreement, intersection_codes, created_at
           FROM iq_scenario_timing_intersections WHERE created_at >= $1 ORDER BY created_at`,
        [SINCE],
      )).rows.map((row) => ({
        intersectionId: row.intersection_id, marketKey: row.market_key, marketType: row.market_type,
        candidateId: row.candidate_id, correlationId: row.correlation_id, executionId: row.execution_id,
        scenarioObservationId: row.scenario_observation_id, timingObservationId: row.timing_observation_id,
        scenarioPolicyVersion: row.scenario_policy_version, scenarioEngineVersion: row.scenario_engine_version,
        timingPolicyVersion: row.timing_policy_version, scenarioFinalAction: row.scenario_final_action,
        lateDeadlineAt: fromDbMs(row.late_deadline_at), lateOutcome: row.late_outcome, lateVerdict: row.late_verdict,
        lateValidAtDeadline: row.late_valid_at_deadline, verdict: row.verdict, directionAgreement: row.direction_agreement,
        intersectionCodes: row.intersection_codes ?? [], createdAt: fromDbMs(row.created_at),
      }));
    } catch (error) {
      out.warnings.push(`intersections indisponiveis: ${String(error?.message ?? error).slice(0, 200)}`);
    }
    const report = buildScenarioShadowReport({ rows, intersections, since: SINCE });
    out.meta = report.meta;
    out.totals = report.totals;
    out.quality = report.quality;
    out.sections = report.sections;
    out.headline = report.headline;
    out.critic = report.criticIndependence;
    out.intersections = report.intersections;
    out.checkpoints = report.checkpoints;
    out.sampleSize = report.sampleSize;
    if (includeObservations) out.observations = rows;
  } catch (error) {
    out.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 1500));
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(JSON.stringify({
    ok: out.errors.length === 0,
    outPath: OUT,
    warnings: out.warnings,
    totals: out.totals,
    quality: out.quality,
    headline: out.headline ? { scope: out.headline.scope, n: out.headline.n, rates: out.headline.metrics?.rates, g2VsV3: out.headline.metrics?.g2VsV3 } : null,
    checkpoints: out.checkpoints ? { reached: out.checkpoints.reached, next: out.checkpoints.next, promotion: out.checkpoints.promotion } : null,
    sampleSize: out.sampleSize,
    errors: out.errors,
  }, null, 1));
  if (pool) { await new Promise((resolve) => setTimeout(resolve, 250)); await pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
