/**
 * Repositório SQLite de shadow trades (paper trading).
 *
 * Persiste a simulação "what-if" — log automático do que teria acontecido se
 * o usuário tivesse clicado BUY/SELL quando o sinal apareceu. Permite medir
 * performance hipotética sem risco real e validar a qualidade do sinal.
 */
import type { Datastore } from "../db";
import type { ShadowOutcome, ShadowTrade } from "../../analytics/shadow";

interface Row {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  decision: string;
  entry_time: number;
  entry_price: number | null;
  exit_time: number | null;
  exit_price: number | null;
  outcome: string;
  return_pct: number | null;
  confidence: number | null;
  probability: number | null;
  created_at: number;
  evaluated_at: number | null;
}

export interface ShadowFilter {
  readonly sinceMs?: number;
  readonly symbol?: string;
  readonly signal?: "BUY" | "SELL" | null;
}

export interface ShadowStats {
  readonly total: number;
  readonly evaluated: number;
  readonly wins: number;
  readonly misses: number;
  readonly winRate: number;
  readonly netReturn: number;
  readonly avgReturn: number;
  readonly perSignal: Record<"BUY" | "SELL", { readonly n: number; readonly wins: number; readonly winRate: number; readonly avgReturn: number }>;
}

export class ShadowRepository {
  constructor(private readonly store: Datastore) {}

  save(trade: ShadowTrade): void {
    this.store.db.prepare(`
      INSERT OR REPLACE INTO shadow_trades (
        id, symbol, timeframe, direction, decision,
        entry_time, entry_price, exit_time, exit_price,
        outcome, return_pct, confidence, probability,
        created_at, evaluated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      trade.id, trade.symbol, trade.timeframe, trade.direction, trade.decision,
      trade.entryTime, trade.entryPrice, trade.exitTime, trade.exitPrice,
      trade.outcome, trade.returnPct, trade.confidence, trade.probability,
      trade.createdAt, trade.evaluatedAt,
    );
  }

  update(id: string, updates: Partial<ShadowTrade>): void {
    const fields: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.exitTime !== undefined) { fields.push("exit_time = ?"); params.push(updates.exitTime); }
    if (updates.exitPrice !== undefined) { fields.push("exit_price = ?"); params.push(updates.exitPrice); }
    if (updates.outcome !== undefined) { fields.push("outcome = ?"); params.push(updates.outcome); }
    if (updates.returnPct !== undefined) { fields.push("return_pct = ?"); params.push(updates.returnPct); }
    if (updates.evaluatedAt !== undefined) { fields.push("evaluated_at = ?"); params.push(updates.evaluatedAt); }
    if (fields.length === 0) return;
    params.push(id);
    this.store.db.prepare(`UPDATE shadow_trades SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }

  list(filter: ShadowFilter = {}): ShadowTrade[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.sinceMs !== undefined) { where.push("created_at >= ?"); params.push(filter.sinceMs); }
    if (filter.symbol !== undefined) { where.push("symbol = ?"); params.push(filter.symbol); }
    if (filter.signal !== undefined && filter.signal !== null) { where.push("decision = ?"); params.push(filter.signal); }
    const sql = where.length
      ? `SELECT * FROM shadow_trades WHERE ${where.join(" AND ")} ORDER BY created_at ASC`
      : `SELECT * FROM shadow_trades ORDER BY created_at ASC`;
    const rows = this.store.db.prepare(sql).all(...params) as unknown as Row[];
    return rows.map(rowToTrade);
  }

  /**
   * Lista trades pendentes cujo horizonte JÁ decorreu (entryTime + horizon*step <= horizonMs).
   * O caller é responsável por buscar candles futuros e chamar evaluateShadowTrade.
   */
  listPending(horizonMs: number, _timeframeMs: number): ShadowTrade[] {
    // horizonMs = entryTime + horizon*step (limite superior para avaliação)
    const rows = this.store.db.prepare(
      `SELECT * FROM shadow_trades WHERE outcome = 'pending' AND entry_time <= ? ORDER BY created_at ASC`,
    ).all(horizonMs) as unknown as Row[];
    return rows.map(rowToTrade);
  }

