/**
 * Tipos do motor de Backtest / Probabilidade Empírica.
 *
 * PRINCÍPIO CENTRAL: a probabilidade é DERIVADA de dados (favoráveis / amostra),
 * nunca inventada pela LLM. Cada resultado carrega amostra, período, critérios,
 * horizonte, resultado, metodologia, intervalo estatístico, desempenho
 * out-of-sample, baseline e limitações.
 */

import type { MarketCandle, Timeframe } from "../market/model";

/** Direção de uma variável de resultado. */
export type Direction = "up" | "down";

/** Condição alvo de uma operação candidata. */
export interface SetupTarget {
  /** direção esperada (up = alta futura, down = queda futura). */
  readonly direction: Direction;
  /** horizonte de avaliação em candles (ex.: 5 candles à frente). */
  readonly horizon: number;
  /** tolerância mínima de variação p/ considerar "sucesso" (ex.: 0.5%). */
  readonly minMovePct: number;
}

/**
 * Vector de características de um setup (de um ponto no tempo).
 * Cada feature é calculada APENAS com dados até aquele instante (nunca futura).
 */
export interface SetupVector {
  readonly timestamp: number;
  readonly features: Readonly<Record<string, number>>;
}

/** Critérios de similaridade (quais features + pesos). */
export interface SimilarityCriteria {
  readonly weights: Readonly<Record<string, number>>;
  /** tolerâncias (absolutas) por feature para o mesmo bucket de similaridade. */
  readonly tolerance: Readonly<Record<string, number>>;
  /** número mínimo de vizinhos para a amostra ser considerada útil. */
  readonly minSampleSize: number;
  /** valor de similaridade (0..1) acima do qual um vizinho é contado. */
  readonly similarityThreshold: number;
}

/** Uma "situação histórica semelhante" encontrada. */
export interface SimilarSetup {
  readonly timestamp: number;
  readonly similarity: number; // 0..1
  readonly features: Readonly<Record<string, number>>;
}

/** Resultado de uma similaridade search. */
export interface SimilarSetupResult {
  readonly vector: SetupVector;
  readonly criteria: SimilarityCriteria;
  readonly matches: readonly SimilarSetup[];
  readonly sampleSize: number;
  readonly totalCandidates: number;
  readonly generatedAt: number;
}

/** Intervalo de confiança para uma proporção binomial. */
export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly method: "wald" | "wilson" | "agresti-coull";
  readonly level: number; // 0.95
}

/**
 * Probabilidade empírica observada.
 * Nunca estimada pela LLM — sempre derivada de uma amostra.
 */
export interface EmpiricalProbability {
  readonly probability: number; // 0..1
  readonly sampleSize: number;
  readonly favorable: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly similarityCriteria: string;
  readonly horizon: string;
  readonly methodology: string;
  readonly confidenceInterval: ConfidenceInterval | null;
  readonly outOfSample: boolean;
  readonly baseline: number | null; // prob. de sucesso sem filtro (taxa base)
  readonly limitations: readonly string[];
}

/** Resultado individual de um passo de backtest. */
export interface BacktestStep {
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly setup: Readonly<Record<string, number>>;
  readonly similarity: number;
  readonly outcome: "hit" | "miss" | "flat" | "insufficient";
  readonly returnPct: number;
  readonly exitTime: number;
  readonly exitPrice: number;
}

/** Métricas do backtest. */
export interface BacktestMetrics {
  readonly totalTrades: number;
  readonly wins: number;
  readonly winRate: number; // 0..1
  readonly avgReturn: number;
  readonly netReturn: number; // média (retorno líquido)
  readonly profitFactor: number | null; // brutos ganhos / brutos perdidos
  readonly maxDrawdown: number; // % (negativo)
  readonly baselineWinRate: number | null;
}

/** Relatório completo de um backtest. */
export interface BacktestResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly target: SetupTarget;
  readonly criteria: SimilarityCriteria;
  readonly steps: readonly BacktestStep[];
  readonly metrics: BacktestMetrics;
  readonly periodStart: number;
  readonly periodEnd: number;
  /** in-sample vs out-of-sample split. */
  readonly split: { readonly oosStartTime: number; readonly oosRatio: number };
  readonly outOfSampleMetrics: BacktestMetrics;
  readonly generatedAt: number;
}

/** Parâmetros de consulta de candles históricos. */
export interface CandleHistoryQuery {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly start: number;
  readonly end: number;
}

/** Fonte de candles históricos para o backtest (pode ser REST ou cold store). */
export interface CandleHistorySource {
  getCandles(params: CandleHistoryQuery): Promise<MarketCandle[]>;
}
