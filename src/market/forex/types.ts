/**
 * Forex Data Layer — abstrações compartilhadas entre providers.
 *
 * Forex é diferente de cripto:
 *  - Não tem order book centralizado único (várias venues interbancárias).
 *  - Tem bid/ask/spread por venue; nós agregamos uma referência.
 *  - Cota em "pips": menor movimento na 5ª casa decimal para a maioria dos pares.
 *  - Lot size padrão: 100.000 unidades da moeda base.
 *  - Sessões: Asia, London, NY, overlap (afetam liquidez e spread).
 *  - Sem fees explícitas por tick; custo está no spread.
 */

import type { Timeframe } from "../model";

/** Par de moedas Forex. */
export interface ForexPair {
  /** Símbolo no formato "EUR/USD" (canonical). */
  readonly canonical: string;
  /** Moeda base (EUR em EUR/USD). */
  readonly base: string;
  /** Moeda de cotação (USD em EUR/USD). */
  readonly quote: string;
  /** Número de casas decimais no preço (5 para a maioria dos pares). */
  readonly pricePrecision: number;
  /** Tamanho de pip = 10^(-pricePrecision). */
  readonly pipSize: number;
  /** Tamanho padrão de 1 lote = 100.000 unidades da base. */
  readonly standardLotSize: number;
  /** Se é um par exótico (menor liquidez, spread maior). */
  readonly isExotic: boolean;
}

/**
 * Quote (top-of-book). Representa o estado atual de bid/ask.
 * Em Forex spot não há um order book centralizado: cada venue tem o seu.
 * Aqui modelamos um agregado representativo.
 */
export interface Quote {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  /** Spread absoluto = ask - bid. */
  readonly spread: number;
  /** Spread em pips = spread / pipSize. */
  readonly spreadPips: number;
  /** Mid price = (bid + ask) / 2. */
  readonly mid: number;
  /** Timestamp da cotação. */
  readonly timestamp: number;
  /** Venue ou agregador de origem. */
  readonly venue: string;
  /** Tamanho do pip do par (referência para cálculo de pips). */
  readonly pipSize?: number;
}

/** Tick individual (mudança de preço). */
export interface MarketTick {
  readonly symbol: string;
  readonly price: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly volume: number | null;
  readonly timestamp: number;
  readonly venue: string;
}

/** Status de freshness dos dados de mercado. */
export type DataFreshness =
  | "FRESH"     // Dados recentes (< threshold)
  | "STALE"     // Dados antigos (entre threshold e crítico)
  | "INVALID"   // Dados inválidos (gaps, inconsistências, ticks fora de ordem)
  | "UNKNOWN";  // Não foi possível determinar (provider offline, sem dados)

/** Resultado de validação de dados. */
export interface ValidationResult {
  readonly status: DataFreshness;
  readonly reasonCodes: string[];
  readonly lastValidTimestamp: number | null;
  readonly stalenessMs: number | null;
}

/** Sessão Forex. */
export type ForexSession = "ASIA" | "LONDON" | "NEW_YORK" | "OVERLAP_LONDON_NY" | "ROLLOVER";

/** Snapshot consolidado de mercado. */
export interface ForexMarketSnapshot {
  readonly symbol: string;
  readonly lastQuote: Quote | null;
  readonly lastTick: MarketTick | null;
  readonly session: ForexSession;
  readonly sessionPhase: "OPENING" | "MID" | "CLOSING" | "CLOSED";
  readonly freshness: ValidationResult;
  readonly timestamp: number;
}

/** Converte timestamp ms → RFC3339 (formato padrão, sem nanossegundos). */
export function msToRfc3339(ms: number): string {
  return new Date(ms).toISOString();
}

/** Limites default de staleness. */
export const DEFAULT_FRESHNESS_THRESHOLDS = {
  /** Dados até 30s são FRESH. */
  freshMs: 30_000,
  /** Dados entre 30s e 5min são STALE. */
  staleMs: 300_000,
  /** Acima disso: UNKNOWN. */
};

