/**
 * SCENARIO SHADOW + CRITIC INDEPENDENTE (Agente B) — RESEARCH/SHADOW ONLY.
 *
 * Regras inviolaveis deste modulo:
 *  1. NUNCA envia ordem, NUNCA controla execucao, stake, direcao, threshold ou o Critic atual.
 *     Toda saida e advisory (SCENARIO_SHADOW_POLICY.controlsExecution=false) e `applyScenarioAdvisory`
 *     e identidade (nao altera a execucao). O Execution Gate de producao nunca e importado nem chamado.
 *  2. CRITIC INDEPENDENTE em 2 fases:
 *       FASE 1 — o Critic recebe o MESMO snapshot T0 SEM conhecer a conclusao do Trader; sua analise e
 *       congelada (deepFreeze + hash sha256 + timestamp `criticFrozenAt`).
 *       FASE 2 — somente entao a analise do Trader e computada e comparada; pontos exatos de divergencia
 *       sao registrados. Divergencia NUNCA vira votacao: vira investigacao com evidencia explicita e,
 *       sem evidencia suficiente, WAIT. A direcao do Critic nunca e adotada (BUY nunca vira SELL).
 *  3. SCENARIO PERSISTENCE: estagios CANDIDATE, REVALIDATION_1, REVALIDATION_2, FINAL_ENTRY sao
 *     append-only (T0 jamais sobrescrito); as sequencias de scenario/regime/direction/critic/quality/
 *     location/momentum e playbook@candidate vs playbook@entry sao consultaveis.
 *  4. FINAL REVALIDATION acoplada ao LATE_WINDOW_V2: se o cenario mudar invalidando a tese, o candidato
 *     e cancelado (WAIT) — nunca mantem decisao antiga e nunca inverte a direcao.
 *  5. ABLATION-ready (pesquisa): `featuresUsed` por analise + componentes desligaveis
 *     (RSI/ADX/microstructure/location/volatility). Sem pesos aprendidos.
 *  6. ZERO LEAKAGE: o T0 e point-in-time, whitelisted e sanitizado (result/settlement/postWindow/
 *     future/broker/causal NUNCA entram na classificacao). O outcome posterior e marcado como OUTCOME
 *     e `usedInClassification:false` — nunca realimenta a classificacao.
 *
 * O motor puro de cenarios vive em `relay/scenario-engine.mjs` (contrato CONGELADO). Este modulo faz
 * dynamic import com fallback deterministico que degrada sem quebrar; o fallback e explicitamente
 * marcado em cada observacao (`engineInfo.mode`).
 */
import { createHash } from "node:crypto";
import { buildT0Snapshot, findFutureReferences, parseMarketKey, normalizedOutcomePnl, summarizeRows, wilsonInterval } from "./shadow-lab.mjs";
import { TIMING_POLICY_CURRENT, TIMING_POLICY_LATE, sameExpirationWindow, lateDeadlineAt } from "./late-window-timing.mjs";

export const SCENARIO_SHADOW_VERSION = "scenario-shadow-v1";
export const SCENARIO_ENGINE_CONTRACT_VERSION = "scenario-engine-contract-v1";

/** Series SEPARADAS: scenario policy e timing policy nunca se misturam. */
export const CURRENT_G2 = "CURRENT_G2";
export const SCENARIO_ENGINE_V3_SHADOW = "SCENARIO_ENGINE_V3_SHADOW";

export const SCENARIO_SHADOW_KIND = "SCENARIO_SHADOW_OBSERVATION";
export const SCENARIO_STAGES = Object.freeze(["CANDIDATE", "REVALIDATION_1", "REVALIDATION_2", "FINAL_ENTRY"]);
export const STAGE_TO_FIELD = Object.freeze({
  CANDIDATE: "scenarioAtCandidate",
  REVALIDATION_1: "scenarioAtRevalidation1",
  REVALIDATION_2: "scenarioAtRevalidation2",
  FINAL_ENTRY: "scenarioAtFinalEntry",
});
export const DIMENSIONS = Object.freeze(["scenario", "regime", "direction", "critic", "quality", "location", "momentum"]);
export const FINAL_ACTIONS = Object.freeze(["BUY", "SELL", "WAIT"]);
export const PROVENANCES = Object.freeze(["PROSPECTIVE", "HISTORICAL"]);
export const SETTLEMENT_BASES = Object.freeze(["BROKER_EXECUTED", "CAUSAL_COUNTERFACTUAL"]);

/** Politica global testavel: nenhuma saida controla execucao. */
export const SCENARIO_SHADOW_POLICY = Object.freeze({
  version: SCENARIO_SHADOW_VERSION,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  controlsDirection: false,
  controlsStake: false,
  controlsThresholds: false,
  controlsProductionCritic: false,
  criticMode: "INDEPENDENT_TWO_PHASE",
  divergencePolicy: "INVESTIGATION_NEVER_VOTING",
  directionPolicy: "NEVER_FLIPS_DIRECTION_FAIL_TO_WAIT",
  note: "Nunca envia ordem; o Brain G2, o Critic atual, Consensus, stake, JIT e Execution Gate permanecem intocados.",
});

/** Taxonomia congelada das divergencias (investigacao, nunca votacao). */
export const DIVERGENCE_CODES = Object.freeze([
  "SAME",
  "SAME_DIRECTION_SCENARIO_MISMATCH",
  "TRADER_ENTRY_CRITIC_WAIT",
  "TRADER_WAIT_CRITIC_ENTRY",
  "DIRECTION_OPPOSITE",
  "REGIME_MISMATCH",
  "INSUFFICIENT_DATA",
]);

/** Pontos de resolucao exigidos pela investigacao de divergencia (evidencia explicita, nunca voto). */
export const RESOLUTION_POINTS = Object.freeze([
  "holdAboveLevel", "reEntry", "noRejectionWick", "momentumAligned", "ticksFresh", "locationOk",
]);
export const MIN_RESOLUTION_EVIDENCE = 4;
export const MIN_OPPOSITE_DIRECTION_EVIDENCE = 5;

/** ABLATION-ready (SOMENTE pesquisa; nunca producao, sem pesos aprendidos). */
export const ABLATION_COMPONENTS = Object.freeze(["rsi", "adx", "microstructure", "location", "volatility"]);
export const DEFAULT_ABLATION = Object.freeze(Object.fromEntries(ABLATION_COMPONENTS.map((component) => [component, true])));
export const ABLATION_POLICY = Object.freeze({
  researchOnly: true,
  productionUse: false,
  learnedWeights: false,
  note: "Desligar componentes serve para medir informacao incremental futuramente; jamais altera producao.",
});

/* ------------------------------------------------------------------ engine (dynamic import + fallback) */

