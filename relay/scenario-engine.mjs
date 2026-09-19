/**
 * SCENARIO ENGINE V3 — motor puro de cenarios/regimes/playbooks (TraceCom).
 *
 * SHADOW / RESEARCH ONLY. Modulo puro: sem IO, DB, fetch, Date.now, Math.random, imports
 * ou efeitos colaterais. Mesma entrada -> mesma saida byte a byte. NUNCA envia ordem,
 * NUNCA controla execucao, stake, direcao, threshold 75, pesos do Quality Gate, Brain G2,
 * setups, JIT ou Execution Gate de producao.
 *
 * Contrato CONGELADO consumido por `relay/scenario-shadow.mjs`:
 *   SCENARIO_ENGINE_VERSION, REGIMES, SCENARIOS,
 *   extractContext, classifyRegime, classifyScenario, evaluatePlaybook, analyzeScenario.
 *
 * OTC: so o observavel (price, ticks, candles, estrutura, volatilidade, momentum,
 * microestrutura de ticks). Volume/order book NAO existem no OTC e NUNCA sao simulados:
 * feature indisponivel e marcada em `unavailable`.
 *
 * Indicadores sao EVIDENCIA, nunca a estrategia: nenhum indicador isolado define regime ou
 * direcao (RSI extremo nao gera reversal; ADX sozinho nao escolhe direcao; ATR sozinho nao
 * escolhe direcao). Nada aqui e ajustado olhando WIN/LOSS de observacoes.
 *
 * Versao: SCENARIO_ENGINE_V3. Nao altera nenhum modulo de producao. PRACTICE only, ZERO real.
 */

export const SCENARIO_ENGINE_VERSION = "SCENARIO_ENGINE_V3";
export const version = SCENARIO_ENGINE_VERSION;
export const SCENARIO_ENGINE_MODE = "SHADOW_OBSERVATIONAL";

export const SCENARIO_ENGINE_POLICY = Object.freeze({
  version: SCENARIO_ENGINE_VERSION,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  sendsOrders: false,
  practiceOnly: true,
  realMoney: false,
  deterministic: true,
  io: "NONE",
  otcPolicy: "OBSERVABLE_ONLY_NO_SYNTHETIC_VOLUME_OR_ORDER_BOOK",
  tuningPolicy: "NO_TUNING_ON_WIN_LOSS",
});

export const REGIMES = Object.freeze({
  TREND_UP: "TREND_UP",
  TREND_DOWN: "TREND_DOWN",
  RANGE: "RANGE",
  COMPRESSION: "COMPRESSION",
  EXPANSION: "EXPANSION",
  TRANSITION: "TRANSITION",
  UNCERTAIN: "UNCERTAIN",
});

export const SCENARIOS = Object.freeze({
  TREND_CONTINUATION: "TREND_CONTINUATION",
  TREND_PULLBACK: "TREND_PULLBACK",
  BREAKOUT: "BREAKOUT",
  FAILED_BREAKOUT: "FAILED_BREAKOUT",
  RANGE_MEAN_REVERSION: "RANGE_MEAN_REVERSION",
  REVERSAL: "REVERSAL",
  COMPRESSION_EXPANSION: "COMPRESSION_EXPANSION",
  TRANSITION_NO_TRADE: "TRANSITION_NO_TRADE",
});

export const SCENARIO_ORDER = Object.freeze([
  SCENARIOS.TREND_CONTINUATION,
  SCENARIOS.TREND_PULLBACK,
  SCENARIOS.BREAKOUT,
  SCENARIOS.FAILED_BREAKOUT,
  SCENARIOS.RANGE_MEAN_REVERSION,
  SCENARIOS.REVERSAL,
  SCENARIOS.COMPRESSION_EXPANSION,
  SCENARIOS.TRANSITION_NO_TRADE,
]);

export const DIRECTIONS = Object.freeze(["BUY", "SELL", "WAIT"]);
export const CONFIDENCE_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH"]);

