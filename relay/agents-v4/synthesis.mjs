/**
 * SYNTHESIS_AGENT — congela a leitura dos especialistas e decide BUY/SELL/WAIT.
 *
 * NAO usa votacao burra: cada cenario exige componentes especificos (matriz abaixo).
 * Contexto bom SEM trigger => WAIT (whyNow obrigatorio). Nao recalcula indicadores.
 */
export const SYNTHESIS_AGENT_VERSION = "synthesis-agent-v1";
export const SYNTHESIS_RULE = "SCENARIO_COMPONENT_GATING_V1";

export const SCENARIO_REQUIREMENTS = Object.freeze({
  TREND_CONTINUATION: { fundamental: ["TREND_AGENT", "MARKET_STRUCTURE_AGENT", "MOMENTUM_AGENT"], note: "tendencia + estrutura + momentum a favor; localizacao nao esticada" },
  TREND_PULLBACK: { fundamental: ["TREND_AGENT", "LOCATION_AGENT", "MOMENTUM_AGENT"], note: "tendencia + zona de pullback + retomada" },
  BREAKOUT: { fundamental: ["MARKET_STRUCTURE_AGENT", "VOLATILITY_AGENT", "PRICE_ACTION_AGENT"], note: "rompimento + volatilidade + qualidade do candle" },
  FAILED_BREAKOUT: { fundamental: ["MARKET_STRUCTURE_AGENT", "PRICE_ACTION_AGENT", "LOCATION_AGENT"], note: "falha de rompimento + rejeicao + localizacao no extremo" },
  RANGE_MEAN_REVERSION: { fundamental: ["MARKET_STRUCTURE_AGENT", "LOCATION_AGENT", "PRICE_ACTION_AGENT"], note: "range + extremo + rejeicao" },
  REVERSAL: { fundamental: ["TREND_AGENT", "MOMENTUM_AGENT", "PRICE_ACTION_AGENT"], note: "exaustao + momentum virando + price action contra" },
  COMPRESSION_EXPANSION: { fundamental: ["VOLATILITY_AGENT", "PRICE_ACTION_AGENT"], note: "compressao/expansao + direcao do candle" },
  TRANSITION_NO_TRADE: { fundamental: [], note: "sem trade por desenho" },
});

function alignmentOf(agentId, output, direction) {
  const state = output?.state ?? "UNKNOWN";
  if (direction === "BUY" || direction === "SELL") {
    const bullish = direction === "BUY";
    switch (agentId) {
      case "MARKET_REGIME_AGENT": return state === (bullish ? "TREND_UP" : "TREND_DOWN") ? "SUPPORT" : state === (bullish ? "TREND_DOWN" : "TREND_UP") ? "CONFLICT" : "NEUTRAL";
      case "MARKET_STRUCTURE_AGENT": return state === (bullish ? "BULLISH_STRUCTURE" : "BEARISH_STRUCTURE") ? "SUPPORT" : state === (bullish ? "BEARISH_STRUCTURE" : "BULLISH_STRUCTURE") ? "CONFLICT" : "NEUTRAL";
      case "TREND_AGENT": return state === (bullish ? "BULLISH" : "BEARISH") ? "SUPPORT" : state === (bullish ? "BEARISH" : "BULLISH") ? "CONFLICT" : "NEUTRAL";
      case "MOMENTUM_AGENT": { const dir = output?.detail?.direction; return dir === (bullish ? "UP" : "DOWN") ? "SUPPORT" : dir === (bullish ? "DOWN" : "UP") ? "CONFLICT" : "NEUTRAL"; }
      case "PRICE_ACTION_AGENT": return state === (bullish ? "BULLISH" : "BEARISH") ? "SUPPORT" : state === (bullish ? "BEARISH" : "BULLISH") ? "CONFLICT" : "NEUTRAL";
      case "LOCATION_AGENT": return state === (bullish ? "EDGE_LOWER" : "EDGE_UPPER") ? "SUPPORT" : state === (bullish ? "EDGE_UPPER" : "EDGE_LOWER") ? "CONFLICT" : "NEUTRAL";
      case "MICROSTRUCTURE_AGENT": return state === (bullish ? "BUY_PRESSURE" : "SELL_PRESSURE") ? "SUPPORT" : state === (bullish ? "SELL_PRESSURE" : "BUY_PRESSURE") ? "CONFLICT" : "NEUTRAL";
      case "SCENARIO_AGENT": return output?.detail?.direction === direction ? "SUPPORT" : output?.detail?.direction && output.detail.direction !== direction ? "CONFLICT" : "NEUTRAL";
      default: return "NEUTRAL";
    }
  }
  return "NEUTRAL";
}

