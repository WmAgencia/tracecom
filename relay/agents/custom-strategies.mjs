/**
 * ESTRATEGIAS CUSTOM — familias validadas no backtest (sem vies, com controle aleatorio).
 *
 * Cada estrategia = { id, label, expirySeconds, gate(opinions) -> boolean, signal({snapshot, opinions}) -> "BUY"|"SELL"|null }.
 * O gate usa SOMENTE o cenario do momento (ADX x Bollinger); o sinal usa somente dados passados.
 */
export const CUSTOM_STRATEGIES = Object.freeze([
  {
    id: "BANDA_300",
    label: "Banda (rejeicao) 300s",
    expirySeconds: 300,
    gate: () => true,
    signal: ({ opinions }) => {
      const rejection = opinions?.bollinger?.rejection;
      return rejection === "LOWER" ? "BUY" : rejection === "UPPER" ? "SELL" : null;
    },
  },
  {
    id: "BANDA_TREND_RANGE",
    label: "Banda + Trend/Range 300s",
    expirySeconds: 300,
    gate: ({ opinions }) => opinions?.adx?.regime === "TREND" && opinions?.bollinger?.regime === "RANGE",
    signal: ({ opinions }) => {
      const rejection = opinions?.bollinger?.rejection;
      return rejection === "LOWER" ? "BUY" : rejection === "UPPER" ? "SELL" : null;
    },
  },
  {
    id: "BANDA_TREND_SQUEEZE",
    label: "Banda + Trend/Squeeze 300s",
    expirySeconds: 300,
    gate: ({ opinions }) => opinions?.adx?.regime === "TREND" && opinions?.bollinger?.regime === "SQUEEZE",
    signal: ({ opinions }) => {
      const rejection = opinions?.bollinger?.rejection;
      return rejection === "LOWER" ? "BUY" : rejection === "UPPER" ? "SELL" : null;
    },
  },
  {
    id: "CONTRA_MOM6_TREND_WALK",
    label: "Contra-Momento6 + Trend/Walk 300s",
    expirySeconds: 300,
    gate: ({ opinions }) => opinions?.adx?.regime === "TREND" && opinions?.bollinger?.regime === "WALK",
    signal: ({ snapshot }) => {
      const closes = (snapshot?.recentCandles ?? []).map((c) => Number(c.close));
      if (closes.length < 7) return null;
      return closes[closes.length - 1] > closes[closes.length - 7] ? "SELL" : "BUY";
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
