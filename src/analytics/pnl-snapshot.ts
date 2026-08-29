/**
 * pnl-snapshot.ts — CAMADA 5 (Validação).
 *
 * Calcula um resumo de PnL/perf a partir das decisões armazenadas no store
 * SQLite. Lê diretamente da tabela `decision_records` (somente dados já
 * avaliados — nunca inventa retornos). Retorna zeros e períodos nulos
 * quando o store está vazio.
 *
 * Métricas:
 *   - pnlTotal   : soma dos returnPct (em %)
 *   - pnlPct     : soma normalizada (mesmo que pnlTotal aqui; exposto p/ UI)
 *   - sharpe     : média / desvio padrão (aproximado, anualização não aplicada)
 *   - maxDrawdown: queda máxima do PnL cumulativo, em % (negativo)
 *   - nTrades    : total de decisões avaliadas (hit + miss + flat)
 *   - winRate    : hit / (hit + miss)
 *   - periodStart/periodEnd: ISO dos extremos temporais das decisões incluídas
 *
 * IMPORTANTE: SOMENTE decisões com `outcome != 'pending'` entram no cálculo.
 * Decisões pendentes (horizonte não decorrido) são IGNORADAS — sem inventar PnL.
 */
import type { DecisionRecord, Outcome } from "./types";

/** Snapshot de performance do portfólio analítico. */
export interface PerfSnapshot {
  pnlTotal: number; // soma dos retornos (em %)
  pnlPct: number;   // mesmo valor de pnlTotal, exposto p/ UI legada
  sharpe: number;   // razão média/desvio (aproximado)
  maxDrawdown: number; // % (negativo)
  nTrades: number;
  winRate: number;   // 0..1
  periodStart: string | null; // ISO
  periodEnd: string | null;   // ISO
}

export interface PerfSnapshotOpts {
  /** Limita o período aos últimos N dias (relativos a agora). */
  readonly lookbackDays?: number;
  /** Filtra por tipo de decisão. null = todas. */
  readonly signalFilter?: "BUY" | "SELL" | null;
}

/** Forma mínima do store que este módulo precisa. */
export interface PerfSnapshotStore {
  readonly db: {
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
    };
  };
}

/**
 * Calcula o snapshot de performance a partir das decisões registradas e
 * já avaliadas no store. Decisões pendentes são ignoradas.
 */
