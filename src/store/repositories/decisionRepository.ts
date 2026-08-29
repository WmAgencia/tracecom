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
  sample_size: number | null;
  regime: string | null;
  rationale: string;
  outcome: string;
  exit_time: number | null;
  exit_price: number | null;
  return_pct: number | null;
  evaluated_at: number | null;
  created_at: number;
}

export class DecisionRepository {
  constructor(private readonly store: Datastore) {}

  async save(record: DecisionRecord): Promise<void> {
    this.store.db.prepare(`
      INSERT OR REPLACE INTO decision_records (
        id,symbol,timeframe,direction,decision,horizon,entry_time,entry_price,
        score,confidence,probability,sample_size,regime,rationale,outcome,
        exit_time,exit_price,return_pct,evaluated_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      record.id, record.symbol, record.timeframe, record.direction, record.decision,
      record.horizon, record.entryTime, record.entryPrice, record.score, record.confidence,
      record.probability, record.sampleSize, record.regime, record.rationale, record.outcome,
      record.exitTime, record.exitPrice, record.returnPct, record.evaluatedAt, record.createdAt,
    );
  }

  async updateOutcome(id: string, updates: Partial<DecisionRecord>): Promise<void> {
    const fields: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.outcome !== undefined) { fields.push("outcome = ?"); params.push(updates.outcome); }
    if (updates.exitTime !== undefined) { fields.push("exit_time = ?"); params.push(updates.exitTime); }
    if (updates.exitPrice !== undefined) { fields.push("exit_price = ?"); params.push(updates.exitPrice); }
    if (updates.returnPct !== undefined) { fields.push("return_pct = ?"); params.push(updates.returnPct); }
    if (updates.evaluatedAt !== undefined) { fields.push("evaluated_at = ?"); params.push(updates.evaluatedAt); }
    if (fields.length === 0) return;
    params.push(id);
    this.store.db.prepare(`UPDATE decision_records SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }

  async listPending(filter: { symbol?: string; timeframe?: string } = {}): Promise<DecisionRecord[]> {
    const where: string[] = ["outcome = 'pending'"];
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
    const rows = this.store.db.prepare(
      `SELECT * FROM decision_records ${where} ORDER BY created_at ASC`,
    ).all(...params) as unknown as Row[];
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
    sampleSize: r.sample_size ?? 0,
    regime: r.regime,
    rationale: r.rationale,
    outcome: r.outcome as Outcome,
    exitTime: r.exit_time,
    exitPrice: r.exit_price,
    returnPct: r.return_pct,
    evaluatedAt: r.evaluated_at,
    createdAt: r.created_at,
  };
}
