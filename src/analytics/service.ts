/**
 * AnalyticsService — registra decisões e valida o resultado posteriormente.
 *
 * Causalidade correta: ao registrar uma decisão usamos apenas dados do momento
 * (`entryTime/entryPrice`). Ao validar, SÓ então consultamos candles futuros
 * (horizonte já decorrido) e medimos o retorno real. Nunca a validação informa
 * a decisão (é posterior).
 */
import type { DecisionRecord, DecisionStats, Outcome, ValidationConfig } from "./types";
import { TIMEFRAME_MS, Timeframe } from "../market/model";
import type { MarketCandle } from "../market/model";
import { getCalibrationReport, type CalibrationReport } from "./calibration";
import { buildPerfSnapshotFromRecords, type PerfSnapshot } from "./pnl-snapshot";
import { openShadowTrade, evaluateShadowTrade, DEFAULT_COOLDOWN_MINUTES, type ShadowTrade, type ShadowOutcome } from "./shadow";
import type { ShadowRepository, ShadowStats, ShadowFilter } from "../store/repositories/shadowRepository";

export const DEFAULT_VALIDATION: ValidationConfig = { minMovePct: 0.5, lookback: 1000 };

export interface FusedDecisionInput {
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: string;
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly horizon: number;
  readonly entryTime: number;
  readonly entryPrice: number | null;
  readonly score: number;
  readonly confidence: number;
  readonly probability: number | null;
  readonly sampleSize: number;
  readonly regime: string | null;
  readonly rationale: string;
}

export class AnalyticsService {
  constructor(
    private readonly persist: {
      save(record: DecisionRecord): Promise<void>;
      updateOutcome(id: string, record: Partial<DecisionRecord>): Promise<void>;
      listPending(filter: { symbol?: string; timeframe?: string }): Promise<DecisionRecord[]>;
      stats(filter: { symbol?: string; timeframe?: string }): Promise<DecisionStats>;
      lastEvaluated(): Promise<number | null>;
    },
    private readonly candles: (symbol: string, timeframe: Timeframe) => readonly MarketCandle[],
    private readonly cfg: ValidationConfig = DEFAULT_VALIDATION,
    private readonly shadowRepo?: ShadowRepository,
  ) {}

  /** Registra uma decisão saída da fusão. */
  async recordDecision(input: FusedDecisionInput): Promise<DecisionRecord> {
    const record: DecisionRecord = {
      id: crypto.randomUUID(),
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: input.direction,
      decision: input.decision,
      horizon: input.horizon,
      entryTime: input.entryTime,
      entryPrice: input.entryPrice,
      score: input.score,
      confidence: input.confidence,
      probability: input.probability,
      sampleSize: input.sampleSize,
      regime: input.regime,
      rationale: input.rationale,
      outcome: "pending",
      exitTime: null,
      exitPrice: null,
      returnPct: null,
      evaluatedAt: null,
      createdAt: Date.now(),
    };
    await this.persist.save(record);
    return record;
  }

  /** Avalia decisões pendentes cujo horizonte já decorreu (dados reais). */
  async evaluatePending(filter: { symbol?: string; timeframe?: string } = {}): Promise<{ evaluated: number; outcomes: Record<Outcome, number> }> {
    const pending = await this.persist.listPending(filter);
    let evaluated = 0;
    const outcomes: Record<Outcome, number> = { hit: 0, miss: 0, flat: 0, pending: 0 };
    const now = Date.now();

    for (const rec of pending) {
      const tf = rec.timeframe as Timeframe;
      const step = TIMEFRAME_MS[tf];
      if (!step) continue;
      const exitTime = rec.entryTime + rec.horizon * step;
      if (exitTime > now) continue; // horizonte ainda não decorreu

      const candles = this.candles(rec.symbol, tf);
      const entry = candles.find((c) => c.timestamp === rec.entryTime);
      const exit = candles.find((c) => c.timestamp === exitTime);
      if (!entry || !exit) continue; // sem dados reais p/ o horizonte (não inventa)

      const outcome = this.outcomeOf(rec, entry.close, exit.close);
      await this.persist.updateOutcome(rec.id, {
        outcome,
        exitTime,
        exitPrice: exit.close,
        returnPct: ((exit.close - entry.close) / (entry.close || 1)) * 100,
        evaluatedAt: now,
      });
      outcomes[outcome]++;
      evaluated++;
    }
    return { evaluated, outcomes };
  }

  /** Estatística agregada e calibração. */
  stats(filter: { symbol?: string; timeframe?: string } = {}): Promise<DecisionStats> {
    return this.persist.stats(filter);
  }

  /** Relatório completo de calibração (Brier, ECE, win rate por sinal/TF, drawdown, guard status). */
  async calibration(opts: { days?: number } = {}): Promise<CalibrationReport> {
    const store = {
      listEvaluatedDecisions: async (o: { days?: number } = {}) => {
        const sinceMs = o.days ? Date.now() - o.days * 24 * 60 * 60 * 1000 : undefined;
        return (this.persist as unknown as {
          listAll: (f: { sinceMs?: number }) => Promise<DecisionRecord[]>;
        }).listAll({ sinceMs });
      },
    };
    return getCalibrationReport(store, opts);
  }

