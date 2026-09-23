/**
 * V3 — SPECIALISTS (fatos de dominio, SEM tese).
 *
 * Cada especialista descreve FATOS com direcao explicita (`direction: UP|DOWN|null`),
 * mas NAO rotula SUPPORT/COUNTER: a classificacao relativa a tese e do Asset/Consensus.
 * Nenhum output contem BUY/SELL/CALL/PUT como decisao.
 */
import { PLAYBOOKS } from "./playbooks.mjs";

export const V3_SPECIALISTS_VERSION = "v3-specialists-v2";

export const ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]);

const fact = (family, code, direction = null, detail = null) => ({ family, code, direction, detail });

const assessment = ({ role, domain, state, observations, facts = [], blockers = [], invalidations = [], next = [], playbooks = [], sources = [], measurements = {}, previous }) => {
  const prior = previous?.measurements ?? null;
  const changed = [];
  for (const [key, value] of Object.entries(measurements)) {
    const before = prior?.[key];
    if (before !== undefined && before !== null && value !== null && JSON.stringify(before) !== JSON.stringify(value)) changed.push({ field: key, from: before, to: value });
    else if (before === undefined && value !== null) changed.push({ field: key, from: null, to: value });
  }
  return { version: V3_SPECIALISTS_VERSION, role, domain, assessment: state, observations, facts, blockers, invalidations, changedSincePreviousCycle: changed, nextEvidenceToWatch: next, playbooksMatched: playbooks, sourcesReferenced: sources, deterministicMeasurements: measurements };
};

export function rsiSpecialist({ measurements, previous = null } = {}) {
  const rsi = measurements?.rsi;
  if (!rsi) return null;
  const observations = [`RSI ${rsi.value} (${rsi.zone})`, `slope ${rsi.slope ?? "n/a"}${rsi.acceleration === null ? "" : ` aceleracao ${rsi.acceleration}`}`, rsi.persistence ? `persistencia ${rsi.persistence.candles} candles ${rsi.persistence.side}` : null].filter(Boolean);
  const facts = []; const blockers = []; const invalidations = [];
  if (rsi.momentum === "RECOVERING") facts.push(fact("MOMENTUM", "RSI_MOMENTUM_RECOVERING", "UP", rsi.slope));
  if (rsi.momentum === "DETERIORATING") facts.push(fact("MOMENTUM", "RSI_MOMENTUM_DETERIORATING", "DOWN", rsi.slope));
  if (rsi.slope !== null && rsi.slope !== undefined) facts.push(fact("MOMENTUM", "RSI_SLOPE", rsi.slope > 0 ? "UP" : rsi.slope < 0 ? "DOWN" : null, rsi.slope));
  if (rsi.crossback) facts.push(fact("MOMENTUM", "RSI_CROSSBACK", rsi.crossback.direction, rsi.crossback));
  if (rsi.failureSwing) facts.push(fact("MOMENTUM", "RSI_FAILURE_SWING", rsi.failureSwing.type === "BULLISH_FAILURE_SWING" ? "UP" : "DOWN", rsi.failureSwing));
  for (const divergence of rsi.divergence ?? []) facts.push(fact("MOMENTUM", `RSI_DIVERGENCE_${divergence.type}`, divergence.type.includes("BULLISH") ? "UP" : "DOWN", divergence));
  if (rsi.zone === "OVERBOUGHT" || rsi.zone === "OVERSOLD") facts.push(fact("MOMENTUM", "RSI_ZONE_CONTEXT", null, { zone: rsi.zone, value: rsi.value }));
  const state = rsi.zone === "NEUTRAL" ? (rsi.momentum ?? "NEUTRAL") : `${rsi.zone}_${rsi.momentum ?? "FLAT"}`;
  return assessment({ role: "RSI", domain: "MOMENTUM", state, observations, facts, blockers, invalidations, playbooks: ["RSI_ZONE_CONTEXT", "RSI_TRAJECTORY", "RSI_CROSSBACK", "RSI_PERSISTENCE", "RSI_FAILURE_SWING", "RSI_DIVERGENCE"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "KIRKPATRICK_DAHLQUIST_2016"], measurements: { value: rsi.value, zone: rsi.zone, slope: rsi.slope, acceleration: rsi.acceleration, crossback: rsi.crossback?.direction ?? null, persistence: rsi.persistence?.candles ?? null, divergences: (rsi.divergence ?? []).map((item) => item.type), momentum: rsi.momentum }, next: ["slope do RSI no proximo candle fechado", "crossback da linha 50", "divergencia com novo pivot confirmado"], previous });
}

