/**
 * V3 â€” WAVE1 DETERMINISTICA (RSI, DMI/ADX, Bollinger, ATR, Price Action/Estrutura, Scenario/Asset).
 *
 * Tudo em codigo, zero LLM. Produz assessments no MESMO formato dos schemas que o CONSENSUS consome:
 * 5 especialistas em SPECIALIST_SCHEMA e ASSET em ASSET_SCHEMA. Nenhum numero em prosa
 * (CODE OWNS NUMBERS); fact codes sem digitos; blockers/invalidations qualitativos.
 * Fallback seguro: ausencia de medicoes => assessment neutro com blocker explicito.
 */
export const V3_DETERMINISTIC_WAVE1_VERSION = "v3-deterministic-wave1-v1";

const PROSE_LIMIT = 200;

function prose(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, PROSE_LIMIT) : fallback;
}

function fact(code, direction, strength, detail = null) {
  const item = { code: String(code).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 48), direction, strength };
  if (detail) item.detail = String(detail).slice(0, 240);
  return item;
}

function specialistCall(role, { assessment, facts, blockers = [], invalidations = [], changed = [], watch = [], playbooks = [], sources = ["TRACECOM_V3_OPS"] }) {
  return { role, status: "OK", reason: null, model: "deterministic", provider: "code", latencyMs: 0, queueWaitMs: 0, schemaValid: true,
    output: { assessment: prose(assessment, "Condicao neutra sem evidencia direcional suficiente."), facts, blockers, invalidations, changed, watch, playbooks, sources } };
}

function assetCall({ scenario, direction, state, thesis, bestCounterCase, blockers = [], invalidations = [], changed = [], watch = [] }) {
  return { role: "ASSET", status: "OK", reason: null, model: "deterministic", provider: "code", latencyMs: 0, queueWaitMs: 0, schemaValid: true,
    output: { scenario, direction, state, thesis: prose(thesis, "Sem configuracao operacional relevante neste momento."), bestCounterCase: prose(bestCounterCase, "Caso contrario nao identificado pelas regras deterministicas."), blockers, invalidations, changed, watch } };
}

function clampStrength(magnitude) {
  if (magnitude >= 5) return "STRONG";
  if (magnitude >= 2) return "MODERATE";
  return "WEAK";
}

/** Classificador de cenario (subset deterministico da Scenario Library). */
export function classifyScenario(m) {
  const structure = m?.structure ?? {};
  const pullback = m?.pullback ?? {};
  const breakout = m?.breakoutRetest ?? {};
  const trend = structure.trend;
  if (structure.lastCHoCH?.type) return { id: "STRUCTURAL_REVERSAL", direction: structure.lastCHoCH.type === "BEARISH_CHOCH" ? "DOWN" : "UP" };
  if (breakout.failed) return { id: "FAILED_BREAKOUT", direction: "NONE" };
  if (breakout.breakdown) return { id: "BREAKDOWN", direction: "DOWN" };
  if (breakout.breakout) return { id: "BREAKOUT", direction: "UP" };
  if (pullback.active && trend === "UPTREND") return { id: pullback.depth === "DEEP" ? "DEEP_PULLBACK_STRUCTURE_THREAT" : "PULLBACK_CONTINUATION", direction: "UP" };
  if (pullback.active && trend === "DOWNTREND") return { id: pullback.depth === "DEEP" ? "DEEP_PULLBACK_STRUCTURE_THREAT" : "PULLBACK_CONTINUATION", direction: "DOWN" };
  if (trend === "UPTREND") return { id: "TREND_CONTINUATION", direction: "UP" };
  if (trend === "DOWNTREND") return { id: "TREND_CONTINUATION", direction: "DOWN" };
  if (trend === "TRANSITION") return { id: "TRANSITION", direction: "NONE" };
  if (trend === "RANGE") return { id: "RANGE", direction: "NONE" };
  return { id: "NO_SETUP", direction: "NONE" };
}

/** Wave1 deterministica: 6 "calls" no formato do team (role/status/output/latencia). */
export function deterministicWave1Calls(m) {
  const rsi = m?.rsi ?? {};
  const dmi = m?.dmi ?? {};
  const bollinger = m?.bollinger ?? {};
  const atr = m?.atr ?? {};
  const structure = m?.structure ?? {};
  const micro = m?.micro ?? {};
  const pullback = m?.pullback ?? {};
  const scenario = classifyScenario(m);
  return [rsiCall(rsi), dmiCall(dmi), bollingerCall(bollinger), atrCall(atr), priceActionCall(structure, micro, pullback), assetCallFor(scenario, structure, dmi, pullback)];
}