/** Mapa feature flat -> componente de ablation (mesma taxonomia do scenario-shadow). */
export const FEATURE_COMPONENTS = Object.freeze({
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

export const OTC_UNAVAILABLE_FEATURES = Object.freeze([
  "volume:OTC_NOT_OBSERVABLE",
  "orderBook:OTC_NOT_OBSERVABLE",
  "marketDepth:OTC_NOT_OBSERVABLE",
]);

/* ------------------------------------------------------------------ playbooks (evidencia + fonte) */

export const PLAYBOOK_DEFINITIONS = Object.freeze({
  TREND_CONTINUATION: Object.freeze({
    id: "PB_TREND_CONTINUATION",
    scenario: SCENARIOS.TREND_CONTINUATION,
    definition: "Continuacao de tendencia: estrutura e momentum a favor, preco aceito na metade da tendencia, sem sinal de exaustao.",
    validRegimes: Object.freeze(["TREND_UP", "TREND_DOWN", "EXPANSION"]),
    invalidRegimes: Object.freeze(["RANGE", "COMPRESSION", "TRANSITION", "UNCERTAIN"]),
    structure: "HH/HL (ou LH/LL) intactos; swing a favor preservado; sem break of structure contra.",
    location: "Metade a favor do canal (UP: pos >= 0.45; DOWN: pos <= 0.55); longe do extremo oposto.",
    momentum: "Velocidade e aceleracao na direcao; RSI na direcao sem extremo contra.",
    volatility: "NORMAL ou EXPANSION; compressao forte reduz validade.",
    microstructure: "Ticks alinhados ou neutros; sem wick de rejeicao dominante contra.",
    trigger: "Fechamento/candle de continuacao apos pausa sem romper swing a favor.",
    invalidation: Object.freeze(["STRUCTURE_AGAINST_TREND", "BREAK_OF_STRUCTURE_AGAINST", "MOMENTUM_CONFLICT", "REJECTION_AT_EXTREME", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["TREND_PULLBACK", "REVERSAL", "TRANSITION_NO_TRADE"]),
    traderLogic: "Operar a favor apenas com estrutura e momentum alinhados; extensao > 2.5 ATR e ataque do Critic.",
    criticAttack: Object.freeze(["Estrutura reconhecida em janela curta.", "Momentum pode ser ruido em OTC 60s.", "Exaustao pode nao aparecer antes do rompimento."]),
    waitConditions: Object.freeze(["WAIT_FOR_STRUCTURE_AND_MOMENTUM_ALIGNMENT", "WAIT_FOR_NON_EXTENDED_LOCATION"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "velocity", "acceleration", "adx14", "plusDI", "minusDI", "rsi14", "atrRatio", "bodyRatio", "ticks"]),
    source: Object.freeze([
      "CMT Association (curriculo tecnico: tendencia, estrutura, suporte/resistencia)",
      "Moskowitz, Ooi & Pedersen (2012) Time Series Momentum, JFE",
      "Hurst, Ooi & Pedersen (2017) A Century of Evidence on Trend-Following Investing",
      "CFA Institute Research Foundation, Technical Analysis: Modern Perspectives",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): em OTC 60s continuacao com estrutura alinhada teria vantagem marginal; requer validacao prospectiva.",
  }),
  TREND_PULLBACK: Object.freeze({
    id: "PB_TREND_PULLBACK",
    scenario: SCENARIOS.TREND_PULLBACK,
    definition: "Pullback com a tendencia: retracao para zona de valor mantendo swing a favor e sem quebra estrutural.",
    validRegimes: Object.freeze(["TREND_UP", "TREND_DOWN"]),
    invalidRegimes: Object.freeze(["RANGE", "COMPRESSION", "TRANSITION", "UNCERTAIN"]),
    structure: "Swing a favor mantido (HL em UP / LH em DOWN); nenhum break of structure contra.",
    location: "Retracao em zona de valor: UP pos 0.25-0.65; DOWN pos 0.35-0.75.",
    momentum: "Momento contra apenas como retracao (RSI 38-62), sem flip de aceleracao.",
    volatility: "NORMAL; pullback em compressao tende a virar transicao.",
    microstructure: "Sem corpo forte contra; retest/pullback observado no candle ou na serie.",
    trigger: "Candle de continuacao apos o pullback sem romper o swing a favor.",
    invalidation: Object.freeze(["STRUCTURE_BROKEN", "BREAK_OF_STRUCTURE_AGAINST", "LOCATION_AT_EXTREME", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["REVERSAL", "TREND_CONTINUATION", "TRANSITION_NO_TRADE"]),
    traderLogic: "Entrar a favor quando o pullback respeita a zona de valor e o swing; nunca fade da tendencia sadia.",
    criticAttack: Object.freeze(["Pullback vs reversal depende de swing definido em janela curta.", "RSI de exaustao pode confundir retracao com reversao.", "Em OTC o ruido pode romper swing sem estrutura real."]),
    waitConditions: Object.freeze(["WAIT_FOR_PULLBACK_ZONE_AND_HELD_SWING", "WAIT_FOR_RESUMPTION_CANDLE"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "velocity", "acceleration", "rsi14", "atrRatio", "bodyRatio", "upperWick", "lowerWick"]),
    source: Object.freeze([
      "CMT Association (tendencia e retracoes)",
      "Fidelity Learning Center (pullbacks e suporte/resistencia)",
      "CFA Institute Research Foundation, Technical Analysis: Modern Perspectives",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): retracao a favor com swing mantido em OTC 60s; nao distinguivel de reversao sem rompimento confirmado.",
  }),
  BREAKOUT: Object.freeze({
    id: "PB_BREAKOUT",
    scenario: SCENARIOS.BREAKOUT,
    definition: "Rompimento com fechamento e expansao: preco aceito alem de extremo/compressao, corpo dominante e follow-through.",
    validRegimes: Object.freeze(["TREND_UP", "TREND_DOWN", "EXPANSION", "COMPRESSION"]),
    invalidRegimes: Object.freeze(["RANGE"]),
    structure: "Extremo/canal rompido com fechamento (nao apenas wick); estrutura emergindo na direcao.",
    location: "Pos >= 0.85 (up) ou <= 0.15 (down); extensao entre 0.1 e 2.5 ATR alem do nivel.",
    momentum: "Velocidade/aceleracao na direcao; extensao excessiva (> 2.5 ATR) vira risco de fracasso.",
    volatility: "EXPANSION ou expansao iniciando; compressao sem expansao nao confirma.",
    microstructure: "Ticks alinhados e corpo >= 0.5; wick dominante contra e ataque do Critic.",
    trigger: "Fechamento alem do extremo com corpo dominante e extensao minima de 0.05-0.1 ATR.",
    invalidation: Object.freeze(["BREAKOUT_FAILED_CLOSE_BACK_INSIDE", "UPPER_WICK_REJECTION", "NO_EXPANSION", "OVEREXTENDED_FROM_CHANNEL", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["FAILED_BREAKOUT", "COMPRESSION_EXPANSION", "TREND_CONTINUATION"]),
    traderLogic: "Perseguir apenas com fechamento e expansao; rompimento fraco/sem corpo e WAIT.",
    criticAttack: Object.freeze(["Maior parte dos rompimentos intradiarios falha (data snooping em breakout).", "Sem volume/order book no OTC a qualidade do rompimento e inferida.", "Entrada atrasada apos expansao e risco."]),
    waitConditions: Object.freeze(["WAIT_FOR_CLOSE_BEYOND_LEVEL", "WAIT_FOR_EXPANSION_AND_BODY", "WAIT_FOR_FRESH_TICKS"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "channelHigh", "channelLow", "distanceToUpperATR", "distanceToLowerATR", "atrRatio", "bodyRatio", "upperWick", "lowerWick", "velocity", "ticks"]),
    source: Object.freeze([
      "Brock, Lakonishok & LeBaron (1992) Simple Technical Trading Rules, Journal of Finance",
      "Sullivan, Timmermann & White (1999) Data-Snooping, Technical Trading Rule Performance, and the Bootstrap, JF",
      "White (2000) A Reality Check for Data Snooping, Econometrica",
      "CME Group Education (rompimentos e volatilidade)",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): em OTC 60s expansao apos compressao com fechamento poderia ter assimetria; nao medido sem volume/order book.",
  }),
  FAILED_BREAKOUT: Object.freeze({
    id: "PB_FAILED_BREAKOUT",
    scenario: SCENARIOS.FAILED_BREAKOUT,
    definition: "Falso rompimento: preco perfura extremo mas fecha de volta dentro, com rejeicao; viés contrario ao rompimento.",
    validRegimes: Object.freeze(["RANGE", "TRANSITION", "EXPANSION", "COMPRESSION"]),
    invalidRegimes: Object.freeze([]),
    structure: "Perfuracao do extremo com fechamento de volta ao range/canal; sem aceitacao fora.",
    location: "Retorno para dentro (pos <= 0.8 no failed up; >= 0.2 no failed down).",
    momentum: "Velocidade contra o rompimento e/ou desaceleracao dele.",
    volatility: "Expansao de volatilidade sem follow-through (armadilha) ou normalizacao apos o pico.",
    microstructure: "Wick de rejeicao dominante e ticks contra a direcao perfurada.",
    trigger: "Rejeicao confirmada apos a falha (wick >= 0.5 ou evento explicito) + fechamento de volta.",
    invalidation: Object.freeze(["ACCEPTANCE_BEYOND_LEVEL", "STRONG_BODY_IN_BREAK_DIRECTION", "NO_REJECTION_CONFIRMATION", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["BREAKOUT", "RANGE_MEAN_REVERSION", "REVERSAL"]),
    traderLogic: "Nunca comprar rompimento sem fechamento; na falha confirmada, operar de volta para o range. Falha sem rejeicao = WAIT (nao e retest).",
    criticAttack: Object.freeze(["Distinguir falha de retest exige definicao de nivel robusta.", "Sem order book a 'aceitacao' e inferida por candles.", "Rejeicao pode ser apenas spread/ruido em OTC."]),
    waitConditions: Object.freeze(["WAIT_FOR_CLOSE_BACK_INSIDE", "WAIT_FOR_REJECTION_CONFIRMATION"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "distanceToUpperATR", "distanceToLowerATR", "bodyRatio", "upperWick", "lowerWick", "velocity", "atrRatio", "ticks"]),
    source: Object.freeze([
      "CMT Association (padroes de armadilha e rejeicao)",
      "Fidelity Learning Center (failed breakouts)",
      "Park & Irwin (2007) What Do We Know About the Profitability of Technical Analysis?, Journal of Economic Surveys",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): em OTC 60s perfuracao sem fechamento tende a reverter para o range; retest vs falha nao provado.",
  }),
  RANGE_MEAN_REVERSION: Object.freeze({
    id: "PB_RANGE_MEAN_REVERSION",
    scenario: SCENARIOS.RANGE_MEAN_REVERSION,
    definition: "Range provado com bordas estaveis: BUY perto da base com rejeicao/retorno; SELL perto do topo. MID invalida.",
    validRegimes: Object.freeze(["RANGE"]),
    invalidRegimes: Object.freeze(["TREND_UP", "TREND_DOWN", "COMPRESSION", "EXPANSION", "TRANSITION", "UNCERTAIN"]),
    structure: "Estrutura lateral (RANGE) com rangeHigh/Low/Mid/Width definidos e bordas respeitadas; sem break of structure.",
    location: "Posicao normalizada: BUY pos <= 0.2; SELL pos >= 0.8; MID (0.35-0.65) reduz muito a validade.",
    momentum: "ADX/slope baixos, DI spread pequeno; RSI retornando do extremo (trajetoria), nunca RSI extremo isolado.",
    volatility: "NORMAL/TIGHT; expansao e risco de rompimento (nao fade).",
    microstructure: "Rejeicao na borda (wick) e ticks revertendo; Donchian/estabilidade das bordas observaveis.",
    trigger: "Rejeicao/retorno na borda + fechamento de volta para dentro; se parece romper -> WAIT.",
    invalidation: Object.freeze(["MID_LOCATION", "RANGE_BREAK_IN_PROGRESS", "RANGE_EXPANSION_RISK", "BREAKOUT_RISK_ADX_DI", "STRUCTURE_NOT_RANGE", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["BREAKOUT", "COMPRESSION_EXPANSION", "FAILED_BREAKOUT"]),
    traderLogic: "Fade somente em borda com rejeicao; MID e WAIT; rompimento em curso nunca e fade.",
    criticAttack: Object.freeze(["Ranges podem romper sem aviso.", "RSI extremo nao e gatilho por si so.", "Sem volume, a defesa da borda e apenas candle/ticks."]),
    waitConditions: Object.freeze(["WAIT_FOR_RANGE_EDGE_WITH_REJECTION", "WAIT_FOR_RANGE_PROOF_STABLE_EDGES", "WAIT_FOR_NO_BREAKOUT_RISK"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "channelHigh", "channelLow", "atrRatio", "adx14", "plusDI", "minusDI", "rsi14", "bodyRatio", "upperWick", "lowerWick", "ticks", "candles"]),
    source: Object.freeze([
      "Poterba & Summers (1988) Mean Reversion in Stock Prices, Journal of Financial Economics",
      "De Bondt & Thaler (1985) Does the Stock Market Overreact?, Journal of Finance",
      "CMT Association (suporte/resistencia e canais)",
      "Fidelity Learning Center (range trading)",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): em OTC 60s fade das bordas de range estavel teria assimetria; NAO validado e sem volume/order book.",
  }),
  REVERSAL: Object.freeze({
    id: "PB_REVERSAL",
    scenario: SCENARIOS.REVERSAL,
    definition: "Reversao confirmada: break of structure contra a tendencia anterior + rejeicao no extremo + divergencia de momentum.",
    validRegimes: Object.freeze(["TREND_UP", "TREND_DOWN", "EXPANSION", "TRANSITION"]),
    invalidRegimes: Object.freeze(["RANGE", "COMPRESSION"]),
    structure: "Break of structure contra a tendencia anterior (LL apos UP / HH apos DOWN). Sem BOS nao ha reversal.",
    location: "Extremo da tendencia anterior (UP: pos >= 0.75; DOWN: pos <= 0.25) com rejeicao.",
    momentum: "Divergencia: novo extremo de preco sem novo extremo de momentum; aceleracao contra.",
    volatility: "EXPANSION ou spike contra a tendencia anterior.",
    microstructure: "Ticks virando de lado; wick de rejeicao no extremo; failed breakout a favor da reversao.",
    trigger: "BOS confirmado + rejeicao; RSI extremo SOZINHO nunca gera reversal.",
    invalidation: Object.freeze(["TREND_STRUCTURE_INTACT", "NO_STRUCTURE_BREAK", "RSI_EXTREME_WITHOUT_STRUCTURE", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["TREND_PULLBACK", "TREND_CONTINUATION", "FAILED_BREAKOUT"]),
    traderLogic: "So operar contra a tendencia apos BOS/rejeicao/divergencia; sem confirmacao, tratar como pullback ou WAIT.",
    criticAttack: Object.freeze(["Falsos BOS sao frequentes em janelas curtas.", "RSI extremo e o erro classico de iniciante.", "Tendencia forte pode retomar e invalidar a reversao."]),
    waitConditions: Object.freeze(["WAIT_FOR_BREAK_OF_STRUCTURE", "WAIT_FOR_EXTREME_REJECTION", "WAIT_FOR_MOMENTUM_DIVERGENCE"]),
    featuresUsed: Object.freeze(["structureLabel", "donchianPosition", "velocity", "acceleration", "rsi14", "atrRatio", "bodyRatio", "upperWick", "lowerWick", "ticks"]),
    source: Object.freeze([
      "CMT Association (reversao e exaustao)",
      "Lo, Mamaysky & Wang (2000) Foundations of Technical Analysis, Journal of Finance",
      "Fidelity Learning Center (reversal patterns)",
      "Park & Irwin (2007) What Do We Know About the Profitability of Technical Analysis?",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): reversoes apos BOS + rejeicao teriam validade em OTC 60s; RSI extremo isolado explicitamente rejeitado como gatilho.",
  }),
  COMPRESSION_EXPANSION: Object.freeze({
    id: "PB_COMPRESSION_EXPANSION",
    scenario: SCENARIOS.COMPRESSION_EXPANSION,
    definition: "Compressao de volatilidade (ATR relativo/realVol/Donchian/BBW/candle ranges/ticks) seguida de expansao; compressao nao escolhe direcao.",
    validRegimes: Object.freeze(["COMPRESSION", "EXPANSION"]),
    invalidRegimes: Object.freeze(["RANGE", "TREND_UP", "TREND_DOWN", "TRANSITION", "UNCERTAIN"]),
    structure: "Antes: candles menores e canal estreito; depois: fechamento alem da fronteira de compressao.",
    location: "Posicao nao define direcao durante compressao; direcao so quando expansao/ruptura comeca (pos no lado rompido).",
    momentum: "Momentum morno na compressao; acelera com o evento de expansao.",
    volatility: "ATR ratio baixo + trajetoria decrescente; realVol/BBW/Donchian estreitos (quando validaveis); expansao = rangeRatio/ATR subindo.",
    microstructure: "Ticks pequenos/alternados na compressao; tick a favor no breakout.",
    trigger: "Expansao EFETIVA com fechamento e corpo; expansao apenas por wick = FALSE_EXPANSION.",
    invalidation: Object.freeze(["EXPANSION_WITHOUT_DIRECTION", "FALSE_EXPANSION_WICK_ONLY", "COMPRESSION_NOT_CONFIRMED", "REGIME_NOT_VALID_FOR_PLAYBOOK"]),
    competing: Object.freeze(["BREAKOUT", "FAILED_BREAKOUT", "TRANSITION_NO_TRADE"]),
    traderLogic: "Nunca prever direcao na compressao; esperar expansao com fechamento. Sem direcao = WAIT.",
    criticAttack: Object.freeze(["BBW/realVol exigem janela suficiente; sem candles ficam unavailable.", "Compressao pode ser apenas sessao sem liquidez.", "A expansao pode falhar (FALSE_EXPANSION)."]),
    waitConditions: Object.freeze(["WAIT_FOR_EXPANSION_DIRECTION", "WAIT_FOR_COMPRESSION_CONFIRMED", "WAIT_FOR_CLOSE_BEYOND_COMPRESSION_BOUNDARY"]),
    featuresUsed: Object.freeze(["atrRatio", "atr", "structureLabel", "donchianPosition", "channelHigh", "channelLow", "bodyRatio", "velocity", "ticks", "candles"]),
    source: Object.freeze([
      "Mandelbrot (1963) The Variation of Certain Speculative Prices (clustering de volatilidade)",
      "Engle (1982) Autoregressive Conditional Heteroskedasticity, Econometrica",
      "Bollerslev (1986) Generalized Autoregressive Conditional Heteroskedasticity, Journal of Econometrics",
      "Andersen & Bollerslev (1998) Answering the Skeptics: Yes, Standard Volatility Models Do Provide Accurate Forecasts",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): em OTC 60s compressao medida por ATR relativo/candle ranges precede expansao; direcao sempre condicional ao evento.",
  }),
  TRANSITION_NO_TRADE: Object.freeze({
    id: "PB_TRANSITION_NO_TRADE",
    scenario: SCENARIOS.TRANSITION_NO_TRADE,
    definition: "Transicao sem tese: tendencia enfraquecendo sem reversal confirmado, range rompendo sem breakout confiavel, compressao sem direcao, momentum x estrutura discordando ou confianca estrutural baixa.",
    validRegimes: Object.freeze(["TRANSITION", "UNCERTAIN", "RANGE", "COMPRESSION", "EXPANSION", "TREND_UP", "TREND_DOWN"]),
    invalidRegimes: Object.freeze([]),
    structure: "Estrutura confusa/ambigua ou em transicao.",
    location: "Nao relevante: nenhum local autoriza entrada.",
    momentum: "Momentum discorda da estrutura.",
    volatility: "Mudanca de regime de volatilidade sem direcao.",
    microstructure: "Sinais mistos; confianca insuficiente.",
    trigger: "Nenhum: sempre WAIT.",
    invalidation: Object.freeze(["ALWAYS_WAIT_BY_DESIGN"]),
    competing: Object.freeze(SCENARIO_ORDER.filter((scenario) => scenario !== SCENARIOS.TRANSITION_NO_TRADE)),
    traderLogic: "Nao operar; reduzir conviccao e aguardar definicao estrutural.",
    criticAttack: Object.freeze(["WAIT tambem e decisao: custo de oportunidade.", "Ambiguidade pode esconder tese boa.", "Transicao pode resolver rapido."]),
    waitConditions: Object.freeze(["WAIT_UNTIL_REGIME_DEFINED", "WAIT_FOR_REVERSAL_CONFIRMATION", "WAIT_FOR_RELIABLE_BREAKOUT"]),
    featuresUsed: Object.freeze(["structureLabel", "velocity", "acceleration", "adx14", "atrRatio", "rsi14", "ticks", "candles"]),
    source: Object.freeze([
      "CFA Institute Research Foundation, Technical Analysis: Modern Perspectives (regime uncertainty)",
      "CMT Association (transicao de tendencia/range)",
      "Park & Irwin (2007) What Do We Know About the Profitability of Technical Analysis?",
    ]),
    traceHypothesis: "HYPOTHESIS TraceCom (nao provada): abster-se em transicao evita falsos sinais; custo de oportunidade nao medido.",
  }),
});

export function playbookForScenario(scenario) {
  return PLAYBOOK_DEFINITIONS[scenario] ?? null;
}

/* ------------------------------------------------------------------ helpers puros */

function num(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
  return typeof value === "string" && value.length ? value : null;
}

function round(value, digits = 4) {
  const parsed = num(value);
  return parsed === null ? null : Number(parsed.toFixed(digits));
}

function round2(value) {
  return round(value, 2) ?? 0;
}

function mean(values) {
  if (!Array.isArray(values) || !values.length) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function stdev(values) {
  const avg = mean(values);
  if (avg === null) return null;
  let sum = 0;
  for (const value of values) sum += (value - avg) * (value - avg);
  return Math.sqrt(sum / values.length);
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) return null;
  return mean(values.slice(-period));
}

function sanitizeCandles(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const open = num(row.open), high = num(row.high), low = num(row.low), close = num(row.close);
    if (open === null || high === null || low === null || close === null) continue;
    out.push({ open, high, low, close });
  }
  return out.length ? out : null;
}

function sanitizeNumbers(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const row of value) {
    const parsed = row && typeof row === "object" ? num(row.price ?? row.value ?? row.close) : num(row);
    if (parsed !== null) out.push(parsed);
  }
  return out.length ? out : null;
}

function trueRange(current, previous) {
  return Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
}

function atrWilder(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) ranges.push(trueRange(candles[index], candles[index - 1]));
  let atr = mean(ranges.slice(0, period)) ?? 0;
  for (let index = period; index < ranges.length; index += 1) atr = (atr * (period - 1) + ranges[index]) / period;
  return atr > 0 ? atr : null;
}

function rsiWilder(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const diff = closes[index] - closes[index - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function adxWilder(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index], previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(current, previous));
  }
  const smooth = (values) => {
    let acc = values.slice(0, period).reduce((sum, value) => sum + value, 0);
    const out = [acc];
    for (let index = period; index < values.length; index += 1) { acc = acc - acc / period + values[index]; out.push(acc); }
    return out;
  };
  const trS = smooth(tr), plusS = smooth(plusDM), minusS = smooth(minusDM);
  const plusDI = [], minusDI = [], dx = [];
  for (let index = 0; index < trS.length; index += 1) {
    if (trS[index] === 0) continue;
    const p = 100 * (plusS[index] / trS[index]), m = 100 * (minusS[index] / trS[index]);
    plusDI.push(p); minusDI.push(m);
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
  }
  if (dx.length < period) return null;
  let adx = mean(dx.slice(0, period)) ?? 0;
  for (let index = period; index < dx.length; index += 1) adx = (adx * (period - 1) + dx[index]) / period;
  if (!Number.isFinite(adx)) return null;
  return { adx, plusDI: plusDI[plusDI.length - 1], minusDI: minusDI[minusDI.length - 1] };
}

function donchian(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const window = candles.slice(-period);
  const upper = Math.max(...window.map((candle) => candle.high));
  const lower = Math.min(...window.map((candle) => candle.low));
  const close = candles[candles.length - 1].close;
  const width = upper - lower;
  return { upper, middle: (upper + lower) / 2, lower, width, position: width > 0 ? (close - lower) / width : 0.5 };
}

function trendFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 6) return null;
  const closes = candles.map((candle) => candle.close);
  const lookback = Math.min(20, closes.length - 1);
  const last = closes[closes.length - 1];
  const base = closes[closes.length - 1 - lookback];
  const atr = atrWilder(candles, 14) ?? mean(candles.slice(-14).map((candle) => candle.high - candle.low));
  const change = last - base;
  const slope = atr && atr > 0 ? change / (atr * Math.sqrt(lookback)) : 0;
  const fast = sma(closes, 5), slow = sma(closes, 20) ?? sma(closes, closes.length);
  const fastVsSlow = fast !== null && slow ? (fast - slow) / slow : 0;
  let direction = "FLAT";
  if (slope > 0.2 && fastVsSlow > 0) direction = "UP";
  else if (slope < -0.2 && fastVsSlow < 0) direction = "DOWN";
  return { direction, slope: round(slope, 4), change: round(change, 6), fastVsSlow: round(fastVsSlow, 6), source: "CANDLES_DERIVED" };
}

function structureFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 8) return null;
  const window = candles.slice(-20);
  const half = Math.max(1, Math.floor(window.length / 2));
  const first = window.slice(0, half), second = window.slice(half);
  const firstHigh = Math.max(...first.map((candle) => candle.high));
  const firstLow = Math.min(...first.map((candle) => candle.low));
  const secondHigh = Math.max(...second.map((candle) => candle.high));
  const secondLow = Math.min(...second.map((candle) => candle.low));
  const higherHigh = secondHigh > firstHigh, higherLow = secondLow > firstLow;
  const lowerHigh = secondHigh < firstHigh, lowerLow = secondLow < firstLow;
  const label = higherHigh && higherLow ? "UP" : lowerHigh && lowerLow ? "DOWN" : "RANGE";
  return { label, higherHigh, higherLow, lowerHigh, lowerLow, rangeHigh: Math.max(firstHigh, secondHigh), rangeLow: Math.min(firstLow, secondLow), source: "CANDLES_DERIVED" };
}

function breakOfStructureFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 12) return null;
  const window = candles.slice(-40);
  const lookback = 2;
  const highs = [], lows = [];
  for (let index = lookback; index < window.length - lookback; index += 1) {
    const candle = window[index];
    let isHigh = true, isLow = true;
    for (let offset = -lookback; offset <= lookback; offset += 1) {
      if (offset === 0) continue;
      const other = window[index + offset];
      if (other.high >= candle.high) isHigh = false;
      if (other.low <= candle.low) isLow = false;
    }
    if (isHigh) highs.push({ price: candle.high });
    if (isLow) lows.push({ price: candle.low });
  }
  const lastHigh = highs[highs.length - 1], previousHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], previousLow = lows[lows.length - 2];
  const close = window[window.length - 1].close;
  if (lastLow && previousLow && lastLow.price > previousLow.price && lastHigh && close > lastHigh.price) return "UP";
  if (lastHigh && previousHigh && lastHigh.price < previousHigh.price && lastLow && close < lastLow.price) return "DOWN";
  return null;
}

function rangeFromCandles(candles, period = 20) {
  const window = Array.isArray(candles) ? candles.slice(-period) : null;
  if (!window || window.length < 10) return null;
  const rangeHigh = Math.max(...window.map((candle) => candle.high));
  const rangeLow = Math.min(...window.map((candle) => candle.low));
  const width = rangeHigh - rangeLow;
  const last = window[window.length - 1];
  const position = width > 0 ? (last.close - rangeLow) / width : 0.5;
  const zone = 0.1 * width;
  const touchesHigh = window.filter((candle) => candle.high >= rangeHigh - zone);
  const touchesLow = window.filter((candle) => candle.low <= rangeLow + zone);
  const holdsHigh = touchesHigh.filter((candle) => candle.close < rangeHigh - zone * 0.5);
  const holdsLow = touchesLow.filter((candle) => candle.close > rangeLow + zone * 0.5);
  const edgeStabilityHigh = touchesHigh.length >= 2 ? holdsHigh.length / touchesHigh.length >= 0.6 : null;
  const edgeStabilityLow = touchesLow.length >= 2 ? holdsLow.length / touchesLow.length >= 0.6 : null;
  return {
    rangeHigh, rangeLow, rangeMid: (rangeHigh + rangeLow) / 2, rangeWidth: width, position,
    touchesHigh: touchesHigh.length, touchesLow: touchesLow.length, edgeStabilityHigh, edgeStabilityLow,
    available: true, source: "CANDLES_DERIVED",
  };
}

function volatilityFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 16) return null;
  const atr = atrWilder(candles, 14);
  const previousAtr = atrWilder(candles.slice(0, -5), 14) ?? atr;
  const atrRatio = atr && previousAtr ? atr / previousAtr : null;
  const closes = candles.map((candle) => candle.close);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index - 1] > 0 && closes[index] > 0) returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  const recentReturns = returns.slice(-20);
  const priorReturns = returns.slice(-40, -20);
  const realizedVol = stdev(recentReturns);
  const priorVol = stdev(priorReturns.length >= 10 ? priorReturns : recentReturns);
  const realVolRatio = realizedVol !== null && priorVol ? realizedVol / priorVol : null;
  const ranges = candles.map((candle) => candle.high - candle.low);
  const recentRange = mean(ranges.slice(-5)), priorRange = mean(ranges.slice(-15, -5));
  const rangeRatio = recentRange !== null && priorRange ? recentRange / priorRange : null;
  const donch = donchian(candles, 20);
  const donchianWidth = donch?.width ?? null;
  const donchianWidthATR = donchianWidth !== null && atr ? donchianWidth / atr : null;
  let bbw = null, bbwValidated = false;
  if (closes.length >= 21) {
    const middle = sma(closes, 20);
    const deviation = stdev(closes.slice(-20));
    if (middle && middle > 0 && deviation !== null) { bbw = (4 * deviation) / middle; bbwValidated = true; }
  }
  const trajectory = atrRatio === null ? null : atrRatio < 0.95 ? "NARROWING" : atrRatio > 1.05 ? "WIDENING" : "STABLE";
  return {
    atr: round(atr, 6), atrRatio: round(atrRatio, 4), atrTrajectory: trajectory,
    realizedVol: round(realizedVol, 6), realVolRatio: round(realVolRatio, 4),
    donchianWidth: round(donchianWidth, 6), donchianWidthATR: round(donchianWidthATR, 4),
    bbw: round(bbw, 6), bbwValidated, rangeRatio: round(rangeRatio, 4), source: "CANDLES_DERIVED",
  };
}

