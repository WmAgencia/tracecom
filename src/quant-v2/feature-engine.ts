import type { MarketCandle } from "../market/model";
import type { FeatureSnapshot, QuantFeatures, FeatureValue } from "./types";

export const FEATURE_VERSION = "quant-v2-features-v1";
const WINDOWS: Record<string, number> = { "5s": 1, "10s": 2, "15s": 3, "30s": 6, "60s": 12, "90s": 18, "120s": 24, "180s": 36, "300s": 60, "900s": 180 };
const finite = (v: number): number | null => Number.isFinite(v) ? v : null;
const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const std = (a: number[]) => { if (a.length < 2) return null; const m = mean(a)!; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const window = (a: number[], i: number, n: number) => i + 1 < n ? [] : a.slice(i - n + 1, i + 1);
const pct = (now: number, old: number | undefined) => old === undefined || old === 0 ? null : (now - old) / old;
const returns = (closes: number[], i: number, n: number) => i < n ? null : pct(closes[i]!, closes[i - n]);
const logReturn = (closes: number[], i: number, n: number) => { const r = returns(closes, i, n); return r === null ? null : Math.log1p(r); };
const emaAt = (values: number[], i: number, n: number) => { if (i < n - 1) return null; const alpha = 2 / (n + 1); let e = mean(values.slice(i - n + 1, i + 1))!; for (let j = i - n + 1; j <= i; j++) e = values[j]! * alpha + e * (1 - alpha); return e; };
const rsiAt = (closes: number[], i: number, n = 14) => { if (i < n) return null; let gain = 0, loss = 0; for (let j = i - n + 1; j <= i; j++) { const d = closes[j]! - closes[j - 1]!; if (d >= 0) gain += d; else loss -= d; } return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); };
const autocorrelation = (a: number[], lag: number) => { if (a.length <= lag + 2) return null; const m = mean(a)!; let n = 0, d = 0; for (let i = lag; i < a.length; i++) { n += (a[i]! - m) * (a[i - lag]! - m); d += (a[i]! - m) ** 2; } return d ? n / d : 0; };
const skew = (a: number[]) => { const m = mean(a), s = std(a); return m === null || s === null || !s ? null : mean(a.map(v => ((v - m) / s) ** 3)); };
const kurtosis = (a: number[]) => { const m = mean(a), s = std(a); return m === null || s === null || !s ? null : mean(a.map(v => ((v - m) / s) ** 4))! - 3; };

