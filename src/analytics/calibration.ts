/**
 * CAMADA 4 — Métricas / Calibration report.
 *
 * Relatório agregado sobre decisões AVALIADAS (não pendentes). A entrada é
 * desacoplada: o caller passa um objeto "store" com o método
 * `listEvaluatedDecisions`, que pode ser um `DecisionRepository`, um mock de
 * teste, ou qualquer adaptador compatível. Nada aqui inventa dados — apenas
 * deriva métricas a partir do que foi realmente observado.
 *
 * Métricas retornadas:
 *  - winRate (acertos / (acertos + erros) — exclui WAIT/flat)
 *  - Brier score (calibração probabilística)
 *  - ECE (Expected Calibration Error)
 *  - Per-sinal / per-timeframe / top setups
 *  - Drawdown observado vs limite
 *  - Guard status (derivado das losses observadas)
 */
import type { DecisionRecord, Outcome } from "./types";

export type DecisionSignal = "BUY" | "SELL" | "WAIT";

/** Linha mínima de decisão que o relatório precisa. */
export interface CalibrationDecisionRow {
  readonly decision: DecisionSignal | string;
  readonly outcome: Outcome;
  readonly returnPct: number | null;
  readonly probability: number | null;
  readonly confidence: number | null;
  readonly timeframe: string;
  readonly regime: string | null;
  readonly evaluatedAt: number | null;
  readonly createdAt: number;
}

export interface CalibrationReport {
  totalDecisions: number;
  evaluated: number;
  wins: number;
  misses: number;
  /** win/(win+miss) sobre decisões direcionais (BUY/SELL) — exclui WAIT/flat. */
  winRate: number;
  /** média do quadrado (prob - outcome). outcome=1 para hit, 0 para miss. */
  brierScore: number;
  /** Expected Calibration Error (10 bins). */
  ece: number;
  perSignal: Record<DecisionSignal, { n: number; wins: number; winRate: number; avgReturn: number | null }>;
  perTimeframe: Record<string, { n: number; wins: number; winRate: number }>;
  topSetups: Array<{ setup: string; n: number; wins: number; winRate: number }>;
  drawdownObserved: number;
  drawdownMax: number;
  guardStatus: { circuitBreaker: "ok" | "tripped"; dailyLossPct: number; lastLossAt: number | null };
  snapshotAt: string; // ISO
}

/** Contrato mínimo que o caller precisa satisfazer. */
export interface CalibrationStore {
  /**
   * Lista decisões avaliadas (outcome != 'pending'). Pode aplicar filtros.
   * @param opts.dias Janela em dias (ex.: 30 = últimos 30 dias). 0 = sem limite.
   */
  listEvaluatedDecisions(opts?: { days?: number }): Promise<DecisionRecord[]> | DecisionRecord[];
}

/** Limite de drawdown diário (espelha fusion/guards). */
const DAILY_DRAWDOWN_LIMIT_PCT = 5;

/** Converte epoch ms → "YYYY-MM-DD" UTC. */
function utcDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Filtra a janela temporal (se opts.dias > 0). */
function filterByDays(rows: readonly DecisionRecord[], days?: number): DecisionRecord[] {
  if (!days || days <= 0) return rows.slice();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((r) => (r.evaluatedAt ?? r.createdAt) >= cutoff);
}

/** Bins para ECE (10 bins uniformes em [0, 1]). */
const ECE_BINS = 10;

function computeBrierAndEce(rows: readonly DecisionRecord[]): { brier: number; ece: number } {
  // Considera apenas decisões direcionais avaliadas com probability preenchida.
  const directional = rows.filter(
    (r) =>
      (r.outcome === "hit" || r.outcome === "miss") &&
      typeof r.probability === "number" &&
      r.probability >= 0 &&
      r.probability <= 1,
  );
  if (directional.length === 0) return { brier: 0, ece: 0 };

  let brierSum = 0;
  const bins: Array<{ count: number; probSum: number; outcomeSum: number }> = Array.from(
    { length: ECE_BINS },
    () => ({ count: 0, probSum: 0, outcomeSum: 0 }),
  );

  for (const r of directional) {
    const p = r.probability as number;
    const y = r.outcome === "hit" ? 1 : 0;
    brierSum += (p - y) ** 2;
    const idx = Math.min(ECE_BINS - 1, Math.max(0, Math.floor(p * ECE_BINS)));
    const bin = bins[idx]!;
    bin.count++;
    bin.probSum += p;
    bin.outcomeSum += y;
  }

  const brier = brierSum / directional.length;
  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const acc = bin.outcomeSum / bin.count;
    const conf = bin.probSum / bin.count;
    ece += (bin.count / directional.length) * Math.abs(acc - conf);
  }
  return { brier, ece };
}

/** Drawdown máximo observado: agrupa perdas por dia UTC e pega o maior soma. */
function computeDrawdownObserved(rows: readonly DecisionRecord[]): number {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome !== "miss") continue;
    const ret = r.returnPct ?? 0;
    // returnPct negativo em loss; somamos o valor absoluto para "perda do dia".
    if (ret >= 0) continue;
    const key = utcDayKey(r.evaluatedAt ?? r.createdAt);
    byDay.set(key, (byDay.get(key) ?? 0) + Math.abs(ret));
  }
  let max = 0;
  for (const v of byDay.values()) if (v > max) max = v;
  return max;
}