function tickMetricsFromTicks(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 3) return null;
  const deltas = [];
  let up = 0, down = 0;
  for (let index = 1; index < ticks.length; index += 1) {
    const delta = ticks[index] - ticks[index - 1];
    deltas.push(delta);
    if (delta > 0) up += 1;
    else if (delta < 0) down += 1;
  }
  const upRatio = deltas.length ? up / deltas.length : null;
  const direction = upRatio === null ? "UNKNOWN" : upRatio >= 0.65 ? "UP" : upRatio <= 0.35 ? "DOWN" : "MIXED";
  const absolute = deltas.map((delta) => Math.abs(delta));
  return {
    available: true, count: ticks.length, upRatio: round(upRatio, 4), direction,
    movement: round(ticks[ticks.length - 1] - ticks[0], 6),
    volatility: round(stdev(deltas), 8), lastDelta: round(deltas[deltas.length - 1], 6),
    maxAbsDelta: round(Math.max(...absolute), 6), source: "TICKS_DERIVED",
  };
}

const FORBIDDEN_KEY_PATTERN = /(result|settlement|outcome|pnl|profit|postwindow|post_window|future|expiryclose|expiry_close|broker|causal|feedable)/i;

function findLeakageReferences(value, path = "input", found = [], depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findLeakageReferences(entry, `${path}[${index}]`, found, depth + 1));
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) { found.push(`${path}.${key}`); continue; }
    findLeakageReferences(entry, `${path}.${key}`, found, depth + 1);
  }
  return found;
}

function uniqueStrings(values) {
  const out = [];
  for (const value of values) if (typeof value === "string" && value.length && !out.includes(value)) out.push(value);
  return out;
}

function isContext(value) {
  return Boolean(value && typeof value === "object" && value.feedQuality && value.structure && value.volatility && value.location);
}

function hasTraderCriticDivergence(raw) {
  const trader = raw.trader && typeof raw.trader === "object" ? raw.trader : null;
  const critic = raw.critic && typeof raw.critic === "object" ? raw.critic : null;
  if (!trader || !critic) return false;
  const traderAction = textOrNull(trader.action) ?? textOrNull(trader.independentAction);
  const criticAction = textOrNull(critic.action) ?? textOrNull(critic.independentAction) ?? textOrNull(critic.finalRecommendation);
  if (!traderAction || !criticAction) return false;
  return traderAction !== criticAction;
}

/* ------------------------------------------------------------------ extractContext */