export const ENGINE_CONTRACT = Object.freeze(["REGIMES", "SCENARIOS", "extractContext", "classifyRegime", "classifyScenario", "evaluatePlaybook", "analyzeScenario"]);

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const bool = (value) => value === true;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function sha256Hex(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

/* ------------------------------------------------------------------ fallback engine (contrato congelado) */

export const FALLBACK_REGIMES = Object.freeze(["TREND_UP", "TREND_DOWN", "EXPANSION", "RANGE", "COMPRESSION", "TRANSITION", "CHAOTIC", "UNKNOWN"]);
export const FALLBACK_SCENARIOS = Object.freeze(["TREND_CONTINUATION", "TREND_PULLBACK", "BREAKOUT", "FAILED_BREAKOUT", "REVERSAL", "RANGE_REJECTION", "RANGE_BREAKOUT", "EXHAUSTION", "CONSOLIDATION", "NO_SCENARIO"]);

export const PLAYBOOKS = Object.freeze({
  TREND_CONTINUATION: Object.freeze({ id: "PB_TREND_CONTINUATION", directional: true, withTrend: true, description: "continuacao de tendencia com estrutura alinhada" }),
  TREND_PULLBACK: Object.freeze({ id: "PB_TREND_PULLBACK", directional: true, withTrend: true, description: "pullback com estrutura mantida" }),
  BREAKOUT: Object.freeze({ id: "PB_BREAKOUT", directional: true, withTrend: true, description: "rompimento com corpo dominante e re-teste" }),
  FAILED_BREAKOUT: Object.freeze({ id: "PB_FAILED_BREAKOUT", directional: false, withTrend: false, description: "rompimento falho: sem hold, re-entry ou com wick de rejeicao" }),
  REVERSAL: Object.freeze({ id: "PB_REVERSAL", directional: true, withTrend: false, description: "reversao com estrutura virada contra a tendencia anterior" }),
  RANGE_REJECTION: Object.freeze({ id: "PB_RANGE_REJECTION", directional: true, withTrend: false, description: "rejeicao na borda do range" }),
  RANGE_BREAKOUT: Object.freeze({ id: "PB_RANGE_BREAKOUT", directional: true, withTrend: true, description: "rompimento de range com expansao" }),
  EXHAUSTION: Object.freeze({ id: "PB_EXHAUSTION", directional: false, withTrend: false, description: "exaustao: extremo de RSI com velocidade perdendo forca" }),
  CONSOLIDATION: Object.freeze({ id: "PB_CONSOLIDATION", directional: false, withTrend: false, description: "consolidacao no meio do canal" }),
  NO_SCENARIO: Object.freeze({ id: "PB_NO_SCENARIO", directional: false, withTrend: false, description: "sem cenario valido" }),
});

function firstFinite(...values) {
  for (const value of values) { const parsed = num(value); if (parsed !== null) return parsed; }
  return null;
}

function fallbackExtractContext(input = {}) {
  const snapshot = input.snapshot ?? input.t0 ?? input;
  const structure = snapshot.structure ?? snapshot.trader?.structure ?? {};
  const location = snapshot.location ?? snapshot.trader?.location ?? {};
  const momentum = snapshot.momentum ?? snapshot.trader?.momentum ?? {};
  const strength = snapshot.strength ?? snapshot.trader?.strength ?? {};
  const volatility = snapshot.volatility ?? snapshot.trader?.volatility ?? {};
  const microstructure = snapshot.microstructure ?? snapshot.trader?.microstructure ?? {};
  const freshness = snapshot.freshness ?? {};
  const evidence = input.evidence ?? snapshot.evidence ?? {};
  const directionHint = input.direction ?? snapshot.action ?? snapshot.trader?.action ?? null;
  const direction = directionHint === "BUY" || directionHint === "SELL" ? directionHint : null;
  return {
    marketKey: input.marketKey ?? snapshot.marketKey ?? null,
    marketType: input.marketType ?? snapshot.marketType ?? null,
    direction,
    price: firstFinite(input.price, snapshot.price),
    regimeHint: snapshot.regime ?? null,
    setupHint: snapshot.setup ?? null,
    triggerHint: snapshot.trigger ?? null,
    structureLabel: structure.label ?? null,
    structureState: {
      label: structure.label ?? null,
      direction: structure.direction ?? null,
      bodyRatio: firstFinite(microstructure.bodyRatio),
      velocity: firstFinite(structure.velocity?.velocity, momentum.velocity),
      acceleration: firstFinite(structure.velocity?.acceleration, momentum.acceleration),
    },
    location: {
      donchianPosition: firstFinite(location.donchianPosition),
      distanceToUpperATR: firstFinite(location.distanceToUpperATR),
      distanceToLowerATR: firstFinite(location.distanceToLowerATR),
      channelHigh: firstFinite(location.channelHigh),
      channelLow: firstFinite(location.channelLow),
      zone: location.zone ?? null,
    },
    momentum: {
      rsi14: firstFinite(momentum.rsi14),
      velocity: firstFinite(momentum.velocity, structure.velocity?.velocity),
      acceleration: firstFinite(momentum.acceleration, structure.velocity?.acceleration),
    },
    strength: { adx14: firstFinite(strength.adx14), plusDI: firstFinite(strength.plusDI), minusDI: firstFinite(strength.minusDI) },
    volatility: { atr: firstFinite(volatility.atr), atrRatio: firstFinite(volatility.atrRatio), compression: volatility.compression === true, expansion: volatility.expansion === true },
    microstructure: {
      streak: firstFinite(microstructure.streak),
      bodyRatio: firstFinite(microstructure.bodyRatio),
      upperWick: firstFinite(microstructure.upperWick),
      lowerWick: firstFinite(microstructure.lowerWick),
    },
    freshness: { fresh: freshness.fresh === true, tickAgeMs: firstFinite(freshness.tickAgeMs) },
    events: {
      breakoutUp: snapshot.events?.breakoutUp === true || evidence.breakoutUp === true,
      breakoutDown: snapshot.events?.breakoutDown === true || evidence.breakoutDown === true,
      retestUp: snapshot.events?.retestUp === true || evidence.retestUp === true,
      retestDown: snapshot.events?.retestDown === true || evidence.retestDown === true,
    },
    evidence: {
      holdAboveLevel: evidence.holdAboveLevel === true ? true : evidence.holdAboveLevel === false ? false : undefined,
      reEntry: evidence.reEntry === true ? true : evidence.reEntry === false ? false : undefined,
      rejectionWick: evidence.rejectionWick === true ? true : evidence.rejectionWick === false ? false : undefined,
      ticksFresh: evidence.ticksFresh === true ? true : evidence.ticksFresh === false ? false : undefined,
      tickPrices: Array.isArray(evidence.tickPrices) ? evidence.tickPrices.length : null,
    },
    ablation: input.ablation ?? null,
  };
}

function fallbackClassifyRegime(context = {}) {
  const reasons = [];
  if (context.regimeHint && FALLBACK_REGIMES.includes(context.regimeHint) && context.regimeHint !== "UNKNOWN") {
    return { regime: context.regimeHint, primary: context.regimeHint, confidence: 0.6, reasons: ["REGIME_PROVIDED_BY_T0"], rule: "T0_REGIME_PASSTHROUGH" };
  }
  const adx = context.strength?.adx14 ?? null;
  const atrRatio = context.volatility?.atrRatio ?? null;
  const label = context.structureLabel;
  const up = label === "UP" || label === "HH_HL";
  const down = label === "DOWN" || label === "LH_LL";
  let regime = "TRANSITION";
  let rule = "DEFAULT_TRANSITION";
  if (context.volatility?.compression === true) { regime = "COMPRESSION"; rule = "COMPRESSION_FLAG"; }
  else if (adx !== null && adx >= 20 && up) { regime = "TREND_UP"; rule = "ADX_GE_20_AND_STRUCTURE_UP"; }
  else if (adx !== null && adx >= 20 && down) { regime = "TREND_DOWN"; rule = "ADX_GE_20_AND_STRUCTURE_DOWN"; }
  else if (atrRatio !== null && atrRatio >= 1.5 && (context.volatility?.expansion === true || adx === null || adx >= 15)) { regime = "EXPANSION"; rule = "ATR_RATIO_GE_1.5"; }
  else if (adx !== null && adx < 18 && context.location?.donchianPosition !== null) { regime = "RANGE"; rule = "ADX_LT_18_WITH_LOCATION"; }
  else if (atrRatio !== null && atrRatio >= 2.5 && (adx === null || adx < 15)) { regime = "CHAOTIC"; rule = "ATR_RATIO_GE_2.5_ADX_LT_15"; }
  if (regime === "TRANSITION") reasons.push("NO_CLEAR_REGIME");
  return { regime, primary: regime, confidence: regime === "TRANSITION" ? 0.25 : 0.5, reasons, rule };
}

function fallbackClassifyScenario(context = {}, regime = {}) {
  const evidenceFor = [];
  const evidenceAgainst = [];
  const invalidationReasons = [];
  const dir = context.direction;
  const rsi = context.momentum?.rsi14 ?? null;
  const adx = context.strength?.adx14 ?? null;
  const pos = context.location?.donchianPosition ?? null;
  const bodyRatio = context.microstructure?.bodyRatio ?? null;
  const againstATR = dir === "BUY" ? context.location?.distanceToLowerATR : dir === "SELL" ? context.location?.distanceToUpperATR : null;
  const structureAligned = dir === "BUY" ? (context.structureLabel === "UP" || context.structureLabel === "HH_HL") : dir === "SELL" ? (context.structureLabel === "DOWN" || context.structureLabel === "LH_LL") : false;
  const breakout = dir === "BUY" ? context.events?.breakoutUp === true : dir === "SELL" ? context.events?.breakoutDown === true : false;
  const retest = dir === "BUY" ? context.events?.retestUp === true : dir === "SELL" ? context.events?.retestDown === true : false;
  const contradictory = typeof context.evidence?.holdAboveLevel === "boolean" ? context.evidence.holdAboveLevel === false : false;

  if (!dir && rsi === null && adx === null && pos === null) {
    return { scenario: "NO_SCENARIO", primary: "NO_SCENARIO", secondary: null, evidenceFor, evidenceAgainst: ["FEATURES_UNAVAILABLE"], invalidationReasons: ["NO_FEATURES"], confidence: 0, rule: "NO_FEATURES", states: fallbackStates(context) };
  }
  let scenario = "CONSOLIDATION";
  let rule = "DEFAULT_CONSOLIDATION";
  if (regime.regime === "CHAOTIC") { scenario = "NO_SCENARIO"; rule = "CHAOTIC_REGIME"; invalidationReasons.push("REGIME_CHAOTIC"); }
  else if (breakout && contradictory) { scenario = "FAILED_BREAKOUT"; rule = "BREAKOUT_WITHOUT_HOLD"; evidenceAgainst.push("BREAKOUT_WITHOUT_HOLD"); invalidationReasons.push("FAILED_BREAKOUT"); }
  else if (breakout && retest) { scenario = "BREAKOUT"; rule = "BREAKOUT_WITH_RETEST"; evidenceFor.push("BREAKOUT", "RETEST"); }
  else if (breakout) { scenario = "BREAKOUT"; rule = "BREAKOUT_EVENT"; evidenceFor.push("BREAKOUT"); }
  else if ((regime.regime === "TREND_UP" || regime.regime === "TREND_DOWN") && structureAligned && rsi !== null) {
    const pullback = dir === "BUY" ? rsi <= 60 : rsi >= 40;
    scenario = pullback ? "TREND_PULLBACK" : "TREND_CONTINUATION";
    rule = pullback ? "TREND_WITH_PULLBACK_RSI" : "TREND_WITH_MOMENTUM";
    evidenceFor.push("STRUCTURE_ALIGNED", pullback ? "RSI_PULLBACK" : "RSI_MOMENTUM");
  } else if (structureAligned === false && (rsi !== null && ((dir === "BUY" && rsi >= 70) || (dir === "SELL" && rsi <= 30)))) {
    scenario = "REVERSAL"; rule = "STRUCTURE_AGAINST_AND_RSI_EXTREME"; evidenceAgainst.push("STRUCTURE_AGAINST_TRADER"); invalidationReasons.push("REVERSAL_RISK");
  } else if ((regime.regime === "RANGE" || regime.regime === "COMPRESSION") && pos !== null && (pos <= 0.1 || pos >= 0.9)) {
    scenario = "RANGE_REJECTION"; rule = "RANGE_EDGE_REJECTION"; evidenceFor.push("RANGE_EDGE");
  } else if ((regime.regime === "RANGE" || regime.regime === "COMPRESSION") && pos !== null && pos > 0.1 && pos < 0.9) {
    scenario = "CONSOLIDATION"; rule = "RANGE_MID_CONFLUENCE"; evidenceAgainst.push("LOCATION_MID");
  } else if (atrRatioExtreme(context) && rsi !== null && ((dir === "BUY" && rsi >= 70) || (dir === "SELL" && rsi <= 30))) {
    scenario = "EXHAUSTION"; rule = "RSI_EXTREME_WITH_VOLATILITY"; invalidationReasons.push("EXHAUSTION_RISK");
  } else if (regime.regime === "EXPANSION" && breakout) {
    scenario = "RANGE_BREAKOUT"; rule = "EXPANSION_BREAKOUT"; evidenceFor.push("EXPANSION_BREAKOUT");
  }
  if (againstATR !== null && againstATR > 2.5) invalidationReasons.push("OVEREXTENDED_AGAINST_ATR");
  if (bodyRatio !== null && bodyRatio < 0.3) evidenceAgainst.push("WEAK_BODY");
  if (adx !== null && adx < 18) evidenceAgainst.push("ADX_WEAK");
  return {
    scenario,
    primary: scenario,
    secondary: evidenceAgainst.length ? "FAILED_BREAKOUT" : null,
    evidenceFor,
    evidenceAgainst,
    invalidationReasons,
    confidence: round(Math.max(0.05, Math.min(0.95, 0.35 + 0.1 * evidenceFor.length - 0.05 * evidenceAgainst.length))),
    rule,
    states: fallbackStates(context),
  };
}

function atrRatioExtreme(context) {
  const ratio = context.volatility?.atrRatio;
  return ratio !== null && ratio !== undefined && ratio >= 2.0;
}

function fallbackStates(context = {}) {
  const dir = context.direction;
  const pos = context.location?.donchianPosition ?? null;
  const rsi = context.momentum?.rsi14 ?? null;
  const adx = context.strength?.adx14 ?? null;
  const atrRatio = context.volatility?.atrRatio ?? null;
  const streak = context.microstructure?.streak ?? null;
  return {
    structureState: context.structureLabel ?? "UNKNOWN",
    locationState: pos === null ? "UNKNOWN" : pos <= 0.1 || pos >= 0.9 ? "EDGE" : Math.abs(pos - 0.5) <= 0.15 ? "MID" : pos < 0.5 ? "LOWER_HALF" : "UPPER_HALF",
    trendState: adx === null ? "UNKNOWN" : adx >= 20 ? (context.structureLabel === "DOWN" || context.structureLabel === "LH_LL" ? "DOWN" : "UP") : "WEAK",
    momentumState: rsi === null ? "UNKNOWN" : dir === "BUY" ? (rsi >= 70 ? "OVERBOUGHT" : rsi >= 45 ? "ALIGNED" : "AGAINST") : dir === "SELL" ? (rsi <= 30 ? "OVERSOLD" : rsi <= 55 ? "ALIGNED" : "AGAINST") : "NEUTRAL",
    volatilityState: atrRatio === null ? "UNKNOWN" : atrRatio >= 2.0 ? "SPIKE" : atrRatio >= 1.3 ? "EXPANDING" : "NORMAL",
    microstructureState: streak === null ? "UNKNOWN" : streak >= 2 ? "WITH_STREAK" : streak <= -2 ? "AGAINST_STREAK" : "NEUTRAL",
    triggerState: context.triggerHint ? "PRESENT" : "ABSENT",
  };
}

function fallbackEvaluatePlaybook(playbook = PLAYBOOKS.NO_SCENARIO, context = {}, features = {}) {
  const direction = context.direction;
  const states = fallbackStates(context);
  const evidenceFor = [];
  const evidenceAgainst = [];
  const invalidationReasons = [];
  let action = "WAIT";
  if (playbook.directional === true && direction) {
    const aligned = playbook.withTrend ? states.trendState === (direction === "BUY" ? "UP" : "DOWN") : states.trendState !== "UNKNOWN";
    if (aligned) { action = direction; evidenceFor.push("PLAYBOOK_ALIGNED"); }
    else { evidenceAgainst.push("PLAYBOOK_NOT_ALIGNED"); invalidationReasons.push("PLAYBOOK_MISMATCH"); }
    if (states.momentumState === "AGAINST") { evidenceAgainst.push("MOMENTUM_AGAINST"); action = "WAIT"; }
    if (states.locationState === "EDGE" && playbook.withTrend) { evidenceAgainst.push("LOCATION_EDGE"); }
    if (states.volatilityState === "SPIKE") { evidenceAgainst.push("VOLATILITY_SPIKE"); }
  } else {
    invalidationReasons.push("PLAYBOOK_NOT_DIRECTIONAL");
  }
  return {
    playbookId: playbook.id,
    playbook: playbook.id,
    action,
    confidence: action === "WAIT" ? 0 : 0.5,
    evidenceFor,
    evidenceAgainst,
    invalidationReasons,
    rules: ["FALLBACK_PLAYBOOK_RULES"],
    featuresUsed: Object.keys(features ?? {}),
    states,
  };
}

/** Fallback deterministico do contrato congelado (usado quando `scenario-engine.mjs` ainda nao existe). */
export const FALLBACK_ENGINE = Object.freeze({
  version: "scenario-engine-fallback-v1",
  REGIMES: FALLBACK_REGIMES,
  SCENARIOS: FALLBACK_SCENARIOS,
  extractContext: fallbackExtractContext,
  classifyRegime: fallbackClassifyRegime,
  classifyScenario: fallbackClassifyScenario,
  evaluatePlaybook: fallbackEvaluatePlaybook,
  analyzeScenario(input = {}) {
    const context = fallbackExtractContext(input);
    const regime = fallbackClassifyRegime(context);
    const scenario = fallbackClassifyScenario(context, regime);
    const playbook = fallbackEvaluatePlaybook(PLAYBOOKS[scenario.scenario] ?? PLAYBOOKS.NO_SCENARIO, context, input.features ?? {});
    return {
      marketRegime: regime.regime,
      primaryScenario: scenario.scenario,
      secondaryScenario: scenario.secondary,
      scenarioEvidenceFor: scenario.evidenceFor,
      scenarioEvidenceAgainst: scenario.evidenceAgainst,
      structureState: scenario.states.structureState,
      locationState: scenario.states.locationState,
      trendState: scenario.states.trendState,
      momentumState: scenario.states.momentumState,
      volatilityState: scenario.states.volatilityState,
      microstructureState: scenario.states.microstructureState,
      triggerState: scenario.states.triggerState,
      invalidationReasons: scenario.invalidationReasons,
      action: playbook.action,
      confidence: playbook.confidence,
      featuresUsed: playbook.featuresUsed,
      rule: scenario.rule,
      regimeRule: regime.rule,
      playbook: {
        playbookId: playbook.playbookId,
        action: playbook.action,
        evidenceFor: playbook.evidenceFor,
        evidenceAgainst: playbook.evidenceAgainst,
        invalidationReasons: playbook.invalidationReasons,
        rules: playbook.rules,
      },
    };
  },
});

/* ------------------------------------------------------------------ engine loading */

let loadedEngine = null;
let engineLoadError = null;
let engineLoadPromise = null;
let engineLoadStartedAt = null;
let engineLoadResolvedAt = null;

/**
 * Dynamic import do contrato congelado. Ausencia/erro NUNCA derruba o modulo: cai no FALLBACK_ENGINE.
 * Tambem rejeita motores sem as funcoes essenciais (degrada explicitamente).
 */
export function loadScenarioEngine() {
  if (!engineLoadPromise) {
    engineLoadStartedAt = Date.now();
    engineLoadPromise = import("./scenario-engine.mjs")
      .then((module) => {
        const missing = ENGINE_CONTRACT.filter((key) => module?.[key] === undefined);
        if (typeof module?.analyzeScenario !== "function") missing.push("analyzeScenario:function");
        if (missing.length) { engineLoadError = `ENGINE_CONTRACT_INCOMPLETE:${missing.join(",")}`; return null; }
        loadedEngine = module;
        return module;
      })
      .catch((error) => { engineLoadError = String(error?.code ?? error?.message ?? error).slice(0, 160); return null; })
      .finally(() => { engineLoadResolvedAt = Date.now(); });
  }
  return engineLoadPromise;
}

/** Injeta um engine explicito (testes/pesquisa); valida o contrato minimo. */
export function attachScenarioEngine(engine) {
  if (!engine || typeof engine.analyzeScenario !== "function") throw new Error("ENGINE_CONTRACT_INCOMPLETE");
  loadedEngine = engine;
  engineLoadError = null;
  engineLoadResolvedAt = Date.now();
  return engine;
}

export function currentScenarioEngine() { return loadedEngine ?? FALLBACK_ENGINE; }

export function scenarioEngineInfo() {
  const engine = currentScenarioEngine();
  return {
    contractVersion: SCENARIO_ENGINE_CONTRACT_VERSION, contract: [...ENGINE_CONTRACT],
    mode: loadedEngine ? "SCENARIO_ENGINE" : "FALLBACK",
    version: engine.version ?? null, loadError: engineLoadError,
    loadStartedAt: engineLoadStartedAt, loadResolvedAt: engineLoadResolvedAt,
    note: loadedEngine ? "Motor puro importado de relay/scenario-engine.mjs." : "Fallback deterministico ativo; o contrato congelado sera usado assim que o modulo existir.",
  };
}

// Pre-carrega sem bloquear; nunca lanca.
void loadScenarioEngine();

/* ------------------------------------------------------------------ features + ablation */

const FEATURE_COMPONENTS = Object.freeze({
  rsi14: "rsi",
  adx14: "adx",
  plusDI: "adx",
  minusDI: "adx",
  streak: "microstructure",
  bodyRatio: "microstructure",
  upperWick: "microstructure",
  lowerWick: "microstructure",
  donchianPosition: "location",
  distanceToUpperATR: "location",
  distanceToLowerATR: "location",
  channelHigh: "location",
  channelLow: "location",
  atr: "volatility",
  atrRatio: "volatility",
});

export function resolveAblation(ablation = null) {
  const resolved = { ...DEFAULT_ABLATION };
  const requested = {};
  if (ablation && typeof ablation === "object") {
    for (const component of ABLATION_COMPONENTS) {
      if (typeof ablation[component] === "boolean") { resolved[component] = ablation[component]; requested[component] = ablation[component]; }
    }
  }
  return {
    config: resolved, requested, disabled: ABLATION_COMPONENTS.filter((component) => resolved[component] === false),
    policy: { ...ABLATION_POLICY }, mode: "RESEARCH_ONLY",
  };
}

export function buildScenarioFeatures(snapshot = {}, { direction = null, ablation = null } = {}) {
  const resolved = ablation?.config ?? resolveAblation(ablation).config;
  const structure = snapshot.structure ?? snapshot.trader?.structure ?? {};
  const location = snapshot.location ?? snapshot.trader?.location ?? {};
  const momentum = snapshot.momentum ?? snapshot.trader?.momentum ?? {};
  const strength = snapshot.strength ?? snapshot.trader?.strength ?? {};
  const volatility = snapshot.volatility ?? snapshot.trader?.volatility ?? {};
  const microstructure = snapshot.microstructure ?? snapshot.trader?.microstructure ?? {};
  const freshness = snapshot.freshness ?? {};
  const all = {
    direction: direction ?? snapshot.action ?? null,
    price: firstFinite(snapshot.price),
    structureLabel: structure.label ?? null,
    rsi14: firstFinite(momentum.rsi14),
    adx14: firstFinite(strength.adx14),
    plusDI: firstFinite(strength.plusDI),
    minusDI: firstFinite(strength.minusDI),
    streak: firstFinite(microstructure.streak),
    bodyRatio: firstFinite(microstructure.bodyRatio),
    upperWick: firstFinite(microstructure.upperWick),
    lowerWick: firstFinite(microstructure.lowerWick),
    donchianPosition: firstFinite(location.donchianPosition),
    distanceToUpperATR: firstFinite(location.distanceToUpperATR),
    distanceToLowerATR: firstFinite(location.distanceToLowerATR),
    channelHigh: firstFinite(location.channelHigh),
    channelLow: firstFinite(location.channelLow),
    atr: firstFinite(volatility.atr),
    atrRatio: firstFinite(volatility.atrRatio),
    fresh: freshness.fresh === true,
    tickAgeMs: firstFinite(freshness.tickAgeMs),
  };
  const features = {};
  const featuresUsed = [];
  for (const [key, value] of Object.entries(all)) {
    const component = FEATURE_COMPONENTS[key];
    if (component && resolved[component] === false) continue;
    features[key] = value;
    featuresUsed.push(key);
  }
  return { features, featuresUsed, ablation: resolved };
}

/* ------------------------------------------------------------------ T0 hygiene (zero leakage) */

const FORBIDDEN_KEY_PATTERN = /(result|settlement|outcome|pnl|profit|postwindow|post_window|future|expiryclose|expiry_close|broker|causal|feedable)/i;
export const FORBIDDEN_T0_KEYS = Object.freeze(["result", "settlement", "settlementPrice", "postWindow", "post_window", "futureCandles", "brokerResult", "theoreticalResult", "theoreticalPnl", "outcome", "pnl", "profit"]);
/** Alvos agendados conhecidos em T0 (planejamento, nao dados futuros) — nao sao leakage. */
const SCHEDULED_REFERENCE_PATTERN = /\.(targetEntryAt|targetExpiryAt|targetEntryAtMs|targetExpiryAtMs)=/;

function sanitizePointInTime(value, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((entry) => sanitizePointInTime(entry, depth + 1)).filter((entry) => entry !== null && entry !== undefined);
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizePointInTime(entry, depth + 1);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  return clean;
}

function deepFreeze(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value)) deepFreeze(entry, depth + 1);
  return Object.freeze(value);
}

