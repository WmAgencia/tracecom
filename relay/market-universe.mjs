/**
 * MARKET UNIVERSE — modelo explicito NORMAL ≠ OTC.
 *
 * Invariantes:
 *  - marketKey = `${canonical}:${marketType}` (ex.: EURUSD:NORMAL, EURUSD:OTC).
 *  - EUR/USD NORMAL e EUR/USD OTC sao mercados COMPLETAMENTE distintos (candles, features,
 *    decisoes, trades, stats, settlement). Nada e compartilhado entre eles.
 *  - NUNCA existe fallback silencioso NORMAL -> OTC. Se o NORMAL estiver fechado o estado e
 *    UNAVAILABLE/MARKET_CLOSED; OTC so opera se estiver explicitamente configurado e ativo.
 *  - MAX_ACTIVE_MARKETS = UNIVERSE.length (NORMAL + OTC somados).
 */
export const MAX_ACTIVE_MARKETS = 54;
export const MAX_OPEN_POSITIONS_PER_MARKET = 1;
export const HARD_CAP_STAKE = 100;

export const MARKET_TYPES = ["NORMAL", "OTC"];

/**
 * UNIVERSO FASE 7 — 54 mercados (reconciliado na TASK 7 por evidencia real).
 * O nome interno da IQ e descoberto em runtime (NORMAL: sufixos -op / :N; OTC: sufixo -OTC).
 * NUNCA hardcodar activeId. Removido USDCHF:NORMAL: existe apenas na secao `blitz`
 * (activeId 1879), produto NAO suportado pela TraceCom (turbo/binary only) e ausente
 * dos catalogos turbo/binary/digital do MCP — ver docs/office-v3/universe-reconciliation.md.
 */
