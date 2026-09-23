/**
 * V3 — SCENARIO LIBRARY (compartilhada entre Asset Agent e Consensus).
 *
 * Cada cenario tem definicao operacional causal, precondicoes, familias de evidencia,
 * blockers, invalidations e o que o distingue de cenarios parecidos. A classificacao
 * NAO usa votacao: usa familias de evidencia + regras de precedencia documentadas.
 *
 * Familias: STRUCTURE | MOMENTUM | DIRECTIONAL_PRESSURE | VOLATILITY | RELATIVE_POSITION | MICRO_PRICE_ACTION
 */
import { PLAYBOOKS } from "./playbooks.mjs";

export const V3_SCENARIOS_VERSION = "v3-scenario-library-v1";

export const EVIDENCE_FAMILIES = Object.freeze(["STRUCTURE", "MOMENTUM", "DIRECTIONAL_PRESSURE", "VOLATILITY", "RELATIVE_POSITION", "MICRO_PRICE_ACTION"]);

const ev = (family, type, code, detail = null) => ({ family, type, code, detail });

export const SCENARIOS = Object.freeze({
  TREND_CONTINUATION: { id: "TREND_CONTINUATION", direction: "UP", definition: "Tendencia de alta intacta com BOS recente ou forca direcional dominante; sem contra-evidencia estrutural.", distinguishing: "Estrutura HH/HL + pressao PLUS; sem pullback relevante ativo.", requiredMeasurements: ["structure.trend", "structure.lastBOS", "dmi.spread"] },
  PULLBACK_CONTINUATION: { id: "PULLBACK_CONTINUATION", direction: "UP", definition: "Tendencia de alta com correcao NORMAL/DEEP e estrutura intacta, aguardando evidencia de retomada (crossback/BOS/micro decisivo).", distinguishing: "Pullback ativo contra a tendencia sem CHoCH; TREND_CONTINUATION nao tem correcao ativa.", requiredMeasurements: ["pullback", "rsi.crossback", "structure.lastCHoCH"] },
  DEEP_PULLBACK_STRUCTURE_THREAT: { id: "DEEP_PULLBACK_STRUCTURE_THREAT", direction: "UP", definition: "Correcao profunda (>1.5 ATR) ameacando o swing que define a tendencia; continuacao nao pode ser assumida.", distinguishing: "Pullback DEEP + ameaca ao swing de referencia; sem CHoCH confirmado.", requiredMeasurements: ["pullback.depth", "pullback.distanceAtr", "structure.lastLow"] },
  STRUCTURAL_REVERSAL: { id: "STRUCTURAL_REVERSAL", direction: "DOWN", definition: "CHoCH confirmado contra a tendencia anterior com evidencia de momentum/direcao na nova direcao.", distinguishing: "CHoCH + pressao invertida; diferente de pullback profundo sem quebra.", requiredMeasurements: ["structure.lastCHoCH", "dmi.takeover", "rsi.slope"] },
  BREAKOUT: { id: "BREAKOUT", direction: "UP", definition: "Fechamentos sustentados acima da zona de resistencia (>=2 fechamentos), tipicamente apos compressao.", distinguishing: "Rompimento com fechamento; nao exige reteste.", requiredMeasurements: ["breakoutRetest.breakout", "bollinger.squeeze"] },
  FAILED_BREAKOUT: { id: "FAILED_BREAKOUT", direction: "DOWN", definition: "Preco rompeu a resistencia e voltou para dentro do range; armadilha de continuacao.", distinguishing: "Rompimento previo + fechamento de volta; BREAKOUT nao retorna.", requiredMeasurements: ["breakoutRetest.failed"] },
  BREAKDOWN: { id: "BREAKDOWN", direction: "DOWN", definition: "Fechamentos sustentados abaixo da zona de suporte (>=2 fechamentos).", distinguishing: "Rompimento para baixo com fechamento.", requiredMeasurements: ["breakoutRetest.breakdown"] },
  FAILED_BREAKDOWN: { id: "FAILED_BREAKDOWN", direction: "UP", definition: "Preco perdeu o suporte e voltou para dentro do range; armadilha de baixa.", distinguishing: "Perda previa do suporte + recuperacao.", requiredMeasurements: ["breakoutRetest.failed"] },
  BREAKOUT_RETEST: { id: "BREAKOUT_RETEST", direction: "UP", definition: "Reteste defensavel da zona rompida com fechamento de volta no lado do rompimento.", distinguishing: "Breakout + retorno a zona + defesa; mais conservador que BREAKOUT puro.", requiredMeasurements: ["breakoutRetest.breakout", "breakoutRetest.retest"] },
  COMPRESSION: { id: "COMPRESSION", direction: null, definition: "BandWidth em percentil baixo (squeeze) com amplitude reduzida; mercado acumulando energia sem direcao definida.", distinguishing: "Sem rompimento; direcao indefinida.", requiredMeasurements: ["bollinger.squeeze", "atr.volRatio"] },
  EXPANSION: { id: "EXPANSION", direction: null, definition: "Volatilidade em expansao (volRatio > 1.15) sem estrutura direcional clara.", distinguishing: "Expansao sem BOS/CHoCH.", requiredMeasurements: ["atr.volRatio", "bollinger.expansion"] },
  RANGE: { id: "RANGE", direction: null, definition: "Estrutura mista (nem HH/HL nem LH/LL), ADX fraco, preco no miolo das bandas.", distinguishing: "Sem tendencia e sem rompimento; NO_SETUP tipico.", requiredMeasurements: ["structure.trend", "dmi.adx", "bollinger.percentB"] },
  TRANSITION: { id: "TRANSITION", direction: null, definition: "Estrutura em transicao (HH+LL ou LH+HL) ou ADX em queda apos tendencia.", distinguishing: "Sinais conflitantes; nem tendencia nem range definido.", requiredMeasurements: ["structure.trend", "dmi.trendState"] },
  EXHAUSTION: { id: "EXHAUSTION", direction: null, definition: "Tendencia com ADX caindo, impulsos desacelerando e/ou bulge de volatilidade apos expansao.", distinguishing: "Tendencia perde forca sem CHoCH ainda.", requiredMeasurements: ["dmi.trendState", "impulse.decelerating", "bollinger.squeeze"] },
  STRUCTURAL_ZONE_REJECTION: { id: "STRUCTURAL_ZONE_REJECTION", direction: null, definition: "Rejeicao em zona estrutural com pavio e fechamento de volta (banda ou S/R), sem rompimento.", distinguishing: "Rejeicao sem quebra de estrutura.", requiredMeasurements: ["bollinger.rejection", "zoneDistance", "micro.upperWickRatio"] },
  TREND_WEAKENING: { id: "TREND_WEAKENING", direction: null, definition: "ADX em queda + spread diminuindo, estrutura ainda intacta.", distinguishing: "Perda de forca antes de qualquer quebra.", requiredMeasurements: ["dmi.adxSlope", "dmi.pressureChange"] },
  TREND_RESUMPTION: { id: "TREND_RESUMPTION", direction: "UP", definition: "Apos pullback/correcao, pressao retoma a direcao original (resume/takeover a favor) com BOS ou crossback.", distinguishing: "Retomada confirmada; PULLBACK_CONTINUATION ainda aguardava.", requiredMeasurements: ["dmi.takeover", "rsi.crossback", "structure.lastBOS"] },
  NO_SETUP: { id: "NO_SETUP", direction: null, definition: "Existe expiration, mas nao ha configuracao estrutural relevante para investigar (range sem edge, evidencias dispersas, preco no meio de faixa).", distinguishing: "Ausencia de cenario operacional; encerra a opportunity apos 1 ciclo FULL.", requiredMeasurements: [] },
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));

