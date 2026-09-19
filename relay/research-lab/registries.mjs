/**
 * REGISTRIES + EVIDENCE DB — datasets, experimentos, hipoteses, modelos e Strategy×Regime.
 * Persistencia em Postgres (migration 035) com fallback em memoria. Nada promove automaticamente.
 */
import crypto from "node:crypto";
import { EVIDENCE_QUALITY } from "./contracts.mjs";
import { wilsonInterval, expectancy, mean, maxDrawdown, maxLossStreak, normalizedPnl, percentile } from "./math.mjs";

export const REGISTRIES_VERSION = "research-registries-v1";

export function hashDataset(rows = []) {
  return crypto.createHash("sha256").update(JSON.stringify(rows.map((row) => row?.observationId ?? row?.id ?? row?.at ?? row)).slice(0, 1_000_000)).digest("hex");
}

function memoryStore() { return { datasets: new Map(), experiments: new Map(), hypotheses: new Map(), models: new Map() }; }

export class ResearchRegistries {
  constructor({ pool = null, now = () => Date.now(), store = null } = {}) {
    this.pool = pool; this.now = now; this.memory = store ?? memoryStore();
  }

  get persistent() { return Boolean(this.pool?.query); }

  async #insert(table, row, columns) {
    if (!this.persistent) return { ok: true, mode: "MEMORY" };
    try {
      const names = columns.map((column) => column.name);
      const values = columns.map((column) => column.value(row));
      const placeholders = names.map((_, index) => `$${index + 1}`);
      await this.pool.query(`INSERT INTO ${table}(${names.join(",")}, created_at) VALUES(${placeholders.join(",")}, now()) ON CONFLICT (id) DO NOTHING`, values);
      return { ok: true, mode: "POSTGRES" };
    } catch (error) { return { ok: false, mode: "POSTGRES", error: String(error?.message ?? error).slice(0, 160) }; }
  }

  async #list(table, limit = 100) {
    if (!this.persistent) return [];
    try { return (await this.pool.query(`SELECT payload FROM ${table} ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(500, limit))])).rows.map((row) => row.payload); }
    catch { return []; }
  }

  async registerDataset(meta = {}) {
    const record = {
      id: meta.datasetId ?? `ds_${crypto.randomUUID()}`, version: meta.version ?? "1", createdAt: this.now(),
      markets: meta.markets ?? [], period: meta.period ?? null, features: meta.features ?? [], labels: meta.labels ?? [],
      pointInTime: meta.pointInTime !== false, source: meta.source ?? "UNKNOWN", hash: meta.hash ?? hashDataset(meta.rows ?? []),
      quality: meta.quality ?? "UNKNOWN", knownLimitations: meta.knownLimitations ?? [], payload: meta,
    };
    this.memory.datasets.set(record.id, record);
    await this.#insert("iq_research_datasets", record, [
      { name: "id", value: (row) => row.id }, { name: "version", value: (row) => row.version }, { name: "source", value: (row) => row.source },
      { name: "point_in_time", value: (row) => row.pointInTime }, { name: "hash", value: (row) => row.hash },
      { name: "payload", value: (row) => JSON.stringify(row.payload) },
    ]);
    return record;
  }

  async registerExperiment(meta = {}) {
    const record = {
      id: meta.experimentId ?? `exp_${crypto.randomUUID()}`, hypothesis: meta.hypothesis ?? null, createdAt: this.now(),
      codeCommit: meta.codeCommit ?? null, datasetVersion: meta.datasetVersion ?? null, factorVersions: meta.factorVersions ?? [],
      strategyVersion: meta.strategyVersion ?? null, parameters: meta.parameters ?? {}, validationPlan: meta.validationPlan ?? [],
      result: meta.result ?? null, status: meta.status ?? "RESEARCH", payload: meta,
    };
    this.memory.experiments.set(record.id, record);
    await this.#insert("iq_research_experiments", record, [
      { name: "id", value: (row) => row.id }, { name: "hypothesis", value: (row) => row.hypothesis },
      { name: "dataset_version", value: (row) => row.datasetVersion }, { name: "strategy_version", value: (row) => row.strategyVersion },
      { name: "status", value: (row) => row.status }, { name: "payload", value: (row) => JSON.stringify(row.payload) },
    ]);
    return record;
  }

  async registerHypothesis(meta = {}) {
    const record = {
      id: meta.hypothesisId ?? `hyp_${crypto.randomUUID()}`, origin: meta.origin ?? "MANUAL", description: meta.description ?? "",
      targetPopulation: meta.targetPopulation ?? null, expectedEffect: meta.expectedEffect ?? null, features: meta.features ?? [],
      createdBeforeEvaluation: meta.createdBeforeEvaluation === true, status: meta.status ?? "CANDIDATE", evidence: meta.evidence ?? null,
      createdAt: this.now(), payload: meta,
    };
    this.memory.hypotheses.set(record.id, record);
    await this.#insert("iq_research_hypotheses", record, [
      { name: "id", value: (row) => row.id }, { name: "origin", value: (row) => row.origin },
      { name: "description", value: (row) => row.description }, { name: "created_before_evaluation", value: (row) => row.createdBeforeEvaluation },
      { name: "status", value: (row) => row.status }, { name: "payload", value: (row) => JSON.stringify(row.payload) },
    ]);
    return record;
  }

  async registerModel(meta = {}) {
    const record = {
      id: meta.modelId ?? `model_${crypto.randomUUID()}`, version: meta.version ?? "1", type: meta.type ?? "LOGISTIC",
      features: meta.features ?? [], trainingDataset: meta.trainingDataset ?? null, trainingWindow: meta.trainingWindow ?? null,
      validationWindow: meta.validationWindow ?? null, holdoutWindow: meta.holdoutWindow ?? null, calibration: meta.calibration ?? null,
      metrics: meta.metrics ?? null, hash: meta.hash ?? null, status: meta.status ?? "RESEARCH", createdAt: this.now(), payload: meta,
    };
    this.memory.models.set(record.id, record);
    await this.#insert("iq_research_models", record, [
      { name: "id", value: (row) => row.id }, { name: "version", value: (row) => row.version }, { name: "type", value: (row) => row.type },
      { name: "status", value: (row) => row.status }, { name: "hash", value: (row) => row.hash }, { name: "payload", value: (row) => JSON.stringify(row.payload) },
    ]);
    return record;
  }

  async datasets() { const db = await this.#list("iq_research_datasets"); return db.length ? db : [...this.memory.datasets.values()]; }
  async experiments() { const db = await this.#list("iq_research_experiments"); return db.length ? db : [...this.memory.experiments.values()]; }
  async hypotheses() { const db = await this.#list("iq_research_hypotheses"); return db.length ? db : [...this.memory.hypotheses.values()]; }
  async models() { const db = await this.#list("iq_research_models"); return db.length ? db : [...this.memory.models.values()]; }
}

/* ------------------------------- Strategy × Regime ------------------------------- */

export function evidenceQualityOf({ nDecided, prospective = false, holdoutUsed = false, practiceValidated = false } = {}) {
  if (practiceValidated && nDecided >= 50) return "PRACTICE_VALIDATED";
  if (prospective && nDecided >= 30) return "PROSPECTIVE_SHADOW";
  if (holdoutUsed && nDecided >= 50) return "VALIDATED_HOLDOUT";
  if (nDecided >= 100) return "VALIDATED_HISTORICAL";
  if (nDecided >= 20) return "EXPLORATORY";
  return "INSUFFICIENT";
}

export function buildStrategyRegimeDatabase(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.strategyVersion ?? row.v4Version ?? "V4", row.regime ?? "UNKNOWN", row.scenario ?? "NO_SCENARIO", row.marketType ?? "UNKNOWN", row.marketKey ?? "ALL", row.sessionBucket ?? "ANY"].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [strategyVersion, regime, scenario, marketType, marketKey, sessionBucket] = key.split("|");
    const decided = group.filter((row) => ["WIN", "LOSS", "DRAW"].includes(row.result ?? row.theoreticalResult));
    const wins = decided.filter((row) => (row.result ?? row.theoreticalResult) === "WIN").length;
    const losses = decided.filter((row) => (row.result ?? row.theoreticalResult) === "LOSS").length;
    const draws = decided.filter((row) => (row.result ?? row.theoreticalResult) === "DRAW").length;
    const payouts = decided.map((row) => Number(row.payout)).filter(Number.isFinite);
    const pnls = decided.map((row) => normalizedPnl(row.result ?? row.theoreticalResult, row.payout));
    return {
      strategyVersion, regime, scenario, marketType, marketKey, sessionBucket,
      n: group.length, decided: decided.length, wins, losses, draws,
      wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null,
      ci95: wilsonInterval(wins, decided.length),
      payout: payouts.length ? Number(mean(payouts).toFixed(4)) : null,
      coverage: group.length ? Number((decided.length / group.length).toFixed(4)) : null,
      expectancy: expectancy(wins, losses, draws, payouts.length ? mean(payouts) : null),
      normalizedPnl: Number(pnls.reduce((sum, value) => sum + value, 0).toFixed(4)),
      maxDrawdown: maxDrawdown(pnls),
      maxLossStreak: maxLossStreak(decided.map((row) => row.result ?? row.theoreticalResult)),
      p50Pnl: percentile(pnls, 0.5),
      lastVerified: Date.now(),
      evidenceQuality: evidenceQualityOf({ nDecided: decided.length, prospective: group.some((row) => row.provenance === "PROSPECTIVE" || row.provenance === "PROSPECTIVE_SHADOW") }),
      precisionWarning: decided.length < 30 ? "N pequeno: exploratorio" : null,
    };
  }).sort((a, b) => b.decided - a.decided);
}

export const EVIDENCE_POLICY = Object.freeze({
  qualityStates: [...EVIDENCE_QUALITY],
  realValidatedAutomatic: false,
  note: "PRACTICE_VALIDATED exige execucao PRACTICE real com N minimo; REAL_VALIDATED nao existe automaticamente.",
});
