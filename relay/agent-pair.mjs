/**
 * PAR DE AGENTES (Fase 5) — Trader + Critic + Consensus determinísticos.
 *
 * - Feature Engine continua dono dos indicadores (LLM/agente nunca recalcula RSI/ADX/ATR/Donchian).
 * - Critic avalia PRIMEIRO de forma independente; so depois recebe a tese do Trader para tentar refutar.
 * - Consensus e deterministico (sem terceira LLM votando).
 * - estimatedWinProbability permanece null ate calibracao prospectiva valida.
 * - Sem dependencia externa obrigatoria: funciona com dados causais mesmo sem inteligencia externa.
 */
export const AGENT_VERSION = "agent-pair-v1";

import { evaluateFrozen } from "./frozen-strategies.mjs";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function detectRegime({ features, context }) {
  const adx = context?.deterministicIndicators?.adx14?.value ?? null;
  const atrNormalized = context?.deterministicIndicators?.atrNormalized?.value ?? null;
  if (adx === null || atrNormalized === null) return "UNKNOWN";
  if (atrNormalized > 0.0025) return "VOLATILE";
  if (adx >= 25) return "TRENDING";
  if (adx < 15) return "RANGED";
  return "TRANSITION";
}

export function structuralBias({ context }) {
  const position = context?.deterministicIndicators?.donchianPosition?.value ?? null;
  const streak = context?.microstructure?.streak ?? null;
  if (position === null) return "UNKNOWN";
  const channelBias = position > 0.7 ? "UP" : position < 0.3 ? "DOWN" : "MID";
  const streakBias = streak === null ? "UNKNOWN" : streak > 0 ? "UP" : streak < 0 ? "DOWN" : "FLAT";
  return { channelBias, streakBias, position: Number(Number(position).toFixed(4)) };
}

function baseEvidence({ context, marketType, payout, intelligence }) {
  const indicators = context?.deterministicIndicators ?? {};
  const supporting = [];
  const contradicting = [];
  const rsi = indicators.rsi14?.value ?? null;
  const adx = indicators.adx14?.value ?? null;
  const diSpread = indicators.diSpread?.value ?? null;
  const position = indicators.donchianPosition?.value ?? null;
  if (rsi !== null) (rsi > 55 ? supporting : rsi < 45 ? contradicting : contradicting).push(`rsi14=${Number(rsi).toFixed(1)}`);
  if (adx !== null && adx < 18) contradicting.push(`adx_fraco=${Number(adx).toFixed(1)}`);
  if (diSpread !== null && diSpread < 5) contradicting.push(`di_spread_baixo=${Number(diSpread).toFixed(1)}`);
  if (position !== null && position > 0.85) contradicting.push("preco_no_topo_do_canal");
  if (position !== null && position < 0.15) contradicting.push("preco_no_fundo_do_canal");
  if (Number.isFinite(Number(payout)) && Number(payout) > 0 && Number(payout) < 75) contradicting.push(`payout_baixo=${payout}`);
  if (marketType === "OTC" && (intelligence?.macro || intelligence?.news)) contradicting.push("contexto_externo_experimental_em_otc");
  return { supporting, contradicting };
}

/** Trader: usa o sinal da estrategia congelada ativa e enriquece com leitura causal. */
export function traderDecision({ marketKey, marketType, selection, features, context, payout, freshness, intelligence, versions = {} }) {
  const startedAt = Date.now();
  const signal = features ? evaluateFrozen(selection.family, features) : null;
  const action = signal ?? "WAIT";
  const regime = detectRegime({ features, context });
  const bias = structuralBias({ context });
  const evidence = baseEvidence({ context, marketType, payout, intelligence });
  const confidence = features && Number.isFinite(features.s) ? Number(Math.min(1, Math.abs(features.s)).toFixed(4)) : 0;
  const supporting = [...evidence.supporting];
  const contradicting = [...evidence.contradicting];
  if (action === "BUY") supporting.unshift(`estrategia_${selection.variantId}_compra`); else if (action === "SELL") supporting.unshift(`estrategia_${selection.variantId}_venda`); else contradicting.unshift("sem_setup_da_estrategia");
  if (freshness?.fresh !== true) contradicting.push(`freshness=${freshness?.reason ?? "UNKNOWN"}`);
  return {
    agent: "TRADER", version: AGENT_VERSION, marketKey, marketType,
    action, analysisConfidence: confidence, estimatedWinProbability: null,
    regime, structuralBias: bias, trigger: features ? { rsi14: features.rsi14, s: Number(Number(features.s ?? 0).toFixed(4)), r24: Number(Number(features.r24 ?? 0).toFixed(6)), vol12: Number(Number(features.vol12 ?? 0).toFixed(6)) } : null,
    supportingEvidence: supporting.slice(0, 8), contradictingEvidence: contradicting.slice(0, 8),
    primaryRisk: contradicting[0] ?? null,
    whatWouldChange: ["novo_sinal_da_estrategia", "adx_acima_de_18_com_di_definido", "payout_minimo_75"],
    contextVersion: versions.contextVersion ?? null, marketDataVersion: versions.marketDataVersion ?? null,
    source: "DETERMINISTIC_FROZEN", latencyMs: Date.now() - startedAt, strategyVariantId: selection.variantId,
  };
}

