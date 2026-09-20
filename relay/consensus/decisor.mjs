/**
 * ESPECIALISTA 5 — DECISOR / CONSENSUS.
 * Sintese semantica (NAO votacao por maioria). Nao recalcula indicadores; usa apenas
 * o que os especialistas observaram no MESMO snapshot. Saida: BUY | SELL | WAIT.
 * evidenceStrength e medida descritiva interna (NUNCA probabilidade de vitoria).
 */
export const DECISOR_VERSION = "consensus-decisor-v1";

const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function decide({ snapshot, rsi, priceAction, bollinger, dmiAdx } = {}) {
  const at = snapshot?.at ?? Date.now();
  const snapshotId = snapshot?.snapshotId ?? null;
  const base = { decision: "WAIT", side: null, evidenceStrength: 0, supportingEvidence: [], counterEvidence: [], reason: "", snapshotId, at, version: DECISOR_VERSION };
  if (!rsi?.opportunity) return { ...base, reason: "RSI fora da zona de oportunidade (28..73): sem candidato." };

  const side = rsi.side;
  const sell = side === "SELL";
  const sideDmi = dmiAdx?.sides?.[side] ?? null;
  const supportingEvidence = [];
  const counterEvidence = [];

  const paAgainst = priceAction?.direction === (sell ? "BULLISH" : "BEARISH");
  const paContinuationStrong = priceAction?.structure === "CONTINUATION" && paAgainst && (priceAction?.continuationEvidence ?? 0) >= 0.5;
  const bbRiding = bollinger?.state === "BAND_RIDING" || (bollinger?.state === "CONTINUATION" && bollinger?.side === side);
  const dmiOldStrong = (sideDmi?.evidenceContinuation ?? 0) >= 0.5 || dmiAdx?.state === "OLD_TREND_STRENGTHENING";
  const rsiAccelerating = rsi?.state === "EXTREME_AND_ACCELERATING";

  if (paContinuationStrong) counterEvidence.push({ code: "PRICE_ACTION_CONTINUACAO", detail: `estrutura ${priceAction?.structure} ${priceAction?.direction} com continuacao ${priceAction?.continuationEvidence}` });
  if (bbRiding) counterEvidence.push({ code: "BOLLINGER_BAND_RIDING_CONTINUACAO", detail: `estado ${bollinger?.state}` });
  if (dmiOldStrong) counterEvidence.push({ code: "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", detail: `evidencia_continuacao ${sideDmi?.evidenceContinuation ?? dmiAdx?.evidenceContinuation}` });
  if (rsiAccelerating && ((priceAction?.continuationEvidence ?? 0) >= 0.4 || (sideDmi?.evidenceContinuation ?? 0) >= 0.4)) counterEvidence.push({ code: "RSI_ACELERANDO_COM_CONTINUACAO", detail: `RSI ${rsi?.rsi} acelerando para o extremo` });

  const bbSupports = bollinger?.side === side && (bollinger?.state === "REJECTION" || bollinger?.state === "REENTRY" || (bollinger?.evidenceReversal ?? 0) >= 0.4);
  const dmiSupports = Boolean(sideDmi && ((sideDmi.oldTrendWeakening && sideDmi.oppositeReacting) || sideDmi.newDominance));
  const paSupports = (priceAction?.reversalEvidence ?? 0) >= 0.35 || priceAction?.structure === "REVERSAL";

  if (bbSupports) supportingEvidence.push({ code: "BOLLINGER_REJEICAO_REENTRADA", detail: `${bollinger?.state} (evidencia ${bollinger?.evidenceReversal})` });
  else counterEvidence.push({ code: "BOLLINGER_SEM_REJEICAO_REENTRADA", detail: `estado ${bollinger?.state} sem rejeicao/reentrada para ${side}` });
  if (dmiSupports) supportingEvidence.push({ code: "DMI_ADX_TRANSICAO_CONFIRMADA", detail: `${sideDmi?.state} (antigo enfraquecendo=${sideDmi?.oldTrendWeakening}, oposto reagindo=${sideDmi?.oppositeReacting}, nova dominancia=${sideDmi?.newDominance})` });
  else counterEvidence.push({ code: "DMI_ADX_SEM_TRANSICAO", detail: `${sideDmi?.state ?? "sem leitura"} (enfraquecimento sozinho nao confirma)` });
  if (paSupports) supportingEvidence.push({ code: "PRICE_ACTION_REVERSAO", detail: `estrutura ${priceAction?.structure} evidencia_reversao ${priceAction?.reversalEvidence}` });
  else counterEvidence.push({ code: "PRICE_ACTION_SEM_REVERSAO", detail: `estrutura ${priceAction?.structure} evidencia_reversao ${priceAction?.reversalEvidence}` });

  const hardBlocked = counterEvidence.some((row) => ["PRICE_ACTION_CONTINUACAO", "BOLLINGER_BAND_RIDING_CONTINUACAO", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_ACELERANDO_COM_CONTINUACAO"].includes(row.code));
  const evidenceStrength = clamp01(0.4 * (sideDmi?.evidenceReversal ?? 0) + 0.3 * (bollinger?.evidenceReversal ?? 0) + 0.3 * (priceAction?.reversalEvidence ?? 0));

  if (hardBlocked) {
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `RSI ${rsi?.rsi} indica oportunidade ${side}, mas ha evidencia de continuacao: ${counterEvidence.filter((r) => r.code !== "BOLLINGER_SEM_REJEICAO_REENTRADA" && r.code !== "DMI_ADX_SEM_TRANSICAO" && r.code !== "PRICE_ACTION_SEM_REVERSAO").map((r) => r.code).join("+")}. WAIT.` };
  }
  if (!bbSupports || !dmiSupports || !paSupports) {
    const missing = [!bbSupports ? "Bollinger" : null, !dmiSupports ? "DMI/ADX" : null, !paSupports ? "PriceAction" : null].filter(Boolean).join(" + ");
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `Oportunidade ${side} detectada (RSI ${rsi?.rsi}), mas falta confirmacao: ${missing}. WAIT.` };
  }

  return {
    decision: side, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
    reason: `Reversao ${side} confirmada: RSI ${rsi?.rsi} (${rsi?.state}), Bollinger ${bollinger?.state}, ${sideDmi?.state}, PriceAction ${priceAction?.structure}.`,
    snapshotId, at, version: DECISOR_VERSION,
  };
}
