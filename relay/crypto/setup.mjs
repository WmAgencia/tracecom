/**
 * CRYPTO SETUP DETECTOR (CRYPTO_REGIME_TREND_V1) — 100% em codigo.
 * Converte regime + evidencias em candidatos LONG/SHORT com entry, stop estrutural
 * (volatility-aware) e take-profit por R:R / estrutura. RSI e contexto, nunca sinal isolado.
 */
export const CRYPTO_SETUP_VERSION = "crypto-setup-detector-v1";

/** Pullback dentro de tendencia: recuo >= 0.5 ATR e <= 1.8 ATR, estrutura preservada. */
export function detectPullback(candles, atr, trendDirection) {
  const n = candles.length;
  if (n < 30) return { active: false, reason: "INSUFFICIENT_DATA" };
  const lookback = Math.min(n - 1, 24);
  const recent = candles.slice(Math.max(0, n - lookback));
  const trend = trendDirection === "TREND_UP" ? 1 : -1;
  const refs = recent.slice(0, Math.floor(lookback / 2));
  const ref = trend > 0 ? Math.max(...refs.map((c) => c.high)) : Math.min(...refs.map((c) => c.low));
  // profundidade REAL do pullback: do ref ate o EXTREMO do recuo (min/max do lookback),
  // nao ate o candle atual (que ja pode estar na retomada).
  const pullbackLow = trend > 0 ? Math.min(...recent.map((c) => c.low)) : null;
  const pullbackHigh = trend < 0 ? Math.max(...recent.map((c) => c.high)) : null;
  const distance = trend > 0 ? ref - pullbackLow : pullbackHigh - ref;
  const atrValue = Number(atr?.atr ?? 0);
  if (!(atrValue > 0)) return { active: false, reason: "NO_ATR" };
  const distanceAtr = distance / atrValue;
  if (distanceAtr < 0.5) return { active: false, reason: "PULLBACK_TOO_SHALLOW", distanceAtr };
  if (distanceAtr > 1.8) return { active: false, reason: "PULLBACK_TOO_DEEP", distanceAtr };
  // estrutura preservada: o extremo do recuo nao viola o swing que define a tendencia.
  const structureIntact = trend > 0 ? pullbackLow > refs[refs.length - 1].low : pullbackHigh < refs[refs.length - 1].high;
  return { active: true, reason: "PULLBACK_OK", distanceAtr, structureIntact, pullbackLow, pullbackHigh };
}

/** Retest de rompimento: preco voltou ao nivel rompido e manteve (hold). */
export function detectRetest(candles, structure, trendDirection) {
  const n = candles.length;
  const last = candles[n - 1];
  if (trendDirection === "TREND_UP") {
    const brokenLevel = structure.recentHigh ?? null;
    if (brokenLevel === null || last.close < brokenLevel) return { active: false, reason: "NO_LEVEL" };
    const held = last.low > (structure.lastLow ?? brokenLevel * 0.995);
    return { active: held, reason: held ? "RETEST_HELD" : "RETEST_FAILED", level: brokenLevel };
  }
  const brokenLevel = structure.recentLow ?? null;
  if (brokenLevel === null || last.close > brokenLevel) return { active: false, reason: "NO_LEVEL" };
  const held = last.high < (structure.lastHigh ?? brokenLevel * 1.005);
  return { active: held, reason: held ? "RETEST_HELD" : "RETEST_FAILED", level: brokenLevel };
}

/** Range: rejeicao confirmada nos extremos (vela de rejeicao + fechamento a favor). */
export function detectRangeRejection(candles, { atr = null, width = null } = {}) {
  const n = candles.length;
  if (n < 40 || width === null || !(width > 0)) return { active: false, reason: "RANGE_NOT_DEFINED" };
  const window = Math.min(n - 1, 60);
  const recent = candles.slice(Math.max(0, n - window));
  const rangeHigh = Math.max(...recent.map((c) => c.high));
  const rangeLow = Math.min(...recent.map((c) => c.low));
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const proximity = Number(atr?.atr ?? 0) * 0.5 || rangeHigh * 0.001;
  const atTop = last.high >= rangeHigh - proximity;
  const atBottom = last.low <= rangeLow + proximity;
  const rejection = last.close < prev.close ? "BEARISH" : last.close > prev.close ? "BULLISH" : "NEUTRAL";
  if (atTop && rejection === "BEARISH") return { active: true, side: "SHORT", reason: "RANGE_TOP_REJECTION", rangeHigh, rangeLow, entry: last.close, stop: rangeHigh + proximity * 1.5, target: rangeLow + (rangeHigh - rangeLow) * 0.1 };
  if (atBottom && rejection === "BULLISH") return { active: true, side: "LONG", reason: "RANGE_BOTTOM_REJECTION", rangeHigh, rangeLow, entry: last.close, stop: rangeLow - proximity * 1.5, target: rangeLow + (rangeHigh - rangeLow) * 0.9 };
  return { active: false, reason: "NO_RANGE_SIGNAL" };
}

