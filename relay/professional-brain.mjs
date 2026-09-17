/**
 * PROFESSIONAL TRADER BRAIN (Fase 6) — Core Brain deterministico, compacto e sempre disponivel.
 *
 * - Substitui completamente a arquitetura V1/V2/V3/V8 no runtime ativo (nenhuma referencia a variantes).
 * - Processo obrigatorio (nenhum estagio pode ser pulado silenciosamente):
 *   DATA INTEGRITY -> REGIME -> STRUCTURE -> LOCATION -> MOMENTUM -> STRENGTH -> VOLATILITY ->
 *   MICROSTRUCTURE -> SETUP -> TRIGGER -> CONTRADICTIONS -> BUY/SELL/WAIT
 * - Funciona com SecondBrain OFFLINE (conhecimento externo apenas enriquece; nunca bloqueia).
 * - estimatedWinProbability permanece null ate calibracao prospectiva valida.
 */
export const BRAIN_VERSION = "professional-brain-v2";
export const BRAIN_GENERATION = 2;

export const PRINCIPLES = [
  "WAIT e uma decisao valida e frequentemente a melhor.",
  "Bias nao e trigger.",
  "Indicador isolado nao e ordem.",
  "Correlacao nao e causalidade.",
  "Resultado de um trade nao prova qualidade da decisao.",
  "Nao perseguir mercado.",
  "Nao criar narrativa para justificar entrada.",
  "Nao antecipar breakout sem evidencia.",
  "RSI nao e botao de compra/venda; e momentum/contexto.",
  "ADX mede forca direcional, nao direcao.",
  "ATR mede volatilidade, nunca direcao.",
  "Donchian e estrutura/localizacao, nao gatilho automatico.",
  "Nunca usar informacao futura.",
];

export const PROCESS_STEPS = ["DATA_INTEGRITY", "REGIME", "STRUCTURE", "LOCATION", "MOMENTUM", "STRENGTH", "VOLATILITY", "MICROSTRUCTURE", "SETUP", "TRIGGER", "CONTRADICTIONS", "DECISION"];

export const REGIMES = ["TREND_UP", "TREND_DOWN", "RANGE", "COMPRESSION", "EXPANSION", "TRANSITION", "CHAOTIC", "UNCLEAR"];

export const SETUPS = ["TREND_PULLBACK", "BREAKOUT_CONTINUATION", "BREAKOUT_RETEST", "FAILED_BREAKOUT", "RANGE_REVERSAL", "MOMENTUM_CONTINUATION", "REJECTION", "COMPRESSION_EXPANSION", "REVERSAL_ATTEMPT", "NO_VALID_SETUP"];