/** Lista chaves proibidas presentes no payload (o sanitizador remove; o assert prova a ausencia). */
export function findForbiddenKeys(value, path = "t0", found = [], depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((entry, index) => findForbiddenKeys(entry, path, found, depth + 1)); return found; }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) found.push(`${path}.${key}`);
    findForbiddenKeys(entry, path, found, depth + 1);
  }
  return found;
}

/** Snapshot point-in-time do Critic: remove a conclusao do Trader e qualquer chave futura. */
export function buildCriticSnapshot(t0 = {}) {
  const clone = sanitizePointInTime(JSON.parse(JSON.stringify(t0)));
  delete clone.trader;
  delete clone.consensus;
  delete clone.action;
  delete clone.currentDecision;
  delete clone.scenarioDecision;
  delete clone.traderScenario;
  delete clone.criticScenario;
  delete clone.decision;
  if (clone.critic && typeof clone.critic === "object") {
    const { independentAction, finalRecommendation, decision, ...observable } = clone.critic;
    clone.critic = observable;
  }
  return deepFreeze(clone);
}

/* ------------------------------------------------------------------ independent critic (2 phases) */

/**
 * FASE 1 — Critic independente: analisa o T0 SEM a conclusao do Trader e congela (hash + timestamp).
 */
export function runCriticPhase1({ snapshotT0 = {}, engine = null, ablation = null, now = () => Date.now(), marketKey = null, direction = null } = {}) {
  const resolvedEngine = engine ?? currentScenarioEngine();
  const criticSnapshot = buildCriticSnapshot(snapshotT0);
  const features = buildScenarioFeatures(criticSnapshot, { direction, ablation });
  const input = {
    phase: "PHASE1_INDEPENDENT",
    snapshot: criticSnapshot,
    marketKey: marketKey ?? snapshotT0.marketKey ?? null,
    marketType: snapshotT0.marketType ?? null,
    direction,
    features: features.features,
    featuresUsed: features.featuresUsed,
    ablation: features.ablation,
    traderConclusionVisible: false,
  };
  const analysis = analyzeWithEngine(resolvedEngine, input);
  const frozenAt = now();
  const frozenHash = sha256Hex(analysis);
  const frozen = deepFreeze({
    phase: "PHASE1_INDEPENDENT", analysis, frozenHash, frozenAt,
    inputKeys: Object.keys(input).sort(),
    criticSawTraderConclusion: false,
    engineMode: resolvedEngine === FALLBACK_ENGINE ? "FALLBACK" : "SCENARIO_ENGINE",
  });
  return frozen;
}