function requirementsSatisfied(scenario, specialists, features, direction) {
  const fail = (component, reason) => ({ component, reason });
  const missing = [];
  const S = (id) => specialists[id] ?? null;
  switch (scenario) {
    case "TREND_CONTINUATION": {
      const trend = S("TREND_AGENT"), structure = S("MARKET_STRUCTURE_AGENT"), momentum = S("MOMENTUM_AGENT");
      if (!(trend?.state === (direction === "BUY" ? "BULLISH" : "BEARISH"))) missing.push(fail("TREND_AGENT", `state=${trend?.state}`));
      if (!(structure?.state === (direction === "BUY" ? "BULLISH_STRUCTURE" : "BEARISH_STRUCTURE"))) missing.push(fail("MARKET_STRUCTURE_AGENT", `state=${structure?.state}`));
      const momentumDir = momentum?.detail?.direction;
      if (!(momentumDir === (direction === "BUY" ? "UP" : "DOWN") && ["STRONG", "BUILDING"].includes(momentum?.state))) missing.push(fail("MOMENTUM_AGENT", `state=${momentum?.state} dir=${momentumDir}`));
      break;
    }
    case "TREND_PULLBACK": {
      const trend = S("TREND_AGENT"), location = S("LOCATION_AGENT"), momentum = S("MOMENTUM_AGENT");
      if (!(trend?.state === (direction === "BUY" ? "BULLISH" : "BEARISH"))) missing.push(fail("TREND_AGENT", `state=${trend?.state}`));
      const loc = location?.state;
      const locationOk = direction === "BUY" ? ["MID", "LOWER_HALF", "UPPER_HALF", "EDGE_LOWER"].includes(loc) && loc !== "OVEREXTENDED_UPPER" : ["MID", "UPPER_HALF", "LOWER_HALF", "EDGE_UPPER"].includes(loc) && loc !== "OVEREXTENDED_LOWER";
      if (!locationOk || loc === "MID" && features.midLocation === true && !features.pullbackDown && !features.pullbackUp) missing.push(fail("LOCATION_AGENT", `state=${loc}`));
      if (momentum?.state === "REVERSING") missing.push(fail("MOMENTUM_AGENT", "REVERSING"));
      break;
    }
    case "BREAKOUT": {
      const structure = S("MARKET_STRUCTURE_AGENT"), volatility = S("VOLATILITY_AGENT"), priceAction = S("PRICE_ACTION_AGENT");
      const bosMatch = direction === "BUY" ? (features.bosUp || features.breakoutUp) : (features.bosDown || features.breakoutDown);
      if (!bosMatch) missing.push(fail("MARKET_STRUCTURE_AGENT", "sem_rompimento_na_direcao"));
      if (["COMPRESSED", "VOLATILE_SPIKE", "UNKNOWN"].includes(volatility?.state)) missing.push(fail("VOLATILITY_AGENT", `state=${volatility?.state}`));
      const paOk = priceAction?.state === (direction === "BUY" ? "BULLISH" : "BEARISH");
      if (!paOk) missing.push(fail("PRICE_ACTION_AGENT", `state=${priceAction?.state}`));
      break;
    }
    case "FAILED_BREAKOUT": {
      const priceAction = S("PRICE_ACTION_AGENT"), location = S("LOCATION_AGENT");
      const failedMatch = direction === "SELL" ? features.failedBreakoutUp : features.failedBreakoutDown;
      if (!failedMatch) missing.push(fail("MARKET_STRUCTURE_AGENT", "sem_falha_de_rompimento"));
      if (!(priceAction?.state === (direction === "BUY" ? "BULLISH" : "BEARISH"))) missing.push(fail("PRICE_ACTION_AGENT", `state=${priceAction?.state}`));
      const loc = location?.state;
      if (direction === "SELL" ? ["EDGE_UPPER", "OVEREXTENDED_UPPER"].includes(loc) === false : ["EDGE_LOWER", "OVEREXTENDED_LOWER"].includes(loc) === false) missing.push(fail("LOCATION_AGENT", `state=${loc}`));
      break;
    }
    case "RANGE_MEAN_REVERSION": {
      const structure = S("MARKET_STRUCTURE_AGENT"), location = S("LOCATION_AGENT"), priceAction = S("PRICE_ACTION_AGENT");
      if (!["RANGE_STRUCTURE", "TRANSITION_STRUCTURE"].includes(structure?.state)) missing.push(fail("MARKET_STRUCTURE_AGENT", `state=${structure?.state}`));
      const rejection = direction === "SELL" ? features.rejectionUp : features.rejectionDown;
      if (!rejection) missing.push(fail("PRICE_ACTION_AGENT", "sem_rejeicao_no_extremo"));
      const loc = location?.state;
      if (!(direction === "SELL" ? ["EDGE_UPPER", "OVEREXTENDED_UPPER"].includes(loc) : ["EDGE_LOWER", "OVEREXTENDED_LOWER"].includes(loc))) missing.push(fail("LOCATION_AGENT", `state=${loc}`));
      break;
    }
    case "REVERSAL": {
      const trend = S("TREND_AGENT"), momentum = S("MOMENTUM_AGENT"), priceAction = S("PRICE_ACTION_AGENT");
      if (!(trend?.detail?.weakening === true || ["MATURE", "EXTENDED"].includes(trend?.detail?.maturity))) missing.push(fail("TREND_AGENT", `weakening=${trend?.detail?.weakening} maturity=${trend?.detail?.maturity}`));
      if (!["REVERSING", "WEAKENING"].includes(momentum?.state)) missing.push(fail("MOMENTUM_AGENT", `state=${momentum?.state}`));
      if (!(priceAction?.state === (direction === "BUY" ? "BULLISH" : "BEARISH"))) missing.push(fail("PRICE_ACTION_AGENT", `state=${priceAction?.state}`));
      break;
    }
    case "COMPRESSION_EXPANSION": {
      const volatility = S("VOLATILITY_AGENT"), priceAction = S("PRICE_ACTION_AGENT");
      if (!["COMPRESSED", "EXPANDING", "EXPANDED", "NORMAL"].includes(volatility?.state)) missing.push(fail("VOLATILITY_AGENT", `state=${volatility?.state}`));
      if (!(priceAction?.state === (direction === "BUY" ? "BULLISH" : "BEARISH"))) missing.push(fail("PRICE_ACTION_AGENT", `state=${priceAction?.state}`));
      break;
    }
    default:
      break;
  }
  return missing;
}

