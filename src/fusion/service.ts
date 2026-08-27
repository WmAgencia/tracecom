/**
 * FusionService — conecta QuantEngine + Backtester + RiskEngine + FusionEngine
 * a partir dos dados de mercado atuais, produzindo uma decisão analítica
 * completa. Ponto de entrada para o agente/UI.
 */
import { QuantEngine } from "../quant/engine";
import { Backtester, DEFAULT_CRITERIA } from "../backtest/backtest";
import { QuantFeatureExtractor } from "../backtest/similarity";
import { assessRisk } from "./risk";
import { FusionEngine } from "./fusion";
import type { FusionInput, FusionResult } from "./types";
import type { Direction } from "../backtest/types";
import type { CandleHistorySource, EmpiricalProbability } from "../backtest/types";
import type { MarketCandle, Timeframe } from "../market/model";

export interface FusionServiceDeps {
  readonly quant: QuantEngine;
  readonly backtester: Backtester;
  readonly historySource: CandleHistorySource;
  readonly currentCandles: (symbol: string, timeframe: Timeframe) => readonly MarketCandle[];
  /** Opcional: fonte de notícias reais p/ derivar viés de contexto (Direção). */
  readonly getNewsBias?: (asset: string) => Promise<"up" | "down" | "neutral" | null>;
}

export interface AnalyzeRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly direction: Direction;
  readonly horizon: number;
  readonly context?: {
    readonly newsBias?: Direction | "neutral";
    readonly macroBias?: Direction | "neutral";
    readonly eventRisk?: boolean;
  };
  readonly similarityThreshold?: number;
}

export class FusionService {
  private readonly fusion = new FusionEngine();
  private readonly extractor = new QuantFeatureExtractor();

  constructor(private readonly deps: FusionServiceDeps) {}

  async analyze(req: AnalyzeRequest): Promise<FusionResult> {
    const candles = Array.from(this.deps.currentCandles(req.symbol, req.timeframe));

    // 1) Quant
    const summary = candles.length > 0
      ? this.deps.quant.analyze({ candles, symbol: req.symbol, timeframe: req.timeframe })
      : null;

    const technical = {
      score: summary?.technicalScore ?? null,
      regime: summary?.regime.regime ?? null,
      structureTrend: summary?.structure.trend ?? null,
      rsi: summary ? lastNonNull(summary.indicators.rsi) : null,
      supports: summary?.levels.supports.map((l) => l.price) ?? [],
      resistances: summary?.levels.resistances.map((l) => l.price) ?? [],
    };

    // 2) Probabilidade empírica (do setup mais recente, causal)
    let probability: EmpiricalProbability | null = null;
    if (candles.length >= 30) {
      try {
        probability = await this.deps.backtester.probabilityForSetup({
          candles,
          queryIndex: candles.length - 1,
          target: { direction: req.direction, horizon: req.horizon, minMovePct: 0.3 },
          criteria: { ...DEFAULT_CRITERIA, similarityThreshold: req.similarityThreshold ?? 0.85 },
          oosRatio: 0.25,
        });
      } catch {
        probability = null;
      }
    }

    // 3) Risco
    const risk = assessRisk({
      regime: summary?.regime.regime ?? null,
      annualizedVolatility: summary ? summary.volatility.annualized * 100 : null,
      atrPct: summary?.volatility.atrPct ?? null,
      windowVolatility: summary?.volatility.windowVolatility ?? null,
      dataQuality: candles.length > 0 ? "high" : "unknown",
      eventRisk: req.context?.eventRisk ?? false,
      hasHistoricalSupport: probability ? probability.sampleSize >= 30 : false,
    });

    // 4) Notícias reais (se a fonte estiver disponível) para o viés de contexto.
    let newsBias: Direction | "neutral" | null = req.context?.newsBias ?? null;
    let eventRisk = req.context?.eventRisk ?? false;
    if (newsBias === null && this.deps.getNewsBias) {
      try {
        newsBias = await this.deps.getNewsBias(req.symbol) ?? null;
      } catch {
        newsBias = null;
      }
    }

    // 5) Fusão
    const input: FusionInput = {
      symbol: req.symbol,
      timeframe: req.timeframe,
      direction: req.direction,
      horizon: `${req.horizon} candles`,
      technical,
      probability,
      risk,
      context: {
        newsBias,
        macroBias: req.context?.macroBias ?? null,
        eventRisk,
      },
      dataQuality: candles.length > 0 ? "high" : "unknown",
    };

    return this.fusion.fuse(input);
  }
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i] as number;
  return null;
}
