/**
 * ALPHA BENCH — mede fatores sobre oportunidades (T0 + desfecho), com metricas condicionais.
 * IC/RankIC/ICIR apenas quando existe alvo continuo (forward return); para WIN/LOSS usa WR condicional,
 * expectancy, PnL normalizado e CI95 (nunca "forca" IC onde nao cabe).
 */
import { evaluateFactor } from "./factors/index.mjs";
import { buildSnapshotMeta, snapshotFromRows } from "./snapshot.mjs";
import { wilsonInterval, expectancy, mean, stdev, spearman, pearson, percentile, clusterByCorrelation, mutualInformation, normalizedPnl } from "./math.mjs";

export const ALPHA_BENCH_VERSION = "alpha-bench-v1";
export const DEFAULT_BUCKETS = Object.freeze([0.25, 0.5, 0.75]);

function directionOf(row) { return row?.direction ?? row?.v4Direction ?? row?.g2Action ?? null; }

export function benchmarkFactor(factor, rows = [], { marketType = "OTC", buckets = DEFAULT_BUCKETS } = {}) {
  const values = [], favored = [], opposed = [], neutral = [], forwardReturns = [], factorSeries = [];
  let coverage = 0, withOutcome = 0;
  for (const row of rows) {
    const value = evaluateFactor(factor, { t0: row.t0 ?? null, candles: row.candles ?? null, ticks: row.ticks ?? null, index: row.index ?? null });
    factorSeries.push(value);
    if (value !== null) coverage += 1;
    const result = row?.outcome?.result ?? row?.theoreticalResult ?? null;
    const payout = row?.payout ?? null;
    if (result === "WIN" || result === "LOSS" || result === "DRAW") withOutcome += 1;
    const direction = directionOf(row);
    if (value !== null && result) {
      const aligned = direction === "BUY" ? value > 0 : direction === "SELL" ? value < 0 : null;
      if (!direction) neutral.push({ result, payout });
      else if (aligned === null) neutral.push({ result, payout });
      else if (aligned) favored.push({ result, payout, magnitude: Math.abs(value) });
      else opposed.push({ result, payout });
    }
    if (value !== null && Number.isFinite(Number(row.forwardReturn))) forwardReturns.push({ value, forward: Number(row.forwardReturn) });
  }
  const n = rows.length;
  const groupStats = (group) => {
    const wins = group.filter((entry) => entry.result === "WIN").length;
    const losses = group.filter((entry) => entry.result === "LOSS").length;
    const draws = group.filter((entry) => entry.result === "DRAW").length;
    const decided = wins + losses;
    const payout = group.find((entry) => Number.isFinite(Number(entry.payout)))?.payout ?? null;
    return {
      n: group.length, wins, losses, draws,
      wr: group.length ? Number((wins / group.length).toFixed(4)) : null,
      decidedWr: decided ? Number((wins / decided).toFixed(4)) : null,
      ci95: wilsonInterval(wins, group.length),
      expectancy: expectancy(wins, losses, draws, payout),
      normalizedPnl: Number(group.reduce((sum, entry) => sum + normalizedPnl(entry.result, entry.payout), 0).toFixed(4)),
    };
  };
  const numeric = factorSeries.filter((value) => value !== null);
  const sorted = [...numeric].sort((a, b) => a - b);
  const quantileCuts = buckets.map((fraction) => percentile(sorted, fraction)).filter((value) => value !== null);
  const bucketReport = quantileCuts.length ? buildBuckets(factorSeries, rows, quantileCuts) : [];
  const icApplicable = forwardReturns.length >= 12;
  const ic = icApplicable ? pearson(forwardReturns.map((row) => row.value), forwardReturns.map((row) => row.forward)) : null;
  const rankIc = icApplicable ? spearman(forwardReturns.map((row) => row.value), forwardReturns.map((row) => row.forward)) : null;
  const icSeries = icApplicable ? blockIc(forwardReturns, 4) : [];
  return {
    factorId: factor.factorId,
    name: factor.name,
    category: factor.category,
    imported: factor.imported === true,
    compatibility: marketType,
    n,
    coverage: n ? Number((coverage / n).toFixed(4)) : null,
    coverageCount: coverage,
    withOutcome,
    distribution: numeric.length ? {
      count: numeric.length, mean: mean(numeric), stdev: stdev(numeric),
      p05: percentile(sorted, 0.05), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95),
      min: sorted[0], max: sorted[sorted.length - 1],
    } : null,
    stability: stabilitySplitHalf(factorSeries),
    conditional: {
      favored: groupStats(favored), opposed: groupStats(opposed), neutral: groupStats(neutral),
      edgePp: favored.length && opposed.length ? Number((((groupStats(favored).wr ?? 0) - (groupStats(opposed).wr ?? 0)) * 100).toFixed(2)) : null,
    },
    buckets: bucketReport,
    icApplicable,
    ic: ic === null ? null : Number(ic.toFixed(4)),
    rankIc: rankIc === null ? null : Number(rankIc.toFixed(4)),
    icir: icSeries.length >= 2 && stdev(icSeries) ? Number((mean(icSeries) / stdev(icSeries)).toFixed(4)) : null,
    note: icApplicable ? "IC/RankIC/ICIR sobre forward return continuo." : "Sem alvo continuo suficiente: IC nao aplicavel (usa WR condicional).",
  };
}