export function extractContext(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const snapshot = raw.snapshot && typeof raw.snapshot === "object"
    ? raw.snapshot
    : (raw.momentum || raw.strength || raw.volatility || raw.location || raw.microstructure) ? raw : {};
  const providedFeatures = raw.features && typeof raw.features === "object" ? raw.features : null;
  const features = providedFeatures ?? {};
  const unavailable = [];
  const leakageIgnored = uniqueStrings(findLeakageReferences(raw));
  for (const path of leakageIgnored) unavailable.push(`leakageIgnored:${path}`);

  const marketType = textOrNull(raw.marketType) ?? textOrNull(snapshot.marketType);
  const isOtc = marketType ? /otc/i.test(marketType) : false;
  if (isOtc) unavailable.push(...OTC_UNAVAILABLE_FEATURES);

  const candles = sanitizeCandles(raw.candles) ?? sanitizeCandles(snapshot.candles) ?? sanitizeCandles(raw.candles1m);
  const higherCandles = sanitizeCandles(raw.candlesHigher) ?? sanitizeCandles(raw.candlesHtf) ?? sanitizeCandles(snapshot.candlesHigher);
  const ticks = sanitizeNumbers(raw.ticks) ?? sanitizeNumbers(snapshot.ticks);
  const disabledComponents = uniqueStrings(
    Object.entries(raw.ablation && typeof raw.ablation === "object" ? raw.ablation : {})
      .filter(([, enabled]) => enabled === false)
      .map(([component]) => component),
  );

  const useSnapshot = providedFeatures === null;
  const momentumSnap = snapshot.momentum && typeof snapshot.momentum === "object" ? snapshot.momentum : {};
  const strengthSnap = snapshot.strength && typeof snapshot.strength === "object" ? snapshot.strength : {};
  const volatilitySnap = snapshot.volatility && typeof snapshot.volatility === "object" ? snapshot.volatility : {};
  const microstructureSnap = snapshot.microstructure && typeof snapshot.microstructure === "object" ? snapshot.microstructure : {};
  const locationSnap = snapshot.location && typeof snapshot.location === "object" ? snapshot.location : {};
  const structureSnap = snapshot.structure && typeof snapshot.structure === "object" ? snapshot.structure : {};
  const freshnessSnap = snapshot.freshness && typeof snapshot.freshness === "object" ? snapshot.freshness : {};
  const rangeSnap = snapshot.range && typeof snapshot.range === "object" ? snapshot.range : {};

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const gated = (key, snapshotValue, computedValue) => {
    const component = FEATURE_COMPONENTS[key];
    if (component && disabledComponents.includes(component)) return null;
    if (hasOwn(features, key) && num(features[key]) !== null) return num(features[key]);
    if (useSnapshot && num(snapshotValue) !== null) return num(snapshotValue);
    if (num(features[key]) !== null) return num(features[key]);
    return computedValue ?? null;
  };
  const free = (key, snapshotValue, computedValue) => {
    if (hasOwn(features, key) && num(features[key]) !== null) return num(features[key]);
    if (useSnapshot && num(snapshotValue) !== null) return num(snapshotValue);
    if (num(features[key]) !== null) return num(features[key]);
    return computedValue ?? null;
  };

  const structureComputed = structureFromCandles(candles);
  const trendComputed = trendFromCandles(candles);
  const volatilityComputed = volatilityFromCandles(candles);
  const rangeComputed = rangeFromCandles(candles);
  const bosComputed = breakOfStructureFromCandles(candles);
  const adxComputed = candles ? adxWilder(candles, 14) : null;
  const ticksComputed = tickMetricsFromTicks(ticks);

  const closes = candles ? candles.map((candle) => candle.close) : null;
  const rsiComputed = closes ? rsiWilder(closes, 14) : null;
  const rsiPreviousComputed = closes && closes.length > 18 ? rsiWilder(closes.slice(0, -3), 14) : null;

  const atr = gated("atr", volatilitySnap.atr, volatilityComputed?.atr ?? null);
  const atrRatio = gated("atrRatio", volatilitySnap.atrRatio, volatilityComputed?.atrRatio ?? null);
  const compressionFlag = volatilitySnap.compression === true || (atrRatio !== null && atrRatio <= 0.75) || (volatilityComputed?.atrRatio ?? 1) <= 0.75;
  const expansionFlag = volatilitySnap.expansion === true || (atrRatio !== null && atrRatio >= 1.35) || (volatilityComputed?.atrRatio ?? 1) >= 1.35;
  const expansionEvent = snapshot.events?.expansion === true;
  const compressionEvent = snapshot.events?.compression === true;
  const expansionStarted = expansionFlag || expansionEvent;
  let volatilityState = "UNKNOWN";
  if (compressionFlag) volatilityState = "COMPRESSION";
  else if (expansionStarted) volatilityState = "EXPANSION";
  else if (atrRatio !== null || atr !== null) volatilityState = "NORMAL";

  const eventsSource = snapshot.events && typeof snapshot.events === "object" ? snapshot.events : (raw.events && typeof raw.events === "object" ? raw.events : {});
  const lastCandle = candles ? candles[candles.length - 1] : null;
  const candleRange = lastCandle ? lastCandle.high - lastCandle.low : null;
  const candleBody = lastCandle ? Math.abs(lastCandle.close - lastCandle.open) : null;
  const bodyRatio = gated("bodyRatio", microstructureSnap.bodyRatio, lastCandle && candleRange > 0 ? candleBody / candleRange : null);
  const upperWick = gated("upperWick", microstructureSnap.upperWick, lastCandle && candleRange > 0 ? (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) / candleRange : null);
  const lowerWick = gated("lowerWick", microstructureSnap.lowerWick, lastCandle && candleRange > 0 ? (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) / candleRange : null);
  const bearishCandle = lastCandle ? lastCandle.close < lastCandle.open : null;
  const bullishCandle = lastCandle ? lastCandle.close > lastCandle.open : null;

  const rejectionUp = eventsSource.rejectionUp === true || (upperWick !== null && upperWick >= 0.55 && bearishCandle === true);
  const rejectionDown = eventsSource.rejectionDown === true || (lowerWick !== null && lowerWick >= 0.55 && bullishCandle === true);

  let breakoutUp = eventsSource.breakoutUp === true;
  let breakoutDown = eventsSource.breakoutDown === true;
  let failedBreakoutUp = eventsSource.failedBreakoutUp === true;
  let failedBreakoutDown = eventsSource.failedBreakoutDown === true;
  const retestUp = eventsSource.retestUp === true;
  const retestDown = eventsSource.retestDown === true;
  let pullbackUp = eventsSource.pullbackUp === true;
  let pullbackDown = eventsSource.pullbackDown === true;
  if (candles && candles.length >= 12 && structureComputed) {
    const window = candles.slice(-12, -1);
    const lastClose = lastCandle.close;
    if (structureComputed.label === "UP") pullbackUp = pullbackUp || (lastClose < Math.max(...window.map((candle) => candle.high)) && lastClose > Math.min(...window.slice(-5).map((candle) => candle.low)));
    if (structureComputed.label === "DOWN") pullbackDown = pullbackDown || (lastClose > Math.min(...window.map((candle) => candle.low)) && lastClose < Math.max(...window.slice(-5).map((candle) => candle.high)));
  }
  let extensionUpATR = null, extensionDownATR = null;
  if (candles && candles.length >= 22 && atr) {
    const priorWindow = candles.slice(-21, -1);
    const priorHigh = Math.max(...priorWindow.map((candle) => candle.high));
    const priorLow = Math.min(...priorWindow.map((candle) => candle.low));
    const close = lastCandle.close;
    extensionUpATR = (close - priorHigh) / atr;
    extensionDownATR = (priorLow - close) / atr;
    if (extensionUpATR > 0.05) breakoutUp = true;
    if (extensionDownATR > 0.05) breakoutDown = true;
    if (lastCandle.high > priorHigh + 0.1 * atr && close <= priorHigh) failedBreakoutUp = true;
    if (lastCandle.low < priorLow - 0.1 * atr && close >= priorLow) failedBreakoutDown = true;
  }
  const distanceToUpperATR = gated("distanceToUpperATR", locationSnap.distanceToUpperATR, null);
  const distanceToLowerATR = gated("distanceToLowerATR", locationSnap.distanceToLowerATR, null);
  if (extensionUpATR === null && distanceToUpperATR !== null) extensionUpATR = -distanceToUpperATR;
  if (extensionDownATR === null && distanceToLowerATR !== null) extensionDownATR = -distanceToLowerATR;

  const channelHigh = gated("channelHigh", locationSnap.channelHigh, rangeComputed?.rangeHigh ?? null);
  const channelLow = gated("channelLow", locationSnap.channelLow, rangeComputed?.rangeLow ?? null);
  const donchianPosition = gated("donchianPosition", locationSnap.donchianPosition, rangeComputed?.position ?? donchian(candles ?? [], 20)?.position ?? null);
  const rangeHigh = num(rangeSnap.rangeHigh) ?? rangeComputed?.rangeHigh ?? channelHigh;
  const rangeLow = num(rangeSnap.rangeLow) ?? rangeComputed?.rangeLow ?? channelLow;
  const rangeWidth = rangeHigh !== null && rangeLow !== null ? rangeHigh - rangeLow : null;
  const rangeMid = rangeWidth !== null ? (rangeHigh + rangeLow) / 2 : null;
  const position = donchianPosition;
  const range = {
    rangeHigh: round(rangeHigh, 6), rangeLow: round(rangeLow, 6), rangeMid: round(rangeMid, 6), rangeWidth: round(rangeWidth, 6),
    position: round(position, 4), available: rangeWidth !== null && rangeWidth > 0,
    edgeStabilityHigh: typeof rangeSnap.edgeStabilityHigh === "boolean" ? rangeSnap.edgeStabilityHigh : rangeComputed?.edgeStabilityHigh ?? null,
    edgeStabilityLow: typeof rangeSnap.edgeStabilityLow === "boolean" ? rangeSnap.edgeStabilityLow : rangeComputed?.edgeStabilityLow ?? null,
    touchesHigh: num(rangeSnap.touchesHigh) ?? rangeComputed?.touchesHigh ?? null,
    touchesLow: num(rangeSnap.touchesLow) ?? rangeComputed?.touchesLow ?? null,
    source: rangeComputed ? "CANDLES_DERIVED" : rangeWidth !== null ? "FEATURES" : "UNAVAILABLE",
  };

  const zone = position === null ? "UNKNOWN"
    : position >= 0.8 ? "AT_TOP"
    : position <= 0.2 ? "AT_BOTTOM"
    : position > 0.55 ? "UPPER_HALF"
    : position < 0.45 ? "LOWER_HALF"
    : "MID";

  const structureLabelRaw = features.structureLabel ?? structureSnap.label ?? structureComputed?.label ?? "UNKNOWN";
  const structureLabel = typeof structureLabelRaw === "string" && structureLabelRaw.length ? structureLabelRaw : "UNKNOWN";
  const breakOfStructure = textOrNull(structureSnap.breakOfStructure) ?? bosComputed;

  const rsi = gated("rsi14", momentumSnap.rsi14, rsiComputed);
  let rsiTrajectory = null;
  const rsiSlope = free("rsiSlope", momentumSnap.rsiSlope, null);
  const rsiPrev = free("rsiPrev", momentumSnap.rsi14Prev, rsiPreviousComputed);
  if (rsiSlope !== null) rsiTrajectory = rsiSlope > 0.5 ? "RISING" : rsiSlope < -0.5 ? "FALLING" : "FLAT";
  else if (rsi !== null && rsiPrev !== null) rsiTrajectory = rsi - rsiPrev > 0.75 ? "RISING" : rsi - rsiPrev < -0.75 ? "FALLING" : "FLAT";

  const velocityValue = free("velocity", momentumSnap.velocity, null);
  const accelerationValue = free("acceleration", momentumSnap.acceleration, null);
  const adx = gated("adx14", strengthSnap.adx14, adxComputed?.adx ?? null);
  const plusDI = gated("plusDI", strengthSnap.plusDI, adxComputed?.plusDI ?? null);
  const minusDI = gated("minusDI", strengthSnap.minusDI, adxComputed?.minusDI ?? null);
  const diSpread = plusDI !== null && minusDI !== null ? plusDI - minusDI : free("diSpread", strengthSnap.diSpread, null);

  const higherDirection = textOrNull(raw.candlesHigherDirection)
    ?? textOrNull(snapshot.multiTimeframe?.higher)
    ?? (higherCandles ? trendFromCandles(higherCandles)?.direction ?? null : null);
  const primaryDirection = textOrNull(snapshot.multiTimeframe?.primary) ?? (trendComputed?.direction ?? null);
  const multiTimeframe = {
    primary: primaryDirection ?? "UNKNOWN",
    higher: higherDirection ?? "UNKNOWN",
    alignment: primaryDirection && higherDirection ? (primaryDirection === higherDirection ? "ALIGNED" : "CONFLICT") : "UNKNOWN",
    available: Boolean(primaryDirection && higherDirection),
  };

  const trendMajor = higherDirection
    ? { direction: higherDirection, source: higherCandles ? "CANDLES_DERIVED" : "SNAPSHOT" }
    : (trendComputed ? { direction: trendComputed.direction, source: "CANDLES_DERIVED" } : null);
  const trendRecent = primaryDirection ? { direction: primaryDirection, slope: trendComputed?.slope ?? null, source: trendComputed ? "CANDLES_DERIVED" : "SNAPSHOT" } : null;

  const tickBehavior = ticksComputed ?? {
    available: false, count: 0, upRatio: null, direction: "UNKNOWN", movement: null, volatility: null, lastDelta: null, maxAbsDelta: null, source: "UNAVAILABLE",
  };

  const freshValue = raw.fresh === true || snapshot.fresh === true || freshnessSnap.fresh === true ? true
    : raw.fresh === false || snapshot.fresh === false || freshnessSnap.fresh === false ? false : null;
  const tickAgeMs = free("tickAgeMs", freshnessSnap.tickAgeMs, null);
  let feedState = "UNKNOWN";
  if (freshValue === false) feedState = "STALE";
  else if (tickAgeMs !== null && tickAgeMs > 60000) feedState = "STALE";
  else if (freshValue === true || (tickAgeMs !== null && tickAgeMs <= 15000)) feedState = "FRESH";
  const feedQuality = { state: feedState, fresh: freshValue, tickAgeMs, source: freshValue !== null || tickAgeMs !== null ? "PROVIDED" : "UNAVAILABLE" };

  const conflicts = [];
  if ((structureLabel === "UP" && velocityValue !== null && velocityValue < 0) || (structureLabel === "DOWN" && velocityValue !== null && velocityValue > 0)) conflicts.push("STRUCTURE_MOMENTUM_CONFLICT");
  if (multiTimeframe.alignment === "CONFLICT") conflicts.push("MULTI_TIMEFRAME_CONFLICT");
  if (volatilityState === "EXPANSION" && !breakoutUp && !breakoutDown && structureLabel !== "UP" && structureLabel !== "DOWN") conflicts.push("EXPANSION_WITHOUT_DIRECTION");
  if (structureLabel === "RANGE" && (breakoutUp || breakoutDown)) conflicts.push("RANGE_BREAK_RISK");
  if (feedQuality.state === "STALE") conflicts.push("FEED_STALE");

  const snapshotValueFor = (key) => {
    const map = {
      rsi14: momentumSnap.rsi14, adx14: strengthSnap.adx14, plusDI: strengthSnap.plusDI, minusDI: strengthSnap.minusDI,
      streak: microstructureSnap.streak, bodyRatio: microstructureSnap.bodyRatio, upperWick: microstructureSnap.upperWick, lowerWick: microstructureSnap.lowerWick,
      donchianPosition: locationSnap.donchianPosition, distanceToUpperATR: locationSnap.distanceToUpperATR, distanceToLowerATR: locationSnap.distanceToLowerATR,
      channelHigh: locationSnap.channelHigh, channelLow: locationSnap.channelLow, atr: volatilitySnap.atr, atrRatio: volatilitySnap.atrRatio,
    };
    return map[key] ?? null;
  };
  const featuresUsed = [];
  for (const key of Object.keys(FEATURE_COMPONENTS)) {
    const component = FEATURE_COMPONENTS[key];
    if (component && disabledComponents.includes(component)) continue;
    const value = hasOwn(features, key) ? features[key] : useSnapshot ? snapshotValueFor(key) : null;
    if (value !== null && value !== undefined) featuresUsed.push(key);
  }
  if (hasOwn(features, "structureLabel") || useSnapshot) featuresUsed.push("structureLabel");
  if (hasOwn(features, "velocity") || (useSnapshot && num(momentumSnap.velocity) !== null)) featuresUsed.push("velocity");
  if (hasOwn(features, "acceleration") || (useSnapshot && num(momentumSnap.acceleration) !== null)) featuresUsed.push("acceleration");
  if (candles) featuresUsed.push("candles");
  if (higherCandles) featuresUsed.push("candlesHigher");
  if (ticks) featuresUsed.push("ticks");
  if (Object.keys(eventsSource).length) featuresUsed.push("events");

  if (!candles) {
    unavailable.push("candles:NOT_PROVIDED");
    if (volatilitySnap.atrRatio === undefined) unavailable.push("realizedVolatility:UNAVAILABLE", "bbw:UNAVAILABLE", "donchianWidth:UNAVAILABLE", "atrTrajectory:UNAVAILABLE");
  } else {
    if (!volatilityComputed?.bbwValidated) unavailable.push("bbw:INSUFFICIENT_SAMPLES");
    if (volatilityComputed?.realizedVol === null) unavailable.push("realizedVolatility:INSUFFICIENT_SAMPLES");
  }
  if (!ticks) unavailable.push("ticks:NOT_PROVIDED", "tickMicrostructure:UNAVAILABLE");
  if (!isOtc && num(snapshot.volume) === null && num(raw.volume) === null) unavailable.push("volume:NOT_PROVIDED");
  if (!isOtc && snapshot.orderBook === undefined && raw.orderBook === undefined) unavailable.push("orderBook:NOT_PROVIDED");
  if (rsi === null) unavailable.push("rsi14:NOT_PROVIDED");
  if (adx === null) unavailable.push("adx14:NOT_PROVIDED");
  if (rsiTrajectory === null) unavailable.push("rsiTrajectory:UNAVAILABLE");
  if (trendMajor === null) unavailable.push("multiTimeframe:UNAVAILABLE");
  if (!range.available) unavailable.push("rangeBounds:UNAVAILABLE");

  const volatility = {
    state: volatilityState, atr: round(atr, 6), atrRatio: round(atrRatio, 4),
    atrTrajectory: volatilityComputed?.atrTrajectory ?? null,
    realizedVol: volatilityComputed?.realizedVol ?? null,
    realVolRatio: volatilityComputed?.realVolRatio ?? null,
    donchianWidth: volatilityComputed?.donchianWidth ?? null,
    donchianWidthATR: volatilityComputed?.donchianWidthATR ?? null,
    bbw: volatilityComputed?.bbw ?? null,
    bbwValidated: volatilityComputed?.bbwValidated === true,
    rangeRatio: volatilityComputed?.rangeRatio ?? null,
    compressed: compressionFlag, expansionStarted, compressionEvent, expansionEvent,
    source: volatilityComputed ? "CANDLES_DERIVED" : atrRatio !== null ? "FEATURES" : "UNAVAILABLE",
  };

  const candleBehavior = {
    bodyRatio: round(bodyRatio, 4), upperWick: round(upperWick, 4), lowerWick: round(lowerWick, 4),
    bullish: bullishCandle, bearish: bearishCandle, rejectionUp, rejectionDown,
    pattern: rejectionUp ? "REJECTION_UP" : rejectionDown ? "REJECTION_DOWN"
      : bodyRatio === null ? "UNKNOWN"
      : bodyRatio >= 0.6 ? (bullishCandle ? "STRONG_BULL" : bearishCandle ? "STRONG_BEAR" : "LARGE_BODY")
      : bodyRatio <= 0.25 ? "DOJI_OR_SMALL_BODY" : "NORMAL",
    source: lastCandle ? "CANDLES_DERIVED" : bodyRatio !== null ? "FEATURES" : "UNAVAILABLE",
  };

  return {
    multiTimeframe, trendMajor, trendRecent, volatility,
    structure: {
      label: structureLabel, breakOfStructure,
      higherHigh: structureComputed?.higherHigh ?? null, higherLow: structureComputed?.higherLow ?? null,
      lowerHigh: structureComputed?.lowerHigh ?? null, lowerLow: structureComputed?.lowerLow ?? null,
      source: features.structureLabel ? "FEATURES" : structureSnap.label ? "SNAPSHOT" : structureComputed ? "CANDLES_DERIVED" : "UNAVAILABLE",
    },
    location: {
      zone, position: round(position, 4), donchianPosition: round(position, 4),
      channelHigh: round(channelHigh, 6), channelLow: round(channelLow, 6),
      distanceToUpperATR: round(distanceToUpperATR, 4), distanceToLowerATR: round(distanceToLowerATR, 4),
      source: providedFeatures !== null || locationSnap.donchianPosition !== undefined ? "PROVIDED" : rangeComputed ? "CANDLES_DERIVED" : "UNAVAILABLE",
    },
    supportResistance: {
      support: round(rangeLow, 6), resistance: round(rangeHigh, 6), mid: round(rangeMid, 6),
      available: range.available, source: range.source,
    },
    candleBehavior, tickBehavior,
    velocity: { value: round(velocityValue, 8), source: velocityValue !== null ? "PROVIDED" : "UNAVAILABLE" },
    acceleration: { value: round(accelerationValue, 8), source: accelerationValue !== null ? "PROVIDED" : "UNAVAILABLE" },
    feedQuality, unavailable: uniqueStrings(unavailable), leakageIgnored,
    adx: round(adx, 4), plusDI: round(plusDI, 4), minusDI: round(minusDI, 4), diSpread: round(diSpread, 4),
    rsi: round(rsi, 4), rsiTrajectory,
    events: {
      breakoutUp, breakoutDown, failedBreakoutUp, failedBreakoutDown,
      retestUp, retestDown, pullbackUp, pullbackDown, rejectionUp, rejectionDown,
      compression: compressionEvent, expansion: expansionEvent,
      extensionUpATR: round(extensionUpATR, 4), extensionDownATR: round(extensionDownATR, 4),
    },
    range, conflicts,
    featuresUsed: uniqueStrings(featuresUsed),
    marketType: marketType ?? null, isOtc,
    directionHint: textOrNull(raw.direction),
    traderCriticDivergence: hasTraderCriticDivergence(raw),
  };
}