function rsiCall(rsi) {
  const facts = []; const blockers = []; const watch = []; const playbooks = ["RSI_ZONE_CONTEXT"];
  const zone = rsi.zone ?? "NEUTRAL";
  if (rsi.failureSwing?.type === "BULLISH_FAILURE_SWING") { facts.push(fact("RSI_BULLISH_FAILURE_SWING", "UP", "MODERATE")); playbooks.push("RSI_FAILURE_SWING"); }
  else if (rsi.failureSwing?.type === "BEARISH_FAILURE_SWING") { facts.push(fact("RSI_BEARISH_FAILURE_SWING", "DOWN", "MODERATE")); playbooks.push("RSI_FAILURE_SWING"); }
  else if (zone === "OVERBOUGHT") { facts.push(fact("RSI_OVERBOUGHT", "DOWN", "WEAK")); watch.push("crossback de RSI para neutro"); }
  else if (zone === "OVERSOLD") { facts.push(fact("RSI_OVERSOLD", "UP", "WEAK")); watch.push("crossback de RSI para neutro"); }
  else facts.push(fact("RSI_NEUTRAL", "NONE", "WEAK"));
  if (rsi.divergence?.type === "BULLISH") { facts.push(fact("RSI_BULLISH_DIVERGENCE", "UP", "MODERATE")); playbooks.push("RSI_DIVERGENCE"); }
  else if (rsi.divergence?.type === "BEARISH") { facts.push(fact("RSI_BEARISH_DIVERGENCE", "DOWN", "MODERATE")); playbooks.push("RSI_DIVERGENCE"); }
  if (rsi.momentum === "DETERIORATING" && zone === "OVERBOUGHT") blockers.push("Momentum de RSI deteriorando em zona sobrecomprada.");
  if (rsi.momentum === "RECOVERING" && zone === "OVERSOLD") blockers.push("Momentum de RSI recuperando a partir de sobrevenda.");
  return specialistCall("RSI", { assessment: `RSI em zona ${prose(String(zone), "neutra")} com momentum ${prose(String(rsi.momentum ?? "desconhecido"), "desconhecido")}.`, facts, blockers, watch, playbooks });
}

function dmiCall(dmi) {
  const facts = []; const blockers = []; const watch = [];
  const adx = Number(dmi.adx); const spread = Number(dmi.spread);
  const hasPressure = Number.isFinite(adx) && Number.isFinite(spread);
  if (!hasPressure) { blockers.push("ADX/spread indisponivel: pressao direcional nao mensuravel."); facts.push(fact("DMI_NO_DATA", "NONE", "WEAK")); }
  else if (adx < 15) { blockers.push("ADX abaixo de 15: dominancia direcional e ruido."); facts.push(fact("DMI_WEAK_ADX", "NONE", "WEAK")); }
  else {
    const bulls = Number(dmi.plusDi) > Number(dmi.minusDi);
    facts.push(fact(bulls ? "DMI_BULLISH_PRESSURE" : "DMI_BEARISH_PRESSURE", bulls ? "UP" : "DOWN", adx >= 25 ? (Math.abs(spread) >= 5 ? "STRONG" : "MODERATE") : "WEAK"));
    if (Number.isFinite(Number(dmi.adxSlope)) && Number(dmi.adxSlope) < -2) watch.push("ADX caindo: tendencia perdendo vigor.");
  }
const direction = !hasPressure || adx < 15 ? "NONE" : Number(dmi.plusDi) > Number(dmi.minusDi) ? "UP" : "DOWN";
  return specialistCall("DMI_ADX", { assessment: hasPressure && adx >= 15 ? `Pressao ${direction === "UP" ? "compradora" : "vendedora"} com ADX ${prose(String(adx), "")}.` : "Pressao direcional ausente ou fraca.", facts, blockers, watch, playbooks: ["DMI_STRENGTH_VS_DIRECTION"] });
}

function bollingerCall(bollinger) {
  const facts = []; const blockers = [];
  const zone = bollinger.zone ?? "MIDDLE";
  if (bollinger.squeeze) { blockers.push("Squeeze de volatilidade: amplitude comprimida, sem direcao definida."); facts.push(fact("BOLLINGER_SQUEEZE", "NONE", "WEAK")); }
  else if (zone === "UPPER") facts.push(fact("BOLLINGER_UPPER", "DOWN", "WEAK"));
  else if (zone === "LOWER") facts.push(fact("BOLLINGER_LOWER", "UP", "WEAK"));
  else facts.push(fact("BOLLINGER_MIDDLE", "NONE", "WEAK"));
return specialistCall("BOLLINGER", { assessment: `Preco na zona ${prose(String(zone), "media")}${bollinger.squeeze ? " com squeeze ativo" : ""}.`, facts, blockers, playbooks: [bollinger.squeeze ? "BOLLINGER_SQUEEZE_EXPANSION" : "BOLLINGER_RELATIVE_DEFINITION"] });
}

