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
 * Binance (REST público, sem credencial). Qualquer outro modo na v2 devolve
 * null (PROVIDER_NOT_CONFIGURED) — nunca dados falsos, nunca conexão implícita.
 */
export function resolveProvider(config: Pick<EnvConfig, "marketDataMode" | "nodeEnv">): MarketDataProvider | null {
  if (config.marketDataMode === "binance") {
    return new BinanceProvider(new BinanceRestClient());
  }
  void config.nodeEnv;
  return null;
}