/* ------------------------------------------------------------------ classifyRegime */

function normalizeContext(context) {
  if (isContext(context)) return context;
  return extractContext(context && typeof context === "object" ? context : {});
}

export function classifyRegime(context) {
  const ctx = normalizeContext(context);
  const evidenceFor = [], evidenceAgainst = [];
  const structureLabel = ctx.structure?.label ?? "UNKNOWN";
  const bos = ctx.structure?.breakOfStructure ?? null;
  const trendMajorDir = ctx.trendMajor?.direction ?? "UNKNOWN";
  const trendRecentDir = ctx.trendRecent?.direction ?? "UNKNOWN";
  const velocity = ctx.velocity?.value ?? null;
  const acceleration = ctx.acceleration?.value ?? null;
  const adx = ctx.adx ?? null, plusDI = ctx.plusDI ?? null, minusDI = ctx.minusDI ?? null;
  const diUp = plusDI !== null && minusDI !== null && plusDI > minusDI;
  const diDown = plusDI !== null && minusDI !== null && minusDI > plusDI;
  const diSpreadAbs = plusDI !== null && minusDI !== null ? Math.abs(plusDI - minusDI) : null;
  const volState = ctx.volatility?.state ?? "UNKNOWN";
  const atrRatio = ctx.volatility?.atrRatio ?? null;
  const range = ctx.range ?? {};
  const rangeStable = range.edgeStabilityHigh === true || range.edgeStabilityLow === true;
  const feedState = ctx.feedQuality?.state ?? "UNKNOWN";

  let upScore = 0, downScore = 0;
  const upLabels = [], downLabels = [];
  const addUp = (points, label) => { upScore += points; upLabels.push(label); };
  const addDown = (points, label) => { downScore += points; downLabels.push(label); };
  if (structureLabel === "UP") addUp(2, "STRUCTURE_UP");
  if (structureLabel === "DOWN") addDown(2, "STRUCTURE_DOWN");
  if (trendMajorDir === "UP") addUp(1.5, "TREND_MAJOR_UP");
  if (trendMajorDir === "DOWN") addDown(1.5, "TREND_MAJOR_DOWN");
  if (trendRecentDir === "UP") addUp(1, "TREND_RECENT_UP");
  if (trendRecentDir === "DOWN") addDown(1, "TREND_RECENT_DOWN");
  if (ctx.structure?.higherHigh === true && ctx.structure?.higherLow === true) addUp(0.75, "HIGHER_HIGH_HIGHER_LOW");
  if (ctx.structure?.lowerHigh === true && ctx.structure?.lowerLow === true) addDown(0.75, "LOWER_HIGH_LOWER_LOW");
  if (adx !== null && adx >= 20 && diUp) addUp(0.75, "ADX_ABOVE_20_WITH_DI_UP");
  if (adx !== null && adx >= 20 && diDown) addDown(0.75, "ADX_ABOVE_20_WITH_DI_DOWN");
  if (velocity !== null && velocity > 0) addUp(0.5, "MOMENTUM_UP");
  if (velocity !== null && velocity < 0) addDown(0.5, "MOMENTUM_DOWN");
  if (acceleration !== null && acceleration > 0) addUp(0.25, "ACCELERATION_UP");
  if (acceleration !== null && acceleration < 0) addDown(0.25, "ACCELERATION_DOWN");
  if (bos === "UP") addUp(0.75, "BREAK_OF_STRUCTURE_UP");
  if (bos === "DOWN") addDown(0.75, "BREAK_OF_STRUCTURE_DOWN");

  let rangeScore = 0;
  const rangeLabels = [];
  const addRange = (points, label) => { rangeScore += points; rangeLabels.push(label); };
  if (structureLabel === "RANGE") addRange(1.5, "STRUCTURE_RANGE");
  if (upScore < 2 && downScore < 2) addRange(1, "TREND_SCORES_LOW");
  if (trendMajorDir === "FLAT") addRange(0.75, "TREND_MAJOR_FLAT");
  if (adx !== null && adx < 20) addRange(1, "ADX_BELOW_20");
  if (adx !== null && adx < 15) addRange(0.5, "ADX_BELOW_15");
  if (diSpreadAbs !== null && diSpreadAbs <= 6) addRange(1, "DI_SPREAD_SMALL");
  if (atrRatio !== null && atrRatio >= 0.55 && atrRatio <= 1.5) addRange(1, "ATR_RATIO_WITHIN_RANGE_BAND");
  if (range.available === true && range.rangeWidth > 0) addRange(1, "RANGE_BOUNDS_DEFINED");
  if (rangeStable) addRange(1.25, "RANGE_EDGES_STABLE");
  if (range.touchesHigh >= 2 && range.touchesLow >= 2) addRange(0.75, "RANGE_TOUCHED_BOTH_EDGES");

  const maxTrend = Math.max(upScore, downScore);
  const trendGap = Math.abs(upScore - downScore);
  const compressionEvidence = (volState === "COMPRESSION" ? 1 : 0) + (ctx.volatility?.compressed === true ? 1 : 0) + (atrRatio !== null && atrRatio <= 0.85 ? 1 : 0) + (ctx.volatility?.atrTrajectory === "NARROWING" ? 1 : 0);
  const expansionEvidence = (volState === "EXPANSION" ? 1 : 0) + (ctx.volatility?.expansionEvent === true ? 1 : 0) + (atrRatio !== null && atrRatio >= 1.35 ? 1 : 0) + ((ctx.events?.breakoutUp === true || ctx.events?.breakoutDown === true) ? 1 : 0);
  const conflicts = Array.isArray(ctx.conflicts) ? ctx.conflicts : [];

  if (feedState === "STALE") {
    evidenceAgainst.push("FEED_STALE");
    if (structureLabel === "UP") evidenceFor.push("STRUCTURE_UP");
    if (structureLabel === "DOWN") evidenceFor.push("STRUCTURE_DOWN");
    return { regime: REGIMES.UNCERTAIN, subRegime: null, evidenceFor, evidenceAgainst, confidence: "LOW" };
  }

  if (compressionEvidence >= 2 && maxTrend < 2.5) {
    evidenceFor.push("COMPRESSION_VOLATILITY", volState === "COMPRESSION" ? "VOL_STATE_COMPRESSION" : "ATR_RELATIVE_LOW");
    if (ctx.volatility?.atrTrajectory === "NARROWING") evidenceFor.push("ATR_TRAJECTORY_NARROWING");
    if (ctx.volatility?.donchianWidthATR !== null && ctx.volatility?.donchianWidthATR <= 3) evidenceFor.push("DONCHIAN_WIDTH_NARROW");
    if (ctx.volatility?.bbwValidated && ctx.volatility?.bbw !== null && ctx.volatility?.bbw <= 0.02) evidenceFor.push("BBW_NARROW");
    if (upScore >= 2) evidenceAgainst.push(...upLabels.slice(0, 1));
    if (downScore >= 2) evidenceAgainst.push(...downLabels.slice(0, 1));
    return { regime: REGIMES.COMPRESSION, subRegime: ctx.volatility?.atrTrajectory === "NARROWING" ? "NARROWING" : "STABLE", evidenceFor: uniqueStrings(evidenceFor), evidenceAgainst, confidence: compressionEvidence >= 3 ? "HIGH" : "MEDIUM" };
  }

  if (maxTrend >= 3 && trendGap >= 1.25) {
    const up = upScore >= downScore;
    const winner = up ? upLabels : downLabels;
    const loser = up ? downLabels : upLabels;
    evidenceFor.push(...winner);
    if (trendGap < 2.5) evidenceAgainst.push("TREND_GAP_MODERATE");
    if (loser.length) evidenceAgainst.push(...loser.slice(0, 2));
    if (volState === "EXPANSION") evidenceFor.push("VOLATILITY_EXPANSION_CONFIRMS_TREND");
    const confidence = maxTrend >= 5 && trendGap >= 2.5 ? "HIGH" : maxTrend >= 4 ? "MEDIUM" : "LOW";
    return { regime: up ? REGIMES.TREND_UP : REGIMES.TREND_DOWN, subRegime: maxTrend >= 5 ? "STRONG" : "WEAK", evidenceFor: uniqueStrings(evidenceFor), evidenceAgainst, confidence };
  }

  if (expansionEvidence >= 1 && volState === "EXPANSION") {
    evidenceFor.push("VOL_STATE_EXPANSION");
    if (atrRatio !== null && atrRatio >= 1.35) evidenceFor.push("ATR_RATIO_HIGH");
    const breakout = ctx.events?.breakoutUp === true || ctx.events?.breakoutDown === true;
    if (breakout) evidenceFor.push("BREAKOUT_EVENT");
    if (maxTrend >= 2.5) {
      evidenceFor.push(...(upScore >= downScore ? upLabels : downLabels));
      evidenceAgainst.push(...(upScore >= downScore ? upLabels.slice(0, 1) : downLabels.slice(0, 1)));
    }
    return { regime: REGIMES.EXPANSION, subRegime: breakout ? "BREAKOUT_STARTED" : "VOLATILITY_ONLY", evidenceFor: uniqueStrings(evidenceFor), evidenceAgainst, confidence: expansionEvidence >= 2 ? "MEDIUM" : "LOW" };
  }

  if (rangeScore >= 3) {
    evidenceFor.push(...rangeLabels);
    if (upScore >= 2 || downScore >= 2) evidenceAgainst.push(...(upScore >= downScore ? upLabels.slice(0, 1) : downLabels.slice(0, 1)));
    if (compressionEvidence >= 2) evidenceAgainst.push("COMPRESSION_OVERLAP");
    const confidence = rangeScore >= 4.5 && maxTrend < 2 ? "HIGH" : rangeScore >= 4 ? "MEDIUM" : "LOW";
    let subRegime = null;
    if (atrRatio !== null) subRegime = atrRatio <= 0.8 ? "TIGHT" : "WIDE";
    return { regime: REGIMES.RANGE, subRegime, evidenceFor: uniqueStrings(evidenceFor), evidenceAgainst, confidence };
  }

  if ((adx !== null && adx >= 25) && (structureLabel === "UNKNOWN" || structureLabel === "RANGE") && (ctx.structure?.breakOfStructure ?? null) === null) {
    evidenceFor.push("ADX_ALONE_WITHOUT_STRUCTURE");
    if (plusDI !== null && minusDI !== null) evidenceFor.push(diUp ? "DI_UP_BUT_NO_STRUCTURE" : diDown ? "DI_DOWN_BUT_NO_STRUCTURE" : "DI_FLAT");
    evidenceAgainst.push("STRUCTURE_UNDEFINED");
    return { regime: REGIMES.TRANSITION, subRegime: null, evidenceFor: uniqueStrings(evidenceFor), evidenceAgainst, confidence: "LOW" };
  }

  if (maxTrend >= 1.5 || conflicts.length) {
    evidenceFor.push("MIXED_EVIDENCE", ...conflicts);
    if (maxTrend >= 1.5) evidenceFor.push(...(upScore >= downScore ? upLabels.slice(0, 2) : downLabels.slice(0, 2)));
    if (adx !== null && adx >= 25 && (structureLabel === "UNKNOWN" || structureLabel === "RANGE")) evidenceFor.push("ADX_ALONE_WITHOUT_STRUCTURE");
    return {
      regime: REGIMES.TRANSITION, subRegime: null,
      evidenceFor: uniqueStrings(evidenceFor),
      evidenceAgainst: uniqueStrings([...(upScore >= 2 ? upLabels.slice(0, 1) : []), ...(downScore >= 2 ? downLabels.slice(0, 1) : [])]),
      confidence: "LOW",
    };
  }

  evidenceFor.push("INSUFFICIENT_STRUCTURAL_EVIDENCE");
  if (ctx.unavailable?.length) evidenceAgainst.push("FEATURES_UNAVAILABLE");
  return { regime: REGIMES.UNCERTAIN, subRegime: null, evidenceFor, evidenceAgainst, confidence: "LOW" };
}

/* ------------------------------------------------------------------ assessments dos 8 cenarios */

function trendDirectionOf(ctx, regimeName) {
  if (ctx.structure?.label === "UP" || ctx.structure?.label === "DOWN") return ctx.structure.label;
  if (regimeName === "TREND_UP") return "UP";
  if (regimeName === "TREND_DOWN") return "DOWN";
  if (ctx.trendMajor?.direction === "UP" || ctx.trendMajor?.direction === "DOWN") return ctx.trendMajor.direction;
  return null;
}

function baseAssessment(scenario) {
  return {
    scenario, score: 0, evidenceFor: [], evidenceAgainst: [], invalidations: [], waitConditions: [],
    direction: null, hardTrigger: false, entryReady: false, triggerState: "NONE", byDesignAmbiguous: false,
  };
}