  stats(filter: ShadowFilter = {}): ShadowStats {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.sinceMs !== undefined) { where.push("created_at >= ?"); params.push(filter.sinceMs); }
    if (filter.symbol !== undefined) { where.push("symbol = ?"); params.push(filter.symbol); }
    if (filter.signal !== undefined && filter.signal !== null) { where.push("decision = ?"); params.push(filter.signal); }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const totalRow = this.store.db.prepare(
      `SELECT COUNT(*) AS n FROM shadow_trades ${whereSql}`,
    ).get(...params) as { n: number };
    const total = Number(totalRow.n);

    const whereEval = where.length ? whereSql + " AND outcome IN ('hit','miss','flat','insufficient')" : "WHERE outcome IN ('hit','miss','flat','insufficient')";
    const evalRow = this.store.db.prepare(
      `SELECT
         COUNT(*) AS n,
         SUM(CASE WHEN outcome='hit' THEN 1 ELSE 0 END) AS w,
         SUM(CASE WHEN outcome='miss' THEN 1 ELSE 0 END) AS m,
         SUM(return_pct) AS net,
         AVG(return_pct) AS avg
       FROM shadow_trades ${whereEval}`,
    ).get(...params) as { n: number; w: number | null; m: number | null; net: number | null; avg: number | null };
    const evaluated = Number(evalRow.n);
    const wins = Number(evalRow.w ?? 0);
    const misses = Number(evalRow.m ?? 0);
    const directional = wins + misses;
    const winRate = directional > 0 ? wins / directional : 0;
    const netReturn = evalRow.net != null ? Number(evalRow.net) : 0;
    const avgReturn = evalRow.avg != null ? Number(evalRow.avg) : 0;

    const perSignal: Record<"BUY" | "SELL", { n: number; wins: number; winRate: number; avgReturn: number }> = {
      BUY: { n: 0, wins: 0, winRate: 0, avgReturn: 0 },
      SELL: { n: 0, wins: 0, winRate: 0, avgReturn: 0 },
    };
    for (const sig of ["BUY", "SELL"] as const) {
      const sigWhere = where.length ? [...where, "decision = ?"] : ["decision = ?"];
      const sigParams = [...params, sig];
      const sigRow = this.store.db.prepare(
        `SELECT
           COUNT(*) AS n,
           SUM(CASE WHEN outcome='hit' THEN 1 ELSE 0 END) AS w,
           AVG(return_pct) AS avg
         FROM shadow_trades WHERE ${sigWhere.join(" AND ")} AND outcome IN ('hit','miss','flat','insufficient')`,
      ).get(...sigParams) as { n: number; w: number | null; avg: number | null };
      const n = Number(sigRow.n);
      const w = Number(sigRow.w ?? 0);
      const directionalSig = w; // apenas wins contam como acerto direcional
      // winRate por sinal: wins / (BUY ou SELL avaliados direcionais, hit+miss)
      const directionalDenomRow = this.store.db.prepare(
        `SELECT
           SUM(CASE WHEN outcome='hit' THEN 1 ELSE 0 END) AS h,
           SUM(CASE WHEN outcome='miss' THEN 1 ELSE 0 END) AS mi
         FROM shadow_trades WHERE ${sigWhere.join(" AND ")} AND outcome IN ('hit','miss')`,
      ).get(...sigParams) as { h: number | null; mi: number | null };
      const hits = Number(directionalDenomRow.h ?? 0);
      const missesSig = Number(directionalDenomRow.mi ?? 0);
      const denom = hits + missesSig;
      perSignal[sig] = {
        n,
        wins: w,
        winRate: denom > 0 ? hits / denom : 0,
        avgReturn: sigRow.avg != null ? Number(sigRow.avg) : 0,
      };
      void directionalSig;
    }

    return {
      total,
      evaluated,
      wins,
      misses,
      winRate,
      netReturn,
      avgReturn,
      perSignal,
    };
  }
}

function rowToTrade(r: Row): ShadowTrade {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction as ShadowTrade["direction"],
    decision: r.decision as ShadowTrade["decision"],
    entryTime: r.entry_time,
    entryPrice: r.entry_price,
    exitTime: r.exit_time,
    exitPrice: r.exit_price,
    outcome: r.outcome as ShadowOutcome,
    returnPct: r.return_pct,
    confidence: r.confidence,
    probability: r.probability,
    createdAt: r.created_at,
    evaluatedAt: r.evaluated_at,
  };
}