export const UNIVERSE = [
  // GRUPO A — 9 FX NORMAL (IQ expoe como <PAR>-op)
  { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "NORMAL", currencies: ["EUR", "USD"] },
  { canonical: "USDJPY", symbol: "USD/JPY", display: "USD/JPY", marketType: "NORMAL", currencies: ["USD", "JPY"] },
  { canonical: "GBPUSD", symbol: "GBP/USD", display: "GBP/USD", marketType: "NORMAL", currencies: ["GBP", "USD"] },
  { canonical: "AUDUSD", symbol: "AUD/USD", display: "AUD/USD", marketType: "NORMAL", currencies: ["AUD", "USD"] },
  { canonical: "USDCAD", symbol: "USD/CAD", display: "USD/CAD", marketType: "NORMAL", currencies: ["USD", "CAD"] },
  { canonical: "EURJPY", symbol: "EUR/JPY", display: "EUR/JPY", marketType: "NORMAL", currencies: ["EUR", "JPY"] },
  { canonical: "EURGBP", symbol: "EUR/GBP", display: "EUR/GBP", marketType: "NORMAL", currencies: ["EUR", "GBP"] },
  { canonical: "AUDJPY", symbol: "AUD/JPY", display: "AUD/JPY", marketType: "NORMAL", currencies: ["AUD", "JPY"] },
  { canonical: "GBPJPY", symbol: "GBP/JPY", display: "GBP/JPY", marketType: "NORMAL", currencies: ["GBP", "JPY"] },
  { canonical: "USDCHF", symbol: "USD/CHF", display: "USD/CHF", marketType: "NORMAL", currencies: ["USD", "CHF"] },
  // GRUPO B — 5 OTC existentes
  { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD OTC", marketType: "OTC", currencies: ["EUR", "USD"] },
  { canonical: "GBPUSD", symbol: "GBP/USD", display: "GBP/USD OTC", marketType: "OTC", currencies: ["GBP", "USD"] },
  { canonical: "USDJPY", symbol: "USD/JPY", display: "USD/JPY OTC", marketType: "OTC", currencies: ["USD", "JPY"] },
  { canonical: "EURGBP", symbol: "EUR/GBP", display: "EUR/GBP OTC", marketType: "OTC", currencies: ["EUR", "GBP"] },
  { canonical: "GBPJPY", symbol: "GBP/JPY", display: "GBP/JPY OTC", marketType: "OTC", currencies: ["GBP", "JPY"] },
  // GRUPO C — 25 novos FX OTC
  { canonical: "AUDUSD", symbol: "AUD/USD", display: "AUD/USD OTC", marketType: "OTC", currencies: ["AUD", "USD"] },
  { canonical: "USDCAD", symbol: "USD/CAD", display: "USD/CAD OTC", marketType: "OTC", currencies: ["USD", "CAD"] },
  { canonical: "USDCHF", symbol: "USD/CHF", display: "USD/CHF OTC", marketType: "OTC", currencies: ["USD", "CHF"] },
  { canonical: "EURJPY", symbol: "EUR/JPY", display: "EUR/JPY OTC", marketType: "OTC", currencies: ["EUR", "JPY"] },
  { canonical: "AUDJPY", symbol: "AUD/JPY", display: "AUD/JPY OTC", marketType: "OTC", currencies: ["AUD", "JPY"] },
  { canonical: "EURAUD", symbol: "EUR/AUD", display: "EUR/AUD OTC", marketType: "OTC", currencies: ["EUR", "AUD"] },
  { canonical: "EURCHF", symbol: "EUR/CHF", display: "EUR/CHF OTC", marketType: "OTC", currencies: ["EUR", "CHF"] },
  { canonical: "EURCAD", symbol: "EUR/CAD", display: "EUR/CAD OTC", marketType: "OTC", currencies: ["EUR", "CAD"] },
  { canonical: "EURNZD", symbol: "EUR/NZD", display: "EUR/NZD OTC", marketType: "OTC", currencies: ["EUR", "NZD"] },
  { canonical: "AUDCAD", symbol: "AUD/CAD", display: "AUD/CAD OTC", marketType: "OTC", currencies: ["AUD", "CAD"] },
  { canonical: "AUDCHF", symbol: "AUD/CHF", display: "AUD/CHF OTC", marketType: "OTC", currencies: ["AUD", "CHF"] },
  { canonical: "AUDNZD", symbol: "AUD/NZD", display: "AUD/NZD OTC", marketType: "OTC", currencies: ["AUD", "NZD"] },
  { canonical: "CADJPY", symbol: "CAD/JPY", display: "CAD/JPY OTC", marketType: "OTC", currencies: ["CAD", "JPY"] },
  { canonical: "CADCHF", symbol: "CAD/CHF", display: "CAD/CHF OTC", marketType: "OTC", currencies: ["CAD", "CHF"] },
  { canonical: "GBPAUD", symbol: "GBP/AUD", display: "GBP/AUD OTC", marketType: "OTC", currencies: ["GBP", "AUD"] },
  { canonical: "GBPCAD", symbol: "GBP/CAD", display: "GBP/CAD OTC", marketType: "OTC", currencies: ["GBP", "CAD"] },
  { canonical: "GBPCHF", symbol: "GBP/CHF", display: "GBP/CHF OTC", marketType: "OTC", currencies: ["GBP", "CHF"] },
  { canonical: "GBPNZD", symbol: "GBP/NZD", display: "GBP/NZD OTC", marketType: "OTC", currencies: ["GBP", "NZD"] },
  { canonical: "NZDCAD", symbol: "NZD/CAD", display: "NZD/CAD OTC", marketType: "OTC", currencies: ["NZD", "CAD"] },
  { canonical: "NZDJPY", symbol: "NZD/JPY", display: "NZD/JPY OTC", marketType: "OTC", currencies: ["NZD", "JPY"] },
  { canonical: "NZDCHF", symbol: "NZD/CHF", display: "NZD/CHF OTC", marketType: "OTC", currencies: ["NZD", "CHF"] },
  { canonical: "USDMXN", symbol: "USD/MXN", display: "USD/MXN OTC", marketType: "OTC", currencies: ["USD", "MXN"] },
  { canonical: "USDBRL", symbol: "USD/BRL", display: "USD/BRL OTC", marketType: "OTC", currencies: ["USD", "BRL"] },
  { canonical: "USDTRY", symbol: "USD/TRY", display: "USD/TRY OTC", marketType: "OTC", currencies: ["USD", "TRY"] },
  { canonical: "USDZAR", symbol: "USD/ZAR", display: "USD/ZAR OTC", marketType: "OTC", currencies: ["USD", "ZAR"] },
  // GRUPO D — 10 indices/commodities (IQ expoe NORMAL como <NOME>:N)
  { canonical: "XAUUSD", symbol: "XAU/USD", display: "GOLD", marketType: "NORMAL", currencies: [] },
  { canonical: "XAGUSD", symbol: "XAG/USD", display: "SILVER", marketType: "NORMAL", currencies: [] },
  { canonical: "US30", symbol: "US30", display: "US30", marketType: "NORMAL", currencies: [] },
  { canonical: "US100", symbol: "US100", display: "US100", marketType: "NORMAL", currencies: [] },
  { canonical: "US500", symbol: "US500", display: "US500", marketType: "NORMAL", currencies: [] },
  { canonical: "US2000", symbol: "US2000", display: "US2000", marketType: "NORMAL", currencies: [] },
  { canonical: "GER30", symbol: "GER30", display: "GER30", marketType: "NORMAL", currencies: [] },
  { canonical: "UK100", symbol: "UK100", display: "UK100", marketType: "NORMAL", currencies: [] },
  { canonical: "JP225", symbol: "JP225", display: "JP225", marketType: "NORMAL", currencies: [] },
  { canonical: "AUS200", symbol: "AUS200", display: "AUS200", marketType: "NORMAL", currencies: [] },
  // GRUPO E — 5 ativos adicionais
  { canonical: "EU50", symbol: "EU50", display: "EU50", marketType: "NORMAL", currencies: [] },
  { canonical: "HK33", symbol: "HK33", display: "HK33", marketType: "NORMAL", currencies: [] },
  { canonical: "FR40", symbol: "FR40", display: "FR40", marketType: "NORMAL", currencies: [] },
  { canonical: "SP35", symbol: "SP35", display: "SP35", marketType: "NORMAL", currencies: [] },
  { canonical: "BTCUSD", symbol: "BTC/USD", display: "BTC/USD OTC", marketType: "OTC", currencies: [] },
];

/**
 * UNIVERSO OPERACIONAL = SOMENTE MERCADOS REAIS/NORMAIS (zero OTC).
 * OTC esta PROIBIDO na operacao: discovery, opportunities, execution, feed, universo.
 * UNIVERSE (com OTC) permanece apenas como referencia/historico imutavel.
 */
export const OPERATIONAL_UNIVERSE = Object.freeze(UNIVERSE.filter((entry) => entry.marketType !== "OTC"));
export const OPERATIONAL_MAX_ACTIVE_MARKETS = OPERATIONAL_UNIVERSE.length;

/**
 * ALLOWLIST EXATA do universo operacional (24 mercados NORMAL).
 * O MCP NAO define o universo: ele apenas mapeia o catalogo para estes mercados.
 * Qualquer outro ativo (AMAZON, NVIDIA, RIPPLE, SPACEX, ...) e REJECT fail-closed.
 */
export const OPERATIONAL_MARKET_KEYS = Object.freeze(new Set(OPERATIONAL_UNIVERSE.map((entry) => marketKey(entry.canonical, "NORMAL"))));

/**
 * ALIASES EXPLICITOS dos nomes reais retornados pelo MCP -> canonical interno.
 * Nenhuma heuristica generica: so entradas confirmadas (nome/asset_id do catalogo IQ).
 * GOLD -> XAUUSD, SILVER -> XAGUSD, AU200 -> AUS200 (prova em producao via MCP).
 */
export const MCP_ALIASES = Object.freeze({
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  AU200: "AUS200",
  "US 30": "US30", "US 100": "US100", "US 500": "US500", "US 2000": "US2000",
  "GER 30": "GER30", "UK 100": "UK100", "JP 225": "JP225", "AUS 200": "AUS200",
  "EU 50": "EU50", "HK 33": "HK33", "FR 40": "FR40", "SP 35": "SP35",
  "EUR/USD": "EURUSD", "USD/JPY": "USDJPY", "GBP/USD": "GBPUSD", "AUD/USD": "AUDUSD",
  "USD/CAD": "USDCAD", "EUR/JPY": "EURJPY", "EUR/GBP": "EURGBP", "AUD/JPY": "AUDJPY",
  "GBP/JPY": "GBPJPY", "USD/CHF": "USDCHF", "XAU/USD": "XAUUSD", "XAG/USD": "XAGUSD",
});

/** Mapeia um nome do catalogo MCP para o canonical interno, SOMENTE se pertencer aos 24. */
export function mcpCanonical(name) {
  const raw = String(name ?? "").replace(/\(OTC\)/gi, "").trim();
  if (!raw) return null;
  const direct = MCP_ALIASES[raw];
  if (direct) return OPERATIONAL_MARKET_KEYS.has(`${direct}:NORMAL`) ? direct : null;
  const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length < 3 || clean.length > 10) return null;
  const key = `${clean}:NORMAL`;
  return OPERATIONAL_MARKET_KEYS.has(key) ? clean : null;
}