export const CORE_BRAIN = {
  principles: PRINCIPLES,
  process: PROCESS_STEPS,
  regimes: {
    TREND_UP: { interpretation: "RSI alto nao e SELL; pullbacks com HL sao oportunidades; ADX>=20 com +DI> -DI sustenta continuacao.", incompatible: ["RANGE_REVERSAL"] },
    TREND_DOWN: { interpretation: "RSI baixo nao e BUY; rallies com LH sao oportunidades; ADX>=20 com -DI> +DI sustenta continuacao.", incompatible: ["RANGE_REVERSAL"] },
    RANGE: { interpretation: "Extremos do canal sao zonas de atencao; meio do range e WAIT; breakout exige trigger e aceitacao.", incompatible: ["TREND_PULLBACK", "MOMENTUM_CONTINUATION"] },
    COMPRESSION: { interpretation: "Volatilidade contraida: preparar expansao, nao prever direcao.", incompatible: ["TREND_PULLBACK"] },
    EXPANSION: { interpretation: "Movimento acelerado: entradas atrasadas sao risco; exigir retest/pullback.", incompatible: ["RANGE_REVERSAL"] },
    TRANSITION: { interpretation: "Sinais mistos: reduzir conviccao; preferir WAIT ate definicao.", incompatible: ["TREND_PULLBACK", "MOMENTUM_CONTINUATION", "RANGE_REVERSAL"] },
    CHAOTIC: { interpretation: "Wicks grandes e ATR extremo: nenhuma leitura confiavel.", incompatible: SETUPS.slice(0, 9) },
    UNCLEAR: { interpretation: "Sem classificacao confiavel: WAIT.", incompatible: SETUPS.slice(0, 9) },
  },
  setups: {
    TREND_PULLBACK: { regimes: ["TREND_UP", "TREND_DOWN"], needs: "swing a favor mantido (HL em UP / LH em DOWN)", trigger: "candle de continuacao apos pullback sem romper o swing", invalidators: ["rompimento do swing a favor", "ADX caindo forte", "rejection contra a tendencia no candle do gatilho"] },
    BREAKOUT_CONTINUATION: { regimes: ["TREND_UP", "TREND_DOWN", "EXPANSION"], needs: "rompimento do canal com fechamento", trigger: "fechamento alem do extremo com corpo dominante", invalidators: ["wick dominante (possivel falha)", "ADX baixo", "extensao excessiva (>2.5 ATR do canal)"] },
    BREAKOUT_RETEST: { regimes: ["TREND_UP", "TREND_DOWN"], needs: "rompimento previo + retorno ao nivel rompido", trigger: "defesa do nivel com candle a favor", invalidators: ["perda do nivel rompido", "retest sem reacao"] },
    FAILED_BREAKOUT: { regimes: ["RANGE", "TRANSITION", "EXPANSION"], needs: "perfuracao do extremo com fechamento de volta", trigger: "rejeicao apos a falha", invalidators: ["aceitacao fora do canal nos candles seguintes"] },
    RANGE_REVERSAL: { regimes: ["RANGE"], needs: "preco no extremo do canal + rejeicao", trigger: "candle de rejeicao no extremo", invalidators: ["ADX subindo com DI alinhado (breakout em curso)", "corpo forte fora do canal"] },
    MOMENTUM_CONTINUATION: { regimes: ["TREND_UP", "TREND_DOWN", "EXPANSION"], needs: "sequencia de corpos na direcao + aceleração positiva", trigger: "continuidade sem exaustao", invalidators: ["aceleracao negativa", "wicks crescentes", "ADX caindo"] },
    REJECTION: { regimes: ["RANGE", "TRANSITION", "TREND_UP", "TREND_DOWN"], needs: "wick dominante em zona relevante", trigger: "fechamento contra a rejeicao no candle seguinte", invalidators: ["corpo forte na direcao do wick"] },
    COMPRESSION_EXPANSION: { regimes: ["COMPRESSION"], needs: "ATR contraido + range estreito", trigger: "expansao com rompimento e fechamento", invalidators: ["expansao sem fechamento (wick)", "sem follow-through"] },
    REVERSAL_ATTEMPT: { regimes: ["TREND_UP", "TREND_DOWN", "EXPANSION"], needs: "exaustao (aceleracao negativa + wicks) contra a tendencia", trigger: "perda de swing a favor", invalidators: ["tendencia retoma com corpo forte", "ADX ainda subindo"] },
    NO_VALID_SETUP: { regimes: REGIMES, needs: "nenhum contexto valido identificado", trigger: "—", invalidators: [] },
  },
};

/* ------------------------------ ESTAGIOS (deterministicos) ------------------------------ */

function stage(status, detail = null) { return { status, detail }; }

export function dataIntegrityStage({ freshness, features, structureFeatures }) {
  if (!features) return stage("FAIL", "FEATURES_UNAVAILABLE");
  if (freshness?.fresh !== true) return stage("FAIL", freshness?.reason ?? "STALE_ANALYSIS");
  if (!structureFeatures) return stage("FAIL", "STRUCTURE_UNAVAILABLE");
  return stage("OK");
}

