/**
 * Ferramentas de Backtest / Probabilidade Empírica para o agente (Anthropic).
 *
 * A IA orquestra; o motor calcula. Nenhuma probabilidade é inventada pela LLM:
 * sempre derivada de favoráveis/amostra observados.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry";
import type { CandleHistorySource } from "../../backtest/types";
import { Backtester, DEFAULT_CRITERIA } from "../../backtest/backtest";
import { QuantFeatureExtractor, findSimilar } from "../../backtest/similarity";
import { evaluateOutcome } from "../../backtest/probability";
import type { Direction, SimilarityCriteria, SetupTarget } from "../../backtest/types";
import type { MarketCandle, Timeframe } from "../../market/model";

export interface BacktestDeps {
  /** Fonte de candles do cold store (ou pipeline). */
  readonly source: CandleHistorySource;
  /** getter do estado atual (pipeline) para o "alvo" ser o setup mais recente. */
  readonly currentCandles: (symbol: string, timeframe: Timeframe) => readonly MarketCandle[];
}

const targetSchema = z.object({
  symbol: z.string().min(2).describe("Símbolo, ex.: BTCUSDT."),
  timeframe: z.enum(["1m", "3m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe do histórico."),
  direction: z.enum(["up", "down"]).describe("Direção esperada (up = alta futura, down = queda)."),
  horizon: z.number().int().min(1).max(200).describe("Horizonte em candles à frente."),
  minMovePct: z.number().min(0).max(50).describe("Variação mínima (%) p/ considerar sucesso."),
  similarityThreshold: z.number().min(0.5).max(1).default(0.8).describe("Similaridade mínima p/ contar um vizinho."),
});

export function registerBacktestTools(registry: ToolRegistry, deps: BacktestDeps): void {
  const backtester = new Backtester();
  const extractor = new QuantFeatureExtractor();

  registry
    .register({
      name: "find_similar_market_setups",
      description:
        "Encontrar situações historicamente semelhantes ao cenário atual, retornando amostra, critérios e resultado posterior dentro do horizonte.",
      schema: targetSchema,
      handler: async (args) => {
        const candles = collect(deps, args.symbol, args.timeframe);
        if (candles.length < 30) return { availability: "UNAVAILABLE", message: "Histórico insuficiente." };
        const criteria: SimilarityCriteria = { ...DEFAULT_CRITERIA, similarityThreshold: args.similarityThreshold };
        const queryIdx = candles.length - 1;
        const query = { timestamp: candles[queryIdx]!.timestamp, features: extractor.extract(candles, queryIdx) };
        const { matches, totalCandidates } = findSimilar(query, candles, extractor, criteria);
        const target: SetupTarget = { direction: args.direction as Direction, horizon: args.horizon, minMovePct: args.minMovePct };
        let hit = 0, sample = 0;
        for (const m of matches) {
          const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
          const o = evaluateOutcome(candles, idx, target);
          if (o === "insufficient") continue;
          sample++; if (o === "hit") hit++;
        }
        return {
          availability: "AVAILABLE",
          totalCandidates,
          sampleSize: sample,
          favorable: hit,
          hitsInSampleDirection: sample > 0 ? hit / sample : null,
          topMatches: matches.slice(0, 5).map((m) => ({ timestamp: m.timestamp, similarity: m.similarity })),
        };
      },
    })
    .register({
      name: "calculate_empirical_probability",
      description:
        "Calcular a probabilidade empírica observada (favoráveis / amostra) de o cenário semelhante produzir o movimento esperado, com intervalo de confiança e baseline. NUNCA inventa: se não houver amostra, retorna sem probabilidade.",
      schema: targetSchema,
      handler: async (args) => {
        const candles = collect(deps, args.symbol, args.timeframe);
        if (candles.length < 30) return { availability: "UNAVAILABLE", message: "Histórico insuficiente." };
        const criteria: SimilarityCriteria = { ...DEFAULT_CRITERIA, similarityThreshold: args.similarityThreshold };
        const target: SetupTarget = { direction: args.direction as Direction, horizon: args.horizon, minMovePct: args.minMovePct };
        const prob = await backtester.probabilityForSetup({
          candles,
          queryIndex: candles.length - 1,
          target,
          criteria,
          oosRatio: 0.25,
        });
        return {
          availability: "AVAILABLE",
          probability: prob.probability,
          sampleSize: prob.sampleSize,
          favorable: prob.favorable,
          confidenceInterval: prob.confidenceInterval,
          baseline: prob.baseline,
          outOfSample: prob.outOfSample,
          horizon: prob.horizon,
          methodology: prob.methodology,
        };
      },
    })
    .register({
      name: "run_backtest",
      description:
        "Executar backtest sobre o histórico (com split out-of-sample) e retornar métricas: win rate, retorno médio, profit factor, max drawdown e comparar com baseline.",
      schema: targetSchema,
      handler: async (args) => {
        const result = await backtester.run({
          symbol: args.symbol,
          timeframe: args.timeframe,
          target: { direction: args.direction as Direction, horizon: args.horizon, minMovePct: args.minMovePct },
          criteria: { similarityThreshold: args.similarityThreshold },
          oosRatio: 0.25,
          source: deps.source,
        });
        return {
          availability: "AVAILABLE",
          symbol: result.symbol,
          timeframe: result.timeframe,
          totalTrades: result.metrics.totalTrades,
          winRate: result.metrics.winRate,
          avgReturn: result.metrics.avgReturn,
          netReturn: result.metrics.netReturn,
          profitFactor: result.metrics.profitFactor,
          maxDrawdown: result.metrics.maxDrawdown,
          outOfSample: result.outOfSampleMetrics,
          split: result.split,
        };
      },
    });
}

function collect(deps: BacktestDeps, symbol: string, timeframe: Timeframe): MarketCandle[] {
  return Array.from(deps.currentCandles(symbol, timeframe));
}