/** Guarda derivada: "tripped" se algum dia teve drawdown acima do limite. */
function deriveGuardStatus(rows: readonly DecisionRecord[]): {
  circuitBreaker: "ok" | "tripped";
  dailyLossPct: number;
  lastLossAt: number | null;
} {
  const losses = rows.filter((r) => r.outcome === "miss");
  if (losses.length === 0) {
    return { circuitBreaker: "ok", dailyLossPct: 0, lastLossAt: null };
  }
  let max = 0;
  let maxDay = "";
  const byDay = new Map<string, number>();
  let lastLossAt: number | null = null;
  for (const r of losses) {
    const ret = r.returnPct ?? 0;
    if (ret >= 0) continue;
    const key = utcDayKey(r.evaluatedAt ?? r.createdAt);
    const v = (byDay.get(key) ?? 0) + Math.abs(ret);
    byDay.set(key, v);
    if (v > max) {
      max = v;
      maxDay = key;
    }
    const ts = r.evaluatedAt ?? r.createdAt;
    if (lastLossAt === null || ts > lastLossAt) lastLossAt = ts;
  }
  const tripped = max > DAILY_DRAWDOWN_LIMIT_PCT;
  void maxDay;
  return {
    circuitBreaker: tripped ? "tripped" : "ok",
    dailyLossPct: max,
    lastLossAt,
  };
}

/** Per-sinal: BUY/SELL/WAIT. WAIT normalmente não tem hit/miss. */
function computePerSignal(rows: readonly DecisionRecord[]): CalibrationReport["perSignal"] {
  const empty = { n: 0, wins: 0, winRate: 0, avgReturn: null as number | null };
  const buckets: Record<DecisionSignal, { n: number; wins: number; misses: number; sumRet: number; retN: number }> = {
    BUY: { n: 0, wins: 0, misses: 0, sumRet: 0, retN: 0 },
    SELL: { n: 0, wins: 0, misses: 0, sumRet: 0, retN: 0 },
    WAIT: { n: 0, wins: 0, misses: 0, sumRet: 0, retN: 0 },
  };
  for (const r of rows) {
    const sig = String(r.decision).toUpperCase() as DecisionSignal;
    if (sig !== "BUY" && sig !== "SELL" && sig !== "WAIT") continue;
    const b = buckets[sig];
    b.n++;
    if (r.outcome === "hit") b.wins++;
    if (r.outcome === "miss") b.misses++;
    if (typeof r.returnPct === "number") {
      b.sumRet += r.returnPct;
      b.retN++;
    }
  }
  const fmt = (b: { n: number; wins: number; misses: number; sumRet: number; retN: number }) => {
    const directional = b.wins + b.misses;
    return {
      n: b.n,
      wins: b.wins,
      winRate: directional > 0 ? b.wins / directional : 0,
      avgReturn: b.retN > 0 ? b.sumRet / b.retN : null,
    };
  };
  return {
    BUY: fmt(buckets.BUY),
    SELL: fmt(buckets.SELL),
    WAIT: fmt(buckets.WAIT),
  };
}

function computePerTimeframe(rows: readonly DecisionRecord[]): CalibrationReport["perTimeframe"] {
  const map: Record<string, { n: number; wins: number; misses: number }> = {};
  for (const r of rows) {
    const tf = r.timeframe || "unknown";
    const b = (map[tf] ??= { n: 0, wins: 0, misses: 0 });
    b.n++;
    if (r.outcome === "hit") b.wins++;
    if (r.outcome === "miss") b.misses++;
  }
  const out: CalibrationReport["perTimeframe"] = {};
  for (const [tf, b] of Object.entries(map)) {
    const directional = b.wins + b.misses;
    out[tf] = { n: b.n, wins: b.wins, winRate: directional > 0 ? b.wins / directional : 0 };
  }
  return out;
}

/** Top setups (agrupado por regime). n mínimo = 5. Top 5 ordenado por n. */
function computeTopSetups(rows: readonly DecisionRecord[], minN = 5, limit = 5): CalibrationReport["topSetups"] {
  const map: Record<string, { n: number; wins: number; misses: number }> = {};
  for (const r of rows) {
    const key = r.regime || "unknown";
    const b = (map[key] ??= { n: 0, wins: 0, misses: 0 });
    b.n++;
    if (r.outcome === "hit") b.wins++;
    if (r.outcome === "miss") b.misses++;
  }
  return Object.entries(map)
    .filter(([, b]) => b.n >= minN)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([setup, b]) => {
      const directional = b.wins + b.misses;
      return { setup, n: b.n, wins: b.wins, winRate: directional > 0 ? b.wins / directional : 0 };
    });
}

/** Relatório principal. */
export async function getCalibrationReport(
  store: CalibrationStore,
  opts: { days?: number } = {},
): Promise<CalibrationReport> {
  const all = await store.listEvaluatedDecisions({ days: opts.days });
  const rows = filterByDays(all, opts.days);

  let wins = 0;
  let misses = 0;
  for (const r of rows) {
    if (r.outcome === "hit") wins++;
    if (r.outcome === "miss") misses++;
  }
  const directional = wins + misses;

  const { brier, ece } = computeBrierAndEce(rows);
  const perSignal = computePerSignal(rows);
  const perTimeframe = computePerTimeframe(rows);
  const topSetups = computeTopSetups(rows);
  const drawdownObserved = computeDrawdownObserved(rows);
  const guardStatus = deriveGuardStatus(rows);

  return {
    totalDecisions: rows.length,
    evaluated: rows.length,
    wins,
    misses,
    winRate: directional > 0 ? wins / directional : 0,
    brierScore: brier,
    ece,
    perSignal,
    perTimeframe,
    topSetups,
    drawdownObserved,
    drawdownMax: DAILY_DRAWDOWN_LIMIT_PCT,
    guardStatus,
    snapshotAt: new Date().toISOString(),
  };
}

/** Helper para testes/callers: cria um CalibrationStore a partir de um array. */
export function arrayStore(rows: readonly DecisionRecord[]): CalibrationStore {
  return {
    listEvaluatedDecisions: () => rows.slice(),
  };
}