function atrCall(atr) {
  const facts = []; const blockers = [];
  const regime = atr.regime ?? "UNKNOWN";
  if (regime === "ABNORMAL_EXPANSION") { blockers.push("Volatilidade em expansao anormal: risco de stop excessivo."); facts.push(fact("ATR_ABNORMAL_EXPANSION", "NONE", "WEAK")); }
  else if (regime === "LOW_INFORMATION_VOLATILITY") { blockers.push("Volatilidade baixa: pouco conteudo informativo."); facts.push(fact("ATR_LOW_INFORMATION", "NONE", "WEAK")); }
  else facts.push(fact("ATR_VOLATILITY_COMPATIBLE", "NONE", "WEAK"));
return specialistCall("ATR", { assessment: `Regime de volatilidade ${prose(String(regime), "desconhecido")}.`, facts, blockers, playbooks: ["ATR_VOLATILITY_REGIME"] });
}

function priceActionCall(structure, micro, pullback) {
  const facts = []; const blockers = []; const invalidations = []; const watch = [];
  const trend = structure.trend ?? "RANGE";
  if (structure.lastCHoCH?.type) { const direction = structure.lastCHoCH.type === "BEARISH_CHOCH" ? "DOWN" : "UP"; facts.push(fact("PA_CHOCH", direction, "MODERATE")); invalidations.push("Estrutura anterior invalidada pelo CHoCH."); }
  else if (structure.lastBOS?.type) facts.push(fact("PA_BOS", structure.lastBOS.type === "BULLISH_BOS" ? "UP" : "DOWN", "MODERATE"));
  else if (trend === "UPTREND" && pullback.active) { facts.push(fact("PA_UPTREND_PULLBACK", "UP", "WEAK")); watch.push("confirmacao de retomada (BOS) para validar."); }
  else if (trend === "DOWNTREND" && pullback.active) { facts.push(fact("PA_DOWNTREND_PULLBACK", "DOWN", "WEAK")); watch.push("confirmacao de retomada (BOS) para validar."); }
  else if (trend === "UPTREND") facts.push(fact("PA_UPTREND", "UP", "WEAK"));
  else if (trend === "DOWNTREND") facts.push(fact("PA_DOWNTREND", "DOWN", "WEAK"));
  else { blockers.push("Estrutura em range ou transicao: sem setup direcional."); facts.push(fact("PA_RANGE", "NONE", "WEAK")); }
if (micro?.candle === "DOJI") watch.push("DOJI: indecisao no candle fechado.");
  const playbooks = ["PA_TREND_STRUCTURE"];
  if (structure.lastBOS?.type || structure.lastCHoCH?.type) playbooks.push("PA_BOS_CHOCH");
  if (pullback.active) playbooks.push("PA_PULLBACK_DEPTH");
  return specialistCall("PRICE_ACTION", { assessment: `Estrutura ${prose(String(trend), "indefinida")}${structure.lastBOS ? " com BOS recente" : ""}.`, facts, blockers, invalidations, watch, playbooks });
}

function assetCallFor(scenario, structure, dmi, pullback) {
  const state = scenario.id === "NO_SETUP" ? "NO_SETUP" : ["RANGE", "TRANSITION", "FAILED_BREAKOUT"].includes(scenario.id) ? "WAIT" : scenario.direction === "UP" ? "BUY_CANDIDATE" : scenario.direction === "DOWN" ? "SELL_CANDIDATE" : "WAIT";
  const direction = state === "BUY_CANDIDATE" ? "UP" : state === "SELL_CANDIDATE" ? "DOWN" : "NONE";
  const thesis = (() => {
    if (scenario.id === "PULLBACK_CONTINUATION") return `Pullback ${prose(String(pullback?.depth ?? ""), "ativo")} dentro de tendencia ${prose(String(structure?.trend ?? ""), "definida")}: aguardando retomada na direcao ${direction === "UP" ? "compradora" : "vendedora"}.`;
    if (scenario.id === "TREND_CONTINUATION") return `Tendencia ${prose(String(structure?.trend ?? ""), "definida")} intacta com estrutura favoravel a continuacao ${direction === "UP" ? "compradora" : "vendedora"}.`;
    if (scenario.id === "STRUCTURAL_REVERSAL") return `CHoCH confirmado: reversao estrutural na direcao ${direction === "UP" ? "compradora" : "vendedora"}.`;
    if (scenario.id === "BREAKOUT") return "Rompimento de resistencia com fechamento sustentado.";
    if (scenario.id === "BREAKDOWN") return "Perda de suporte com fechamento sustentado.";
    if (scenario.id === "DEEP_PULLBACK_STRUCTURE_THREAT") return "Correcao profunda ameacando o swing que define a tendencia.";
    return "Sem configuracao operacional relevante neste momento.";
  })();
  const blockers = ["NO_SETUP", "RANGE"].includes(scenario.id) ? ["Ausencia de setup estrutural relevante."] : [];
  const invalidations = structure.lastCHoCH ? ["CHoCH pode invalidar continuacao de tendencia."] : [];
  const bestCounterCase = direction === "UP" ? "Caso contrario: perda do swing de alta com CHoCH bearish." : direction === "DOWN" ? "Caso contrario: recuperacao do swing de baixa com CHoCH bullish." : "Sem tese direcional para contestar.";
  return assetCall({ scenario: scenario.id, direction, state, thesis, bestCounterCase, blockers, invalidations, changed: [], watch: [] });
}
