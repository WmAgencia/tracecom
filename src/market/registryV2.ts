/**
 * Registry v2 — seleciona e constrói provedores de Market Data da camada
 * real-time. Nenhum provider é instanciado sem validação de configuração.
 *
 * Sem provedor configurado, `resolveProvider` retorna `null` e a camada de
 * serviço devolve `PROVIDER_NOT_CONFIGURED` — nunca dados falsos.
 *
 * Permitir trocar/default de provider sem alterar quant/agent/UI.
 */
import type { EnvConfig } from "../config/env";
import type { MarketDataProvider } from "./providerV2";
import { BinanceProvider, BinanceRestClient } from "./providers/binance/rest";
import { OandaMarketDataProvider } from "./providers/forex/oanda";
import { YahooForexProvider } from "./providers/forex/yahoo";
import { AutoForexProvider } from "./providers/forex/auto";
import { IqOptionMarketProvider } from "./providers/iqoption/provider";

/** Identificador do provedor padrão desta etapa. */
export const DEFAULT_PROVIDER = "binance";
/** Provedores que exigem credencial (não configuradas ainda). */
export const CREDENTIAL_PROVIDERS = ["alpaca"] as const;

export interface ProviderRegistryOptions {
  readonly binance?: boolean;
}

/**
 * Resolve o provedor de mercado ativo.
 * Retorna `null` quando a configuração não permite conectar (=> SERVICE usa
 * `PROVIDER_NOT_CONFIGURED`).
 *
 * Reconhecemos `MARKET_DATA_MODE=binance` para habilitar explicitamente a
 * Binance (REST público, sem credencial). `MARKET_DATA_MODE=forex` instancia
 * o adapter Dukascopy/Exchange Rates API (keyless, com fallback sintético).
 * Qualquer outro modo na v2 devolve null (PROVIDER_NOT_CONFIGURED).
 */
export function resolveProvider(
  config: Pick<EnvConfig, "marketDataMode" | "nodeEnv"> & Partial<Pick<EnvConfig, "oanda">>,
): MarketDataProvider | null {
  if (config.marketDataMode === "binance") {
    return new BinanceProvider(new BinanceRestClient());
  }
  if (config.marketDataMode === "forex") {
    const oanda = config.oanda;
    if (!oanda?.apiKey || !oanda.accountId) return null;
    return new OandaMarketDataProvider({
      apiKey: oanda.apiKey,
      accountId: oanda.accountId,
      baseUrl: oanda.baseUrl,
    });
  }
  if (config.marketDataMode === "auto") {
    const candidates: MarketDataProvider[] = [];
    const oanda = config.oanda;
    if (oanda?.apiKey && oanda.accountId) {
      candidates.push(new OandaMarketDataProvider({ apiKey: oanda.apiKey, accountId: oanda.accountId, baseUrl: oanda.baseUrl }));
    }
    candidates.push(new YahooForexProvider());
    return new AutoForexProvider(candidates);
  }
  if (config.marketDataMode === "iqoption") {
    // Recebe apenas frames numéricos e inbound da extensão; nunca autentica
    // contra a corretora nem emite comandos de negociação.
    return new IqOptionMarketProvider();
  }
  void config.nodeEnv;
  return null;
}
