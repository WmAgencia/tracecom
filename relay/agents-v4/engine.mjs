/**
 * PROFESSIONAL_AGENT_SYSTEM_V4 — engine SHADOW ONLY.
 *
 * Fluxo: T0 enriquecido -> DATA_QUALITY -> 8 especialistas de mercado -> SCENARIO ->
 * EXECUTION/RISK/DQ -> SYNTHESIS (gating por cenario) -> RED TEAM 2 fases -> COMITES.
 *
 * Nunca envia ordem; nunca altera G2/V3/Late Window/Quality Gate/Execution Gate/stake/allowlist REAL.
 * Toda latencia e medida; o hook e fail-safe (erro nunca sobe para o hot path).
 */
import { assessDataQuality } from "../datahub/data-quality-agent.mjs";
import { computeFeatureCoverage } from "../datahub/coverage.mjs";
import { RollingWindow, percentile } from "../datahub/metrics.mjs";
import { AGENTS_V4_SYSTEM_VERSION, AGENTS_V4_MODE, AGENT_POLICY, AGENT_IDS } from "./contracts.mjs";
import { buildAgentFeatures } from "./features.mjs";
import { analyzeMarketRegime } from "./specialists/regime.mjs";
import { analyzeMarketStructure } from "./specialists/structure.mjs";
import { analyzeTrend } from "./specialists/trend.mjs";
import { analyzeLocation } from "./specialists/location.mjs";
import { analyzeMomentum } from "./specialists/momentum.mjs";
import { analyzeVolatility } from "./specialists/volatility.mjs";
import { analyzePriceAction } from "./specialists/price-action.mjs";
import { analyzeMicrostructure } from "./specialists/microstructure.mjs";
import { analyzeScenario } from "./specialists/scenario.mjs";
import { analyzeExecutionTiming } from "./specialists/execution-timing.mjs";
import { analyzeRiskContext } from "./specialists/risk-context.mjs";
import { analyzeDataQuality } from "./specialists/data-quality.mjs";
import { synthesize, SYNTHESIS_RULE } from "./synthesis.mjs";
import { runRedTeamPhase1, runRedTeamPhase2, RED_TEAM_VERSION } from "./red-team.mjs";
import { runCommittees, COMMITTEE_POLICY } from "./committees.mjs";
import { publishAgentEvent } from "./agent-events.mjs";
import { runVersionRouter, ROUTER_POLICY } from "./version-router.mjs";
import { buildBenchmarkRecord, summarizeBenchmark, BENCHMARK_VERSION } from "./benchmark.mjs";

