/**
 * SOLO_REASONING_V1_SHADOW — controle de SIMPLICIDADE: UM analista, UMA passada.
 * Fluxo: SCENARIO DISCOVERY -> melhor cenario -> playbook do cenario -> tese inicial (congelada)
 *        -> projecao -> auto-refutacao -> decisao final. Sem rounds, sem votacao, sem comite.
 * SHADOW ONLY; nunca executa; nunca altera G2/V3/V4/Dual/Late Window/Gates/stake/REAL.
 */
import crypto from "node:crypto";
import { buildAgentFeatures } from "./agents-v4/features.mjs";
import { analyzeMarketRegime } from "./agents-v4/specialists/regime.mjs";
import { analyzeMarketStructure } from "./agents-v4/specialists/structure.mjs";
import { analyzeTrend } from "./agents-v4/specialists/trend.mjs";
import { analyzeLocation } from "./agents-v4/specialists/location.mjs";
import { analyzeMomentum } from "./agents-v4/specialists/momentum.mjs";
import { analyzeVolatility } from "./agents-v4/specialists/volatility.mjs";
import { analyzePriceAction } from "./agents-v4/specialists/price-action.mjs";
import { analyzeMicrostructure } from "./agents-v4/specialists/microstructure.mjs";
import { settleDirectionalOutcome, causalPricesFromCandles } from "./scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "./shadow-lab.mjs";
import { RollingWindow } from "./datahub/metrics.mjs";

export const SOLO_REASONING_VERSION = "SOLO_REASONING_V1_SHADOW";
export const SOLO_POLICY = Object.freeze({
  version: SOLO_REASONING_VERSION, mode: "SHADOW_ONLY", controlsExecution: false, sendsOrders: false,
  rounds: 1, voting: false, committees: false, autoInvert: false, llmInDeadline: false, deterministic: true,
  settlementBasis: "CAUSAL_COUNTERFACTUAL", settlementProvenance: "PROSPECTIVE_SHADOW",
});
export const SCENARIOS = Object.freeze(["TREND_CONTINUATION", "TREND_PULLBACK", "BREAKOUT", "FAILED_BREAKOUT", "RANGE_MEAN_REVERSION", "REVERSAL", "COMPRESSION_EXPANSION", "TRANSITION_NO_TRADE"]);
export const SURVIVALS = Object.freeze(["THESIS_SURVIVES", "THESIS_WEAKENED", "THESIS_INVALIDATED", "AMBIGUOUS"]);
const AMBIGUITY_GAP = 0.15;
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const sha256 = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const clamp01 = (value) => Number(Math.max(0, Math.min(1, value)).toFixed(4));

