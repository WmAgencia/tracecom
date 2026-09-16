/**
 * MARKET UNIVERSE — modelo explicito NORMAL ≠ OTC.
 *
 * Invariantes:
 *  - marketKey = `${canonical}:${marketType}` (ex.: EURUSD:NORMAL, EURUSD:OTC).
 *  - EUR/USD NORMAL e EUR/USD OTC sao mercados COMPLETAMENTE distintos (candles, features,
 *    decisoes, trades, stats, settlement). Nada e compartilhado entre eles.
 *  - NUNCA existe fallback silencioso NORMAL -> OTC. Se o NORMAL estiver fechado o estado e
 *    UNAVAILABLE/MARKET_CLOSED; OTC so opera se estiver explicitamente configurado e ativo.
 *  - MAX_ACTIVE_MARKETS = 10 (NORMAL + OTC somados).
 */
export const MAX_ACTIVE_MARKETS = 10;
export const MAX_OPEN_POSITIONS_PER_MARKET = 1;
export const HARD_CAP_STAKE = 100;
export const DEFAULT_GLOBAL_MAX_STAKE = 2;

export const MARKET_TYPES = ["NORMAL", "OTC"];

export const UNIVERSE = [
  { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "NORMAL", currencies: ["EUR", "USD"] },
  { canonical: "USDJPY", symbol: "USD/JPY", display: "USD/JPY", marketType: "NORMAL", currencies: ["USD", "JPY"] },
  { canonical: "GBPUSD", symbol: "GBP/USD", display: "GBP/USD", marketType: "NORMAL", currencies: ["GBP", "USD"] },
  { canonical: "AUDUSD", symbol: "AUD/USD", display: "AUD/USD", marketType: "NORMAL", currencies: ["AUD", "USD"] },
  { canonical: "USDCAD", symbol: "USD/CAD", display: "USD/CAD", marketType: "NORMAL", currencies: ["USD", "CAD"] },
  { canonical: "USDCHF", symbol: "USD/CHF", display: "USD/CHF", marketType: "NORMAL", currencies: ["USD", "CHF"] },
  { canonical: "EURJPY", symbol: "EUR/JPY", display: "EUR/JPY", marketType: "NORMAL", currencies: ["EUR", "JPY"] },
  { canonical: "EURGBP", symbol: "EUR/GBP", display: "EUR/GBP", marketType: "NORMAL", currencies: ["EUR", "GBP"] },
  { canonical: "AUDJPY", symbol: "AUD/JPY", display: "AUD/JPY", marketType: "NORMAL", currencies: ["AUD", "JPY"] },
  { canonical: "GBPJPY", symbol: "GBP/JPY", display: "GBP/JPY", marketType: "NORMAL", currencies: ["GBP", "JPY"] },
  { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD OTC", marketType: "OTC", currencies: ["EUR", "USD"] },
  { canonical: "GBPUSD", symbol: "GBP/USD", display: "GBP/USD OTC", marketType: "OTC", currencies: ["GBP", "USD"] },
  { canonical: "USDJPY", symbol: "USD/JPY", display: "USD/JPY OTC", marketType: "OTC", currencies: ["USD", "JPY"] },
  { canonical: "EURGBP", symbol: "EUR/GBP", display: "EUR/GBP OTC", marketType: "OTC", currencies: ["EUR", "GBP"] },
  { canonical: "GBPJPY", symbol: "GBP/JPY", display: "GBP/JPY OTC", marketType: "OTC", currencies: ["GBP", "JPY"] },
];

export function marketKey(canonical, marketType) { return `${String(canonical).toUpperCase()}:${String(marketType).toUpperCase() === "OTC" ? "OTC" : "NORMAL"}`; }
export function universeEntry(canonical, marketType) { return UNIVERSE.find((entry) => entry.canonical === String(canonical).toUpperCase() && entry.marketType === marketType) ?? null; }
export function entryForKey(key) {
  const [canonical, type] = String(key ?? "").split(":");
  return universeEntry(canonical, type === "OTC" ? "OTC" : "NORMAL");
}
export function isOtcKey(key) { return entryForKey(key)?.marketType === "OTC"; }

/** Chave canonica de segmento: NUNCA colide entre NORMAL e OTC. */
export function segmentIdFor(key, bucketStart) { return `${key}:${bucketStart}`; }

/** Limite global de ativos simultaneos (NORMAL + OTC). Retorna aprovacao explicita. */
export function canActivateMore(activeKeys, limit = MAX_ACTIVE_MARKETS) {
  const active = new Set(activeKeys ?? []);
  return { allowed: active.size < limit, activeCount: active.size, limit, blockedKey: null };
}

/** Monitor simples de concentracao por moeda (auditavel, sem heuristica escondida). */
export function concentrationExposure(openPositions = []) {
  const byCurrency = new Map();
  for (const position of openPositions) {
    const entry = entryForKey(position.marketKey);
    if (!entry) continue;
    const stake = Number(position.stake) || 0;
    const [base, quote] = entry.currencies;
    const sign = position.direction === "CALL" ? 1 : position.direction === "PUT" ? -1 : 0;
    if (!sign) continue;
    const legs = [[base, sign], [quote, -sign]];
    for (const [currency, direction] of legs) {
      const current = byCurrency.get(currency) ?? { currency, net: 0, longCount: 0, shortCount: 0, stake: 0 };
      current.net += direction * stake;
      current.stake += stake;
      if (direction > 0) current.longCount += 1; else current.shortCount += 1;
      byCurrency.set(currency, current);
    }
  }
  const exposures = [...byCurrency.values()].map((row) => ({ ...row, net: Number(row.net.toFixed(4)), stake: Number(row.stake.toFixed(4)) })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const warnings = exposures.filter((row) => Math.max(row.longCount, row.shortCount) >= 3).map((row) => ({ code: "CONCENTRATION_HIGH", currency: row.currency, count: Math.max(row.longCount, row.shortCount), net: row.net }));
  return { exposures, warnings, duplicatedExposure: warnings.length > 0 };
}
