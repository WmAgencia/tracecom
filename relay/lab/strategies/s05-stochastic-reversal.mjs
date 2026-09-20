/** S05 STOCHASTIC REVERSAL (lab) — extremo + virada + confirmacao; divergencia = evidencia secundaria. */
import { analyzeStochastic } from "../specialists/stochastic.mjs";
import { analyzePriceAction } from "../../consensus/specialists/price-action.mjs";
import { analyzeBollinger } from "../../consensus/specialists/bollinger.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S05_ID = "S05_STOCHASTIC_REVERSAL";
export const S05_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S05_ID)?.version ?? "lab-s05-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function evaluateS05(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const stochastic = analyzeStochastic(snapshot);
  const priceAction = analyzePriceAction(snapshot);
  const bollinger = analyzeBollinger(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const specialists = { stochastic, priceAction, bollinger, dmiAdx };
  const turned = stochastic.state === "TURNING_FROM_OVERSOLD" || stochastic.state === "TURNING_FROM_OVERBOUGHT";
  if (!turned) return { strategyId: S05_ID, strategyVersion: S05_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: `sem virada do stochastic (${stochastic.state})`, evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: stochastic.state.startsWith("PERSISTENT") ? "STOCHASTIC_STILL_EXTREME" : "STOCHASTIC_SEM_VIRADA", detail: stochastic.state }], specialistOutputs: specialists };
  const side = stochastic.direction === "BULLISH" ? "BUY" : "SELL";
  const buy = side === "BUY";
  const supportingEvidence = [{ code: "STOCHASTIC_VIRADA", detail: stochastic.state }];
  const counterEvidence = [];
  const crossOk = stochastic.cross === (buy ? "BULLISH" : "BEARISH");
  if (crossOk) supportingEvidence.push({ code: `STOCHASTIC_CROSS_${stochastic.cross}`, detail: "%K cruzou %D" });
  if (stochastic.divergenceCandidate) supportingEvidence.push({ code: "STOCHASTIC_DIVERGENCIA_SECUNDARIA", detail: stochastic.divergenceCandidate });
  const paSupports = priceAction.reversalEvidence >= 0.35;
  if (paSupports) supportingEvidence.push({ code: "PRICE_ACTION_REVERSAO", detail: `${priceAction.structure} (${priceAction.reversalEvidence})` });
  else counterEvidence.push({ code: "PRICE_ACTION_CONTRA_REVERSAO", detail: `${priceAction.structure} ${priceAction.direction}` });
  const sideDmi = dmiAdx.sides?.[side] ?? null;
  const dmiAgainst = (dmiAdx.dominance === (buy ? "MINUS" : "PLUS")) && ((buy ? dmiAdx.minusSlope : dmiAdx.plusSlope) ?? 0) > 0 && dmiAdx.adx?.rising === true;
  if (dmiAgainst) counterEvidence.push({ code: "DMI_ADX_CONTRADIR_REVERSAO", detail: `${dmiAdx.dominance} dominante com ADX subindo` });
  if (bollinger.state === "NEUTRAL") counterEvidence.push({ code: "BOLLINGER_SEM_CONTEXTO", detail: "sem contexto de banda" });
  const hardBlocked = counterEvidence.some((row) => ["DMI_ADX_CONTRADIR_REVERSAO", "PRICE_ACTION_CONTRA_REVERSAO"].includes(row.code));
  const evidenceStrength = clamp01(0.5 * (stochastic.strength ?? 0) + 0.3 * (priceAction.reversalEvidence ?? 0) + 0.2 * (crossOk ? 0.8 : 0.3));
  if (hardBlocked || !paSupports) {
    return { strategyId: S05_ID, strategyVersion: S05_VERSION, snapshotId, opportunity: true, decision: "WAIT", side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Stochastic virou ${side}, mas ${hardBlocked ? counterEvidence.filter((r) => ["DMI_ADX_CONTRADIR_REVERSAO", "PRICE_ACTION_CONTRA_REVERSAO"].includes(r.code)).map((r) => r.code).join("+") : "sem confirmacao de preco"}. WAIT.`, specialistOutputs: specialists };
  }
  return { strategyId: S05_ID, strategyVersion: S05_VERSION, snapshotId, opportunity: true, decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Reversao ${side} por stochastic: ${stochastic.state}${crossOk ? " + cruzamento" : ""} + Price Action ${priceAction.structure}.`, specialistOutputs: specialists };
}
