/**
 * DUAL_REASONING_V1_SHADOW — experimento independente (SHADOW ONLY, determinístico, sem LLM no deadline).
 *
 * Agent A = STRUCTURAL / CONTEXT ANALYST (multi-TF, HH/HL/LH/LL, BOS, S/R, Donchian, regime, trend, ADX/DMI, ATR, compressao, scenario/playbook, location estrutural).
 * Agent B = SHORT-HORIZON / ENTRY ANALYST (candles 5s recentes, ticks, velocity/acceleration, RSI/DI trajectory, momentum curto, price action, microestrutura, location atual, trigger).
 *
 * Round 1 (T0 cego), Round 2 (T1 novo snapshot), cross-examination estruturado, Round final (T2), DUAL_SYNTHESIS_V1.
 * Nunca executa ordem; nunca altera G2/V3/V4/Late Window/Quality Gate/JIT/Execution Gate/stake/allowlist.
 */
import crypto from "node:crypto";
import { buildAgentFeatures } from "./agents-v4/features.mjs";
import { analyzeMarketRegime } from "./agents-v4/specialists/regime.mjs";
import { analyzeMarketStructure } from "./agents-v4/specialists/structure.mjs";
import { analyzeTrend } from "./agents-v4/specialists/trend.mjs";
import { analyzeScenario } from "./agents-v4/specialists/scenario.mjs";
import { analyzeMomentum } from "./agents-v4/specialists/momentum.mjs";
import { analyzePriceAction } from "./agents-v4/specialists/price-action.mjs";
import { analyzeMicrostructure } from "./agents-v4/specialists/microstructure.mjs";
import { analyzeLocation } from "./agents-v4/specialists/location.mjs";
import { analyzeVolatility } from "./agents-v4/specialists/volatility.mjs";
import { analyzeExecutionTiming } from "./agents-v4/specialists/execution-timing.mjs";
import { settleDirectionalOutcome, causalPricesFromCandles } from "./scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "./shadow-lab.mjs";
import { RollingWindow } from "./datahub/metrics.mjs";

export const DUAL_REASONING_VERSION = "DUAL_REASONING_V1_SHADOW";
export const DUAL_POLICY = Object.freeze({
  version: DUAL_REASONING_VERSION,
  mode: "SHADOW_ONLY",
  controlsExecution: false,
  sendsOrders: false,
  changesStake: false,
  llmInDeadline: false,
  deterministic: true,
  usesOwnCrossExamination: true,
  redTeamV4Untouched: true,
  lateWindowDecoupled: true,
  settlementBasis: "CAUSAL_COUNTERFACTUAL",
  settlementProvenance: "PROSPECTIVE_SHADOW",
});

export const THESIS_SURVIVAL = Object.freeze(["BOTH_SURVIVE", "ONLY_A_SURVIVES", "ONLY_B_SURVIVES", "NEITHER_SURVIVES", "CONFLICT_UNRESOLVED"]);
const ROUNDS = Object.freeze(["R1", "R2", "FINAL"]);

