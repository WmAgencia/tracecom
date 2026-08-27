/**
 * Data Quality Engine — valida candles/ticks/books e detecta problemas
 * (gaps, stale, atraso, fora de ordem, inválido).
 *
 * NUNCA fabrica: um candle inválido é REJEITADO (nunca corrigido com valor
 * inventado). Devolve a nota de qualidade e a lista de problemas.
 */
import type { MarketCandle, MarketTick, Timeframe } from "./model";
import { TIMEFRAME_MS } from "./model";

export type DataProblem =
  | "nan"
  | "infinity"
  | "non_positive_price"
  | "negative_volume"
  | "high_below_low"
  | "invalid_timestamp"
  | "open_out_of_range"
  | "close_out_of_range"
  | "stale"
  | "delayed"
  | "out_of_order"
  | "gap"
  | "duplicate"
  | "unknown_source";

export interface ValidationResult {
  readonly valid: boolean;
  readonly quality: MarketCandle["quality"];
  readonly problems: readonly DataProblem[];
  readonly gapDetected: boolean;
  readonly stale: boolean;
  readonly delayed: boolean;
  readonly outOfOrder: boolean;
}

/** Tolerância (ms) para considerar um candle "atrasado". */
export interface QualityConfig {
  readonly staleAfterMs: number;
  readonly delayedAfterMs: number;
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  staleAfterMs: 3 * TIMEFRAME_MS["5m"],
  delayedAfterMs: TIMEFRAME_MS["5m"],
};

function dedupe(...p: DataProblem[]): DataProblem[] {
  return p.filter((v, i, a) => a.indexOf(v) === i);
}

export class DataQualityEngine {
  constructor(private readonly cfg: QualityConfig = DEFAULT_QUALITY_CONFIG) {}

  validateCandle(input: {
    readonly candle: MarketCandle;
    readonly now?: number;
    readonly prev?: MarketCandle;
  }): ValidationResult {
    const { candle, now = Date.now(), prev } = input;
    const problems: DataProblem[] = [];

    if (Number.isNaN(candle.open) || Number.isNaN(candle.close) || Number.isNaN(candle.high) || Number.isNaN(candle.low) || Number.isNaN(candle.volume)) {
      problems.push("nan");
    }
    if (![candle.open, candle.close, candle.high, candle.low].every(Number.isFinite) ||
      !Number.isFinite(candle.volume)) {
      if (!problems.includes("nan")) problems.push("infinity");
    }
    if ([candle.open, candle.close, candle.high, candle.low].some((v) => v <= 0)) {
      problems.push("non_positive_price");
    }
    if (candle.volume < 0) problems.push("negative_volume");
    if (candle.high < candle.low) problems.push("high_below_low");
    if (!Number.isFinite(candle.timestamp) || candle.timestamp <= 0) problems.push("invalid_timestamp");
    if (!candle.source) problems.push("unknown_source");

    // Intervalo absurdo: múltiplo (ex.: 100x) em relação à faixa alta-baixa.
    const range = candle.high - candle.low;
    if (range > 0 && candle.close > (candle.open * 1.0) && Math.abs(candle.close - candle.open) / candle.open > 0.5) {
      problems.push("close_out_of_range");
    }
    if (range > 0 && (candle.open > candle.high * 1.02 || candle.open < candle.low * 0.98)) {
      problems.push("open_out_of_range");
    }

    // Temporal: stale = dado antigo (bucket bem no passado); delayed = atraso
    // estimado entre fechamento e recebimento acima do tolerado.
    if (now - candle.timestamp > this.cfg.staleAfterMs) problems.push("stale");
    if (candle.estimatedDelayMs !== undefined && candle.estimatedDelayMs > this.cfg.delayedAfterMs) {
      problems.push("delayed");
    }
    if (prev && candle.timestamp < prev.timestamp) problems.push("out_of_order");
    if (prev && candle.timestamp - prev.timestamp > TIMEFRAME_MS[candle.timeframe] * 1.5) {
      problems.push("gap");
    }

    // Tratamento de range inválido é fatal; demais degradam qualidade.
    const fatal = problems.includes("nan") || problems.includes("infinity") ||
      problems.includes("non_positive_price") || problems.includes("high_below_low") ||
      problems.includes("negative_volume") || problems.includes("invalid_timestamp") ||
      problems.includes("unknown_source");

    const quality: MarketCandle["quality"] = fatal
      ? "low"
      : problems.includes("gap") || problems.includes("stale") || problems.includes("delayed")
        ? "medium"
        : "high";

    return {
      valid: !fatal,
      quality,
      problems: dedupe(...problems),
      gapDetected: problems.includes("gap"),
      stale: problems.includes("stale"),
      delayed: problems.includes("delayed"),
      outOfOrder: problems.includes("out_of_order"),
    };
  }

  validateTick(tick: MarketTick): ValidationResult {
    const problems: DataProblem[] = [];
    if (Number.isNaN(tick.price) || !Number.isFinite(tick.price)) problems.push("nan");
    if (tick.price <= 0) problems.push("non_positive_price");
    if (tick.quantity < 0) problems.push("negative_volume");
    if (!Number.isFinite(tick.timestamp) || tick.timestamp <= 0) problems.push("invalid_timestamp");
    if (!tick.source) problems.push("unknown_source");

    const fatal = problems.includes("nan") || problems.includes("non_positive_price") ||
      problems.includes("invalid_timestamp") || problems.includes("unknown_source");

    return {
      valid: !fatal,
      quality: fatal ? "low" : "high",
      problems: dedupe(...problems),
      gapDetected: false,
      stale: false,
      delayed: false,
      outOfOrder: false,
    };
  }
}

/** Detector de gaps simples sobre uma lista ordenada de candles. */
export function detectGaps(candles: readonly MarketCandle[]): Array<{ readonly from: number; readonly to: number }> {
  const gaps: Array<{ from: number; to: number }> = [];
  if (candles.length < 2) return gaps;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    const expected = prev.timestamp + TIMEFRAME_MS[prev.timeframe];
    if (cur.timestamp > expected) {
      gaps.push({ from: expected, to: cur.timestamp });
    }
  }
  return gaps;
}
