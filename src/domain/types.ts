/**
 * Tipos de domínio da TRACECON.
 *
 * O domínio é o "cérebro" conceitual do sistema: representa instrumentos,
 * candles, timeframes, decisões e análises de forma independente de qualquer
 * fornecedor de dados, LLM ou frontend. Nenhuma destas entidades referencia
 * implementações concretas, o que permite trocar de provider ou de modelo
 * sem tocar no domínio.
 *
 * IMPORTANTE (princípio #1 do produto): nunca inventar dados. Todos os
 * resultados que dependem de fonte externa NÃO preenchida devem carregar
 * `availability = "UNAVAILABLE"` (ou o campo `sourceVerified = false`).
 * Aqui, tipos opcionais e o enum de disponibilidade expressam essa regra.
 */

/** Tipo de instrumento de mercado suportado. */
export type InstrumentKind = "spot" | "perpetual" | "future" | "stock";

/** Um ativo/mercado identificável (ex.: BTC/USDT na Binance). */
export interface Instrument {
  /** Símbolo canônico, ex.: "BTCUSDT" ou "AAPL". */
  readonly symbol: string;
  /** Label legível, ex.: "BTC/USDT". */
  readonly label: string;
  readonly kind: InstrumentKind;
  /** Moeda de referência, ex.: "USDT". */
  readonly quote: string;
  /** Fornecedor de dados associado (ver MarketDataProvider). */
  readonly providerId: string;
}

/** Timeframes suportados. Timeframes curtos são prioritários (1m/3m). */
export type Timeframe = "1m" | "3m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

/** Um candle OHLCV. Todos os valores são números (dados reais, nunca fictícios). */
export interface Candle {
  readonly timestamp: number; // ms desde a epoch (UTC)
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Direções possíveis de uma decisão analítica. "WAIT" é uma decisão válida. */
export type DecisionDirection = "BUY" | "SELL" | "WAIT";

/** Status de disponibilidade de uma fonte de dado. */
export type DataAvailability = "AVAILABLE" | "UNAVAILABLE" | "STALE" | "PARTIAL";

/** Qualidade percebida do dado entregue. */
export type DataQuality = "high" | "medium" | "low" | "unknown";

/**
 * Resultado estruturado fornecido por qualquer ferramenta de dados de mercado.
 * Quando `availability !== "AVAILABLE"`, os demais campos de dados não devem
 * ser preenchidos com valores fabricados: devem ser omitidos.
 */
export interface ToolResult<TPayload = unknown> {
  readonly tool: string;
  readonly availability: DataAvailability;
  readonly payload?: TPayload;
  /** Timestamp da coleta (ms). */
  readonly retrievedAt: number;
  /** Mensagem humana explicando indisponibilidade, quando aplicável. */
  readonly message?: string;
  readonly quality?: DataQuality;
  readonly source?: string;
}

/**
 * Base comum para toda observação de contexto. Notícias, eventos,
 * macro e correlações herdam este modelo.
 */
export interface Evidence {
  readonly id: string;
  readonly kind: "news" | "event" | "macro" | "correlation" | "signal";
  readonly headline: string;
  readonly summary?: string;
  readonly source: string;
  readonly publishedAt: number;
  readonly url?: string;
  /** direção do impacto quando avaliável; undefined = neutro/desconhecido. */
  readonly bias?: "bullish" | "bearish" | "neutral";
  readonly confidence?: number; // 0..1
  readonly verified: boolean;
  readonly timestamp: number; // quando foi registrado pela Tracecon (ms)
}

/** Estado de risco de uma análise. */
export interface RiskAssessment {
  readonly score: number; // 0..1 (1 = risco máximo)
  readonly level: "low" | "medium" | "high";
  readonly factors: readonly string[];
  readonly unknown: boolean;
}

/** Probabilidade empírica derivada de dados (nunca inventada). */
export interface EmpiricalProbability {
  readonly probability: number; // 0..1
  readonly sampleSize: number;
  readonly favorable: number;
  readonly periodStart: number; // ms
  readonly periodEnd: number; // ms
  readonly similarityCriteria: string;
  readonly horizon: string;
  readonly methodology: string;
  /** intervalo estatístico quando aplicável (ex.: CI 95%). */
  readonly confidenceInterval?: { readonly lower: number; readonly upper: number };
  readonly outOfSample?: boolean;
  readonly baseline?: number; // 0..1
  readonly limitations?: readonly string[];
}

/** Uma ferramenta executada durante a investigação (para auditoria). */
export interface ToolCallAudit {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly availability: DataAvailability;
  readonly error?: string;
}

/** O full registro de investigação de uma análise (auditoria da decisão). */
export interface AnalysisTrail {
  readonly input: string;
  readonly steps: readonly string[];
  readonly observed: readonly string[];
  readonly indicators: readonly string[];
  readonly sources: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly counterEvidence: readonly Evidence[];
  readonly calculations: readonly string[];
  readonly toolCalls: readonly ToolCallAudit[];
}

/** Metadados de versão registrados com cada análise (reprodutibilidade). */
export interface EngineVersion {
  readonly engine: string; // ex.: "tracecon-core"
  readonly version: string;
  readonly model: string; // ex.: "llama-3.1-70b-versatile"
  readonly promptVersion: string;
  readonly agentVersion: string;
}

/**
 * A estrutura consolidada de uma análise de mercado.
 * É o artefato entregue ao usuário e persistido para auditoria.
 */
export interface Analysis {
  readonly id: string;
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  /** horizonte de previsão, ex.: "5 candles" ou "1h". */
  readonly horizon: string;
  readonly decision: {
    readonly direction: DecisionDirection;
    readonly rationale: string;
  };
  readonly confidence?: number; // 0..1
  readonly empiricalProbability?: EmpiricalProbability;
  readonly technicalScore?: number; // -1..1
  readonly marketRegime?: string;
  readonly risk?: RiskAssessment;
  readonly favorableFactors: readonly string[];
  readonly counterFactors: readonly string[];
  readonly invalidators: readonly string[];
  readonly sources: readonly string[];
  readonly quality: DataQuality;
  readonly trail: AnalysisTrail;
  readonly version: EngineVersion;
  readonly createdAt: number;
  /** Ainda em investigação (dados insuficientes => WAIT). */
  readonly incomplete: boolean;
}
