/**
 * JOURNAL INTELLIGENCE + DRIFT + CALIBRATION + ML LAB (research only).
 *
 * Journal pattern -> HYPOTHESIS (nunca regra de producao). Drift gera alerta (nunca altera modelo).
 * estimatedWinProbability do sistema principal continua NULL.
 */
import { hashDataset, evidenceQualityOf } from "./registries.mjs";
import { mean, stdev, percentile, pearson, spearman, wilsonInterval } from "./math.mjs";
import { FACTOR_CATEGORIES } from "./contracts.mjs";

export const JOURNAL_INTELLIGENCE_VERSION = "journal-intelligence-v1";
export const DRIFT_VERSION = "research-drift-v1";
export const CALIBRATION_VERSION = "calibration-lab-v1";
export const ML_LAB_VERSION = "ml-lab-v1";

/* ------------------------------- Journal Intelligence ------------------------------- */

export const JOURNAL_PATTERNS = Object.freeze([
  "WIN", "LOSS", "CHASING", "LATE_ENTRY", "EARLY_ENTRY", "OVEREXTENSION", "POOR_LOCATION",
  "REGIME_MISMATCH", "SCENARIO_MISMATCH", "TRADER_REDTEAM_DISAGREEMENT", "SCENARIO_CHANGE",
  "MOMENTUM_DEGRADATION", "MICROSTRUCTURE_REVERSAL", "LOW_PAYOUT", "CLOCK_ISSUE", "LATENCY",
  "EXPIRY_MISMATCH",
]);

export function detectJournalPatterns(trade = {}) {
  const found = [];
  const result = trade.result ?? trade.theoreticalResult ?? null;
  if (result === "WIN") found.push("WIN");
  if (result === "LOSS") found.push("LOSS");
  const timing = trade.timing ?? {};
  if (timing.candidateAgeMs !== null && timing.candidateAgeMs !== undefined && timing.candidateAgeMs < 3_000) found.push("EARLY_ENTRY");
  if (timing.candidateChangedBeforeEntry === true) found.push("SCENARIO_CHANGE");
  if (Number.isFinite(Number(timing.displacementATR)) && Math.abs(Number(timing.displacementATR)) > 1) found.push("CHASING");
  if (Number.isFinite(Number(timing.entryDriftMs)) && Math.abs(Number(timing.entryDriftMs)) > 2_000) found.push("LATE_ENTRY");
  if (trade.overextended === true || trade.location?.overextended === true) found.push("OVEREXTENSION");
  if (["MID", "UNKNOWN"].includes(trade.location?.zone ?? "")) found.push("POOR_LOCATION");
  if (trade.regimeAtEntry && trade.regimeAtDecision && trade.regimeAtEntry !== trade.regimeAtDecision) found.push("REGIME_MISMATCH");
  if (trade.scenarioAtEntry && trade.scenarioAtDecision && trade.scenarioAtEntry !== trade.scenarioAtDecision) found.push("SCENARIO_MISMATCH");
  if (trade.redTeamVerdict === "CHALLENGED_UNRESOLVED" || trade.traderAction === "WAIT" && trade.finalAction !== "WAIT") found.push("TRADER_REDTEAM_DISAGREEMENT");
  if (trade.momentumState === "WEAKENING" || trade.momentumState === "REVERSING") found.push("MOMENTUM_DEGRADATION");
  if (trade.microstructureState === "SELL_PRESSURE" && (trade.finalAction === "BUY") || trade.microstructureState === "BUY_PRESSURE" && trade.finalAction === "SELL") found.push("MICROSTRUCTURE_REVERSAL");
  if (Number.isFinite(Number(trade.payout)) && Number(trade.payout) < 0.8) found.push("LOW_PAYOUT");
  if (trade.clockValid === false) found.push("CLOCK_ISSUE");
  if (Number.isFinite(Number(trade.latencyMs)) && Number(trade.latencyMs) > 2_500) found.push("LATENCY");
  if (trade.expirationMismatch === true) found.push("EXPIRY_MISMATCH");
  return found;
}

