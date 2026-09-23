/**
 * V3 — SPECIALISTS (assessments de dominio; NUNCA respondem BUY/SELL).
 *
 * Cada especialista descreve o estado do seu dominio com evidencia, contra-evidencia,
 * blockers, invalidations, mudancas vs ciclo anterior e o que observar em seguida.
 * Nenhum output contem CALL/PUT/BUY/SELL/ALTA/BAIXA como decisao.
 */
import { PLAYBOOKS } from "./playbooks.mjs";

export const V3_SPECIALISTS_VERSION = "v3-specialists-v1";

export const ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION"]);

const assessment = ({ role, domain, state, observations, supporting = [], counter = [], blockers = [], invalidations = [], next = [], playbooks = [], sources = [], measurements = {}, previous }) => {
  const prior = previous?.measurements ?? null;
  const changed = [];
  for (const [key, value] of Object.entries(measurements)) {
    const before = prior?.[key];
    if (before !== undefined && before !== null && value !== null && JSON.stringify(before) !== JSON.stringify(value)) changed.push({ field: key, from: before, to: value });
    else if (before === undefined && value !== null) changed.push({ field: key, from: null, to: value });
  }
  return { version: V3_SPECIALISTS_VERSION, role, domain, assessment: state, observations, supportingEvidence: supporting, counterEvidence: counter, blockers, invalidations, changedSincePreviousCycle: changed, nextEvidenceToWatch: next, playbooksMatched: playbooks, sourcesReferenced: sources, deterministicMeasurements: measurements };
};

export function rsiSpecialist({ measurements, previous = null } = {}) {
  const rsi = measurements?.rsi;
  if (!rsi) return null;
  const observations = [`RSI ${rsi.value} (${rsi.zone})`, `slope ${rsi.slope ?? "n/a"}${rsi.acceleration === null ? "" : ` aceleracao ${rsi.acceleration}`}`, rsi.persistence ? `persistencia ${rsi.persistence.candles} candles ${rsi.persistence.side}` : null].filter(Boolean);
  const supporting = []; const counter = []; const blockers = []; const invalidations = [];
  if (rsi.crossback) (rsi.crossback.direction === "UP" ? supporting : counter).push({ family: "MOMENTUM", code: `RSI_CROSSBACK_${rsi.crossback.direction}`, detail: rsi.crossback });
  if (rsi.slope !== null) (rsi.slope > 0 ? supporting : rsi.slope < 0 ? counter : []).push?.({ family: "MOMENTUM", code: rsi.slope > 0 ? "RSI_SLOPE_UP" : "RSI_SLOPE_DOWN", detail: rsi.slope });
  if (rsi.failureSwing) counter.push({ family: "MOMENTUM", code: rsi.failureSwing.type, detail: rsi.failureSwing });
  for (const divergence of rsi.divergence ?? []) (divergence.type.startsWith("HIDDEN") ? supporting : counter).push({ family: "MOMENTUM", code: divergence.type, detail: divergence });
  // Zona extrema e CONTEXTO, nunca sinal/blocker (regra oficial de Wilder: 70/30 nao sao gatilhos).
  if (rsi.zone === "OVERBOUGHT") counter.push({ family: "MOMENTUM", code: "RSI_OVERBOUGHT_CONTEXT", detail: rsi.value });
  if (rsi.zone === "OVERSOLD") counter.push({ family: "MOMENTUM", code: "RSI_OVERSOLD_CONTEXT", detail: rsi.value });
  const state = rsi.zone === "NEUTRAL" ? (rsi.momentum ?? "NEUTRAL") : `${rsi.zone}_${rsi.momentum ?? "FLAT"}`;
  return assessment({ role: "RSI", domain: "MOMENTUM", state, observations, supporting, counter, blockers, invalidations, playbooks: ["RSI_ZONE_CONTEXT", "RSI_TRAJECTORY", "RSI_CROSSBACK", "RSI_PERSISTENCE", "RSI_FAILURE_SWING", "RSI_DIVERGENCE"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "KIRKPATRICK_DAHLQUIST_2016"], measurements: { value: rsi.value, zone: rsi.zone, slope: rsi.slope, acceleration: rsi.acceleration, crossback: rsi.crossback?.direction ?? null, persistence: rsi.persistence?.candles ?? null, divergences: (rsi.divergence ?? []).map((item) => item.type) }, next: ["slope do RSI no proximo candle fechado", "crossback da linha 50", "divergencia com novo pivot confirmado"], previous });
}

