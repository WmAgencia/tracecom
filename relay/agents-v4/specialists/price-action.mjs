/**
 * PRICE_ACTION_AGENT — anatomia quantitativa do candle: corpo, range, pavios, close location,
 * rejeicao, qualidade de rompimento, falha de rompimento e sequencia. Sem nomes subjetivos de candle.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const PRICE_ACTION_AGENT_VERSION = "price-action-agent-v1";
export const PRICE_ACTION_STATES = Object.freeze(["BULLISH", "BEARISH", "NEUTRAL", "UNCERTAIN"]);

export function analyzePriceAction({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];
  let up = 0, down = 0;

  const confidenceInCandle = Number.isFinite(f.bodyRatio) || Number.isFinite(f.closeLocation);
  if (Number.isFinite(f.closeLocation)) { used.push("closeLocation"); if (f.closeLocation >= 0.65) { up += 1; bullish.push(`close_no_topo=${f.closeLocation}`); } else if (f.closeLocation <= 0.35) { down += 1; bearish.push(`close_no_fundo=${f.closeLocation}`); } else neutral.push(`close_meio=${f.closeLocation}`); }
  if (Number.isFinite(f.bodyRatio)) {
    used.push("bodyRatio", "candleDirection");
    if (f.bodyRatio >= 0.5) {
      if (f.candleDirection === "UP") { up += 1.5; bullish.push(`corpo_dominante_up=${f.bodyRatio}`); }
      else if (f.candleDirection === "DOWN") { down += 1.5; bearish.push(`corpo_dominante_down=${f.bodyRatio}`); }
    } else neutral.push(`corpo_fraco=${f.bodyRatio}`);
  }
  if (f.rejectionDown) { up += 1.5; bullish.push("rejeicao_inferior"); used.push("rejectionDown"); }
  if (f.rejectionUp) { down += 1.5; bearish.push("rejeicao_superior"); used.push("rejectionUp"); }
  if (f.bosUp && Number.isFinite(f.bodyRatio) && f.bodyRatio >= 0.5) { up += 1.5; bullish.push("rompimento_com_corpo"); used.push("bosUp"); }
  else if (f.bosUp) { up += 0.5; neutral.push("rompimento_sem_corpo_dominante"); used.push("bosUp"); }
  if (f.bosDown && Number.isFinite(f.bodyRatio) && f.bodyRatio >= 0.5) { down += 1.5; bearish.push("rompimento_com_corpo"); used.push("bosDown"); }
  else if (f.bosDown) { down += 0.5; neutral.push("rompimento_sem_corpo_dominante"); used.push("bosDown"); }
  if (f.failedBreakoutUp) { down += 1.5; bearish.push("falha_de_rompimento_topo"); used.push("failedBreakoutUp"); }
  if (f.failedBreakoutDown) { up += 1.5; bullish.push("falha_de_rompimento_fundo"); used.push("failedBreakoutDown"); }
  if (Number.isFinite(f.streak) && Math.abs(f.streak) >= 2) {
    used.push("streak");
    if (f.streak > 0) { up += 0.75; bullish.push(`sequencia_alta=${f.streak}`); } else { down += 0.75; bearish.push(`sequencia_baixa=${f.streak}`); }
  }
  if (Number.isFinite(f.upperWick) && f.upperWick >= 0.55) risks.push("PAVIO_SUPERIOR_DOMINANTE");
  if (Number.isFinite(f.lowerWick) && f.lowerWick >= 0.55) risks.push("PAVIO_INFERIOR_DOMINANTE");
  if (Number.isFinite(f.relativeRange) && Number.isFinite(f.atr) && f.relativeRange > 2.5) risks.push("RANGE_ANORMAL_NA_ENTRADA");

  let state = "UNCERTAIN";
  if (!confidenceInCandle) state = "UNCERTAIN";
  else if (up >= 2 && up > down + 0.5) state = "BULLISH";
  else if (down >= 2 && down > up + 0.5) state = "BEARISH";
  else if (up === 0 && down === 0) state = "NEUTRAL";
  else state = "NEUTRAL";

  return makeAgentOutput({
    agentId: "PRICE_ACTION_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `price_action=${state} (up=${up} down=${down})`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: Math.max(up, down) >= 3 ? "HIGH" : Math.max(up, down) >= 1.5 ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `bodyRatio=${f.bodyRatio} direction=${f.candleDirection} closeLoc=${f.closeLocation} rejectionUp=${f.rejectionUp} rejectionDown=${f.rejectionDown} streak=${f.streak}`,
    availableAt: f.availableAt,
    detail: {
      scores: { up, down },
      bodyRatio: f.bodyRatio, closeLocation: f.closeLocation, candleDirection: f.candleDirection,
      rejection: { up: f.rejectionUp, down: f.rejectionDown },
      breakQuality: f.bosUp || f.bosDown ? (Number.isFinite(f.bodyRatio) && f.bodyRatio >= 0.5 ? "WITH_BODY" : "WITHOUT_BODY") : null,
      failedBreak: { up: f.failedBreakoutUp, down: f.failedBreakoutDown },
      sequence: f.candleSequence,
    },
  });
}
