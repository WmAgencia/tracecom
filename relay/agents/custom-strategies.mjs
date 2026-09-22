const pullbackTrend = (opinions) => {
  const candle = opinions?.candle ?? null;
  const bollinger = opinions?.bollinger ?? null;
  const adx = opinions?.adx ?? null;
  const atr = opinions?.atr ?? null;
  if (!candle || !adx) return null;
  if (atr?.state === "DEAD" || atr?.climactic === true) return null;
  if (adx.regime === "RANGE") return null;
  // Estrutura de mercado (30 min): HH/HL = UP, LH/LL = DOWN. CHoCH contra invalida o pullback.
  const structure = candle.swingStructure === "UP" || candle.swingStructure === "DOWN"
    ? candle.swingStructure
    : candle.trend === "BULLISH" ? "UP" : candle.trend === "BEARISH" ? "DOWN" : null;
  if (!structure) return null;
  if (structure === "UP" && candle.choch === "BEARISH") return null;
  if (structure === "DOWN" && candle.choch === "BULLISH") return null;
  const slope = bollinger?.middleSlope ?? null;
  if (structure === "UP" && slope !== null && slope < 0) return null;
  if (structure === "DOWN" && slope !== null && slope > 0) return null;
  return structure === "UP" ? "BUY" : "SELL";
};
const pullbackSignal = (opinions, { requireCrossback = false } = {}) => {
  const direction = pullbackTrend(opinions);
  const rsi = opinions?.rsi ?? null;
  if (!direction || !rsi) return null;
  if (requireCrossback && rsi.crossback !== true) return null;
  if (direction === "BUY" && !(rsi.rsi <= 30)) return null;
  if (direction === "SELL" && !(rsi.rsi >= 70)) return null;
  return direction;
};

