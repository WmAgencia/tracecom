/**
 * Repositório SQLite de decisões (registro + validação estatística).
 * Implementa o contrato usado pelo AnalyticsService.
 */
import type { Datastore } from "../db";
import type { DecisionRecord, DecisionStats, Outcome } from "../../analytics/types";

interface Row {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  decision: string;
  horizon: number;
  entry_time: number;
  entry_price: number | null;
  score: number;
  confidence: number;
  probability: number | null;
  probability_calibrated: number | null;
  sample_size: number | null;
  regime: string | null;
  rationale: string;
  provider_id: string | null;
  model_version: string | null;
  feature_version: string | null;
  outcome: string;
  exit_time: number | null;
  exit_price: number | null;
  return_pct: number | null;
  gross_return_pct: number | null;
  cost_pct: number | null;
  evaluated_at: number | null;
  evaluation_attempts: number;
  last_evaluation_error: string | null;
  evaluation_locked: number;
  created_at: number;
}

export class DecisionRepository {
  constructor(private readonly store: Datastore) {}

  /**
 * Aceita um Partial<DecisionRecord> — campos novos P-R (providerId, modelVersion,
 * featureVersion, evaluationAttempts, lastEvaluationError, evaluationLocked) são
 * opcionais e defaults são aplicados aqui. Permite que callers antigos (testes,
 * scripts CLI) continuem funcionando sem migração.
 */
  async save(record: Partial<DecisionRecord> & {
    id: string;
    symbol: string;
    timeframe: string;
    direction: string;
    decision: DecisionRecord["decision"];
    horizon: number;
    entryTime: number;
    entryPrice: number | null;
    score: number;
    confidence: number;
    probability: number | null;
    probabilityCalibrated?: number | null;
    sampleSize: number;
    regime: string | null;
    rationale: string;
    outcome?: DecisionRecord["outcome"];
    exitTime?: number | null;
    exitPrice?: number | null;
    returnPct?: number | null;
    grossReturnPct?: number | null;
    costPct?: number | null;
    evaluatedAt?: number | null;
    createdAt: number;
  }): Promise<void> {
    const r = {
      ...record,
      providerId: record.providerId ?? null,
      modelVersion: record.modelVersion ?? null,
      featureVersion: record.featureVersion ?? null,
      probabilityCalibrated: record.probabilityCalibrated ?? null,
      outcome: record.outcome ?? ("pending" as DecisionRecord["outcome"]),
      exitTime: record.exitTime ?? null,
      exitPrice: record.exitPrice ?? null,
      returnPct: record.returnPct ?? null,
      grossReturnPct: record.grossReturnPct ?? null,
      costPct: record.costPct ?? null,
      evaluatedAt: record.evaluatedAt ?? null,
      evaluationAttempts: record.evaluationAttempts ?? 0,
      lastEvaluationError: record.lastEvaluationError ?? null,
      evaluationLocked: record.evaluationLocked ?? false,
    };
    this.store.db.prepare(`
      INSERT OR REPLACE INTO decision_records (
        id,symbol,timeframe,direction,decision,horizon,entry_time,entry_price,
        score,confidence,probability,probability_calibrated,sample_size,regime,rationale,
        provider_id,model_version,feature_version,
        outcome,exit_time,exit_price,return_pct,gross_return_pct,cost_pct,evaluated_at,
        evaluation_attempts,last_evaluation_error,evaluation_locked,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      r.id, r.symbol, r.timeframe, r.direction, r.decision,
      r.horizon, r.entryTime, r.entryPrice, r.score, r.confidence,
      r.probability, r.probabilityCalibrated, r.sampleSize, r.regime, r.rationale,
      r.providerId, r.modelVersion, r.featureVersion,
      r.outcome, r.exitTime, r.exitPrice, r.returnPct, r.grossReturnPct, r.costPct, r.evaluatedAt,
      r.evaluationAttempts, r.lastEvaluationError, r.evaluationLocked ? 1 : 0,
      r.createdAt,
    );
  }

  async updateOutcome(id: string, updates: Partial<DecisionRecord>): Promise<void> {
    // P-R: idempotência. Só atualizamos outcome se o estado atual é pending/stalled/error.
    // Outcomes já avaliados (hit/miss/flat) NÃO são sobrescritos para evitar dupla
    // escrita caso o scheduler rode duas vezes para a mesma decisão.
    const current = this.store.db.prepare(
      `SELECT outcome, evaluation_locked FROM decision_records WHERE id = ?`,
    ).get(id) as { outcome: string; evaluation_locked: number } | undefined;
    if (!current) return;
    if (current.evaluation_locked === 1) return;
    const finalOutcome = "outcome" in updates ? updates.outcome : current.outcome;
    const terminalStates = new Set(["hit", "miss", "flat"]);
    if (terminalStates.has(current.outcome) && current.outcome === finalOutcome) return;

    const fields: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.outcome !== undefined) { fields.push("outcome = ?"); params.push(updates.outcome); }
    if (updates.exitTime !== undefined) { fields.push("exit_time = ?"); params.push(updates.exitTime); }
    if (updates.exitPrice !== undefined) { fields.push("exit_price = ?"); params.push(updates.exitPrice); }
    if (updates.returnPct !== undefined) { fields.push("return_pct = ?"); params.push(updates.returnPct); }
    if (updates.grossReturnPct !== undefined) { fields.push("gross_return_pct = ?"); params.push(updates.grossReturnPct); }
    if (updates.costPct !== undefined) { fields.push("cost_pct = ?"); params.push(updates.costPct); }
    if (updates.evaluatedAt !== undefined) { fields.push("evaluated_at = ?"); params.push(updates.evaluatedAt); }
    if (updates.evaluationAttempts !== undefined) { fields.push("evaluation_attempts = ?"); params.push(updates.evaluationAttempts); }
    if (updates.lastEvaluationError !== undefined) { fields.push("last_evaluation_error = ?"); params.push(updates.lastEvaluationError); }
    if (updates.evaluationLocked !== undefined) { fields.push("evaluation_locked = ?"); params.push(updates.evaluationLocked ? 1 : 0); }
    if (updates.probabilityCalibrated !== undefined) { fields.push("probability_calibrated = ?"); params.push(updates.probabilityCalibrated); }
    if (fields.length === 0) return;
    params.push(id);
    this.store.db.prepare(`UPDATE decision_records SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }

  /** Incrementa contador de tentativas de avaliação (sem mudar outcome). */
  async incrementAttempts(id: string, error?: string): Promise<void> {
    const stmt = this.store.db.prepare(
      `UPDATE decision_records SET evaluation_attempts = evaluation_attempts + 1, last_evaluation_error = ? WHERE id = ?`,
    );
    stmt.run(error ?? null, id);
  }

  async listPending(filter: { symbol?: string; timeframe?: string } = {}): Promise<DecisionRecord[]> {
    // STALLED é recuperável: o provider pode preencher o gap em um tick posterior.
    const where: string[] = ["outcome IN ('pending', 'stalled')"];
    const params: (string | number)[] = [];
    if (filter.symbol) { where.push("symbol = ?"); params.push(filter.symbol); }
    if (filter.timeframe) { where.push("timeframe = ?"); params.push(filter.timeframe); }
    const rows = this.store.db.prepare(
      `SELECT * FROM decision_records WHERE ${where.join(" AND ")} ORDER BY created_at ASC`,
    ).all(...params) as unknown as Row[];
    return rows.map(rowToRecord);
  }

  /** Lista TODAS as decisões (avaliadas + pendentes), com filtro opcional por janela temporal. */
  async listAll(filter: { sinceMs?: number } = {}): Promise<DecisionRecord[]> {
    const params: (string | number)[] = [];
    let where = "";
    if (filter.sinceMs !== undefined) {
      where = "WHERE created_at >= ?";
      params.push(filter.sinceMs);
    }
    const stmt = this.store.db.prepare(
      `SELECT * FROM decision_records ${where} ORDER BY created_at ASC`,
    );
    const rows = stmt.all(...params) as unknown as Row[];
    if (!Array.isArray(rows)) {
      throw new Error(`listAll: stmt.all() retornou não-array (${typeof rows})`);
    }
    return rows.map(rowToRecord);
  }

  async stats(filter: { symbol?: string; timeframe?: string } = {}): Promise<DecisionStats> {
    const whereParts: string[] = [];
    const params: (string | number)[] = [];
    if (filter.symbol) { whereParts.push("symbol = ?"); params.push(filter.symbol); }
    if (filter.timeframe) { whereParts.push("timeframe = ?"); params.push(filter.timeframe); }
    const where = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";
    const total = (this.store.db.prepare(`SELECT COUNT(*) n FROM decision_records ${where}`).get(...params) as { n: number }).n;
    const whereEvaluated = whereParts.length
      ? whereParts.join(" AND ") + " AND outcome != 'pending'"
      : "outcome != 'pending'";
    const evaluatedRow = this.store.db.prepare(
      `SELECT COUNT(*) n, SUM(CASE WHEN outcome='hit' THEN 1 ELSE 0 END) w,
              SUM(CASE WHEN outcome='miss' THEN 1 ELSE 0 END) m,
              SUM(CASE WHEN outcome='flat' THEN 1 ELSE 0 END) f,
              SUM(return_pct) net, AVG(return_pct) avg,
              MAX(evaluated_at) lastEval
       FROM decision_records WHERE ${whereEvaluated}`,
    ).get(...params) as { n: number; w: number | null; m: number | null; f: number | null; net: number | null; avg: number | null; lastEval: number | null };
    const evaluated = Number(evaluatedRow.n);
    const wins = Number(evaluatedRow.w ?? 0);
    const misses = Number(evaluatedRow.m ?? 0);
    const flats = Number(evaluatedRow.f ?? 0);
    const directional = wins + misses;
    const pending = total - evaluated;
    return {
      total,
      evaluated,
      pending,
      wins,
      misses,
      winRate: directional > 0 ? wins / directional : null,
      hitRate: directional > 0 ? wins / directional : null,
      avgReturn: evaluatedRow.avg != null ? Number(evaluatedRow.avg) : null,
      netReturn: evaluatedRow.net != null ? Number(evaluatedRow.net) : null,
      validations: evaluated,
      lastEvaluatedAt: evaluatedRow.lastEval != null ? Number(evaluatedRow.lastEval) : null,
    };
  }

  async lastEvaluated(): Promise<number | null> {
    const row = this.store.db.prepare("SELECT MAX(evaluated_at) m FROM decision_records").get() as { m: number | null };
    return row.m != null ? Number(row.m) : null;
  }
}

function rowToRecord(r: Row): DecisionRecord {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction,
    decision: r.decision as DecisionRecord["decision"],
    horizon: r.horizon,
    entryTime: r.entry_time,
    entryPrice: r.entry_price,
    score: r.score,
    confidence: r.confidence,
    probability: r.probability,
    probabilityCalibrated: r.probability_calibrated ?? null,
    sampleSize: r.sample_size ?? 0,
    regime: r.regime,
    rationale: r.rationale,
    providerId: r.provider_id,
    modelVersion: r.model_version,
    featureVersion: r.feature_version,
    outcome: r.outcome as Outcome,
    exitTime: r.exit_time,
    exitPrice: r.exit_price,
    returnPct: r.return_pct,
    grossReturnPct: r.gross_return_pct,
    costPct: r.cost_pct,
    evaluatedAt: r.evaluated_at,
    evaluationAttempts: r.evaluation_attempts ?? 0,
    lastEvaluationError: r.last_evaluation_error,
    evaluationLocked: r.evaluation_locked === 1,
    createdAt: r.created_at,
  };
}