const withRR = (candidate, minRr) => {
  if (!candidate) return candidate;
  const risk = Math.abs(Number(candidate.entry) - Number(candidate.stop));
  const reward = Math.abs(Number(candidate.target) - Number(candidate.entry));
  const rr = risk > 0 ? reward / risk : 0;
  return { ...candidate, risk, reward, rr: Number(rr.toFixed(2)), minRr, acceptable: rr >= minRr };
};

/** SETUP final: candidato + stop + target + R:R, ou NO_TRADE com motivo. */
export function detectSetup({ regime, trendDirection, structure, indicators, candles5m, candles1m, minRr = 1.5, atrFactor = 1.5 }) {
  if (!regime || regime === "NO_TRADE") return { candidate: null, reason: `REGIME_${regime ?? "NO_TRADE"}` };
  const atr = indicators.atr;
  const atrValue = Number(atr?.atr ?? 0);
  const last = candles5m[candles5m.length - 1];
  const lastPrice = last?.close ?? null;
  if (!Number.isFinite(lastPrice)) return { candidate: null, reason: "NO_PRICE" };

  if (regime === "HIGH_VOLATILITY") {
    // volatilidade extrema: reduz sinais; exige retest limpo, senao NO_TRADE.
    const pullback = detectPullback(candles5m, atr, trendDirection);
    if (!pullback.active) return { candidate: null, reason: "HIGH_VOL_NO_CLEAN_SETUP" };
    return { candidate: null, reason: "HIGH_VOLATILITY_DEFFERED" };
  }
  if (regime === "LOW_VOLATILITY" || regime === "TRANSITION") return { candidate: null, reason: `REGIME_${regime}` };

  if (regime === "RANGE") {
    const rejection = detectRangeRejection(candles5m, { atr, width: indicators.bollinger?.width });
    if (!rejection.active) return { candidate: null, reason: "RANGE_NO_REJECTION" };
    const direction = rejection.side === "LONG" ? 1 : -1;
    const stopDistance = Math.abs(rejection.stop - rejection.entry);
    if (!(stopDistance > 0)) return { candidate: null, reason: "RANGE_BAD_STOP" };
    const candidate = withRR({ symbol: null, side: rejection.side, entry: rejection.entry, stop: rejection.stop, target: rejection.target, regime, reason: rejection.reason }, minRr);
    return { candidate: candidate.acceptable ? candidate : null, reason: candidate.acceptable ? rejection.reason : "RANGE_RR_BELOW_MIN", rangeHigh: rejection.rangeHigh, rangeLow: rejection.rangeLow };
  }

  // TREND: pullback/retest -> estrutura preservada -> retomada -> LONG/SHORT.
  const up = regime === "TREND_UP";
  const pullback = detectPullback(candles5m, atr, regime);
  const retest = detectRetest(candles5m, structure, regime);
  const resume = up ? (indicators.emas.fastNow ?? 0) > (indicators.emas.slowNow ?? 0) : (indicators.emas.fastNow ?? 0) < (indicators.emas.slowNow ?? 0);
  const timing = candles1m && candles1m.length > 2 ? candles1m[candles1m.length - 1].close : null;
  const structureOk = up ? !structure.downtrend : !structure.uptrend;
  const base = pullback.active && (retest.active || pullback.structureIntact) && resume && structureOk;
  if (!base) {
    const reasons = [];
    if (!pullback.active) reasons.push("NO_PULLBACK");
    if (!retest.active && !pullback.structureIntact) reasons.push("NO_RETEST");
    if (!resume) reasons.push("NO_RESUMPTION");
    if (!structureOk) reasons.push("STRUCTURE_BROKEN");
    return { candidate: null, reason: reasons.join("|") || "NO_TREND_SETUP" };
  }
  const entry = Number(timing ?? lastPrice);
  if (up) {
    const stopRaw = Math.min(pullback.pullbackLow ?? structure.lastLow ?? entry - atrValue, entry - atrValue * atrFactor);
    const stop = Math.max(0.00000001, stopRaw);
    const resistance = structure.recentHigh ?? entry;
    const target = Math.max(entry + atrValue * 3, resistance + atrValue * 2);
    const candidate = withRR({ symbol: null, side: "LONG", entry, stop, target, regime, reason: "TREND_PULLBACK_RETEST" }, minRr);
    return { candidate: candidate.acceptable ? candidate : null, reason: candidate.acceptable ? "TREND_PULLBACK_RETEST" : "TREND_RR_BELOW_MIN" };
  }
  const stopRaw = Math.max(pullback.pullbackHigh ?? structure.lastHigh ?? entry + atrValue, entry + atrValue * atrFactor);
  const stop = stopRaw;
  const support = structure.recentLow ?? entry;
  const target = Math.min(entry - atrValue * 3, support - atrValue * 2);
  const candidate = withRR({ symbol: null, side: "SHORT", entry, stop, target, regime, reason: "TREND_PULLBACK_RETEST" }, minRr);
  return { candidate: candidate.acceptable ? candidate : null, reason: candidate.acceptable ? "TREND_PULLBACK_RETEST" : "TREND_RR_BELOW_MIN" };
}