/** Pares Forex default (majors + metals). */
export const DEFAULT_FOREX_UNIVERSE: ReadonlyArray<ForexPair> = [
  { canonical: "EUR/USD", base: "EUR", quote: "USD", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "GBP/USD", base: "GBP", quote: "USD", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "USD/JPY", base: "USD", quote: "JPY", pricePrecision: 3, pipSize: 0.01,    standardLotSize: 100_000, isExotic: false },
  { canonical: "USD/CHF", base: "USD", quote: "CHF", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "AUD/USD", base: "AUD", quote: "USD", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "USD/CAD", base: "USD", quote: "CAD", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "NZD/USD", base: "NZD", quote: "USD", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "EUR/JPY", base: "EUR", quote: "JPY", pricePrecision: 3, pipSize: 0.01,    standardLotSize: 100_000, isExotic: false },
  { canonical: "GBP/JPY", base: "GBP", quote: "JPY", pricePrecision: 3, pipSize: 0.01,    standardLotSize: 100_000, isExotic: false },
  { canonical: "EUR/GBP", base: "EUR", quote: "GBP", pricePrecision: 5, pipSize: 0.0001, standardLotSize: 100_000, isExotic: false },
  { canonical: "AUD/JPY", base: "AUD", quote: "JPY", pricePrecision: 3, pipSize: 0.01,    standardLotSize: 100_000, isExotic: false },
  { canonical: "XAU/USD", base: "XAU", quote: "USD", pricePrecision: 2, pipSize: 0.01,    standardLotSize: 100,    isExotic: false },
];

/** Construtor de ForexPair a partir de string "EUR/USD". */
export function parseForexPair(input: string): ForexPair | null {
  const normalized = input.trim().toUpperCase().replace("_", "/");
  const parts = normalized.includes("/")
    ? normalized.split("/")
    : normalized.length === 6
      ? [normalized.slice(0, 3), normalized.slice(3)]
      : [];
  if (parts.length !== 2) return null;
  const [base, quote] = parts;
  if (!base || !quote) return null;
  const canonical = `${base}/${quote}`;
  const known = DEFAULT_FOREX_UNIVERSE.find((p) => p.canonical === canonical);
  if (known) return known;
  // Fallback: assume 5 dígitos (par major).
  return {
    canonical,
    base,
    quote,
    pricePrecision: 5,
    pipSize: 0.00001,
    standardLotSize: 100_000,
    isExotic: true,
  };
}

/** Calcula spread em pips a partir do spread absoluto e pipSize. */
export function computeSpreadPips(quote: Quote): number {
  return quote.pipSize && quote.pipSize > 0 ? quote.spread / quote.pipSize : quote.spreadPips;
}

/** Validação de quote: detecta dados inválidos ou stale. */
export function validateQuote(
  quote: Quote | null,
  now: number,
  pair: ForexPair,
  thresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): ValidationResult {
  const reasonCodes: string[] = [];
  if (!quote) {
    return {
      status: "UNKNOWN",
      reasonCodes: ["NO_QUOTE"],
      lastValidTimestamp: null,
      stalenessMs: null,
    };
  }
  // Checks estruturais.
  if (quote.bid <= 0 || quote.ask <= 0) {
    reasonCodes.push("NON_POSITIVE_PRICE");
  }
  if (quote.ask < quote.bid) {
    reasonCodes.push("ASK_LT_BID");
  }
  if (quote.spread < 0) {
    reasonCodes.push("NEGATIVE_SPREAD");
  }
  // Spread anormal: > 1% do mid price é suspeito (ou par exótico).
  const midRef = (quote.bid + quote.ask) / 2;
  const spreadPct = midRef > 0 ? quote.spread / midRef : 0;
  if (spreadPct > 0.01 && !pair.isExotic) {
    reasonCodes.push("ABNORMAL_SPREAD");
  }
  // Future timestamp ANTES de calcular staleness (senão fica negativo).
  // Threshold: > 60_000 ms no futuro é claramente erro.
  if (quote.timestamp > now + 60_000) {
    reasonCodes.push("FUTURE_TIMESTAMP");
  }
  const stalenessMs = now - quote.timestamp;
  // A coleta do scanner ocorre depois de `now` ser capturado. Uma pequena
  // diferença de relógio local não invalida um quote recém-chegado; somente o
  // limite explícito de FUTURE_TIMESTAMP é erro de proveniência.
  let status: DataFreshness;
  if (reasonCodes.some((c) =>
    ["NON_POSITIVE_PRICE", "ASK_LT_BID", "NEGATIVE_SPREAD", "FUTURE_TIMESTAMP", "ABNORMAL_SPREAD"].includes(c),
  )) {
    status = "INVALID";
  } else if (stalenessMs <= thresholds.freshMs) {
    status = "FRESH";
  } else if (stalenessMs <= thresholds.staleMs) {
    status = "STALE";
  } else {
    reasonCodes.push("TOO_STALE");
    status = "STALE";
  }
  return {
    status,
    reasonCodes,
    lastValidTimestamp: quote.timestamp,
    stalenessMs: Math.max(0, stalenessMs),
  };
}