/* ------------------------------- 3/4/5: scenario discovery + playbooks ------------------------------- */
export function discoverScenarios({ features, t0, specialists }) {
  const f = features;
  const regime = specialists.regime.state, structure = specialists.structure.state, trend = specialists.trend.state;
  const location = specialists.location.state, momentum = specialists.momentum.state, momentumDir = specialists.momentum.detail?.direction ?? "FLAT";
  const volatility = specialists.volatility.state, priceAction = specialists.priceAction.state, micro = specialists.microstructure.state;
  const items = [];
  const add = (scenarioId, fitScore, direction, supporting, contradicting, missing, invalidation) => items.push({ scenarioId, fitScore: clamp01(fitScore), direction, supportingEvidence: supporting, contradictingEvidence: contradicting, missingEvidence: missing, invalidationConditions: invalidation });
  const trendUp = trend === "BULLISH", trendDown = trend === "BEARISH", trendDir = trendUp ? "BUY" : trendDown ? "SELL" : null;
  const structureAligned = (trendUp && structure === "BULLISH_STRUCTURE") || (trendDown && structure === "BEARISH_STRUCTURE");
  const momentumAligned = (trendUp && momentumDir === "UP") || (trendDown && momentumDir === "DOWN");
  const overextended = location === "OVEREXTENDED_UPPER" || location === "OVEREXTENDED_LOWER";

  add("TREND_CONTINUATION", (trendDir ? 0.35 : 0) + (structureAligned ? 0.25 : 0) + (momentumAligned && ["STRONG", "BUILDING"].includes(momentum) ? 0.25 : 0) + (regime === (trendUp ? "TREND_UP" : "TREND_DOWN") ? 0.15 : 0) - (overextended ? 0.2 : 0),
    trendDir, [trendDir ? `trend=${trend}` : null, structureAligned ? `estruct=${structure}` : null, momentumAligned ? `momentum=${momentum}` : null].filter(Boolean), overextended ? ["overextended"] : [], trendDir ? [] : ["trend_direcional"], ["perda_da_estrutura", "momentum_revertendo"]);
  const pullbackZone = trendDir === "BUY" ? ["LOWER_HALF", "MID", "EDGE_LOWER"].includes(location) : ["UPPER_HALF", "MID", "EDGE_UPPER"].includes(location);
  add("TREND_PULLBACK", (trendDir ? 0.4 : 0) + (pullbackZone ? 0.3 : 0) + (momentum !== "REVERSING" ? 0.2 : 0) + ((trendDir === "BUY" ? f.pullbackUp : f.pullbackDown) ? 0.1 : 0),
    trendDir, [trendDir ? `trend=${trend}` : null, pullbackZone ? `zona=${location}` : null].filter(Boolean), pullbackZone ? [] : ["localizacao_fora_da_zona"], trendDir ? [] : ["trend_direcional"], ["perda_do_swing_do_pullback", "rompimento_contra"]);
  const bosUp = f.bosUp || f.breakoutUp, bosDown = f.bosDown || f.breakoutDown;
  add("BREAKOUT", (bosUp || bosDown ? 0.45 : 0) + (["EXPANDED", "EXPANDING", "NORMAL"].includes(volatility) ? 0.25 : 0) + (priceAction === (bosUp ? "BULLISH" : "BEARISH") ? 0.2 : 0) + (f.overextended ? -0.2 : 0.1),
    bosUp ? "BUY" : bosDown ? "SELL" : null, [bosUp ? "bos_up" : bosDown ? "bos_down" : null, `vol=${volatility}`, `pa=${priceAction}`].filter(Boolean), f.overextended ? ["esticado"] : [], bosUp || bosDown ? [] : ["sem_rompimento"], ["fechamento_de_volta_ao_range"]);
  add("FAILED_BREAKOUT", (f.failedBreakoutUp || f.failedBreakoutDown ? 0.5 : 0) + ((f.failedBreakoutUp ? priceAction === "BEARISH" : priceAction === "BULLISH") ? 0.25 : 0) + ((f.failedBreakoutUp ? ["EDGE_UPPER", "OVEREXTENDED_UPPER"] : ["EDGE_LOWER", "OVEREXTENDED_LOWER"]).includes(location) ? 0.15 : 0),
    f.failedBreakoutUp ? "SELL" : f.failedBreakoutDown ? "BUY" : null, [f.failedBreakoutUp ? "falha_topo" : f.failedBreakoutDown ? "falha_fundo" : null, `pa=${priceAction}`].filter(Boolean), [], f.failedBreakoutUp || f.failedBreakoutDown ? [] : ["sem_falha"], ["aceitacao_alem_do_nivel"]);
  const atUpper = ["EDGE_UPPER", "OVEREXTENDED_UPPER"].includes(location), atLower = ["EDGE_LOWER", "OVEREXTENDED_LOWER"].includes(location);
  add("RANGE_MEAN_REVERSION", (structure === "RANGE_STRUCTURE" ? 0.4 : 0) + (atUpper || atLower ? 0.3 : 0) + ((atUpper && f.rejectionUp) || (atLower && f.rejectionDown) ? 0.3 : 0) - (Number.isFinite(f.adx) && f.adx >= 20 ? 0.2 : 0),
    atUpper ? "SELL" : atLower ? "BUY" : null, [structure === "RANGE_STRUCTURE" ? "range" : null, atUpper ? "topo" : atLower ? "fundo" : null, (atUpper && f.rejectionUp) || (atLower && f.rejectionDown) ? "rejeicao" : null].filter(Boolean), [], [(atUpper && f.rejectionUp) || (atLower && f.rejectionDown) ? null : "sem_rejeicao", structure === "RANGE_STRUCTURE" ? null : "sem_range"].filter(Boolean), ["rompimento_com_corpo"]);
  const weakening = specialists.trend.detail?.weakening === true || ["MATURE", "EXTENDED"].includes(specialists.trend.detail?.maturity);
  add("REVERSAL", (trendDir ? 0.3 : 0) + (weakening ? 0.3 : 0) + (["REVERSING", "WEAKENING"].includes(momentum) ? 0.25 : 0) + ((trendDir === "BUY" ? priceAction === "BEARISH" : priceAction === "BULLISH") ? 0.15 : 0),
    trendDir === "BUY" ? "SELL" : trendDir === "SELL" ? "BUY" : null, [trendDir ? `trend=${trend}` : null, weakening ? "enfraquecendo" : null, `mom=${momentum}`].filter(Boolean), weakening ? [] : ["sem_exaustao"], trendDir ? [] : ["sem_trend_para_reverter"], ["retomada_da_tendencia"]);
  add("COMPRESSION_EXPANSION", (f.compressed || volatility === "COMPRESSED" ? 0.4 : 0) + (f.expansionEvent || volatility === "EXPANDING" ? 0.3 : 0) + (bosUp ? 0.2 : bosDown ? 0.2 : 0) + (priceAction !== "NEUTRAL" && priceAction !== "UNCERTAIN" ? 0.1 : 0),
    bosUp ? "BUY" : bosDown ? "SELL" : null, [f.compressed ? "comprimido" : null, f.expansionEvent ? "expansao" : null].filter(Boolean), [], bosUp || bosDown ? [] : ["expansao_sem_direcao"], ["expansao_sem_fechamento"]);
  add("TRANSITION_NO_TRADE", regime === "TRANSITION" || regime === "UNCERTAIN" ? 0.55 : 0.05, null, [`regime=${regime}`], [], [], []);

  const ranked = [...items].sort((a, b) => b.fitScore - a.fitScore);
  const primary = ranked[0], secondary = ranked[1];
  const gap = Number((primary.fitScore - secondary.fitScore).toFixed(4));
  const incompatible = primary.direction && secondary.direction && primary.direction !== secondary.direction;
  const ambiguity = primary.scenarioId !== "TRANSITION_NO_TRADE" && secondary.scenarioId !== "TRANSITION_NO_TRADE" && gap < AMBIGUITY_GAP && (incompatible || !primary.direction === !secondary.direction);
  return { scenarios: ranked, primaryScenario: primary.scenarioId, secondaryScenario: secondary.scenarioId, scenarioGap: gap, ambiguity, primaryFit: primary.fitScore, secondaryFit: secondary.fitScore };
}