export function getPerfSnapshot(
  store: PerfSnapshotStore,
  opts: PerfSnapshotOpts = {},
): PerfSnapshot {
  const { lookbackDays, signalFilter } = opts;

  // Monta WHERE: apenas decisões avaliadas, com filtros opcionais.
  const whereParts: string[] = ["outcome != 'pending'"];
  const params: (string | number)[] = [];

  if (signalFilter) {
    whereParts.push("decision = ?");
    params.push(signalFilter);
  }

  let lowerBound = 0;
  if (typeof lookbackDays === "number" && lookbackDays > 0) {
    lowerBound = Date.now() - lookbackDays * 86_400_000;
    whereParts.push("created_at >= ?");
    params.push(lowerBound);
  }

  const whereSql = `WHERE ${whereParts.join(" AND ")}`;

  // 1) Buscar decisões avaliadas, ordenadas por tempo de criação.
  type Row = {
    decision: string;
    outcome: Outcome;
    return_pct: number | null;
    created_at: number;
  };

  let rows: Row[] = [];
  try {
    rows = store.db
      .prepare(
        `SELECT decision, outcome, return_pct, created_at FROM decision_records ${whereSql} ORDER BY created_at ASC`,
      )
      .all(...params) as Row[];
  } catch {
    // store indisponível (ex.: noop); retorna zeros
    rows = [];
  }

  // 2) Calcular métricas
  if (rows.length === 0) {
    return {
      pnlTotal: 0,
      pnlPct: 0,
      sharpe: 0,
      maxDrawdown: 0,
      nTrades: 0,
      winRate: 0,
      periodStart: null,
      periodEnd: null,
    };
  }

  const returns: number[] = [];
  let hits = 0;
  let misses = 0;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const r of rows) {
    // Apenas decisões com retorno numérico entram nos cálculos de PnL.
    // flat/pending já foram filtrados pelo WHERE, mas return_pct pode ser null.
    if (r.return_pct == null) continue;
    returns.push(r.return_pct);
    if (r.outcome === "hit") hits++;
    else if (r.outcome === "miss") misses++;
    if (r.created_at < minTs) minTs = r.created_at;
    if (r.created_at > maxTs) maxTs = r.created_at;
  }

  const pnlTotal = returns.reduce((a, b) => a + b, 0);
  const nTrades = returns.length;

  // Sharpe aproximado: média / desvio padrão da amostra.
  let sharpe = 0;
  if (nTrades > 1) {
    const mean = pnlTotal / nTrades;
    const variance =
      returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / (nTrades - 1);
    const std = Math.sqrt(variance);
    sharpe = std === 0 ? 0 : mean / std;
  }

  // Max drawdown: queda máxima do PnL cumulativo (em %).
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of returns) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = cum - peak; // <= 0
    if (dd < maxDD) maxDD = dd;
  }

  const directional = hits + misses;
  const winRate = directional > 0 ? hits / directional : 0;

  return {
    pnlTotal,
    pnlPct: pnlTotal,
    sharpe,
    maxDrawdown: maxDD,
    nTrades,
    winRate,
    periodStart: Number.isFinite(minTs) ? new Date(minTs).toISOString() : null,
    periodEnd: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : null,
  };
}

/** Helper exposto para testes: cria um PerfSnapshot direto a partir de
 *  registros já carregados (sem precisar do store). Útil p/ testes rápidos. */
export function buildPerfSnapshotFromRecords(
  records: readonly DecisionRecord[],
  opts: PerfSnapshotOpts = {},
): PerfSnapshot {
  const lowerBound =
    typeof opts.lookbackDays === "number" && opts.lookbackDays > 0
      ? Date.now() - opts.lookbackDays * 86_400_000
      : 0;

  const filtered = records.filter((r) => {
    if (r.outcome === "pending") return false;
    if (opts.signalFilter && r.decision !== opts.signalFilter) return false;
    if (lowerBound > 0 && r.createdAt < lowerBound) return false;
    return true;
  });

  if (filtered.length === 0) {
    return {
      pnlTotal: 0,
      pnlPct: 0,
      sharpe: 0,
      maxDrawdown: 0,
      nTrades: 0,
      winRate: 0,
      periodStart: null,
      periodEnd: null,
    };
  }

  const sorted = [...filtered].sort((a, b) => a.createdAt - b.createdAt);
  const returns: number[] = [];
  let hits = 0;
  let misses = 0;
  for (const r of sorted) {
    if (r.returnPct == null) continue;
    returns.push(r.returnPct);
    if (r.outcome === "hit") hits++;
    else if (r.outcome === "miss") misses++;
  }

  const pnlTotal = returns.reduce((a, b) => a + b, 0);
  const nTrades = returns.length;

  let sharpe = 0;
  if (nTrades > 1) {
    const mean = pnlTotal / nTrades;
    const variance =
      returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / (nTrades - 1);
    const std = Math.sqrt(variance);
    sharpe = std === 0 ? 0 : mean / std;
  }

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of returns) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < maxDD) maxDD = dd;
  }

  const directional = hits + misses;
  const winRate = directional > 0 ? hits / directional : 0;

  return {
    pnlTotal,
    pnlPct: pnlTotal,
    sharpe,
    maxDrawdown: maxDD,
    nTrades,
    winRate,
    periodStart: new Date(sorted[0]!.createdAt).toISOString(),
    periodEnd: new Date(sorted[sorted.length - 1]!.createdAt).toISOString(),
  };
}