export function dmiSpecialist({ measurements, previous = null } = {}) {
  const dmi = measurements?.dmi;
  if (!dmi) return null;
  const supporting = []; const counter = []; const blockers = []; const invalidations = [];
  if (dmi.dominance === "PLUS") supporting.push({ family: "DIRECTIONAL_PRESSURE", code: "PLUS_DOMINANCE", detail: dmi.spread });
  if (dmi.dominance === "MINUS") counter.push({ family: "DIRECTIONAL_PRESSURE", code: "MINUS_DOMINANCE", detail: dmi.spread });
  if (dmi.takeover === "PLUS_TOOK_OVER") supporting.push({ family: "DIRECTIONAL_PRESSURE", code: "PLUS_TOOK_OVER", detail: dmi.spread });
  if (dmi.takeover === "MINUS_TOOK_OVER") counter.push({ family: "DIRECTIONAL_PRESSURE", code: "MINUS_TOOK_OVER", detail: dmi.spread });
  if (dmi.trendState === "STRENGTHENING" && dmi.dominance !== "BALANCED") supporting.push({ family: "DIRECTIONAL_PRESSURE", code: "ADX_STRENGTHENING", detail: dmi.adxSlope });
  if (dmi.trendState === "WEAKENING") counter.push({ family: "DIRECTIONAL_PRESSURE", code: "ADX_WEAKENING", detail: dmi.adxSlope });
  if (Number(dmi.adx) < 20) blockers.push({ code: "ADX_WEAK", detail: dmi.adx });
  const observations = [`ADX ${dmi.adx} (${dmi.strength}) ${dmi.trendState}`, `+DI ${dmi.plusDi} / -DI ${dmi.minusDi} (spread ${dmi.spread})`, `dominancia ${dmi.dominance}${dmi.takeover ? ` · ${dmi.takeover}` : ""}`];
  const state = `${dmi.strength}_${dmi.trendState}_${dmi.dominance}`;
  return assessment({ role: "DMI_ADX", domain: "DIRECTIONAL_PRESSURE", state, observations, supporting, counter, blockers, invalidations, playbooks: ["DMI_STRENGTH_VS_DIRECTION", "DMI_SLOPE_STRENGTHENING", "DMI_TAKEOVER_RESUME", "DMI_LIMITATIONS"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "CMT_ASSOCIATION"], measurements: { adx: dmi.adx, adxSlope: dmi.adxSlope, plusDi: dmi.plusDi, minusDi: dmi.minusDi, spread: dmi.spread, dominance: dmi.dominance, trendState: dmi.trendState, takeover: dmi.takeover }, next: ["ADX no proximo fechamento", "persistencia da dominancia", "spread apos contracao"], previous });
}