export const AGENTS_V4_ENGINE_VERSION = "agents-v4-engine-v1";
export const AGENTS_V4_ENGINE_POLICY = Object.freeze({
  version: AGENTS_V4_ENGINE_VERSION,
  mode: AGENTS_V4_MODE,
  controlsExecution: false,
  sendsOrders: false,
  changesStake: false,
  changesJit: false,
  changesLateWindow: false,
  promotesToReal: false,
  failSafeHook: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

function compactAgent(agent) {
  return {
    agentId: agent.agentId,
    state: agent.state,
    assessment: agent.assessment,
    confidenceClass: agent.confidenceClass,
    riskFlags: agent.riskFlags,
    reasoningSummary: agent.reasoningSummary,
    availableAt: agent.availableAt,
  };
}

export class AgentsV4Engine {
  constructor({ dataHub = null, persistence = null, now = () => Date.now(), log = () => {}, enabled = true, maxObservationsPerMarket = 200, maxObservations = 1_000, maxSnapshots = 128 } = {}) {
    this.dataHub = dataHub;
    this.persistence = persistence;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.maxObservationsPerMarket = Math.max(8, Number(maxObservationsPerMarket) || 200);
    this.maxObservations = Math.max(64, Number(maxObservations) || 1_000);
    this.maxSnapshots = Math.max(16, Number(maxSnapshots) || 128);
    this.observations = new Map();
    this.observationOrder = [];
    this.snapshots = [];
    this.lastByMarket = new Map();
    this.lastAnalysisByMarket = new Map();
    this.latencyTotal = new RollingWindow({ maxSamples: 512 });
    this.latencyByPhase = { specialists: new RollingWindow({ maxSamples: 512 }), synthesis: new RollingWindow({ maxSamples: 512 }), redTeam: new RollingWindow({ maxSamples: 512 }), committees: new RollingWindow({ maxSamples: 512 }) };
    this.counters = { analyzed: 0, candidates: 0, finalized: 0, errors: 0, skippedDisabled: 0, noTrade: 0 };
    this.settlement = null;
  }

  setEnabled(enabled) { this.enabled = enabled === true; return { enabled: this.enabled }; }

  attachSettlement(settlement) { this.settlement = settlement; return settlement; }

  list() { return this.observationOrder.map((id) => this.observations.get(id)).filter(Boolean); }

  get(id) { return this.observations.get(id) ?? null; }

  /** Analise deterministica completa do T0 enriquecido. Sync e sem I/O. */
  analyze({ t0 = {}, dataQualityAssessment = null, dataQualityInput = null, execution = null, risk = null, atMs = null } = {}) {
    const startedAt = this.now();
    const phase = { dqMs: 0, specialistsMs: 0, scenarioMs: 0, synthesisMs: 0, redTeamMs: 0, committeesMs: 0, perAgentMs: {} };
    const t0Start = this.now();
    const dqAssessment = dataQualityAssessment ?? (dataQualityInput ? assessDataQuality(dataQualityInput) : null);
    phase.dqMs = this.now() - t0Start;
    const dqState = dqAssessment?.state ?? "UNSAFE";
    const features = buildAgentFeatures(t0);
    const specialists = {};
    const context = { features, t0, specialists, dataQuality: dqState, execution, risk };
    const agentStartedAt = this.now();
    const add = (id, fn) => { const agentStart = this.now(); const output = fn(); specialists[id] = output; phase.perAgentMs[id] = this.now() - agentStart; };

    add("MARKET_REGIME_AGENT", () => analyzeMarketRegime({ features, t0, dataQuality: dqState }));
    add("MARKET_STRUCTURE_AGENT", () => analyzeMarketStructure({ features, dataQuality: dqState }));
    add("TREND_AGENT", () => analyzeTrend({ features, dataQuality: dqState }));
    add("LOCATION_AGENT", () => analyzeLocation({ features, dataQuality: dqState }));
    add("MOMENTUM_AGENT", () => analyzeMomentum({ features, dataQuality: dqState }));
    add("VOLATILITY_AGENT", () => analyzeVolatility({ features, dataQuality: dqState }));
    add("PRICE_ACTION_AGENT", () => analyzePriceAction({ features, dataQuality: dqState }));
    add("MICROSTRUCTURE_AGENT", () => analyzeMicrostructure({ features, t0, dataQuality: dqState }));
    phase.specialistsMs = this.now() - agentStartedAt;

    const scenarioStart = this.now();
    specialists.SCENARIO_AGENT = analyzeScenario({ features, specialists, dataQuality: dqState });
    phase.scenarioMs = this.now() - scenarioStart;

    add("EXECUTION_TIMING_AGENT", () => analyzeExecutionTiming({ features, execution, dataQuality: dqState }));
    add("RISK_CONTEXT_AGENT", () => analyzeRiskContext({ features, risk, accountContext: t0?.market?.accountContext ?? null, dataQualityState: dqState, dataQuality: dqState }));
    add("DATA_QUALITY_AGENT", () => analyzeDataQuality({ features, assessment: dqAssessment }));

    const synthesisStart = this.now();
    const synthesis = synthesize({ features, specialists, scenario: specialists.SCENARIO_AGENT, riskState: specialists.RISK_CONTEXT_AGENT.state, dataQualityState: dqState, dataQuality: dqState });
    phase.synthesisMs = this.now() - synthesisStart;

    const redTeamStart = this.now();
    const phase1 = runRedTeamPhase1({ features, atMs: atMs ?? this.now() });
    const phase2 = runRedTeamPhase2({ phase1, synthesis, specialists, features, atMs: atMs ?? this.now() });
    phase.redTeamMs = this.now() - redTeamStart;

    const committeesStart = this.now();
    const committees = runCommittees({ specialists, synthesis, redTeam: phase2, risk, execution });
    phase.committeesMs = this.now() - committeesStart;

    let finalAction = synthesis.action;
    if (dqState === "UNSAFE") finalAction = "NO_TRADE";
    else if (phase2.action === "WAIT" && finalAction !== "WAIT") finalAction = "WAIT";
    const direction = finalAction === "BUY" || finalAction === "SELL" ? finalAction : null;
    const latencyMs = this.now() - startedAt;
    phase.totalMs = latencyMs;
    this.latencyTotal.record(latencyMs);
    this.latencyByPhase.specialists.record(phase.specialistsMs);
    this.latencyByPhase.synthesis.record(phase.synthesisMs);
    this.latencyByPhase.redTeam.record(phase.redTeamMs);
    this.latencyByPhase.committees.record(phase.committeesMs);
    this.counters.analyzed += 1;
    if (finalAction === "NO_TRADE") this.counters.noTrade += 1;

    const agents = AGENT_IDS.map((id) => specialists[id]).filter(Boolean).map(compactAgent);
    return {
      version: AGENTS_V4_SYSTEM_VERSION,
      engineVersion: AGENTS_V4_ENGINE_VERSION,
      mode: AGENTS_V4_MODE,
      shadowOnly: true,
      controlsExecution: false,
      marketKey: t0?.market?.marketKey ?? null,
      marketType: t0?.market?.marketType ?? null,
      accountContext: t0?.market?.accountContext ?? null,
      snapshotId: t0?.snapshotId ?? null,
      builtAt: this.now(),
      availableAt: t0?.times?.availableAt ?? null,
      dataQuality: { state: dqState, unsafeReasons: dqAssessment?.unsafeReasons ?? [], degradedReasons: dqAssessment?.degradedReasons ?? [] },
      agents,
      specialists: Object.fromEntries(Object.entries(specialists).map(([id, output]) => [id, output])),
      scenario: {
        primary: synthesis.primaryScenario,
        secondary: synthesis.secondaryScenario,
        competing: synthesis.competingScenario,
        ambiguity: specialists.SCENARIO_AGENT?.detail?.ambiguity ?? false,
        direction: specialists.SCENARIO_AGENT?.detail?.direction ?? null,
      },
      synthesis,
      redTeam: {
        version: RED_TEAM_VERSION,
        phase1: { regime: phase1.regime, scenario: phase1.scenario, direction: phase1.direction, action: phase1.action, confidenceClass: phase1.confidenceClass, frozenHash: phase1.frozenHash, frozenAt: phase1.frozenAt },
        phase2: { verdict: phase2.verdict, conflicts: phase2.conflicts, unresolvedMaterial: phase2.unresolvedMaterial, action: phase2.action, note: phase2.note },
      },
      committees,
      finalAction,
      direction,
      triggerState: synthesis.triggerState,
      whyNow: synthesis.whyNow,
      latency: phase,
      policy: AGENT_POLICY,
      synthesisRule: SYNTHESIS_RULE,
    };
  }

  /** Observa uma OPORTUNIDADE (candidato G2) — benchmark G2/V3/V4 + persistencia + eventos. */
  observeCandidate({ t0 = {}, candidate = {}, g2Action = null, v3Runner = null, execution = null, risk = null, dataQualityAssessment = null, dataQualityInput = null } = {}) {
    if (!this.enabled) { this.counters.skippedDisabled += 1; return null; }
    try {
      const atMs = num(candidate.createdAt) ?? this.now();
      publishAgentEvent(this.dataHub, "DATA_RECEIVED", { snapshotId: t0?.snapshotId, marketKey: t0?.market?.marketKey }, { marketKey: t0?.market?.marketKey, marketType: t0?.market?.marketType, receivedAt: atMs });
      publishAgentEvent(this.dataHub, "ANALYSIS_STARTED", { candidateId: candidate.candidateId ?? null, agents: AGENT_IDS.length }, { marketKey: t0?.market?.marketKey, marketType: t0?.market?.marketType, receivedAt: atMs });
      const result = this.analyze({ t0, dataQualityAssessment, dataQualityInput, execution, risk, atMs });
      const router = runVersionRouter({
        t0, atMs, candidateId: candidate.candidateId ?? null, correlationId: candidate.correlationId ?? null,
        g2: { action: g2Action ?? "UNAVAILABLE" },
        v3: v3Runner,
        v4: { action: result.finalAction, scenario: result.scenario.primary, regime: result.specialists.MARKET_REGIME_AGENT?.state ?? null, dataQuality: result.dataQuality.state, triggerState: result.triggerState, version: result.version },
      });
      const id = `v4:${t0?.market?.marketKey ?? "UNKNOWN"}:${candidate.candidateId ?? t0?.snapshotId ?? atMs}`;
      const observation = {
        id,
        candidateId: candidate.candidateId ?? null,
        correlationId: candidate.correlationId ?? null,
        marketKey: t0?.market?.marketKey ?? null,
        marketType: t0?.market?.marketType ?? null,
        accountContext: t0?.market?.accountContext ?? null,
        activeId: num(t0?.market?.activeId),
        source: "CANDIDATE",
        provenance: "PROSPECTIVE",
        createdAt: atMs,
        updatedAt: this.now(),
        direction: result.direction,
        finalAction: result.finalAction,
        regime: result.specialists.MARKET_REGIME_AGENT?.state ?? null,
        scenario: result.scenario.primary,
        dataQuality: result.dataQuality.state,
        triggerState: result.triggerState,
        conflicts: result.redTeam.phase2.conflicts,
        redTeamVerdict: result.redTeam.phase2.verdict,
        timing: result.specialists.EXECUTION_TIMING_AGENT?.state ?? null,
        targetEntryAt: num(candidate.targetEntryAt),
        targetExpiryAt: num(candidate.targetExpiryAt),
        entryPrice: num(candidate.entryPrice),
        payout: num(candidate.payout),
        t0,
        result,
        router,
        outcome: null,
        settlementBasis: null,
        theoreticalResult: null,
        theoreticalPnl: null,
        status: "OBSERVED",
      };
      const persistView = this.#persistView(observation);
      observation.payload = persistView.payload;
      this.#store(observation);
      void this.persistence?.save?.(persistView);
      this.counters.candidates += 1;
      publishAgentEvent(this.dataHub, "FINAL_SYNTHESIS", { candidateId: observation.candidateId, action: result.finalAction, scenario: result.scenario.primary, triggerState: result.triggerState, whyNow: result.whyNow }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      publishAgentEvent(this.dataHub, "RED_TEAM_REVIEW", { candidateId: observation.candidateId, verdict: result.redTeam.phase2.verdict, unresolvedMaterial: result.redTeam.phase2.unresolvedMaterial }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      if (result.redTeam.phase2.conflicts.length) publishAgentEvent(this.dataHub, "CONFLICT", { conflicts: result.redTeam.phase2.conflicts.map((row) => row.type) }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      if (result.finalAction === "WAIT" || result.finalAction === "NO_TRADE") publishAgentEvent(this.dataHub, "WAITING", { triggerState: result.triggerState, whyNow: result.whyNow }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      else publishAgentEvent(this.dataHub, "CANDIDATE", { candidateId: observation.candidateId, action: result.finalAction, whyNow: result.whyNow }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      return observation;
    } catch (error) {
      this.counters.errors += 1;
      publishAgentEvent(this.dataHub, "ERROR", { error: String(error?.message ?? error).slice(0, 160) }, { marketKey: t0?.market?.marketKey, marketType: t0?.market?.marketType });
      this.log("AGENTS_V4_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160));
      return null;
    }
  }

  /** Reavaliacao final no instante do JIT (observacional; nao altera a decisao de entrada). */
  finalize({ observationId = null, t0 = {}, execution = null, risk = null, dataQualityAssessment = null, dataQualityInput = null } = {}) {
    const observation = observationId ? this.observations.get(observationId) ?? null : null;
    if (!observation) return null;
    try {
      const result = this.analyze({ t0, dataQualityAssessment, dataQualityInput, execution, risk });
      observation.updatedAt = this.now();
      observation.final = {
        finalAction: result.finalAction,
        direction: result.direction,
        scenario: result.scenario.primary,
        regime: result.specialists.MARKET_REGIME_AGENT?.state ?? null,
        triggerState: result.triggerState,
        whyNow: result.whyNow,
        redTeamVerdict: result.redTeam.phase2.verdict,
        dataQuality: result.dataQuality.state,
        latencyMs: result.latency.totalMs,
      };
      observation.status = "FINALIZED";
      const persistView = this.#persistView(observation);
      observation.payload = persistView.payload;
      void this.persistence?.save?.(persistView);
      publishAgentEvent(this.dataHub, "JIT_REVALIDATION", { candidateId: observation.candidateId, action: result.finalAction, triggerState: result.triggerState }, { marketKey: observation.marketKey, marketType: observation.marketType, receivedAt: this.now() });
      this.counters.finalized += 1;
      return observation;
    } catch (error) {
      this.counters.errors += 1;
      this.log("AGENTS_V4_FINALIZE_FAILED", String(error?.message ?? error).slice(0, 160));
      return null;
    }
  }

  /** Estado de mercado continuo (dashboard): atualiza ultima analise por mercado, sem persistir. */
  observeMarketState({ t0 = {}, execution = null, risk = null, dataQualityAssessment = null, dataQualityInput = null } = {}) {
    if (!this.enabled) return null;
    const analysisStart = this.now();
    try {
      const result = this.analyze({ t0, execution, risk, dataQualityAssessment, dataQualityInput });
      const view = { result, at: this.now(), latencyMs: result.latency.totalMs };
      this.lastByMarket.set(t0?.market?.marketKey ?? "UNKNOWN", view);
      this.lastAnalysisByMarket.set(t0?.market?.marketKey ?? "UNKNOWN", analysisStart);
      const snapshotKey = t0?.snapshotId;
      if (snapshotKey) {
        this.snapshots.push(t0);
        if (this.snapshots.length > this.maxSnapshots) this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
      }
      return view;
    } catch (error) {
      this.counters.errors += 1;
      this.log("AGENTS_V4_MARKET_STATE_FAILED", String(error?.message ?? error).slice(0, 160));
      return null;
    }
  }

  benchmarkRecords(limit = 500) {
    return this.list().slice(-limit).map((observation) => buildBenchmarkRecord(observation));
  }

  coverageStatus(limit = null) {
    const snapshots = (limit ? this.snapshots.slice(-limit) : this.snapshots);
    return computeFeatureCoverage(snapshots);
  }

  status({ marketKey = null, benchmarkLimit = 250 } = {}) {
    const markets = [];
    for (const [key, view] of this.lastByMarket.entries()) {
      if (marketKey && key !== marketKey) continue;
      const result = view.result;
      markets.push({
        marketKey: key,
        marketType: result.marketType,
        accountContext: result.accountContext,
        lastUpdate: view.at,
        latencyMs: view.latencyMs,
        dataQuality: result.dataQuality.state,
        regime: result.specialists.MARKET_REGIME_AGENT?.state ?? null,
        scenario: result.scenario.primary,
        action: result.finalAction,
        triggerState: result.triggerState,
        opinion: result.whyNow ?? result.synthesis.reasoningSummary,
        redTeamVerdict: result.redTeam.phase2.verdict,
        agents: result.agents,
        committees: result.committees,
      });
    }
    const observations = this.list();
    const benchmark = summarizeBenchmark(observations.slice(-benchmarkLimit).map((observation) => buildBenchmarkRecord(observation)));
    return {
      version: AGENTS_V4_SYSTEM_VERSION,
      engineVersion: AGENTS_V4_ENGINE_VERSION,
      mode: AGENTS_V4_MODE,
      enabled: this.enabled,
      shadowOnly: true,
      controlsExecution: false,
      sendsOrders: false,
      policy: { engine: AGENTS_V4_ENGINE_POLICY, agents: AGENT_POLICY, committees: COMMITTEE_POLICY, router: ROUTER_POLICY, benchmark: BENCHMARK_VERSION },
      markets,
      observations: { total: observations.length, candidates: this.counters.candidates, finalized: this.counters.finalized, errors: this.counters.errors, noTrade: this.counters.noTrade },
      benchmark,
      latencyMs: {
        total: this.latencyTotal.summary(),
        specialists: this.latencyByPhase.specialists.summary(),
        synthesis: this.latencyByPhase.synthesis.summary(),
        redTeam: this.latencyByPhase.redTeam.summary(),
        committees: this.latencyByPhase.committees.summary(),
        p99Total: percentile(this.latencyTotal.values, 0.99),
      },
      coverage: this.coverageStatus(this.maxSnapshots),
      dataHub: this.dataHub?.stats?.() ?? null,
      settlement: this.settlement?.status?.() ?? null,
      persistence: this.persistence?.status?.() ?? null,
      realAllowlistUntouched: true,
      note: "SHADOW_ONLY: nenhuma ordem e gerada pelo sistema V4; G2 segue sendo o unico caminho de execucao.",
    };
  }

  #store(observation) {
    this.observations.set(observation.id, observation);
    this.observationOrder.push(observation.id);
    if (this.observationOrder.length > this.maxObservations) {
      const evicted = this.observationOrder.splice(0, this.observationOrder.length - this.maxObservations);
      for (const id of evicted) this.observations.delete(id);
    }
    const marketIds = this.observationOrder.filter((id) => this.observations.get(id)?.marketKey === observation.marketKey);
    if (marketIds.length > this.maxObservationsPerMarket) {
      const evict = marketIds.slice(0, marketIds.length - this.maxObservationsPerMarket);
      for (const id of evict) {
        this.observations.delete(id);
        const index = this.observationOrder.indexOf(id);
        if (index >= 0) this.observationOrder.splice(index, 1);
      }
    }
    const snapshotKey = observation.t0?.snapshotId;
    if (snapshotKey) {
      this.snapshots.push(observation.t0);
      if (this.snapshots.length > this.maxSnapshots) this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }
  }

  #persistView(observation) {
    const payload = {
      schema: "agents-v4-observation-v1",
      version: observation.result?.version ?? AGENTS_V4_SYSTEM_VERSION,
      candidateId: observation.candidateId,
      correlationId: observation.correlationId,
      source: observation.source,
      provenance: observation.provenance,
      regime: observation.regime,
      scenario: observation.scenario,
      dataQuality: observation.dataQuality,
      triggerState: observation.triggerState,
      whyNow: observation.result?.whyNow ?? null,
      finalAction: observation.finalAction,
      direction: observation.direction,
      redTeam: observation.result?.redTeam ?? null,
      synthesis: observation.result?.synthesis ?? null,
      committees: observation.result?.committees ?? null,
      agents: observation.result?.agents ?? [],
      router: observation.router ? { versions: observation.router.versions, independence: observation.router.independence } : null,
      latency: observation.result?.latency ?? null,
      final: observation.final ?? null,
      shadowOnly: true,
      controlsExecution: false,
    };
    try {
      const candidate = { ...payload, t0: observation.t0 ?? null };
      if (JSON.stringify(candidate).length <= 64_000) payload.t0 = observation.t0 ?? null;
    } catch { /* t0 opcional: nunca quebra a persistencia */ }
    return { ...observation, payload };
  }
}