export function journalIntelligence(trades = []) {
  const patternStats = new Map();
  for (const trade of trades) {
    const patterns = detectJournalPatterns(trade);
    const result = trade.result ?? trade.theoreticalResult ?? null;
    for (const pattern of patterns) {
      if (!patternStats.has(pattern)) patternStats.set(pattern, { pattern, n: 0, wins: 0, losses: 0, draws: 0, outcomes: [] });
      const bucket = patternStats.get(pattern);
      bucket.n += 1;
      if (result === "WIN") bucket.wins += 1; else if (result === "LOSS") bucket.losses += 1; else if (result === "DRAW") bucket.draws += 1;
      if (result) bucket.outcomes.push(result);
    }
  }
  const rows = [...patternStats.values()].map((bucket) => ({
    pattern: bucket.pattern, n: bucket.n, wins: bucket.wins, losses: bucket.losses, draws: bucket.draws,
    wr: bucket.n ? Number((bucket.wins / bucket.n).toFixed(4)) : null,
    ci95: wilsonInterval(bucket.wins, bucket.n),
    evidenceQuality: evidenceQualityOf({ nDecided: bucket.wins + bucket.losses, prospective: true }),
    exploratoryOnly: bucket.n < 30,
  })).sort((a, b) => b.n - a.n);
  const hypotheses = rows.filter((row) => row.n >= 10).map((row) => ({
    origin: "JOURNAL_INTELLIGENCE",
    description: `Padrao ${row.pattern} aparece em ${row.n} trades (WR ${row.wr}); investigar como hipotese pre-registrada.`,
    targetPopulation: "PROSPECTIVE_SHADOW",
    expectedEffect: row.wr !== null && row.wr < 0.5 ? "reducao_de_WR" : "efeito_desconhecido",
    features: [row.pattern],
    createdBeforeEvaluation: true,
    status: "CANDIDATE",
    evidence: { n: row.n, wr: row.wr, ci95: row.ci95 },
  }));
  return {
    version: JOURNAL_INTELLIGENCE_VERSION,
    n: trades.length, patterns: rows, hypotheses,
    policy: { journalCreatesHypothesisOnly: true, neverCreatesProductionRule: true, createdBeforeEvaluationRequired: true },
    warning: trades.length < 30 ? "N pequeno: padroes sao pistas exploratorias, nao conclusoes." : null,
  };
}

/* ------------------------------- Drift ------------------------------- */

export function featureDrift({ reference = [], current = [], staleThresholdPp = 15 } = {}) {
  const paths = new Set([...reference, ...current].flatMap((snapshot) => Object.keys(snapshot?.featureProvenance ?? {})));
  const rows = [];
  for (const path of paths) {
    const read = (snapshot) => { const value = snapshot?.featureProvenance?.[path]?.value; return value === null || value === undefined ? NaN : Number(value); };
    const refValues = reference.map(read).filter(Number.isFinite);
    const curValues = current.map(read).filter(Number.isFinite);
    const refAvailable = reference.length ? refValues.length / reference.length : null;
    const curAvailable = current.length ? curValues.length / current.length : null;
    const deltaPp = refAvailable !== null && curAvailable !== null ? Number(((curAvailable - refAvailable) * 100).toFixed(2)) : null;
    rows.push({
      feature: path, refN: refValues.length, curN: curValues.length, refAvailable, curAvailable, deltaPp,
      refMean: refValues.length ? mean(refValues) : null, curMean: curValues.length ? mean(curValues) : null,
      alert: deltaPp !== null && Math.abs(deltaPp) >= staleThresholdPp,
    });
  }
  return { version: DRIFT_VERSION, rows, alerts: rows.filter((row) => row.alert), thresholdPp: staleThresholdPp };
}

export function predictionDrift({ reference = [], current = [] } = {}) {
  const stats = (rows) => {
    const decided = rows.filter((row) => ["WIN", "LOSS"].includes(row.result ?? row.theoreticalResult));
    const wins = decided.filter((row) => (row.result ?? row.theoreticalResult) === "WIN").length;
    return { n: rows.length, decided: decided.length, wr: decided.length ? wins / decided.length : null };
  };
  const ref = stats(reference), cur = stats(current);
  const deltaPp = ref.wr !== null && cur.wr !== null ? Number(((cur.wr - ref.wr) * 100).toFixed(2)) : null;
  return { version: DRIFT_VERSION, reference: ref, current: cur, deltaPp, alert: deltaPp !== null && Math.abs(deltaPp) >= 10, note: "Alerta apenas; nenhum modelo e alterado automaticamente." };
}