function analyzeWithEngine(engine, input) {
  let raw = null;
  if (typeof engine?.analyzeScenario === "function") {
    try { raw = engine.analyzeScenario(input); } catch (error) { raw = { __engineError: String(error?.message ?? error).slice(0, 160) }; }
  } else if (typeof engine?.extractContext === "function" && typeof engine?.classifyRegime === "function" && typeof engine?.classifyScenario === "function") {
    try {
      const context = engine.extractContext(input);
      const regime = engine.classifyRegime(context);
      const scenario = engine.classifyScenario(context, regime);
      const playbook = typeof engine.evaluatePlaybook === "function" ? engine.evaluatePlaybook(PLAYBOOKS[scenario?.scenario ?? scenario?.primary] ?? PLAYBOOKS.NO_SCENARIO, context, input.features) : {};
      raw = { ...scenario, marketRegime: regime?.regime ?? regime?.primary ?? null, action: playbook?.action ?? "WAIT", playbook, featuresUsed: context?.featuresUsed ?? input.featuresUsed };
    } catch (error) { raw = { __engineError: String(error?.message ?? error).slice(0, 160) }; }
  }
  if (!raw || typeof raw === "object" && typeof raw.then === "function") raw = { __engineError: "ENGINE_ASYNC_OR_INVALID" };
  return normalizeAnalysis(raw, input);
}

export function normalizeAnalysis(raw = {}, input = {}) {
  const engineError = raw?.__engineError ?? null;
  const fallback = engineError ? FALLBACK_ENGINE.analyzeScenario(input) : null;
  const source = fallback ?? raw;
  return {
    marketRegime: source.marketRegime ?? source.regime ?? "UNKNOWN",
    primaryScenario: source.primaryScenario ?? source.scenario ?? "NO_SCENARIO",
    secondaryScenario: source.secondaryScenario ?? null,
    scenarioEvidenceFor: Array.isArray(source.scenarioEvidenceFor) ? source.scenarioEvidenceFor.map(String) : [],
    scenarioEvidenceAgainst: Array.isArray(source.scenarioEvidenceAgainst) ? source.scenarioEvidenceAgainst.map(String) : [],
    structureState: source.structureState ?? "UNKNOWN",
    locationState: source.locationState ?? "UNKNOWN",
    trendState: source.trendState ?? "UNKNOWN",
    momentumState: source.momentumState ?? "UNKNOWN",
    volatilityState: source.volatilityState ?? "UNKNOWN",
    microstructureState: source.microstructureState ?? "UNKNOWN",
    triggerState: source.triggerState ?? "UNKNOWN",
    invalidationReasons: Array.isArray(source.invalidationReasons) ? source.invalidationReasons.map(String) : [],
    action: FINAL_ACTIONS.includes(source.action) ? source.action : "WAIT",
    confidence: num(source.confidence),
    featuresUsed: Array.isArray(source.featuresUsed) ? source.featuresUsed.map(String) : [...(input.featuresUsed ?? [])],
    rejectionPriors: Array.isArray(source.rejectionPriors) ? source.rejectionPriors.map(String) : [],
    rule: source.rule ?? null,
    playbook: source.playbook ?? null,
    engineError,
    degradedToFallback: Boolean(engineError),
  };
}

/* ------------------------------------------------------------------ divergence resolution (investigation) */

/** Evidencia explicita exigida para resolver divergencia; undefined = nao observado (conservador). */
export function extractResolutionEvidence({ snapshot = {}, features = {}, direction = null } = {}) {
  const microstructure = snapshot.microstructure ?? snapshot.trader?.microstructure ?? {};
  const momentum = snapshot.momentum ?? snapshot.trader?.momentum ?? {};
  const freshness = snapshot.freshness ?? {};
  const evidence = snapshot.evidence ?? {};
  const location = snapshot.location ?? snapshot.trader?.location ?? {};
  const hold = evidence.holdAboveLevel;
  const reEntry = evidence.reEntry;
  const rejectionWick = evidence.rejectionWick;
  const upperWick = firstFinite(microstructure.upperWick, features.upperWick);
  const lowerWick = firstFinite(microstructure.lowerWick, features.lowerWick);
  const adverseWick = direction === "BUY" ? upperWick : direction === "SELL" ? lowerWick : null;
  const rsi = firstFinite(momentum.rsi14, features.rsi14);
  const velocity = firstFinite(momentum.velocity, features.velocity);
  const momentumAligned = direction === "BUY"
    ? (rsi !== null && rsi >= 45 && (velocity === null || velocity >= 0))
    : direction === "SELL" ? (rsi !== null && rsi <= 55 && (velocity === null || velocity <= 0)) : false;
  const tickAgeMs = firstFinite(freshness.tickAgeMs, features.tickAgeMs);
  const freshFlag = freshness.fresh === true || evidence.ticksFresh === true;
  const ticksFresh = freshFlag || (tickAgeMs !== null && tickAgeMs <= 15_000);
  const againstATR = direction === "BUY" ? firstFinite(location.distanceToLowerATR, features.distanceToLowerATR) : direction === "SELL" ? firstFinite(location.distanceToUpperATR, features.distanceToUpperATR) : null;
  const pos = firstFinite(location.donchianPosition, features.donchianPosition);
  const locationOk = !(againstATR !== null && againstATR > 2.5) && !(pos !== null && Math.abs(pos - 0.5) <= 0.05);
  return {
    holdAboveLevel: typeof hold === "boolean" ? hold : undefined,
    reEntry: typeof reEntry === "boolean" ? reEntry : undefined,
    noRejectionWick: typeof rejectionWick === "boolean" ? !rejectionWick : adverseWick === null ? undefined : adverseWick <= 0.55,
    momentumAligned,
    ticksFresh,
    locationOk,
    adverseWick,
    againstATR,
  };
}

/**
 * Taxonomia da divergencia: NUNCA votacao. Investiga pontos exatos e retorna WAIT quando falta evidencia.
 * A direcao do Critic jamais e adotada: o resultado e a direcao do Trader ou WAIT.
 */
export function resolveScenarioDivergence({ trader = null, critic = null, snapshot = {}, features = {}, resolutionEvidence = null } = {}) {
  const traderAction = trader?.action ?? "WAIT";
  const criticAction = critic?.action ?? "WAIT";
  const traderScenario = trader?.primaryScenario ?? "NO_SCENARIO";
  const criticScenario = critic?.primaryScenario ?? "NO_SCENARIO";
  const regimeAgreement = trader?.marketRegime === critic?.marketRegime;
  const scenarioAgreement = traderScenario === criticScenario;
  const actionAgreement = traderAction === criticAction;
  const evidence = resolutionEvidence ?? extractResolutionEvidence({ snapshot, features, direction: traderAction });
  const satisfied = RESOLUTION_POINTS.filter((point) => evidence[point] === true);
  const known = RESOLUTION_POINTS.filter((point) => evidence[point] !== undefined);
  const missing = RESOLUTION_POINTS.filter((point) => evidence[point] === undefined);
  const base = {
    divergence: "SAME",
    scenarioAgreement,
    actionAgreement,
    regimeAgreement,
    traderScenario,
    criticScenario,
    traderAction,
    criticAction,
    investigation: false,
    resolutionPoints: evidence,
    resolutionSatisfied: satisfied,
    resolutionKnown: known,
    resolutionMissing: missing,
    resolutionRule: `RESOLVE_TRADER_DIRECTION_ONLY_WITH_>=${MIN_RESOLUTION_EVIDENCE}/6_EXPLICIT_EVIDENCE`,
    directionFlipForbidden: true,
    adoptedDirection: null,
  };
  if (scenarioAgreement && actionAgreement) return { ...base, finalAction: traderAction, reasonsForWait: [] };
  if (directionOpposite(traderAction, criticAction)) {
    const needed = MIN_OPPOSITE_DIRECTION_EVIDENCE;
    if (satisfied.length >= needed && missing.length === 0) return { ...base, divergence: "DIRECTION_OPPOSITE", investigation: true, finalAction: traderAction, reasonsForWait: [] };
    return { ...base, divergence: "DIRECTION_OPPOSITE", investigation: true, finalAction: "WAIT", reasonsForWait: ["DIRECTION_OPPOSITE_INVESTIGATION", `EVIDENCE_${satisfied.length}_OF_${needed}`, "NEVER_ADOPT_CRITIC_DIRECTION"] };
  }
  if (!regimeAgreement) return { ...base, divergence: "REGIME_MISMATCH", investigation: true, finalAction: "WAIT", reasonsForWait: ["REGIME_MISMATCH_INVESTIGATION", "DIRECTION_FLIP_FORBIDDEN"] };
  if (traderAction !== "WAIT" && criticAction === "WAIT") {
    if (satisfied.length >= MIN_RESOLUTION_EVIDENCE) return { ...base, divergence: "TRADER_ENTRY_CRITIC_WAIT", investigation: true, finalAction: traderAction, reasonsForWait: [] };
    return { ...base, divergence: "TRADER_ENTRY_CRITIC_WAIT", investigation: true, finalAction: "WAIT", reasonsForWait: ["CRITIC_WAIT_INCONCLUSIVE", `EVIDENCE_${satisfied.length}_OF_${MIN_RESOLUTION_EVIDENCE}`, ...missing.map((point) => `MISSING_${point}`)] };
  }
  if (traderAction === "WAIT" && criticAction !== "WAIT") {
    return { ...base, divergence: "TRADER_WAIT_CRITIC_ENTRY", investigation: true, finalAction: "WAIT", reasonsForWait: ["TRADER_WAIT_NEVER_PROMOTED", "NEVER_ADOPT_CRITIC_ENTRY"] };
  }
  if (!scenarioAgreement) {
    return { ...base, divergence: "SAME_DIRECTION_SCENARIO_MISMATCH", investigation: true, finalAction: satisfied.length >= MIN_RESOLUTION_EVIDENCE ? traderAction : "WAIT", reasonsForWait: satisfied.length >= MIN_RESOLUTION_EVIDENCE ? [] : ["SCENARIO_MISMATCH_INCONCLUSIVE", `EVIDENCE_${satisfied.length}_OF_${MIN_RESOLUTION_EVIDENCE}`] };
  }
  return { ...base, finalAction: "WAIT", reasonsForWait: ["INSUFFICIENT_EVIDENCE"] };
}

function directionOpposite(a, b) {
  return (a === "BUY" && b === "SELL") || (a === "SELL" && b === "BUY");
}

/* ------------------------------------------------------------------ late window coupling */

