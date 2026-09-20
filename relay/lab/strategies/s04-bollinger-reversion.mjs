/** S04 BOLLINGER MEAN REVERSION (lab) — Bollinger e o GATILHO; TOUCH/OUTSIDE nao sao sinal. */
import { analyzeBollinger } from "../../consensus/specialists/bollinger.mjs";
import { analyzePriceAction } from "../../consensus/specialists/price-action.mjs";
import { analyzeMomentum } from "../specialists/momentum.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S04_ID = "S04_BOLLINGER_MEAN_REVERSION";
export const S04_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S04_ID)?.version ?? "lab-s04-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function evaluateS04(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const bollinger = analyzeBollinger(snapshot);
  const priceAction = analyzePriceAction(snapshot);
  const momentum = analyzeMomentum(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const specialists = { bollinger, priceAction, momentum, dmiAdx };
  const trigger = bollinger.state === "REJECTION" || bollinger.state === "REENTRY";
  if (!trigger) return { strategyId: S04_ID, strategyVersion: S04_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: `sem gatilho Bollinger (${bollinger.state})`, evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: bollinger.state === "BAND_RIDING" ? "BAND_RIDING" : "BOLLINGER_SEM_REJEICAO_REENTRADA", detail: bollinger.state }], specialistOutputs: specialists };
  const side = bollinger.side === "BUY" ? "BUY" : "SELL";
  const buy = side === "BUY";
  const supportingEvidence = [{ code: "BOLLINGER_REJEICAO_REENTRADA", detail: `${bollinger.state} na banda ${buy ? "inferior" : "superior"}` }];
  const counterEvidence = [];
  const paSupports = priceAction.reversalEvidence >= 0.35 && (buy ? priceAction.direction !== "BEARISH" || priceAction.structure === "REVERSAL" : priceAction.direction !== "BULLISH" || priceAction.structure === "REVERSAL");
  if (paSupports) supportingEvidence.push({ code: "PRICE_ACTION_REVERSAO", detail: `estrutura ${priceAction.structure} evidencia ${priceAction.reversalEvidence}` });
  else counterEvidence.push({ code: "PRICE_ACTION_SEM_REVERSAO", detail: `${priceAction.structure} ${priceAction.direction} (${priceAction.reversalEvidence})` });
  const sideDmi = dmiAdx.sides?.[side] ?? null;
  const riding = bollinger.state === "BAND_RIDING" || (bollinger.state === "CONTINUATION" && bollinger.side === side);
  const oldStrong = (sideDmi?.evidenceContinuation ?? 0) >= 0.5 || dmiAdx.state === "OLD_TREND_STRENGTHENING";
  if (riding) counterEvidence.push({ code: "BAND_RIDING", detail: bollinger.state });
  if (oldStrong) counterEvidence.push({ code: "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", detail: sideDmi?.state ?? dmiAdx.state });
  if (momentum.acceleratingIntoExtreme === true) counterEvidence.push({ code: "MOMENTUM_ACELERANDO_CONTRA", detail: `rsi ${momentum.rsi} acelerando` });
  const hardBlocked = counterEvidence.some((row) => ["BAND_RIDING", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "PRICE_ACTION_CONTRA_REVERSAO"].includes(row.code));
  const evidenceStrength = clamp01(0.45 * (bollinger.evidenceReversal ?? 0) + 0.35 * (priceAction.reversalEvidence ?? 0) + 0.2 * (momentum.state === "MOMENTUM_TURNING" ? 0.7 : 0.2));
  if (hardBlocked || !paSupports) {
    return { strategyId: S04_ID, strategyVersion: S04_VERSION, snapshotId, opportunity: true, decision: "WAIT", side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Extensao ${side} com ${bollinger.state}, mas ${hardBlocked ? counterEvidence.filter((r) => ["BAND_RIDING", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO"].includes(r.code)).map((r) => r.code).join("+") : "sem confirmacao de Price Action"}. WAIT.`, specialistOutputs: specialists };
  }
  return { strategyId: S04_ID, strategyVersion: S04_VERSION, snapshotId, opportunity: true, decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Mean reversion ${side}: ${bollinger.state} + Price Action ${priceAction.structure} (${priceAction.reversalEvidence}), momentum ${momentum.state}.`, specialistOutputs: specialists };
}
