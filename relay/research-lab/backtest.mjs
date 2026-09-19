/**
 * BACKTEST LAB — motor para opcoes binarias 60s (sem fingir OHLC PnL de position trading).
 *
 * Alvo: WIN/LOSS/DRAW pela mecanica real (entry time/price, expiry time/price, direction, payout).
 * Execution model: candidate time -> latency -> JIT revalidation -> cutoff -> expiry -> displacement.
 * Payout: usa valor real conhecido; se ausente -> UNKNOWN (nunca inventa payout historico).
 * Validation: point-in-time replay, walk-forward, purged k-fold + embargo, CPCV, holdout, bootstrap,
 * Monte Carlo de sequencia. Cada modo declara quando e valido.
 */
import { buildSnapshotMeta } from "./snapshot.mjs";
import { wilsonInterval, expectancy, normalizedPnl, maxDrawdown, maxLossStreak, bootstrapResults, monteCarloSequence, mean, stdev } from "./math.mjs";

export const BACKTEST_ENGINE_VERSION = "binary-options-backtest-v1";

export const PAYOUT_POLICY = Object.freeze({
  knownPayoutUsed: true, unknownMarked: true, hypotheticalRequiresFlag: true, neverInventHistorical: true,
});

export function resolvePayout({ payout = null, hypotheticalPayout = null, allowHypothetical = false } = {}) {
  const known = Number(payout);
  if (Number.isFinite(known) && known > 0) return { payout: known, payoutSource: "KNOWN", hypothetical: false };
  if (allowHypothetical && Number.isFinite(Number(hypotheticalPayout)) && Number(hypotheticalPayout) > 0) return { payout: Number(hypotheticalPayout), payoutSource: "HYPOTHETICAL", hypothetical: true };
  return { payout: null, payoutSource: "UNKNOWN", hypothetical: false };
}

/** Mecanica binaria pura. entry/expiry prices devem vir de candles causais (bucketStart <= alvo). */
export function settleBinaryOutcome({ direction = null, entryPrice = null, expiryPrice = null } = {}) {
  const entry = Number(entryPrice), expiry = Number(expiryPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(expiry)) return "UNKNOWN";
  if (expiry === entry) return "DRAW";
  if (direction === "BUY") return expiry > entry ? "WIN" : "LOSS";
  if (direction === "SELL") return expiry < entry ? "WIN" : "LOSS";
  return "UNKNOWN";
}

/**
 * Execution model: decide no candidato (t0), observa revalidacao JIT, respeita cutoff e margem.
 * `lateWindow` e read-only: o backtest pode MODELAR que a entrada ocorre na janela tardia, sem tocar no V2.
 */
export function simulateExecution({
  candidateAt, latencyMs = 800, jitLeadMs = 1500, cutoffMarginMs = 1000, targetEntryAt, targetExpiryAt,
  lateWindow = false, lateMarginMs = 1500,
} = {}) {
  const entryTarget = Number(targetEntryAt), expiry = Number(targetExpiryAt);
  const jitDecisionAt = entryTarget - latencyMs - jitLeadMs;
  const cutoff = expiry - cutoffMarginMs;
  const lateEntryAt = lateWindow ? cutoff - lateMarginMs - latencyMs : null;
  const entryAt = lateEntryAt !== null ? lateEntryAt : entryTarget;
  const valid = Number.isFinite(entryAt) && entryAt + latencyMs <= cutoff;
  return {
    candidateAt, jitDecisionAt, entryAt, entryEvidenceAt: entryAt + latencyMs, expiryAt: expiry, cutoff,
    lateWindow, valid, reason: valid ? (lateWindow ? "LATE_WINDOW_ENTRY" : "JIT_ENTRY") : "CUTOFF_WOULD_BE_VIOLATED",
    modelNote: "Entrada impossivel (apos cutoff) nao e executada: a observacao e marcada INVALID_EXECUTION.",
  };
}