/** Acopla a observacao ao LATE_WINDOW_V2 (mesma expiracao, deadline real). Somente leitura. */
export function coupleLateWindow({ targetExpiryAt = null, productKind = "turbo", marginMs = undefined, timingPolicyVersion = null } = {}) {
  const window = sameExpirationWindow({ targetExpiryAt, productKind });
  const deadlineAt = window.supported ? lateDeadlineAt({ targetExpiryAt, marginMs: marginMs ?? 1_000, productKind }) : null;
  return {
    timingPolicyVersion: TIMING_POLICY_LATE,
    currentTimingPolicyVersion: TIMING_POLICY_CURRENT,
    requestedTimingPolicyVersion: timingPolicyVersion ?? TIMING_POLICY_LATE,
    window, deadlineAt, supported: window.supported, reason: window.reason ?? null,
    execution: "SHADOW_ONLY", controlsExecution: false,
  };
}

/**
 * FINAL REVALIDATION: se o cenario mudou invalidando a tese, cancela (WAIT).
 * NUNCA mantem decisao antiga e NUNCA inverte a direcao (CALL invalidada nao vira PUT).
 */
export function evaluateFinalRevalidation({ observation = {}, analysis = null, atMs = null, deadlineAt = null } = {}) {
  const previousScenario = observation?.traderScenario?.primaryScenario ?? observation?.persistence?.scenarioAtRevalidation1 ?? observation?.persistence?.scenarioAtCandidate ?? null;
  const previousAction = observation?.currentDecision?.action ?? observation?.direction ?? null;
  const nextScenario = analysis?.primaryScenario ?? null;
  const nextAnalysisAction = analysis?.action ?? null;
  const scenarioChanged = previousScenario !== null && nextScenario !== null && previousScenario !== nextScenario;
  const invalidatingScenarios = new Set(["FAILED_BREAKOUT", "EXHAUSTION", "NO_SCENARIO", "REVERSAL"]);
  const invalidationReasons = Array.isArray(analysis?.invalidationReasons) ? analysis.invalidationReasons : [];
  const thesisInvalidated = scenarioChanged && invalidatingScenarios.has(nextScenario);
  const directionFlipped = nextAnalysisAction !== null && (previousAction === "BUY" || previousAction === "SELL") && (nextAnalysisAction === "BUY" || nextAnalysisAction === "SELL") && nextAnalysisAction !== previousAction;
  const afterDeadline = deadlineAt !== null && atMs !== null && Number(atMs) > Number(deadlineAt);
  if (afterDeadline) {
    return {
      finalAction: null, cancelled: false, scenarioChanged, thesisInvalidated: false, directionFlipped: false,
      directionFlipAttempted: directionFlipped, afterDeadline: true, reason: "AFTER_DEADLINE_DIAGNOSTIC_ONLY",
      reasonsForWait: ["AFTER_DEADLINE_DIAGNOSTIC_ONLY"], note: "Avaliacao pos-deadline nunca decide (LATE_WINDOW_V2).",
    };
  }
  if (thesisInvalidated || directionFlipped) {
    return {
      finalAction: "WAIT", cancelled: true, scenarioChanged, thesisInvalidated,
      directionFlipped, directionFlipAttempted: directionFlipped, afterDeadline: false,
      reason: thesisInvalidated ? "SCENARIO_INVALIDATED_AT_FINAL_REVALIDATION" : "DIRECTION_CHANGE_FORCED_WAIT",
      reasonsForWait: [
        ...(thesisInvalidated ? [`SCENARIO_${nextScenario}_INVALIDATES_${previousScenario}`] : []),
        ...(directionFlipped ? ["DIRECTION_CHANGE_FORCED_WAIT_NEVER_FLIP"] : []),
        ...invalidationReasons,
      ],
      note: "Cancelamento SHADOW: nunca mantem decisao antiga e nunca vira a direcao oposta.",
    };
  }
  return {
    finalAction: nextAnalysisAction, cancelled: false, scenarioChanged, thesisInvalidated: false, directionFlipped: false,
    directionFlipAttempted: false, afterDeadline: false, reason: null, reasonsForWait: [],
  };
}

/* ------------------------------------------------------------------ observation builder */

export function scenarioObservationKey({ candidateId = null, executionId = null, tradeId = null, marketKey = null, targetExpiryAt = null } = {}) {
  if (candidateId) return `scenario_${candidateId}`;
  if (executionId) return `scenario_${executionId}`;
  if (tradeId) return `scenario_${tradeId}`;
  return `scenario_${marketKey ?? "UNKNOWN"}_${targetExpiryAt ?? "na"}`;
}

function solutionEvidenceFromSnapshot(snapshot, direction, features) {
  return extractResolutionEvidence({ snapshot, features, direction });
}

/**
 * `runScenarioShadow({ snapshotT0, traderView, criticView })` — observacao SHADOW completa.
 * Retorna `currentDecision` (G2 real, intocado), `scenarioDecision`, `traderScenario`, `criticScenario`,
 * `agreement` e o outcome posterior quando existir (marcado OUTCOME, nunca usado na classificacao).
 */
export function runScenarioShadow({
  snapshotT0 = null, snapshot = null, traderView = {}, criticView = {},
  marketKey = null, marketType = null, activeId = null, agentId = null,
  candidateId = null, correlationId = null, executionId = null, tradeId = null,
  direction = null, payout = null, provenance = "PROSPECTIVE",
  candidateAt = null, decisionAt = null, jitAt = null, finalEntryAt = null, targetEntryAt = null, targetExpiryAt = null,
  quality = null, location = null, momentum = null, currentDecision = null,
  lateWindow = null, timingPolicyVersion = null, ablation = null, engine = null, now = () => Date.now(),
  executionGate = null,
} = {}) {
  const resolvedEngine = engine ?? currentScenarioEngine();
  const t0 = snapshotT0 && typeof snapshotT0 === "object" && Object.isFrozen(snapshotT0) ? snapshotT0 : buildT0Snapshot({
    marketKey, marketType, activeId, agentId, direction,
    candidateAt, decisionAt, jitAt, sendAt: jitAt, entryAt: finalEntryAt, targetEntryAt, targetExpiryAt, payout,
    snapshot: snapshot ?? {}, quality, location: location ?? null, displacement: null, revalidation: null,
  });
  const t0AsOfMs = firstFinite(decisionAt, jitAt, candidateAt, t0.decisionAt, t0.candidateAt, now());
  const futureReferences = findFutureReferences(t0, t0AsOfMs).filter((reference) => !SCHEDULED_REFERENCE_PATTERN.test(reference));
  const forbiddenKeys = findForbiddenKeys(t0);
  const ablationPlan = resolveAblation(ablation);
  const dir = direction ?? traderView?.action ?? t0.direction ?? null;

  // FASE 1 — Critic independente, congelado ANTES de ver o Trader.
  const criticFreeze = runCriticPhase1({ snapshotT0: t0, engine: resolvedEngine, ablation: ablationPlan, now, marketKey, direction: dir });
  // FASE 2 — somente agora a analise do Trader e computada.
  const traderSnapshot = sanitizePointInTime({ ...(t0 ?? {}), trader: traderView ?? null });
  const features = buildScenarioFeatures({ ...t0, ...traderSnapshot, momentum: momentum ?? t0.momentum }, { direction: dir, ablation: ablationPlan });
  const traderInput = {
    phase: "PHASE2_TRADER", snapshot: traderSnapshot, marketKey, marketType, direction: dir,
    features: features.features, featuresUsed: features.featuresUsed, ablation: ablationPlan.config,
    traderConclusionVisible: true,
  };
  const traderAnalysis = analyzeWithEngine(resolvedEngine, traderInput);
  const traderScenario = { ...traderAnalysis, featuresUsed: traderAnalysis.featuresUsed.length ? traderAnalysis.featuresUsed : features.featuresUsed };
  const criticScenario = criticFreeze.analysis;

  // Comparacao (fase 2) — investigacao, nunca votacao.
  const resolutionEvidence = solutionEvidenceFromSnapshot(t0, traderScenario.action, features.features);
  const divergence = resolveScenarioDivergence({ trader: traderScenario, critic: criticScenario, snapshot: t0, features: features.features, resolutionEvidence });
  const agreement = divergence.scenarioAgreement && divergence.actionAgreement;
  const decision = currentDecision ?? traderView?.currentDecision ?? traderView?.consensus?.action ?? t0?.consensus?.action ?? traderView?.action ?? null;
  const late = lateWindow ?? coupleLateWindow({ targetExpiryAt, timingPolicyVersion });
  const scenarioAction = divergence.finalAction ?? "WAIT";
  const reasonsForWait = sceneReasons({ divergence, critic: criticScenario, scenarioAction });

  const observation = {
    id: scenarioObservationKey({ candidateId, executionId, tradeId, marketKey, targetExpiryAt }),
    version: SCENARIO_SHADOW_VERSION, kind: SCENARIO_SHADOW_KIND, provenance,
    scenarioPolicyVersion: SCENARIO_ENGINE_V3_SHADOW, currentPolicyVersion: CURRENT_G2,
    timingPolicyVersion: late.timingPolicyVersion ?? TIMING_POLICY_LATE,
    marketKey, marketType, activeId, agentId, candidateId, correlationId, executionId, tradeId,
    direction: dir, payout: num(payout),
    candidateAt, decisionAt, jitAt, finalEntryAt, targetEntryAt, targetExpiryAt,
    currentDecision: { action: decision, source: "CURRENT_G2", altered: false, controlsExecution: "UNCHANGED", reason: traderView?.waitReason ?? null },
    scenarioDecision: {
      action: scenarioAction, source: SCENARIO_ENGINE_V3_SHADOW, divergence: divergence.divergence,
      investigation: divergence.investigation, directionFlipForbidden: true,
      adoptedDirection: divergence.finalAction === "BUY" || divergence.finalAction === "SELL" ? divergence.finalAction : null,
      reasonsForWait, resolutionRule: divergence.resolutionRule, evidence: divergence.resolutionPoints,
      note: "Decisao SHADOW; nunca executada e nunca comparada como voto.",
    },
    traderScenario, criticScenario,
    criticFreeze: { frozenHash: criticFreeze.frozenHash, frozenAt: criticFreeze.frozenAt, phase: criticFreeze.phase, criticSawTraderConclusion: false, engineMode: criticFreeze.engineMode },
    comparison: {
      scenarioAgreement: divergence.scenarioAgreement, actionAgreement: divergence.actionAgreement, regimeAgreement: divergence.regimeAgreement,
      divergence: divergence.divergence, investigation: divergence.investigation,
      points: {
        traderScenario: divergence.traderScenario, criticScenario: divergence.criticScenario,
        traderAction: divergence.traderAction, criticAction: divergence.criticAction,
      },
      resolutionSatisfied: divergence.resolutionSatisfied, resolutionKnown: divergence.resolutionKnown, resolutionMissing: divergence.resolutionMissing,
      adoptedDirection: divergence.finalAction, directionFlipForbidden: true,
    },
    agreement,
    divergence,
    persistence: {
      scenarioAtCandidate: trajectoryPoint({ trader: traderScenario, quality, location, momentum, stage: "CANDIDATE", at: candidateAt }),
      scenarioAtRevalidation1: null, scenarioAtRevalidation2: null, scenarioAtFinalEntry: null,
      scenarioChanged: false, scenarioChangeCount: 0,
      regimeTimeline: [regimePoint(traderScenario, "CANDIDATE", candidateAt)],
      directionTimeline: [directionPoint(traderScenario, dir, "CANDIDATE", candidateAt)],
      criticTimeline: [criticPoint(criticScenario, "CANDIDATE", criticFreeze.frozenAt)],
      qualityTimeline: [qualityPoint(quality, "CANDIDATE", candidateAt)],
      locationTimeline: [locationPoint(location ?? t0.location, "CANDIDATE", candidateAt)],
      momentumTimeline: [momentumPoint(momentum ?? t0.momentum, "CANDIDATE", candidateAt)],
      playbookAtCandidate: playbookOf(criticScenario),
      playbookAtEntry: null,
      transitions: [{ at: candidateAt, from: null, to: traderScenario.primaryScenario, stage: "CANDIDATE", source: "TRADER" }],
    },
    stages: [{ stage: "CANDIDATE", at: candidateAt, action: traderScenario.action, scenario: traderScenario.primaryScenario, regime: traderScenario.marketRegime, hash: sha256Hex(traderScenario) }],
    transitions: [{ at: candidateAt, from: null, to: traderScenario.primaryScenario, stage: "CANDIDATE" }],
    lateWindow: late,
    ablation: { config: ablationPlan.config, disabled: ablationPlan.disabled, policy: ablationPlan.policy, featuresUsed: traderScenario.featuresUsed },
    featuresUsed: traderScenario.featuresUsed,
    evidenceFor: traderScenario.scenarioEvidenceFor, evidenceAgainst: traderScenario.scenarioEvidenceAgainst,
    reasonsForWait,
    t0,
    t0Integrity: {
      asOfMs: t0AsOfMs, futureReferences, forbiddenKeys,
      clean: futureReferences.length === 0 && forbiddenKeys.length === 0,
      postWindowFeedable: false, outcomeFeedableToClassification: false,
    },
    currentCritic: criticView && Object.keys(criticView).length ? { assessment: criticView.traderAssessment ?? criticView.action ?? null, contradictions: criticView.contradictions ?? [], riskFlags: criticView.riskFlags ?? [] } : null,
    engineInfo: { ...scenarioEngineInfo(), criticPhase: "PHASE1_FROZEN_BEFORE_TRADER", traderPhase: "PHASE2_COMPARISON" },
    outcome: null, outcomeAt: null, outcomeUsedInClassification: false,
    settlementBasis: null, brokerResult: null, brokerProfit: null, theoreticalResult: null, theoreticalPnl: null,
    status: "CLASSIFIED", finalAction: scenarioAction, cancelReason: null,
    createdAt: now(), updatedAt: now(),
    executionGateCalled: false,
  };
  if (typeof executionGate === "function") { /* NUNCA chamado: prova em teste. */ }
  deepFreeze(observation.t0);
  deepFreeze(observation.criticScenario);
  deepFreeze(observation.criticFreeze);
  deepFreeze(observation.comparison);
  deepFreeze(observation.divergence);
  return observation;
}

