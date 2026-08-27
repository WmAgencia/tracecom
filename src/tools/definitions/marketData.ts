/**
 * Definições das ferramentas de dados de mercado.
 *
 * Toda ferramenta aqui lê de um `MarketDataProvider`. Sem provider real, o
 * provider "noop" retorna DATA_UNAVAILABLE — nunca dados inventados. O esquema
 * de instrumento/timeframe é compartilhado entre elas.
 *
 * Cada ferramenta é registrada diretamente no `ToolRegistry.register`, que
 * infere a tipagem do schema e do handler (preservando a checagem no ponto de
 * definição, sem perda de tipagem).
 */
import { z } from "zod";
import type { Timeframe } from "../../domain/types";
import type { MarketDataProvider } from "../../market/provider";
import type { ToolRegistry } from "../registry";

export type { Timeframe };

/** Resolve a string de ativo para um Instrument de domínio. */
export type InstrumentResolver = (symbol: string) => {
  readonly symbol: string;
  readonly label: string;
  readonly kind: "spot" | "perpetual" | "future" | "stock";
  readonly quote: string;
  readonly providerId: string;
};

const instrumentSchema = z.object({
  symbol: z.string().min(2).describe("Símbolo do instrumento, ex.: BTCUSDT ou AAPL."),
});

const timeframeSchema = z
  .enum(["1m", "3m", "5m", "15m", "1h", "4h", "1d", "1w"])
  .describe("Timeframe dos candles.");

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .describe("Quantidade de candles/linhas a retornar.");

function toQuery(
  resolver: InstrumentResolver,
  symbol: string,
  extra: { timeframe?: Timeframe; limit?: number } = {},
) {
  const inst = resolver(symbol);
  return {
    instrument: {
      symbol: inst.symbol,
      label: inst.label,
      kind: inst.kind,
      quote: inst.quote,
      providerId: inst.providerId,
    },
    ...(extra.timeframe ? { timeframe: extra.timeframe } : {}),
    ...(extra.limit !== undefined ? { limit: extra.limit } : {}),
  };
}

/** Registra todas as ferramentas de dados de mercado no registry. */
export function registerMarketDataTools(
  registry: ToolRegistry,
  provider: MarketDataProvider,
  resolver: InstrumentResolver,
): void {
  registry
    .register({
      name: "get_market_data",
      description:
        "Obter o snapshot atual de preço do instrumento (último preço, alta/baixa, variação).",
      schema: instrumentSchema,
      handler: async (args) => provider.ticker(toQuery(resolver, args.symbol)),
    })
    .register({
      name: "get_candles",
      description:
        "Obter candles OHLCV do instrumento para um timeframe e quantidade especificados.",
      schema: instrumentSchema.extend({ timeframe: timeframeSchema, limit: limitSchema }),
      handler: async (args) =>
        provider.candles(toQuery(resolver, args.symbol, { timeframe: args.timeframe, limit: args.limit })),
    })
    .register({
      name: "get_volume",
      description: "Obter métricas de volume (total, média, contagem) do instrumento.",
      schema: instrumentSchema.extend({ timeframe: timeframeSchema, limit: limitSchema }),
      handler: async (args) =>
        provider.volume(toQuery(resolver, args.symbol, { timeframe: args.timeframe, limit: args.limit })),
    })
    .register({
      name: "get_order_book",
      description: "Obter o book de ordens (bid/ask) sempre que o provider suportar.",
      schema: instrumentSchema.extend({ limit: limitSchema }),
      handler: async (args) =>
        provider.orderBook(toQuery(resolver, args.symbol, { limit: args.limit })),
    })
    .register({
      name: "get_liquidity_metrics",
      description: "Obter métricas de liquidez (profundidade, spread, desequilíbrio de book).",
      schema: instrumentSchema,
      handler: async (args) => provider.liquidity(toQuery(resolver, args.symbol)),
    })
    .register({
      name: "get_funding_data",
      description: "Obter dados de funding rate do perpétuo, quando aplicável.",
      schema: instrumentSchema,
      handler: async (args) => provider.funding(toQuery(resolver, args.symbol)),
    })
    .register({
      name: "get_open_interest",
      description: "Obter open interest e variação do instrumento, quando aplicável.",
      schema: instrumentSchema,
      handler: async (args) => provider.openInterest(toQuery(resolver, args.symbol)),
    });
}
