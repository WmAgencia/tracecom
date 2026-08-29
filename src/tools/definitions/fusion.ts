/**
 * Ferramenta de Fusão de Evidências (Etapa 5) para o agente (Anthropic).
 *
 * A IA nunca decide sozinha: esta tool executa o FusionService (quant + backtest
 * + risco + contraponto) e devolve uma decisão analítica. A IA pode então
 * interpretar/visualizar. Nenhum número é inventado.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry";
import type { FusionService } from "../../fusion/service";
import type { Direction } from "../../backtest/types";
import type { Timeframe } from "../../market/model";

const schema = z.object({
  symbol: z.string().min(2).describe("Símbolo, ex.: BTCUSDT."),
  timeframe: z.enum(["1m", "3m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe."),
  direction: z.enum(["up", "down"]).describe("Direção candidata (up = alta, down = queda)."),
  horizon: z.number().int().min(1).max(200).describe("Horizonte em candles à frente."),
  newsBias: z.enum(["up", "down", "neutral"]).optional().describe("Tendência de notícias quando houver."),
  eventRisk: z.boolean().optional().describe("Evento macro/notícia iminente."),
});

export function registerFusionTools(registry: ToolRegistry, service: FusionService): void {
  registry.register({
    name: "assess_market_decision",
    description:
      "Executar a fusão de evidências (técnico + histórico + risco + contraponto) de uma operação candidata e retornar a decisão BUY/SELL/WAIT com fatores favoráveis, contrários e invalidadores. Devolve WAIT quando não há dados suficientes ou quando contraprovas bloqueiam.",
    schema,
    handler: async (args) => {
      const result = await service.analyze({
        symbol: args.symbol,
        timeframe: args.timeframe as Timeframe,
        direction: args.direction as Direction,
        horizon: args.horizon,
        context: {
          ...(args.newsBias ? { newsBias: args.newsBias } : {}),
          ...(args.eventRisk !== undefined ? { eventRisk: args.eventRisk } : {}),
        },
      });
      return {
        availability: "AVAILABLE",
        decision: result.decision,
        direction: result.direction,
        score: result.score,
        confidence: result.confidence,
        technicalScore: result.technicalScore,
        probability: result.probability?.probability ?? null,
        sampleSize: result.sampleSize,
        regime: result.regime,
        risk: result.risk,
        favorableFactors: result.factors.favorable.map((f) => f.text),
        counterFactors: result.factors.counter.map((f) => f.text),
        invalidators: result.factors.invalidators,
        dataSufficient: result.dataSufficient,
        blockedByCounterEvidence: result.blockedByCounterEvidence,
        rationale: result.rationale,
      };
    },
  });
}