export function classifySetupStage({ regime, structureFeatures, features, context }) {
  const events = structureFeatures.events;
  const shape = structureFeatures.candleShape;
  const { velocity } = structureFeatures;
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const adxSlope = context?.deterministicIndicators?.adx14?.slope ?? null;
  const plusDI = context?.deterministicIndicators?.plusDI?.value ?? null;
  const minusDI = context?.deterministicIndicators?.minusDI?.value ?? null;
  const structureLabel = structureFeatures.structure.label;
  const position = structureFeatures.location.donchianPosition;
  const atr = structureFeatures.volatility.atr;
  const extension = Math.max(structureFeatures.location.distanceToUpperATR, structureFeatures.location.distanceToLowerATR);
  const diUp = plusDI !== null && minusDI !== null && plusDI > minusDI;
  const diDown = plusDI !== null && minusDI !== null && minusDI > plusDI;
  const candidates = [];

  if (["TREND_UP", "TREND_DOWN"].includes(regime)) {
    const direction = regime === "TREND_UP" ? "BUY" : "SELL";
    const pullback = direction === "BUY" ? events.pullbackUp : events.pullbackDown;
    if (pullback && (direction === "BUY" ? diUp : diDown) && (adxSlope === null || adxSlope >= -0.5)) candidates.push({ setup: "TREND_PULLBACK", direction, trigger: "pullback_com_estrutura_mantida", strength: 3 });
    const breakout = direction === "BUY" ? events.breakoutUp : events.breakoutDown;
    if (breakout && shape.bodyRatio >= 0.5 && extension < 2.5) candidates.push({ setup: "BREAKOUT_CONTINUATION", direction, trigger: "fechamento_alem_do_extremo", strength: 3 });
    const retest = direction === "BUY" ? events.retestUp : events.retestDown;
    if (retest) candidates.push({ setup: "BREAKOUT_RETEST", direction, trigger: "defesa_do_nivel_rompido", strength: 3 });
    if ((direction === "BUY" ? velocity.acceleration > 0 : velocity.acceleration < 0) && shape.bodyRatio >= 0.45) candidates.push({ setup: "MOMENTUM_CONTINUATION", direction, trigger: "aceleracao_a_favor", strength: 2 });
    const reversalSetup = direction === "BUY" ? (velocity.acceleration < 0 && events.rejectionUp) : (velocity.acceleration > 0 && events.rejectionDown);
    if (reversalSetup) candidates.push({ setup: "REVERSAL_ATTEMPT", direction: direction === "BUY" ? "SELL" : "BUY", trigger: "exaustao_contra_tendencia", strength: 1 });
  }
  if (regime === "RANGE") {
    if (position >= 0.8 && events.rejectionUp) candidates.push({ setup: "RANGE_REVERSAL", direction: "SELL", trigger: "rejeicao_no_topo_do_range", strength: 3 });
    if (position <= 0.2 && events.rejectionDown) candidates.push({ setup: "RANGE_REVERSAL", direction: "BUY", trigger: "rejeicao_no_fundo_do_range", strength: 3 });
    if (events.failedBreakoutUp) candidates.push({ setup: "FAILED_BREAKOUT", direction: "SELL", trigger: "falha_de_rompimento_topo", strength: 3 });
    if (events.failedBreakoutDown) candidates.push({ setup: "FAILED_BREAKOUT", direction: "BUY", trigger: "falha_de_rompimento_fundo", strength: 3 });
  }
  if (regime === "COMPRESSION" && events.expansion && (events.breakoutUp || events.breakoutDown)) {
    candidates.push({ setup: "COMPRESSION_EXPANSION", direction: events.breakoutUp ? "BUY" : "SELL", trigger: "expansao_com_fechamento", strength: 3 });
  }
  if (regime === "EXPANSION") {
    if (events.failedBreakoutUp) candidates.push({ setup: "FAILED_BREAKOUT", direction: "SELL", trigger: "falha_de_rompimento_em_expansao", strength: 2 });
    if (events.failedBreakoutDown) candidates.push({ setup: "FAILED_BREAKOUT", direction: "BUY", trigger: "falha_de_rompimento_em_expansao", strength: 2 });
  }
  if (["RANGE", "TRANSITION"].includes(regime) && events.rejectionUp && position > 0.6) candidates.push({ setup: "REJECTION", direction: "SELL", trigger: "wick_dominante_em_zona", strength: 2 });
  if (["RANGE", "TRANSITION"].includes(regime) && events.rejectionDown && position < 0.4) candidates.push({ setup: "REJECTION", direction: "BUY", trigger: "wick_dominante_em_zona", strength: 2 });
  if (["TREND_UP", "TREND_DOWN"].includes(regime) && events.failedBreakoutUp && structureLabel === "UP") candidates.push({ setup: "FAILED_BREAKOUT", direction: "SELL", trigger: "falha_de_rompimento_contra_tendencia", strength: 2 });

  const best = candidates.sort((a, b) => b.strength - a.strength)[0] ?? null;
  if (!best) return { setup: "NO_VALID_SETUP", direction: null, trigger: null, candidates: [] };
  const regimeProfile = CORE_BRAIN.regimes[regime] ?? null;
  if (regimeProfile?.incompatible?.includes(best.setup)) return { setup: "NO_VALID_SETUP", direction: null, trigger: null, candidates, blockedBy: "REGIME_INCOMPATIVEL" };
  return { ...best, candidates: candidates.map((candidate) => ({ setup: candidate.setup, direction: candidate.direction, strength: candidate.strength })) };
}