function sceneReasons({ divergence, critic, scenarioAction }) {
  if (scenarioAction !== "WAIT") return [];
  const reasons = [...(divergence.reasonsForWait ?? [])];
  if (!reasons.length && critic.action === "WAIT") reasons.push("CRITIC_WAIT");
  if (!reasons.length) reasons.push("NO_VALID_SCENARIO");
  return [...new Set(reasons)];
}

function trajectoryPoint({ trader, quality, location, momentum, stage, at }) {
  return {
    stage, at, scenario: trader?.primaryScenario ?? null, action: trader?.action ?? null, regime: trader?.marketRegime ?? null,
    playbook: playbookOf(trader), confidence: trader?.confidence ?? null,
    quality: firstFinite(quality?.score, quality?.qualityScore), location: locationTag(location), momentum: momentumTag(momentum),
  };
}

export function playbookOf(analysis) {
  if (!analysis) return null;
  if (typeof analysis.playbook === "string") return analysis.playbook;
  if (analysis.playbook?.playbookId) return analysis.playbook.playbookId;
  if (analysis.playbookId) return analysis.playbookId;
  const scenario = analysis.primaryScenario ?? analysis.scenario ?? null;
  return scenario && PLAYBOOKS[scenario] ? PLAYBOOKS[scenario].id : null;
}

function locationTag(location) {
  if (!location || typeof location !== "object") return null;
  if (location.tag) return location.tag;
  const pos = firstFinite(location.donchianPosition);
  if (pos === null) return null;
  return pos <= 0.1 || pos >= 0.9 ? "LOCATION_EDGE" : Math.abs(pos - 0.5) <= 0.15 ? "LOCATION_MID" : pos < 0.5 ? "LOCATION_LOWER_HALF" : "LOCATION_UPPER_HALF";
}

function momentumTag(momentum) {
  const rsi = firstFinite(momentum?.rsi14, momentum?.rsi);
  return rsi === null ? null : rsi >= 70 ? "RSI_OVERBOUGHT" : rsi <= 30 ? "RSI_OVERSOLD" : "RSI_NEUTRAL";
}

function qualityTag(quality) {
  const score = firstFinite(quality?.score, quality?.qualityScore);
  return score === null ? null : score >= 75 ? "QUALITY_ACCEPT" : "QUALITY_BELOW_THRESHOLD";
}

function criticTag(analysis) {
  if (!analysis) return null;
  return `${analysis.primaryScenario}:${analysis.action}`;
}

function regimePoint(analysis, stage, at) { return { stage, at, value: analysis?.marketRegime ?? null }; }
function directionPoint(analysis, direction, stage, at) { return { stage, at, value: direction ?? analysis?.action ?? null }; }
function criticPoint(analysis, stage, at) { return { stage, at, value: criticTag(analysis), scenario: analysis?.primaryScenario ?? null, action: analysis?.action ?? null }; }
function qualityPoint(quality, stage, at) { return { stage, at, value: qualityTag(quality), score: firstFinite(quality?.score, quality?.qualityScore) }; }
function locationPoint(location, stage, at) { return { stage, at, value: locationTag(location) }; }
function momentumPoint(momentum, stage, at) { return { stage, at, value: momentumTag(momentum), rsi: firstFinite(momentum?.rsi14, momentum?.rsi) }; }

/* ------------------------------------------------------------------ persistence + lifecycle */

const OBSERVATION_SELECT = `SELECT observation_id, version, scenario_policy_version, current_policy_version, timing_policy_version, kind, provenance,
  market_key, market_type, active_id, agent_id, candidate_id, correlation_id, execution_id, trade_id,
  candidate_at, decision_at, jit_at, final_entry_at, target_entry_at, target_expiry_at, direction, payout,
  t0, current_decision, scenario_decision, trader_scenario, critic_scenario, agreement, divergence, persistence,
  ablation, stages, transitions, final_action, reasons_for_wait, t0_integrity, engine_info,
  outcome, settlement_basis, broker_result, broker_profit, theoretical_result, theoretical_pnl, created_at, updated_at
  FROM iq_scenario_shadow_observations`;

function fromDbMs(value) { return value === null || value === undefined ? null : value instanceof Date ? value.getTime() : Date.parse(value); }

function rowToObservation(row) {
  if (!row) return null;
  return {
    id: row.observation_id, version: row.version, kind: row.kind, provenance: row.provenance,
    scenarioPolicyVersion: row.scenario_policy_version, currentPolicyVersion: row.current_policy_version, timingPolicyVersion: row.timing_policy_version,
    marketKey: row.market_key, marketType: row.market_type, activeId: row.active_id, agentId: row.agent_id,
    candidateId: row.candidate_id, correlationId: row.correlation_id, executionId: row.execution_id, tradeId: row.trade_id,
    candidateAt: fromDbMs(row.candidate_at), decisionAt: fromDbMs(row.decision_at), jitAt: fromDbMs(row.jit_at), finalEntryAt: fromDbMs(row.final_entry_at),
    targetEntryAt: fromDbMs(row.target_entry_at), targetExpiryAt: fromDbMs(row.target_expiry_at), direction: row.direction, payout: row.payout,
    currentDecision: row.current_decision ?? null, scenarioDecision: row.scenario_decision ?? null,
    traderScenario: row.trader_scenario ?? null, criticScenario: row.critic_scenario ?? null,
    agreement: row.agreement === true, divergence: row.divergence ?? null, persistence: row.persistence ?? null,
    ablation: row.ablation ?? null, stages: row.stages ?? [], transitions: row.transitions ?? [],
    finalAction: row.final_action ?? null, reasonsForWait: row.reasons_for_wait ?? [],
    t0: row.t0 ?? {}, t0Integrity: row.t0_integrity ?? null, engineInfo: row.engine_info ?? null,
    outcome: row.outcome ?? null, settlementBasis: row.settlement_basis ?? null, brokerResult: row.broker_result ?? null, brokerProfit: row.broker_profit ?? null,
    theoreticalResult: row.theoretical_result ?? null, theoreticalPnl: row.theoretical_pnl ?? null,
    createdAt: fromDbMs(row.created_at), updatedAt: fromDbMs(row.updated_at),
    status: row.outcome ? "SETTLED" : row.finalAction === "WAIT" ? "WAIT" : "CLASSIFIED",
    cancelReason: row.scenario_decision?.cancelled === true ? row.scenario_decision?.reason ?? null : null,
    persistState: "LOADED",
  };
}

export class ScenarioShadow {
  constructor({ pool = null, store = null, engine = null, now = () => Date.now(), log = () => {}, maxInMemory = 1_000 } = {}) {
    this.pool = pool;
    this.store = store;
    this.engine = engine;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxInMemory = maxInMemory;
    this.observations = new Map();
    this.byMarket = new Map();
    this.byCandidate = new Map();
    this.persist = { attempts: 0, failures: 0, lastError: null, lastOkAt: null };
  }