export function dmiSpecialist({ measurements, previous = null } = {}) {
  const dmi = measurements?.dmi;
  if (!dmi) return null;
  const facts = []; const blockers = []; const invalidations = [];
  if (dmi.dominance === "PLUS") facts.push(fact("DIRECTIONAL_PRESSURE", "DI_DOMINANCE_PLUS", "UP", dmi.spread));
  if (dmi.dominance === "MINUS") facts.push(fact("DIRECTIONAL_PRESSURE", "DI_DOMINANCE_MINUS", "DOWN", dmi.spread));
  if (dmi.takeover === "PLUS_TOOK_OVER") facts.push(fact("DIRECTIONAL_PRESSURE", "DI_TAKEOVER", "UP", dmi.spread));
  if (dmi.takeover === "MINUS_TOOK_OVER") facts.push(fact("DIRECTIONAL_PRESSURE", "DI_TAKEOVER", "DOWN", dmi.spread));
  if (dmi.trendState === "STRENGTHENING") facts.push(fact("DIRECTIONAL_PRESSURE", "ADX_STRENGTHENING", dmi.dominance === "MINUS" ? "DOWN" : dmi.dominance === "PLUS" ? "UP" : null, dmi.adxSlope));
  if (dmi.trendState === "WEAKENING") facts.push(fact("DIRECTIONAL_PRESSURE", "ADX_WEAKENING", null, dmi.adxSlope));
  if (Number(dmi.adx) < 20) blockers.push({ code: "ADX_WEAK", detail: dmi.adx });
  const observations = [`ADX ${dmi.adx} (${dmi.strength}) ${dmi.trendState}`, `+DI ${dmi.plusDi} / -DI ${dmi.minusDi} (spread ${dmi.spread})`, `dominancia ${dmi.dominance}${dmi.takeover ? ` · ${dmi.takeover}` : ""}`];
  const state = `${dmi.strength}_${dmi.trendState}_${dmi.dominance}`;
  return assessment({ role: "DMI_ADX", domain: "DIRECTIONAL_PRESSURE", state, observations, facts, blockers, invalidations, playbooks: ["DMI_STRENGTH_VS_DIRECTION", "DMI_SLOPE_STRENGTHENING", "DMI_TAKEOVER_RESUME", "DMI_LIMITATIONS"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "CMT_ASSOCIATION"], measurements: { adx: dmi.adx, adxSlope: dmi.adxSlope, plusDi: dmi.plusDi, minusDi: dmi.minusDi, spread: dmi.spread, dominance: dmi.dominance, trendState: dmi.trendState, takeover: dmi.takeover }, next: ["ADX no proximo fechamento", "persistencia da dominancia", "spread apos contracao"], previous });
}

export function bollingerSpecialist({ measurements, previous = null } = {}) {
  const boll = measurements?.bollinger;
  if (!boll) return null;
  const facts = []; const blockers = []; const invalidations = [];
  if (boll.bandWalk === "ABOVE_UPPER" || boll.bandWalk === "UPPER_HALF") facts.push(fact("RELATIVE_POSITION", "BAND_WALK", "UP", boll.percentB));
  if (boll.bandWalk === "BELOW_LOWER" || boll.bandWalk === "LOWER_HALF") facts.push(fact("RELATIVE_POSITION", "BAND_WALK", "DOWN", boll.percentB));
  if (boll.reentry === true) facts.push(fact("RELATIVE_POSITION", "BAND_REENTRY", boll.percentB > 0.5 ? "DOWN" : "UP", boll.percentB));
  if (boll.rejection === true) facts.push(fact("RELATIVE_POSITION", "BAND_REJECTION", boll.percentB > 0.5 ? "DOWN" : "UP", boll.percentB));
  if (Number(boll.midlineSlope) > 0) facts.push(fact("RELATIVE_POSITION", "MIDLINE_SLOPE", "UP", boll.midlineSlope));
  if (Number(boll.midlineSlope) < 0) facts.push(fact("RELATIVE_POSITION", "MIDLINE_SLOPE", "DOWN", boll.midlineSlope));
  if (boll.squeeze === "SQUEEZE") blockers.push({ code: "SQUEEZE_DIRECTION_UNKNOWN", detail: boll.measurements?.bandwidthPercentile });
  if (boll.squeeze === "EXPANDED") blockers.push({ code: "VOL_BULGE_CONTEXT", detail: boll.measurements?.bandwidthPercentile });
  const observations = [`%B ${boll.percentB} (${boll.bandWalk})`, `BandWidth ${boll.bandwidth} (${boll.expansion}, ${boll.squeeze})`, `midline slope ${boll.midlineSlope}`];
  return assessment({ role: "BOLLINGER", domain: "RELATIVE_POSITION", state: `${boll.bandWalk}_${boll.squeeze}`, observations, facts, blockers, invalidations, playbooks: ["BOLLINGER_RELATIVE_DEFINITION", "BOLLINGER_WALK", "BOLLINGER_REENTRY_REJECTION", "BOLLINGER_SQUEEZE_EXPANSION", "BOLLINGER_CONTEXT_MIDLINE"].filter((id) => PLAYBOOKS[id]), sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], measurements: { percentB: boll.percentB, bandwidth: boll.bandwidth, midlineSlope: boll.midlineSlope, bandWalk: boll.bandWalk, reentry: boll.reentry, rejection: boll.rejection, squeeze: boll.squeeze, expansion: boll.expansion }, next: ["fechamento em relacao as bandas", "BandWidth no proximo candle", "defesa ou perda do miolo"], previous });
}