function assessTrendContinuation(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.TREND_CONTINUATION);
  const dir = trendDirectionOf(ctx, regimeName);
  if (!dir) { a.evidenceAgainst.push("NO_TREND_DIRECTION"); return a; }
  const up = dir === "UP";
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const st = ctx.structure?.label;
  const pos = ctx.location?.position ?? null;
  const vel = ctx.velocity?.value ?? null;
  const acc = ctx.acceleration?.value ?? null;
  const tickDir = ctx.tickBehavior?.direction ?? "UNKNOWN";
  if (st === dir) addFor(2, "TREND_STRUCTURE_ALIGNED");
  if ((up && regimeName === "TREND_UP") || (!up && regimeName === "TREND_DOWN")) addFor(2, "REGIME_TREND_CONFIRMED");
  if (ctx.trendMajor?.direction === dir) addFor(1, "TREND_MAJOR_ALIGNED");
  if (vel !== null && ((up && vel > 0) || (!up && vel < 0))) addFor(1, "MOMENTUM_ALIGNED");
  if (acc !== null && ((up && acc > 0) || (!up && acc < 0))) addFor(0.5, "ACCELERATION_ALIGNED");
  if (pos !== null && ((up && pos >= 0.45) || (!up && pos <= 0.55))) addFor(1, "LOCATION_WITH_TREND");
  if ((up ? ctx.candleBehavior?.rejectionUp : ctx.candleBehavior?.rejectionDown) === false) addFor(0.5, "NO_REJECTION_AGAINST_TREND");
  if (ctx.candleBehavior?.bodyRatio !== null && ctx.candleBehavior?.bodyRatio >= 0.45) addFor(0.5, "BODY_PRESENT");
  if ((up && ctx.events?.breakoutUp) || (!up && ctx.events?.breakoutDown)) addFor(1, "CONTINUATION_BREAKOUT");
  if ((up && tickDir === "UP") || (!up && tickDir === "DOWN")) addFor(0.5, "TICKS_ALIGNED");
  if (ctx.feedQuality?.state === "FRESH") addFor(0.5, "FEED_FRESH");
  if (st === "RANGE") { addAgainst(1.5, "STRUCTURE_RANGE"); a.invalidations.push("STRUCTURE_NOT_ALIGNED"); }
  if (st === (up ? "DOWN" : "UP")) { addAgainst(3, "STRUCTURE_AGAINST_TREND"); a.invalidations.push("STRUCTURE_AGAINST_TREND"); }
  if (ctx.structure?.breakOfStructure === (up ? "DOWN" : "UP")) { addAgainst(1.5, "BREAK_OF_STRUCTURE_AGAINST"); a.invalidations.push("BREAK_OF_STRUCTURE_AGAINST"); }
  if (ctx.volatility?.state === "COMPRESSION") addAgainst(1, "VOLATILITY_COMPRESSION");
  if (regimeName === "RANGE" || regimeName === "COMPRESSION" || regimeName === "TRANSITION" || regimeName === "UNCERTAIN") addAgainst(1.5, `REGIME_${regimeName}`);
  if (vel !== null && ((up && vel < 0) || (!up && vel > 0))) addAgainst(1, "MOMENTUM_AGAINST");
  if (pos !== null && ((up && pos >= 0.85) || (!up && pos <= 0.15))) { addAgainst(1, "REJECTION_AT_EXTREME"); a.invalidations.push("REJECTION_AT_EXTREME"); }
  if (pos !== null && ((up && pos <= 0.3) || (!up && pos >= 0.7))) addAgainst(1, "LOCATION_COUNTER_TREND");
  if ((ctx.volatility?.atrRatio ?? 0) >= 2.2) addAgainst(0.5, "VOLATILITY_STRETCHED");
  a.direction = up ? "BUY" : "SELL";
  a.score = Math.max(0, a.score);
  a.hardTrigger = a.score >= 6 && a.invalidations.length === 0;
  a.entryReady = a.score >= 5 && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE" && a.direction !== null;
  a.triggerState = a.hardTrigger ? "CONFIRMED" : a.score >= 4 ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_STRUCTURE_AND_MOMENTUM_ALIGNMENT", "WAIT_FOR_NON_EXTENDED_LOCATION");
  return a;
}

function assessTrendPullback(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.TREND_PULLBACK);
  const dir = trendDirectionOf(ctx, regimeName);
  if (!dir) { a.evidenceAgainst.push("NO_TREND_DIRECTION"); return a; }
  const up = dir === "UP";
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const st = ctx.structure?.label;
  const pos = ctx.location?.position ?? null;
  const vel = ctx.velocity?.value ?? null;
  const rsi = ctx.rsi ?? null;
  if (st === dir) addFor(2, "TREND_STRUCTURE_ALIGNED");
  if ((up && ctx.events?.pullbackUp) || (!up && ctx.events?.pullbackDown)) addFor(2, "PULLBACK_EVENT");
  if ((up && ctx.events?.retestUp) || (!up && ctx.events?.retestDown)) addFor(1.5, "RETEST_OF_LEVEL");
  const inPullbackZone = pos !== null && (up ? pos >= 0.25 && pos <= 0.65 : pos >= 0.35 && pos <= 0.75);
  if (inPullbackZone) addFor(2, "PULLBACK_RETRACE_ZONE");
  if (ctx.trendMajor?.direction === dir) addFor(1, "TREND_MAJOR_ALIGNED");
  if (vel !== null && ((up && vel < 0) || (!up && vel > 0))) addFor(1, "PULLBACK_MOMENTUM_WEAKENING");
  if (rsi !== null && rsi >= 38 && rsi <= 62) addFor(0.5, "RSI_IN_VALUE_BAND");
  if (ctx.structure?.breakOfStructure !== (up ? "DOWN" : "UP")) addFor(1, "SWING_HELD");
  if ((up && ctx.tickBehavior?.direction === "DOWN") || (!up && ctx.tickBehavior?.direction === "UP")) addFor(0.5, "TICKS_RETRACING");
  if (ctx.feedQuality?.state === "FRESH") addFor(0.5, "FEED_FRESH");
  if (st === (up ? "DOWN" : "UP")) { addAgainst(3, "STRUCTURE_BROKEN"); a.invalidations.push("STRUCTURE_BROKEN"); }
  if (ctx.structure?.breakOfStructure === (up ? "DOWN" : "UP")) { addAgainst(2, "BREAK_OF_STRUCTURE"); a.invalidations.push("BREAK_OF_STRUCTURE_AGAINST"); }
  if (ctx.volatility?.state === "COMPRESSION") addAgainst(0.5, "VOLATILITY_COMPRESSION");
  if (pos !== null && ((up && pos >= 0.85) || (!up && pos <= 0.15))) { addAgainst(1, "LOCATION_AT_EXTREME"); a.invalidations.push("LOCATION_AT_EXTREME"); }
  if ((up ? ctx.candleBehavior?.rejectionUp : ctx.candleBehavior?.rejectionDown) === true) addAgainst(1, "REJECTION_AGAINST_PULLBACK");
  if (regimeName !== "TREND_UP" && regimeName !== "TREND_DOWN") addAgainst(1.5, `REGIME_${regimeName}`);
  if (rsi !== null && (up ? rsi > 80 : rsi < 20)) addAgainst(0.5, "RSI_EXTREME_AGAINST_PULLBACK");
  a.direction = up ? "BUY" : "SELL";
  a.score = Math.max(0, a.score);
  a.hardTrigger = a.score >= 7 && a.invalidations.length === 0;
  a.entryReady = a.score >= 5.5 && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE";
  a.triggerState = a.hardTrigger ? "CONFIRMED" : a.score >= 4.5 ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_PULLBACK_ZONE_AND_HELD_SWING", "WAIT_FOR_RESUMPTION_CANDLE");
  return a;
}

function breakoutDirection(ctx) {
  const up = ctx.events?.breakoutUp === true, down = ctx.events?.breakoutDown === true;
  if (up && !down) return "UP";
  if (down && !up) return "DOWN";
  if (up && down) return null;
  const pos = ctx.location?.position ?? null;
  if (pos !== null && pos >= 0.9) return "UP";
  if (pos !== null && pos <= 0.1) return "DOWN";
  return null;
}

function assessBreakout(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.BREAKOUT);
  const dir = breakoutDirection(ctx);
  if (!dir) { a.evidenceAgainst.push("NO_BREAKOUT_DIRECTION"); return a; }
  const up = dir === "UP";
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const event = up ? ctx.events?.breakoutUp === true : ctx.events?.breakoutDown === true;
  const failed = up ? ctx.events?.failedBreakoutUp === true : ctx.events?.failedBreakoutDown === true;
  const extension = up ? (ctx.events?.extensionUpATR ?? null) : (ctx.events?.extensionDownATR ?? null);
  const pos = ctx.location?.position ?? null;
  const body = ctx.candleBehavior?.bodyRatio ?? null;
  const adverseWick = up ? (ctx.candleBehavior?.upperWick ?? null) : (ctx.candleBehavior?.lowerWick ?? null);
  const vel = ctx.velocity?.value ?? null;
  const tickDir = ctx.tickBehavior?.direction ?? "UNKNOWN";
  if (event) addFor(3, "BREAKOUT_EVENT");
  if (extension !== null && extension >= 0.1) addFor(1, "CLOSE_BEYOND_LEVEL");
  else if (extension !== null && extension > 0) addFor(0.5, "MARGINAL_CLOSE_BEYOND_LEVEL");
  if (body !== null && body >= 0.5) addFor(1, "BODY_DOMINANT");
  if (ctx.volatility?.state === "EXPANSION") addFor(1, "EXPANSION_CONFIRMED");
  if (tickDir === dir) addFor(1, "TICKS_ALIGNED");
  if (ctx.volatility?.compressed === true && ctx.volatility?.expansionStarted) addFor(0.5, "COMPRESSION_RELEASE");
  if (ctx.structure?.label === dir) addFor(0.5, "STRUCTURE_EMERGING");
  if (ctx.feedQuality?.state === "FRESH") addFor(0.5, "FEED_FRESH");
  if (failed) { addAgainst(3, "BREAKOUT_FAILED_CLOSE_BACK_INSIDE"); a.invalidations.push("BREAKOUT_FAILED_CLOSE_BACK_INSIDE"); }
  if (adverseWick !== null && adverseWick >= 0.5) { addAgainst(2, "UPPER_WICK_REJECTION"); a.invalidations.push("UPPER_WICK_REJECTION"); }
  if (body !== null && body <= 0.3) { addAgainst(1.5, "WEAK_BODY"); a.invalidations.push("NO_EXPANSION"); }
  if (vel !== null && ((up && vel <= 0) || (!up && vel >= 0))) { addAgainst(1.5, "MOMENTUM_AGAINST"); a.invalidations.push("MOMENTUM_CONFLICT"); }
  if (pos !== null && ((up && pos < 0.75) || (!up && pos > 0.25))) addAgainst(1, "LOCATION_NOT_AT_EDGE");
  if (extension !== null && Math.abs(extension) > 2.5) { addAgainst(1, "OVEREXTENDED_FROM_CHANNEL"); a.invalidations.push("OVEREXTENDED_FROM_CHANNEL"); }
  if (ctx.volatility?.state === "COMPRESSION" && !ctx.volatility?.expansionStarted) addAgainst(1, "NO_EXPANSION");
  if (regimeName === "RANGE") addAgainst(0.5, "REGIME_RANGE");
  a.direction = up ? "BUY" : "SELL";
  a.score = Math.max(0, a.score);
  a.hardTrigger = event && !failed && ((extension !== null && extension >= 0.05) || (body !== null && body >= 0.5));
  a.entryReady = a.score >= 5 && a.hardTrigger && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE";
  a.triggerState = a.entryReady ? "CONFIRMED" : a.hardTrigger ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_CLOSE_BEYOND_LEVEL", "WAIT_FOR_EXPANSION_AND_BODY", "WAIT_FOR_FRESH_TICKS");
  return a;
}

function assessFailedBreakout(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.FAILED_BREAKOUT);
  const failedUp = ctx.events?.failedBreakoutUp === true;
  const failedDown = ctx.events?.failedBreakoutDown === true;
  if (!failedUp && !failedDown) { a.evidenceAgainst.push("NO_FAILED_BREAKOUT_EVENT"); return a; }
  if (failedUp && failedDown) { a.evidenceAgainst.push("AMBIGUOUS_FAILED_BREAKOUT"); return a; }
  const up = failedUp;
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const rejection = up ? ctx.candleBehavior?.rejectionUp === true : ctx.candleBehavior?.rejectionDown === true;
  const wick = up ? (ctx.candleBehavior?.upperWick ?? null) : (ctx.candleBehavior?.lowerWick ?? null);
  const pos = ctx.location?.position ?? null;
  const vel = ctx.velocity?.value ?? null;
  const tickDir = ctx.tickBehavior?.direction ?? "UNKNOWN";
  addFor(3, up ? "PIERCE_UP_WITH_CLOSE_BACK_INSIDE" : "PIERCE_DOWN_WITH_CLOSE_BACK_INSIDE");
  if (rejection) addFor(2, "REJECTION_CONFIRMED");
  else if (wick !== null && wick >= 0.5) addFor(1.5, "REJECTION_WICK");
  const backInside = pos !== null && (up ? pos <= 0.8 : pos >= 0.2);
  if (backInside) addFor(1, "CLOSE_BACK_INSIDE_RANGE");
  if (vel !== null && ((up && vel <= 0) || (!up && vel >= 0))) addFor(1, "MOMENTUM_FADING");
  if ((up && tickDir === "DOWN") || (!up && tickDir === "UP")) addFor(1, "TICKS_AGAINST_PIERCE");
  if (ctx.volatility?.state === "EXPANSION") addFor(0.5, "VOLATILITY_SPIKE");
  const breakoutHolds = up
    ? (ctx.events?.breakoutUp === true && (ctx.events?.extensionUpATR ?? -1) > 0.1)
    : (ctx.events?.breakoutDown === true && (ctx.events?.extensionDownATR ?? -1) > 0.1);
  if (breakoutHolds) addAgainst(3, "ACCEPTANCE_BEYOND_LEVEL");
  if (!rejection && wick !== null && wick < 0.3) { addAgainst(1, "NO_REJECTION_CONFIRMATION"); a.invalidations.push("NO_REJECTION_CONFIRMATION"); }
  if (pos !== null && ((up && pos >= 0.95) || (!up && pos <= 0.05))) { addAgainst(1.5, "LOCATION_STILL_AT_BREAK_SIDE"); a.invalidations.push("ACCEPTANCE_BEYOND_LEVEL"); }
  if (ctx.candleBehavior?.bodyRatio !== null && ctx.candleBehavior?.bodyRatio >= 0.6 && ((up && ctx.candleBehavior?.bullish === true) || (!up && ctx.candleBehavior?.bearish === true))) {
    addAgainst(2, "STRONG_BODY_IN_BREAK_DIRECTION");
    a.invalidations.push("STRONG_BODY_IN_BREAK_DIRECTION");
  }
  if (regimeName === "RANGE" && ctx.range?.edgeStabilityHigh === false && ctx.range?.edgeStabilityLow === false) addAgainst(0.5, "RANGE_EDGES_UNSTABLE");
  a.direction = up ? "SELL" : "BUY";
  a.score = Math.max(0, a.score);
  a.hardTrigger = (rejection || (wick !== null && wick >= 0.5)) && backInside;
  a.entryReady = a.score >= 5 && a.hardTrigger && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE";
  a.triggerState = a.entryReady ? "CONFIRMED" : a.hardTrigger ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_CLOSE_BACK_INSIDE", "WAIT_FOR_REJECTION_CONFIRMATION");
  return a;
}