function requireSignalRemoved() { return null; }

/** Critic: avaliacao independente PRIMEIRO, depois tenta refutar a tese do Trader. */
export function criticAssessment({ marketKey, marketType, selection, features, context, payout, freshness, intelligence, trader, versions = {} }) {
  const startedAt = Date.now();
  const independentSignal = features ? evaluateFrozen(selection.family, features) : null;
  const independentAction = independentSignal ?? "WAIT";  const evidence = baseEvidence({ context, marketType, payout, intelligence });
  const riskFlags = [];
  const contradictions = [];
  const missingEvidence = [];
  let verdict = "CONFIRM";
  if (freshness?.fresh !== true) { verdict = "VETO"; riskFlags.push(`dados_nao_frescos:${freshness?.reason ?? "UNKNOWN"}`); }
  if (!features) { verdict = "VETO"; riskFlags.push("features_indisponiveis"); }
  if (Number.isFinite(Number(payout)) && Number(payout) > 0 && Number(payout) < 70) { verdict = "VETO"; riskFlags.push(`payout_insuficiente:${payout}`); }
  if (intelligence?.security?.dataQuality && intelligence.security.dataQuality !== "OK") riskFlags.push("integridade_de_dados_reduzida");
  if (verdict !== "VETO") {
    if (trader?.action && trader.action !== "WAIT" && independentAction === "WAIT") { verdict = "CONTEST"; contradictions.push("critic_nao_ve_setup_independente"); }
    else if (trader?.action === "BUY" && independentAction === "SELL") { verdict = "CONTEST"; contradictions.push("direcoes_opostas"); }
    else if (trader?.action === "SELL" && independentAction === "BUY") { verdict = "CONTEST"; contradictions.push("direcoes_opostas"); }
    else if (trader?.action === independentAction) { verdict = "CONFIRM"; }
    else if (trader?.action === "WAIT" && independentAction !== "WAIT") { verdict = "CONTEST"; contradictions.push("critic_ve_setup_que_trader_ignorou"); }
  }
  contradictions.push(...evidence.contradicting.slice(0, 4));
  if (!evidence.supporting.length) missingEvidence.push("sem_evidencia_de_suporte");
  const finalRecommendation = verdict === "CONFIRM" ? trader?.action ?? "WAIT" : "WAIT";
  return {
    agent: "CRITIC", version: AGENT_VERSION, marketKey, marketType,
    independentAction, traderAssessment: verdict,
    contradictions: contradictions.slice(0, 8), missingEvidence: missingEvidence.slice(0, 6), riskFlags: riskFlags.slice(0, 8),
    finalRecommendation, analysisConfidence: trader?.analysisConfidence ?? 0, estimatedWinProbability: null,
    contextVersion: versions.contextVersion ?? null, marketDataVersion: versions.marketDataVersion ?? null,
    source: "DETERMINISTIC_INDEPENDENT", latencyMs: Date.now() - startedAt,
  };
}

/** Consensus determinístico (tabela conservadora). */
export function consensusDecision({ trader, critic, freshness, intelligence, versions = {} }) {
  const startedAt = Date.now();
  const rules = [];
  let action = "WAIT", status = "WAIT", reason = "SEM_SINAL";
  if (freshness?.fresh !== true) { status = "STALE"; reason = "FRESHNESS_INVALIDA"; rules.push("freshness_fail"); }
  else if (critic?.traderAssessment === "VETO") { status = "VETOED"; reason = "CRITIC_VETO"; rules.push("critic_veto"); }
  else {
    const t = trader?.action, c = critic?.independentAction;
    if (critic?.traderAssessment === "CONFIRM" && t === c && (t === "BUY" || t === "SELL")) { action = t; status = "CONFIRMED"; reason = "TRADER_E_CRITIC_ALINHADOS"; rules.push("trader_critic_confirm"); }
    else if (critic?.traderAssessment === "CONTEST" || t === "WAIT" || c === "WAIT" || t !== c) { status = "NO_CONSENSUS"; reason = t === "WAIT" && c === "WAIT" ? "AMBOS_WAIT" : "SEM_CONSENSO"; rules.push("no_consensus"); }
    else { status = "NO_CONSENSUS"; reason = "REGRA_NAO_SATISFEITA"; rules.push("fallback_wait"); }
  }
  return {
    action, status, reason, rules,
    analysisConfidence: action === "WAIT" ? 0 : Math.min(clamp01(trader?.analysisConfidence), clamp01(critic?.analysisConfidence ?? trader?.analysisConfidence)),
    estimatedWinProbability: null,
    intelligence: { macro: intelligence?.macro?.version ?? null, news: intelligence?.news?.version ?? null, experimental: intelligence?.experimental === true },
    contextVersion: versions.contextVersion ?? null, marketDataVersion: versions.marketDataVersion ?? null,
    latencyMs: Date.now() - startedAt, version: AGENT_VERSION,
  };
}