/** Playbook por cenario: exige componentes especificos (nao reutiliza a mesma formula). */
function applyPlaybook(scenarioId, ctx) {
  const { features: f, location, momentum, priceAction, volatility, structure, trendDir, ambiguity } = ctx;
  if (ambiguity) return { action: "WAIT", direction: null, trigger: null, whyNow: "SCENARIO_AMBIGUITY" };
  const gates = {
    TREND_CONTINUATION: () => trendDir && structure === (trendDir === "BUY" ? "BULLISH_STRUCTURE" : "BEARISH_STRUCTURE") && ["STRONG", "BUILDING"].includes(momentum) && !["OVEREXTENDED_UPPER", "OVEREXTENDED_LOWER"].includes(location) ? { action: trendDir, trigger: "momentum_a_favor" } : null,
    TREND_PULLBACK: () => trendDir && ((trendDir === "BUY" ? ["LOWER_HALF", "MID", "EDGE_LOWER"] : ["UPPER_HALF", "MID", "EDGE_UPPER"]).includes(location)) && momentum !== "REVERSING" ? { action: trendDir, trigger: "pullback_com_retomada" } : null,
    BREAKOUT: () => (f.bosUp || f.breakoutUp || f.bosDown || f.breakoutDown) && priceAction !== "UNCERTAIN" && (Number.isFinite(f.bodyRatio) ? f.bodyRatio >= 0.5 : true) ? { action: f.bosUp || f.breakoutUp ? "BUY" : "SELL", trigger: "fechamento_alem_do_nivel" } : null,
    FAILED_BREAKOUT: () => (f.failedBreakoutUp ? priceAction === "BEARISH" : f.failedBreakoutDown ? priceAction === "BULLISH" : false) ? { action: f.failedBreakoutUp ? "SELL" : "BUY", trigger: "rejeicao_apos_falha" } : null,
    RANGE_MEAN_REVERSION: () => ((["EDGE_UPPER", "OVEREXTENDED_UPPER"].includes(location) && f.rejectionUp) ? { action: "SELL", trigger: "rejeicao_no_topo" } : (["EDGE_LOWER", "OVEREXTENDED_LOWER"].includes(location) && f.rejectionDown) ? { action: "BUY", trigger: "rejeicao_no_fundo" } : null),
    REVERSAL: () => (["REVERSING", "WEAKENING"].includes(momentum) && ((trendDir === "BUY" && priceAction === "BEARISH") || (trendDir === "SELL" && priceAction === "BULLISH"))) ? { action: trendDir === "BUY" ? "SELL" : "BUY", trigger: "exaustao_reversao" } : null,
    COMPRESSION_EXPANSION: () => ((f.compressed || volatility === "COMPRESSED") && (f.expansionEvent || volatility === "EXPANDING") && (f.bosUp || f.bosDown)) ? { action: f.bosUp ? "BUY" : "SELL", trigger: "expansao_com_direcao" } : null,
    TRANSITION_NO_TRADE: () => null,
  };
  const result = (gates[scenarioId] ?? (() => null))();
  if (!result) return { action: "WAIT", direction: null, trigger: null, whyNow: "CONTEXT_OK_NO_TRIGGER" };
  return { action: result.action, direction: result.action === "BUY" ? "BULLISH" : "BEARISH", trigger: result.trigger, whyNow: `trigger=${result.trigger}` };
}

