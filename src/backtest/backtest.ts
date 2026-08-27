/**
 * Backtester — varre o histórico, encontra setups semelhantes a um alvo e mede
 * o resultado dentro do horizonte, separando out-of-sample.
 *
 * CAUSALIDADE: cada setup em `i` só usa candles `<= i` (features causais) e o
 * resultado é avaliado em `i + horizon` (futuro), mas o uso de `i+horizon` é
 * apenas para medirmos o resultado — nunca incorporado às features do setup.
 * Nenhum stat usa informação do futuro para DESCREVER o momento da entrada.
 */
import type { MarketCandle, Timeframe } from "../market/model";
import type {
  BacktestResult, BacktestMetrics, BacktestStep, CandleHistorySource,
  SetupTarget, SimilarityCriteria,
} from "./types";
import { QuantFeatureExtractor, findSimilar, similarityBetween } from "./similarity";
import { empiricalProbability, evaluateOutcome } from "./probability";
import type { EmpiricalProbability } from "./types";

export const DEFAULT_CRITERIA: SimilarityCriteria = {
  weights: { rsi: 1.5, pctFromSma: 2, slope: 1.5, atrPct: 1, volatility: 1, macdHistNorm: 1.5 },
  tolerance: { rsi: 8, pctFromSma: 0.01, slope: 1.5, atrPct: 0.005, volatility: 0.005, macdHistNorm: 1 },
  minSampleSize: 30,
  similarityThreshold: 0.8,
};

export interface BacktestOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly target: SetupTarget;
  readonly criteria?: Partial<SimilarityCriteria>;
  /** fração (0..1) da série reservada para out-of-sample (do fim). */
  readonly oosRatio?: number;
  readonly source: CandleHistorySource;
}

export class Backtester {
  /**
   * Encontra setups semelhantes a um vetor-alvo e retorna a probabilidade
   * empírica (favoráveis/amostra) com CI e baseline.
   */
  async probabilityForSetup(params: {
    readonly candles: readonly MarketCandle[];
    readonly queryIndex: number;
    readonly target: SetupTarget;
    readonly criteria: SimilarityCriteria;
    /** fração out-of-sample (do fim) usada para separar a métrica OOS. */
    readonly oosRatio?: number;
  }): Promise<EmpiricalProbability> {
    const { candles, queryIndex, target, criteria } = params;
    const extractor = new QuantFeatureExtractor();
    const query = { timestamp: candles[queryIndex]!.timestamp, features: extractor.extract(candles, queryIndex) };
    const { matches } = findSimilar(query, candles, extractor, criteria);

    let favorable = 0;
    let sample = 0;
    let baselineFavorable = 0;
    let baselineSample = 0;
    const oosStart = params.oosRatio ? candles.length - Math.floor(candles.length * params.oosRatio) : candles.length;

    for (const m of matches) {
      // ícel do setup semelhante — é o momento da "entrada virtual"
      const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
      if (idx < 0) continue;
      const index = idx;
      const outcome = evaluateOutcome(candles, index, target);
      if (outcome === "insufficient") continue;
      sample++;
      if (outcome === "hit") favorable++;
      // baseline: taxa base de sucesso em TODA a região de entrada válida (in+oos)
      const outcomeBase = evaluateOutcome(candles, index, target);
      // baseline limitado ao período de treino (antes do OOS) p/ não vazar
      if (index < oosStart) {
        if (outcomeBase !== "insufficient" && outcomeBase !== "flat") {
          baselineSample++;
          if (outcomeBase === "hit") baselineFavorable++;
        }
      }
    }

    const baseline = baselineSample > 0 ? baselineFavorable / baselineSample : null;
    const oosWorked = countFavorable(candles, matches, target, oosStart);
    void oosWorked;

    return empiricalProbability({
      favorable,
      sampleSize: sample,
      periodStart: candles[0]?.timestamp ?? 0,
      periodEnd: candles[candles.length - 1]?.timestamp ?? 0,
      similarityCriteria: JSON.stringify(criteria.weights),
      horizon: `${target.horizon} candles`,
      methodology: "similaridade de features causais; prob = favoráveis/amostra; Wilson CI",
      outOfSample: false,
      baseline,
      limitations: ["prob. observada em amostra in-sample; validar out-of-sample antes de usar."],
    });
  }

