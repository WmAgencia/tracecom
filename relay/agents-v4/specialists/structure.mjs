/**
 * MARKET_STRUCTURE_AGENT — HH/HL/LH/LL, swings, S/R, BOS, range, breakout level, retest, falha.
 * NAO escolhe trade; fornece o esqueleto estrutural para cenarios/sintese.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const STRUCTURE_AGENT_VERSION = "market-structure-agent-v1";
export const STRUCTURE_STATES = Object.freeze(["BULLISH_STRUCTURE", "BEARISH_STRUCTURE", "RANGE_STRUCTURE", "TRANSITION_STRUCTURE", "UNKNOWN"]);

export function analyzeMarketStructure({ features = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];
  let up = 0, down = 0, range = 0, mixed = 0;

  if (f.higherHigh === true) { up += 1; bullish.push("HH"); used.push("higherHigh"); }
  if (f.higherLow === true) { up += 1; bullish.push("HL"); used.push("higherLow"); }
  if (f.lowerHigh === true) { down += 1; bearish.push("LH"); used.push("lowerHigh"); }
  if (f.lowerLow === true) { down += 1; bearish.push("LL"); used.push("lowerLow"); }
  if (f.bosUp) { up += 1.5; bullish.push("BOS_UP"); used.push("bosUp"); }
  if (f.bosDown) { down += 1.5; bearish.push("BOS_DOWN"); used.push("bosDown"); }
  if (f.structure1mHH === true) { up += 0.5; bullish.push("1m:HH"); used.push("structure1mHH"); }
  if (f.structure1mHL === true) { up += 0.5; bullish.push("1m:HL"); used.push("structure1mHL"); }
  if (f.structure1mLH === true) { down += 0.5; bearish.push("1m:LH"); used.push("structure1mLH"); }
  if (f.structure1mLL === true) { down += 0.5; bearish.push("1m:LL"); used.push("structure1mLL"); }
  if (f.structureLabel === "RANGE") { range += 1.5; neutral.push("estrutura5s:RANGE"); used.push("structureLabel"); }
  if (f.structure1m === "RANGE") { range += 1; neutral.push("estrutura1m:RANGE"); used.push("structure1m"); }
  if (f.higherHigh === true && f.lowerLow === true) mixed += 1;
  if (f.higherLow === true && f.lowerHigh === true) mixed += 1;
  if (f.retestUp) { up += 0.5; bullish.push("retest_up_defendido"); used.push("retestUp"); }
  if (f.retestDown) { down += 0.5; bearish.push("retest_down_defendido"); used.push("retestDown"); }
  if (f.failedBreakoutUp) { bearish.push("falha_rompimento_topo"); down += 0.75; used.push("failedBreakoutUp"); }
  if (f.failedBreakoutDown) { bullish.push("falha_rompimento_fundo"); up += 0.75; used.push("failedBreakoutDown"); }
  if (!Number.isFinite(f.adx)) risks.push("ADX_UNAVAILABLE");

  let state = "UNKNOWN";
  if (up >= 2 && up > down + 0.5 && range < 2) state = "BULLISH_STRUCTURE";
  else if (down >= 2 && down > up + 0.5 && range < 2) state = "BEARISH_STRUCTURE";
  else if (range >= 2 && up < 2 && down < 2) state = "RANGE_STRUCTURE";
  else if (mixed >= 1 || (up >= 1.5 && down >= 1.5) || (range >= 1 && (up >= 2 || down >= 2))) state = "TRANSITION_STRUCTURE";
  else if (up > 0 || down > 0 || range > 0) state = "TRANSITION_STRUCTURE";

  if (state === "UNKNOWN") neutral.push("swings_insuficientes");
  const total = up + down + range;
  const confidence = total >= 5 ? "HIGH" : total >= 3 ? "MEDIUM" : "LOW";

  return makeAgentOutput({
    agentId: "MARKET_STRUCTURE_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `estrutura=${state} (up=${up} down=${down} range=${range})`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: confidence,
    dataQuality,
    reasoningSummary: `5s=${f.structureLabel}/${f.structureDetail}; 1m=${f.structure1m}; bos=${f.bosType}; failed_up=${f.failedBreakoutUp} failed_down=${f.failedBreakoutDown}`,
    availableAt: f.availableAt,
    detail: {
      scores: { up, down, range, mixed },
      bos: { type: f.bosType, level: f.bosLevel },
      breakoutLevel: f.bosLevel,
      resistance: f.resistance, support: f.support,
      distanceToResistanceATR: f.distanceToResistanceATR, distanceToSupportATR: f.distanceToSupportATR,
      range: { high: f.rangeHigh, low: f.rangeLow, position: f.rangePosition },
      retest: { up: f.retestUp, down: f.retestDown },
      failedStructure: { up: f.failedBreakoutUp, down: f.failedBreakoutDown },
    },
  });
}