/** Avaliacao deterministica de UM cenario sobre as medicoes (nunca usa futuro). */
export function evaluateScenario(scenarioId, m) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario || !m) return null;
  const evidence = []; const blockers = []; const invalidations = [];
  const rsi = m.rsi ?? {}; const dmi = m.dmi ?? {}; const boll = m.bollinger ?? {}; const atr = m.atr ?? {};
  const structure = m.structure ?? {}; const pullback = m.pullback ?? {}; const micro = m.micro ?? {}; const impulse = m.impulse ?? {}; const br = m.breakoutRetest ?? {};
  const trend = structure.trend ?? "RANGE";
  const bullish = trend === "UPTREND"; const bearish = trend === "DOWNTREND";
  switch (scenarioId) {
    case "TREND_CONTINUATION":
      if (bullish) evidence.push(ev("STRUCTURE", "SUPPORT", "UPTREND_STRUCTURE", structure.swingLegs?.slice(-2)));
      if (structure.lastBOS?.type === "BULLISH_BOS") evidence.push(ev("STRUCTURE", "SUPPORT", "BULLISH_BOS"));
      if (dmi.dominance === "PLUS" && Number(dmi.adx) >= 20) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "PLUS_DOMINANCE_STRONG", { adx: dmi.adx, spread: dmi.spread }));
      if (pullback.active === true && pullback.depth !== "SHALLOW") invalidations.push({ code: "PULLBACK_ACTIVE", detail: pullback.depth });
      if (structure.lastCHoCH?.type === "BEARISH_CHOCH") invalidations.push({ code: "BEARISH_CHOCH" });
      break;
    case "PULLBACK_CONTINUATION":
      if (bullish && pullback.active === true) evidence.push(ev("STRUCTURE", "SUPPORT", "UP_TREND_PULLBACK", { depth: pullback.depth, distanceAtr: pullback.distanceAtr }));
      if (rsi.crossback?.direction === "UP") evidence.push(ev("MOMENTUM", "SUPPORT", "RSI_CROSSBACK_UP"));
      if (rsi.slope !== null && rsi.slope > 0) evidence.push(ev("MOMENTUM", "SUPPORT", "RSI_SLOPE_UP", rsi.slope));
      if (micro.character === "DECISIVE" && micro.direction === "UP") evidence.push(ev("MICRO_PRICE_ACTION", "SUPPORT", "DECISIVE_UP"));
      if (dmi.dominance === "PLUS") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "PLUS_DOMINANCE"));
      if (structure.lastCHoCH?.type === "BEARISH_CHOCH") invalidations.push({ code: "BEARISH_CHOCH" });
      if (pullback.depth === "DEEP") blockers.push({ code: "PULLBACK_TOO_DEEP", detail: pullback.distanceAtr });
      break;
    case "DEEP_PULLBACK_STRUCTURE_THREAT":
      if (bullish && pullback.depth === "DEEP") evidence.push(ev("STRUCTURE", "COUNTER", "DEEP_PULLBACK", { distanceAtr: pullback.distanceAtr }));
      if (structure.lastCHoCH?.type === "BEARISH_CHOCH") evidence.push(ev("STRUCTURE", "COUNTER", "BEARISH_CHOCH"));
      if (rsi.zone === "OVERSOLD") evidence.push(ev("MOMENTUM", "COUNTER", "RSI_OVERSOLD"));
      if (structure.lastBOS?.type === "BULLISH_BOS") invalidations.push({ code: "FRESH_BULLISH_BOS" });
      break;
    case "STRUCTURAL_REVERSAL":
      if (structure.lastCHoCH?.type === "BEARISH_CHOCH") evidence.push(ev("STRUCTURE", "SUPPORT", "BEARISH_CHOCH"));
      if (dmi.takeover === "MINUS_TOOK_OVER") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "MINUS_TOOK_OVER"));
      if (rsi.slope !== null && rsi.slope < 0) evidence.push(ev("MOMENTUM", "SUPPORT", "RSI_SLOPE_DOWN", rsi.slope));
      if (structure.lastBOS?.type === "BULLISH_BOS" && structure.lastCHoCH === null) blockers.push({ code: "NO_CHOCH_YET" });
      break;
    case "BREAKOUT":
      if (br.breakout === true) evidence.push(ev("STRUCTURE", "SUPPORT", "BREAKOUT", { resistance: br.resistance }));
      if (boll.squeeze === "SQUEEZE") evidence.push(ev("VOLATILITY", "SUPPORT", "PRE_BREAKOUT_SQUEEZE"));
      if (br.failed) invalidations.push({ code: "FAILED_BREAKOUT" });
      break;
    case "FAILED_BREAKOUT":
      if (br.failed?.type === "FAILED_BREAKOUT") evidence.push(ev("STRUCTURE", "SUPPORT", "FAILED_BREAKOUT", br.failed));
      if (boll.bandWalk === "ABOVE_UPPER") evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "TAG_UPPER"));
      if (br.breakout === true && !br.failed) invalidations.push({ code: "BREAKOUT_STILL_VALID" });
      break;
    case "BREAKDOWN":
      if (br.breakdown === true) evidence.push(ev("STRUCTURE", "SUPPORT", "BREAKDOWN", { support: br.support }));
      if (bearish) evidence.push(ev("STRUCTURE", "SUPPORT", "DOWNTREND_STRUCTURE"));
      break;
    case "FAILED_BREAKDOWN":
      if (br.failed?.type === "FAILED_BREAKDOWN") evidence.push(ev("STRUCTURE", "SUPPORT", "FAILED_BREAKDOWN", br.failed));
      if (boll.bandWalk === "BELOW_LOWER") evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "TAG_LOWER"));
      break;
    case "BREAKOUT_RETEST":
      if (br.breakout === true && br.retest === true) evidence.push(ev("STRUCTURE", "SUPPORT", "BREAKOUT_RETEST"));
      if (micro.lowerWickRatio > 0.3 && micro.closeInRange > 0.5) evidence.push(ev("MICRO_PRICE_ACTION", "SUPPORT", "DEFENSIVE_WICK"));
      if (br.failed) invalidations.push({ code: "FAILED_RETEST" });
      break;
    case "COMPRESSION":
      if (boll.squeeze === "SQUEEZE") evidence.push(ev("VOLATILITY", "SUPPORT", "SQUEEZE"));
      if (Number(atr.volRatio) < 0.85) evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_CONTRACTION", atr.volRatio));
      break;
    case "EXPANSION":
      if (Number(atr.volRatio) > 1.15) evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_EXPANSION", atr.volRatio));
      if (trend !== "RANGE") blockers.push({ code: "DIRECTIONAL_STRUCTURE_PRESENT" });
      break;
    case "RANGE":
      if (trend === "RANGE") evidence.push(ev("STRUCTURE", "SUPPORT", "MIXED_STRUCTURE"));
      if (Number(dmi.adx) < 20) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAK", dmi.adx));
      if (boll.percentB !== null && boll.percentB > 0.35 && boll.percentB < 0.65) evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "MID_BANDS", boll.percentB));
      if (br.breakout === true || br.breakdown === true) invalidations.push({ code: "RANGE_BROKEN" });
      break;
    case "TRANSITION":
      if (trend === "TRANSITION") evidence.push(ev("STRUCTURE", "SUPPORT", "TRANSITION_STRUCTURE"));
      if (dmi.trendState === "WEAKENING") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING"));
      break;
    case "EXHAUSTION":
      if (dmi.trendState === "WEAKENING" && Number(dmi.adx) >= 20) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING_FROM_STRONG"));
      if (impulse.decelerating === true) evidence.push(ev("MOMENTUM", "SUPPORT", "IMPULSE_DECELERATING"));
      if (boll.squeeze === "EXPANDED") evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_BULGE"));
      if (structure.lastBOS && ((structure.lastBOS.type === "BULLISH_BOS" && bullish) || (structure.lastBOS.type === "BEARISH_BOS" && bearish))) blockers.push({ code: "FRESH_BOS_AGAINST_EXHAUSTION" });
      break;
    case "STRUCTURAL_ZONE_REJECTION":
      if (boll.rejection === true) evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "BAND_REJECTION"));
      if (micro.upperWickRatio > 0.4 || micro.lowerWickRatio > 0.4) evidence.push(ev("MICRO_PRICE_ACTION", "SUPPORT", "WICK_REJECTION"));
      if (br.breakout === true || br.breakdown === true) invalidations.push({ code: "ZONE_BROKEN" });
      break;
    case "TREND_WEAKENING":
      if (dmi.trendState === "WEAKENING") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING"));
      if (dmi.pressureChange !== null && Math.abs(dmi.pressureChange) < Math.abs(dmi.spread ?? 0)) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "PRESSURE_DECAY", dmi.pressureChange));
      if (structure.lastCHoCH) invalidations.push({ code: "ALREADY_BROKEN_STRUCTURE" });
      break;
    case "TREND_RESUMPTION":
      if (bullish && (dmi.takeover === "PLUS_TOOK_OVER" || (dmi.dominance === "PLUS" && dmi.pressureChange > 0))) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "PLUS_RESUME"));
      if (rsi.crossback?.direction === "UP") evidence.push(ev("MOMENTUM", "SUPPORT", "RSI_CROSSBACK_UP"));
      if (structure.lastBOS?.type === "BULLISH_BOS") evidence.push(ev("STRUCTURE", "SUPPORT", "BULLISH_BOS"));
      if (pullback.depth === "DEEP") blockers.push({ code: "DEEP_PULLBACK" });
      break;
    case "NO_SETUP":
      break;
    default:
      return null;
  }
  const supports = evidence.filter((item) => item.type === "SUPPORT").length;
  const counters = evidence.filter((item) => item.type === "COUNTER").length;
  const matched = supports > 0 && invalidations.length === 0;
  return { scenarioId, direction: scenario.direction, matched, supports, counters, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
}