/* ------------------------------- 6/7/8: tese + projecao ------------------------------- */
export function buildInitialThesis({ t0, discovery, playbook, specialists }) {
  const f = buildAgentFeatures(t0);
  const thesis = {
    snapshotId: t0?.snapshotId ?? null, availableAt: num(t0?.times?.availableAt),
    primaryScenario: discovery.primaryScenario, secondaryScenario: discovery.secondaryScenario, scenarioGap: discovery.scenarioGap,
    primaryFit: discovery.primaryFit, secondaryFit: discovery.secondaryFit,
    initialAction: playbook.action, initialDirection: playbook.direction, trigger: playbook.trigger,
    entryLocation: specialists.location.state, regime: specialists.regime.state,
    evidenceFor: (discovery.scenarios[0]?.supportingEvidence ?? []).slice(0, 8),
    evidenceAgainst: (discovery.scenarios[0]?.contradictingEvidence ?? []).slice(0, 8),
    invalidation: (discovery.scenarios[0]?.invalidationConditions ?? []).slice(0, 6),
    mainRisk: specialists.momentum.riskFlags?.[0] ?? null,
    whyNow: playbook.whyNow, controlsExecution: false,
  };
  return { ...thesis, initialThesisHash: sha256({ scenario: thesis.primaryScenario, action: thesis.initialAction, snapshotId: thesis.snapshotId, trigger: thesis.trigger }) };
}

export function buildProjection({ thesis, t0 }) {
  if (thesis.initialAction !== "BUY" && thesis.initialAction !== "SELL") return null;
  const f = buildAgentFeatures(t0);
  const price = num(t0?.price?.last); const atr = num(f.atr);
  const velocityATR = num(f.velocityATR) ?? 0;
  const expectedDisplacementATR = clamp01(Math.min(2, Math.max(0.3, Math.abs(velocityATR) * 6)));
  const directionUp = thesis.initialAction === "BUY";
  const zoneLow = price !== null && atr ? Number((price + (directionUp ? 0.05 : -expectedDisplacementATR) * atr).toFixed(8)) : null;
  const zoneHigh = price !== null && atr ? Number((price + (directionUp ? expectedDisplacementATR : -0.05) * atr).toFixed(8)) : null;
  return {
    expectedPath: directionUp ? ["manter_acima_da_estrutura_de_pullback", "momentum_nao_degrada_abaixo_de_BUILDING", "displacement_compativel"] : ["manter_abaixo_da_estrutura", "momentum_nao_degrada_contra", "displacement_compativel"],
    expectedExpiryDirection: directionUp ? "ACIMA_DA_ENTRADA" : "ABAIXO_DA_ENTRADA",
    expectedExpiryZone: zoneLow !== null ? { low: directionUp ? price : zoneLow, high: directionUp ? zoneHigh : price, unit: "PRICE_RANGE" } : null,
    expectedDisplacementATR, expectedStructureBehavior: "estrutura_a_favor_preservada", expectedMomentumBehavior: "momentum_mantem_estado_ou_melhora",
    expectedInvalidationPath: thesis.invalidation, note: "faixa coerente; sem probabilidade calibrada.",
  };
}