/** Hora local de um timezone IANA sem depender do fuso da máquina. */
function hourInZone(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

/** Mercado spot abre domingo à noite e fecha sexta à noite em Nova York. */
export function isForexMarketOpenAt(timestamp: number): boolean {
  const day = new Date(timestamp).getUTCDay();
  if (day === 6) return false;
  const newYorkHour = hourInZone(timestamp, "America/New_York");
  if (day === 0) return newYorkHour >= 17;
  if (day === 5) return newYorkHour < 17;
  return true;
}

/**
 * Determina sessão Forex pelos horários locais de Londres/Nova York/Tóquio.
 * `Intl` incorpora as mudanças de DST de cada praça, eliminando a tabela UTC
 * fixa que deslocava Londres e NY durante o horário de verão.
 */
export function sessionAt(timestamp: number): ForexSession {
  const date = new Date(timestamp);
  const day = date.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return "ASIA"; // fim de semana: Asia residual
  const londonHour = hourInZone(timestamp, "Europe/London");
  const newYorkHour = hourInZone(timestamp, "America/New_York");
  const tokyoHour = hourInZone(timestamp, "Asia/Tokyo");
  const londonOpen = londonHour >= 8 && londonHour < 16;
  const newYorkOpen = newYorkHour >= 8 && newYorkHour < 17;
  if (londonOpen && newYorkOpen) return "OVERLAP_LONDON_NY";
  if (londonOpen) return "LONDON";
  if (newYorkOpen) return "NEW_YORK";
  if (tokyoHour >= 9 && tokyoHour < 18) return "ASIA";
  return "ROLLOVER";
}

/** Determina fase da sessão. */
export function sessionPhaseAt(timestamp: number, session: ForexSession): "OPENING" | "MID" | "CLOSING" | "CLOSED" {
  if (!isForexMarketOpenAt(timestamp)) return "CLOSED";
  if (session === "ASIA") {
    const hour = hourInZone(timestamp, "Asia/Tokyo");
    if (hour === 9) return "OPENING";
    if (hour >= 17) return "CLOSING";
    return "MID";
  }
  if (session === "LONDON") {
    const hour = hourInZone(timestamp, "Europe/London");
    if (hour === 8) return "OPENING";
    // Janela de fechamento operacional: mantém o alerta de liquidez a partir
    // do meio-dia de Londres, embora a sessão permaneça aberta até 16:00.
    if (hour >= 12) return "CLOSING";
    return "MID";
  }
  if (session === "OVERLAP_LONDON_NY") {
    return "MID";
  }
  if (session === "NEW_YORK") {
    const hour = hourInZone(timestamp, "America/New_York");
    if (hour === 8) return "OPENING";
    if (hour >= 16) return "CLOSING";
    return "MID";
  }
  return "CLOSED"; // ROLLOVER
}

/** Timeframes suportados em Forex (M1 a D1). */
export const FOREX_TIMEFRAMES: ReadonlyArray<Timeframe> = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"];

/** Duração esperada de cada timeframe Forex (ms). */
export const FOREX_TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};