export function contradictionStage({ setup, direction, regime, structureFeatures, features, context, intelligence }) {
  const contradictions = [];
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const adxSlope = context?.deterministicIndicators?.adx14?.slope ?? null;
  const rsi = context?.deterministicIndicators?.rsi14?.value ?? null;
  const extension = Math.max(structureFeatures.location.distanceToUpperATR, structureFeatures.location.distanceToLowerATR);
  if (regime === "CHAOTIC" || regime === "UNCLEAR") contradictions.push(`regime_${regime.toLowerCase()}`);
  if (extension > 3) contradictions.push("entrada_excessivamente_estendida");
  if (adx !== null && adxSlope !== null && adx < 20 && adxSlope < -1) contradictions.push("forca_caindo");
  if (setup === "TREND_PULLBACK" && rsi !== null && ((direction === "BUY" && rsi > 78) || (direction === "SELL" && rsi < 22))) contradictions.push("rsi_extremo_contra_o_pullback");
  if (direction === "BUY" && structureFeatures.events.rejectionUp) contradictions.push("rejeicao_no_candle_de_gatilho");
  if (direction === "SELL" && structureFeatures.events.rejectionDown) contradictions.push("rejeicao_no_candle_de_gatilho");
  if (intelligence?.news?.importance >= 0.9) contradictions.push("noticia_alto_impacto_vigente");
  return contradictions;
}

/** TRADER — processo completo, saida estruturada; WAIT sempre explicito com motivo. */
export function traderBrainDecision({ marketKey, marketType, features, context, structureFeatures, regime, freshness, intelligence, knowledgeContext = null, versions = {} }) {
  const startedAt = Date.now();
  const processLog = [];
  const integrity = dataIntegrityStage({ freshness, features, structureFeatures });
  processLog.push({ stage: "DATA_INTEGRITY", ...integrity });
  if (integrity.status !== "OK") return { ...buildOutput({ marketKey, marketType, action: "WAIT", waitReason: `DATA_INTEGRITY_${integrity.detail}`, processLog, regime: null, structureFeatures, features, context, versions, knowledgeContext }), latencyMs: Date.now() - startedAt };

  const setupStage = classifySetupStage({ regime, structureFeatures, features, context });
  processLog.push({ stage: "REGIME", ...stage(REGIMES.includes(regime) ? "OK" : "FAIL", regime) });
  processLog.push({ stage: "STRUCTURE", ...stage("OK", structureFeatures.structure.label) });
  processLog.push({ stage: "LOCATION", ...stage("OK", structureFeatures.location.zone) });
  processLog.push({ stage: "MOMENTUM", ...stage("OK", features.rsi14 === null ? "INDISPONIVEL" : Number(features.rsi14).toFixed(1)) });
  processLog.push({ stage: "STRENGTH", ...stage("OK", context?.deterministicIndicators?.adx14?.value ?? null) });
  processLog.push({ stage: "VOLATILITY", ...stage("OK", structureFeatures.volatility.atrRatio) });
  processLog.push({ stage: "MICROSTRUCTURE", ...stage("OK", context?.microstructure?.streak ?? null) });
  processLog.push({ stage: "SETUP", ...stage(setupStage.setup !== "NO_VALID_SETUP" ? "OK" : "FAIL", setupStage.setup) });

  const contradictions = setupStage.setup !== "NO_VALID_SETUP" ? contradictionStage({ setup: setupStage.setup, direction: setupStage.direction, regime, structureFeatures, features, context, intelligence }) : [];
  processLog.push({ stage: "TRIGGER", ...stage(setupStage.trigger ? "OK" : "FAIL", setupStage.trigger) });
  processLog.push({ stage: "CONTRADICTIONS", ...stage(contradictions.length ? "WARN" : "OK", contradictions) });

  const hardBlock = contradictions.some((code) => ["regime_chaotic", "regime_unclear", "entrada_excessivamente_estendida", "forca_caindo"].includes(code));
  const noSetup = setupStage.setup === "NO_VALID_SETUP" || !setupStage.trigger;
  const action = noSetup || hardBlock ? "WAIT" : setupStage.direction;
  const waitReason = noSetup ? (setupStage.blockedBy ?? "SEM_SETUP_VALIDO") : hardBlock ? contradictions[0] : null;
  processLog.push({ stage: "DECISION", ...stage("OK", action) });

  return {
    ...buildOutput({ marketKey, marketType, action, waitReason, processLog, regime, structureFeatures, features, context, versions, knowledgeContext, setupStage, contradictions }),
    latencyMs: Date.now() - startedAt,
  };
}