export function performanceDrift({ reference = [], current = [] } = {}) {
  const wr = (rows) => { const decided = rows.filter((row) => ["WIN", "LOSS"].includes(row.result ?? row.theoreticalResult)); return decided.length ? decided.filter((row) => (row.result ?? row.theoreticalResult) === "WIN").length / decided.length : null; };
  const edge = (rows) => { const values = rows.map((row) => Number(row.normalizedPnl)).filter(Number.isFinite); return values.length ? mean(values) : null; };
  return { version: DRIFT_VERSION, wrDeltaPp: wr(reference) !== null && wr(current) !== null ? Number(((wr(current) - wr(reference)) * 100).toFixed(2)) : null, edgeDelta: edge(reference) !== null && edge(current) !== null ? Number((edge(current) - edge(reference)).toFixed(4)) : null };
}

export function regimeDistributionDrift({ reference = [], current = [], alertPp = 20 } = {}) {
  const dist = (rows) => rows.reduce((acc, row) => { const key = row.regime ?? "UNKNOWN"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const ref = dist(reference), cur = dist(current);
  const keys = new Set([...Object.keys(ref), ...Object.keys(cur)]);
  const rows = [...keys].map((key) => {
    const refShare = reference.length ? (ref[key] ?? 0) / reference.length : null;
    const curShare = current.length ? (cur[key] ?? 0) / current.length : null;
    const deltaPp = refShare !== null && curShare !== null ? Number(((curShare - refShare) * 100).toFixed(2)) : null;
    return { regime: key, refShare, curShare, deltaPp, alert: deltaPp !== null && Math.abs(deltaPp) >= alertPp };
  });
  return { version: DRIFT_VERSION, rows, alerts: rows.filter((row) => row.alert), thresholdPp: alertPp, note: "Drift de regime alerta o laboratorio; nao muda modelos." };
}

export function driftReport({ referenceSnapshots = [], currentSnapshots = [], referenceTrades = [], currentTrades = [] } = {}) {
  return {
    version: DRIFT_VERSION,
    feature: featureDrift({ reference: referenceSnapshots, current: currentSnapshots }),
    prediction: predictionDrift({ reference: referenceTrades, current: currentTrades }),
    performance: performanceDrift({ reference: referenceTrades, current: currentTrades }),
    regime: regimeDistributionDrift({ reference: referenceTrades, current: currentTrades }),
    policy: { alertOnly: true, autoModelChange: false, autoRetrain: false },
  };
}

/* ------------------------------- Calibration Lab ------------------------------- */

export function reliabilityBins(rows = [], bins = 10) {
  const pairs = rows.map((row) => [Number(row.probability ?? row.p), Number(row.outcome === "WIN" ? 1 : row.outcome === "LOSS" ? 0 : null)]).filter(([p, y]) => Number.isFinite(p) && y !== null);
  if (!pairs.length) return { n: 0, bins: [], brier: null, ece: null };
  const output = [];
  let ece = 0;
  for (let index = 0; index < bins; index += 1) {
    const low = index / bins, high = (index + 1) / bins;
    const bucket = pairs.filter(([p]) => p >= low && (index === bins - 1 ? p <= high : p < high));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(([p]) => p));
    const avgY = mean(bucket.map(([, y]) => y));
    ece += (bucket.length / pairs.length) * Math.abs(avgP - avgY);
    output.push({ bin: index, low, high, n: bucket.length, avgProbability: Number(avgP.toFixed(4)), observedRate: Number(avgY.toFixed(4)), gap: Number((avgP - avgY).toFixed(4)), ci95: wilsonInterval(bucket.filter(([, y]) => y === 1).length, bucket.length) });
  }
  const brier = mean(pairs.map(([p, y]) => (p - y) ** 2));
  return { n: pairs.length, bins: output, brier: Number(brier.toFixed(4)), ece: Number(ece.toFixed(4)) };
}

export function fitPlatt(rows = []) {
  const pairs = rows.map((row) => [Number(row.score ?? row.probability), row.outcome === "WIN" ? 1 : 0]).filter(([x]) => Number.isFinite(x));
  if (pairs.length < 30) return { fitted: false, reason: "N_INSUFICIENTE", n: pairs.length };
  let a = 1, b = 0;
  const lr = 0.05;
  for (let iteration = 0; iteration < 400; iteration += 1) {
    let ga = 0, gb = 0;
    for (const [x, y] of pairs) {
      const z = a * x + b;
      const p = 1 / (1 + Math.exp(-z));
      ga += (p - y) * x; gb += (p - y);
    }
    a -= (lr * ga) / pairs.length; b -= (lr * gb) / pairs.length;
  }
  return { fitted: true, a: Number(a.toFixed(4)), b: Number(b.toFixed(4)), n: pairs.length, note: "Platt scaling do laboratorio; NAO aplicado ao sistema principal." };
}

/* ------------------------------- ML Lab ------------------------------- */

export async function mlLabStatus() {
  const adapters = {};
  for (const name of ["xgboost", "catboost"]) {
    try { await import(name); adapters[name] = "AVAILABLE"; } catch { adapters[name] = "UNAVAILABLE"; }
  }
  return {
    version: ML_LAB_VERSION,
    adapters,
    builtin: ["LOGISTIC_L2 (proprio)", "BASELINE_CONSTANT"],
    target: "P(WIN | oportunidade T0) — classificacao binaria; nunca usar dados futuros",
    policy: {
      deepLearningFirst: false, estimatedWinProbabilityInMainSystem: null,
      calibrationRequiredBeforeProbability: true, realPromotion: false,
    },
  };
}

/** Regressao logistica L2 simples e deterministica (fallback sem dependencias). */
export function trainLogistic({ rows = [], features = [], iterations = 400, learningRate = 0.08, l2 = 0.02 } = {}) {
  const samples = rows.map((row) => {
    const x = features.map((name) => Number(row.features?.[name] ?? row[name] ?? 0));
    const y = (row.outcome ?? row.result) === "WIN" ? 1 : 0;
    return { x, y };
  }).filter((sample) => sample.x.every(Number.isFinite));
  const wins = samples.filter((sample) => sample.y === 1).length;
  const losses = samples.length - wins;
  if (samples.length < 40 || wins < 10 || losses < 10) return { trained: false, reason: "N_OR_CLASS_INSUFFICIENT", n: samples.length, wins, losses };
  const weights = new Array(features.length + 1).fill(0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const sample of samples) {
      const z = weights[weights.length - 1] + sample.x.reduce((sum, value, index) => sum + value * weights[index], 0);
      const p = 1 / (1 + Math.exp(-z));
      for (let index = 0; index < features.length; index += 1) gradient[index] += (p - sample.y) * sample.x[index];
      gradient[weights.length - 1] += p - sample.y;
    }
    for (let index = 0; index < weights.length; index += 1) {
      const penalty = index < features.length ? l2 * weights[index] : 0;
      weights[index] -= (learningRate * (gradient[index] + penalty)) / samples.length;
    }
  }
  const probabilities = samples.map((sample) => 1 / (1 + Math.exp(-(weights[weights.length - 1] + sample.x.reduce((sum, value, index) => sum + value * weights[index], 0)))));
  const brier = mean(probabilities.map((p, index) => (p - samples[index].y) ** 2));
  return { trained: true, weights, features: [...features], n: samples.length, wins, losses, brier: Number(brier.toFixed(4)), calibration: fitPlatt(samples.map((sample, index) => ({ score: probabilities[index], outcome: sample.y === 1 ? "WIN" : "LOSS" }))) };
}

export const ML_TARGET = "P(WIN | oportunidade existente no T0)";
export const RESEARCH_FACTOR_CATEGORIES = [...FACTOR_CATEGORIES];
export function datasetFingerprint(rows) { return hashDataset(rows); }
export const intelligenceVersion = { journal: JOURNAL_INTELLIGENCE_VERSION, drift: DRIFT_VERSION, calibration: CALIBRATION_VERSION, ml: ML_LAB_VERSION };
