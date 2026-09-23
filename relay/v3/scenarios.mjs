/**
 * V3 — SCENARIO LIBRARY (simetria UP/DOWN obrigatoria; Asset e Consensus compartilham).
 *
 * SCENARIO TYPE != DIRECTION: os cenarios de tendencia/pullback/retomada/reversao sao
 * simetricos — a direcao e DERIVADA do mercado (estrutura/CHoCH/rompimento), nunca fixa.
 * A classificacao nao vota: usa familias de evidencia, blockers e invalidations com precedencia.
 */
import { PLAYBOOKS } from "./playbooks.mjs";

export const V3_SCENARIOS_VERSION = "v3-scenario-library-v2";

export const EVIDENCE_FAMILIES = Object.freeze(["STRUCTURE", "MOMENTUM", "DIRECTIONAL_PRESSURE", "VOLATILITY", "RELATIVE_POSITION", "MICRO_PRICE_ACTION"]);

const ev = (family, type, code, detail = null) => ({ family, type, code, detail });
const mirror = (direction) => (direction === "UP" ? "DOWN" : "UP");

export const SCENARIOS = Object.freeze({
  TREND_CONTINUATION: { id: "TREND_CONTINUATION", symmetric: true, definition: "Tendencia intacta com BOS recente ou dominancia direcional com ADX >= 20; sem pullback relevante. Vale para UP e DOWN.", distinguishing: "Estrutura HH/HL (UP) ou LH/LL (DOWN) + BOS/pressao; sem correcao ativa.", requiredMeasurements: ["structure.trend", "structure.lastBOS", "dmi.spread"] },
  PULLBACK_CONTINUATION: { id: "PULLBACK_CONTINUATION", symmetric: true, definition: "Tendencia com correcao ativa NORMAL/DEEP e estrutura intacta, aguardando confirmacao de retomada. Vale para UP e DOWN.", distinguishing: "Pullback ativo contra a tendencia sem CHoCH.", requiredMeasurements: ["pullback", "rsi.crossback", "structure.lastCHoCH"] },
  DEEP_PULLBACK_STRUCTURE_THREAT: { id: "DEEP_PULLBACK_STRUCTURE_THREAT", symmetric: true, definition: "Correcao profunda (>1.5 ATR) ameacando o swing que define a tendencia (UP ou DOWN).", distinguishing: "Pullback DEEP + ameaca ao swing; sem CHoCH confirmado.", requiredMeasurements: ["pullback.depth", "pullback.distanceAtr", "structure.lastLow", "structure.lastHigh"] },
  STRUCTURAL_REVERSAL: { id: "STRUCTURAL_REVERSAL", symmetric: true, definition: "CHoCH confirmado contra a tendencia anterior, com evidencia de momentum/pressao na nova direcao (DOWN apos UPTREND; UP apos DOWNTREND).", distinguishing: "CHoCH + pressao invertida.", requiredMeasurements: ["structure.lastCHoCH", "dmi.takeover", "rsi.slope"] },
  BREAKOUT: { id: "BREAKOUT", symmetric: false, definition: "Fechamentos sustentados acima da resistencia (>=2), tipicamente pos-compressao.", distinguishing: "Rompimento de resistencia com fechamento.", requiredMeasurements: ["breakoutRetest.breakout", "bollinger.squeeze"] },
  FAILED_BREAKOUT: { id: "FAILED_BREAKOUT", symmetric: false, definition: "Preco rompeu a resistencia e voltou para dentro do range.", distinguishing: "Rompimento previo + fechamento de volta.", requiredMeasurements: ["breakoutRetest.failed"] },
  BREAKDOWN: { id: "BREAKDOWN", symmetric: false, definition: "Fechamentos sustentados abaixo do suporte (>=2).", distinguishing: "Rompimento de suporte com fechamento.", requiredMeasurements: ["breakoutRetest.breakdown"] },
  FAILED_BREAKDOWN: { id: "FAILED_BREAKDOWN", symmetric: false, definition: "Preco perdeu o suporte e recuperou o range.", distinguishing: "Perda previa do suporte + recuperacao.", requiredMeasurements: ["breakoutRetest.failed"] },
  BREAKOUT_RETEST: { id: "BREAKOUT_RETEST", symmetric: true, definition: "Reteste defensavel da zona rompida (resistencia para UP; suporte para DOWN apos breakdown).", distinguishing: "Rompimento + retorno a zona + defesa.", requiredMeasurements: ["breakoutRetest.breakout", "breakoutRetest.breakdown", "breakoutRetest.retest"] },
  COMPRESSION: { id: "COMPRESSION", symmetric: false, definition: "BandWidth em percentil baixo (squeeze) com amplitude reduzida; sem direcao definida.", distinguishing: "Sem rompimento.", requiredMeasurements: ["bollinger.squeeze", "atr.volRatio"] },
  EXPANSION: { id: "EXPANSION", symmetric: false, definition: "Volatilidade em expansao sem estrutura direcional clara.", distinguishing: "Expansao sem BOS/CHoCH.", requiredMeasurements: ["atr.volRatio", "bollinger.expansion"] },
  RANGE: { id: "RANGE", symmetric: false, definition: "Estrutura mista, ADX fraco, preco no miolo das bandas.", distinguishing: "Sem tendencia e sem rompimento.", requiredMeasurements: ["structure.trend", "dmi.adx", "bollinger.percentB"] },
  TRANSITION: { id: "TRANSITION", symmetric: false, definition: "Estrutura em transicao (HH+LL ou LH+HL) ou ADX em queda apos tendencia.", distinguishing: "Sinais conflitantes.", requiredMeasurements: ["structure.trend", "dmi.trendState"] },
  EXHAUSTION: { id: "EXHAUSTION", symmetric: false, definition: "Tendencia com ADX caindo, impulsos desacelerando e/ou bulge de volatilidade.", distinguishing: "Perde forca sem CHoCH.", requiredMeasurements: ["dmi.trendState", "impulse.decelerating", "bollinger.squeeze"] },
  STRUCTURAL_ZONE_REJECTION: { id: "STRUCTURAL_ZONE_REJECTION", symmetric: false, definition: "Rejeicao em zona estrutural/banda com pavio e fechamento de volta.", distinguishing: "Rejeicao sem quebra de estrutura.", requiredMeasurements: ["bollinger.rejection", "zoneDistance", "micro.upperWickRatio"] },
  TREND_WEAKENING: { id: "TREND_WEAKENING", symmetric: false, definition: "ADX em queda + spread diminuindo, estrutura ainda intacta.", distinguishing: "Perda de forca antes de quebra.", requiredMeasurements: ["dmi.adxSlope", "dmi.pressureChange"] },
  TREND_RESUMPTION: { id: "TREND_RESUMPTION", symmetric: true, definition: "Apos pullback, a pressao retoma a direcao original (UP ou DOWN) com BOS/crossback.", distinguishing: "Retomada confirmada.", requiredMeasurements: ["dmi.takeover", "rsi.crossback", "structure.lastBOS"] },
  NO_SETUP: { id: "NO_SETUP", symmetric: false, definition: "Existe expiration, mas nao ha configuracao estrutural relevante.", distinguishing: "Ausencia de cenario operacional.", requiredMeasurements: [] },
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));

