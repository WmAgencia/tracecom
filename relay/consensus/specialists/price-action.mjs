/**
 * ESPECIALISTA 1 — PRICE ACTION / CANDLES.
 * Le o grafico (OHLC + sequencia). Nao usa RSI nem Bollinger. Saida estruturada.
 */
export const PRICE_ACTION_VERSION = "consensus-price-action-v1";

const num = (value) => (value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function candleShape(candle) {
  const open = num(candle.open); const close = num(candle.close); const high = num(candle.high); const low = num(candle.low);
  if ([open, close, high, low].some((v) => v === null)) return null;
  const range = high - low;
  const body = Math.abs(close - open);
  const bullish = close > open;
  const bearish = close < open;
  return {
    open, close, high, low, range, body, bullish, bearish,
    upperWick: high - Math.max(open, close),
    lowerWick: Math.min(open, close) - low,
    bodyRatio: range > 0 ? body / range : 0,
    upperWickRatio: range > 0 ? (high - Math.max(open, close)) / range : 0,
    lowerWickRatio: range > 0 ? (Math.min(open, close) - low) / range : 0,
  };
}

export function analyzePriceAction(snapshot) {
  const candles = (snapshot?.recentCandles ?? []).slice(-20);
  const atr = num(snapshot?.indicators?.atr);
  const observations = [];
  if (candles.length < 10) return { direction: "NEUTRAL", structure: "UNCLEAR", strength: 0, reversalEvidence: 0, continuationEvidence: 0, observations: ["candles_insuficientes"], version: PRICE_ACTION_VERSION };

  const shapes = candles.map(candleShape).filter(Boolean);
  const last = shapes[shapes.length - 1];
  const prev = shapes[shapes.length - 2];
  const last5 = shapes.slice(-5);
  const prior5 = shapes.slice(-10, -5);
  const closes = candles.map((c) => num(c.close)).filter((v) => v !== null);

  const slopeRaw = closes.length >= 11 ? (closes[closes.length - 1] - closes[closes.length - 11]) / 10 : 0;
  const slope = atr && atr > 0 ? slopeRaw / atr : slopeRaw;
  const direction = slope > 0.05 ? "BULLISH" : slope < -0.05 ? "BEARISH" : "NEUTRAL";
  const strength = clamp01(Math.abs(slope) / 0.6);

  let bullishStreak = 0;
  for (let i = shapes.length - 1; i >= 0; i -= 1) { if (shapes[i].bullish) bullishStreak += 1; else break; }
  let bearishStreak = 0;
  for (let i = shapes.length - 1; i >= 0; i -= 1) { if (shapes[i].bearish) bearishStreak += 1; else break; }

  const rangeLast5 = last5.reduce((acc, s) => acc + s.range, 0);
  const rangePrior5 = prior5.reduce((acc, s) => acc + s.range, 0);
  const decelerating = rangePrior5 > 0 && rangeLast5 < rangePrior5 * 0.8;
  const accelerating = rangePrior5 > 0 && rangeLast5 > rangePrior5 * 1.2;

  let reversalEvidence = 0;
  let continuationEvidence = 0;
  const against = direction === "BULLISH" ? "SELL" : direction === "BEARISH" ? "BUY" : null;

  if (against === "SELL") {
    if (last.upperWickRatio >= 0.5 && last.bodyRatio <= 0.5) { reversalEvidence += 0.35; observations.push("pavio_superior_rejeicao"); }
    if (prev && last.bearish && prev.bullish && last.close < prev.open && last.body > prev.body * 0.8) { reversalEvidence += 0.25; observations.push("engolfo_bearish"); }
    if (closes.length >= 3 && closes[closes.length - 1] < closes[closes.length - 3] && closes[closes.length - 2] >= closes[closes.length - 3]) { reversalEvidence += 0.15; observations.push("perda_de_momentum_altista"); }
    if (decelerating) { reversalEvidence += 0.2; observations.push("desaceleracao_do_impulso"); }
    if (bullishStreak >= 3) { continuationEvidence += 0.35; observations.push(`sequencia_altista_${bullishStreak}`); }
    if (accelerating && bullishStreak >= 2) { continuationEvidence += 0.3; observations.push("impulso_altista_expandindo"); }
    if (last.bullish && last.bodyRatio >= 0.6) { continuationEvidence += 0.2; }
  } else if (against === "BUY") {
    if (last.lowerWickRatio >= 0.5 && last.bodyRatio <= 0.5) { reversalEvidence += 0.35; observations.push("pavio_inferior_rejeicao"); }
    if (prev && last.bullish && prev.bearish && last.close > prev.open && last.body > prev.body * 0.8) { reversalEvidence += 0.25; observations.push("engolfo_bullish"); }
    if (closes.length >= 3 && closes[closes.length - 1] > closes[closes.length - 3] && closes[closes.length - 2] <= closes[closes.length - 3]) { reversalEvidence += 0.15; observations.push("perda_de_momentum_baixista"); }
    if (decelerating) { reversalEvidence += 0.2; observations.push("desaceleracao_do_impulso"); }
    if (bearishStreak >= 3) { continuationEvidence += 0.35; observations.push(`sequencia_baixista_${bearishStreak}`); }
    if (accelerating && bearishStreak >= 2) { continuationEvidence += 0.3; observations.push("impulso_baixista_expandindo"); }
    if (last.bearish && last.bodyRatio >= 0.6) { continuationEvidence += 0.2; }
  } else {
    if (last.upperWickRatio >= 0.5) observations.push("pavio_superior");
    if (last.lowerWickRatio >= 0.5) observations.push("pavio_inferior");
  }

  const higherHighs = last5.filter((s, i) => i > 0 && s.high > last5[i - 1].high).length;
  const lowerLows = last5.filter((s, i) => i > 0 && s.low < last5[i - 1].low).length;
  if (direction === "BULLISH" && higherHighs >= 3) continuationEvidence += 0.15;
  if (direction === "BEARISH" && lowerLows >= 3) continuationEvidence += 0.15;
  if (direction === "BULLISH" && lowerLows >= 2) { reversalEvidence += 0.15; observations.push("lower_lows_formando"); }
  if (direction === "BEARISH" && higherHighs >= 2) { reversalEvidence += 0.15; observations.push("higher_highs_formando"); }

  const totalRange = rangeLast5 + rangePrior5;
  const range = totalRange > 0 && atr !== null && atr > 0 ? (rangeLast5 / 5) / atr : null;
  const isRange = range !== null && range < 0.35 && Math.abs(slope) < 0.1;

  const structure = isRange ? "RANGE" : reversalEvidence >= 0.5 && reversalEvidence > continuationEvidence ? "REVERSAL" : continuationEvidence >= 0.5 && continuationEvidence >= reversalEvidence ? "CONTINUATION" : "UNCLEAR";
  return {
    direction, structure, strength: round(strength, 4),
    reversalEvidence: round(clamp01(reversalEvidence), 4),
    continuationEvidence: round(clamp01(continuationEvidence), 4),
    slope: round(slope, 4), bullishStreak, bearishStreak,
    observations: observations.slice(0, 8), version: PRICE_ACTION_VERSION,
  };
}