export function synthesize({ features = {}, specialists = {}, scenario = null, riskState = "ELIGIBLE", dataQualityState = "HEALTHY", dataQuality = "UNKNOWN" } = {}) {
  const evaluatedAt = Number(features.availableAt) || Date.now();
  const base = {
    version: SYNTHESIS_AGENT_VERSION,
    rule: SYNTHESIS_RULE,
    scenario: scenario?.state ?? "NO_SCENARIO",
    scenarioDetail: scenario?.detail ?? null,
    primaryScenario: scenario?.detail?.primaryScenario ?? scenario?.state ?? "NO_SCENARIO",
    secondaryScenario: scenario?.detail?.secondaryScenario ?? null,
    competingScenario: scenario?.detail?.competingScenario ?? null,
    direction: "WAIT",
    action: "WAIT",
    supportingAgents: [],
    conflictingAgents: [],
    invalidation: [],
    triggerState: "NO_SCENARIO",
    whyNow: null,
    confidenceClass: "LOW",
    reasoningSummary: "",
    noTrade: false,
    evaluatedAt,
  };
  if (dataQualityState === "UNSAFE") {
    return { ...base, action: "WAIT", direction: "WAIT", noTrade: true, triggerState: "DATA_UNSAFE", whyNow: "DADOS_INSEGUROS: nenhuma decisao e permitida com DATA_QUALITY UNSAFE.", reasoningSummary: "Synthesis abortado por DATA_QUALITY UNSAFE.", confidenceClass: "HIGH" };
  }
  if (riskState === "BLOCK") {
    return { ...base, action: "WAIT", direction: "WAIT", triggerState: "RISK_BLOCK", whyNow: "RISK_CONTEXT_AGENT bloqueou a oportunidade (exposicao/limite/conta).", reasoningSummary: "Synthesis abortado por RISK BLOCK.", confidenceClass: "HIGH" };
  }
  const scenarioDirection = scenario?.detail?.direction ?? null;
  const primary = base.primaryScenario;
  if (!scenarioDirection || primary === "TRANSITION_NO_TRADE" || !SCENARIO_REQUIREMENTS[primary]) {
    const triggerState = scenario?.detail?.ambiguity ? "AMBIGUOUS_COMPETING_SCENARIOS" : primary === "TRANSITION_NO_TRADE" ? "REGIME_TRANSITION" : "CONTEXT_OK_NO_TRIGGER";
    return { ...base, direction: "WAIT", action: "WAIT", triggerState, whyNow: `Sem direcao acionavel: ${triggerState}. Cenario=${primary}.`, reasoningSummary: `Especialistas convergem em contexto, mas falta trigger acionavel (${triggerState}).`, confidenceClass: "LOW" };
  }
  const direction = scenarioDirection;
  const missing = requirementsSatisfied(primary, specialists, features, direction);
  const supportingAgents = [];
  const conflictingAgents = [];
  for (const [agentId, output] of Object.entries(specialists)) {
    const alignment = alignmentOf(agentId, output, direction);
    if (alignment === "SUPPORT") supportingAgents.push({ agentId, state: output.state });
    else if (alignment === "CONFLICT") conflictingAgents.push({ agentId, state: output.state, confidenceClass: output.confidenceClass });
  }
  const scenarioTrigger = scenario?.detail?.trigger ?? null;
  if (missing.length) {
    return {
      ...base,
      direction: "WAIT", action: "WAIT",
      triggerState: "SCENARIO_COMPONENT_MISSING",
      whyNow: `Cenario ${primary} na direcao ${direction} rejeitado: componentes fundamentais ausentes (${missing.map((row) => `${row.component}:${row.reason}`).join("; ")}).`,
      reasoningSummary: `Gate de cenario: ${SYNTHESIS_RULE}; sem os componentes fundamentais o contexto nao vira ordem.`,
      supportingAgents, conflictingAgents,
      confidenceClass: "LOW",
    };
  }
  if (!scenarioTrigger) {
    return {
      ...base,
      direction: "WAIT", action: "WAIT",
      triggerState: "CONTEXT_OK_NO_TRIGGER",
      whyNow: `Contexto de ${primary} presente, mas SEM trigger no instante da decisao.`,
      reasoningSummary: "Bias nao e trigger; aguardar evento objetivo.",
      supportingAgents, conflictingAgents,
      confidenceClass: "LOW",
    };
  }
  const scenarioInvalidators = {
    TREND_CONTINUATION: ["perda_da_estrutura_a_favor", "momentum_revertendo"],
    TREND_PULLBACK: ["perda_da_estrutura_a_favor", "rompimento_do_swing_do_pullback"],
    BREAKOUT: ["fechamento_de_volta_ao_range", "perda_do_nivel_rompido"],
    FAILED_BREAKOUT: ["aceitacao_alem_do_nivel", "retomada_do_rompimento"],
    RANGE_MEAN_REVERSION: ["rompimento_com_corpo_do_extremo", "adx_subindo_com_di_alinhado"],
    COMPRESSION_EXPANSION: ["expansao_sem_fechamento", "retorno_para_dentro_do_range"],
    REVERSAL: ["retomada_da_tendencia_com_corpo_forte", "estrutura_a_favor_reconstituida"],
  };
  const invalidation = [
    ...(scenario?.detail?.evidenceAgainst ?? []),
    ...(scenarioInvalidators[primary] ?? []),
  ].filter(Boolean);
  const highConflicts = conflictingAgents.filter((row) => row.confidenceClass === "HIGH");
  const scenarioScore = Number(scenario?.detail?.candidates?.[0]?.score) || 0;
  const confidenceClass = highConflicts.length ? "LOW" : scenarioScore >= 4 ? "HIGH" : scenarioScore >= 3 ? "MEDIUM" : "LOW";
  return {
    ...base,
    direction,
    action: direction,
    triggerState: "TRIGGERED",
    whyNow: `Trigger objetivo: ${scenarioTrigger}. Cenario ${primary} com componentes fundamentais completos.`,
    supportingAgents, conflictingAgents,
    invalidation,
    confidenceClass,
    reasoningSummary: `Synthesis: ${primary} -> ${direction} (score=${scenarioScore}); suporte=${supportingAgents.length} conflito=${conflictingAgents.length}; regra=${SYNTHESIS_RULE}.`,
  };
}