  /** Rodada completa de backtest com split OOS. */
  async run(opts: BacktestOptions): Promise<BacktestResult> {
    const candles = await opts.source.getCandles({
      symbol: opts.symbol, timeframe: opts.timeframe, start: 0, end: Date.now(),
    });
    const criteria: SimilarityCriteria = { ...DEFAULT_CRITERIA, ...opts.criteria };
    const oosRatio = opts.oosRatio ?? 0.25;
    const oosStartTime = candles[Math.floor(candles.length * (1 - oosRatio))]?.timestamp ?? (candles[candles.length - 1]?.timestamp ?? 0);
    const extractor = new QuantFeatureExtractor();
    const vectors = extractor.extractAll(candles);

    const steps: BacktestStep[] = [];
    let querySample = Math.floor(candles.length * (1 - oosRatio));

    // Padrão de referência = setup do fim do treino (in-sample). É conhecido
    // (features causais no seu próprio instante). Os matches avaliam a rolagem
    // da série INTEIRA (inclui OOS) para medir o desempenho OOS real.
    const queryIdx = Math.max(0, querySample - 1);
    const query = { timestamp: candles[queryIdx]!.timestamp, features: vectors[queryIdx]! };

    const { matches } = findSimilar(query, candles, extractor, criteria, { includeAfterQuery: true, searchEndIndex: candles.length - 1 });
    for (const m of matches) {
      const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
      if (idx < 0) continue;
      const outcome = evaluateOutcome(candles, idx, opts.target);
      if (outcome === "insufficient") continue;
      const entry = candles[idx]!;
      const exit = candles[idx + opts.target.horizon] ?? entry;
      steps.push({
        entryTime: entry.timestamp,
        entryPrice: entry.close,
        setup: m.features,
        similarity: m.similarity,
        outcome,
        returnPct: ((exit.close - entry.close) / (entry.close || 1)) * 100,
        exitTime: exit.timestamp,
        exitPrice: exit.close,
      });
    }

    const inSteps = steps.filter((s) => s.entryTime < oosStartTime);
    const oosSteps = steps.filter((s) => s.entryTime >= oosStartTime);

    return {
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      target: opts.target,
      criteria,
      steps,
      metrics: metricsOf(inSteps),
      periodStart: candles[0]?.timestamp ?? 0,
      periodEnd: candles[candles.length - 1]?.timestamp ?? 0,
      split: { oosStartTime, oosRatio },
      outOfSampleMetrics: metricsOf(oosSteps),
      generatedAt: Date.now(),
    };
  }
}

function countFavorable(
  candles: readonly MarketCandle[],
  matches: readonly { timestamp: number }[],
  target: SetupTarget,
  oosStart: number,
): { in: number; oos: number } {
  let inH = 0, oosH = 0;
  for (const m of matches) {
    const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
    if (idx < 0) continue;
    const o = evaluateOutcome(candles, idx, target);
    if (o !== "hit") continue;
    if (idx < oosStart) inH++;
    else oosH++;
  }
  return { in: inH, oos: oosH };
}

function metricsOf(steps: readonly BacktestStep[]): BacktestMetrics {
  const valid = steps.filter((s) => s.outcome === "hit" || s.outcome === "miss");
  const wins = valid.filter((s) => s.outcome === "hit").length;
  const total = valid.length;
  const returns = valid.map((s) => s.returnPct);
  const grossWins = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(returns.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const net = returns.reduce((a, b) => a + b, 0);
  let peak = 0;
  let mdd = 0;
  let cum = 0;
  for (const r of returns) {
    cum += r;
    peak = Math.max(peak, cum);
    mdd = Math.min(mdd, cum - peak);
  }
  return {
    totalTrades: total,
    wins,
    winRate: total === 0 ? 0 : wins / total,
    avgReturn: total === 0 ? 0 : net / total,
    netReturn: net,
    profitFactor: grossLosses === 0 ? (grossWins > 0 ? null : null) : grossWins / grossLosses,
    maxDrawdown: mdd,
    baselineWinRate: null,
  };
}
