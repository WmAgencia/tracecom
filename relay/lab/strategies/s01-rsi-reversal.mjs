/** S01 RSI REVERSAL (lab) — base = Consensus atual (Strategy Core 01). */
import { analyzeRsi } from "../../consensus/specialists/rsi.mjs";
import { analyzeBollinger } from "../../consensus/specialists/bollinger.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { analyzePriceAction } from "../../consensus/specialists/price-action.mjs";
import { decide } from "../../consensus/decisor.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S01_ID = "S01_RSI_REVERSAL";
export const S01_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S01_ID)?.version ?? "lab-s01-v1";

export function evaluateS01(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const rsi = analyzeRsi(snapshot);
  if (!rsi.opportunity) return { strategyId: S01_ID, strategyVersion: S01_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: "sem oportunidade RSI (73/28)", evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: "NO_RSI_OPPORTUNITY", detail: `rsi ${rsi.rsi}` }], specialistOutputs: { rsi } };
  const bollinger = analyzeBollinger(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const priceAction = analyzePriceAction(snapshot);
  const decision = decide({ snapshot, rsi, priceAction, bollinger, dmiAdx });
  return {
    strategyId: S01_ID, strategyVersion: S01_VERSION, snapshotId, opportunity: true,
    decision: decision.decision, side: decision.side, reason: decision.reason,
    evidenceStrength: decision.evidenceStrength, supportingEvidence: decision.supportingEvidence, counterEvidence: decision.counterEvidence,
    specialistOutputs: { rsi, bollinger, dmiAdx, priceAction },
  };
}