function assessRangeMeanReversion(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.RANGE_MEAN_REVERSION);
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const st = ctx.structure?.label ?? "UNKNOWN";
  const pos = ctx.location?.position ?? null;
  const adx = ctx.adx ?? null, plusDI = ctx.plusDI ?? null, minusDI = ctx.minusDI ?? null;
  const diSpreadAbs = plusDI !== null && minusDI !== null ? Math.abs(plusDI - minusDI) : null;
  const atrRatio = ctx.volatility?.atrRatio ?? null;
  const rangeProven = (regimeName === "RANGE" || st === "RANGE")
    && ctx.events?.breakoutUp !== true && ctx.events?.breakoutDown !== true
    && ctx.volatility?.state !== "EXPANSION";
  if (regimeName === "RANGE") addFor(2, "REGIME_RANGE_CONFIRMED");
  if (st === "RANGE") addFor(2, "STRUCTURE_RANGE_CONFIRMED");
  if (adx !== null && adx < 20) addFor(1, "ADX_BELOW_20");
  if (adx !== null && adx < 15) addFor(0.5, "ADX_BELOW_15");
  if (diSpreadAbs !== null && diSpreadAbs <= 5) addFor(1, "DI_SPREAD_SMALL");
  if (atrRatio !== null && atrRatio >= 0.55 && atrRatio <= 1.5) addFor(1, "VOLATILITY_WITHIN_RANGE_BAND");
  if (ctx.range?.available) addFor(0.5, "RANGE_BOUNDS_DEFINED");
  if (ctx.range?.edgeStabilityHigh === true && ctx.range?.edgeStabilityLow === true) addFor(1, "RANGE_EDGES_STABLE");
  else if (ctx.range?.edgeStabilityHigh === true || ctx.range?.edgeStabilityLow === true) addFor(0.5, "RANGE_EDGE_STABLE_ONE_SIDE");
  const atBase = pos !== null && pos <= 0.2;
  const atTop = pos !== null && pos >= 0.8;
  if (atBase || atTop) addFor(2, "RANGE_EDGE_LOCATION");
  if (atBase && ctx.candleBehavior?.rejectionDown === true) addFor(2, "EDGE_REJECTION_AT_BASE");
  if (atTop && ctx.candleBehavior?.rejectionUp === true) addFor(2, "EDGE_REJECTION_AT_TOP");
  if (atBase && ctx.rsiTrajectory === "RISING") addFor(1, "RSI_TURNING_UP_FROM_BASE");
  if (atTop && ctx.rsiTrajectory === "FALLING") addFor(1, "RSI_TURNING_DOWN_FROM_TOP");
  if ((atBase && ctx.rsi !== null && ctx.rsi <= 35) || (atTop && ctx.rsi !== null && ctx.rsi >= 65)) addFor(0.5, "RSI_AT_EDGE_EXTREME");
  if (ctx.feedQuality?.state === "FRESH") addFor(0.5, "FEED_FRESH");
  const mid = pos !== null && pos > 0.35 && pos < 0.65;
  if (mid) { addAgainst(2.5, "MID_LOCATION"); a.invalidations.push("MID_LOCATION"); }
  if (ctx.events?.breakoutUp === true || ctx.events?.breakoutDown === true) {
    addAgainst(4, "RANGE_BREAK_IN_PROGRESS");
    addAgainst(6, "RANGE_THESIS_COLLAPSED_BY_BREAKOUT");
    a.invalidations.push("RANGE_BREAK_IN_PROGRESS");
  }
  if (ctx.events?.failedBreakoutUp === true || ctx.events?.failedBreakoutDown === true) addAgainst(1, "RANGE_FAKEOUT_RISK");
  if (ctx.volatility?.state === "EXPANSION" || (atrRatio !== null && atrRatio >= 1.6)) { addAgainst(2, "RANGE_EXPANSION_RISK"); a.invalidations.push("RANGE_EXPANSION_RISK"); }
  if (adx !== null && adx >= 25 && diSpreadAbs !== null && diSpreadAbs > 5) { addAgainst(2, "BREAKOUT_RISK_ADX_DI"); a.invalidations.push("BREAKOUT_RISK_ADX_DI"); }
  if (st === "UP" || st === "DOWN") { addAgainst(2, "STRUCTURE_NOT_RANGE"); a.invalidations.push("STRUCTURE_NOT_RANGE"); }
  if ((atBase && ctx.rsi !== null && ctx.rsi <= 25 && ctx.candleBehavior?.rejectionDown !== true) || (atTop && ctx.rsi !== null && ctx.rsi >= 75 && ctx.candleBehavior?.rejectionUp !== true)) addAgainst(0.5, "RSI_EXTREME_WITHOUT_STRUCTURE");
  a.direction = atBase ? "BUY" : atTop ? "SELL" : null;
  a.score = Math.max(0, a.score);
  a.hardTrigger = rangeProven && (atBase || atTop)
    && ((atBase && ctx.candleBehavior?.rejectionDown === true) || (atTop && ctx.candleBehavior?.rejectionUp === true));
  a.entryReady = a.hardTrigger && a.score >= 5 && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE" && a.direction !== null;
  a.triggerState = a.entryReady ? "CONFIRMED" : a.hardTrigger ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_RANGE_EDGE_WITH_REJECTION", "WAIT_FOR_RANGE_PROOF_STABLE_EDGES", "WAIT_FOR_NO_BREAKOUT_RISK");
  return a;
}

function assessReversal(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.REVERSAL);
  const bos = ctx.structure?.breakOfStructure ?? null;
  let prior = null, dir = null;
  if (bos === "UP") { prior = "DOWN"; dir = "UP"; }
  else if (bos === "DOWN") { prior = "UP"; dir = "DOWN"; }
  else if (regimeName === "TREND_UP") { prior = "UP"; dir = "DOWN"; }
  else if (regimeName === "TREND_DOWN") { prior = "DOWN"; dir = "UP"; }
  else if (ctx.trendMajor?.direction === "UP" || ctx.trendMajor?.direction === "DOWN") { prior = ctx.trendMajor.direction; dir = prior === "UP" ? "DOWN" : "UP"; }
  if (!prior || !dir) { a.evidenceAgainst.push("NO_PRIOR_TREND"); return a; }
  const up = dir === "UP";
  const priorUp = prior === "UP";
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const st = ctx.structure?.label ?? "UNKNOWN";
  const pos = ctx.location?.position ?? null;
  const vel = ctx.velocity?.value ?? null;
  const acc = ctx.acceleration?.value ?? null;
  const tickDir = ctx.tickBehavior?.direction ?? "UNKNOWN";
  addFor(1, "PRIOR_TREND_ESTABLISHED");
  if (bos === dir) addFor(3, "BREAK_OF_STRUCTURE_CONFIRMED");
  else { addAgainst(2, "NO_STRUCTURE_BREAK"); a.invalidations.push("NO_STRUCTURE_BREAK"); }
  const extremeRejection = priorUp
    ? (ctx.candleBehavior?.rejectionUp === true && pos !== null && pos >= 0.75)
    : (ctx.candleBehavior?.rejectionDown === true && pos !== null && pos <= 0.25);
  if (extremeRejection) addFor(2, "REJECTION_AT_PRIOR_EXTREME");
  const divergence = priorUp
    ? (vel !== null && vel < 0 && (ctx.rsiTrajectory === "FALLING" || (ctx.rsi !== null && ctx.rsi >= 65)))
    : (vel !== null && vel > 0 && (ctx.rsiTrajectory === "RISING" || (ctx.rsi !== null && ctx.rsi <= 35)));
  if (divergence) addFor(2, "MOMENTUM_DIVERGENCE");
  const failedAtExtreme = priorUp ? ctx.events?.failedBreakoutUp === true : ctx.events?.failedBreakoutDown === true;
  if (failedAtExtreme) addFor(1.5, "FAILED_BREAKOUT_AT_EXTREME");
  if (ctx.volatility?.state === "EXPANSION" || ctx.volatility?.expansionStarted === true) addFor(1, "EXPANSION_CONFIRMS_REVERSAL");
  if (tickDir === dir) addFor(1, "TICKS_FLIPPED");
  if (acc !== null && ((up && acc > 0) || (!up && acc < 0))) addFor(0.5, "ACCELERATION_FLIPPED");
  if (st === prior && bos !== dir) addAgainst(2.5, "TREND_STRUCTURE_INTACT");
  if (ctx.rsi !== null && (priorUp ? ctx.rsi >= 70 : ctx.rsi <= 30) && bos !== dir) addAgainst(0.5, "RSI_EXTREME_WITHOUT_STRUCTURE");
  if (ctx.volatility?.state === "COMPRESSION") addAgainst(1, "VOLATILITY_COMPRESSION");
  const shallowPullback = priorUp ? (pos !== null && pos >= 0.4) : (pos !== null && pos <= 0.6);
  if (shallowPullback && bos !== dir) addAgainst(1, "SHALLOW_PULLBACK");
  if (regimeName === "RANGE") addAgainst(1.5, "REGIME_RANGE");
  a.direction = up ? "BUY" : "SELL";
  a.score = Math.max(0, a.score);
  a.hardTrigger = bos === dir;
  a.entryReady = a.hardTrigger && a.score >= 5.5 && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE";
  a.triggerState = a.entryReady ? "CONFIRMED" : a.hardTrigger ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_BREAK_OF_STRUCTURE", "WAIT_FOR_EXTREME_REJECTION", "WAIT_FOR_MOMENTUM_DIVERGENCE");
  return a;
}

function extensionWickOnly(ctx) {
  const up = ctx.events?.breakoutUp === true, down = ctx.events?.breakoutDown === true;
  if (up && ctx.events?.extensionUpATR !== null && ctx.events?.extensionUpATR <= 0.05 && (ctx.candleBehavior?.upperWick ?? 0) >= 0.45) return true;
  if (down && ctx.events?.extensionDownATR !== null && ctx.events?.extensionDownATR <= 0.05 && (ctx.candleBehavior?.lowerWick ?? 0) >= 0.45) return true;
  if (ctx.events?.expansion === true && !up && !down && (ctx.candleBehavior?.bodyRatio ?? 1) <= 0.3) return true;
  return false;
}

function assessCompressionExpansion(ctx, regimeName) {
  const a = baseAssessment(SCENARIOS.COMPRESSION_EXPANSION);
  const addFor = (points, label) => { a.score += points; a.evidenceFor.push(label); };
  const addAgainst = (points, label) => { a.score -= points; a.evidenceAgainst.push(label); };
  const atrRatio = ctx.volatility?.atrRatio ?? null;
  const vol = ctx.volatility ?? {};
  const tickDir = ctx.tickBehavior?.direction ?? "UNKNOWN";
  let compressionEvidence = 0;
  if (vol.state === "COMPRESSION") { compressionEvidence += 2; addFor(2, "COMPRESSION_STATE_CONFIRMED"); }
  if (vol.compressed === true) { compressionEvidence += 1; addFor(1, "COMPRESSION_FLAG_OBSERVED"); }
  if (atrRatio !== null && atrRatio <= 0.75) { compressionEvidence += 1.5; addFor(1.5, "ATR_RATIO_LOW"); }
  else if (atrRatio !== null && atrRatio <= 0.85) { compressionEvidence += 0.75; addFor(0.75, "ATR_RATIO_BELOW_NORMAL"); }
  if (vol.atrTrajectory === "NARROWING") { compressionEvidence += 1; addFor(1, "ATR_TRAJECTORY_NARROWING"); }
  if (vol.donchianWidthATR !== null && vol.donchianWidthATR <= 3) { compressionEvidence += 0.75; addFor(0.75, "DONCHIAN_WIDTH_NARROW"); }
  if (vol.bbwValidated === true && vol.bbw !== null && vol.bbw <= 0.02) { compressionEvidence += 0.75; addFor(0.75, "BBW_NARROW_VALIDATED"); }
  if (vol.rangeRatio !== null && vol.rangeRatio <= 0.75) { compressionEvidence += 0.75; addFor(0.75, "CANDLE_RANGES_SHRINKING"); }
  if (ctx.tickBehavior?.available === true && tickDir === "MIXED") { compressionEvidence += 0.5; addFor(0.5, "TICK_MOVEMENT_SMALL_MIXED"); }
  if (ctx.events?.compression === true) { compressionEvidence += 1; addFor(1, "COMPRESSION_EVENT"); }
  const compressionConfirmed = compressionEvidence >= 3;
  let expansionEvidence = 0;
  if (ctx.events?.expansion === true) { expansionEvidence += 2; addFor(2, "EXPANSION_EVENT"); }
  if (atrRatio !== null && atrRatio >= 1.35) { expansionEvidence += 1.5; addFor(1.5, "ATR_RATIO_EXPANDED"); }
  if (vol.atrTrajectory === "WIDENING") { expansionEvidence += 1; addFor(1, "ATR_TRAJECTORY_WIDENING"); }
  const breakout = ctx.events?.breakoutUp === true ? "BUY" : ctx.events?.breakoutDown === true ? "SELL" : null;
  if (breakout) { expansionEvidence += 1.5; addFor(1.5, "COMPRESSION_BREAKOUT_STARTED"); }
  if (tickDir === "UP" || tickDir === "DOWN") { expansionEvidence += 1; addFor(1, "TICKS_DIRECTED"); }
  if (ctx.candleBehavior?.bodyRatio !== null && ctx.candleBehavior?.bodyRatio >= 0.5) { expansionEvidence += 0.75; addFor(0.75, "BODY_EXPANDING"); }
  if (vol.rangeRatio !== null && vol.rangeRatio >= 1.3) { expansionEvidence += 1; addFor(1, "CANDLE_RANGES_EXPANDING"); }
  if (!compressionConfirmed) {
    addAgainst(1, "COMPRESSION_NOT_CONFIRMED");
    a.invalidations.push("COMPRESSION_NOT_CONFIRMED");
    if (extensionWickOnly(ctx)) { addAgainst(1, "FALSE_EXPANSION_SUSPECTED"); a.invalidations.push("FALSE_EXPANSION_WICK_ONLY"); }
    a.score = Math.max(0, a.score);
    return a;
  }
  const ready = expansionEvidence >= 2 && breakout !== null;
  if (!ready) { addAgainst(1, "EXPANSION_WITHOUT_DIRECTION"); a.invalidations.push("EXPANSION_WITHOUT_DIRECTION"); }
  if (extensionWickOnly(ctx)) { addAgainst(1.5, "FALSE_EXPANSION_WICK_ONLY"); a.invalidations.push("FALSE_EXPANSION_WICK_ONLY"); }
  a.score = Math.max(0, a.score + 3 + Math.min(compressionEvidence, 4) * 0.5);
  a.direction = breakout;
  a.byDesignAmbiguous = !ready;
  a.hardTrigger = ready;
  a.entryReady = ready && a.score >= 6 && a.invalidations.length === 0 && ctx.feedQuality?.state !== "STALE";
  a.triggerState = a.entryReady ? "CONFIRMED" : ready ? "PARTIAL" : "NONE";
  if (!a.entryReady) a.waitConditions.push("WAIT_FOR_EXPANSION_DIRECTION", "WAIT_FOR_CLOSE_BEYOND_COMPRESSION_BOUNDARY");
  return a;
}

function assessTransitionNoTrade(ctx) {
  const a = baseAssessment(SCENARIOS.TRANSITION_NO_TRADE);
  const conflicts = Array.isArray(ctx.conflicts) ? ctx.conflicts : [];
  a.evidenceFor.push(...conflicts);
  if (ctx.feedQuality?.state === "STALE") a.evidenceFor.push("FEED_STALE");
  if (ctx.traderCriticDivergence === true) a.evidenceFor.push("TRADER_CRITIC_DIVERGENCE");
  if (ctx.structure?.label === "UNKNOWN") a.evidenceFor.push("STRUCTURE_UNKNOWN");
  a.evidenceFor.push("NO_DIRECTIONAL_THESIS");
  return a;
}

