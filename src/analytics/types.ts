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
export type Outcome = "hit" | "miss" | "flat" | "stalled" | "error" | "pending";
export type ProbabilitySource = "provided" | "derived_directional" | "unavailable";

/**
 * Estados semânticos distintos:
 *  - "pending": registrada mas horizonte ainda não decorreu (ou nunca tentado).
 *  - "hit"/"miss"/"flat": resultado observado dentro do horizonte, válido.
 *  - "stalled": scheduler tentou avaliar, mas candles futuros indisponíveis
 *     (provider offline, gap, dados atrasados). Distinto de pending para que
 *     a calibração não confunda "nunca tentou" com "tentou mas falhou".
 *  - "error": erro operacional durante avaliação (ex.: exception).
 *     NÃO entrar em calibração win/loss.
 */
export interface DecisionRecord {
  readonly id: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: string;
  readonly decision: DecisionDirection;
  readonly horizon: number;
  readonly entryTime: number;
  readonly entryPrice: number | null;
  readonly score: number;
  readonly confidence: number;
  readonly probability: number | null;
  /** Immutable three-way distribution captured at decision time. */
  readonly pBuy?: number | null;
  readonly pSell?: number | null;
  readonly pWait?: number | null;
  readonly probabilitySource?: ProbabilitySource;
  /** P-A: Platt-scaled probability learnt from `(symbol, timeframe, regime)`. Null se n<30. */
  readonly probabilityCalibrated?: number | null;
  readonly sampleSize: number;
  readonly regime: string | null;
  readonly rationale: string;
  /** Provider/clock/versão no momento do registro (snapshots p/ auditoria). */
  readonly providerId: string | null;
  readonly modelVersion: string | null;
  readonly featureVersion: string | null;
  /** preenchido quando o resultado posterior é avaliado. */
  readonly outcome: Outcome;
  readonly exitTime: number | null;
  readonly exitPrice: number | null;
  /** P-T: retorno líquido em pontos percentuais (descontados fees + slippage). */
  readonly returnPct: number | null;
  /** P-T: retorno bruto em PP (antes dos custos). Usado para auditoria de sensibilidade. */
  readonly grossReturnPct: number | null;
  /** P-T: custo total descontado em PP (ROUND_TRIP_COST_PP por padrão). */
  readonly costPct: number | null;
  readonly evaluatedAt: number | null;
  /** P-R: rastreabilidade do scheduler. */
  readonly evaluationAttempts: number;
  readonly lastEvaluationError: string | null;
  readonly evaluationLocked: boolean;
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