function priceAt(candles = [], atMs) {
  const list = (Array.isArray(candles) ? candles : []).filter((candle) => Number.isFinite(Number(candle?.bucketStart)) && Number.isFinite(Number(candle?.close))).sort((a, b) => a.bucketStart - b.bucketStart);
  const found = [...list].reverse().find((candle) => Number(candle.bucketStart) <= Number(atMs));
  return found ? Number(found.close) : null;
}

/** Roda um backtest sobre oportunidades point-in-time (cada row ja carrega T0/candles e alvo). */
export function runBinaryBacktest({ rows = [], marketKey = null, strategyVersion = null, datasetVersion = null, source = "PROSPECTIVE_SHADOW", payoutOptions = {}, executionOptions = {}, allowHypotheticalPayout = false } = {}) {
  const results = [];
  let invalidExecutions = 0, unknownPayout = 0, unknownOutcome = 0, hypothetical = 0;
  for (const row of rows) {
    const direction = row.direction ?? row.action ?? null;
    if (direction !== "BUY" && direction !== "SELL") { results.push({ ...row, skipped: "NO_DIRECTION" }); continue; }
    const execution = simulateExecution({ candidateAt: row.candidateAt ?? row.createdAt ?? row.at ?? null, targetEntryAt: row.targetEntryAt, targetExpiryAt: row.targetExpiryAt, ...executionOptions });
    if (execution.valid !== true) { invalidExecutions += 1; results.push({ ...row, execution, result: "INVALID_EXECUTION" }); continue; }
    const entryPrice = Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : priceAt(row.candles, execution.entryEvidenceAt);
    const expiryPrice = Number.isFinite(Number(row.expiryPrice)) ? Number(row.expiryPrice) : priceAt(row.candles, execution.expiryAt);
    const result = row.theoreticalResult && row.settlementBasis ? row.theoreticalResult : settleBinaryOutcome({ direction, entryPrice, expiryPrice });
    if (result === "UNKNOWN") unknownOutcome += 1;
    const payout = resolvePayout({ payout: row.payout ?? payoutOptions.payout ?? null, hypotheticalPayout: payoutOptions.hypotheticalPayout, allowHypothetical: allowHypotheticalPayout });
    if (payout.payoutSource === "UNKNOWN") unknownPayout += 1;
    if (payout.hypothetical) hypothetical += 1;
    results.push({ ...row, execution, entryPrice, expiryPrice, result, payout: payout.payout, payoutSource: payout.payoutSource });
  }
  return { results, metrics: summarizeBacktest(results), meta: buildExecutionMeta({ rows, results, marketKey, strategyVersion, datasetVersion, source, invalidExecutions, unknownPayout, unknownOutcome, hypothetical, payoutOptions }) };
}

export function summarizeBacktest(results = []) {
  const decided = results.filter((row) => row.result === "WIN" || row.result === "LOSS" || row.result === "DRAW");
  const wins = decided.filter((row) => row.result === "WIN").length;
  const losses = decided.filter((row) => row.result === "LOSS").length;
  const draws = decided.filter((row) => row.result === "DRAW").length;
  const pnls = decided.map((row) => normalizedPnl(row.result, row.payout));
  const payouts = decided.map((row) => Number(row.payout)).filter(Number.isFinite);
  return {
    n: results.length, decided: decided.length, wins, losses, draws,
    wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null,
    wrDecided: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
    ci95: wilsonInterval(wins, decided.length),
    expectancy: expectancy(wins, losses, draws, payouts.length ? mean(payouts) : null),
    normalizedPnl: Number(pnls.reduce((sum, value) => sum + value, 0).toFixed(4)),
    maxDrawdown: maxDrawdown(pnls),
    maxLossStreak: maxLossStreak(decided.map((row) => row.result)),
    avgPayout: payouts.length ? Number(mean(payouts).toFixed(4)) : null,
    payoutCoverage: decided.length ? Number((payouts.length / decided.length).toFixed(4)) : null,
    precisionWarning: decided.length < 30 ? `N=${decided.length} decididos: baixa precisao, sem headline de performance.` : null,
  };
}

