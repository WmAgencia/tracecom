/**
 * Registry de providers de dados de mercado.
 *
 * É a fábrica central que decide qual `MarketDataProvider` instanciar com base
 * em `MarketDataMode`. Garante que, em modo `noop` (produção ainda sem provider
 * validado), NENHUM provider sintético seja utilizado — princípio: nunca
 * inventar dados.
 *
 * Para a camada v2 (real-time), ver `registryV2`.
 */
import type { EnvConfig } from "../config/env";
import { MockedProvider } from "./providers/mocked";
import { NoopProvider } from "./providers/noop";
import type { MarketDataMode, MarketDataProvider } from "./provider";

export function createMarketDataProvider(
  mode: MarketDataMode,
  opts: { syntheticBasePrice?: number; syntheticBaseVolume?: number } = {},
): MarketDataProvider {
  switch (mode) {
    case "mocked":
      return new MockedProvider({
        basePrice: opts.syntheticBasePrice ?? 100,
        baseVolume: opts.syntheticBaseVolume ?? 1000,
      });
    default:
      // noop ou qualquer modo sem connect (binance é tratado na registryV2).
      return new NoopProvider();
  }
}

export function providerFromConfig(config: Pick<EnvConfig, "marketDataMode">): MarketDataProvider {
  // A v1 só suporta noop/mocked; binance é resolvido na registryV2.
  const mode = config.marketDataMode === "binance" ? "noop" : config.marketDataMode;
  return createMarketDataProvider(mode);
}