/* ------------------------------- 10/11/12/13: auto-refutacao ------------------------------- */
export function selfRefute({ thesis, t0, specialists, discovery }) {
  const f = buildAgentFeatures(t0);
  const ev = [];
  const add = (axis, severity, detail) => ev.push({ axis, severity, detail });
  const competing = discovery.scenarios[1];
  const trendDir = thesis.initialDirection === "BULLISH" ? "UP" : thesis.initialDirection === "BEARISH" ? "DOWN" : null;
  const action = thesis.initialAction;
  if (competing && competing.direction && competing.direction !== action && competing.fitScore >= discovery.primaryFit - AMBIGUITY_GAP) add("scenarioAmbiguity", "MATERIAL", `competidor ${competing.scenarioId} fit=${competing.fitScore}`);
  if (specialists.structure.state === (action === "BUY" ? "BEARISH_STRUCTURE" : "BULLISH_STRUCTURE")) add("contradictoryStructure", "FATAL", `estrutura ${specialists.structure.state}`);
  if (["OVEREXTENDED_UPPER", "OVEREXTENDED_LOWER"].includes(specialists.location.state) && ((action === "BUY" && specialists.location.state === "OVEREXTENDED_UPPER") || (action === "SELL" && specialists.location.state === "OVEREXTENDED_LOWER"))) add("badLocation", "MATERIAL", "entrada em extensao");
  if ((action === "BUY" && specialists.momentum.detail?.direction === "DOWN") || (action === "SELL" && specialists.momentum.detail?.direction === "UP")) add("momentumAgainst", "MATERIAL", `momentum=${specialists.momentum.state} dir=${specialists.momentum.detail?.direction}`);
  if ((action === "BUY" && specialists.priceAction.state === "BEARISH") || (action === "SELL" && specialists.priceAction.state === "BULLISH")) add("priceActionAgainst", "MATERIAL", `pa=${specialists.priceAction.state}`);
  if ((action === "BUY" && specialists.microstructure.state === "SELL_PRESSURE") || (action === "SELL" && specialists.microstructure.state === "BUY_PRESSURE")) add("microstructureAgainst", "WEAK", `micro=${specialists.microstructure.state}`);
  if (f.overextended) add("overextension", "WEAK", "overextended flag");
  if (!thesis.trigger) add("failedTrigger", "FATAL", "sem trigger");
  if ((action === "BUY" && specialists.regime.state === "TREND_DOWN") || (action === "SELL" && specialists.regime.state === "TREND_UP")) add("regimeConflict", "MATERIAL", `regime=${specialists.regime.state}`);
  if ((action === "BUY" && (f.velocityATR ?? 0) < 0) || (action === "SELL" && (f.velocityATR ?? 0) > 0)) add("shortHorizonConflict", "MATERIAL", `velocityATR=${f.velocityATR}`);
  if (specialists.volatility.state === "VOLATILE_SPIKE") add("volatilityMismatch", "WEAK", "spike");
  if (num(f.distanceToUpperATR) !== null && action === "BUY" && num(f.distanceToUpperATR) < 0.2) add("adverseDisplacementRisk", "WEAK", "pouco espaco até resistencia");
  const fatal = ev.filter((row) => row.severity === "FATAL").length;
  const material = ev.filter((row) => row.severity === "MATERIAL").length;
  const strength = fatal > 0 ? "FATAL" : material >= 2 ? "MATERIAL" : material === 1 || ev.length ? "WEAK" : "NONE";
  const survival = strength === "FATAL" ? "THESIS_INVALIDATED" : discovery.ambiguity ? "AMBIGUOUS" : strength === "MATERIAL" ? "THESIS_WEAKENED" : "THESIS_SURVIVES";
  return {
    counterScenario: competing?.scenarioId ?? null, counterDirection: competing?.direction ?? null,
    strongestCounterEvidence: ev.filter((row) => row.severity !== "WEAK").map((row) => row.axis).slice(0, 6),
    weakestPartOfOriginalThesis: ev[0]?.axis ?? null,
    failureMode: strength === "FATAL" ? "TESE_DESTRUIDA_POR_CONTRADICAO_DURA" : strength === "MATERIAL" ? "TESE_ENFRAQUECIDA" : "SEM_FALHA_MATERIAL",
    whatWouldMakeOriginalWrong: ev.map((row) => row.axis).slice(0, 8),
    refutationStrength: strength, survival, evidence: ev, note: "procura contraevidencia; nao defende a tese.",
  };
}

export function finalDecision({ thesis, refutation }) {
  if (thesis.initialAction !== "BUY" && thesis.initialAction !== "SELL") return { action: "WAIT", reason: "NO_INITIAL_TRADE", autoInvert: false };
  if (refutation.refutationStrength === "FATAL" || refutation.survival === "THESIS_INVALIDATED") return { action: "WAIT", reason: "THESIS_INVALIDATED", autoInvert: false };
  if (refutation.survival === "AMBIGUOUS") return { action: "WAIT", reason: "AMBIGUOUS", autoInvert: false };
  if (refutation.survival === "THESIS_WEAKENED") return { action: "WAIT", reason: "THESIS_WEAKENED_CONSERVATIVE", autoInvert: false };
  return { action: thesis.initialAction, reason: "THESIS_SURVIVES", autoInvert: false };
}