export function atrSpecialist({ measurements, previous = null } = {}) {
  const atr = measurements?.atr;
  if (!atr) return null;
  const facts = []; const blockers = []; const invalidations = [];
  facts.push(fact("VOLATILITY", "VOL_REGIME", null, { regime: atr.regime, volRatio: atr.volRatio }));
  if (atr.wickNormalization !== null && atr.wickNormalization > 1.2) facts.push(fact("VOLATILITY", "LARGE_WICK", null, atr.wickNormalization));
  if (atr.regime === "LOW_INFORMATION_VOLATILITY") blockers.push({ code: "LOW_INFORMATION_VOLATILITY", detail: atr.volRatio });
  const observations = [`ATR ${atr.atr} (${atr.atrPct === null ? "n/a" : (atr.atrPct * 100).toFixed(3) + "%"})`, `regime ${atr.regime} (volRatio ${atr.volRatio})`, `range ${atr.normalizedRange} ATR · impulso ${atr.normalizedImpulse} ATR · pullback ${atr.normalizedPullback} ATR`];
  return assessment({ role: "ATR", domain: "VOLATILITY", state: atr.regime, observations, facts, blockers, invalidations, playbooks: ["ATR_NORMALIZATION", "ATR_VOLATILITY_REGIME", "ATR_ZONE_TOLERANCE", "ATR_WICK_ASSESSMENT"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "CMT_ASSOCIATION"], measurements: { atr: atr.atr, atrPct: atr.atrPct, volRatio: atr.volRatio, regime: atr.regime, normalizedRange: atr.normalizedRange, normalizedImpulse: atr.normalizedImpulse, normalizedPullback: atr.normalizedPullback, wickNormalization: atr.wickNormalization }, next: ["volRatio no proximo candle", "movimento em ATR vs estrutura", "expansao pos-squeeze"], previous });
}