  /** Snapshot de PnL e métricas históricas. */
  async perfSnapshot(opts: { lookbackDays?: number; signalFilter?: "BUY" | "SELL" | null } = {}): Promise<PerfSnapshot> {
    const sinceMs = opts.lookbackDays ? Date.now() - opts.lookbackDays * 24 * 60 * 60 * 1000 : undefined;
    const all = await (this.persist as unknown as {
      listAll: (f: { sinceMs?: number }) => Promise<DecisionRecord[]>;
    }).listAll({ sinceMs });
    let rows = all;
    if (opts.signalFilter) rows = rows.filter((r) => r.decision === opts.signalFilter);
    return buildPerfSnapshotFromRecords(rows);
  }

  /** Stats + lista de shadow trades para a vitrine. */
  async shadowStats(filter?: { sinceMs?: number; signal?: "BUY" | "SELL" | null }): Promise<{
    stats: { total: number; evaluated: number; wins: number; misses: number; winRate: number; netReturn: number; avgReturn: number };
    trades: ReturnType<ShadowRepository["list"]>;
  } | null> {
    if (!this.shadowRepo) return null;
    const trades = this.shadowRepo.list(filter);
    const stats = this.shadowRepo.stats(filter);
    return { stats, trades: trades.slice(0, 50) };
  }

  /**
   * Shadow trading (paper trading) — registra o que TERIA acontecido se o
   * usuário tivesse clicado BUY/SELL no momento do sinal. Avalia contra
   * candles futuros reais quando o horizonte decorre.
   *
   * Só funciona se `shadowRepo` foi injetado no constructor (parâmetro opcional).
   */
  async recordShadowTrade(input: {
    symbol: string;
    timeframe: string;
    direction: "up" | "down";
    decision: "BUY" | "SELL" | "WAIT";
    entryTime: number;
    entryPrice: number;
    confidence?: number;
    probability?: number;
    stopLossPct?: number;
    cooldownMinutes?: number;
  }): Promise<ShadowTrade | null> {
    if (!this.shadowRepo) return null;

    // Cooldown entre trades do mesmo symbol+decision: se o último foi aberto
    // há menos de `cooldownMinutes` (default 4h), rejeita o novo trade.
    // WAIT nunca respeita cooldown (não tem exposição direcional).
    const cooldownMinutes = input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
    if (input.decision !== "WAIT" && Number.isFinite(cooldownMinutes) && cooldownMinutes > 0) {
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const sinceMs = input.entryTime - cooldownMs;
      const recent = this.shadowRepo.list({
        symbol: input.symbol,
        signal: input.decision,
        sinceMs,
      });
      // Filtra: mesmo direction (up/down) e entryTime > sinceMs (i.e. dentro da janela)
      const recentSameDir = recent.filter(
        (t) => t.direction === input.direction && t.entryTime >= sinceMs && t.entryTime < input.entryTime,
      );
      if (recentSameDir.length > 0) {
        // Cooldown ativo: rejeita novo trade (não salva).
        return null;
      }
    }

    const trade = openShadowTrade(input);
    this.shadowRepo.save(trade);
    return trade;
  }

  /**
   * Avalia shadow trades pendentes cujo horizonte JÁ decorreu.
   * Retorna contagem por outcome. Causalidade: só consulta candles futuros
   * depois do horizonte passar (não inventa dados).
   * Retorna null se shadowRepo não foi injetado.
   */
  async evaluatePendingShadows(horizon: number): Promise<{ evaluated: number; outcomes: Record<ShadowOutcome, number> } | null> {
    if (!this.shadowRepo) return null;
    const now = Date.now();
    // janela "horizonte já decorrido": limitamos por entry_time <= now - horizon*step
    // Para cada timeframe distinto dos pendentes, calculamos o limite correto.
    const pending = this.shadowRepo.list();
    let evaluated = 0;
    const outcomes: Record<ShadowOutcome, number> = {
      pending: 0, hit: 0, miss: 0, flat: 0, insufficient: 0, stopped: 0,
    };

    for (const trade of pending) {
      if (trade.outcome !== "pending") continue;
      const tf = trade.timeframe as Timeframe;
      const step = TIMEFRAME_MS[tf];
      if (!step) continue;
      const exitTime = trade.entryTime + horizon * step;
      if (exitTime > now) continue; // horizonte ainda não decorreu

      const candles = this.candles(trade.symbol, tf);
      const futureCandles = candles
        .filter((c) => c.timestamp >= trade.entryTime)
        .map((c) => ({ timestamp: c.timestamp, close: c.close }));
      const evaluatedTrade = evaluateShadowTrade(trade, futureCandles, horizon, this.cfg.minMovePct);
      if (evaluatedTrade.outcome === "pending") continue; // não deveria acontecer

      this.shadowRepo.update(trade.id, {
        exitTime: evaluatedTrade.exitTime,
        exitPrice: evaluatedTrade.exitPrice,
        outcome: evaluatedTrade.outcome,
        returnPct: evaluatedTrade.returnPct,
        evaluatedAt: evaluatedTrade.evaluatedAt,
        stopLossTriggeredAt: evaluatedTrade.stopLossTriggeredAt ?? null,
      });
      outcomes[evaluatedTrade.outcome]++;
      evaluated++;
    }
    return { evaluated, outcomes };
  }

  private outcomeOf(rec: DecisionRecord, entry: number, exit: number): Outcome {
    if (entry === 0) return "flat";
    const pct = ((exit - entry) / entry) * 100;
    if (Math.abs(pct) < this.cfg.minMovePct) return "flat";
    // decisão BUY espera up; SELL espera down; WAIT não é avaliado direcional.
    if (rec.decision === "WAIT") return "flat";
    const expectedUp = rec.decision === "BUY";
    if (expectedUp) return pct > 0 ? "hit" : "miss";
    return pct < 0 ? "hit" : "miss";
  }
}