function buildOutput({ marketKey, marketType, action, waitReason, processLog, regime, structureFeatures, features, context, versions, knowledgeContext, setupStage = null, contradictions = [] }) {
  const rsi = context?.deterministicIndicators?.rsi14?.value ?? null;
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const supporting = [];
  const contradicting = [...contradictions];
  if (setupStage?.setup) supporting.push(`setup:${setupStage.setup}`);
  if (setupStage?.trigger) supporting.push(`trigger:${setupStage.trigger}`);
  if (structureFeatures?.structure?.label) supporting.push(`estrutura:${structureFeatures.structure.label}`);
  if (rsi !== null) supporting.push(`rsi14:${Number(rsi).toFixed(1)}`);
  if (adx !== null) supporting.push(`adx14:${Number(adx).toFixed(1)}`);
  const confidence = action === "WAIT" ? 0 : Number(Math.min(1, 0.35 + 0.1 * (setupStage?.strength ?? 1) + (structureFeatures?.candleShape?.bodyRatio ?? 0) * 0.2).toFixed(3));
  return {
    agent: "TRADER", brainVersion: BRAIN_VERSION, brainGeneration: BRAIN_GENERATION, marketKey, marketType,
    decisionAt: Date.now(), regime, structure: structureFeatures?.structure ?? null, location: structureFeatures?.location ?? null,
    momentum: { rsi14: rsi, velocity: structureFeatures?.velocity?.velocity ?? null, acceleration: structureFeatures?.velocity?.acceleration ?? null },
    strength: { adx14: adx, plusDI: context?.deterministicIndicators?.plusDI?.value ?? null, minusDI: context?.deterministicIndicators?.minusDI?.value ?? null, diSpread: context?.deterministicIndicators?.diSpread?.value ?? null },
    volatility: structureFeatures?.volatility ?? null,
    microstructure: { streak: context?.microstructure?.streak ?? null, bodyRatio: structureFeatures?.candleShape?.bodyRatio ?? null, upperWick: structureFeatures?.candleShape?.upperWick ?? null, lowerWick: structureFeatures?.candleShape?.lowerWick ?? null },
    setup: setupStage?.setup ?? "NO_VALID_SETUP", setupCandidates: setupStage?.candidates ?? [], trigger: setupStage?.trigger ?? null,
    supportingEvidence: supporting, contradictingEvidence: contradicting,
    knowledgeContextIds: knowledgeContext?.knowledgeIds ?? [], knowledgeVersion: knowledgeContext?.knowledgeVersion ?? null, knowledgeContextUsed: knowledgeContext?.used === true,
    action, analysisConfidence: confidence, primaryRisk: contradicting[0] ?? null, waitReason,
    whatWouldChange: ["trigger_com_estrutura_mantida", "forca_direcional_definida", "reducao_de_extensao"],
    estimatedWinProbability: null, processLog, latencyMs: 0,
  };
}