function playbooksForScenario(scenarioId) {
  const map = {
    TREND_CONTINUATION: ["PA_TREND_STRUCTURE", "DMI_STRENGTH_VS_DIRECTION", "BOLLINGER_WALK"],
    PULLBACK_CONTINUATION: ["PA_PULLBACK_DEPTH", "RSI_CROSSBACK", "RSI_TRAJECTORY", "PA_MICRO_STRUCTURE"],
    DEEP_PULLBACK_STRUCTURE_THREAT: ["PA_PULLBACK_DEPTH", "PA_BOS_CHOCH", "RSI_ZONE_CONTEXT"],
    STRUCTURAL_REVERSAL: ["PA_BOS_CHOCH", "DMI_TAKEOVER_RESUME", "RSI_DIVERGENCE"],
    BREAKOUT: ["PA_BREAKOUT_RETEST", "BOLLINGER_SQUEEZE_EXPANSION", "ATR_VOLATILITY_REGIME"],
    FAILED_BREAKOUT: ["PA_FAILED_BREAKOUT", "BOLLINGER_REENTRY_REJECTION"],
    BREAKDOWN: ["PA_BREAKOUT_RETEST", "PA_TREND_STRUCTURE"],
    FAILED_BREAKDOWN: ["PA_FAILED_BREAKOUT", "BOLLINGER_REENTRY_REJECTION"],
    BREAKOUT_RETEST: ["PA_BREAKOUT_RETEST", "PA_MICRO_STRUCTURE"],
    COMPRESSION: ["BOLLINGER_SQUEEZE_EXPANSION", "ATR_VOLATILITY_REGIME"],
    EXPANSION: ["ATR_VOLATILITY_REGIME", "BOLLINGER_SQUEEZE_EXPANSION"],
    RANGE: ["PA_TREND_STRUCTURE", "DMI_LIMITATIONS", "BOLLINGER_RELATIVE_DEFINITION"],
    TRANSITION: ["PA_TREND_STRUCTURE", "DMI_SLOPE_STRENGTHENING"],
    EXHAUSTION: ["DMI_SLOPE_STRENGTHENING", "ATR_VOLATILITY_REGIME", "RSI_DIVERGENCE"],
    STRUCTURAL_ZONE_REJECTION: ["BOLLINGER_REENTRY_REJECTION", "ATR_ZONE_TOLERANCE", "PA_ZONES_SR"],
    TREND_WEAKENING: ["DMI_SLOPE_STRENGTHENING", "DMI_TAKEOVER_RESUME"],
    TREND_RESUMPTION: ["DMI_TAKEOVER_RESUME", "RSI_CROSSBACK", "PA_BOS_CHOCH"],
    NO_SETUP: [],
  };
  return (map[scenarioId] ?? []).filter((id) => PLAYBOOKS[id]);
}

/** Classificacao independente: todos os cenarios avaliados, ordenados por evidencia estrutural (sem votacao). */
export function classifyScenarios(m, { only = null } = {}) {
  const ids = only ?? SCENARIO_IDS.filter((id) => id !== "NO_SETUP");
  const results = ids.map((id) => evaluateScenario(id, m)).filter((result) => result && result.matched);
  const weight = (result) => (result.evidence.some((item) => item.family === "STRUCTURE" && item.type === "SUPPORT") ? 2 : 0) + result.supports;
  results.sort((a, b) => weight(b) - weight(a) || a.scenarioId.localeCompare(b.scenarioId));
  return results;
}

export function validateScenarioLibrary() {
  const errors = [];
  for (const scenario of Object.values(SCENARIOS)) {
    if (!scenario.id || !scenario.definition || !scenario.distinguishing) errors.push(`${scenario.id ?? "?"}.definition`);
    if (!("direction" in scenario)) errors.push(`${scenario.id}.direction`);
    if (!Array.isArray(scenario.requiredMeasurements)) errors.push(`${scenario.id}.requiredMeasurements`);
  }
  return { ok: errors.length === 0, errors, count: Object.keys(SCENARIOS).length };
}