function buildBuckets(factorSeries, rows, cuts) {
  const groups = cuts.map(() => ({ values: [] }));
  for (let index = 0; index < factorSeries.length; index += 1) {
    const value = factorSeries[index];
    if (value === null) continue;
    let bucket = 0;
    while (bucket < cuts.length && value > cuts[bucket]) bucket += 1;
    const result = rows[index]?.outcome?.result ?? rows[index]?.theoreticalResult ?? null;
    if (result) groups[bucket].values.push(result);
  }
  return groups.map((group, index) => {
    const wins = group.values.filter((value) => value === "WIN").length;
    const losses = group.values.filter((value) => value === "LOSS").length;
    return { bucket: index, cut: cuts[index], n: group.values.length, wr: group.values.length ? Number((wins / group.values.length).toFixed(4)) : null, decidedWr: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null, ci95: wilsonInterval(wins, group.values.length) };
  });
}

function stabilitySplitHalf(series) {
  const first = [], second = [];
  const half = Math.floor(series.length / 2);
  for (let index = 0; index < series.length; index += 1) (index < half ? first : second).push(series[index]);
  const pairs = [];
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) if (first[index] !== null && second[index] !== null) pairs.push([first[index], second[index]]);
  if (pairs.length < 6) return { splitHalfCorr: null, note: "amostra insuficiente" };
  const value = pearson(pairs.map((row) => row[0]), pairs.map((row) => row[1]));
  return { splitHalfCorr: value === null ? null : Number(value.toFixed(4)), note: "correlacao metade inicial vs metade final (estabilidade descritiva)" };
}

function blockIc(rowsWithForward, blocks) {
  const size = Math.ceil(rowsWithForward.length / blocks);
  const series = [];
  for (let index = 0; index < rowsWithForward.length; index += size) {
    const block = rowsWithForward.slice(index, index + size);
    if (block.length < 6) continue;
    const value = pearson(block.map((row) => row.value), block.map((row) => row.forward));
    if (value !== null) series.push(value);
  }
  return series;
}

export function benchmarkSummary({ rows = [], factors = [], marketType = "OTC", source = "UNKNOWN", datasetVersion = null, datasetId = null, maxFactors = 200 } = {}) {
  const selected = factors.slice(0, maxFactors);
  const perFactor = selected.map((factor) => benchmarkFactor(factor, rows, { marketType }));
  const matrix = correlationMatrix(selected, rows, perFactor.map((row) => row.coverageCount));
  const clusters = clusterByCorrelation(matrix.labels, matrix.pearson, 0.8);
  const pairs = [];
  for (let i = 0; i < matrix.labels.length; i += 1) {
    for (let j = i + 1; j < matrix.labels.length; j += 1) {
      const value = matrix.pearson[i]?.[j];
      if (Number.isFinite(value)) pairs.push({ left: matrix.labels[i], right: matrix.labels[j], pearson: value, spearman: matrix.spearman[i]?.[j] ?? null, mutualInformation: matrix.mi[i]?.[j] ?? null });
    }
  }
  pairs.sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson));
  return {
    version: ALPHA_BENCH_VERSION,
    snapshot: rows.length ? snapshotFromRows(rows.map((row) => ({ at: row.decisionAt ?? row.at ?? null })), { source, datasetVersion, datasetId, note: "bench sobre oportunidades persistidas; WR condicional, nao votacao" }) : buildSnapshotMeta({ source, datasetVersion, datasetId, n: 0 }),
    marketType,
    factors: perFactor,
    correlation: { labels: matrix.labels, pearson: matrix.pearson, spearman: matrix.spearman, mutualInformation: matrix.mi, topPairs: pairs.slice(0, 25), clusters, threshold: 0.8 },
    warning: rows.length < 30 ? "N pequeno: nenhuma conclusao de performance; apenas diagnostico exploratorio." : null,
    researchOnly: true,
  };
}

export function correlationMatrix(factors = [], rows = [], coverageCounts = []) {
  const usable = factors.map((factor, index) => ({ factor, coverage: coverageCounts[index] ?? 0 })).filter((entry) => entry.coverage >= 5);
  const series = usable.map((entry) => rows.map((row) => evaluateFactor(entry.factor, { t0: row.t0 ?? null, candles: row.candles ?? null, ticks: row.ticks ?? null, index: row.index ?? null })));
  const labels = usable.map((entry) => entry.factor.factorId);
  const pearsonMatrix = [], spearmanMatrix = [], miMatrix = [];
  for (let i = 0; i < series.length; i += 1) {
    pearsonMatrix.push([]); spearmanMatrix.push([]); miMatrix.push([]);
    for (let j = 0; j < series.length; j += 1) {
      const pairs = [];
      for (let index = 0; index < rows.length; index += 1) if (series[i][index] !== null && series[j][index] !== null) pairs.push([series[i][index], series[j][index]]);
      if (i === j) { pearsonMatrix[i].push(1); spearmanMatrix[i].push(1); miMatrix[i].push(null); continue; }
      if (pairs.length < 8) { pearsonMatrix[i].push(null); spearmanMatrix[i].push(null); miMatrix[i].push(null); continue; }
      const xs = pairs.map((row) => row[0]), ys = pairs.map((row) => row[1]);
      pearsonMatrix[i].push(round(pearson(xs, ys)));
      spearmanMatrix[i].push(round(spearman(xs, ys)));
      miMatrix[i].push(mutualInformation(xs, ys));
    }
  }
  return { labels, pearson: pearsonMatrix, spearman: spearmanMatrix, mi: miMatrix };
}

const round = (value) => (value === null ? null : Number(value.toFixed(4)));