  #remember(observation) {
    this.observations.set(observation.id, observation);
    if (observation.marketKey) {
      const list = (this.byMarket.get(observation.marketKey) ?? []).filter((row) => row.id !== observation.id);
      list.push(observation);
      this.byMarket.set(observation.marketKey, list.slice(-this.maxInMemory));
    }
    if (observation.candidateId) this.byCandidate.set(observation.candidateId, observation.id);
    if (this.observations.size > this.maxInMemory) {
      const oldest = [...this.observations.values()].filter((row) => row.status === "SETTLED").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
      if (oldest) this.observations.delete(oldest.id);
    }
  }

  list() { return [...this.observations.values()]; }
  get(id) { return this.observations.get(id) ?? null; }
  getByCandidate(candidateId) { const id = this.byCandidate.get(candidateId); return id ? this.observations.get(id) ?? null : null; }
  observationsForMarket(marketKey) { return this.byMarket.get(marketKey) ?? []; }
  resetInMemory() { this.observations.clear(); this.byMarket.clear(); this.byCandidate.clear(); }

  /** Observacao SHADOW (2 fases) + persistencia best-effort. Nunca derruba o runtime. */
  observe(input = {}) {
    const observation = runScenarioShadow({ ...input, engine: input.engine ?? this.engine, now: input.now ?? this.now });
    this.#remember(observation);
    observation.persistPromise = this.#persistInsert(observation);
    this.#safeLog("SCENARIO_SHADOW_OBSERVE", { id: observation.id, marketKey: observation.marketKey, agreement: observation.agreement, finalAction: observation.finalAction, divergence: observation.divergence?.divergence });
    return observation;
  }

  /**
   * Registro imutavel de estagio (CANDIDATE/REVALIDATION_1/REVALIDATION_2/FINAL_ENTRY).
   * Append-only: T0 nunca e sobrescrito; campos de sequencia sao consultaveis.
   */
  recordStage({ observationId = null, candidateId = null, stage, analysis = {}, quality = null, location = null, momentum = null, atMs = null, source = "SCENARIO_ENGINE" } = {}) {
    const observation = observationId ? this.get(observationId) : this.getByCandidate(candidateId);
    if (!observation) return null;
    if (!SCENARIO_STAGES.includes(stage)) return null;
    const at = atMs ?? this.now();
    const point = trajectoryPoint({ trader: analysis, quality, location, momentum, stage, at });
    const previous = observation.stages[observation.stages.length - 1] ?? null;
    const scenarioChanged = previous !== null && previous.scenario !== point.scenario;
    const stageEntry = {
      stage, at, source, action: analysis?.action ?? null, scenario: point.scenario, regime: analysis?.marketRegime ?? null,
      playbook: playbookOf(analysis), confidence: analysis?.confidence ?? null,
      changedFromPrevious: scenarioChanged, previousScenario: previous?.scenario ?? null,
      hash: sha256Hex(analysis ?? {}), featuresUsed: analysis?.featuresUsed ?? [],
    };
    const stageIndex = observation.stages.findIndex((row) => row.stage === stage);
    if (stageIndex >= 0) observation.stages = observation.stages.map((row, index) => (index === stageIndex ? stageEntry : row));
    else observation.stages = [...observation.stages, stageEntry];
    observation.persistence = {
      ...observation.persistence,
      [STAGE_TO_FIELD[stage]]: point,
      scenarioChanged: observation.persistence.scenarioChanged === true || scenarioChanged,
      scenarioChangeCount: (observation.persistence.scenarioChangeCount ?? 0) + (scenarioChanged ? 1 : 0),
      regimeTimeline: appendTimeline(observation.persistence.regimeTimeline, regimePoint(analysis, stage, at)),
      directionTimeline: appendTimeline(observation.persistence.directionTimeline, directionPoint(analysis, observation.direction, stage, at)),
      criticTimeline: appendTimeline(observation.persistence.criticTimeline, criticPoint(observation.criticScenario, stage, at)),
      qualityTimeline: appendTimeline(observation.persistence.qualityTimeline, qualityPoint(quality, stage, at)),
      locationTimeline: appendTimeline(observation.persistence.locationTimeline, locationPoint(location, stage, at)),
      momentumTimeline: appendTimeline(observation.persistence.momentumTimeline, momentumPoint(momentum, stage, at)),
      playbookAtEntry: stage === "FINAL_ENTRY" ? playbookOf(analysis) : observation.persistence.playbookAtEntry ?? null,
      transitions: appendTimeline(observation.persistence.transitions, { at, from: previous?.scenario ?? null, to: point.scenario, stage, changed: scenarioChanged }),
    };
    observation.transitions = [...observation.transitions, { at, from: previous?.scenario ?? null, to: point.scenario, stage, changed: scenarioChanged }];
    if (stage === "FINAL_ENTRY") observation.finalEntryAt = at;
    observation.updatedAt = at;
    void this.#persistUpdate(observation, { force: true });
    return {
      observationId: observation.id, stage, at, scenario: point.scenario, scenarioChanged,
      scenarioChangeCount: observation.persistence.scenarioChangeCount,
      playbookAtCandidate: observation.persistence.playbookAtCandidate, playbookAtEntry: observation.persistence.playbookAtEntry,
    };
  }

  /**
   * FINAL REVALIDATION acoplada ao LATE_WINDOW_V2: cenario que invalida a tese cancela (WAIT).
   * Nunca mantem a decisao antiga e nunca inverte a direcao.
   */
  revalidateFinal({ observationId = null, candidateId = null, analysis = {}, atMs = null, deadlineAt = null, timingPolicyVersion = TIMING_POLICY_LATE, quality = null, location = null, momentum = null, lateWindow = null } = {}) {
    const observation = observationId ? this.get(observationId) : this.getByCandidate(candidateId);
    if (!observation) return null;
    const at = atMs ?? this.now();
    const deadline = deadlineAt ?? observation.lateWindow?.deadlineAt ?? null;
    const revalidation = evaluateFinalRevalidation({ observation, analysis, atMs: at, deadlineAt: deadline });
    this.recordStage({ observationId: observation.id, stage: "FINAL_ENTRY", analysis, quality, location, momentum, atMs: at, source: "FINAL_REVALIDATION" });
    observation.lateWindow = { ...(observation.lateWindow ?? {}), ...(lateWindow ?? {}), timingPolicyVersion, deadlineAt: deadline, lastRevalidationAt: at };
    if (revalidation.afterDeadline) {
      observation.status = observation.status === "SETTLED" ? "SETTLED" : "CLASSIFIED";
    } else if (revalidation.cancelled) {
      observation.finalAction = "WAIT";
      observation.status = "CANCELLED";
      observation.cancelReason = revalidation.reason;
      observation.scenarioDecision = {
        ...observation.scenarioDecision,
        action: "WAIT", cancelled: true, cancelReason: revalidation.reason,
        reasonsForWait: [...new Set([...(observation.scenarioDecision?.reasonsForWait ?? []), ...revalidation.reasonsForWait])],
        directionFlipAttempted: revalidation.directionFlipAttempted === true,
      };
      observation.reasonsForWait = observation.scenarioDecision.reasonsForWait;
    } else if (revalidation.finalAction) {
      observation.finalAction = revalidation.finalAction;
      observation.scenarioDecision = { ...observation.scenarioDecision, action: revalidation.finalAction, reasonsForWait: [] };
      observation.reasonsForWait = [];
      observation.status = "CLASSIFIED";
    }
    observation.updatedAt = at;
    void this.#persistUpdate(observation, { force: true });
    return { observationId: observation.id, ...revalidation, finalAction: observation.finalAction, status: observation.status };
  }

  /** Outcome posterior: marcado como OUTCOME e NUNCA usado na classificacao. */
  recordOutcome({ observationId = null, candidateId = null, executionId = null, result = null, profit = null, stake = null, payout = null, settlementBasis = null, atMs = null } = {}) {
    const observation = observationId ? this.get(observationId)
      : candidateId ? this.getByCandidate(candidateId)
        : executionId ? [...this.observations.values()].find((row) => row.executionId === executionId) ?? null : null;
    if (!observation) return null;
    const basis = SETTLEMENT_BASES.includes(settlementBasis) ? settlementBasis : "CAUSAL_COUNTERFACTUAL";
    const normalized = normalizedOutcomePnl({ result, payout: payout ?? observation.payout, stake, profit });
    observation.outcome = {
      result, profit: num(profit), stake: num(stake), payout: num(payout ?? observation.payout), normalizedPnl: normalized,
      settlementBasis: basis, at: atMs ?? this.now(),
      outcomeUsedInClassification: false, feedableToClassification: false, postWindowDiagnosticOnly: true,
      note: "OUTCOME pos-classificacao; nunca realimenta a classificacao T0.",
    };
    observation.outcomeAt = observation.outcome.at;
    observation.outcomeUsedInClassification = false;
    observation.settlementBasis = basis;
    observation.theoreticalResult = result;
    observation.theoreticalPnl = normalized;
    if (basis === "BROKER_EXECUTED") { observation.brokerResult = result; observation.brokerProfit = num(profit); }
    observation.status = "SETTLED";
    observation.updatedAt = observation.outcome.at;
    void this.#persistUpdate(observation, { force: true });
    return { observationId: observation.id, outcome: observation.outcome, classificationHashUnchanged: true };
  }

  /** Recarrega do DB por candidate/execution (reinicio nao perde associacao). */
  async loadByCandidate(candidateId) {
    if (this.getByCandidate(candidateId)) return this.getByCandidate(candidateId);
    if (this.store?.getById) {
      const row = await this.store.getById(candidateId).catch(() => null);
      if (row) { this.#remember(row); return row; }
    }
    if (this.pool?.query) {
      try {
        const result = await this.pool.query(`${OBSERVATION_SELECT} WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 1`, [candidateId]);
        const observation = rowToObservation(result.rows?.[0]);
        if (observation) this.#remember(observation);
        return observation;
      } catch (error) { this.#recordPersistFailure(error); return null; }
    }
    return null;
  }

  status({ executedTrades = [] } = {}) {
    return {
      ...buildScenarioShadowDashboard({ observations: this.list(), executedTrades }),
      at: this.now(),
      store: { mode: this.store ? "INJECTED" : this.pool ? "POSTGRES" : "MEMORY", ...this.persist },
      executionControl: "NONE",
      engineInfo: scenarioEngineInfo(),
    };
  }

  /* ------------------------------- persistencia ------------------------------- */

  #safeLog(event, payload) { this.log(event, JSON.stringify(payload)); }

  #columns(observation) {
    const params = [];
    const add = (sqlExpr, value) => { params.push(value); return sqlExpr.replace("?", `$${params.length}`); };
    const json = (value) => add(`?::jsonb`, JSON.stringify(value ?? null));
    const ts = (value) => (value === null || value === undefined ? add(`?`, null) : add(`to_timestamp(?::double precision/1000.0)`, value));
    return {
      params,
      columns: {
        observation_id: add(`?`, observation.id),
        version: add(`?`, observation.version),
        scenario_policy_version: add(`?`, observation.scenarioPolicyVersion),
        current_policy_version: add(`?`, observation.currentPolicyVersion),
        timing_policy_version: add(`?`, observation.timingPolicyVersion),
        kind: add(`?`, observation.kind),
        provenance: add(`?`, observation.provenance),
        market_key: add(`?`, observation.marketKey),
        market_type: add(`?`, observation.marketType),
        active_id: add(`?`, observation.activeId),
        agent_id: add(`?`, observation.agentId),
        candidate_id: add(`?`, observation.candidateId),
        correlation_id: add(`?`, observation.correlationId),
        execution_id: add(`?`, observation.executionId),
        trade_id: add(`?`, observation.tradeId),
        candidate_at: ts(observation.candidateAt), decision_at: ts(observation.decisionAt), jit_at: ts(observation.jitAt), final_entry_at: ts(observation.finalEntryAt),
        target_entry_at: ts(observation.targetEntryAt), target_expiry_at: ts(observation.targetExpiryAt),
        direction: add(`?`, observation.direction), payout: add(`?`, observation.payout),
        t0: json(observation.t0), current_decision: json(observation.currentDecision), scenario_decision: json(observation.scenarioDecision),
        trader_scenario: json(observation.traderScenario), critic_scenario: json(observation.criticScenario),
        critic_freeze: json(observation.criticFreeze), comparison: json(observation.comparison),
        agreement: add(`?`, observation.agreement), divergence: json(observation.divergence), persistence: json(observation.persistence),
        ablation: json(observation.ablation), stages: json(observation.stages), transitions: json(observation.transitions),
        scenario_at_candidate: add(`?`, observation.persistence?.scenarioAtCandidate?.scenario ?? null),
        scenario_at_revalidation1: add(`?`, observation.persistence?.scenarioAtRevalidation1?.scenario ?? null),
        scenario_at_revalidation2: add(`?`, observation.persistence?.scenarioAtRevalidation2?.scenario ?? null),
        scenario_at_final_entry: add(`?`, observation.persistence?.scenarioAtFinalEntry?.scenario ?? null),
        scenario_changed: add(`?`, observation.persistence?.scenarioChanged === true),
        scenario_change_count: add(`?`, observation.persistence?.scenarioChangeCount ?? 0),
        playbook_at_candidate: add(`?`, observation.persistence?.playbookAtCandidate ?? null),
        playbook_at_entry: add(`?`, observation.persistence?.playbookAtEntry ?? null),
        final_action: add(`?`, observation.finalAction), reasons_for_wait: json(observation.reasonsForWait ?? []),
        t0_integrity: json(observation.t0Integrity), engine_info: json(observation.engineInfo),
        outcome: json(observation.outcome), settlement_basis: add(`?`, observation.settlementBasis),
        broker_result: add(`?`, observation.brokerResult), broker_profit: add(`?`, observation.brokerProfit),
        theoretical_result: add(`?`, observation.theoreticalResult), theoretical_pnl: add(`?`, observation.theoreticalPnl),
      },
    };
  }

  async #persistInsert(observation) {
    if (this.store?.save) { this.persist.attempts += 1; try { await this.store.save(observation); this.persist.lastOkAt = this.now(); } catch (error) { this.#recordPersistFailure(error); } return; }
    if (!this.pool?.query) { observation.persistState = "NO_POOL"; return; }
    this.persist.attempts += 1;
    try {
      const { params, columns } = this.#columns(observation);
      const names = Object.keys(columns);
      const values = names.map((name) => columns[name]);
      await this.pool.query(
        `INSERT INTO iq_scenario_shadow_observations(${names.join(",")}, created_at, updated_at) VALUES(${values.join(",")}, now(), now()) ON CONFLICT(observation_id) DO NOTHING`,
        params,
      );
      observation.persistState = "PERSISTED";
      this.persist.lastOkAt = this.now();
    } catch (error) { observation.persistState = "FAILED"; this.#recordPersistFailure(error); }
  }

  async #persistUpdate(observation, { force = false } = {}) {
    if (this.store?.update) { try { await this.store.update({ observationId: observation.id, patch: patchFromObservation(observation) }); this.persist.lastOkAt = this.now(); } catch (error) { this.#recordPersistFailure(error); } return; }
    if (!this.pool?.query) return;
    if (observation.persistPromise) { try { await observation.persistPromise; } catch { /* insert tratado */ } }
    this.persist.attempts += 1;
    const patch = patchFromObservation(observation);
    const params = [];
    const sets = [];
    for (const [column, value] of Object.entries(patch)) {
      if (JSON_UPDATE_COLUMNS.has(column)) { params.push(JSON.stringify(value ?? null)); sets.push(`${column}=$${params.length}::jsonb`); }
      else if (value === null || value === undefined) { params.push(null); sets.push(`${column}=$${params.length}`); }
      else if (TIMESTAMP_UPDATE_COLUMNS.has(column)) { params.push(value); sets.push(`${column}=to_timestamp($${params.length}::double precision/1000.0)`); }
      else { params.push(value); sets.push(`${column}=$${params.length}`); }
    }
    params.push(observation.id);
    try {
      await this.pool.query(`UPDATE iq_scenario_shadow_observations SET ${sets.join(",")}, updated_at=now() WHERE observation_id=$${params.length}`, params);
      this.persist.lastOkAt = this.now();
    } catch (error) { this.#recordPersistFailure(error); }
  }

  #recordPersistFailure(error) {
    this.persist.failures += 1; this.persist.lastError = String(error?.message ?? error).slice(0, 200);
    this.#safeLog("SCENARIO_SHADOW_PERSIST_FAILED", { error: this.persist.lastError });
  }

  statusSnapshot() { return { observations: this.observations.size, persist: { ...this.persist } }; }

  toJSON() { return { version: SCENARIO_SHADOW_VERSION, observations: this.list().map((row) => JSON.parse(JSON.stringify({ ...row, persistPromise: undefined }))) }; }

  loadFrom(snapshot = {}) {
    if (!snapshot || !Array.isArray(snapshot.observations)) return false;
    for (const observation of snapshot.observations.slice(-this.maxInMemory)) if (observation?.id) this.#remember(observation);
    return true;
  }
}

const JSON_UPDATE_COLUMNS = new Set([
  "current_decision", "scenario_decision", "trader_scenario", "critic_scenario", "critic_freeze", "comparison",
  "divergence", "persistence", "ablation", "stages", "transitions", "reasons_for_wait", "t0_integrity", "engine_info", "outcome",
]);
const TIMESTAMP_UPDATE_COLUMNS = new Set(["final_entry_at"]);

function patchFromObservation(observation) {
  return {
    scenario_decision: observation.scenarioDecision ?? null,
    trader_scenario: observation.traderScenario ?? null,
    critic_scenario: observation.criticScenario ?? null,
    comparison: observation.comparison ?? null,
    divergence: observation.divergence ?? null,
    persistence: observation.persistence ?? null,
    stages: observation.stages ?? [],
    transitions: observation.transitions ?? [],
    final_action: observation.finalAction ?? null,
    final_entry_at: observation.finalEntryAt ?? null,
    reasons_for_wait: observation.reasonsForWait ?? [],
    outcome: observation.outcome ?? null,
    settlement_basis: observation.settlementBasis ?? null,
    broker_result: observation.brokerResult ?? null,
    broker_profit: observation.brokerProfit ?? null,
    theoretical_result: observation.theoreticalResult ?? null,
    theoretical_pnl: observation.theoreticalPnl ?? null,
  };
}

function appendTimeline(timeline, entry) {
  const list = Array.isArray(timeline) ? timeline : [];
  return [...list, entry];
}

/* ------------------------------------------------------------------ counterfactual + dashboard */

/** Identidade explicita: aplicar conselho SHADOW nunca muda a execucao. */
export function applyScenarioAdvisory(currentExecution) { return currentExecution; }

export function buildScenarioShadowDashboard({ observations = [], executedTrades = [] } = {}) {
  const all = (Array.isArray(observations) ? observations : []).filter(Boolean);
  const prospective = all.filter((row) => (row.provenance ?? "PROSPECTIVE") === "PROSPECTIVE");
  const historical = all.filter((row) => row.provenance === "HISTORICAL");
  const brokerRows = all.filter((row) => row.settlementBasis === "BROKER_EXECUTED");
  const counterfactualRows = prospective.filter((row) => row.settlementBasis === "CAUSAL_COUNTERFACTUAL");
  const settled = all.filter((row) => row.outcome !== null && row.outcome !== undefined);
  const agreementRows = prospective.filter((row) => row.agreement === true);
  const divergenceCounts = {};
  for (const row of prospective) {
    const code = row.divergence?.divergence ?? "UNKNOWN";
    divergenceCounts[code] = (divergenceCounts[code] ?? 0) + 1;
  }
  const scenarioCounts = (pick) => prospective.reduce((acc, row) => { const key = pick(row) ?? "UNSPECIFIED"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const changedRows = prospective.filter((row) => row.persistence?.scenarioChanged === true);
  const cancelledRows = prospective.filter((row) => row.status === "CANCELLED" || row.scenarioDecision?.cancelled === true);
  return {
    version: SCENARIO_SHADOW_VERSION,
    policy: SCENARIO_SHADOW_POLICY,
    engine: scenarioEngineInfo(),
    separation: "BROKER_EXECUTED != COUNTERFACTUAL != HISTORICAL != PROSPECTIVE",
    sections: {
      BROKER_EXECUTED: {
        basis: "BROKER_EXECUTED", observations: brokerRows.length,
        summary: summarizeRows(brokerRows.map((row) => ({ theoreticalResult: row.outcome?.result ?? null, theoreticalPnl: row.outcome?.normalizedPnl ?? null, payout: row.payout }))),
        note: "Somente trades realmente executados pelo broker; nunca contem contrafactual.",
      },
      COUNTERFACTUAL: {
        basis: "CAUSAL_COUNTERFACTUAL", observations: counterfactualRows.length,
        summary: summarizeRows(counterfactualRows.map((row) => ({ theoreticalResult: row.outcome?.result ?? null, theoreticalPnl: row.outcome?.normalizedPnl ?? null, payout: row.payout }))),
        note: "Resultado teorico do que teria acontecido; nunca entra no PnL do broker.",
      },
      HISTORICAL: {
        basis: "HISTORICAL", observations: historical.length,
        summary: summarizeRows(historical.map((row) => ({ theoreticalResult: row.outcome?.result ?? row.theoreticalResult ?? null, theoreticalPnl: row.outcome?.normalizedPnl ?? row.theoreticalPnl ?? null, payout: row.payout }))),
        note: "Backfill/arquivo; nunca misturado com prospectivo.",
      },
      PROSPECTIVE: {
        basis: "PROSPECTIVE", observations: prospective.length, settled: settled.length,
        pendingOutcome: prospective.length - settled.length,
        summary: summarizeRows(settled.map((row) => ({ theoreticalResult: row.outcome?.result ?? null, theoreticalPnl: row.outcome?.normalizedPnl ?? null, payout: row.payout }))),
      },
    },
    criticIndependence: {
      mode: "INDEPENDENT_TWO_PHASE",
      frozenBeforeTrader: prospective.filter((row) => row.criticFreeze?.criticSawTraderConclusion === false).length,
      violations: prospective.filter((row) => row.criticFreeze?.criticSawTraderConclusion !== false).length,
    },
    agreement: {
      n: prospective.length, agreed: agreementRows.length,
      rate: prospective.length ? round(agreementRows.length / prospective.length) : null,
      ci95: wilsonInterval(agreementRows.length, prospective.length),
      byDivergence: divergenceCounts,
      note: "Acordo NUNCA e votacao; divergencia gera investigacao e, sem evidencia, WAIT.",
    },
    scenarioDistribution: {
      trader: scenarioCounts((row) => row.traderScenario?.primaryScenario),
      critic: scenarioCounts((row) => row.criticScenario?.primaryScenario),
      finalAction: scenarioCounts((row) => row.finalAction),
    },
    persistence: {
      scenarioChanged: changedRows.length, cancelledByScenario: cancelledRows.length,
      changeCount: prospective.reduce((sum, row) => sum + (row.persistence?.scenarioChangeCount ?? 0), 0),
      transitions: prospective.reduce((sum, row) => sum + (row.transitions?.length ?? 0), 0),
    },
    executions: {
      note: "Execucoes reais sao contadas apenas para auditoria; NUNCA promovidas a partir daqui.",
      brokerTrades: Array.isArray(executedTrades) ? executedTrades.length : 0,
    },
    sampleSize: { checkpointN: 30, prospective: prospective.length, reachedCheckpoint: prospective.length >= 30 },
    controlsExecution: false,
  };
}

/* ------------------------------------------------------------------ singleton + endpoint payload */

export const scenarioShadow = new ScenarioShadow();

/** Payload do endpoint GET /api/iq/research/scenario-shadow (aditivo; nunca executa nada). */
export function scenarioShadowStatus({ observations = null, executedTrades = [] } = {}) {
  return {
    ...buildScenarioShadowDashboard({ observations: observations ?? scenarioShadow.list(), executedTrades }),
    persist: { ...scenarioShadow.persist, mode: scenarioShadow.store ? "INJECTED" : scenarioShadow.pool ? "POSTGRES" : "MEMORY" },
    scenarioPolicyVersion: SCENARIO_ENGINE_V3_SHADOW,
    currentPolicyVersion: CURRENT_G2,
    timingPolicyVersion: TIMING_POLICY_LATE,
    currentTimingPolicyVersion: TIMING_POLICY_CURRENT,
    isolation: { marketKeyKeyed: true, normalOtcSeparated: true, seriesSeparated: [CURRENT_G2, SCENARIO_ENGINE_V3_SHADOW, TIMING_POLICY_CURRENT, TIMING_POLICY_LATE] },
  };
}

export { parseMarketKey, findFutureReferences };
