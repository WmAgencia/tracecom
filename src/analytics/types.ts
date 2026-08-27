/**
 * Tipos de registro e validação de decisões (Etapa 10).
 *
 * Ciclo de aprendizado estatístico:
 *   DECISÃO (fusão) → REGISTRO → RESULTADO POSTERIOR (horizonte) → VALIDAÇÃO.
 *
 * A calibração é derivada de dados observados (acerto/erro real do horizonte),
 * nunca inventada. Cada registro guarda a direção prevista, a direção do
 * movimento real, se alcançou a tolerância, e a duração até a validação.
 */
import type { DecisionDirection as FusionDirection } from "../fusion/types";

export type DecisionDirection = FusionDirection;
export type Outcome = "hit" | "miss" | "flat" | "pending";

export interface DecisionRecord {
  readonly id: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: string; // "up" | "down"
  readonly decision: DecisionDirection; // BUY/SELL/WAIT
  readonly horizon: number; // candles
  readonly entryTime: number; // ms
  readonly entryPrice: number | null;
  readonly score: number;
  readonly confidence: number;
  readonly probability: number | null;
  readonly sampleSize: number;
  readonly regime: string | null;
  readonly rationale: string;
  /** preenchido quando o resultado posterior é avaliado. */
  readonly outcome: Outcome;
  readonly exitTime: number | null;
  readonly exitPrice: number | null;
  readonly returnPct: number | null;
  readonly evaluatedAt: number | null;
  readonly createdAt: number;
}

/** Estatística agregada de uma estratégia/decisão. */
export interface DecisionStats {
  readonly total: number;
  readonly evaluated: number;
  readonly pending: number;
  readonly wins: number;
  readonly misses: number;
  readonly winRate: number | null; // sobre avaliados não-flat
  readonly avgReturn: number | null;
  readonly netReturn: number | null;
  readonly hitRate: number | null; // hit / (hit + miss)
  readonly validations: number;
  readonly lastEvaluatedAt: number | null;
}

/** Config de validação. */
export interface ValidationConfig {
  /** fração da tolerância mínima do movimento para contar como hit. */
  readonly minMovePct: number;
  /** profundeza de candles do histórico a consultar. */
  readonly lookback: number;
}
