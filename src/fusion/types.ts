/**
 * Tipos do motor de Fusão de Evidências + Contraponto (Etapa 5).
 *
 * A fusão combina evidências oriundas de fontes independentes:
 *   - técnico  (QuantEngine): technicalScore, padrões, estrutura;
 *   - histórico/prob. empírica (Backtester): prob observada vs baseline;
 *   - contexto (MarketContext / notícias / macro, quando disponível);
 *   - risco (RiskEngine): exposição, regime, volatilidade, liquidez.
 *
 * A fusão produz uma DECISÃO analítica (BUY/SELL/WAIT) com fatores favoráveis,
 * fatores contrários, invalidadores e qualidade. NUNCA inventa: se uma fonte
 * não tem dados, ela é declarada indisponível e não gera sinal.
 */
import type { Direction, EmpiricalProbability } from "../backtest/types";
import type { MarketRegime } from "../quant/types";

/** Decisão final. */
export type DecisionDirection = "BUY" | "SELL" | "WAIT";

/** Uma evidência (sinal de uma fonte) usada na fusão. */
export interface Evidence {
  readonly source: string; // "quant" | "backtest" | "risk" | "context" | ...
  readonly direction: Direction | "neutral";
  readonly strength: number; // 0..1
  readonly reliability: number; // 0..1 (confiança na fonte p/ este dado)
  readonly rationale: string;
  readonly available: boolean; // false = dado indisponível → não vira sinal
}

export interface RiskScore {
  readonly score: number; // 0..1 (1 = risco máximo)
  readonly level: "low" | "medium" | "high";
  readonly factors: readonly string[];
  readonly unknown: boolean;
}

/** Entrada consolidada do motor de fusão. */
export interface FusionInput {
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: Direction;
  readonly horizon: string;
  readonly technical: {
    readonly score: number | null; // -1..1
    readonly regime: MarketRegime | null;
    readonly structureTrend: string | null;
    readonly rsi: number | null;
    readonly supports: readonly number[];
    readonly resistances: readonly number[];
  };
  readonly probability: EmpiricalProbability | null;
  readonly risk: RiskScore;
  readonly context: {
    readonly newsBias: Direction | "neutral" | null;
    readonly macroBias: Direction | "neutral" | null;
    readonly eventRisk: boolean;
  };
  readonly dataQuality: "high" | "medium" | "low" | "unknown";
}

/** Um fator (favorável ou contrário) explicado. */
export interface Factor {
  readonly type: "favorable" | "counter";
  readonly source: string;
  readonly text: string;
  readonly weight: number; // 0..1
}

/** Resultado do motor de fusão. */
export interface FusionResult {
  readonly decision: DecisionDirection;
  readonly direction: Direction | null; // null quando WAIT
  readonly score: number; // -1..1 (agregação)
  readonly confidence: number; // 0..1
  readonly technicalScore: number | null;
  readonly probability: EmpiricalProbability | null;
  readonly risk: RiskScore;
  readonly regime: MarketRegime | null;
  readonly sampleSize: number;
  readonly factors: {
    readonly favorable: readonly Factor[];
    readonly counter: readonly Factor[];
    readonly invalidators: readonly string[];
  };
  readonly sources: readonly string[];
  readonly blockedByCounterEvidence: boolean;
  readonly dataSufficient: boolean;
  readonly rationale: string;
  readonly generatedAt: number;
  /** Camada de robustez: confluência multi-TF (se calculado) */
  readonly confluence?: {
    readonly direction: Direction | "neutral";
    readonly agreementScore: number;
    readonly confidenceBoost: number;
    readonly reason: string;
  };
  /** Camada de robustez: calibração Wilson CI + EV */
  readonly calibration?: {
    readonly calibratedProb: number;
    readonly ciLower: number;
    readonly ciUpper: number;
    readonly baseline: number;
    readonly expectedValue: number;
    readonly actionable: boolean;
  };
  /** Camada de robustez: status dos guards */
  readonly guards?: {
    readonly allowed: boolean;
    readonly reason: string | null;
  };
}