function sha256(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

function directionFromSign(value) { const n = num(value); if (n === null || n === 0) return null; return n > 0 ? "BULLISH" : "BEARISH"; }
function actionFromDirection(direction) { return direction === "BULLISH" ? "BUY" : direction === "BEARISH" ? "SELL" : "WAIT"; }

/* ------------------------------------ AGENT A ------------------------------------ */

export function runAgentA({ t0 = {}, execution = null } = {}) {
  const startedAt = Date.now();
  const features = buildAgentFeatures(t0);
  const regime = analyzeMarketRegime({ features, t0 });
  const structure = analyzeMarketStructure({ features });
  const trend = analyzeTrend({ features });
  const scenario = analyzeScenario({ features, specialists: {
    MARKET_REGIME_AGENT: regime, MARKET_STRUCTURE_AGENT: structure, TREND_AGENT: trend,
    LOCATION_AGENT: analyzeLocation({ features }), MOMENTUM_AGENT: analyzeMomentum({ features }),
    VOLATILITY_AGENT: analyzeVolatility({ features }), PRICE_ACTION_AGENT: analyzePriceAction({ features }),
    MICROSTRUCTURE_AGENT: analyzeMicrostructure({ features, t0 }),
  }, dataQuality: "HEALTHY" });
  const structural = t0?.timeframes?.structure1m?.label ?? null;
  const structuralLabel = trend.state === "BULLISH" ? "BULLISH" : trend.state === "BEARISH" ? "BEARISH" : structure.state === "BULLISH_STRUCTURE" ? "BULLISH" : structure.state === "BEARISH_STRUCTURE" ? "BEARISH" : "NEUTRAL";
  const agrees = structural === "UP" ? "BULLISH" : structural === "DOWN" ? "BEARISH" : null;
  const structuralDirection = structuralLabel === "NEUTRAL" && agrees ? agrees : agrees && structuralLabel !== agrees ? "UNCERTAIN" : structuralLabel;
  const scenarioDirection = scenario.detail?.direction ?? null;
  const scenarioScenario = scenario.detail?.primaryScenario ?? scenario.state;
  const evidenceFor = [...structure.bullishEvidence, ...trend.bullishEvidence, ...(scenarioDirection === "BUY" ? scenario.bullishEvidence : [])];
  const evidenceAgainst = [...structure.bearishEvidence, ...trend.bearishEvidence, ...(scenarioDirection === "SELL" ? scenario.bearishEvidence : []), ...(scenario.detail?.evidenceAgainst ?? [])];
  const candidateAction = structuralDirection === "UNCERTAIN" || !scenarioDirection || scenarioScenario === "TRANSITION_NO_TRADE"
    ? "WAIT"
    : actionFromDirection(structuralDirection) === scenarioDirection ? scenarioDirection : "WAIT";
  const thesis = {
    agent: "A", role: "STRUCTURAL_CONTEXT_ANALYST", version: DUAL_REASONING_VERSION,
    snapshotId: t0?.snapshotId ?? null, availableAt: num(t0?.times?.availableAt),
    structuralRegime: regime.state, structuralTrend: trend.state,
    primaryScenario: scenarioScenario, secondaryScenario: scenario.detail?.secondaryScenario ?? null,
    playbook: scenarioScenario, structuralDirection, candidateAction,
    evidenceFor: evidenceFor.slice(0, 8), evidenceAgainst: evidenceAgainst.slice(0, 8),
    invalidation: (scenario.invalidation ?? []).slice(0, 6), mainRisk: scenario.riskFlags?.[0] ?? structure.riskFlags?.[0] ?? null,
    confidenceClass: scenario.confidenceClass, triggerState: scenario.detail?.trigger ?? null,
    latencyMs: Date.now() - startedAt, controlsExecution: false,
  };
  return { ...thesis, thesisHash: sha256({ agent: "A", snapshotId: thesis.snapshotId, direction: structuralDirection, action: candidateAction, scenario: scenarioScenario }) };
}

/* ------------------------------------ AGENT B ------------------------------------ */

export function runAgentB({ t0 = {}, execution = null } = {}) {
  const startedAt = Date.now();
  const features = buildAgentFeatures(t0);
  const momentum = analyzeMomentum({ features });
  const priceAction = analyzePriceAction({ features });
  const microstructure = analyzeMicrostructure({ features, t0 });
  const location = analyzeLocation({ features });
  const volatility = analyzeVolatility({ features });
  const timing = analyzeExecutionTiming({ features, execution });
  const velocityDir = directionFromSign(features.velocity);
  const accelDir = directionFromSign(features.acceleration);
  const momentumDir = momentum.detail?.direction === "UP" ? "BULLISH" : momentum.detail?.direction === "DOWN" ? "BEARISH" : null;
  const priceActionDir = priceAction.state === "BULLISH" ? "BULLISH" : priceAction.state === "BEARISH" ? "BEARISH" : null;
  const votes = [velocityDir, accelDir, momentumDir, priceActionDir].filter(Boolean);
  const bullish = votes.filter((v) => v === "BULLISH").length;
  const bearish = votes.filter((v) => v === "BEARISH").length;
  const shortDirection = bullish >= 2 && bullish > bearish ? "BULLISH" : bearish >= 2 && bearish > bullish ? "BEARISH" : votes.length ? "NEUTRAL" : "UNCERTAIN";
  const triggerOk = (momentum.state === "STRONG" || momentum.state === "BUILDING") && priceAction.state !== "UNCERTAIN" && priceAction.state !== "NEUTRAL";
  const candidateAction = shortDirection === "BULLISH" && triggerOk ? "BUY" : shortDirection === "BEARISH" && triggerOk ? "SELL" : "WAIT";
  const thesis = {
    agent: "B", role: "SHORT_HORIZON_ENTRY_ANALYST", version: DUAL_REASONING_VERSION,
    snapshotId: t0?.snapshotId ?? null, availableAt: num(t0?.times?.availableAt),
    shortHorizonImpulse: momentum.detail?.direction ?? null, momentumState: momentum.state,
    priceActionState: priceAction.state, microstructureState: microstructure.state,
    entryLocation: location.state, triggerState: triggerOk ? "TRIGGER_SHORT_HORIZON" : "NO_TRIGGER",
    shortDirection, candidateAction,
    evidenceFor: [...momentum.bullishEvidence, ...priceAction.bullishEvidence].slice(0, 8),
    evidenceAgainst: [...momentum.bearishEvidence, ...priceAction.bearishEvidence, ...momentum.riskFlags].slice(0, 8),
    invalidation: [`momentum_${momentum.state}`, `price_action_${priceAction.state}`],
    mainRisk: momentum.riskFlags?.[0] ?? microstructure.riskFlags?.[0] ?? null,
    confidenceClass: momentum.state === "STRONG" || momentum.state === "REVERSING" ? "HIGH" : momentum.state === "BUILDING" || momentum.state === "WEAKENING" ? "MEDIUM" : "LOW",
    volatilityState: volatility.state, timingState: timing.state,
    latencyMs: Date.now() - startedAt, controlsExecution: false,
  };
  return { ...thesis, thesisHash: sha256({ agent: "B", snapshotId: thesis.snapshotId, direction: shortDirection, action: candidateAction, momentum: thesis.momentumState }) };
}

/* ------------------------------------ COMPARACAO / CROSS-EXAM ------------------------------------ */

export function compareTheses(a = null, b = null) {
  const startedAt = Date.now();
  if (!a || !b) return { available: false, latencyMs: Date.now() - startedAt };
  const directionConflict = a.structuralDirection !== b.shortDirection && a.structuralDirection !== "NEUTRAL" && b.shortDirection !== "NEUTRAL" && a.structuralDirection !== "UNCERTAIN" && b.shortDirection !== "UNCERTAIN";
  const agreement = a.candidateAction === b.candidateAction && a.candidateAction !== "WAIT";
  const horizonConflict = (a.structuralDirection === "BULLISH" && b.shortDirection === "BEARISH") || (a.structuralDirection === "BEARISH" && b.shortDirection === "BULLISH");
  const scenarioConflict = a.primaryScenario && a.primaryScenario !== "TRANSITION_NO_TRADE" && b.candidateAction !== "WAIT" && a.candidateAction !== b.candidateAction;
  return {
    available: true, sameSnapshot: a.snapshotId === b.snapshotId,
    agreement, directionConflict, horizonConflict, scenarioConflict,
    triggerConflict: (a.triggerState ? true : false) !== (b.triggerState === "TRIGGER_SHORT_HORIZON"),
    locationConflict: horizonConflict,
    aDirection: a.structuralDirection, bDirection: b.shortDirection,
    aAction: a.candidateAction, bAction: b.candidateAction,
    note: "conflito NAO e resolvido por maioria; direcoes opostas => WAIT por padrao.",
    latencyMs: Date.now() - startedAt,
  };
}

export function crossExamine({ self = null, other = null, round = "R1" } = {}) {
  const startedAt = Date.now();
  if (!self || !other) return { available: false, latencyMs: Date.now() - startedAt };
  const sameDirection = (self.structuralDirection ?? self.shortDirection) === (other.structuralDirection ?? other.shortDirection);
  const strongCounter = (other.evidenceFor ?? []).length >= 2 && !sameDirection;
  const verdict = sameDirection ? "AGREE" : strongCounter ? "CHALLENGE" : "PARTIAL_AGREEMENT";
  const challenge = verdict === "CHALLENGE" ? {
    challengeReason: `direcao oposta: ${self.agent}=${self.structuralDirection ?? self.shortDirection} vs ${other.agent}=${other.structuralDirection ?? other.shortDirection}`,
    competingExplanation: other.agent === "B" ? "impulso_curto_pode_ser_pullback_da_estrutura" : "estrutura_pode_estar_atrasada_para_60s",
    evidenceRequiredToResolve: ["novo candle 5s fechado", "mudanca de velocity/acceleration", "rejeicao ou perda de estrutura"],
  } : null;
  const survives = verdict === "AGREE" ? true : verdict === "PARTIAL_AGREEMENT" ? "uncertain" : false;
  return { available: true, round, self: self.agent, other: other.agent, verdict, survivesChallenge: survives, ...(challenge ? { challenge } : {}), protocol: { claim: self.candidateAction, evidence: self.evidenceFor?.slice(0, 4) ?? [], counterevidence: other.evidenceFor?.slice(0, 4) ?? [], invalidation: self.invalidation ?? [] }, latencyMs: Date.now() - startedAt };
}

/* ------------------------------------ SYNTHESIS ------------------------------------ */

export function dualSynthesis({ a = null, b = null, crossA = null, crossB = null, comparison = null } = {}) {
  const startedAt = Date.now();
  const aAction = a?.candidateAction ?? "WAIT";
  const bAction = b?.candidateAction ?? "WAIT";
  const aSurvives = crossA?.survivesChallenge !== false;
  const bSurvives = crossB?.survivesChallenge !== false;
  let action = "WAIT";
  let reason = "SEM_ACORDO";
  if (aAction !== "WAIT" && aAction === bAction && aSurvives && bSurvives) { action = aAction; reason = "AMBOS_CONCORDAM_E_SOBREVIVEM"; }
  else if (aAction !== "WAIT" && aAction === bAction && !(aSurvives && bSurvives)) { action = "WAIT"; reason = "CONCORDAM_MAS_TESE_NAO_SOBREVIVEU"; }
  else if (aAction !== "WAIT" && bAction === "WAIT") {
    const strongShortContra = (b?.evidenceAgainst?.length ?? 0) >= 3 && b?.shortDirection !== "UNCERTAIN" && b.shortDirection !== "NEUTRAL" && actionFromDirection(b.shortDirection) !== aAction;
    action = strongShortContra ? "WAIT" : (bSurvives ? aAction : "WAIT");
    reason = strongShortContra ? "SHORT_HORIZON_CONTRA_FORTE" : "A_COM_B_NEUTRO";
  } else if (aAction === "WAIT" && bAction !== "WAIT") {
    const strongStructuralContra = (a?.evidenceAgainst?.length ?? 0) >= 3 && a?.structuralDirection !== "UNCERTAIN" && a.structuralDirection !== "NEUTRAL" && actionFromDirection(a.structuralDirection) !== bAction;
    action = strongStructuralContra || !aSurvives ? "WAIT" : bAction;
    reason = strongStructuralContra ? "ESTRUTURA_CONTRA_FORTE" : "B_COM_A_NEUTRO";
  } else if (aAction !== "WAIT" && bAction !== "WAIT" && aAction !== bAction) { action = "WAIT"; reason = "CONFLITO_FORTE_DIRECAO"; }
  if (comparison?.horizonConflict) { action = "WAIT"; reason = "HORIZON_CONFLICT"; }
  return {
    version: "DUAL_SYNTHESIS_V1", action, reason,
    aAction, bAction, aSurvives, bSurvives,
    agreement: aAction === bAction && aAction !== "WAIT",
    notVoting: true, latencyMs: Date.now() - startedAt, controlsExecution: false,
  };
}

export function thesisSurvivalCategory(crossA, crossB) {
  const a = crossA?.survivesChallenge !== false;
  const b = crossB?.survivesChallenge !== false;
  if (crossA?.verdict === "CHALLENGE" && crossB?.verdict === "CHALLENGE") return "CONFLICT_UNRESOLVED";
  if (a && b) return "BOTH_SURVIVE";
  if (a) return "ONLY_A_SURVIVES";
  if (b) return "ONLY_B_SURVIVES";
  return "NEITHER_SURVIVES";
}

/* ------------------------------------ ENGINE ------------------------------------ */

export class DualReasoningEngine {
  constructor({ pool = null, dataHub = null, now = () => Date.now(), log = () => {}, enabled = true, maxObservationsPerMarket = 200, maxObservations = 1000 } = {}) {
    this.pool = pool; this.dataHub = dataHub; this.now = now; this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.maxObservationsPerMarket = maxObservationsPerMarket; this.maxObservations = maxObservations;
    this.observations = new Map(); this.order = [];
    this.latency = { agentA: new RollingWindow({ maxSamples: 512 }), agentB: new RollingWindow({ maxSamples: 512 }), comparison: new RollingWindow({ maxSamples: 512 }), crossExam: new RollingWindow({ maxSamples: 512 }), synthesis: new RollingWindow({ maxSamples: 512 }), total: new RollingWindow({ maxSamples: 512 }) };
    this.lastByMarket = new Map();
    this.counters = { observations: 0, rounds: 0, conflicts: 0, agreedTrades: 0, settled: 0, errors: 0, finalized: 0 };
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0 };
  }

  setEnabled(enabled) { this.enabled = enabled === true; return { enabled: this.enabled }; }
  list() { return this.order.map((id) => this.observations.get(id)).filter(Boolean); }

  /** Round inicial (T0) no candidato — A e B cegos, hashes congelados. */
  observeRound1({ t0 = {}, candidate = {}, g2Action = null, v4Action = null, execution = null } = {}) {
    if (!this.enabled) return null;
    const startedAt = this.now();
    try {
      const a1 = runAgentA({ t0, execution });
      const b1 = runAgentB({ t0, execution });
      const comparison = compareTheses(a1, b1);
      const id = `dual:${t0?.market?.marketKey ?? "UNKNOWN"}:${candidate.candidateId ?? t0?.snapshotId ?? startedAt}`;
      const observation = this.observations.get(id) ?? { id, candidateId: candidate.candidateId ?? null, correlationId: candidate.correlationId ?? null, marketKey: t0?.market?.marketKey ?? null, marketType: t0?.market?.marketType ?? null, accountContext: t0?.market?.accountContext ?? null, createdAt: startedAt, g2Action, v4Action, rounds: {}, payload: {}, outcome: null, settlementBasis: null, theoreticalResult: null, theoreticalPnl: null, status: "OBSERVING", direction: null };
      observation.rounds.R1 = { snapshotId: t0?.snapshotId ?? null, snapshotAt: startedAt, a: a1, b: b1, comparison, blind: true, aHash: a1.thesisHash, bHash: b1.thesisHash };
      observation.updatedAt = startedAt;
      this.#store(observation);
      this.#recordLatency("agentA", a1.latencyMs); this.#recordLatency("agentB", b1.latencyMs);
      this.#recordLatency("comparison", comparison.latencyMs); this.#recordLatency("total", this.now() - startedAt);
      this.counters.observations += 1; this.counters.rounds += 1;
      if (comparison.directionConflict) this.counters.conflicts += 1;
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("DUAL_R1_FAILED", String(error?.message ?? error).slice(0, 160)); return null; }
  }

  /** Cross-examination #1 + Round 2 (T1): novos dados point-in-time, mesmos T1 para A e B. */
  observeRound2({ observationId = null, t0 = {}, execution = null, g2Action = null, v4Action = null } = {}) {
    const observation = observationId ? this.observations.get(observationId) : null;
    if (!this.enabled || !observation || !observation.rounds.R1) return null;
    if (observation.rounds.R2) return observation;
    const startedAt = this.now();
    try {
      const round1 = observation.rounds.R1;
      const firstCrossA = crossExamine({ self: round1.a, other: round1.b, round: "R1" });
      const firstCrossB = crossExamine({ self: round1.b, other: round1.a, round: "R1" });
      const a2 = runAgentA({ t0, execution });
      const b2 = runAgentB({ t0, execution });
      const persistence = {
        structuralDirectionPersisted: round1.a.structuralDirection === a2.structuralDirection,
        shortDirectionPersisted: round1.b.shortDirection === b2.shortDirection,
        scenarioPersisted: round1.a.primaryScenario === a2.primaryScenario,
        agentAgreementPersisted: (round1.comparison?.agreement === true) === (compareTheses(a2, b2).agreement === true),
        triggerPersisted: round1.b.triggerState === b2.triggerState,
        sequenceA: [round1.a.structuralDirection, a2.structuralDirection, null],
        sequenceB: [round1.b.shortDirection, b2.shortDirection, null],
      };
      observation.rounds.R2 = { snapshotId: t0?.snapshotId ?? null, snapshotAt: this.now(), a: a2, b: b2, comparison: compareTheses(a2, b2), crossExamination1: { a: firstCrossA, b: firstCrossB }, persistence, sameSnapshotAB: a2.snapshotId === b2.snapshotId };
      observation.updatedAt = this.now();
      this.#recordLatency("crossExam", firstCrossA.latencyMs + firstCrossB.latencyMs);
      this.#recordLatency("agentA", a2.latencyMs); this.#recordLatency("agentB", b2.latencyMs);
      this.#recordLatency("total", this.now() - startedAt);
      this.counters.rounds += 1;
      void this.#persist(observation);
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("DUAL_R2_FAILED", String(error?.message ?? error).slice(0, 160)); return observation; }
  }

  /** Round final (T2) + cross-examination final + DUAL_SYNTHESIS_V1. */
  finalize({ observationId = null, t0 = {}, execution = null, candidate = {}, g2Action = null, v4Action = null, lateView = null } = {}) {
    const observation = observationId ? this.observations.get(observationId) : null;
    if (!this.enabled || !observation) return null;
    const startedAt = this.now();
    try {
      if (!observation.rounds.R2 && observation.rounds.R1) this.observeRound2({ observationId, t0, execution, g2Action, v4Action });
      const aFinal = runAgentA({ t0, execution });
      const bFinal = runAgentB({ t0, execution });
      const r2 = observation.rounds.R2 ?? { a: observation.rounds.R1.a, b: observation.rounds.R1.b };
      const finalCrossA = crossExamine({ self: aFinal, other: bFinal, round: "FINAL" });
      const finalCrossB = crossExamine({ self: bFinal, other: aFinal, round: "FINAL" });
      const comparisonFinal = compareTheses(aFinal, bFinal);
      const synthesis = dualSynthesis({ a: aFinal, b: bFinal, crossA: finalCrossA, crossB: finalCrossB, comparison: comparisonFinal });
      const survival = thesisSurvivalCategory(finalCrossA, finalCrossB);
      observation.rounds.FINAL = { snapshotId: t0?.snapshotId ?? null, snapshotAt: startedAt, a: aFinal, b: bFinal, comparison: comparisonFinal, crossExaminationFinal: { a: finalCrossA, b: finalCrossB }, synthesis, thesisSurvival: survival };
      observation.rounds.R2 = observation.rounds.R2 ? { ...observation.rounds.R2, persistence: { ...(observation.rounds.R2.persistence ?? {}), sequenceA: [observation.rounds.R1.a.structuralDirection, observation.rounds.R2.a.structuralDirection, aFinal.structuralDirection], sequenceB: [observation.rounds.R1.b.shortDirection, observation.rounds.R2.b.shortDirection, bFinal.shortDirection] } } : observation.rounds.R2;
      observation.finalAction = synthesis.action;
      observation.direction = synthesis.action === "BUY" || synthesis.action === "SELL" ? synthesis.action : null;
      observation.thesisSurvival = survival;
      observation.targetEntryAt = num(candidate.targetEntryAt); observation.targetExpiryAt = num(candidate.targetExpiryAt);
      observation.payout = num(candidate.payout);
      observation.lateIntersection = lateView ? { lateVerdict: lateView.lateVerdict ?? null, note: "intersecao observacional apenas; nenhum lado controla o outro." } : null;
      observation.g2Action = g2Action ?? observation.g2Action; observation.v4Action = v4Action ?? observation.v4Action;
      observation.status = "FINALIZED";
      observation.updatedAt = startedAt;
      this.#recordLatency("agentA", aFinal.latencyMs); this.#recordLatency("agentB", bFinal.latencyMs);
      this.#recordLatency("crossExam", finalCrossA.latencyMs + finalCrossB.latencyMs);
      this.#recordLatency("comparison", comparisonFinal.latencyMs);
      this.#recordLatency("synthesis", synthesis.latencyMs);
      const total = this.now() - startedAt;
      observation.latency = { agentA_ms: aFinal.latencyMs, agentB_ms: bFinal.latencyMs, comparison_ms: comparisonFinal.latencyMs, crossExam_ms: finalCrossA.latencyMs + finalCrossB.latencyMs, finalSynthesis_ms: synthesis.latencyMs, totalReasoningMs: total };
      this.#recordLatency("total", total);
      this.counters.finalized += 1;
      if (synthesis.action !== "WAIT") this.counters.agreedTrades += 1;
      this.lastByMarket.set(observation.marketKey, { at: this.now(), observationId: observation.id, a: aFinal, b: bFinal, synthesis, survival });
      void this.#persist(observation);
      this.#publish(observation);
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("DUAL_FINAL_FAILED", String(error?.message ?? error).slice(0, 160)); return observation; }
  }

  /** Liquidacao causal PROSPECTIVE_SHADOW (nunca broker), idempotente. */
  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const observedUntil = num(candles[index]?.bucketStart);
    if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now();
    let settled = 0;
    for (const observation of this.list()) {
      if (observation.marketKey !== marketKey) continue;
      if (observation.outcome != null || observation.settlementBasis != null) continue;
      if (observation.status === "SETTLED") continue;
      if (observation.direction !== "BUY" && observation.direction !== "SELL") continue;
      const targetExpiryAt = num(observation.targetExpiryAt);
      if (targetExpiryAt === null || observedUntil < targetExpiryAt) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: observation.targetEntryAt, targetExpiryAt });
      const result = settleDirectionalOutcome({ direction: observation.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      observation.outcome = { result, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, settlementBasis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW", at: atMs, feedableToClassification: false, outcomeUsedInClassification: false };
      observation.theoreticalResult = result;
      observation.theoreticalPnl = normalizedOutcomePnl({ result, payout: observation.payout });
      observation.settlementBasis = "CAUSAL_COUNTERFACTUAL";
      observation.status = "SETTLED";
      observation.updatedAt = atMs;
      this.settled.total += 1;
      if (result === "WIN") this.settled.wins += 1; else if (result === "LOSS") this.settled.losses += 1; else this.settled.draws += 1;
      this.counters.settled += 1;
      void this.#persist(observation);
      settled += 1;
    }
    return settled;
  }

  status({ marketKey = null } = {}) {
    const observations = this.list();
    const settled = observations.filter((row) => row.theoreticalResult);
    const wins = settled.filter((row) => row.theoreticalResult === "WIN").length;
    const conflicts = observations.filter((row) => row.rounds?.R1?.comparison?.directionConflict).length;
    const survival = observations.reduce((acc, row) => { const key = row.thesisSurvival ?? "UNKNOWN"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
    const markets = [...this.lastByMarket.entries()].filter(([key]) => !marketKey || key === marketKey).map(([key, view]) => ({ marketKey: key, at: view.at, a: { direction: view.a.structuralDirection, action: view.a.candidateAction, scenario: view.a.primaryScenario, regime: view.a.structuralRegime }, b: { direction: view.b.shortDirection, action: view.b.candidateAction, momentum: view.b.momentumState, priceAction: view.b.priceActionState }, synthesis: view.synthesis, survival: view.survival }));
    return {
      version: DUAL_REASONING_VERSION, mode: "SHADOW_ONLY", enabled: this.enabled, policy: DUAL_POLICY,
      counters: { ...this.counters, conflictRate: observations.length ? Number((conflicts / observations.length).toFixed(4)) : null, agreementRate: observations.length ? Number((observations.filter((row) => row.rounds?.FINAL?.synthesis?.agreement).length / observations.length).toFixed(4)) : null },
      settlement: { ...this.settled, decided: this.settled.wins + this.settled.losses, wr: this.settled.wins + this.settled.losses ? Number((this.settled.wins / (this.settled.wins + this.settled.losses)).toFixed(4)) : null, basis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW" },
      thesisSurvival: survival,
      latencyMs: Object.fromEntries(Object.entries(this.latency).map(([key, window]) => [key, window.summary()])),
      markets,
      comparisonWithG2V4: observations.filter((row) => row.finalAction).slice(-500).map((row) => ({ id: row.id, g2Action: row.g2Action, v4Action: row.v4Action, dualAction: row.finalAction, direction: row.direction, result: row.theoreticalResult, survival: row.thesisSurvival })),
      researchOnly: true, controlsExecution: false, sendsOrders: false,
    };
  }

  #recordLatency(key, value) { this.latency[key].record(Number(value) || 0); }
  #store(observation) {
    if (!this.observations.has(observation.id)) this.order.push(observation.id);
    this.observations.set(observation.id, observation);
    if (this.order.length > this.maxObservations) { const evicted = this.order.splice(0, this.order.length - this.maxObservations); for (const id of evicted) this.observations.delete(id); }
    const marketIds = this.order.filter((id) => this.observations.get(id)?.marketKey === observation.marketKey);
    if (marketIds.length > this.maxObservationsPerMarket) { for (const id of marketIds.slice(0, marketIds.length - this.maxObservationsPerMarket)) { this.observations.delete(id); const index = this.order.indexOf(id); if (index >= 0) this.order.splice(index, 1); } }
  }
  #publish(observation) { if (!this.dataHub) return; try { this.dataHub.publish({ eventType: "AGENT_ANALYSIS", marketKey: observation.marketKey, marketType: observation.marketType, producer: "dual-reasoning", source: "DUAL_REASONING_V1_SHADOW", payload: { action: observation.finalAction, survival: observation.thesisSurvival, a: observation.rounds?.FINAL?.a?.candidateAction, b: observation.rounds?.FINAL?.b?.candidateAction }, receivedAt: this.now(), localTime: this.now() }); } catch { /* fail-safe */ } }
  async #persist(observation) {
    if (!this.pool?.query) return;
    try {
      const payload = { version: DUAL_REASONING_VERSION, rounds: observation.rounds, finalAction: observation.finalAction, direction: observation.direction, thesisSurvival: observation.thesisSurvival, lateIntersection: observation.lateIntersection, g2Action: observation.g2Action, v4Action: observation.v4Action, latency: observation.latency, outcome: observation.outcome, policy: DUAL_POLICY };
      await this.pool.query(
        `INSERT INTO iq_dual_reasoning_observations(id, candidate_id, correlation_id, market_key, market_type, account_context, direction, final_action, thesis_survival, target_entry_at, target_expiry_at, payout, payload, outcome, settlement_basis, theoretical_result, theoretical_pnl, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17, now(), now())
         ON CONFLICT(id) DO UPDATE SET payload=$13::jsonb, direction=$7, final_action=$8, thesis_survival=$9, outcome=$14::jsonb, settlement_basis=$15, theoretical_result=$16, theoretical_pnl=$17, updated_at=now()`,
        [observation.id, observation.candidateId, observation.correlationId, observation.marketKey, observation.marketType, observation.accountContext, observation.direction, observation.finalAction, observation.thesisSurvival, observation.targetEntryAt, observation.targetExpiryAt, observation.payout, JSON.stringify(payload), JSON.stringify(observation.outcome ?? null), observation.settlementBasis, observation.theoreticalResult, observation.theoreticalPnl],
      );
    } catch (error) { this.log("DUAL_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160)); }
  }
}

export function dualFreezeManifest() {
  return {
    schema: "dual-reasoning-freeze-v1", version: DUAL_REASONING_VERSION, frozenAtUtc: new Date().toISOString(),
    policy: DUAL_POLICY,
    rules: {
      round1: "A e B cegos, mesmo T0, hashes congelados antes de qualquer comparacao.",
      round2: "mesmo T1 para A e B; cross-examination 1 apos hashes do R1.",
      final: "mesmo T2; cross-examination final; DUAL_SYNTHESIS_V1 sem votacao.",
      conflict: "direcoes opostas => WAIT por padrao; sem inversao automatica.",
      settlement: "CAUSAL_COUNTERFACTUAL / PROSPECTIVE_SHADOW, idempotente, nunca BROKER_EXECUTED.",
    },
    noTuning: true,
  };
}