/** CRITIC — mesmo cerebro profissional, prompt diferente: avaliacao independente primeiro, depois refuta a tese. */
export function criticBrainAssessment({ trader, features, context, structureFeatures, regime, freshness, intelligence }) {
  const startedAt = Date.now();
  const independent = traderBrainDecision({ marketKey: trader?.marketKey, marketType: trader?.marketType, features, context, structureFeatures, regime, freshness, intelligence, knowledgeContext: null });
  const checklist = [];
  const contradictions = [];
  const riskFlags = [];
  let verdict = "CONFIRM";
  const sameAction = independent.action === trader?.action;
  const direction = trader?.action;
  const rsi = context?.deterministicIndicators?.rsi14?.value ?? null;
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const plusDI = context?.deterministicIndicators?.plusDI?.value ?? null;
  const minusDI = context?.deterministicIndicators?.minusDI?.value ?? null;
  const atrRatio = structureFeatures?.volatility?.atrRatio ?? null;
  const againstATR = direction === "BUY" ? (trader?.location?.distanceToLowerATR ?? null) : direction === "SELL" ? (trader?.location?.distanceToUpperATR ?? null) : null;
  const withATR = direction === "BUY" ? (trader?.location?.distanceToUpperATR ?? null) : direction === "SELL" ? (trader?.location?.distanceToLowerATR ?? null) : null;
  void sameAction;
  if (freshness?.fresh !== true) { verdict = "VETO"; riskFlags.push("dados_nao_frescos"); }
  if (!features || !structureFeatures) { verdict = "VETO"; riskFlags.push("features_indisponiveis"); }
  if (verdict !== "VETO") {
    if ((trader?.action === "BUY" || trader?.action === "SELL") && independent.action !== trader.action) { verdict = "CONTEST"; contradictions.push("critic_nao_ve_trigger_independente"); }
    if (trader?.action === "WAIT" && independent.action !== "WAIT") { verdict = "CONTEST"; contradictions.push("critic_ve_setup_que_trader_ignorou"); }
    if ((trader?.momentum?.acceleration ?? 0) !== 0 && trader.action !== "WAIT" && Math.sign(trader.momentum.acceleration) !== (trader.action === "BUY" ? 1 : -1)) contradictions.push("aceleracao_contra_a_entrada");
    if (["CHAOTIC", "UNCLEAR"].includes(regime)) { verdict = "VETO"; riskFlags.push(`regime_${String(regime).toLowerCase()}`); }
    if ((trader?.setup === "BREAKOUT_CONTINUATION") && (structureFeatures?.candleShape?.bodyRatio ?? 0) < 0.5) contradictions.push("rompimento_sem_corpo_dominante");
    // Fase 6.4 — auditoria adversarial ensinada pelo curriculo (fontes: Fidelity, StockCharts, CMT, CME, TradingView):
    // o Critic deve refutar entrada atrasada/esticada/fraca; sao contradicoes (CONTEST), nunca criam direcao.
    if ((direction === "BUY" || direction === "SELL") && rsi !== null) {
      if (direction === "BUY" && rsi >= 70) contradictions.push("rsi_extremo_contra_entrada");
      if (direction === "SELL" && rsi <= 30) contradictions.push("rsi_extremo_contra_entrada");
      if (direction === "BUY" && rsi >= 78) contradictions.push("rsi_exausto_mesmo_a_favor");
      if (direction === "SELL" && rsi <= 22) contradictions.push("rsi_exausto_mesmo_a_favor");
      if (direction === "BUY" && rsi < 45) contradictions.push("rsi_sem_momentum_para_compra");
      if (direction === "SELL" && rsi > 55) contradictions.push("rsi_sem_momentum_para_venda");
    }
    if ((direction === "BUY" || direction === "SELL") && plusDI !== null && minusDI !== null) {
      const diAgainst = direction === "BUY" ? minusDI > plusDI : plusDI > minusDI;
      if (diAgainst) contradictions.push("conflito_di_contra_entrada");
    }
    if ((direction === "BUY" || direction === "SELL") && adx !== null && adx < 18) contradictions.push("adx_fraco_para_setup");
    if ((direction === "BUY" || direction === "SELL") && atrRatio !== null && atrRatio > 2.5) contradictions.push("volatilidade_spike_na_entrada");
    if ((direction === "BUY" || direction === "SELL") && (againstATR ?? 0) > 2.0) contradictions.push("preco_esticado_contra_a_entrada");
    if (trader?.setup === "BREAKOUT_CONTINUATION" && (withATR ?? 0) > 2.5) contradictions.push("rompimento_ja_percorrido");
    if (["RANGE", "TRANSITION"].includes(regime) && direction === "BUY" && (trader?.location?.donchianPosition ?? 0.5) >= 0.85) contradictions.push("compra_no_topo_do_range");
    if (["RANGE", "TRANSITION"].includes(regime) && direction === "SELL" && (trader?.location?.donchianPosition ?? 0.5) <= 0.15) contradictions.push("venda_no_fundo_do_range");
    if (intelligence?.news?.importance >= 0.9) riskFlags.push("noticia_alto_impacto");
  }
  checklist.push({ item: "regime", ok: REGIMES.includes(regime) }, { item: "trigger", ok: Boolean(trader?.trigger) || trader?.action === "WAIT" }, { item: "contraevidencia_considerada", ok: true }, { item: "sem_extensao_excessiva", ok: (trader?.location?.distanceToUpperATR ?? 0) <= 3 && (trader?.location?.distanceToLowerATR ?? 0) <= 3 },
    { item: "sem_entrada_atrasada", ok: (direction === "BUY" ? (trader?.location?.distanceLowerATR ?? 0) : (trader?.location?.distanceUpperATR ?? 0)) <= 2.5 },
    { item: "forca_direcional_adequada", ok: (adx ?? 20) >= 18 },
    { item: "di_alinhado_com_acao", ok: plusDI === null || minusDI === null || (direction === "BUY" ? plusDI > minusDI : direction === "SELL" ? minusDI > plusDI : true) },
    { item: "rsi_com_espaco", ok: rsi === null || (direction === "BUY" ? rsi < 78 : direction === "SELL" ? rsi > 22 : true) });
  for (const entry of checklist) if (!entry.ok && verdict !== "VETO") { verdict = "CONTEST"; contradictions.push(`checklist_falhou:${entry.item}`); }
  const finalRecommendation = verdict === "CONFIRM" ? trader?.action ?? "WAIT" : "WAIT";
  return {
    agent: "CRITIC", brainVersion: BRAIN_VERSION, brainGeneration: BRAIN_GENERATION,
    independentAction: independent.action, independentSetup: independent.setup, traderAssessment: verdict,
    contradictions: [...new Set(contradictions)].slice(0, 8), riskFlags: riskFlags.slice(0, 6), checklist,
    finalRecommendation, analysisConfidence: trader?.analysisConfidence ?? 0, estimatedWinProbability: null,
    latencyMs: Date.now() - startedAt,
  };
}