/** Causal feature snapshots. Index i only reads candles[0..i]. */
export function buildFeatureSnapshot(candles: readonly MarketCandle[], index = candles.length - 1): FeatureSnapshot {
  const usable = candles.slice(0, index + 1), i = usable.length - 1;
  if (!usable.length) return { timestamp: 0, features: {}, featureVersion: FEATURE_VERSION };
  const closes = usable.map(c => c.close), opens = usable.map(c => c.open), highs = usable.map(c => c.high), lows = usable.map(c => c.low), ranges = usable.map(c => c.high - c.low);
  const last = usable[i]!; const rs: Record<string, FeatureValue> = {};
  for (const [label, n] of Object.entries(WINDOWS)) { rs[`return_${label}`] = returns(closes, i, n); rs[`logReturn_${label}`] = logReturn(closes, i, n); }
  for (const [label, n] of Object.entries(WINDOWS)) { const r = returns(closes, i, n); rs[`momentum_${label}`] = r; rs[`realizedVol_${label}`] = std(window(closes.slice(1).map((v, j) => pct(v, closes[j]) ?? 0), i - 1, n - 1)); }
  for (const [label, n] of Object.entries({ "15s": 3, "30s": 6, "60s": 12 })) { const r = returns(closes, i, n); rs[`priceVelocity_${label}`] = r === null ? null : r / (n * 5); }
  rs.priceAcceleration_30s = rs.priceVelocity_30s === null || rs.priceVelocity_15s === null ? null : (rs.priceVelocity_30s! - rs.priceVelocity_15s!) / 15;
  rs.priceAcceleration_60s = rs.priceVelocity_60s === null || rs.priceVelocity_30s === null ? null : (rs.priceVelocity_60s! - rs.priceVelocity_30s!) / 30;
  const range = last.high - last.low, body = Math.abs(last.close - last.open);
  Object.assign(rs, { bodySize: body, bodyPctRange: range ? body / range : null, upperWick: last.high - Math.max(last.open, last.close), lowerWick: Math.min(last.open, last.close) - last.low, range, rangePct: last.close ? range / last.close : null });
  rs.upperWickRatio = range ? (last.high - Math.max(last.open, last.close)) / range : null; rs.lowerWickRatio = range ? (Math.min(last.open, last.close) - last.low) / range : null;
  rs.rollingMeanBody = mean(usable.slice(-12).map(c => Math.abs(c.close - c.open))); rs.rollingMeanRange = mean(ranges.slice(-12));
  for (const n of [3, 6, 12]) { const cs = usable.slice(-n); rs[`bullishCount_${n}`] = cs.filter(c => c.close > c.open).length; rs[`bearishCount_${n}`] = cs.filter(c => c.close < c.open).length; }
  let bull = 0, bear = 0; for (let j = i; j >= 0 && closes[j]! > opens[j]!; j--) bull++; for (let j = i; j >= 0 && closes[j]! < opens[j]!; j--) bear++; rs.bullishStreak = bull; rs.bearishStreak = bear;
  const fast = emaAt(closes, i, 9), medium = emaAt(closes, i, 21), slow = emaAt(closes, i, 50); rs.emaFast = fast; rs.emaMedium = medium; rs.emaSlow = slow; rs.emaSlopeFast = i > 0 && fast !== null ? fast - (emaAt(closes, i - 1, 9) ?? fast) : null; rs.emaSlopeMedium = i > 0 && medium !== null ? medium - (emaAt(closes, i - 1, 21) ?? medium) : null; rs.emaSlopeSlow = i > 0 && slow !== null ? slow - (emaAt(closes, i - 1, 50) ?? slow) : null;
  rs.distanceFromEMA_fast = fast === null ? null : pct(last.close, fast); rs.distanceFromEMA_medium = medium === null ? null : pct(last.close, medium); rs.distanceFromEMA_slow = slow === null ? null : pct(last.close, slow); rs.emaSpreadFastMedium = fast === null || medium === null ? null : pct(fast, medium); rs.emaSpreadMediumSlow = medium === null || slow === null ? null : pct(medium, slow);
  rs.RSI = rsiAt(closes, i); const atrVals = usable.slice(-14).map(c => c.high - c.low); rs.ATR = atrVals.length < 14 ? null : mean(atrVals); const mean20 = mean(closes.slice(-20)); const sd20 = std(closes.slice(-20)); rs.bollingerPosition = mean20 === null || sd20 === null || !sd20 ? null : (last.close - (mean20 - 2 * sd20)) / (4 * sd20); rs.bollingerWidth = mean20 === null || !mean20 || sd20 === null ? null : 4 * sd20 / mean20;
  const returnsAll = closes.slice(1).map((v, j) => Math.log(v / closes[j]!)); rs.rollingStdReturns = std(returnsAll.slice(-60)); rs.rangeVolatility = std(ranges.slice(-60)); rs.autocorrelationShort = autocorrelation(returnsAll.slice(-36), 1); rs.autocorrelationMedium = autocorrelation(returnsAll.slice(-120), 3); rs.returnSkewness = skew(returnsAll.slice(-60)); rs.returnKurtosis = kurtosis(returnsAll.slice(-60)); rs.entropyApprox = (() => { const a = returnsAll.slice(-60); if (!a.length) return null; const p = a.filter(x => x >= 0).length / a.length; return p === 0 || p === 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)); })(); rs.directionalPersistence = returnsAll.length < 2 ? null : Math.abs(autocorrelation(returnsAll.slice(-60), 1) ?? 0);
  const recent = usable.slice(-20); const hi = Math.max(...recent.map(c => c.high)), lo = Math.min(...recent.map(c => c.low)); rs.distanceRecentHigh = pct(last.close, hi); rs.distanceRecentLow = pct(last.close, lo); rs.distanceLocalHigh = pct(last.close, Math.max(...usable.slice(-6).map(c => c.high))); rs.distanceLocalLow = pct(last.close, Math.min(...usable.slice(-6).map(c => c.low))); rs.meanReversionDistance = mean20 === null ? null : pct(last.close, mean20); rs.breakoutUpStrength = hi && last.close > hi ? pct(last.close, hi) : 0; rs.breakoutDownStrength = lo && last.close < lo ? pct(last.close, lo) : 0; rs.higherHighCount = recent.slice(1).filter((c, j) => c.high > recent[j]!.high).length; rs.lowerHighCount = recent.slice(1).filter((c, j) => c.high < recent[j]!.high).length; rs.higherLowCount = recent.slice(1).filter((c, j) => c.low > recent[j]!.low).length; rs.lowerLowCount = recent.slice(1).filter((c, j) => c.low < recent[j]!.low).length;
  rs.secondsSinceLastImpulse = (() => { for (let j = i; j >= 0; j--) if (Math.abs(pct(closes[j]!, closes[Math.max(0, j - 1)]!) ?? 0) > 0.001) return (i - j) * 5; return null; })(); rs.secondsSinceLocalHigh = null; rs.secondsSinceLocalLow = null;
  return { timestamp: last.timestamp, features: rs, featureVersion: FEATURE_VERSION };
}

export function buildFeatureSeries(candles: readonly MarketCandle[]): FeatureSnapshot[] { return candles.map((_, i) => buildFeatureSnapshot(candles, i)); }
