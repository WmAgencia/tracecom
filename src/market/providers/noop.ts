/**
 * Provider "noop": não conectado a fonte alguma.
 *
 * Toda leitura retorna DATA_UNAVAILABLE. Este é o estado de fábrica do
 * sistema: nenhum dado é inventado até termos um provider real validado.
 */
import type { Candle, ToolResult } from "../../domain/types";
import { dataUnavailable } from "../result";
import type {
  LiquidityMetrics,
  MarketDataProvider,
  MarketQuery,
} from "../provider";

const UNAVAILABLE_MSG = "Nenhum provider de dados de mercado conectado (noop).";

export class NoopProvider implements MarketDataProvider {
  readonly id = "noop";
  readonly available = false;
  readonly connectedAt: number | null = null;

  async candles(query: MarketQuery): Promise<ToolResult<Candle[]>> {
    void query;
    return dataUnavailable("get_candles", UNAVAILABLE_MSG);
  }

  async ticker(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    void query;
    return dataUnavailable("get_market_data", UNAVAILABLE_MSG);
  }

  async volume(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    void query;
    return dataUnavailable("get_volume", UNAVAILABLE_MSG);
  }

  async orderBook(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    void query;
    return dataUnavailable("get_order_book", UNAVAILABLE_MSG);
  }

  async liquidity(query: MarketQuery): Promise<ToolResult<LiquidityMetrics>> {
    void query;
    return dataUnavailable("get_liquidity_metrics", UNAVAILABLE_MSG);
  }

  async funding(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    void query;
    return dataUnavailable("get_funding_data", UNAVAILABLE_MSG);
  }

  async openInterest(query: MarketQuery): Promise<ToolResult<Record<string, unknown>>> {
    void query;
    return dataUnavailable("get_open_interest", UNAVAILABLE_MSG);
  }
}