/** CONSENSUS — deterministico (sem terceira LLM). */
export function consensusBrainDecision({ trader, critic, freshness }) {
  const startedAt = Date.now();
  const rules = [];
  let action = "WAIT", status = "WAIT", reason = "SEM_SINAL";
  if (freshness?.fresh !== true) { status = "STALE"; reason = "FRESHNESS_INVALIDA"; rules.push("freshness_fail"); }
  else if (critic?.traderAssessment === "VETO") { status = "VETOED"; reason = "CRITIC_VETO"; rules.push("critic_veto"); }
  else if (critic?.traderAssessment === "CONFIRM" && trader?.action === critic?.independentAction && (trader?.action === "BUY" || trader?.action === "SELL")) { action = trader.action; status = "CONFIRMED"; reason = "TRADER_E_CRITIC_ALINHADOS"; rules.push("confirm"); }
  else { status = "NO_CONSENSUS"; reason = trader?.action === "WAIT" ? "TRADER_WAIT" : "DIVERGENCIA"; rules.push("no_consensus"); }
  return { action, status, reason, rules, analysisConfidence: action === "WAIT" ? 0 : Math.min(trader?.analysisConfidence ?? 0, 1), estimatedWinProbability: null, latencyMs: Date.now() - startedAt, brainVersion: BRAIN_VERSION };
}
