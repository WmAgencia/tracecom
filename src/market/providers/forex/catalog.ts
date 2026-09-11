/**
 * Catálogo Forex: pares majors suportados pelo DukascopyForexProvider.
 *
 * - Símbolos no formato "BASEQUOTE" sem separador (ex.: "EURUSD").
 * - Pares baseados em USD (USDJPY, USDCAD) são "inversos" — a flag `isInverse`
 *   indica qual lado é a moeda cotada (USD ou a outra).
 * - `pipSize` segue convenção FX padrão: 0.0001 para a maioria, 0.01 para JPY.
 * - `typicalPriceUsd` é um anchor usado no modo sintético para evitar
 *   valores absurdos (sem dependência de feed em tempo real).
 */
export const FOREX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"] as const;
export type ForexPair = (typeof FOREX_PAIRS)[number];

/** Spread típico em pips para cada par major (referência, fora de stress). */
export const TYPICAL_SPREAD_PIPS: Record<ForexPair, number> = {
  EURUSD: 0.7,
  GBPUSD: 1.2,
  USDJPY: 0.9,
  AUDUSD: 1.4,
  USDCAD: 1.5,
};

/** Tamanho de 1 pip em decimal — 0.01 para JPY, 0.0001 para os demais. */
export const PIP_SIZE: Record<ForexPair, number> = {
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDJPY: 0.01,
  AUDUSD: 0.0001,
  USDCAD: 0.0001,
};

/** Anchor (preço médio aproximado) usado pelo modo sintético. */
export const TYPICAL_PRICE_USD: Record<ForexPair, number> = {
  EURUSD: 1.08,
  GBPUSD: 1.27,
  USDJPY: 155.5,
  AUDUSD: 0.66,
  USDCAD: 1.37,
};

/** Retorna metadata estática de um par ou null se não suportado. */
export interface ForexPairMeta {
  readonly symbol: ForexPair;
  readonly base: string;
  readonly quote: string;
  readonly pipSize: number;
  readonly typicalSpreadPips: number;
  readonly typicalPrice: number;
  readonly isInverse: boolean;
}

const PAIR_META: Record<ForexPair, ForexPairMeta> = {
  EURUSD: { symbol: "EURUSD", base: "EUR", quote: "USD", pipSize: PIP_SIZE.EURUSD, typicalSpreadPips: TYPICAL_SPREAD_PIPS.EURUSD, typicalPrice: TYPICAL_PRICE_USD.EURUSD, isInverse: false },
  GBPUSD: { symbol: "GBPUSD", base: "GBP", quote: "USD", pipSize: PIP_SIZE.GBPUSD, typicalSpreadPips: TYPICAL_SPREAD_PIPS.GBPUSD, typicalPrice: TYPICAL_PRICE_USD.GBPUSD, isInverse: false },
  USDJPY: { symbol: "USDJPY", base: "USD", quote: "JPY", pipSize: PIP_SIZE.USDJPY, typicalSpreadPips: TYPICAL_SPREAD_PIPS.USDJPY, typicalPrice: TYPICAL_PRICE_USD.USDJPY, isInverse: true },
  AUDUSD: { symbol: "AUDUSD", base: "AUD", quote: "USD", pipSize: PIP_SIZE.AUDUSD, typicalSpreadPips: TYPICAL_SPREAD_PIPS.AUDUSD, typicalPrice: TYPICAL_PRICE_USD.AUDUSD, isInverse: false },
  USDCAD: { symbol: "USDCAD", base: "USD", quote: "CAD", pipSize: PIP_SIZE.USDCAD, typicalSpreadPips: TYPICAL_SPREAD_PIPS.USDCAD, typicalPrice: TYPICAL_PRICE_USD.USDCAD, isInverse: true },
};

/** Retorna metadata estática para um símbolo suportado, ou null. */
export function getForexPairMeta(symbol: string): ForexPairMeta | null {
  const upper = symbol.toUpperCase();
  if ((FOREX_PAIRS as readonly string[]).includes(upper)) {
    return PAIR_META[upper as ForexPair];
  }
  return null;
}

/** Valida se um símbolo é suportado pelo provider. */
export function isSupportedForexPair(symbol: string): symbol is ForexPair {
  return (FOREX_PAIRS as readonly string[]).includes(symbol.toUpperCase());
}