export function priceActionSpecialist({ measurements, previous = null } = {}) {
  const structure = measurements?.structure;
  if (!structure) return null;
  const pullback = measurements?.pullback ?? {}; const micro = measurements?.micro ?? {}; const br = measurements?.breakoutRetest ?? {};
  const facts = []; const blockers = []; const invalidations = [];
  if (structure.trend === "UPTREND") facts.push(fact("STRUCTURE", "TREND", "UP"));
  if (structure.trend === "DOWNTREND") facts.push(fact("STRUCTURE", "TREND", "DOWN"));
  if (structure.lastBOS?.type === "BULLISH_BOS") facts.push(fact("STRUCTURE", "BOS", "UP", structure.lastBOS));
  if (structure.lastBOS?.type === "BEARISH_BOS") facts.push(fact("STRUCTURE", "BOS", "DOWN", structure.lastBOS));
  // CHoCH invalida a estrutura ANTERIOR: a direcao do fato e a nova direcao quebrada.
  if (structure.lastCHoCH?.type === "BEARISH_CHOCH") invalidations.push({ code: "BEARISH_CHOCH", direction: "DOWN", detail: structure.lastCHoCH });
  if (structure.lastCHoCH?.type === "BULLISH_CHOCH") invalidations.push({ code: "BULLISH_CHOCH", direction: "UP", detail: structure.lastCHoCH });
  if (pullback.active === true) facts.push(fact("STRUCTURE", "PULLBACK", pullback.direction === "UP_TREND_PULLBACK" ? "UP" : pullback.direction === "DOWN_TREND_PULLBACK" ? "DOWN" : null, { depth: pullback.depth, distanceAtr: pullback.distanceAtr }));
  if (pullback.depth === "DEEP") blockers.push({ code: "DEEP_PULLBACK_STRUCTURE_THREAT", detail: pullback.distanceAtr });
  if (br.breakout === true) facts.push(fact("STRUCTURE", "BREAKOUT", "UP", br.resistance));
  if (br.breakdown === true) facts.push(fact("STRUCTURE", "BREAKDOWN", "DOWN", br.support));
  if (br.retest === true) facts.push(fact("STRUCTURE", "RETEST_DEFENDED", null));
  if (br.failed?.type === "FAILED_BREAKOUT") facts.push(fact("STRUCTURE", "FAILED_BREAKOUT", "DOWN", br.failed));
  if (br.failed?.type === "FAILED_BREAKDOWN") facts.push(fact("STRUCTURE", "FAILED_BREAKDOWN", "UP", br.failed));
  if (micro.character === "DECISIVE") facts.push(fact("MICRO_PRICE_ACTION", "DECISIVE_CANDLE", micro.direction, micro.bodyRatio));
  const observations = [`estrutura ${structure.trend}`, `${structure.swingLegs?.map((leg) => leg.label).join("/") || "sem pernas"}`, `pullback ${pullback.active ? `${pullback.depth} ${pullback.distanceAtr} ATR` : "inativo"}`, `micro ${micro.character} ${micro.direction}`, structure.lastBOS ? `BOS ${structure.lastBOS.type}` : null, structure.lastCHoCH ? `CHoCH ${structure.lastCHoCH.type}` : null].filter(Boolean);
  const state = `${structure.trend}${pullback.active ? `_PULLBACK_${pullback.depth}` : ""}${br.breakout ? "_BREAKOUT" : ""}${br.breakdown ? "_BREAKDOWN" : ""}`;
  return assessment({ role: "PRICE_ACTION", domain: "STRUCTURE", state, observations, facts, blockers, invalidations, playbooks: ["PA_TREND_STRUCTURE", "PA_ZONES_SR", "PA_BREAKOUT_RETEST", "PA_FAILED_BREAKOUT", "PA_PULLBACK_DEPTH", "PA_BOS_CHOCH", "PA_MICRO_STRUCTURE"].filter((id) => PLAYBOOKS[id]), sources: ["EDWARDS_MAGEE_2018", "CMT_ASSOCIATION", "TRACECOM_V3_OPS"], measurements: { trend: structure.trend, lastBOS: structure.lastBOS?.type ?? null, lastCHoCH: structure.lastCHoCH?.type ?? null, pullback: pullback.depth ?? null, pullbackDistanceAtr: pullback.distanceAtr ?? null, breakout: br.breakout === true, breakdown: br.breakdown === true, retest: br.retest === true, micro: `${micro.character}_${micro.direction}` }, next: ["fechamento alem/abaixo do ultimo swing", "defesa da zona no reteste", "mudanca de rotulo de perna (HH/HL vs LH/LL)"], previous });
}

export function runSpecialists({ measurements, previousByRole = {} } = {}) {
  return {
    version: V3_SPECIALISTS_VERSION,
    rsi: rsiSpecialist({ measurements, previous: previousByRole.RSI ?? null }),
    dmi: dmiSpecialist({ measurements, previous: previousByRole.DMI_ADX ?? null }),
    bollinger: bollingerSpecialist({ measurements, previous: previousByRole.BOLLINGER ?? null }),
    atr: atrSpecialist({ measurements, previous: previousByRole.ATR ?? null }),
    priceAction: priceActionSpecialist({ measurements, previous: previousByRole.PRICE_ACTION ?? null }),
  };
}

export function factsOf(specialists) { return Object.values(specialists ?? {}).flatMap((agent) => agent?.facts ?? []); }
export function factsForDirection(specialists, direction) { return factsOf(specialists).filter((item) => item.direction === direction); }

export function assertNoDirectionalLanguage(text) {
  return !/\b(BUY|SELL|CALL|PUT)\b/.test(String(text ?? ""));
}
