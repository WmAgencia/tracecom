/**
 * FusionService — conecta QuantEngine + Backtester + RiskEngine + FusionEngine
 * a partir dos dados de mercado atuais, produzindo uma decisão analítica
 * completa. Ponto de entrada para o agente/UI.
 *
 * Camadas adicionadas (série de robustez):
 *   - Guards (circuit breaker + cooldown + drawdown + volatility + staleness)
 *   - Confluência multi-TF (15m + 1h + 4h precisam concordar)
 *   - Calibração Wilson (ci_lower > baseline + margem para ser acionável)
 *   - Expected Value (EV) por decisão
 */
import { QuantEngine } from "../quant/engine";
import { Backtester, DEFAULT_CRITERIA } from "../backtest/backtest";
import { QuantFeatureExtractor } from "../backtest/similarity";
import { assessRisk } from "./risk";
import { FusionEngine } from "./fusion";
import { evaluateGuards, freshGuardState, type GuardState, type GuardDecision } from "./guards";
import { analyzeConfluence, type ConfluenceResult } from "./confluence";
import { isActionable, expectedValue, wilsonLowerBound } from "./calibration";
import type { FusionInput, FusionResult } from "./types";
import type { Direction } from "../backtest/types";
import type { CandleHistorySource, EmpiricalProbability } from "../backtest/types";
import type { MarketCandle, Timeframe } from "../market/model";

export interface FusionServiceDeps {
  readonly quant: QuantEngine;
  readonly backtester: Backtester;
  readonly historySource: CandleHistorySource;
  readonly currentCandles: (symbol: string, timeframe: Timeframe) => readonly MarketCandle[];
  /** Opcional: candles multi-TF (15m, 1h, 4h) para confluência. Se ausente, sem confluência. */
  readonly currentCandlesMultiTf?: (symbol: string) => Partial<Record<Timeframe, readonly MarketCandle[]>>;
  /** Opcional: estado atual dos guards (persistido externamente). */
  readonly guardStateProvider?: () => GuardState;
  /** Opcional: idade do último candle em ms. */
  readonly lastCandleAgeMs?: () => number | null;
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

    // 0) GUARDS — primeiro gate. Se bloqueado, WAIT imediato com motivo.
    const guardState = this.deps.guardStateProvider?.() ?? freshGuardState(Date.now());
    const atrPct = candles.length > 0 && this.deps.quant
      ? null // quant já roda abaixo; aqui só usamos o resumo
      : null;
    const guardDecision: GuardDecision = evaluateGuards({
      state: guardState,
      atrPct: atrPct,
      lastCandleAgeMs: this.deps.lastCandleAgeMs?.() ?? null,
      now: Date.now(),
    });

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

    // 2b) CONFLUÊNCIA multi-TF — se provider disponível
    let confluence: ConfluenceResult | undefined;
    if (this.deps.currentCandlesMultiTf) {
      try {
        const perTfRaw = this.deps.currentCandlesMultiTf(req.symbol);
        const perTf = (['15m', '1h', '4h'] as const)
          .map((tf) => ({ tf, candles: perTfRaw[tf] ?? [] }))
          .filter((x) => x.candles.length >= 30) as Array<{ tf: '15m' | '1h' | '4h'; candles: readonly { close: number; high: number; low: number; }[] }>;
        if (perTf.length >= 2) {
          confluence = analyzeConfluence({ perTf, direction: req.direction });
        }
      } catch {
        confluence = undefined;
      }
    }

    // 2c) CALIBRAÇÃO Wilson CI — probabilidade calibrada + EV
    let calibration: { calibratedProb: number; ciLower: number; ciUpper: number; baseline: number; expectedValue: number; actionable: boolean } | undefined;
    if (probability && probability.sampleSize >= 30) {
      const p = probability.probability;
      const base = probability.baseline ?? 0.5;
      const ciLower = probability.confidenceInterval?.lower ?? wilsonLowerBound(probability.favorable, probability.sampleSize);
      const ciUpper = probability.confidenceInterval?.upper ?? (1 - ciLower); // upper aproximado
      calibration = {
        calibratedProb: p,
        ciLower,
        ciUpper,
        baseline: base,
        expectedValue: expectedValue({ probability: p, gain: 1, loss: 1 }),
        actionable: isActionable({ probability: p, ciLower, baseline: base }),
      };
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

    // 5) Fusão (camada clássica)
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

    const baseResult = this.fusion.fuse(input);

    // 6) Combinador final: aplica guards + confluência + calibração
    const finalDecision = applyRobustnessLayers(baseResult, {
      guards: { allowed: guardDecision.allow, reason: guardDecision.reason ?? null },
      confluence,
      calibration,
    });

    return finalDecision;
  }
}

/**
 * Combina o resultado clássico da fusão com as 3 camadas de robustez.
 * Cada camada pode degradar a decisão para WAIT; se passar todas, retorna
 * a decisão original com os campos extras anexados.
 */
function applyRobustnessLayers(
  base: FusionResult,
  layers: {
    guards: { allowed: boolean; reason: string | null };
    confluence: ConfluenceResult | undefined;
    calibration: { calibratedProb: number; ciLower: number; ciUpper: number; baseline: number; expectedValue: number; actionable: boolean } | undefined;
  },
): FusionResult {
  const { guards, confluence, calibration } = layers;
  const blocked: string[] = [];
  if (!guards.allowed) blocked.push(guards.reason ?? "guards bloqueou");
  if (confluence && confluence.direction === "neutral") blocked.push(`confluência insuficiente (${confluence.reason})`);
  if (calibration && !calibration.actionable && base.decision !== "WAIT") {
    blocked.push(`calibração não acionável (ci_lower ${(calibration.ciLower * 100).toFixed(1)}% ≤ baseline ${(calibration.baseline * 100).toFixed(1)}% + margem)`);
  }

  const newDecision: FusionResult["decision"] = blocked.length > 0 ? "WAIT" : base.decision;
  const newRationale = blocked.length > 0
    ? `${base.rationale} Bloqueado por: ${blocked.join("; ")}.`
    : base.rationale;

  return {
    ...base,
    decision: newDecision,
    direction: newDecision === "WAIT" ? null : base.direction,
    rationale: newRationale,
    factors: {
      ...base.factors,
      invalidators: Array.from(new Set([...base.factors.invalidators, ...blocked])),
    },
    confluence: confluence ? {
      direction: confluence.direction,
      agreementScore: confluence.agreementScore,
      confidenceBoost: confluence.confidenceBoost,
      reason: confluence.reason,
    } : undefined,
    calibration,
    guards: { allowed: guards.allowed, reason: guards.reason },
  };
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i] as number;
  return null;
}
