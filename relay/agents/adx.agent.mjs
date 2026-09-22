/**
 * AGENTE ADX/DMI — especialista em forca (ADX) e direcao (DMI). Wilder 14.
 * ADX NUNCA da direcao. INVARIANTE: enfraquecimento do DI antigo nao confirma reversao sem reacao do oposto.
 */
export const ADX_AGENT_VERSION = "agent-adx-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeAdxAgent(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const dmi = snapshot?.indicators?.dmi ?? null;
  const adx = snapshot?.indicators?.adx ?? null;
  const base = { agent: "ADX", version: ADX_AGENT_VERSION, snapshotId, state: "NO_DATA", regime: null, direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [] };
  if (!dmi || !adx) return base;
  const plusDI = num(dmi.plusDI); const minusDI = num(dmi.minusDI);
  const plusSlope = num(dmi.plusSlope); const minusSlope = num(dmi.minusSlope);
  const adxValue = num(adx.value); const adxSlope = num(adx.slope);
  const dominance = snapshot?.indicators?.dominantDI ?? null;
  const regime = adxValue === null ? null : adxValue >= 25 ? "TREND" : adxValue < 20 ? "RANGE" : "TRANSITIONAL";
  // Leitura profissional (Wilder/ADXtender): DMI separando + ADX subindo = tendencia fortalecendo (nao fade).
  const candles = Array.isArray(snapshot?.recentCandles) ? snapshot.recentCandles : [];
  const closes = candles.map((c) => Number(c.close));
  const lookback = Math.min(60, Math.max(10, closes.length - 1));
  const atr = num(snapshot?.indicators?.atr);
  const move = closes.length > lookback && atr > 0 ? (closes[closes.length - 1] - closes[closes.length - 1 - lookback]) / atr : null;
  const priceTrend = move === null ? "FLAT" : move > 1.2 ? "UP" : move < -1.2 ? "DOWN" : "FLAT";
  const diSeparating = plusDI !== null && minusDI !== null && Math.abs(plusDI - minusDI) >= 5;
  const adxRising = adxSlope !== null && adxSlope > 0;
  const observations = [`ADX ${round(adxValue, 1)} (${round(adxSlope, 2)}) +DI ${round(plusDI, 1)} -DI ${round(minusDI, 1)} dominancia ${dominance}`];
  const supportingEvidence = [];
  const counterEvidence = [];

  const sides = {
    SELL: { oldSlope: plusSlope, oppositeSlope: minusSlope, oldDI: plusDI, oppositeDI: minusDI },
    BUY: { oldSlope: minusSlope, oppositeSlope: plusSlope, oldDI: minusDI, oppositeDI: plusDI },
  };
  const perSide = {};
  for (const side of ["BUY", "SELL"]) {
    const s = sides[side];
    const oldTrendWeakening = s.oldSlope !== null && s.oldSlope < 0;
    const oppositeReacting = s.oppositeSlope !== null && s.oppositeSlope > 0;
    const newDominance = s.oldDI !== null && s.oppositeDI !== null && s.oppositeDI > s.oldDI;
    const oldStrengthening = s.oldSlope !== null && s.oldSlope > 0 && adxSlope !== null && adxSlope > 0 && dominance === (side === "SELL" ? "PLUS" : "MINUS");
    const priceTrendAgainst = (side === "SELL" && priceTrend === "UP") || (side === "BUY" && priceTrend === "DOWN");
    const trendStrengthening = adxRising && diSeparating && ((side === "SELL" && dominance === "PLUS") || (side === "BUY" && dominance === "MINUS"));
    perSide[side] = { oldTrendWeakening, oppositeReacting, newDominance, oldStrengthening, priceTrendAgainst, trendStrengthening };
  }
  if (regime === "TREND") observations.push("regime de tendencia (ADX>=25): evitar fade cego");
  if (regime === "RANGE") observations.push("regime de range (ADX<20): mean reversion viavel");

  return {
    agent: "ADX", version: ADX_AGENT_VERSION, snapshotId, state: regime, regime, dominance,
    adx: round(adxValue, 4), adxSlope: round(adxSlope, 4), plusDI: round(plusDI, 4), minusDI: round(minusDI, 4),
    plusSlope: round(plusSlope, 4), minusSlope: round(minusSlope, 4), perSide, priceTrend, adxRising, diSeparating,
    direction: dominance === "PLUS" ? "BULLISH" : dominance === "MINUS" ? "BEARISH" : "NEUTRAL",
    strength: round(clamp01(regime === "TREND" ? 0.7 : regime === "RANGE" ? 0.4 : 0.5), 4),
    supportingEvidence, counterEvidence, observations,
    opinion: regime === "TREND" ? `Tendencia ${dominance === "PLUS" ? "de alta" : "de baixa"} com ADX ${round(adxValue, 1)} (${adxSlope !== null && adxSlope > 0 ? "fortalecendo" : "enfraquecendo"}).` : `ADX ${round(adxValue, 1)}: regime ${String(regime ?? "?").toLowerCase()}.`,
  };
}
