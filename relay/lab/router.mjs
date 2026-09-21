/**
 * STRATEGY ROUTER (lab) — UM snapshot -> SEIS interpretacoes independentes.
 * Nao recalcula features; nao compartilha estado entre estrategias; puro e deterministico.
 */
import { evaluateS01, S01_ID } from "./strategies/s01-rsi-reversal.mjs";
import { evaluateS02, S02_ID } from "./strategies/s02-macd-momentum.mjs";
import { evaluateS03, S03_ID } from "./strategies/s03-ema-pullback.mjs";
import { evaluateS04, S04_ID } from "./strategies/s04-bollinger-reversion.mjs";
import { evaluateS05, S05_ID } from "./strategies/s05-stochastic-reversal.mjs";
import { evaluateS06, S06_ID } from "./strategies/s06-rsi-fibonacci.mjs";

export const LAB_ROUTER_VERSION = "lab-router-v1";
const EVALUATORS = Object.freeze([
  [S01_ID, evaluateS01],
  [S02_ID, evaluateS02],
  [S03_ID, evaluateS03],
  [S04_ID, evaluateS04],
  [S05_ID, evaluateS05],
  [S06_ID, evaluateS06],
]);

export function routeSnapshot(snapshot, { only = null } = {}) {
  if (!snapshot) return [];
  const evaluators = Array.isArray(only) && only.length ? EVALUATORS.filter(([id]) => only.includes(id)) : EVALUATORS;
  return evaluators.map(([strategyId, evaluate]) => {
    const result = evaluate(snapshot);
    return { ...result, strategyId: result.strategyId ?? strategyId, snapshotId: result.snapshotId ?? snapshot.snapshotId };
  });
}