export function bollingerSpecialist({ measurements, previous = null } = {}) {
  const boll = measurements?.bollinger;
  if (!boll) return null;
  const supporting = []; const counter = []; const blockers = []; const invalidations = [];
  if (boll.bandWalk === "ABOVE_UPPER" || boll.bandWalk === "UPPER_HALF") supporting.push({ family: "RELATIVE_POSITION", code: `BAND_WALK_${boll.bandWalk}`, detail: boll.percentB });
  if (boll.bandWalk === "BELOW_LOWER" || boll.bandWalk === "LOWER_HALF") counter.push({ family: "RELATIVE_POSITION", code: `BAND_WALK_${boll.bandWalk}`, detail: boll.percentB });
  if (boll.reentry === true) counter.push({ family: "RELATIVE_POSITION", code: "REENTRY", detail: boll.percentB });
  if (boll.rejection === true) (boll.percentB > 0.5 ? counter : supporting).push({ family: "RELATIVE_POSITION", code: "BAND_REJECTION", detail: boll.percentB });
  if (boll.squeeze === "SQUEEZE") blockers.push({ code: "SQUEEZE_DIRECTION_UNKNOWN", detail: boll.measurements?.bandwidthPercentile });
  if (boll.squeeze === "EXPANDED") blockers.push({ code: "VOL_BULGE_CONTEXT", detail: boll.measurements?.bandwidthPercentile });
  const observations = [`%B ${boll.percentB} (${boll.bandWalk})`, `BandWidth ${boll.bandwidth} (${boll.expansion}, ${boll.squeeze})`, `midline slope ${boll.midlineSlope}`];
  return assessment({ role: "BOLLINGER", domain: "RELATIVE_POSITION", state: `${boll.bandWalk}_${boll.squeeze}`, observations, supporting, counter, blockers, invalidations, playbooks: ["BOLLINGER_RELATIVE_DEFINITION", "BOLLINGER_WALK", "BOLLINGER_REENTRY_REJECTION", "BOLLINGER_SQUEEZE_EXPANSION", "BOLLINGER_CONTEXT_MIDLINE"].filter((id) => PLAYBOOKS[id]), sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], measurements: { percentB: boll.percentB, bandwidth: boll.bandwidth, midlineSlope: boll.midlineSlope, bandWalk: boll.bandWalk, reentry: boll.reentry, rejection: boll.rejection, squeeze: boll.squeeze, expansion: boll.expansion }, next: ["fechamento em relacao as bandas", "BandWidth no proximo candle", "defesa ou perda do miolo"], previous });
}

export function atrSpecialist({ measurements, previous = null } = {}) {
  const atr = measurements?.atr;
  if (!atr) return null;
  const supporting = []; const counter = []; const blockers = []; const invalidations = [];
  if (atr.assessment === "VOLATILITY_COMPATIBLE") supporting.push({ family: "VOLATILITY", code: "VOLATILITY_COMPATIBLE", detail: atr.volRatio });
  if (atr.regime === "ABNORMAL_EXPANSION") counter.push({ family: "VOLATILITY", code: "ABNORMAL_EXPANSION", detail: atr.volRatio });
  if (atr.regime === "LOW_INFORMATION_VOLATILITY") blockers.push({ code: "LOW_INFORMATION_VOLATILITY", detail: atr.volRatio });
  if (atr.wickNormalization !== null && atr.wickNormalization > 1.2) counter.push({ family: "VOLATILITY", code: "LARGE_WICK", detail: atr.wickNormalization });
  const observations = [`ATR ${atr.atr} (${atr.atrPct === null ? "n/a" : (atr.atrPct * 100).toFixed(3) + "%"})`, `regime ${atr.regime} (volRatio ${atr.volRatio})`, `range ${atr.normalizedRange} ATR · impulso ${atr.normalizedImpulse} ATR · pullback ${atr.normalizedPullback} ATR`];
  return assessment({ role: "ATR", domain: "VOLATILITY", state: atr.regime, observations, supporting, counter, blockers, invalidations, playbooks: ["ATR_NORMALIZATION", "ATR_VOLATILITY_REGIME", "ATR_ZONE_TOLERANCE", "ATR_WICK_ASSESSMENT"].filter((id) => PLAYBOOKS[id]), sources: ["WILDER_1978", "CMT_ASSOCIATION"], measurements: { atr: atr.atr, atrPct: atr.atrPct, volRatio: atr.volRatio, regime: atr.regime, normalizedRange: atr.normalizedRange, normalizedImpulse: atr.normalizedImpulse, normalizedPullback: atr.normalizedPullback, wickNormalization: atr.wickNormalization }, next: ["volRatio no proximo candle", "movimento em ATR vs estrutura", "expansao pos-squeeze"], previous });
}

