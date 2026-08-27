/**
 * Modelo de análise persistível.
 *
 * Separa o domínio (types.ts — puros) da camada de persistência. Aqui ficam
 * utilitários de construção e serialização de uma `Analysis` para o repositório
 * relacional, incluindo o pipeline de auditoria (INPUT → DADOS → INDICADORES →
 * FONTES → EVIDÊNCIAS → CONTRAPROVAS → CÁLCULOS → FUSION → DECISÃO).
 */
import { randomUUID } from "node:crypto";
import type {
  Analysis,
  AnalysisTrail,
  Evidence,
  Instrument,
  ToolCallAudit,
  Timeframe,
} from "../domain/types";
import type { EngineVersion } from "../domain/types";

export interface BaseAnalysisParams {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly horizon: string;
  readonly input: string;
  readonly version: EngineVersion;
  readonly createdAt?: number;
}

export class AnalysisBuilder {
  readonly #p: BaseAnalysisParams;
  #favorable: string[] = [];
  #counter: string[] = [];
  #invalidators: string[] = [];
  #sources: string[] = [];
  #evidence: Evidence[] = [];
  #counterEvidence: Evidence[] = [];
  #toolCalls: ToolCallAudit[] = [];
  #indicators: string[] = [];
  #calculations: string[] = [];
  #steps: string[] = [];
  #observed: string[] = [];

  constructor(p: BaseAnalysisParams) {
    this.#p = p;
  }

  addFavorable(f: string): this {
    this.#favorable.push(f);
    return this;
  }
  addCounter(f: string): this {
    this.#counter.push(f);
    return this;
  }
  addInvalidator(f: string): this {
    this.#invalidators.push(f);
    return this;
  }
  addSource(f: string): this {
    this.#sources.push(f);
    return this;
  }
  addEvidence(e: Evidence): this {
    this.#evidence.push(e);
    return this;
  }
  addCounterEvidence(e: Evidence): this {
    this.#counterEvidence.push(e);
    return this;
  }
  addIndicator(s: string): this {
    this.#indicators.push(s);
    return this;
  }
  addCalculation(s: string): this {
    this.#calculations.push(s);
    return this;
  }
  addStep(s: string): this {
    this.#steps.push(s);
    return this;
  }
  addObservation(s: string): this {
    this.#observed.push(s);
    return this;
  }

  /**
   * Registra uma chamada de ferramenta no rastro de auditoria. Se `durationMs`
   * não for informado, é inferido a partir de startedAt/finishedAt.
   */
  recordToolCall(call: {
    readonly tool: string;
    readonly arguments: Record<string, unknown>;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly availability?: "AVAILABLE" | "UNAVAILABLE" | "STALE" | "PARTIAL";
    readonly error?: string;
  }): this {
    const durationMs = call.finishedAt - call.startedAt;
    this.#toolCalls.push({
      tool: call.tool,
      arguments: call.arguments,
      startedAt: call.startedAt,
      finishedAt: call.finishedAt,
      durationMs,
      ...(call.availability ? { availability: call.availability } : { availability: "UNKNOWN" as never }),
      ...(call.error ? { error: call.error } : {}),
    });
    return this;
  }

  /** Monta a análise final com o rastro de auditoria. */
  build(overrides?: Partial<Analysis>): Analysis {
    const trail: AnalysisTrail = {
      input: this.#p.input,
      steps: this.#steps,
      observed: this.#observed,
      indicators: this.#indicators,
      sources: [...new Set(this.#sources)],
      evidence: this.#evidence,
      counterEvidence: this.#counterEvidence,
      calculations: this.#calculations,
      toolCalls: this.#toolCalls,
    };
    return {
      id: randomUUID(),
      instrument: this.#p.instrument,
      timeframe: this.#p.timeframe,
      horizon: this.#p.horizon,
      decision: overrides?.decision ?? { direction: "WAIT", rationale: "Sem dados suficientes." },
      favorableFactors: this.#favorable,
      counterFactors: this.#counter,
      invalidators: this.#invalidators,
      sources: trail.sources,
      quality: overrides?.quality ?? "unknown",
      trail,
      version: this.#p.version,
      createdAt: this.#p.createdAt ?? Date.now(),
      incomplete: overrides?.incomplete ?? this.#toolCalls.length === 0,
      ...(overrides?.confidence !== undefined ? { confidence: overrides.confidence } : {}),
      ...(overrides?.empiricalProbability ? { empiricalProbability: overrides.empiricalProbability } : {}),
      ...(overrides?.technicalScore !== undefined ? { technicalScore: overrides.technicalScore } : {}),
      ...(overrides?.marketRegime ? { marketRegime: overrides.marketRegime } : {}),
      ...(overrides?.risk ? { risk: overrides.risk } : {}),
    };
  }
}

export const VERSION: EngineVersion = {
  engine: "tracecon-core",
  version: "0.1.0",
  model: "static/dry-run",
  promptVersion: "v0",
  agentVersion: "0.1.0",
};