function trends(m) { return m?.structure?.trend ?? "RANGE"; }
function trendDirection(m) { const t = trends(m); return t === "UPTREND" ? "UP" : t === "DOWNTREND" ? "DOWN" : null; }

function dirEvidence({ direction, family, codeUp, codeDown, type = "SUPPORT", detail = null }) {
  const code = direction === "UP" ? codeUp : codeDown;
  return code ? ev(family, type, code, detail) : null;
}

/** Avaliacao direcional de um cenario simetrico (mesma logica, espelhada). */
function evaluateDirectional(scenarioId, m, direction) {
  const up = direction === "UP";
  const evidence = []; const blockers = []; const invalidations = [];
  const rsi = m.rsi ?? {}; const dmi = m.dmi ?? {}; const boll = m.bollinger ?? {}; const atr = m.atr ?? {};
  const structure = m.structure ?? {}; const pullback = m.pullback ?? {}; const micro = m.micro ?? {}; const impulse = m.impulse ?? {}; const br = m.breakoutRetest ?? {};
  const opposite = mirror(direction);
  const trend = trends(m);
  const trendMatches = direction === "UP" ? trend === "UPTREND" : trend === "DOWNTREND";
  const push = (item) => { if (item) evidence.push(item); };
  switch (scenarioId) {
    case "TREND_CONTINUATION":
      if (trendMatches) push(dirEvidence({ direction, family: "STRUCTURE", codeUp: "UPTREND_STRUCTURE", codeDown: "DOWNTREND_STRUCTURE" }));
      push(dirEvidence({ direction, family: "STRUCTURE", codeUp: structure.lastBOS?.type === "BULLISH_BOS" ? "BULLISH_BOS" : null, codeDown: structure.lastBOS?.type === "BEARISH_BOS" ? "BEARISH_BOS" : null }));
      if (dmi.dominance === (up ? "PLUS" : "MINUS") && Number(dmi.adx) >= 20) push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", up ? "PLUS_DOMINANCE_STRONG" : "MINUS_DOMINANCE_STRONG", { adx: dmi.adx, spread: dmi.spread }));
      if (pullback.active === true && pullback.direction === (up ? "UP_TREND_PULLBACK" : "DOWN_TREND_PULLBACK") && pullback.depth !== "SHALLOW") invalidations.push({ code: "PULLBACK_ACTIVE", direction, detail: pullback.depth });
      if (structure.lastCHoCH?.type === (up ? "BEARISH_CHOCH" : "BULLISH_CHOCH")) invalidations.push({ code: `${opposite}_CHOCH` });
      break;
    case "PULLBACK_CONTINUATION":
      if (trendMatches && pullback.active === true && pullback.direction === (up ? "UP_TREND_PULLBACK" : "DOWN_TREND_PULLBACK")) push(ev("STRUCTURE", "SUPPORT", up ? "UP_TREND_PULLBACK" : "DOWN_TREND_PULLBACK", { depth: pullback.depth, distanceAtr: pullback.distanceAtr }));
      if (rsi.crossback?.direction === direction) push(ev("MOMENTUM", "SUPPORT", `RSI_CROSSBACK_${direction}`));
      if (rsi.slope !== null && Number(rsi.slope) * (up ? 1 : -1) > 0) push(ev("MOMENTUM", "SUPPORT", `RSI_SLOPE_${direction}`, rsi.slope));
      if (micro.character === "DECISIVE" && micro.direction === direction) push(ev("MICRO_PRICE_ACTION", "SUPPORT", `DECISIVE_${direction}`));
      if (dmi.dominance === (up ? "PLUS" : "MINUS")) push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", up ? "PLUS_DOMINANCE" : "MINUS_DOMINANCE"));
      if (structure.lastCHoCH?.type === (up ? "BEARISH_CHOCH" : "BULLISH_CHOCH")) invalidations.push({ code: `${opposite}_CHOCH` });
      if (pullback.depth === "DEEP") blockers.push({ code: "PULLBACK_TOO_DEEP", detail: pullback.distanceAtr });
      break;
    case "DEEP_PULLBACK_STRUCTURE_THREAT":
      if (trendMatches && pullback.depth === "DEEP") push(ev("STRUCTURE", "SUPPORT", "DEEP_PULLBACK", { direction, distanceAtr: pullback.distanceAtr }));
      if (structure.lastCHoCH?.type === (up ? "BEARISH_CHOCH" : "BULLISH_CHOCH")) push(ev("STRUCTURE", "SUPPORT", `${opposite}_CHOCH`));
      if (rsi.zone === (up ? "OVERSOLD" : "OVERBOUGHT")) push(ev("MOMENTUM", "SUPPORT", `RSI_${rsi.zone}`));
      if (structure.lastBOS?.type === (up ? "BULLISH_BOS" : "BEARISH_BOS")) invalidations.push({ code: `FRESH_${direction}_BOS` });
      break;
    case "STRUCTURAL_REVERSAL":
      if (structure.lastCHoCH?.type === (up ? "BULLISH_CHOCH" : "BEARISH_CHOCH")) push(ev("STRUCTURE", "SUPPORT", `${direction}_CHOCH`));
      if (dmi.takeover === (up ? "PLUS_TOOK_OVER" : "MINUS_TOOK_OVER")) push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", `${direction}_TOOK_OVER`));
      if (rsi.slope !== null && Number(rsi.slope) * (up ? 1 : -1) > 0) push(ev("MOMENTUM", "SUPPORT", `RSI_SLOPE_${direction}`, rsi.slope));
      if (structure.lastBOS?.type === (up ? "BEARISH_BOS" : "BULLISH_BOS") && structure.lastCHoCH === null) blockers.push({ code: "NO_CHOCH_YET", direction });
      break;
    case "BREAKOUT_RETEST":
      if (up ? br.breakout === true : br.breakdown === true) push(ev("STRUCTURE", "SUPPORT", up ? "BREAKOUT" : "BREAKDOWN", { level: up ? br.resistance : br.support }));
      if (br.retest === true) push(ev("STRUCTURE", "SUPPORT", "RETEST_DEFENDED"));
      if (up ? br.failed?.type === "FAILED_BREAKOUT" : br.failed?.type === "FAILED_BREAKDOWN") invalidations.push({ code: "FAILED_RETEST" });
      break;
    case "TREND_RESUMPTION":
      if (trendMatches && (dmi.takeover === (up ? "PLUS_TOOK_OVER" : "MINUS_TOOK_OVER") || (dmi.dominance === (up ? "PLUS" : "MINUS") && Number(dmi.pressureChange) * (up ? 1 : -1) > 0))) push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", up ? "PLUS_RESUME" : "MINUS_RESUME"));
      if (rsi.crossback?.direction === direction) push(ev("MOMENTUM", "SUPPORT", `RSI_CROSSBACK_${direction}`));
      if (structure.lastBOS?.type === (up ? "BULLISH_BOS" : "BEARISH_BOS")) push(ev("STRUCTURE", "SUPPORT", up ? "BULLISH_BOS" : "BEARISH_BOS"));
      if (pullback.depth === "DEEP") blockers.push({ code: "DEEP_PULLBACK", direction });
      break;
    default:
      return null;
  }
  const supports = evidence.filter((item) => item.type === "SUPPORT").length;
  const counters = evidence.filter((item) => item.type === "COUNTER").length;
  return { scenarioId, direction, matched: supports > 0 && invalidations.length === 0, supports, counters, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
}

/** Cenarios assimetricos (evento especifico, direcao semantica propria). */
function evaluateFixed(scenarioId, m) {
  const evidence = []; const blockers = []; const invalidations = [];
  const rsi = m.rsi ?? {}; const dmi = m.dmi ?? {}; const boll = m.bollinger ?? {}; const atr = m.atr ?? {};
  const structure = m.structure ?? {}; const micro = m.micro ?? {}; const impulse = m.impulse ?? {}; const br = m.breakoutRetest ?? {};
  const trend = trends(m);
  switch (scenarioId) {
    case "BREAKOUT":
      if (br.breakout === true) evidence.push(ev("STRUCTURE", "SUPPORT", "BREAKOUT", { resistance: br.resistance }));
      if (trend === "UPTREND") evidence.push(ev("STRUCTURE", "CONTEXT", "UPTREND_CONTEXT"));
      if (boll.squeeze === "SQUEEZE") evidence.push(ev("VOLATILITY", "SUPPORT", "PRE_BREAKOUT_SQUEEZE"));
      if (br.failed?.type === "FAILED_BREAKOUT") invalidations.push({ code: "FAILED_BREAKOUT" });
      return { scenarioId, direction: "UP", matched: evidence.filter((i) => i.type === "SUPPORT").length > 0 && invalidations.length === 0, supports: evidence.filter((i) => i.type === "SUPPORT").length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "BREAKDOWN":
      if (br.breakdown === true) evidence.push(ev("STRUCTURE", "SUPPORT", "BREAKDOWN", { support: br.support }));
      if (trend === "DOWNTREND") evidence.push(ev("STRUCTURE", "CONTEXT", "DOWNTREND_CONTEXT"));
      return { scenarioId, direction: "DOWN", matched: evidence.filter((i) => i.type === "SUPPORT").length > 0 && invalidations.length === 0, supports: evidence.filter((i) => i.type === "SUPPORT").length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "FAILED_BREAKOUT":
      if (br.failed?.type === "FAILED_BREAKOUT") evidence.push(ev("STRUCTURE", "SUPPORT", "FAILED_BREAKOUT", br.failed));
      if (boll.bandWalk === "ABOVE_UPPER") evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "TAG_UPPER"));
      if (br.breakout === true && !br.failed) invalidations.push({ code: "BREAKOUT_STILL_VALID" });
      return { scenarioId, direction: "DOWN", matched: evidence.filter((i) => i.type === "SUPPORT").length > 0 && invalidations.length === 0, supports: evidence.filter((i) => i.type === "SUPPORT").length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "FAILED_BREAKDOWN":
      if (br.failed?.type === "FAILED_BREAKDOWN") evidence.push(ev("STRUCTURE", "SUPPORT", "FAILED_BREAKDOWN", br.failed));
      if (boll.bandWalk === "BELOW_LOWER") evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "TAG_LOWER"));
      return { scenarioId, direction: "UP", matched: evidence.filter((i) => i.type === "SUPPORT").length > 0 && invalidations.length === 0, supports: evidence.filter((i) => i.type === "SUPPORT").length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "COMPRESSION":
      if (boll.squeeze === "SQUEEZE") evidence.push(ev("VOLATILITY", "SUPPORT", "SQUEEZE"));
      if (Number(atr.volRatio) < 0.85) evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_CONTRACTION", atr.volRatio));
      return { scenarioId, direction: null, matched: evidence.length > 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "EXPANSION":
      if (Number(atr.volRatio) > 1.15) evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_EXPANSION", atr.volRatio));
      if (trend !== "RANGE") blockers.push({ code: "DIRECTIONAL_STRUCTURE_PRESENT" });
      return { scenarioId, direction: null, matched: evidence.length > 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "RANGE":
      if (trend === "RANGE") evidence.push(ev("STRUCTURE", "SUPPORT", "MIXED_STRUCTURE"));
      if (Number(dmi.adx) < 20) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAK", dmi.adx));
      if (boll.percentB !== null && boll.percentB > 0.35 && boll.percentB < 0.65) evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "MID_BANDS", boll.percentB));
      if (br.breakout === true || br.breakdown === true) invalidations.push({ code: "RANGE_BROKEN" });
      return { scenarioId, direction: null, matched: evidence.length > 0 && invalidations.length === 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "TRANSITION":
      if (trend === "TRANSITION") evidence.push(ev("STRUCTURE", "SUPPORT", "TRANSITION_STRUCTURE"));
      if (dmi.trendState === "WEAKENING") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING"));
      return { scenarioId, direction: null, matched: evidence.length > 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "EXHAUSTION":
      if (dmi.trendState === "WEAKENING" && Number(dmi.adx) >= 20) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING_FROM_STRONG"));
      if (impulse.decelerating === true) evidence.push(ev("MOMENTUM", "SUPPORT", "IMPULSE_DECELERATING"));
      if (boll.squeeze === "EXPANDED") evidence.push(ev("VOLATILITY", "SUPPORT", "VOL_BULGE"));
      if (structure.lastBOS) blockers.push({ code: "FRESH_BOS_AGAINST_EXHAUSTION" });
      return { scenarioId, direction: null, matched: evidence.length > 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "STRUCTURAL_ZONE_REJECTION":
      if (boll.rejection === true) evidence.push(ev("RELATIVE_POSITION", "SUPPORT", "BAND_REJECTION"));
      if (micro.upperWickRatio > 0.4 || micro.lowerWickRatio > 0.4) evidence.push(ev("MICRO_PRICE_ACTION", "SUPPORT", "WICK_REJECTION"));
      if (br.breakout === true || br.breakdown === true) invalidations.push({ code: "ZONE_BROKEN" });
      return { scenarioId, direction: null, matched: evidence.length > 0 && invalidations.length === 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "TREND_WEAKENING":
      if (dmi.trendState === "WEAKENING") evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "ADX_WEAKENING"));
      if (dmi.pressureChange !== null && Math.abs(dmi.pressureChange) < Math.abs(dmi.spread ?? 0)) evidence.push(ev("DIRECTIONAL_PRESSURE", "SUPPORT", "PRESSURE_DECAY", dmi.pressureChange));
      if (structure.lastCHoCH) invalidations.push({ code: "ALREADY_BROKEN_STRUCTURE" });
      return { scenarioId, direction: null, matched: evidence.length > 0 && invalidations.length === 0, supports: evidence.length, counters: 0, evidence, blockers, invalidations, playbooks: playbooksForScenario(scenarioId) };
    case "NO_SETUP":
      return { scenarioId, direction: null, matched: false, supports: 0, counters: 0, evidence, blockers, invalidations, playbooks: [] };
    default:
      return null;
  }
}

/** Avaliacao determinista de um cenario (direcao derivada quando simetrico). */
export function evaluateScenario(scenarioId, m) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario || !m) return null;
  if (scenario.symmetric) {
    // A direcao e derivada do MERCADO: reversao vem do CHoCH; tendencia/pullback/retomada vem da estrutura.
    const structure = m.structure ?? {};
    const directions = scenarioId === "STRUCTURAL_REVERSAL"
      ? (structure.lastCHoCH?.type === "BEARISH_CHOCH" ? ["DOWN"] : structure.lastCHoCH?.type === "BULLISH_CHOCH" ? ["UP"] : [])
      : [trendDirection(m)].filter(Boolean);
    if (!directions.length) return { scenarioId, direction: null, matched: false, supports: 0, counters: 0, evidence: [], blockers: [], invalidations: [], playbooks: playbooksForScenario(scenarioId) };
    const results = directions.map((direction) => evaluateDirectional(scenarioId, m, direction)).filter(Boolean);
    return results.find((result) => result.matched) ?? results[0];
  }
  return evaluateFixed(scenarioId, m);
}

export function playbooksForScenario(scenarioId) {
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

/** Classificacao independente: todos os cenarios avaliados, ordenados por peso estrutural (sem votacao). */
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
    if (typeof scenario.symmetric !== "boolean") errors.push(`${scenario.id}.symmetric`);
    if (!Array.isArray(scenario.requiredMeasurements)) errors.push(`${scenario.id}.requiredMeasurements`);
  }
  return { ok: errors.length === 0, errors, count: Object.keys(SCENARIOS).length };
}
