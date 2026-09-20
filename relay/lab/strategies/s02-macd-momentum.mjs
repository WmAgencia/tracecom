/** S02 MACD MOMENTUM (lab) — nascimento/retomada de impulso; cruzamento isolado NAO e ordem. */
import { analyzeMacd } from "../specialists/macd.mjs";
import { analyzePriceAction } from "../../consensus/specialists/price-action.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S02_ID = "S02_MACD_MOMENTUM";
export const S02_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S02_ID)?.version ?? "lab-s02-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function evaluateS02(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const macd = analyzeMacd(snapshot);
  const priceAction = analyzePriceAction(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const specialists = { macd, priceAction, dmiAdx };
  const actionable = ["CROSS_BULLISH", "CROSS_BEARISH", "HISTOGRAM_IMPROVING", "HISTOGRAM_DECAYING"].includes(macd.state) && macd.direction !== "NEUTRAL";
  if (!actionable) return { strategyId: S02_ID, strategyVersion: S02_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: "sem momentum acionavel no MACD", evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: "MACD_SEM_MOMENTUM", detail: macd.state }], specialistOutputs: specialists };
  const side = macd.direction === "BULLISH" ? "BUY" : "SELL";
  const buy = side === "BUY";
  const supportingEvidence = [];
  const counterEvidence = [];
  if (macd.state.startsWith("CROSS")) supportingEvidence.push({ code: `MACD_${macd.state}`, detail: "cruzamento recente com a Signal" });
  if (macd.histogramSlope !== null && (buy ? macd.histogramSlope > 0 : macd.histogramSlope < 0)) supportingEvidence.push({ code: "MACD_HISTOGRAM_ALINHADO", detail: `slope ${round(macd.histogramSlope, 6)}` });
  const paAgainst = buy
    ? priceAction.direction === "BEARISH" && priceAction.structure === "CONTINUATION" && priceAction.continuationEvidence >= 0.5
    : priceAction.direction === "BULLISH" && priceAction.structure === "CONTINUATION" && priceAction.continuationEvidence >= 0.5;
  if (paAgainst) counterEvidence.push({ code: "PRICE_ACTION_CONTRA_CONTINUACAO", detail: `${priceAction.direction} ${priceAction.structure} ${priceAction.continuationEvidence}` });
  const sideDmi = dmiAdx.sides?.[buy ? "BUY" : "SELL"] ?? null;
  const dmiAgainst = (dmiAdx.dominance === (buy ? "MINUS" : "PLUS")) && ((buy ? dmiAdx.minusSlope : dmiAdx.plusSlope) ?? 0) > 0 && dmiAdx.adx?.rising === true;
  if (dmiAgainst) counterEvidence.push({ code: "DMI_ADX_CONTRADIR_MOMENTUM", detail: `${dmiAdx.dominance} dominante com ADX subindo` });
  const whipsaw = macd.weakCross === true && snapshot?.indicators?.adx?.strong !== true;
  if (whipsaw) counterEvidence.push({ code: "MACD_RANGE_WHIPSAW", detail: "cruzamento fraco (|hist|/atr < 0.15) sem ADX forte" });
  const momentumOk = macd.state.startsWith("CROSS") || (macd.histogramSlope !== null && (buy ? macd.histogramSlope > 0 : macd.histogramSlope < 0));
  const structureOk = buy ? (priceAction.direction !== "BEARISH" || priceAction.structure !== "CONTINUATION") && !(priceAction.structure === "REVERSAL" && priceAction.direction === "BEARISH") : (priceAction.direction !== "BULLISH" || priceAction.structure !== "CONTINUATION") && !(priceAction.structure === "REVERSAL" && priceAction.direction === "BULLISH");
  const pressureOk = buy ? (dmiAdx.dominance === "PLUS" || sideDmi?.oppositeReacting === true || (dmiAdx.plusSlope ?? 0) > 0) : (dmiAdx.dominance === "MINUS" || sideDmi?.oppositeReacting === true || (dmiAdx.minusSlope ?? 0) > 0);
  if (!structureOk) counterEvidence.push({ code: "PRICE_ACTION_SEM_FOLLOW_THROUGH", detail: `estrutura ${priceAction.structure} ${priceAction.direction}` });
  if (!pressureOk) counterEvidence.push({ code: "DMI_SEM_PRESSAO_COERENTE", detail: `dominancia ${dmiAdx.dominance}` });
  const hardBlocked = counterEvidence.some((row) => ["PRICE_ACTION_CONTRA_CONTINUACAO", "DMI_ADX_CONTRADIR_MOMENTUM", "MACD_RANGE_WHIPSAW"].includes(row.code));
  const evidenceStrength = clamp01(0.45 * (macd.strength ?? 0) + 0.3 * (pressureOk ? 0.6 : 0) + 0.25 * (structureOk ? 0.6 : 0));
  if (hardBlocked || !momentumOk || !structureOk || !pressureOk) {
    const missing = [!momentumOk ? "MACD" : null, !structureOk ? "PriceAction" : null, !pressureOk ? "DMI/ADX" : null].filter(Boolean).join(" + ");
    return { strategyId: S02_ID, strategyVersion: S02_VERSION, snapshotId, opportunity: true, decision: "WAIT", side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: hardBlocked ? `Momento ${side} barrado: ${counterEvidence.filter((r) => !r.code.startsWith("MACD_HISTOGRAM")).map((r) => r.code).join("+")}` : `Momentum ${side} sem alinhamento completo: ${missing}. WAIT.`, specialistOutputs: specialists };
  }
  return { strategyId: S02_ID, strategyVersion: S02_VERSION, snapshotId, opportunity: true, decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Momentum ${side} confirmado: MACD ${macd.state}, estrutura ${priceAction.structure}/${priceAction.direction}, pressao ${dmiAdx.dominance}.`, specialistOutputs: specialists };
}