function buildAssessments(ctx, regimeName) {
  const list = [
    assessTrendContinuation(ctx, regimeName),
    assessTrendPullback(ctx, regimeName),
    assessBreakout(ctx, regimeName),
    assessFailedBreakout(ctx, regimeName),
    assessRangeMeanReversion(ctx, regimeName),
    assessReversal(ctx, regimeName),
    assessCompressionExpansion(ctx, regimeName),
    assessTransitionNoTrade(ctx, regimeName),
  ];
  for (const assessment of list) assessment.score = round2(assessment.score);
  const byScenario = {};
  for (const assessment of list) byScenario[assessment.scenario] = assessment;
  return { list, byScenario };
}

function rankAssessments(assessments) {
  return assessments.list.slice().sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return SCENARIO_ORDER.indexOf(left.scenario) - SCENARIO_ORDER.indexOf(right.scenario);
  });
}

function computeSelection(ctx, regimeName, opts = {}) {
  const assessments = buildAssessments(ctx, regimeName);
  const ranked = rankAssessments(assessments);
  const top = ranked[0];
  const second = ranked[1] ?? baseAssessment(SCENARIOS.TRANSITION_NO_TRADE);
  const gap = round2(top.score - second.score);
  const definition = PLAYBOOK_DEFINITIONS[top.scenario];
  const conflicts = Array.isArray(ctx.conflicts) ? ctx.conflicts : [];
  const governance = [];
  if ((regimeName === "TRANSITION" || regimeName === "UNCERTAIN") && !top.hardTrigger) governance.push(`REGIME_${regimeName}`);
  if (top.score < 3 && top.hardTrigger !== true) governance.push("INSUFFICIENT_STRUCTURAL_EVIDENCE");
  if (conflicts.includes("STRUCTURE_MOMENTUM_CONFLICT") && !top.hardTrigger) governance.push("STRUCTURE_MOMENTUM_CONFLICT");
  if (conflicts.includes("MULTI_TIMEFRAME_CONFLICT") && !top.hardTrigger) governance.push("MULTI_TIMEFRAME_CONFLICT");
  if (conflicts.includes("EXPANSION_WITHOUT_DIRECTION") && !top.hardTrigger && top.score < 8) governance.push("EXPANSION_WITHOUT_DIRECTION");
  if (conflicts.includes("FEED_STALE")) governance.push("FEED_STALE");
  if (ctx.traderCriticDivergence === true) governance.push("TRADER_CRITIC_DIVERGENCE");
  const compressionOnly = top.scenario === SCENARIOS.COMPRESSION_EXPANSION && top.byDesignAmbiguous === true;
  let primaryScenario = top.scenario;
  let secondaryScenario = null;
  let ambiguous = gap <= 1 || top.byDesignAmbiguous === true;
  if (governance.length && !compressionOnly) {
    secondaryScenario = top.scenario;
    primaryScenario = SCENARIOS.TRANSITION_NO_TRADE;
    ambiguous = true;
  } else {
    const competitorSet = definition?.competing ?? [];
    const competitor = ranked.find((assessment) => assessment.scenario !== primaryScenario && competitorSet.includes(assessment.scenario));
    secondaryScenario = competitor?.scenario ?? (second.scenario !== primaryScenario ? second.scenario : null);
  }
  const primaryAssessment = assessments.byScenario[primaryScenario] ?? baseAssessment(primaryScenario);
  const competitorEvidence = [];
  const candidates = primaryScenario === SCENARIOS.TRANSITION_NO_TRADE
    ? ranked.filter((assessment) => assessment.scenario !== SCENARIOS.TRANSITION_NO_TRADE).slice(0, 3)
    : (definition?.competing ?? []).map((scenario) => assessments.byScenario[scenario]).filter(Boolean).slice(0, 3);
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.scenario) || candidate.scenario === primaryScenario) continue;
    seen.add(candidate.scenario);
    competitorEvidence.push({ scenario: candidate.scenario, for: candidate.evidenceFor.slice(), against: candidate.evidenceAgainst.slice() });
    if (competitorEvidence.length >= 3) break;
  }
  const winnerRationale = buildWinnerRationale({ primaryScenario, primaryAssessment, secondaryScenario, assessments, gap, ambiguous, governance, conflicts, top });
  const primaryEvidenceFor = primaryAssessment.evidenceFor.slice();
  const primaryEvidenceAgainst = primaryAssessment.evidenceAgainst.slice();
  if (governance.length) primaryEvidenceFor.push(...uniqueStrings(governance.map((reason) => `GOVERNANCE_${reason}`)));
  if (ambiguous && !primaryEvidenceAgainst.includes("AMBIGUOUS_COMPETING_SCENARIOS")) primaryEvidenceAgainst.push("AMBIGUOUS_COMPETING_SCENARIOS");
  return {
    primaryScenario, secondaryScenario, primaryEvidenceFor, primaryEvidenceAgainst, competitorEvidence,
    winnerRationale, ambiguous, primaryAssessment, assessments, governance, ranked,
  };
}

function buildWinnerRationale({ primaryScenario, primaryAssessment, secondaryScenario, assessments, gap, ambiguous, governance, conflicts, top }) {
  if (primaryScenario === SCENARIOS.TRANSITION_NO_TRADE) {
    const reasons = uniqueStrings([...governance, ...conflicts]).join("+") || "NO_VALID_SCENARIO";
    return `WAIT: ${reasons}; melhor candidato ${top.scenario} (${top.score.toFixed(2)}) descartado por falta de confirmacao estrutural.`;
  }
  const secondary = secondaryScenario ? assessments.byScenario[secondaryScenario] : null;
  const wins = primaryAssessment.evidenceFor.slice(0, 2).join("+") || "EVIDENCE";
  const base = secondary
    ? `${primaryScenario} (${primaryAssessment.score.toFixed(2)}) vence ${secondaryScenario} (${secondary.score.toFixed(2)}): ${wins}.`
    : `${primaryScenario} (${primaryAssessment.score.toFixed(2)}): ${wins}.`;
  return ambiguous ? `${base} DIFERENCA_PEQUENA_ENTRE_COMPETIDORES (gap ${gap.toFixed(2)}) -> WAIT.` : base;
}

/* ------------------------------------------------------------------ API publica congelada */

function resolvePlaybook(playbook) {
  if (!playbook) return null;
  if (typeof playbook === "string") {
    if (PLAYBOOK_DEFINITIONS[playbook]) return PLAYBOOK_DEFINITIONS[playbook];
    return Object.values(PLAYBOOK_DEFINITIONS).find((definition) => definition.id === playbook) ?? null;
  }
  if (typeof playbook === "object") {
    const scenario = playbook.scenario ?? playbook.name;
    if (scenario && PLAYBOOK_DEFINITIONS[scenario]) return PLAYBOOK_DEFINITIONS[scenario];
    const id = playbook.id ?? playbook.playbookId;
    if (id) return Object.values(PLAYBOOK_DEFINITIONS).find((definition) => definition.id === id) ?? null;
  }
  return null;
}

function statesFor(ctx) {
  const structureState = ctx.structure?.label ?? "UNKNOWN";
  const locationState = ctx.location?.zone ?? "UNKNOWN";
  const velocity = ctx.velocity?.value ?? null;
  let momentumState = "UNKNOWN";
  if (velocity !== null && structureState === "UP") momentumState = velocity > 0 ? "ALIGNED" : velocity < 0 ? "WEAK" : "FLAT";
  else if (velocity !== null && structureState === "DOWN") momentumState = velocity < 0 ? "ALIGNED" : velocity > 0 ? "WEAK" : "FLAT";
  else if (velocity !== null) momentumState = velocity > 0 ? "UP" : velocity < 0 ? "DOWN" : "FLAT";
  let microstructureState = "UNKNOWN";
  if (ctx.candleBehavior?.rejectionUp) microstructureState = "REJECTION_UP";
  else if (ctx.candleBehavior?.rejectionDown) microstructureState = "REJECTION_DOWN";
  else if (ctx.tickBehavior?.available) microstructureState = `TICKS_${ctx.tickBehavior.direction}`;
  const volatilityState = ctx.volatility?.state ?? "UNKNOWN";
  const trendState = ctx.trendRecent?.direction ?? ctx.trendMajor?.direction ?? "UNKNOWN";
  return { structureState, locationState, trendState, momentumState, volatilityState, microstructureState };
}

export function classifyScenario(context, regime, opts = {}) {
  const ctx = normalizeContext(context);
  const regimeName = typeof regime === "string" ? regime : regime?.regime ?? classifyRegime(ctx).regime;
  const selection = computeSelection(ctx, regimeName, opts);
  return {
    primaryScenario: selection.primaryScenario,
    secondaryScenario: selection.secondaryScenario,
    primaryEvidenceFor: selection.primaryEvidenceFor,
    primaryEvidenceAgainst: selection.primaryEvidenceAgainst,
    competitorEvidence: selection.competitorEvidence,
    winnerRationale: selection.winnerRationale,
    ambiguous: selection.ambiguous,
  };
}

export function evaluatePlaybook(playbook, context, features) {
  const definition = resolvePlaybook(playbook);
  if (!definition) {
    return {
      applicable: false, validRegimes: [], evidenceFor: [], evidenceAgainst: ["UNKNOWN_PLAYBOOK"],
      locationState: "UNKNOWN", structureState: "UNKNOWN", momentumState: "UNKNOWN",
      volatilityState: "UNKNOWN", microstructureState: "UNKNOWN", triggerState: "NONE",
      invalidations: ["UNKNOWN_PLAYBOOK"], entryEligible: false, action: "WAIT",
      waitConditions: ["WAIT_FOR_VALID_PLAYBOOK"], competing: [], featuresUsed: [],
    };
  }
  const ctx = isContext(context) ? context : extractContext(context ?? { features });
  const regime = classifyRegime(ctx);
  const assessments = buildAssessments(ctx, regime.regime);
  const assessment = assessments.byScenario[definition.scenario] ?? baseAssessment(definition.scenario);
  const applicable = definition.validRegimes.includes(regime.regime);
  const invalidations = assessment.invalidations.slice();
  if (!applicable) invalidations.push(`REGIME_NOT_VALID_FOR_PLAYBOOK_${regime.regime}`);
  const entryEligible = applicable && assessment.entryReady === true && invalidations.length === 0;
  const usedFeatures = features && typeof features === "object"
    ? Object.keys(features).filter((key) => features[key] !== null && features[key] !== undefined)
    : ctx.featuresUsed;
  return {
    applicable,
    validRegimes: definition.validRegimes.slice(),
    evidenceFor: uniqueStrings([...assessment.evidenceFor, `REGIME_${regime.regime}`]),
    evidenceAgainst: uniqueStrings([...assessment.evidenceAgainst, ...(applicable ? [] : [`REGIME_${regime.regime}_INVALID`])]),
    ...statesFor(ctx),
    triggerState: assessment.triggerState,
    invalidations: uniqueStrings(invalidations),
    entryEligible,
    action: entryEligible ? assessment.direction ?? "WAIT" : "WAIT",
    waitConditions: uniqueStrings([...assessment.waitConditions, ...(applicable ? [] : ["WAIT_FOR_VALID_REGIME"])]),
    competing: definition.competing.slice(),
    featuresUsed: usedFeatures,
  };
}

function confidenceValue({ score, regimeConfidence, ambiguous, entryEligible }) {
  const base = Math.min(0.95, 0.25 + score * 0.07);
  const cap = regimeConfidence === "HIGH" ? 0.9 : regimeConfidence === "MEDIUM" ? 0.7 : 0.5;
  let value = Math.min(base, cap);
  if (ambiguous) value = Math.min(value, 0.45);
  if (!entryEligible) value = Math.min(value, 0.6);
  return round(Math.max(0, value), 3) ?? 0;
}

export function analyzeScenario(input = {}) {
  const context = extractContext(input);
  const regime = classifyRegime(context);
  const selection = computeSelection(context, regime.regime);
  const definition = PLAYBOOK_DEFINITIONS[selection.primaryScenario] ?? PLAYBOOK_DEFINITIONS.TRANSITION_NO_TRADE;
  const playbook = evaluatePlaybook(definition, context, input && typeof input === "object" ? input.features : undefined);
  const primaryAssessment = selection.primaryAssessment;
  const invalidations = uniqueStrings([
    ...playbook.invalidations,
    ...(selection.ambiguous ? ["AMBIGUOUS_COMPETING_SCENARIOS"] : []),
    ...selection.governance.map((reason) => `GOVERNANCE_${reason}`),
  ]);
  const confidence = confidenceValue({
    score: primaryAssessment.score,
    regimeConfidence: regime.confidence,
    ambiguous: selection.ambiguous,
    entryEligible: playbook.entryEligible === true,
  });
  const states = statesFor(context);
  return {
    scenarioEngineVersion: SCENARIO_ENGINE_VERSION,
    scenarioEngineMode: SCENARIO_ENGINE_MODE,
    marketRegime: regime.regime,
    regimeConfidence: regime.confidence,
    regimeEvidenceFor: regime.evidenceFor.slice(),
    regimeEvidenceAgainst: regime.evidenceAgainst.slice(),
    primaryScenario: selection.primaryScenario,
    secondaryScenario: selection.secondaryScenario,
    competing: selection.competitorEvidence.map((entry) => entry.scenario),
    scenarioEvidenceFor: selection.primaryEvidenceFor.slice(),
    scenarioEvidenceAgainst: selection.primaryEvidenceAgainst.slice(),
    structureState: states.structureState,
    locationState: states.locationState,
    trendState: states.trendState,
    momentumState: states.momentumState,
    volatilityState: states.volatilityState,
    microstructureState: states.microstructureState,
    triggerState: states.triggerState ?? playbook.triggerState ?? "UNKNOWN",
    invalidations,
    invalidationReasons: invalidations.slice(),
    action: playbook.action,
    direction: playbook.action === "BUY" || playbook.action === "SELL" ? playbook.action : null,
    confidence,
    featuresUsed: context.featuresUsed.slice(),
    unavailable: context.unavailable.slice(),
    ambiguous: selection.ambiguous === true,
    winnerRationale: selection.winnerRationale,
    playbook: {
      playbookId: definition.id,
      scenario: definition.scenario,
      applicable: playbook.applicable,
      entryEligible: playbook.entryEligible,
      action: playbook.action,
      evidenceFor: playbook.evidenceFor.slice(),
      evidenceAgainst: playbook.evidenceAgainst.slice(),
      invalidations: playbook.invalidations.slice(),
      waitConditions: playbook.waitConditions.slice(),
      competing: playbook.competing.slice(),
      featuresUsed: playbook.featuresUsed,
    },
    rule: `${SCENARIO_ENGINE_VERSION}:extractContext>classifyRegime>classifyScenario>evaluatePlaybook:DETERMINISTIC_NO_IO`,
    otc: context.isOtc === true,
  };
}