const pullbackTrendLoose = (opinions) => {
  const candle = opinions?.candle ?? null;
  const bollinger = opinions?.bollinger ?? null;
  const adx = opinions?.adx ?? null;
  const atr = opinions?.atr ?? null;
  if (!candle || !adx) return null;
  if (atr?.state === "DEAD" || atr?.climactic === true) return null;
  const structure = candle.swingStructure === "UP" || candle.swingStructure === "DOWN" ? candle.swingStructure : null;
  const slope = bollinger?.middleSlope ?? null;
  if (structure === "UP") { if (candle.choch === "BEARISH" || (slope !== null && slope < 0)) return null; return "BUY"; }
  if (structure === "DOWN") { if (candle.choch === "BULLISH" || (slope !== null && slope > 0)) return null; return "SELL"; }
  const dominance = adx.dominance ?? null;
  if (candle.trend === "BULLISH" && (slope === null || slope > 0) && (dominance === null || dominance === "PLUS")) return "BUY";
  if (candle.trend === "BEARISH" && (slope === null || slope < 0) && (dominance === null || dominance === "MINUS")) return "SELL";
  return null;
};
const pullbackSignalLoose = (opinions) => {
  const direction = pullbackTrendLoose(opinions);
  const rsi = opinions?.rsi ?? null;
  if (!direction || !rsi) return null;
  if (direction === "BUY" && !(rsi.rsi <= 35)) return null;
  if (direction === "SELL" && !(rsi.rsi >= 65)) return null;
  return direction;
};
// Faixa Cardwell (40-50 em alta / 50-60 em baixa): pullback mais frequente, fiel a literatura.
const pullbackSignal4060 = (opinions) => {
  const direction = pullbackTrend(opinions) ?? pullbackTrendLoose(opinions);
  const rsi = opinions?.rsi ?? null;
  if (!direction || !rsi) return null;
  if (direction === "BUY" && !(rsi.rsi <= 40)) return null;
  if (direction === "SELL" && !(rsi.rsi >= 60)) return null;
  return direction;
};
const pullbackSignalX4060 = (opinions) => {
  const direction = pullbackTrend(opinions) ?? pullbackTrendLoose(opinions);
  const rsi = opinions?.rsi ?? null;
  if (!direction || !rsi) return null;
  const slope = rsi.slope ?? null;
  if (direction === "BUY" && !(rsi.rsiMin <= 40 && rsi.rsi > 40 && (slope ?? 0) > 0)) return null;
  if (direction === "SELL" && !(rsi.rsiMax >= 60 && rsi.rsi < 60 && (slope ?? 0) < 0)) return null;
  return direction;
};
// Solta: faixa 45/55 (Cardwell) — mais sinais mantendo o contexto de tendencia.
const pullbackSignal4560 = (opinions) => {
  const direction = pullbackTrend(opinions) ?? pullbackTrendLoose(opinions);
  const rsi = opinions?.rsi ?? null;
  if (!direction || !rsi) return null;
  if (direction === "BUY" && !(rsi.rsi <= 45)) return null;
  if (direction === "SELL" && !(rsi.rsi >= 55)) return null;
  return direction;
};
// Restrita: estrutura ESTRITA (sem fallback), pullback segurando, dominancia alinhada e retorno do RSI.
const pullbackSignalXTight = (opinions) => {
  const candle = opinions?.candle ?? null;
  const adx = opinions?.adx ?? null;
  const atr = opinions?.atr ?? null;
  const bollinger = opinions?.bollinger ?? null;
  const rsi = opinions?.rsi ?? null;
  if (!candle || !adx || !rsi) return null;
  if (atr?.state === "DEAD" || atr?.climactic === true) return null;
  if (adx.regime === "RANGE") return null;
  if (candle.swingStructure !== "UP" && candle.swingStructure !== "DOWN") return null;
  if (candle.pullbackHolding !== true) return null;
  const direction = candle.swingStructure === "UP" ? "BUY" : "SELL";
  if (direction === "BUY" && candle.choch === "BEARISH") return null;
  if (direction === "SELL" && candle.choch === "BULLISH") return null;
  const dominance = adx.dominance ?? null;
  if (dominance && ((direction === "BUY" && dominance !== "PLUS") || (direction === "SELL" && dominance !== "MINUS"))) return null;
  const midSlope = bollinger?.middleSlope ?? null;
  if (direction === "BUY" && midSlope !== null && midSlope < 0) return null;
  if (direction === "SELL" && midSlope !== null && midSlope > 0) return null;
  const slope = rsi.slope ?? null;
  if (direction === "BUY" && !(rsi.rsiMin <= 40 && rsi.rsi > 40 && (slope ?? 0) > 0)) return null;
  if (direction === "SELL" && !(rsi.rsiMax >= 60 && rsi.rsi < 60 && (slope ?? 0) < 0)) return null;
  return direction;
};

/**
 * ESTRATEGIAS CUSTOM — familias validadas no backtest (sem vies, com controle aleatorio).
 *
 * Cada estrategia = { id, label, expirySeconds, gate(opinions) -> boolean, signal({snapshot, opinions}) -> "BUY"|"SELL"|null }.
 * O gate usa SOMENTE o cenario do momento; o sinal usa somente dados passados.
 *
 * 2026-09-22: PULLBACK — a familia com melhor evidencia (RSI pullback dentro da tendencia):
 * tendencia definida (candle/estrutura + slope da media + ADX fora de range) + RSI no extremo CONTRA
 * a tendencia => opera A FAVOR da tendencia (compra a queda em alta; vende o ralo em baixa).
 * Vence em 150s e 300s; variante X exige o retorno do RSI (crossback), como na literatura.
 * 2026-09-22: CONT_300 — continuacao pura pelo agente de candles (mantida em medicao).
 */