function buildExecutionMeta({ rows, results, marketKey, strategyVersion, datasetVersion, source, invalidExecutions, unknownPayout, unknownOutcome, hypothetical, payoutOptions }) {
  const times = rows.map((row) => Number(row.targetExpiryAt ?? row.at ?? row.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    snapshot: buildSnapshotMeta({
      asOf: times.at(-1) ?? Date.now(), windowStart: times[0] ?? null, windowEnd: times.at(-1) ?? null,
      n: rows.length, source, datasetVersion, note: "Backtest binario point-in-time; settlement data e do proprio T0/observacao.",
    }),
    marketKey, strategyVersion,
    payoutPolicy: { ...PAYOUT_POLICY, requested: payoutOptions },
    execution: { invalidExecutions, rule: "entrada apos cutoff NAO e simulada como executavel" },
    coverage: { invalidExecutions, unknownPayout, unknownOutcome, hypotheticalPayoutRows: hypothetical, settledRows: results.filter((row) => row.result && row.result !== "INVALID_EXECUTION").length },
    researchOnly: true, controlsExecution: false,
  };
}

/* ------------------------------- validacao ------------------------------- */

export const VALIDATION_POLICY = Object.freeze({
  pointInTimeReplay: "Sempre valido: cada decisao usa somente dados com availableAt <= decisionAt.",
  walkForward: "Valido para series temporais com ordem causal; usado com janelas expansivas.",
  purgedKfold: "Valido quando ha sobreposicao temporal entre amostras (60s/5min); exige purge + embargo.",
  embargo: "Obrigatorio junto de k-fold/purged quando amostras proximas compartilham horizonte.",
  cpcv: "Combinatorial purged CV: multiplos caminhos de treino/teste; valido apenas com N suficiente por fold.",
  untouchedHoldout: "Valido uma unica vez, apos congelamento; nunca reutilizado para tuning.",
  bootstrap: "Valido para CI de WR/expectancy sob reamostragem; nao substitui holdout.",
  monteCarloSequence: "Valido para drawdown/streak sob reordenacao; nao muda WR.",
});

export function walkForward(rows = [], { folds = 4, embargoMs = 120_000, minTrain = 20 } = {}) {
  const ordered = [...rows].sort((a, b) => Number(a.targetExpiryAt ?? a.at ?? 0) - Number(b.targetExpiryAt ?? b.at ?? 0));
  const size = Math.floor(ordered.length / (folds + 1));
  const foldsOut = [];
  for (let fold = 1; fold <= folds; fold += 1) {
    const trainEnd = size * fold;
    const testStart = trainEnd;
    const testEnd = fold === folds ? ordered.length : Math.min(ordered.length, testStart + size);
    const train = ordered.slice(0, trainEnd).filter((row) => row.at === undefined || Number(row.at) <= Number(ordered[testStart]?.at ?? Infinity) - embargoMs);
    const test = ordered.slice(testStart, testEnd);
    foldsOut.push({ fold, trainN: train.length, testN: test.length, embargoMs, valid: train.length >= minTrain && test.length >= 5, metrics: summarizeBacktest(test) });
  }
  return { version: "walk-forward-v1", folds: foldsOut, policy: VALIDATION_POLICY.walkForward };
}

export function purgedKFold(rows = [], { folds = 5, embargoMs = 120_000, horizonOf = (row) => [Number(row.at ?? row.targetEntryAt ?? 0), Number(row.targetExpiryAt ?? 0)] } = {}) {
  const ordered = [...rows].sort((a, b) => Number(a.targetExpiryAt ?? a.at ?? 0) - Number(b.targetExpiryAt ?? b.at ?? 0));
  const size = Math.ceil(ordered.length / folds);
  const foldsOut = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const testStart = fold * size, testEnd = Math.min(ordered.length, testStart + size);
    const test = ordered.slice(testStart, testEnd);
    const testWindow = test.length ? [Math.min(...test.map((row) => horizonOf(row)[0])), Math.max(...test.map((row) => horizonOf(row)[1]))] : [0, 0];
    const train = ordered.filter((row, index) => {
      if (index >= testStart && index < testEnd) return false;
      const [start, end] = horizonOf(row);
      const overlaps = start <= testWindow[1] + embargoMs && end >= testWindow[0] - embargoMs;
      return !overlaps;
    });
    foldsOut.push({ fold, trainN: train.length, testN: test.length, purged: ordered.length - train.length - test.length, valid: train.length >= 10, metrics: summarizeBacktest(test) });
  }
  return { version: "purged-kfold-v1", folds: foldsOut, embargoMs, policy: `${VALIDATION_POLICY.purgedKfold} ${VALIDATION_POLICY.embargo}` };
}

