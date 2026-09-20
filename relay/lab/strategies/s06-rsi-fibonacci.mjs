/** S06 RSI + FIBONACCI REVERSAL (lab) — S01 E zona Fibonacci com reacao (comparacao direta com S01). */
import { analyzeRsi } from "../../consensus/specialists/rsi.mjs";
import { analyzeBollinger } from "../../consensus/specialists/bollinger.mjs";
import { analyzeDmiAdx } from "../../consensus/specialists/dmi-adx.mjs";
import { analyzePriceAction } from "../../consensus/specialists/price-action.mjs";
import { analyzeFibonacci } from "../specialists/fibonacci.mjs";
import { decide } from "../../consensus/decisor.mjs";
import { LAB_STRATEGY_SPECS } from "../strategy-specs.mjs";

export const S06_ID = "S06_RSI_FIBONACCI_REVERSAL";
export const S06_VERSION = LAB_STRATEGY_SPECS.find((s) => s.id === S06_ID)?.version ?? "lab-s06-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function evaluateS06(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const rsi = analyzeRsi(snapshot);
  if (!rsi.opportunity) return { strategyId: S06_ID, strategyVersion: S06_VERSION, snapshotId, opportunity: false, decision: "WAIT", side: null, reason: "sem oportunidade RSI (73/28)", evidenceStrength: 0, supportingEvidence: [], counterEvidence: [{ code: "NO_RSI_OPPORTUNITY", detail: `rsi ${rsi.rsi}` }], specialistOutputs: { rsi } };
  const fibonacci = analyzeFibonacci(snapshot);
  const bollinger = analyzeBollinger(snapshot);
  const dmiAdx = analyzeDmiAdx(snapshot);
  const priceAction = analyzePriceAction(snapshot);
  const specialists = { rsi, fibonacci, bollinger, dmiAdx, priceAction };
  const core = decide({ snapshot, rsi, priceAction, bollinger, dmiAdx });
  const side = core.side;
  const supportingEvidence = [...(core.supportingEvidence ?? [])];
  const counterEvidence = [...(core.counterEvidence ?? [])];
  const fibAligned = fibonacci.direction === side;
  if (!fibAligned) counterEvidence.push({ code: "FIB_LEG_INCOMPATIVEL", detail: `fib ${fibonacci.direction} vs tese ${side}` });
  const zoneOk = fibAligned && (fibonacci.state === "ZONE_REACTION" || fibonacci.state === "IN_ZONE");
  if (fibonacci.state === "ZONE_REACTION") supportingEvidence.push({ code: "FIB_ZONE_REACTION", detail: `${(fibonacci.inZone ?? []).join("/")} (tol ${fibonacci.tolerance})` });
  if (fibonacci.state === "IN_ZONE") counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "na zona sem reacao" });
  if (fibonacci.state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora das zonas 38.2/50.0/61.8" });
  if (fibonacci.state === "ZONE_BROKEN") counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "anchor do leg perdido" });
  const hardBlocked = counterEvidence.some((row) => ["FIB_FORA_DE_ZONA", "FIB_ZONE_BROKEN", "FIB_SEM_REACAO", "FIB_LEG_INCOMPATIVEL", "PRICE_ACTION_CONTINUACAO", "BOLLINGER_BAND_RIDING_CONTINUACAO", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_ACELERANDO_COM_CONTINUACAO"].includes(row.code));
  const evidenceStrength = clamp01((core.evidenceStrength ?? 0) * 0.7 + (fibonacci.strength ?? 0) * 0.3);
  if (hardBlocked || !zoneOk) {
    return { strategyId: S06_ID, strategyVersion: S06_VERSION, snapshotId, opportunity: true, decision: "WAIT", side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: hardBlocked ? `RSI ${rsi.rsi} + Fibonacci ${fibonacci.state}: bloqueio (${counterEvidence.filter((r) => hardBlockedCodes.includes(r.code)).map((r) => r.code).join("+")}). WAIT.` : `RSI ${rsi.rsi} e confirmacoes V2, mas preco fora de zona Fibonacci 38.2/50.0/61.8. WAIT.`, specialistOutputs: specialists };
  }
  return { strategyId: S06_ID, strategyVersion: S06_VERSION, snapshotId, opportunity: true, decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence, reason: `Reversao ${side} com confluencia Fibonacci: RSI ${rsi.rsi}, ${fibonacci.state} ${(fibonacci.inZone ?? []).join("/")}, ${dmiAdx.sides?.[side]?.state ?? dmiAdx.state}.`, specialistOutputs: specialists };
}

const hardBlockedCodes = ["FIB_FORA_DE_ZONA", "FIB_ZONE_BROKEN", "FIB_SEM_REACAO", "FIB_LEG_INCOMPATIVEL", "PRICE_ACTION_CONTINUACAO", "BOLLINGER_BAND_RIDING_CONTINUACAO", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_ACELERANDO_COM_CONTINUACAO"];