/* ------------------------------- engine ------------------------------- */
export class SoloReasoningEngine {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, enabled = true, maxObservationsPerMarket = 200, maxObservations = 1000 } = {}) {
    this.pool = pool; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true; this.maxObservationsPerMarket = maxObservationsPerMarket; this.maxObservations = maxObservations;
    this.observations = new Map(); this.order = [];
    this.latency = Object.fromEntries(["scenarioDiscovery", "playbookEvaluation", "initialThesis", "projection", "selfRefutation", "finalDecision", "total"].map((key) => [key, new RollingWindow({ maxSamples: 512 })]));
    this.counters = { observations: 0, initialTrades: 0, finalTrades: 0, cancelledByRefutation: 0, settled: 0, errors: 0 };
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0, initialWins: 0, initialLosses: 0, initialDraws: 0 };
  }
  setEnabled(enabled) { this.enabled = enabled === true; return { enabled: this.enabled }; }
  list() { return this.order.map((id) => this.observations.get(id)).filter(Boolean); }

  observe({ t0 = {}, candidate = {}, g2Action = null, v4Action = null, dualAction = null } = {}) {
    if (!this.enabled) return null;
    try {
      const t0Start = this.now();
      const f = buildAgentFeatures(t0);
      const specialists = {
        regime: analyzeMarketRegime({ features: f, t0 }), structure: analyzeMarketStructure({ features: f }), trend: analyzeTrend({ features: f }),
        location: analyzeLocation({ features: f }), momentum: analyzeMomentum({ features: f }), volatility: analyzeVolatility({ features: f }),
        priceAction: analyzePriceAction({ features: f }), microstructure: analyzeMicrostructure({ features: f, t0 }),
      };
      const discovery = discoverScenarios({ features: f, t0, specialists });
      const t1 = this.now();
      const playbook = applyPlaybook(discovery.primaryScenario, { features: f, location: specialists.location.state, momentum: specialists.momentum.state, priceAction: specialists.priceAction.state, volatility: specialists.volatility.state, structure: specialists.structure.state, trendDir: specialists.trend.state === "BULLISH" ? "BUY" : specialists.trend.state === "BEARISH" ? "SELL" : null, ambiguity: discovery.ambiguity });
      const t2 = this.now();
      const thesis = buildInitialThesis({ t0, discovery, playbook, specialists });
      const t3 = this.now();
      const projection = buildProjection({ thesis, t0 });
      const t4 = this.now();
      const refutation = selfRefute({ thesis, t0, specialists, discovery });
      const t5 = this.now();
      const decision = finalDecision({ thesis, refutation });
      const t6 = this.now();
      const id = `solo:${t0?.market?.marketKey ?? "UNKNOWN"}:${candidate.candidateId ?? t0?.snapshotId ?? t6}`;
      const observation = {
        id, candidateId: candidate.candidateId ?? null, correlationId: candidate.correlationId ?? null,
        marketKey: t0?.market?.marketKey ?? null, marketType: t0?.market?.marketType ?? null, accountContext: t0?.market?.accountContext ?? null,
        createdAt: t6, g2Action, v4Action, dualAction,
        discovery, thesis, projection, refutation, decision,
        finalAction: decision.action, direction: decision.action === "BUY" || decision.action === "SELL" ? decision.action : null,
        targetEntryAt: num(candidate.targetEntryAt), targetExpiryAt: num(candidate.targetExpiryAt), payout: num(candidate.payout),
        outcome: null, initialCounterfactual: null, settlementBasis: null, theoreticalResult: null, theoreticalPnl: null,
        latency: { scenarioDiscoveryMs: t1 - t0Start, playbookEvaluationMs: t2 - t1, initialThesisMs: t3 - t2, projectionMs: t4 - t3, selfRefutationMs: t5 - t4, finalDecisionMs: t6 - t5, totalMs: t6 - t0Start },
        status: "OBSERVED",
      };
      for (const [key, value] of Object.entries({ scenarioDiscovery: observation.latency.scenarioDiscoveryMs, playbookEvaluation: observation.latency.playbookEvaluationMs, initialThesis: observation.latency.initialThesisMs, projection: observation.latency.projectionMs, selfRefutation: observation.latency.selfRefutationMs, finalDecision: observation.latency.finalDecisionMs, total: observation.latency.totalMs })) this.latency[key].record(value);
      this.#store(observation);
      this.counters.observations += 1;
      if (thesis.initialAction === "BUY" || thesis.initialAction === "SELL") this.counters.initialTrades += 1;
      if (observation.direction) this.counters.finalTrades += 1;
      if ((thesis.initialAction === "BUY" || thesis.initialAction === "SELL") && !observation.direction) this.counters.cancelledByRefutation += 1;
      void this.#persist(observation);
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("SOLO_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160)); return null; }
  }

  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const observedUntil = num(candles[index]?.bucketStart); if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now(); let settled = 0;
    for (const observation of this.list()) {
      if (observation.marketKey !== marketKey) continue;
      if (observation.settlementBasis != null || observation.status === "SETTLED") continue;
      const targetExpiryAt = num(observation.targetExpiryAt); if (targetExpiryAt === null || observedUntil < targetExpiryAt) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: observation.targetEntryAt, targetExpiryAt });
      const settle = (direction) => direction ? settleDirectionalOutcome({ direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice }) : null;
      const finalResult = settle(observation.direction);
      const initialResult = settle(observation.thesis?.initialAction === "BUY" || observation.thesis?.initialAction === "SELL" ? observation.thesis.initialAction : null);
      if (finalResult || initialResult) {
        if (finalResult) {
          observation.outcome = { result: finalResult, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, settlementBasis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW", at: atMs, feedableToClassification: false };
          observation.theoreticalResult = finalResult; observation.theoreticalPnl = normalizedOutcomePnl({ result: finalResult, payout: observation.payout });
          this.settled.total += 1;
          if (finalResult === "WIN") this.settled.wins += 1; else if (finalResult === "LOSS") this.settled.losses += 1; else this.settled.draws += 1;
        }
        if (initialResult && observation.thesis?.initialAction !== observation.direction) {
          observation.initialCounterfactual = { result: initialResult, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, settlementBasis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW", at: atMs };
          if (initialResult === "WIN") this.settled.initialWins += 1; else if (initialResult === "LOSS") this.settled.initialLosses += 1; else this.settled.initialDraws += 1;
        }
        observation.projectionAccuracy = observation.projection && prices.expiryPrice !== null && prices.entryPrice !== null ? {
          directionCorrect: finalResult ? finalResult === "WIN" : initialResult === "WIN",
          zoneHit: observation.projection.expectedExpiryZone ? prices.expiryPrice >= observation.projection.expectedExpiryZone.low && prices.expiryPrice <= observation.projection.expectedExpiryZone.high : null,
          displacementATR: observation.thesis ? Number((Math.abs(prices.expiryPrice - prices.entryPrice) / (num(observation.thesis.atr) || 1)).toFixed(4)) : null,
          expectedDisplacementATR: observation.projection.expectedDisplacementATR ?? null,
        } : null;
        observation.settlementBasis = "CAUSAL_COUNTERFACTUAL"; observation.status = "SETTLED"; observation.updatedAt = atMs;
        this.counters.settled += 1; void this.#persist(observation); settled += 1;
      }
    }
    return settled;
  }

  status({ marketKey = null } = {}) {
    const observations = this.list();
    const survival = {}; const scenarioSelection = {}; const initialActions = {}; const finalActions = {};
    for (const o of observations) {
      survival[o.refutation?.survival ?? "UNKNOWN"] = (survival[o.refutation?.survival ?? "UNKNOWN"] ?? 0) + 1;
      scenarioSelection[o.discovery?.primaryScenario ?? "UNKNOWN"] = (scenarioSelection[o.discovery?.primaryScenario ?? "UNKNOWN"] ?? 0) + 1;
      initialActions[o.thesis?.initialAction ?? "UNKNOWN"] = (initialActions[o.thesis?.initialAction ?? "UNKNOWN"] ?? 0) + 1;
      finalActions[o.finalAction ?? "UNKNOWN"] = (finalActions[o.finalAction ?? "UNKNOWN"] ?? 0) + 1;
    }
    const settledFinal = observations.filter((o) => DECIDED.has(o.theoreticalResult));
    const settledInitial = observations.filter((o) => DECIDED.has(o.initialCounterfactual?.result));
    const zoneEvaluated = observations.filter((o) => o.projectionAccuracy && o.projectionAccuracy.zoneHit !== null);
    return {
      version: SOLO_REASONING_VERSION, mode: "SHADOW_ONLY", enabled: this.enabled, policy: SOLO_POLICY,
      counters: { ...this.counters, nextCheckpoint: [30, 60, 100, 200, 500].find((level) => level > settledFinal.length) ?? null },
      distributions: { scenarioSelection, initialActions, finalActions, survival },
      selfRefutation: { cancellations: this.counters.cancelledByRefutation, cancelRate: observations.length ? Number((this.counters.cancelledByRefutation / observations.length).toFixed(4)) : null, initialCounterfactualSettled: settledInitial.length, initialCounterfactualWins: this.settled.initialWins, initialCounterfactualLosses: this.settled.initialLosses },
      projectionAccuracy: { evaluated: zoneEvaluated.length, zoneHits: zoneEvaluated.filter((o) => o.projectionAccuracy.zoneHit === true).length, directionCorrect: observations.filter((o) => o.projectionAccuracy?.directionCorrect === true).length, directionEvaluated: observations.filter((o) => o.projectionAccuracy?.directionCorrect !== undefined && o.projectionAccuracy !== null).length },
      settlement: { ...this.settled, decided: this.settled.wins + this.settled.losses, wr: this.settled.wins + this.settled.losses ? Number((this.settled.wins / (this.settled.wins + this.settled.losses)).toFixed(4)) : null, basis: "CAUSAL_COUNTERFACTUAL" },
      latencyMs: Object.fromEntries(Object.entries(this.latency).map(([key, window]) => [key, window.summary()])),
      lastByMarket: marketKey ? [...this.observations.values()].filter((o) => o.marketKey === marketKey).slice(-1)[0] ?? null : null,
      researchOnly: true, controlsExecution: false, sendsOrders: false,
    };
  }

  #store(observation) {
    if (!this.observations.has(observation.id)) this.order.push(observation.id);
    this.observations.set(observation.id, observation);
    if (this.order.length > this.maxObservations) { for (const id of this.order.splice(0, this.order.length - this.maxObservations)) this.observations.delete(id); }
    const marketIds = this.order.filter((id) => this.observations.get(id)?.marketKey === observation.marketKey);
    if (marketIds.length > this.maxObservationsPerMarket) { for (const id of marketIds.slice(0, marketIds.length - this.maxObservationsPerMarket)) { this.observations.delete(id); const index = this.order.indexOf(id); if (index >= 0) this.order.splice(index, 1); } }
  }

  async #persist(observation) {
    if (!this.pool?.query) return;
    try {
      const payload = { version: SOLO_REASONING_VERSION, discovery: observation.discovery, thesis: observation.thesis, projection: observation.projection, refutation: observation.refutation, decision: observation.decision, latency: observation.latency, initialCounterfactual: observation.initialCounterfactual, projectionAccuracy: observation.projectionAccuracy, g2Action: observation.g2Action, v4Action: observation.v4Action, dualAction: observation.dualAction, policy: SOLO_POLICY };
      await this.pool.query(
        `INSERT INTO iq_solo_reasoning_observations(id, candidate_id, correlation_id, market_key, market_type, account_context, primary_scenario, initial_action, initial_direction, thesis_survival, refutation_strength, final_action, direction, target_entry_at, target_expiry_at, payout, payload, outcome, settlement_basis, theoretical_result, theoretical_pnl, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21, now(), now())
         ON CONFLICT(id) DO UPDATE SET payload=$17::jsonb, thesis_survival=$10, refutation_strength=$11, final_action=$12, direction=$13, outcome=$18::jsonb, settlement_basis=$19, theoretical_result=$20, theoretical_pnl=$21, updated_at=now()`,
        [observation.id, observation.candidateId, observation.correlationId, observation.marketKey, observation.marketType, observation.accountContext, observation.discovery?.primaryScenario ?? null, observation.thesis?.initialAction ?? null, observation.thesis?.initialDirection ?? null, observation.refutation?.survival ?? null, observation.refutation?.refutationStrength ?? null, observation.finalAction, observation.direction, observation.targetEntryAt, observation.targetExpiryAt, observation.payout, JSON.stringify(payload), JSON.stringify(observation.outcome ?? null), observation.settlementBasis, observation.theoreticalResult, observation.theoreticalPnl],
      );
    } catch (error) { this.log("SOLO_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160)); }
  }
}

export function soloFreezeManifest() {
  return { schema: "solo-reasoning-freeze-v1", version: SOLO_REASONING_VERSION, frozenAtUtc: new Date().toISOString(), policy: SOLO_POLICY, noTuning: true, rules: { ambiguity: "gap < 0.15 com cenarios incompativeis => WAIT", invalidated: "WAIT", weakened: "WAIT conservador", autoInvert: false, rounds: 1 } };
}
