/** S03 EMA PULLBACK TREND (lab) — TREND + PULLBACK + RESUMPTION; EMA 9/21 (hipotese experimental). */
import { analyzeEmaTrend } from "../specialists/ema-trend.mjs";
import { analyzePullback } from "../specialists/pullback.mjs";
import { analyzeVolatility } from "../specialists/volatility.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S03_ID = "S03_EMA_PULLBACK_TREND";
export const S03_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S03_ID)?.version ?? "lab-s03-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function evaluateS03(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const emaTrend = analyzeEmaTrend(snapshot);
  const pullback = analyzePullback(snapshot, emaTrend);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const volatility = analyzeVolatility(snapshot);
  const specialists = { emaTrend, pullback, dmiAdx, volatility };
  const trendOk = emaTrend.state === "ALIGNED_BULLISH" || emaTrend.state === "ALIGNED_BEARISH";
  if (!trendOk) return { strategyId: S03_ID, strategyVersion: S03_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: "sem tendencia EMA alinhada (9/21)", evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: "EMA_SEM_TENDENCIA", detail: emaTrend.state }], specialistOutputs: specialists };
  const buy = emaTrend.state === "ALIGNED_BULLISH";
  const side = buy ? "BUY" : "SELL";
  const supportingEvidence = [];
  const counterEvidence = [];
  if (pullback.state === (buy ? "RESUMPTION_BULLISH" : "RESUMPTION_BEARISH")) supportingEvidence.push({ code: "PULLBACK_RESUMPTION", detail: `${pullback.retraceCandles} candles de retracao + retomada` });
  const hardCodes = ["TREND_BREAK_SLOW_EMA", "PULLBACK_SEM_RETOMADA", "DMI_ADX_CONTRADIR_TENDENCIA", "VOLATILITY_DEAD_MARKET"];
  if (pullback.state === "TREND_BREAK_SLOW_EMA") counterEvidence.push({ code: "TREND_BREAK_SLOW_EMA", detail: "preco perdeu a EMA lenta" });
  if (pullback.state === "PULLBACK_IN_PROGRESS") counterEvidence.push({ code: "PULLBACK_SEM_RETOMADA", detail: "pullback sem retomada" });
  const sideDmi = dmiAdx.sides?.[buy ? "BUY" : "SELL"] ?? null;
  const dmiAgainst = (dmiAdx.dominance === (buy ? "MINUS" : "PLUS")) && ((buy ? dmiAdx.minusSlope : dmiAdx.plusSlope) ?? 0) > 0 && dmiAdx.adx?.rising === true;
  if (dmiAgainst) counterEvidence.push({ code: "DMI_ADX_CONTRADIR_TENDENCIA", detail: `${dmiAdx.dominance} dominante com ADX subindo` });
  if (volatility.state === "DEAD_MARKET") counterEvidence.push({ code: "VOLATILITY_DEAD_MARKET", detail: `ratio ${volatility.ratio}` });
  if (volatility.state === "NOISY_MARKET") counterEvidence.push({ code: "VOLATILITY_NOISY", detail: `ratio ${volatility.ratio}` });
  const pressureOk = buy ? (sideDmi?.newDominance === true || sideDmi?.oldTrendWeakening === true || (dmiAdx.plusSlope ?? 0) > 0) : (sideDmi?.newDominance === true || sideDmi?.oldTrendWeakening === true || (dmiAdx.minusSlope ?? 0) > 0);
  if (!pressureOk) counterEvidence.push({ code: "DMI_SEM_PRESSAO_TENDENCIA", detail: `dominancia ${dmiAdx.dominance}` });
  const hardBlocked = counterEvidence.some((row) => hardCodes.includes(row.code));
  const resumptionOk = pullback.state === (buy ? "RESUMPTION_BULLISH" : "RESUMPTION_BEARISH");
  const evidenceStrength = clamp01(0.4 * (emaTrend.strength ?? 0) + 0.35 * (pullback.strength ?? 0) + 0.25 * (pressureOk ? 0.6 : 0));
  if (hardBlocked || !resumptionOk || !pressureOk) {
    return { strategyId: S03_ID, strategyVersion: S03_VERSION, snapshotId, opportunity: true, decision: "WAIT", side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: hardBlocked ? `Tendencia ${side} barrada: ${counterEvidence.filter((r) => hardCodes.includes(r.code)).map((r) => r.code).join("+")}` : `Tendencia ${side} sem retomada confirmada (${pullback.state}${pressureOk ? "" : " + DMI"}). WAIT.`, specialistOutputs: specialists };
  }
  return { strategyId: S03_ID, strategyVersion: S03_VERSION, snapshotId, opportunity: true, decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Pullback ${side} retomado: ${emaTrend.state}, ${pullback.retraceCandles} candles de retracao, pressao ${dmiAdx.dominance}.`, specialistOutputs: specialists };
}
