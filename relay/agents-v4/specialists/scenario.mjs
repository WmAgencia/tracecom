/**
 * SCENARIO_AGENT — usa os especialistas para detectar os 8 cenarios do TraceCom.
 *
 * Produz primary/secondary/competing com evidenceFor/evidenceAgainst e ambiguity.
 * Nao vota: cada cenario exige componentes proprios. Sem trigger, direction=null (o
 * Synthesizer transforma isso em WAIT com whyNow explicito).
 */
import { makeAgentOutput } from "../contracts.mjs";

export const SCENARIO_AGENT_VERSION = "scenario-agent-v1";
export const SCENARIOS = Object.freeze([
  "TREND_CONTINUATION",
  "TREND_PULLBACK",
  "BREAKOUT",
  "FAILED_BREAKOUT",
  "RANGE_MEAN_REVERSION",
  "REVERSAL",
  "COMPRESSION_EXPANSION",
  "TRANSITION_NO_TRADE",
]);
export const AMBIGUITY_GAP = 1;

export function analyzeScenario({ features = {}, specialists = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const regime = specialists.MARKET_REGIME_AGENT?.state ?? "UNCERTAIN";
  const structure = specialists.MARKET_STRUCTURE_AGENT?.state ?? "UNKNOWN";
  const trend = specialists.TREND_AGENT?.state ?? "UNCERTAIN";
  const trendDetail = specialists.TREND_AGENT?.detail ?? {};
  const location = specialists.LOCATION_AGENT?.state ?? "UNKNOWN";
  const momentum = specialists.MOMENTUM_AGENT?.state ?? "STABLE";
  const momentumDirection = specialists.MOMENTUM_AGENT?.detail?.direction ?? "FLAT";
  const volatility = specialists.VOLATILITY_AGENT?.state ?? "UNKNOWN";
  const priceAction = specialists.PRICE_ACTION_AGENT?.state ?? "UNCERTAIN";
  const microstructure = specialists.MICROSTRUCTURE_AGENT?.state ?? "INSUFFICIENT";

  const candidates = [];
  const push = (scenario, score, direction, evidenceFor, evidenceAgainst, trigger = null) => {
    candidates.push({ scenario, score: Number(score.toFixed(2)), direction: direction ?? null, evidenceFor, evidenceAgainst, trigger });
  };

  const trendUp = trend === "BULLISH";
  const trendDown = trend === "BEARISH";
  const trendDir = trendUp ? "BUY" : trendDown ? "SELL" : null;
  const structureAligned = (trendUp && structure === "BULLISH_STRUCTURE") || (trendDown && structure === "BEARISH_STRUCTURE");
  const momentumAligned = (trendUp && momentumDirection === "UP") || (trendDown && momentumDirection === "DOWN");
  const locationOverextended = location === "OVEREXTENDED_UPPER" || location === "OVEREXTENDED_LOWER";

  if (trendDir && structureAligned && !locationOverextended) {
    const for_ = [`trend:${trend}`, `estrutura_alinhada:${structure}`];
    const against = [];
    let score = 2.5;
    if (momentum === "STRONG" && momentumAligned) { score += 1.5; for_.push("momentum:STRONG_alinhado"); }
    else if (momentum === "BUILDING" && momentumAligned) { score += 0.75; for_.push("momentum:BUILDING_alinhado"); }
    else { score -= 0.75; against.push(`momentum:${momentum}`); }
    if (trendDetail.weakening) { score -= 0.5; against.push("tendencia_enfraquecendo"); }
    if (location === "MID") { score -= 0.5; against.push("localizacao_no_meio"); }
    push("TREND_CONTINUATION", score, trendDir, for_, against, momentum === "STRONG" ? "momentum_strong_a_favor" : momentum === "BUILDING" ? "momentum_building_a_favor" : null);
  }

  if (trendDir && !locationOverextended && momentum !== "REVERSING") {
    const pullback = trendUp ? f.pullbackUp : f.pullbackDown;
    const pulledZone = trendUp
      ? Number.isFinite(f.donchianPosition) && f.donchianPosition <= 0.65
      : Number.isFinite(f.donchianPosition) && f.donchianPosition >= 0.35;
    const against = [];
    if (!pullback) against.push("sem_evento_de_pullback");
    if (!pulledZone) against.push("localizacao_esticada");
    let score = 2 + (pullback ? 0.75 : 0) + (pulledZone ? 0.75 : 0);
    const for_ = [`trend:${trend}`];
    if (pulledZone) for_.push(`zona_de_pullback:${f.donchianPosition}`);
    if (momentum === "WEAKENING") { score += 0.25; for_.push("pullback_em_curso"); }
    if (momentum === "BUILDING" || momentum === "STRONG") { for_.push("retomada_de_momentum"); }
    if (!structureAligned) { score -= 0.5; against.push(`estrutura:${structure}`); }
    const trigger = pullback && (momentumAligned || momentum === "WEAKENING") ? "pullback_com_retomada" : null;
    push("TREND_PULLBACK", score, trendDir, for_, against, trigger);
  }

  if (f.bosUp || f.bosDown || f.breakoutUp || f.breakoutDown) {
    const direction = f.bosUp || f.breakoutUp ? "BUY" : "SELL";
    const for_ = [direction === "BUY" ? "rompimento_de_topo" : "rompimento_de_fundo"];
    const against = [];
    let score = 2.25;
    if (volatility === "EXPANDED" || volatility === "EXPANDING") { score += 1; for_.push(`volatilidade:${volatility}`); }
    else if (volatility === "COMPRESSED") { against.push("volatilidade_contraida"); score -= 0.25; }
    const paAligned = direction === "BUY" ? priceAction === "BULLISH" : priceAction === "BEARISH";
    if (paAligned) { score += 1; for_.push(`price_action:${priceAction}`); } else { score -= 0.75; against.push(`price_action:${priceAction}`); }
    const structureContrary = (direction === "BUY" && structure === "BEARISH_STRUCTURE") || (direction === "SELL" && structure === "BULLISH_STRUCTURE");
    if (structureContrary) { score -= 1; against.push("estrutura_contraria"); }
    if (f.overextended) { score -= 0.75; against.push("rompimento_ja_percorrido"); }
    const trigger = (f.bosUp || f.bosDown) && (f.bodyRatio === null || f.bodyRatio >= 0.5) ? "fechamento_alem_do_nivel" : f.breakoutUp || f.breakoutDown ? "rompimento_sem_corpo" : null;
    push("BREAKOUT", score, direction, for_, against, trigger);
  }

  if (f.failedBreakoutUp || f.failedBreakoutDown) {
    const direction = f.failedBreakoutUp ? "SELL" : "BUY";
    const for_ = [direction === "SELL" ? "perfuracao_do_topo_com_volta" : "perfuracao_do_fundo_com_volta"];
    const against = [];
    let score = 2.5;
    if (priceAction === (direction === "SELL" ? "BEARISH" : "BULLISH")) { score += 1; for_.push(`price_action:${priceAction}`); }
    else { score -= 0.5; against.push(`price_action:${priceAction}`); }
    if (location === (direction === "SELL" ? "EDGE_UPPER" : "EDGE_LOWER") || location === (direction === "SELL" ? "OVEREXTENDED_UPPER" : "OVEREXTENDED_LOWER")) { score += 0.75; for_.push(`localizacao:${location}`); }
    if (regime === "EXPANSION") { score -= 0.25; against.push("expansao_em_curso"); }
    push("FAILED_BREAKOUT", score, direction, for_, against, f.failedBreakoutUp || f.failedBreakoutDown ? "rejeicao_apos_falha" : null);
  }

  if (structure === "RANGE_STRUCTURE" || (regime === "RANGE" && !f.bosUp && !f.bosDown)) {
    const atUpper = location === "EDGE_UPPER" || location === "OVEREXTENDED_UPPER";
    const atLower = location === "EDGE_LOWER" || location === "OVEREXTENDED_LOWER";
    for (const [edge, direction, rejection] of [[atUpper, "SELL", f.rejectionUp], [atLower, "BUY", f.rejectionDown]]) {
      if (!edge) continue;
      const for_ = [direction === "SELL" ? "preco_no_topo_do_range" : "preco_no_fundo_do_range"];
      const against = [];
      let score = 2.25;
      if (rejection) { score += 1.5; for_.push("candle_de_rejeicao_no_extremo"); }
      else { score -= 0.75; against.push("sem_rejeicao_no_extremo"); }
      if (f.adx !== null && f.adx >= 20) { score -= 0.75; against.push("adx>=20_risco_de_rompimento"); }
      push("RANGE_MEAN_REVERSION", score, direction, for_, against, rejection ? "rejeicao_no_extremo" : null);
    }
  }

  if (trendDir && (trendDetail.weakening || trendDetail.maturity === "MATURE" || trendDetail.maturity === "EXTENDED")) {
    const direction = trendUp ? "SELL" : "BUY";
    const for_ = [`tendencia_enfraquecendo:${trend}`, `maturidade:${trendDetail.maturity ?? "UNKNOWN"}`];
    const against = [];
    let score = 1.5;
    if (momentum === "REVERSING") { score += 1.5; for_.push("momentum:REVERSING"); }
    else if (momentum === "WEAKENING") { score += 0.5; for_.push("momentum:WEAKENING"); }
    if (priceAction === (direction === "BUY" ? "BULLISH" : "BEARISH")) { score += 1; for_.push(`price_action:${priceAction}`); }
    const structureAgainst = (direction === "BUY" && (structure === "BEARISH_STRUCTURE" || f.failedBreakoutDown)) || (direction === "SELL" && (structure === "BULLISH_STRUCTURE" || f.failedBreakoutUp));
    if (structureAgainst) { score += 0.75; for_.push("estrutura_quebrando_contra_a_tendencia"); } else { score -= 0.5; against.push("estrutura_ainda_a_favor"); }
    if (locationOverextended) { score += 0.5; for_.push("extensao_excessiva"); }
    const trigger = momentum === "REVERSING" || structureAgainst ? "exaustao_mais_quebra" : null;
    push("REVERSAL", score, direction, for_, against, trigger);
  }

  if (regime === "COMPRESSION" || f.compressed) {
    const direction = f.bosUp || f.breakoutUp ? "BUY" : f.bosDown || f.breakoutDown ? "SELL" : null;
    const for_ = ["volatilidade_contraida"];
    const against = [];
    let score = 2;
    if (volatility === "EXPANDING" || f.expansionEvent) { score += 1.25; for_.push("expansao_iniciando"); }
    if (direction) { score += 0.75; for_.push(direction === "BUY" ? "rompimento_para_cima" : "rompimento_para_baixo"); }
    else against.push("expansao_sem_direcao");
    if (priceAction === "BULLISH" || priceAction === "BEARISH") { score += 0.5; for_.push(`price_action:${priceAction}`); }
    push("COMPRESSION_EXPANSION", score, direction, for_, against, direction && (volatility === "EXPANDING" || f.expansionEvent) ? "expansao_com_fechamento" : null);
  }

  if (regime === "TRANSITION" || regime === "UNCERTAIN") {
    push("TRANSITION_NO_TRADE", 2.5, null, [`regime:${regime}`], [], null);
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ?? { scenario: "TRANSITION_NO_TRADE", score: 1, direction: null, evidenceFor: [], evidenceAgainst: [], trigger: null };
  const second = candidates[1] ?? null;
  const oppositeCompetitor = Boolean(second && second.direction && top.direction && second.direction !== top.direction);
  const ambiguity = Boolean(second && top.scenario !== "TRANSITION_NO_TRADE" && oppositeCompetitor && top.score - second.score <= AMBIGUITY_GAP);
  const directional = top.direction !== null && !ambiguity && top.scenario !== "TRANSITION_NO_TRADE";
  const primary = directional ? top.scenario : (ambiguity && top.direction !== null ? top.scenario : top.scenario === "TRANSITION_NO_TRADE" ? "TRANSITION_NO_TRADE" : top.scenario);
  const state = primary;

  return makeAgentOutput({
    agentId: "SCENARIO_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: `cenario=${state} direcao=${directional ? top.direction : "WAIT"} ambiguidade=${ambiguity}`,
    bullishEvidence: (top.direction === "BUY" || directional && top.direction === "BUY") ? top.evidenceFor : [],
    bearishEvidence: (top.direction === "SELL" || directional && top.direction === "SELL") ? top.evidenceFor : [],
    neutralEvidence: [`candidatos=${candidates.map((row) => `${row.scenario}:${row.score}`).join(",")}`],
    riskFlags: ambiguity ? ["SCENARIO_AMBIGUITY"] : [],
    featuresUsed: ["bosUp", "bosDown", "compressed", "expansionEvent", "overextended", "rejectionUp", "rejectionDown", "pullbackUp", "pullbackDown"],
    confidenceClass: directional && top.score >= 4 && !ambiguity ? "HIGH" : directional ? "MEDIUM" : "LOW",
    dataQuality,
    reasoningSummary: `top=${top.scenario}(${top.score}) second=${second ? `${second.scenario}(${second.score})` : "none"} ambiguidade=${ambiguity}`,
    availableAt: f.availableAt,
    detail: {
      primaryScenario: primary,
      secondaryScenario: second?.scenario ?? null,
      competingScenario: ambiguity ? second?.scenario ?? null : null,
      direction: directional ? top.direction : null,
      trigger: directional ? top.trigger : null,
      ambiguity,
      candidates: candidates.map((row) => ({ scenario: row.scenario, score: row.score, direction: row.direction, evidenceFor: row.evidenceFor, evidenceAgainst: row.evidenceAgainst, trigger: row.trigger })),
      evidenceFor: top.evidenceFor, evidenceAgainst: top.evidenceAgainst,
      inputs: { regime, structure, trend, location, momentum, volatility, priceAction, microstructure },
    },
  });
}
