/**
 * MICROSTRUCTURE_AGENT — somente ticks REAIS do feed (direcao, pressao, velocidade, aceleracao,
 * arrival rate, mudancas de direcao, bursts, volatilidade curta).
 *
 * OTC: proibido inventar order book/volume institucional/depth. Sem ticks suficientes,
 * o estado e INSUFFICIENT (nunca fabrica leitura).
 */
import { makeAgentOutput } from "../contracts.mjs";

export const MICROSTRUCTURE_AGENT_VERSION = "microstructure-agent-v1";
export const MICROSTRUCTURE_STATES = Object.freeze(["BUY_PRESSURE", "SELL_PRESSURE", "BALANCED", "INSUFFICIENT"]);
export const MIN_TICKS = 3;

export function analyzeMicrostructure({ features = {}, t0 = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const neutral = [];
  const risks = [];
  const used = ["ticks"];
  const isOtc = String(f.marketType ?? "").toUpperCase() === "OTC";
  if (isOtc) neutral.push("OTC_SEM_VOLUME_ORDERBOOK_SINTETICO");

  if (f.ticksAvailable !== true || !Number.isFinite(f.tickCount) || f.tickCount < MIN_TICKS) {
    return makeAgentOutput({
      agentId: "MICROSTRUCTURE_AGENT",
      marketKey: f.marketKey, snapshotId: f.snapshotId,
      state: "INSUFFICIENT",
      assessment: `ticks_insuficientes=${f.tickCount ?? 0}`,
      bullishEvidence: [], bearishEvidence: [], neutralEvidence: neutral,
      riskFlags: ["MICROSTRUCTURE_INSUFFICIENT"],
      featuresUsed: ["tickCount"],
      confidenceClass: "LOW", dataQuality,
      reasoningSummary: "Feed sem ticks suficientes para microestrutura; nenhuma inferencia fabricada.",
      availableAt: f.availableAt,
      detail: { ticks: f.tickCount ?? 0, required: MIN_TICKS, source: "FEED_TICKS_ONLY" },
    });
  }

  let score = 0;
  const bullish = [];
  const bearish = [];
  if (f.tickDirection === "UP") { score += 1; bullish.push("direcao_ticks:UP"); }
  else if (f.tickDirection === "DOWN") { score -= 1; bearish.push("direcao_ticks:DOWN"); }
  if (Number.isFinite(f.tickPressure)) {
    used.push("tickPressure");
    if (f.tickPressure >= 0.2) { score += 1; bullish.push(`pressao_compradora=${f.tickPressure}`); }
    else if (f.tickPressure <= -0.2) { score -= 1; bearish.push(`pressao_vendedora=${f.tickPressure}`); }
  }
  if (Number.isFinite(f.tickVelocity)) {
    used.push("tickVelocity");
    if (f.tickVelocity > 0) score += 0.5; else if (f.tickVelocity < 0) score -= 0.5;
  }
  if (Number.isFinite(f.tickAcceleration)) {
    used.push("tickAcceleration");
    if (f.tickAcceleration > 0) { score += 0.5; bullish.push("aceleracao_ticks_positiva"); }
    else if (f.tickAcceleration < 0) { score -= 0.5; bearish.push("aceleracao_ticks_negativa"); }
  }
  if (Number.isFinite(f.tickDirectionChanges) && f.tickCount > 0 && f.tickDirectionChanges / f.tickCount > 0.5) {
    risks.push("TICK_DIRECTION_UNSTABLE");
    score *= 0.5;
  }
  if (Number.isFinite(f.tickBursts) && f.tickBursts >= 2) risks.push("TICK_BURSTS");
  if (Number.isFinite(f.tickAgeMs) && f.tickAgeMs > 5_000) risks.push("TICK_IDADE_ALTA");

  const state = score >= 1 ? "BUY_PRESSURE" : score <= -1 ? "SELL_PRESSURE" : "BALANCED";
  neutral.push(`ticks=${f.tickCount} arrivalRate=${f.tickArrivalRate}/s directionChanges=${f.tickDirectionChanges} shortTermVol=${f.tickShortTermVol}`);

  return makeAgentOutput({
    agentId: "MICROSTRUCTURE_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `microestrutura=${state} score=${score}`,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: Math.abs(score) >= 2 ? "HIGH" : Math.abs(score) >= 1 ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `ticks reais=${f.tickCount}; pressure=${f.tickPressure}; velocity=${f.tickVelocity}; acceleration=${f.tickAcceleration}; fonte=FEED_TICKS_ONLY`,
    availableAt: f.availableAt,
    detail: {
      score, source: "FEED_TICKS_ONLY",
      pressure: f.tickPressure, velocity: f.tickVelocity, acceleration: f.tickAcceleration,
      arrivalRatePerSec: f.tickArrivalRate, directionChanges: f.tickDirectionChanges, bursts: f.tickBursts,
      shortTermVol: f.tickShortTermVol, tickAgeMs: f.tickAgeMs,
      orderBook: null, institutionalVolume: null, syntheticData: false,
    },
  });
}