export const CUSTOM_STRATEGIES = Object.freeze([
  {
    id: "PULLBACK_150",
    label: "Pullback 150s (RSI contra a tendencia)",
    expirySeconds: 150,
    gate: ({ opinions }) => pullbackTrend(opinions) !== null,
    signal: ({ opinions }) => pullbackSignal(opinions),
  },
  {
    id: "PULLBACK_300",
    label: "Pullback 300s (RSI contra a tendencia)",
    expirySeconds: 300,
    gate: ({ opinions }) => pullbackTrend(opinions) !== null,
    signal: ({ opinions }) => pullbackSignal(opinions),
  },
  {
    id: "PULLBACK_X300",
    label: "Pullback 300s com retorno do RSI",
    expirySeconds: 300,
    gate: ({ opinions }) => pullbackTrend(opinions) !== null,
    signal: ({ opinions }) => pullbackSignal(opinions, { requireCrossback: true }),
  },
  {
    id: "PULLBACK_LOOSE_300",
    label: "Pullback 300s solto (RSI 35/65)",
    expirySeconds: 300,
    gate: ({ opinions }) => pullbackTrendLoose(opinions) !== null,
    signal: ({ opinions }) => pullbackSignalLoose(opinions),
  },
  {
    id: "PULLBACK_4060_180",
    label: "Pullback 180s (RSI 40/60)",
    expirySeconds: 180,
    gate: ({ opinions }) => (pullbackTrend(opinions) ?? pullbackTrendLoose(opinions)) !== null,
    signal: ({ opinions }) => pullbackSignal4060(opinions),
  },
  {
    id: "PULLBACK_4060_300",
    label: "Pullback 300s (RSI 40/60)",
    expirySeconds: 300,
    gate: ({ opinions }) => (pullbackTrend(opinions) ?? pullbackTrendLoose(opinions)) !== null,
    signal: ({ opinions }) => pullbackSignal4060(opinions),
  },
  {
    id: "PULLBACK_X4060_300",
    label: "Pullback 300s 40/60 com retorno do RSI",
    expirySeconds: 300,
    gate: ({ opinions }) => (pullbackTrend(opinions) ?? pullbackTrendLoose(opinions)) !== null,
    signal: ({ opinions }) => pullbackSignalX4060(opinions),
  },
  {
    id: "PULLBACK_4560_300",
    label: "Pullback 300s solto (RSI 45/55)",
    expirySeconds: 300,
    gate: ({ opinions }) => (pullbackTrend(opinions) ?? pullbackTrendLoose(opinions)) !== null,
    signal: ({ opinions }) => pullbackSignal4560(opinions),
  },
  {
    id: "PULLBACK_XTIGHT_300",
    label: "Pullback 300s restrito (estrutura+pullback+dominancia)",
    expirySeconds: 300,
    gate: ({ opinions }) => {
      const candle = opinions?.candle ?? null;
      return Boolean(candle && (candle.swingStructure === "UP" || candle.swingStructure === "DOWN") && candle.pullbackHolding === true);
    },
    signal: ({ opinions }) => pullbackSignalXTight(opinions),
  },
  {
    id: "CONT_300",
    label: "Continuacao 300s (candle+ADX)",
    expirySeconds: 300,
    gate: ({ opinions }) => {
      const candle = opinions?.candle ?? null;
      const adx = opinions?.adx ?? null;
      const atr = opinions?.atr ?? null;
      if (!candle || !adx) return false;
      if (candle.trend !== "BULLISH" && candle.trend !== "BEARISH") return false;
      if (candle.structure === "REVERSAL") return false;
      if (adx.regime === "RANGE") return false;
      if (atr?.state === "DEAD") return false;
      if (atr?.climactic === true) return false;
      return true;
    },
    signal: ({ opinions }) => {
      const candle = opinions?.candle ?? null;
      const adx = opinions?.adx ?? null;
      const direction = candle?.trend === "BULLISH" ? "BUY" : candle?.trend === "BEARISH" ? "SELL" : null;
      if (!direction) return null;
      const dominance = adx?.dominance ?? null;
      if (dominance && ((direction === "BUY" && dominance === "MINUS") || (direction === "SELL" && dominance === "PLUS"))) return null;
      return direction;
    },
  },
]);

export const customStrategyById = (id) => CUSTOM_STRATEGIES.find((s) => s.id === String(id ?? "").toUpperCase()) ?? null;

/** Avalia todas as estrategias custom no snapshot: [{ id, label, expirySeconds, decision, side }]. */
export function evaluateCustomStrategies({ snapshot, opinions }) {
  return CUSTOM_STRATEGIES.map((strategy) => {
    const ok = strategy.gate({ snapshot, opinions }) === true;
    const side = ok ? strategy.signal({ snapshot, opinions }) : null;
    return { id: strategy.id, label: strategy.label, expirySeconds: strategy.expirySeconds, decision: side ?? "WAIT", side: side ?? null };
  });
}
