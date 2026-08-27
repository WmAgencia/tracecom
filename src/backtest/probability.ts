/**
 * Probabilidade Empírica — derivada SOMENTE de dados observados.
 *
 * prob = favorable / sampleSize. Sempre acompanhada de amostra, período,
 * critérios, horizonte, metodologia, intervalo de confiança (quando
 * aplicável), desempenho out-of-sample, baseline e limitações.
 *
 * NUNCA uma "achologia" da LLM.
 */
import type { ConfidenceInterval, Direction, EmpiricalProbability } from "./types";

/** Intervalo de confiança Wilson (robusto para proporções, inclui n pequenos). */
export function wilsonInterval(successes: number, total: number, z = 1.96): ConfidenceInterval {
  if (total === 0) return { lower: 0, upper: 0, method: "wilson", level: 0.95 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return {
    lower: Math.max(0, (centre - margin) / denom),
    upper: Math.min(1, (centre + margin) / denom),
    method: "wilson",
    level: 0.95,
  };
}

/** Intervalo de confiança Agresti-Coull. */
export function agrestiCoullInterval(successes: number, total: number, z = 1.96): ConfidenceInterval {
  if (total === 0) return { lower: 0, upper: 0, method: "agresti-coull", level: 0.95 };
  const z2 = z * z;
  const nTilde = total + z2;
  const pTilde = (successes + z2 / 2) / nTilde;
  const margin = z * Math.sqrt((pTilde * (1 - pTilde)) / nTilde);
  return { lower: Math.max(0, pTilde - margin), upper: Math.min(1, pTilde + margin), method: "agresti-coull", level: 0.95 };
}

/** Interface da entrada para calcular a probabilidade empírica. */
export interface EmpiricalInput {
  readonly favorable: number;
  readonly sampleSize: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly similarityCriteria: string;
  readonly horizon: string;
  readonly methodology: string;
  readonly outOfSample: boolean;
  readonly baseline?: number | null;
  readonly intervalMethod?: "wilson" | "agresti-coull";
  readonly limitations?: readonly string[];
}

export function empiricalProbability(input: EmpiricalInput): EmpiricalProbability {
  const sampleSize = Math.max(0, input.sampleSize);
  const prob = sampleSize === 0 ? 0 : input.favorable / sampleSize;
  const ci = sampleSize > 0
    ? input.intervalMethod === "agresti-coull"
      ? agrestiCoullInterval(input.favorable, sampleSize)
      : wilsonInterval(input.favorable, sampleSize)
    : null;
  return {
    probability: prob,
    sampleSize,
    favorable: input.favorable,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    similarityCriteria: input.similarityCriteria,
    horizon: input.horizon,
    methodology: input.methodology,
    confidenceInterval: ci,
    outOfSample: input.outOfSample,
    baseline: input.baseline ?? null,
    limitations: input.limitations ?? [],
  };
}

/** Avalia se a direção esperada ocorreu no horizonte (usando só candle do futuro). */
export function evaluateOutcome(candles: readonly { timestamp: number; close: number }[], entryIndex: number, target: { direction: Direction; horizon: number; minMovePct: number }): "hit" | "miss" | "flat" | "insufficient" {
  const exitIndex = entryIndex + target.horizon;
  if (exitIndex >= candles.length) return "insufficient";
  const entry = candles[entryIndex]!.close;
  const exit = candles[exitIndex]!.close;
  if (entry === 0) return "insufficient";
  const pct = ((exit - entry) / entry) * 100;
  if (Math.abs(pct) < target.minMovePct) return "flat";
  if (target.direction === "up") return pct > 0 ? "hit" : "miss";
  return pct < 0 ? "hit" : "miss";
}