export function cpcv(rows = [], { groups = 4, testGroups = 2, embargoMs = 120_000 } = {}) {
  const ordered = [...rows].sort((a, b) => Number(a.targetExpiryAt ?? a.at ?? 0) - Number(b.targetExpiryAt ?? b.at ?? 0));
  const size = Math.ceil(ordered.length / groups);
  const blocks = Array.from({ length: groups }, (_, index) => ordered.slice(index * size, (index + 1) * size));
  const combinations = [];
  const choose = (start, picked) => {
    if (picked.length === testGroups) { combinations.push([...picked]); return; }
    for (let index = start; index < groups; index += 1) { picked.push(index); choose(index + 1, picked); picked.pop(); }
  };
  choose(0, []);
  const paths = combinations.map((testIndexes) => {
    const test = testIndexes.flatMap((index) => blocks[index]);
    const testWindow = test.length ? [Math.min(...test.map((row) => Number(row.at ?? row.targetEntryAt ?? 0))), Math.max(...test.map((row) => Number(row.targetExpiryAt ?? 0)))] : [0, 0];
    const train = blocks.filter((_, index) => !testIndexes.includes(index)).flat().filter((row) => {
      const end = Number(row.targetExpiryAt ?? 0), start = Number(row.at ?? row.targetEntryAt ?? 0);
      return !(start <= testWindow[1] + embargoMs && end >= testWindow[0] - embargoMs);
    });
    return { testGroups: testIndexes, trainN: train.length, testN: test.length, metrics: summarizeBacktest(test) };
  });
  return { version: "cpcv-v1", paths, combinations: combinations.length, policy: VALIDATION_POLICY.cpcv };
}

export function untouchedHoldout(rows = [], { holdoutFraction = 0.2, seed = 11 } = {}) {
  const ordered = [...rows].sort((a, b) => Number(a.targetExpiryAt ?? a.at ?? 0) - Number(b.targetExpiryAt ?? b.at ?? 0));
  const cut = Math.max(1, Math.floor(ordered.length * (1 - holdoutFraction)));
  return {
    version: "holdout-v1", seed,
    development: summarizeBacktest(ordered.slice(0, cut)),
    holdout: summarizeBacktest(ordered.slice(cut)),
    policy: VALIDATION_POLICY.untouchedHoldout,
    note: "Holdout nao pode ser reutilizado para tuning; registre o uso no Experiment Registry.",
  };
}

export function bootstrapValidation(results = [], { payout = null, iterations = 1000, seed = 42 } = {}) {
  const outcomes = results.filter((row) => row.result === "WIN" || row.result === "LOSS" || row.result === "DRAW").map((row) => row.result);
  const payouts = results.map((row) => row.payout).filter(Number.isFinite);
  const effectivePayout = Number.isFinite(Number(payout)) ? Number(payout) : payouts.length ? mean(payouts) : null;
  return {
    version: "bootstrap-v1",
    wr: bootstrapResults(outcomes, { iterations, seed }),
    expectancy: bootstrapResults(outcomes, { iterations, seed: seed + 1, statistic: ({ wins, losses, draws, n }) => expectancy(wins, losses, draws, effectivePayout) / (n || 1) }),
    monteCarlo: monteCarloSequence(outcomes, { iterations: Math.floor(iterations / 2), seed: seed + 2, payout: effectivePayout }),
    policy: `${VALIDATION_POLICY.bootstrap} ${VALIDATION_POLICY.monteCarloSequence}`,
  };
}

export function stdevOf(values) { return stdev(values); }
