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
