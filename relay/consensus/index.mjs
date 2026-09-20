/**
 * CONSENSUS CORE — API publica.
 * Fluxo: candles -> MarketSnapshot (imutavel/causal) -> RSI specialist (detector)
 *        -> PriceAction + Bollinger + DMI/ADX (confirmacao/contradicao) -> Decisor -> BUY|SELL|WAIT.
 */
export { CONSENSUS_VERSION, buildMarketSnapshot } from "./snapshot.mjs";
export { PRICE_ACTION_VERSION, analyzePriceAction } from "./specialists/price-action.mjs";
export { RSI_SPECIALIST_VERSION, RSI_OPPORTUNITY, analyzeRsi } from "./specialists/rsi.mjs";
export { BOLLINGER_SPECIALIST_VERSION, analyzeBollinger } from "./specialists/bollinger.mjs";
export { DMI_ADX_SPECIALIST_VERSION, analyzeDmiAdx } from "./specialists/dmi-adx.mjs";
export { DECISOR_VERSION, decide } from "./decisor.mjs";
export { CONSENSUS_LOG_VERSION, consensusFingerprint, createConsensusLog, formatConsensusHuman } from "./log.mjs";

import { buildMarketSnapshot } from "./snapshot.mjs";
import { analyzePriceAction } from "./specialists/price-action.mjs";
import { analyzeRsi } from "./specialists/rsi.mjs";
import { analyzeBollinger } from "./specialists/bollinger.mjs";
import { analyzeDmiAdx } from "./specialists/dmi-adx.mjs";
import { decide } from "./decisor.mjs";

export function evaluateConsensus({ marketKey, marketType = null, candles = [], now = Date.now(), payout = null, targetExpiryAt = null } = {}) {
  const startedAt = Date.now();
  const snapshot = buildMarketSnapshot({ marketKey, marketType, candles, now, payout, targetExpiryAt });
  if (!snapshot) return { snapshot: null, decision: { decision: "WAIT", side: null, reason: "snapshot_indisponivel_historico_insuficiente", supportingEvidence: [], counterEvidence: [], evidenceStrength: 0, snapshotId: null, at: now }, latencyMs: Date.now() - startedAt };
  const rsi = analyzeRsi(snapshot);
  if (!rsi.opportunity) return { snapshot, rsi, priceAction: null, bollinger: null, dmiAdx: null, decision: { decision: "WAIT", side: null, reason: rsi.observations[0] ?? "sem oportunidade", supportingEvidence: [], counterEvidence: [], evidenceStrength: 0, snapshotId: snapshot.snapshotId, at: snapshot.at }, latencyMs: Date.now() - startedAt };
  const priceAction = analyzePriceAction(snapshot);
  const bollinger = analyzeBollinger(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const decision = decide({ snapshot, rsi, priceAction, bollinger, dmiAdx });
  return { snapshot, rsi, priceAction, bollinger, dmiAdx, decision, latencyMs: Date.now() - startedAt };
}
