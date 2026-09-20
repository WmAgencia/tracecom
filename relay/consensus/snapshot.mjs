/**
 * CONSENSUS CORE — MarketSnapshot imutavel e causal.
 * Um unico snapshot por avaliacao; TODOS os especialistas recebem exatamente este objeto.
 * Indicadores do Feature Engine oficial: RSI Wilder 14, Bollinger 20/2, DMI/ADX 14, ATR 14.
 * Nenhum dado futuro: candles so entram se bucketEnd <= now.
 */
import { evaluateIndicatorsV2 } from "../rsi-skills-v2.mjs";
import { rsiWilder, atrWilder } from "../feature-engine.mjs";

export const CONSENSUS_VERSION = "consensus-core-v1";
const MIN_CLOSED_CANDLES = 60;

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export function buildMarketSnapshot({ marketKey, marketType = null, candles = [], now = Date.now(), payout = null, targetExpiryAt = null } = {}) {
  const at = num(now) ?? Date.now();
  const list = (Array.isArray(candles) ? candles : []).filter((candle) => Number.isFinite(Number(candle?.close)) && Number.isFinite(Number(candle?.bucketEnd)) && Number(candle.bucketEnd) <= at);
  const indicators = evaluateIndicatorsV2({ candles: list, now: at });
  if (indicators.closedCandles < MIN_CLOSED_CANDLES) return null;

  const recent = list.slice(-30).map((candle) => ({
    bucketStart: num(candle.bucketStart), bucketEnd: num(candle.bucketEnd),
    open: num(candle.open), high: num(candle.high), low: num(candle.low), close: num(candle.close),
  }));
  const closes = list.map((candle) => Number(candle.close));
  const trajectory = [];
  for (let back = 4; back >= 0; back -= 1) {
    const slice = closes.slice(0, closes.length - back);
    const value = slice.length > 15 ? rsiWilder(slice, 14) : null;
    trajectory.push(value === null ? null : round(value, 4));
  }
  const atr = atrWilder(list, 14);
  const last = recent[recent.length - 1] ?? null;

  return deepFreeze({
    schema: "consensus-market-snapshot-v1",
    version: CONSENSUS_VERSION,
    snapshotId: `${marketKey}|${last?.bucketEnd ?? "na"}`,
    marketKey, marketType, payout, targetExpiryAt,
    at, bucketEnd: last?.bucketEnd ?? null,
    ohlc: last ? { open: last.open, high: last.high, low: last.low, close: last.close } : null,
    recentCandles: recent,
    indicators: {
      rsi: indicators.rsi, rsiPrevious: indicators.rsiPrevious, rsiSlope: indicators.rsiSlope, rsiTrajectory: trajectory,
      bollinger: indicators.bollinger, dmi: indicators.dmi, adx: indicators.adx,
      structuralTrend: indicators.structuralTrend, shortHorizonDirection: indicators.shortHorizonDirection, shortMomentum: indicators.shortMomentum,
      bandRiding: indicators.bandRiding, dominantDI: indicators.dominantDI, strongContinuation: indicators.strongContinuation,
      atr: atr === null ? null : round(atr, 8),
    },
    provenance: {
      producer: "consensus-snapshot", version: CONSENSUS_VERSION, source: "IQ_WS_CANDLES_5S",
      calculatedAt: at, availableAt: last?.bucketEnd ?? null, closedCandles: indicators.closedCandles,
    },
  });
}
