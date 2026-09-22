import { computeAtr } from "./asset-context.mjs";

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period; let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function dmiAdx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return { adx: null, plusDi: null, minusDi: null, trending: false };
  const trs = []; const plus = []; const minus = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]; const p = candles[i - 1];
    const upMove = c.high - p.high; const downMove = p.low - c.low;
    plus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const sum = (arr, from) => arr.slice(from, from + period).reduce((a, b) => a + b, 0);
  const dxSeries = [];
  let plusDi = null; let minusDi = null;
  for (let from = 0; from + period <= trs.length; from += 1) {
    const tr = sum(trs, from) || 1e-12;
    const pd = (100 * sum(plus, from)) / tr;
    const md = (100 * sum(minus, from)) / tr;
    plusDi = pd; minusDi = md;
    const denom = pd + md || 1e-12;
    dxSeries.push((100 * Math.abs(pd - md)) / denom);
  }
  const n = Math.min(period, dxSeries.length);
  const adx = dxSeries.slice(-n).reduce((a, b) => a + b, 0) / n;
  return { adx, plusDi, minusDi, trending: adx >= 20 };
}

export function bollinger(closes, period = 20, mult = 2) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const calc = (arr) => {
    const mid = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mid) ** 2, 0) / arr.length;
    const sd = Math.sqrt(variance);
    const upper = mid + mult * sd; const lower = mid - mult * sd;
    return { mid, upper, lower, bandwidth: mid ? (upper - lower) / mid : 0 };
  };
  const current = calc(closes.slice(-period));
  const previous = calc(closes.slice(-period - 1, -1));
  const close = closes[closes.length - 1];
  const range = current.upper - current.lower || 1e-12;
  return { ...current, percentB: (close - current.lower) / range, expanding: current.bandwidth > previous.bandwidth };
}

const zoneOf = (value) => (value === null ? null : value < 30 ? "OVERSOLD" : value > 70 ? "OVERBOUGHT" : value < 40 ? "LOW" : value > 60 ? "HIGH" : "NEUTRAL");

export function computeFeatures(ctx) {
  if (!ctx || !Array.isArray(ctx.candles) || ctx.candles.length < 21) return null;
  const candles = ctx.candles;
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const atr = computeAtr(candles, 14);
  const atrShort = computeAtr(candles, 5);
  const rsiValue = rsi(closes, 14);
  const dmi = dmiAdx(candles, 14);
  const boll = bollinger(closes, 20, 2);
  const range = last.high - last.low || 1e-12;
  const zones = ctx.zones();
  const nearestZone = zones.length ? zones.map((z) => ({ ...z, absAtr: Math.abs(z.distanceAtr) })).sort((a, b) => a.absAtr - b.absAtr)[0] : null;
  return deepFreeze({
    marketKey: ctx.marketKey,
    version: ctx.version,
    at: last.at,
    candles: candles.length,
    structure: ctx.structure,
    regime: ctx.regime,
    close: last.close,
    atr,
    volRatio: atr && atrShort ? Math.round((atrShort / atr) * 1000) / 1000 : null,
    rsi: { value: rsiValue, zone: zoneOf(rsiValue) },
    dmi: { adx: dmi.adx, plusDi: dmi.plusDi, minusDi: dmi.minusDi, trending: dmi.trending },
    bollinger: boll ? { bandwidth: boll.bandwidth, percentB: boll.percentB, expanding: boll.expanding } : null,
    priceAction: {
      bodyRatio: Math.abs(last.close - last.open) / range,
      closeInRange: (last.close - last.low) / range,
      direction: last.close >= last.open ? "UP" : "DOWN",
      pullback: ctx.pullback(),
      nearestZone: nearestZone ? { type: nearestZone.type, kind: nearestZone.kind, distanceAtr: nearestZone.distanceAtr } : null,
      lastBOS: ctx.lastBOS ? { type: ctx.lastBOS.type, at: ctx.lastBOS.at } : null,
      lastCHoCH: ctx.lastCHoCH ? { type: ctx.lastCHoCH.type, at: ctx.lastCHoCH.at } : null,
    },
  });
}