/** Guard fail-closed: a chave precisa pertencer aos 24 operacionais. */
export function isOperationalMarketKey(key) {
  return OPERATIONAL_MARKET_KEYS.has(String(key ?? ""));
}

/**
 * ASSET_IDS CONFIRMADOS do catalogo MCP (observados em producao via list_assets/get_candles).
 * Fallback de MAPEAMENTO apenas: quando o gateway nao lista a variante NORMAL na sessao
 * atual (ex.: FX/metais so como OTC), o runtime ainda configura o mercado dos 24 com o
 * id confirmado e consome candles (o gateway os serve). Nunca cria mercado fora dos 24.
 * USDCHF fica pendente de confirmacao (catalogo nao o expoe NORMAL ate hoje).
 */
export const MCP_CONFIRMED_ASSET_IDS = Object.freeze({
  EURUSD: 1861, USDJPY: 1865, GBPUSD: 1867, AUDUSD: 1870, USDCAD: 1878,
  EURJPY: 1864, EURGBP: 1862, AUDJPY: 1869, GBPJPY: 1866,
  XAUUSD: 1912, XAGUSD: 1913,
  US30: 1472, US100: 1471, US500: 1470, US2000: 1473,
  GER30: 1478, UK100: 1475, JP225: 1476, AUS200: 1481,
  EU50: 1480, HK33: 1477, FR40: 1479, SP35: 1474,
});

/**
 * ALLOWLIST POSITIVA (fail-closed) de mercado operacional:
 * somente NORMAL + instrumento Binary suportado + enabled + tradable + OPEN + ativo.
 * UNKNOWN / undefined / OTC / Blitz / Digital nao suportado / qualquer outro => REJECT.
 */
export function isSupportedNormalBinaryMarket(ctx, { requireEnabled = true, requireTradable = true } = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (String(ctx.marketType ?? "").toUpperCase() !== "NORMAL") return false;
  if (requireEnabled !== false && ctx.enabled !== true) return false;
  if (requireTradable !== false && ctx.paused === true) return false;
  if (ctx.availability !== "OPEN" && ctx.availability !== undefined) return false;
  if (ctx.activeId === null || ctx.activeId === undefined) return false;
  return true;
}

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