export function priceActionSpecialist({ measurements, previous = null } = {}) {
  const structure = measurements?.structure;
  if (!structure) return null;
  const pullback = measurements?.pullback ?? {}; const micro = measurements?.micro ?? {}; const br = measurements?.breakoutRetest ?? {};
  const supporting = []; const counter = []; const blockers = []; const invalidations = [];
  if (structure.trend === "UPTREND") supporting.push({ family: "STRUCTURE", code: "UPTREND_STRUCTURE" });
  if (structure.trend === "DOWNTREND") counter.push({ family: "STRUCTURE", code: "DOWNTREND_STRUCTURE" });
  if (structure.lastBOS?.type === "BULLISH_BOS") supporting.push({ family: "STRUCTURE", code: "BULLISH_BOS", detail: structure.lastBOS });
  if (structure.lastBOS?.type === "BEARISH_BOS") counter.push({ family: "STRUCTURE", code: "BEARISH_BOS", detail: structure.lastBOS });
  if (structure.lastCHoCH?.type === "BEARISH_CHOCH") invalidations.push({ code: "BEARISH_CHOCH", detail: structure.lastCHoCH });
  if (structure.lastCHoCH?.type === "BULLISH_CHOCH") invalidations.push({ code: "BULLISH_CHOCH", detail: structure.lastCHoCH });
  if (pullback.active === true) (pullback.direction === "UP_TREND_PULLBACK" ? supporting : counter).push({ family: "STRUCTURE", code: `PULLBACK_${pullback.depth}`, detail: pullback.distanceAtr });
  if (pullback.depth === "DEEP") blockers.push({ code: "DEEP_PULLBACK_STRUCTURE_THREAT", detail: pullback.distanceAtr });
  if (br.breakout === true) supporting.push({ family: "STRUCTURE", code: "BREAKOUT", detail: br.resistance });
  if (br.breakdown === true) counter.push({ family: "STRUCTURE", code: "BREAKDOWN", detail: br.support });
  if (br.retest === true) supporting.push({ family: "STRUCTURE", code: "RETEST_DEFENDED" });
  if (br.failed) counter.push({ family: "STRUCTURE", code: br.failed.type, detail: br.failed });
  if (micro.character === "DECISIVE") (micro.direction === "UP" ? supporting : counter).push({ family: "MICRO_PRICE_ACTION", code: `DECISIVE_${micro.direction}`, detail: micro.bodyRatio });
  const observations = [`estrutura ${structure.trend}`, `${structure.swingLegs?.map((leg) => leg.label).join("/") || "sem pernas"}`, `pullback ${pullback.active ? `${pullback.depth} ${pullback.distanceAtr} ATR` : "inativo"}`, `micro ${micro.character} ${micro.direction}`, structure.lastBOS ? `BOS ${structure.lastBOS.type}` : null, structure.lastCHoCH ? `CHoCH ${structure.lastCHoCH.type}` : null].filter(Boolean);
  const state = `${structure.trend}${pullback.active ? `_PULLBACK_${pullback.depth}` : ""}${br.breakout ? "_BREAKOUT" : ""}${br.breakdown ? "_BREAKDOWN" : ""}`;
  return assessment({ role: "PRICE_ACTION", domain: "STRUCTURE", state, observations, supporting, counter, blockers, invalidations, playbooks: ["PA_TREND_STRUCTURE", "PA_ZONES_SR", "PA_BREAKOUT_RETEST", "PA_FAILED_BREAKOUT", "PA_PULLBACK_DEPTH", "PA_BOS_CHOCH", "PA_MICRO_STRUCTURE"].filter((id) => PLAYBOOKS[id]), sources: ["EDWARDS_MAGEE_2018", "CMT_ASSOCIATION", "TRACECOM_V3_OPS"], measurements: { trend: structure.trend, lastBOS: structure.lastBOS?.type ?? null, lastCHoCH: structure.lastCHoCH?.type ?? null, pullback: pullback.depth ?? null, pullbackDistanceAtr: pullback.distanceAtr ?? null, breakout: br.breakout === true, breakdown: br.breakdown === true, retest: br.retest === true, micro: `${micro.character}_${micro.direction}` }, next: ["fechamento alem/abaixo do ultimo swing", "defesa da zona no reteste", "mudanca de rotulo de perna (HH/HL vs LH/LL)"], previous });
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

export function assertNoDirectionalLanguage(text) {
  return !/\b(BUY|SELL|CALL|PUT)\b/.test(String(text ?? ""));
}
