/**
 * V3 — RUNTIME (orquestrador observe-only).
 *
 * Fluxo: initialization-data -> ExpirationDiscovery -> opportunity (TTE<=330s)
 *        -> ciclos a cada candle fechado -> specialists -> Asset -> Consensus/Final Challenge
 *        -> snapshot imutavel + log/persistencia.
 *
 * EXECUCAO: desligada por padrao. Mesmo com APPROVE_*, somente executa quando a estrategia
 * estiver ACTIVE/executable E V3_EXECUTE=true (futuro, com aprovacao explicita do operador).
 * Nesta fase nada e enviado ao broker: executionRef registra o bloqueio com motivo.
 */
import crypto from "node:crypto";
import { ExpirationDiscovery } from "./expiration-discovery.mjs";
import { ExpirationOpportunityEngine, CLOSED_STATES } from "./opportunity-engine.mjs";
import { ExpirationTargetTiming } from "./timing.mjs";
import { measureAll } from "./measurements.mjs";
import { runSpecialists } from "./specialists.mjs";
import { classifyAsset } from "./asset-agent.mjs";
import { runConsensus } from "./consensus.mjs";
import { buildV3DecisionSnapshot } from "./decision-snapshot.mjs";
import { runAgentCycle, agentLatencyStats, SPECIALIST_ROLES, WAVE1_ROLES, V3_AGENT_ARCHITECTURE } from "./agents/team.mjs";
import { factPrompt } from "./agents/prompts.mjs";
import { buildPacketEnvelope } from "./agents/fact-packets.mjs";
import { collectInputNumbers } from "./agents/schemas.mjs";
import { candleFeedBlockReason } from "./feed-guard.mjs";
import { canonicalDecisionDirection } from "./final-gate.mjs";
import { ExecutionScheduler } from "./scheduler.mjs";
import { stableStringify } from "../intelligence/features.mjs";

export const V3_RUNTIME_VERSION = "v3-runtime-v2";

const defaultStrategy = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null, statsEpoch: null });

export class V3Runtime {
  constructor({ now = () => Date.now(), log = () => {}, pool = null, strategy = null, discovery = null, engine = null, agents = null, agentMode = null, scheduler = null, brokerNow = null, agentSafetyMarginMs = 2_000, estimatedWaveMs = null, estimatedFullCycleMs = null, estimatedDeltaCycleMs = null, maxAgentCycles = 2 } = {}) {
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.pool = pool;
    this.strategy = strategy ?? defaultStrategy;
    this.discovery = discovery ?? new ExpirationDiscovery({ now });
    this.engine = engine ?? new ExpirationOpportunityEngine({ now });
    this.agents = agents;
    this.agentMode = agentMode ?? (agents?.available ? "LLM" : "DETERMINISTIC_OBSERVE");
    this.agentSafetyMarginMs = Math.max(0, Number(agentSafetyMarginMs) || 2_000);
    this.estimatedFullCycleMs = Math.max(1_000, Number(estimatedFullCycleMs) || Number(estimatedWaveMs) || 15_000);
    this.estimatedDeltaCycleMs = Math.max(1_000, Number(estimatedDeltaCycleMs) || this.estimatedFullCycleMs);
    this.estimatedWaveMs = this.estimatedFullCycleMs;
    this.maxAgentCycles = Math.max(1, Number(maxAgentCycles) || 2);
    this.cycleInFlight = new Set();
    this.agentArchitecture = V3_AGENT_ARCHITECTURE;
    this.brokerNow = typeof brokerNow === "function" ? brokerNow : null;
    this.scheduler = scheduler ?? new ExecutionScheduler({ now, onFire: (intent) => this.#onExecutionFire(intent), log: this.log });
    this.prevByMarket = new Map();
    this.prevAgentPackets = new Map();
    this.prevAgentOutputs = new Map();
    this.lastClosedCandleId = new Map();
    this.queues = new Map();
    this.queueDepth = 0;
    this.maxQueueDepth = 0;
    this.agentCalls = [];
    this.counters = { candleCycles: 0, cyclesSkippedNoOpportunity: 0, cyclesSkippedWindow: 0, cyclesSkippedDuplicateCandle: 0, cyclesSkippedDeadline: 0, cyclesSkippedMaxCycles: 0, cyclesSkippedOverlap: 0, snapshots: 0, approvals: 0, tentativeApprovals: 0, finalizations: 0, schedulerCancelled: 0, executionBlocked: 0, persisted: 0, persistErrors: 0, agentCycles: 0, agentUnavailable: 0, deadlineAborts: 0, scheduled: 0, schedulerFired: 0, candleFeedBlocked: 0, feedBlockedReasons: {}, lastFeedBlockedReason: null, lastFeedBlockedMarket: null, lastFeedBlockedAt: null };
    this.lastError = null;
    this.lastCycleAt = null;
    this.latencySamples = [];
  }

  get executionEnabled() { return this.strategy?.executable === true && process.env.V3_EXECUTE === "true"; }

  /** Ativos binarios do initialization-data (ids resolvidos pelo chamador). */
  onInitializationData(msg, { brokerNow = null, marketKeyByActiveId = null, activeByMarketKey = null } = {}) {
    try {
      const source = msg?.result ?? msg ?? {};
      const actives = [];
      for (const section of ["binary", "turbo"]) {
        const rows = source?.[section]?.actives ?? {};
        for (const [id, active] of Object.entries(rows)) {
          const activeId = Number(id);
          const marketKey = marketKeyByActiveId?.get?.(activeId) ?? activeByMarketKey?.get?.(activeId) ?? null;
          if (!marketKey) continue;
          actives.push({ marketKey, activeId, section, active: { ...active, id: activeId } });
        }
      }
      if (!actives.length) return { actives: 0, discovered: 0 };
      const ingest = this.discovery.ingest({ actives, brokerNow });
      const discovered = this.#adoptDueFronts(brokerNow);
      return { actives: actives.length, newOffers: ingest.newOffers, discovered };
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 160); return { actives: 0, discovered: 0, error: this.lastError }; }
  }

  #adoptDueFronts(brokerNow = null) {
    let discovered = 0;
    for (const front of this.discovery.due(brokerNow)) {
      // Fronteira ja registrada (mesmo expirada/MISSED) nunca e re-adotada: o proximo boundary
      // entra sozinho quando o relogio avanca. Evita contadores inflados e CPU por candle.
      const opportunityId = ExpirationOpportunityEngine.opportunityId(front.marketKey, front.expirationAt);
      if (this.engine.get(opportunityId)) continue;
      const offer = front.offer ?? {};
      const result = this.engine.discover({
        marketKey: front.marketKey, activeId: offer.activeId ?? null, expirationAt: front.expirationAt,
        brokerNow: brokerNow ?? this.now(), payout: offer.payout ?? null, buyability: offer.buyable ?? null, deadtimeMs: front.deadtimeMs ?? null,
      });
      if (result.created) {
        discovered += 1;
        this.log("V3_OPPORTUNITY_DISCOVERED", stableStringify({ opportunityId: result.opportunity.opportunityId, firstSeenTteMs: result.opportunity.firstSeenTteMs, deadtimeMs: front.deadtimeMs, allowedDurationsMs: front.allowedDurationsMs ?? null }));
        void this.#persistOpportunity(result.opportunity);
        void this.persistOffer({ marketKey: front.marketKey, expirationAt: front.expirationAt, activeId: offer.activeId ?? null, firstSeenAt: result.opportunity.firstSeenAt, firstSeenTteMs: result.opportunity.firstSeenTteMs, deadtimeMs: front.deadtimeMs ?? null, payout: offer.payout ?? null, buyable: offer.buyable ?? null, source: offer.source ?? "broker-clock-derived" });
      }
    }
    return discovered;
  }

  /** Ciclos em fila POR MERCADO (mercados diferentes rodam em paralelo; o mesmo mercado, serial).
   *  Nada lanca para o V2: erros ficam no lastError/log. */
  onClosedCandle(args = {}) {
    const marketKey = String(args.marketKey ?? "?");
    const previous = this.queues.get(marketKey) ?? Promise.resolve();
    this.queueDepth += 1;
    this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queueDepth);
    const run = () => this.#runCycle(args).catch((error) => { this.lastError = String(error?.message ?? error).slice(0, 160); this.log("V3_CYCLE_FAIL", this.lastError); return null; });
    const next = previous.then(run).finally(() => { this.queueDepth = Math.max(0, this.queueDepth - 1); });
    this.queues.set(marketKey, next);
    return next;
  }

  /** Um ciclo por candle fechado; so dentro de (hardCutoff, discoveryWindow]. */
  async #runCycle({ marketKey, candles, brokerNow = null } = {}) {
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    // A frente compravel e derivada do relogio do broker: adota a cada candle fechado (5s),
    // dando resolucao de 5s a descoberta (~TTE 330) sem depender do poll de initialization (60s).
    if (this.discovery.byMarket.size) this.#adoptDueFronts(at);
    const opportunity = this.engine.activeFor(String(marketKey));
    if (!opportunity) { this.counters.cyclesSkippedNoOpportunity += 1; return null; }
    const window = ExpirationTargetTiming.analysis({ expirationAt: opportunity.expirationAt, brokerNow: at });
    if (window.ok !== true) { this.counters.cyclesSkippedWindow += 1; this.engine.enforceWindow(opportunity.opportunityId, at); return null; }
    if (opportunity.cycles.length >= this.maxAgentCycles) { this.counters.cyclesSkippedMaxCycles += 1; return null; }
    if (this.cycleInFlight.has(String(marketKey))) { this.counters.cyclesSkippedOverlap += 1; return null; }
    const feedBlock = candleFeedBlockReason({ candles, brokerNow: at });
    if (feedBlock) { this.#noteFeedBlocked(feedBlock, marketKey, at); return null; }
    const startedAt = this.now();
    const measurements = measureAll(candles, { marketKey, cycleNumber: opportunity.cycles.length + 1 });
    if (!measurements) { this.#noteFeedBlocked("INSUFFICIENT_CANDLES", marketKey, at); return null; }
    const staleBlock = candleFeedBlockReason({ candles, brokerNow: at, closedCandleAt: measurements.closedCandleAt });
    if (staleBlock === "CANDLE_FEED_STALE") { this.#noteFeedBlocked(staleBlock, marketKey, at); return null; }
    const closedCandleId = measurements.closedCandleId;
    if (this.lastClosedCandleId.get(marketKey) === closedCandleId) { this.counters.cyclesSkippedDuplicateCandle += 1; return null; }
    this.lastClosedCandleId.set(marketKey, closedCandleId);
    const featureSnapshotId = `v3feat:${crypto.createHash("sha256").update(stableStringify(measurements)).digest("hex").slice(0, 24)}`;
    const previous = this.prevByMarket.get(marketKey) ?? {};
    const previousByRole = { RSI: previous.rsi, DMI_ADX: previous.dmi, BOLLINGER: previous.bollinger, ATR: previous.atr, PRICE_ACTION: previous.priceAction };
    const cycleNumber = opportunity.cycles.length + 1;
    const deterministicSpecialists = runSpecialists({ measurements, previousByRole });
    const deterministicAsset = classifyAsset({ measurements, specialists: deterministicSpecialists, previousAssessment: previous.asset ?? null, timing: { tteMs: window.derived?.tteMs ?? null } });
    const deterministicConsensus = runConsensus({ measurements, asset: deterministicAsset, timing: { ok: window.ok === true, code: window.code, tteMs: window.derived?.tteMs ?? null }, changedSincePreviousCycle: deterministicAsset?.changedSincePreviousCycle ?? [] });

    // Deadline explicito por ciclo: analysisMustFinishBy = targetSendAt - margem (default 2000ms).
    const estimatedCycleMs = opportunity.cycles.length === 0 ? this.estimatedFullCycleMs : this.estimatedDeltaCycleMs;
    const analysisMustFinishBy = opportunity.targetSendAt - this.agentSafetyMarginMs;
    const cycleBudgetMs = analysisMustFinishBy - at;
    let agentResult = null;
    if (this.agents?.available) {
      const budgetMs = cycleBudgetMs;
      if (budgetMs < estimatedCycleMs) {
        this.counters.cyclesSkippedDeadline += 1;
        this.log("V3_AGENT_CYCLE_SKIPPED_DEADLINE", stableStringify({ opportunityId: opportunity.opportunityId, budgetMs, estimatedCycleMs, cycleNumber: opportunity.cycles.length + 1 }));
      } else {
        this.cycleInFlight.add(String(marketKey));
        try {
          agentResult = await runAgentCycle({
            client: this.agents, measurements, specialists: deterministicSpecialists,
            previousPackets: this.prevAgentPackets.get(marketKey) ?? {}, previousOutputs: this.prevAgentOutputs.get(marketKey) ?? {},
            expiration: { expirationAt: opportunity.expirationAt, tteMs: window.derived?.tteMs ?? null, brokerNow: at },
            cycleNumber, opportunityId: opportunity.opportunityId, budgetMs,
            now: this.now,
          });
        } finally { this.cycleInFlight.delete(String(marketKey)); }
        this.counters.agentCycles += 1;
        if (agentResult.nextState) { this.prevAgentPackets.set(marketKey, agentResult.nextState.packets ?? {}); this.prevAgentOutputs.set(marketKey, agentResult.nextState.outputs ?? {}); }
        this.agentCalls.push(...agentResult.agentCalls);
        if (this.agentCalls.length > 2_000) this.agentCalls.splice(0, this.agentCalls.length - 2_000);
        if (agentResult.available !== true) {
          this.counters.agentUnavailable += 1;
          if (agentResult.reason === "ANALYSIS_DEADLINE") this.counters.deadlineAborts += 1;
        }
      }
    }
    // Fail-closed: sem agentes LLM validos NAO existe approval (determinismo continua coletando dados).
    const approvalsAllowed = agentResult?.available === true;
    const specialists = deterministicSpecialists;
    const asset = approvalsAllowed
      ? { scenario: agentResult.asset.scenario, direction: agentResult.asset.direction, state: agentResult.asset.state, thesis: agentResult.asset.thesis ?? null, blockers: (agentResult.asset.blockers ?? []).map((code) => ({ code })), invalidations: (agentResult.asset.invalidations ?? []).map((code) => ({ code })), bestCounterCase: agentResult.asset.bestCounterCase, changedSincePreviousCycle: (agentResult.asset.changed ?? []).map((field) => ({ field, from: null, to: null })) }
      : { ...deterministicAsset, state: "WAIT" };
    const consensus = approvalsAllowed
      ? { result: agentResult.result, agreement: agentResult.consensus.agreement, direction: agentResult.consensus.direction, independentAssessment: agentResult.consensus.independentAssessment ?? null, assetComparison: agentResult.consensus.assetComparison ?? null, challenge: { reasons: agentResult.consensus.reasons ?? [], challengeSteps: (agentResult.finalGate?.checks ?? []).map((check) => ({ id: check.id, ok: check.ok, detail: check.detail })) }, independent: agentResult.consensus, bilateral: null, bestCounterCase: null }
      : { ...deterministicConsensus, result: "AGENT_UNAVAILABLE", agreement: "INSUFFICIENT_EVIDENCE" };
    // AUTORIDADE DIRECIONAL: sempre do Consensus Final. Asset permanece hipotese independente (nunca sobrescreve).
    const canonicalDirection = canonicalDecisionDirection(consensus);

    const cycle = {
      at, tteMs: window.derived?.tteMs ?? null, closedCandleId, featureSnapshotId,
      price: measurements.closedCandle.close,
      specialistStates: { rsi: specialists.rsi?.assessment ?? null, dmi: specialists.dmi?.assessment ?? null, bollinger: specialists.bollinger?.assessment ?? null, atr: specialists.atr?.assessment ?? null, priceAction: specialists.priceAction?.assessment ?? null },
      agentSpecialistStates: approvalsAllowed ? Object.fromEntries(Object.entries(agentResult.specialists).map(([role, output]) => [role, output?.assessment ?? null])) : null,
      assetScenario: asset?.scenario ?? null, assetDirection: asset?.direction ?? null, assetState: asset?.state ?? null,
      consensusResult: consensus.result, consensusDirection: consensus?.direction ?? null, canonicalDirection,
      agreement: consensus.agreement,
      changedSincePreviousCycle: asset?.changedSincePreviousCycle ?? [],
      status: asset?.state ?? "WAIT",
      agentMode: this.agentMode,
      remainingBudgetAtCycleStart: cycleBudgetMs,
      estimatedCycleLatency: estimatedCycleMs,
      actualCycleLatency: agentResult?.latency?.total ?? null,
      deadlineAbort: agentResult?.reason === "ANALYSIS_DEADLINE",
      agents: { available: approvalsAllowed, calls: agentResult?.agentCalls ?? [] },
      deterministic: { asset: deterministicAsset?.scenario ?? null, direction: deterministicAsset?.direction ?? null, state: deterministicAsset?.state ?? null, consensus: deterministicConsensus.result },
      measurements, specialists, asset, consensus,
    };
    this.engine.recordCycle(opportunity.opportunityId, cycle);
    this.engine.enforceWindow(opportunity.opportunityId, at);
    this.engine.finalizeCycle(opportunity.opportunityId, { asset, consensus, brokerNow: at });
    if (approvalsAllowed) this.prevByMarket.set(marketKey, { ...specialists, asset });

    // Tentativa registrada pelo engine (revisavel). Intent TENTATIVO reversivel: agenda/replace, nunca imutavel.
    const tentative = opportunity.tentativeDecision;
    const tentativeApproved = tentative && (tentative.result === "APPROVE_BUY" || tentative.result === "APPROVE_SELL");
    if (tentativeApproved && opportunity.finalizedAt === null) {
      const scheduled = this.scheduler.schedule({
        opportunityId: opportunity.opportunityId, expirationAt: opportunity.expirationAt, targetSendAt: opportunity.targetSendAt, hardCutoffAt: opportunity.hardStrategicCutoffAt, brokerNow: at,
        context: { result: tentative.result, direction: tentative.direction, cycleNumber: tentative.cycleNumber, tentative: true, snapshotHash: null },
      });
      if (scheduled?.scheduled) { this.counters.scheduled += 1; this.counters.tentativeApprovals += 1; }
    }

    // FREEZE pre-send: se nao existe mais ciclo viavel, a ULTIMA tentativa valida vira final (NO SUNK COST).
    if (opportunity.finalizedAt === null && !CLOSED_STATES.includes(opportunity.status) && !this.#canRunMoreCycles(opportunity, at)) {
      const finalized = this.engine.finalizeOpportunity(opportunity.opportunityId, { brokerNow: at, reason: opportunity.cycles.length >= this.maxAgentCycles ? "MAX_CYCLES" : "NO_BUDGET" });
      this.counters.finalizations += 1;
      const final = finalized?.finalDecision ?? null;
      if (final && (final.result === "APPROVE_BUY" || final.result === "APPROVE_SELL")) {
        const finalDecision = { result: final.result, at, tteMs: window.derived?.tteMs ?? null, scenario: final.scenario, direction: final.direction, agentMode: this.agentMode, agreement: final.agreement, cycleNumber: final.cycleNumber };
        const snapshot = buildV3DecisionSnapshot({ strategy: this.strategy, opportunity, cycles: opportunity.cycles, asset, consensus, specialists, measurements, finalDecision, timing: window.derived });
        this.counters.snapshots += 1;
        this.counters.approvals += 1;
        const scheduled = this.scheduler.schedule({
          opportunityId: opportunity.opportunityId, expirationAt: opportunity.expirationAt, targetSendAt: opportunity.targetSendAt, hardCutoffAt: opportunity.hardStrategicCutoffAt, brokerNow: at,
          context: { result: finalDecision.result, direction: finalDecision.direction, cycleNumber: finalDecision.cycleNumber, final: true, snapshotHash: snapshot.snapshotHash },
        });
        if (scheduled?.scheduled) this.counters.scheduled += 1;
        opportunity.finalDecision = { ...opportunity.finalDecision, snapshotHash: snapshot.snapshotHash, executionBlocked: this.executionEnabled ? "V3_EXECUTION_NOT_WIRED" : "V3_NOT_ACTIVE" };
        opportunity.executionRef = { ...(opportunity.executionRef ?? {}), scheduledSendAt: opportunity.targetSendAt, scheduledAt: at, submit: false, blocked: opportunity.finalDecision.executionBlocked };
        this.counters.executionBlocked += 1;
      } else {
        // Decisao final CANCEL: qualquer intent anterior e cancelado de forma idempotente.
        if (this.scheduler.cancel(opportunity.opportunityId, "FINAL_CONSENSUS_CANCEL")) this.counters.schedulerCancelled += 1;
      }
    }

    void this.#persistCycle(opportunity.opportunityId, cycle);
    if (CLOSED_STATES.includes(opportunity.status) || opportunity.finalizedAt !== null) void this.#persistOpportunity(opportunity);
    const latencyMs = Math.max(0, this.now() - startedAt);
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 500) this.latencySamples.shift();
    this.counters.candleCycles += 1;
    this.lastCycleAt = at;
    this.log("V3_CYCLE", stableStringify({ opportunityId: opportunity.opportunityId, cycle: cycle.cycleNumber, tteMs: cycle.tteMs, scenario: asset?.scenario, assetDirection: asset?.direction ?? null, consensusDirection: consensus?.direction ?? null, canonicalDirection, state: asset?.state, consensus: consensus.result, agreement: consensus.agreement, agentMode: this.agentMode, latencyMs }));
    return { opportunityId: opportunity.opportunityId, cycle: cycle.cycleNumber, tteMs: cycle.tteMs, assetState: asset?.state ?? null, scenario: asset?.scenario ?? null, direction: canonicalDirection, assetDirection: asset?.direction ?? null, consensus: consensus.result, agreement: consensus.agreement, agentMode: this.agentMode, latencyMs };
  }

  /** Disparo no alvo (~TTE302): revalida tudo; observe-only nunca envia ordem. */
  async #onExecutionFire(intent) {
    const opportunity = this.engine.get(intent.opportunityId);
    const at = Number.isFinite(Number(intent.firedAt)) ? Number(intent.firedAt) : this.now();
    const brokerNow = this.brokerNow ? this.brokerNow() : at;
    if (!opportunity) return { opportunityId: intent.opportunityId, fired: true, result: "OPPORTUNITY_GONE" };
    const execution = ExpirationTargetTiming.execution({ expirationAt: opportunity.expirationAt, brokerNow, purchaseDeadlineAt: opportunity.purchaseDeadlineAt });
    const lastCycle = opportunity.cycles[opportunity.cycles.length - 1] ?? null;
    // DIRECAO CANONICA: preferir a direcao persistida (Consensus); fallback derivado do result. NUNCA do Asset.
    const storedDirection = opportunity.finalDecision?.direction;
    const direction = storedDirection === "UP" || storedDirection === "DOWN" ? storedDirection : opportunity.finalDecision?.result === "APPROVE_SELL" ? "DOWN" : "UP";
    const relevantInvalidations = (lastCycle?.asset?.invalidations ?? []).filter((item) => (String(item.code).includes("BEARISH") ? direction !== "DOWN" : String(item.code).includes("BULLISH") ? direction !== "UP" : true));
    const checks = {
      executionWindow: execution.ok === true, executionCode: execution.code, tteMs: execution.derived?.tteMs ?? null,
      invalidations: relevantInvalidations.map((item) => item.code),
      blockers: (lastCycle?.asset?.blockers ?? []).map((item) => item.code),
      agentMode: this.agentMode,
    };
    if (checks.executionWindow !== true) {
      opportunity.executionRef = { ...(opportunity.executionRef ?? {}), fireAt: brokerNow, checks, submit: false, blocked: execution.code };
      this.engine.enforceWindow(opportunity.opportunityId, brokerNow);
      await this.#persistOpportunity(opportunity);
      return { opportunityId: opportunity.opportunityId, fired: true, ...checks, result: execution.code };
    }
    if (checks.invalidations.length > 0 || checks.blockers.length > 0) {
      opportunity.executionRef = { ...(opportunity.executionRef ?? {}), fireAt: brokerNow, checks, submit: false, blocked: "REVALIDATION_BLOCKED" };
      this.engine.cancel(opportunity.opportunityId, "REVALIDATION_BLOCKED");
      await this.#persistOpportunity(opportunity);
      return { opportunityId: opportunity.opportunityId, fired: true, ...checks, result: "REVALIDATION_BLOCKED" };
    }
    opportunity.executionRef = { ...(opportunity.executionRef ?? {}), fireAt: brokerNow, checks, submit: false, wouldSubmitAt: brokerNow, blocked: this.executionEnabled ? "V3_EXECUTION_NOT_WIRED" : "V3_NOT_ACTIVE" };
    this.counters.schedulerFired += 1;
    await this.#persistOpportunity(opportunity);
    this.log("V3_SCHEDULER_FIRED_OBSERVE_ONLY", stableStringify({ opportunityId: opportunity.opportunityId, tteMs: checks.tteMs, result: opportunity.finalDecision?.result ?? null }));
    return { opportunityId: opportunity.opportunityId, fired: true, ...checks, submit: false };
  }

  async #persistOpportunity(opportunity) {
    if (!this.pool?.query) return false;
    try {
      await this.pool.query(
        `INSERT INTO iq_v3_opportunities(opportunity_id,strategy_version,strategy_hash,market_key,active_id,expiration_at,first_seen_at,first_seen_tte_ms,target_send_at,hard_cutoff_at,purchase_deadline_at,payout,buyability,status,final_decision,execution_ref,cycles_count,snapshot_hash,agent_mode,scheduled_send_at,scheduled_fire_at,revalidation,closed_at,closed_reason,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,now())
         ON CONFLICT(opportunity_id) DO UPDATE SET status=EXCLUDED.status, final_decision=COALESCE(EXCLUDED.final_decision,iq_v3_opportunities.final_decision), execution_ref=COALESCE(EXCLUDED.execution_ref,iq_v3_opportunities.execution_ref), cycles_count=EXCLUDED.cycles_count, snapshot_hash=COALESCE(EXCLUDED.snapshot_hash,iq_v3_opportunities.snapshot_hash), agent_mode=COALESCE(EXCLUDED.agent_mode,iq_v3_opportunities.agent_mode), scheduled_send_at=COALESCE(EXCLUDED.scheduled_send_at,iq_v3_opportunities.scheduled_send_at), scheduled_fire_at=COALESCE(EXCLUDED.scheduled_fire_at,iq_v3_opportunities.scheduled_fire_at), revalidation=COALESCE(EXCLUDED.revalidation,iq_v3_opportunities.revalidation), closed_at=EXCLUDED.closed_at, closed_reason=EXCLUDED.closed_reason, updated_at=now()`,
        [opportunity.opportunityId, this.strategy?.version ?? null, this.strategy?.strategyHash ?? null, opportunity.marketKey, opportunity.activeId ?? null, new Date(opportunity.expirationAt).toISOString(), new Date(opportunity.firstSeenAt).toISOString(), opportunity.firstSeenTteMs, new Date(opportunity.targetSendAt).toISOString(), new Date(opportunity.hardStrategicCutoffAt).toISOString(), opportunity.purchaseDeadlineAt ? new Date(opportunity.purchaseDeadlineAt).toISOString() : null, opportunity.payout ?? null, opportunity.buyability ?? null, opportunity.status, opportunity.finalDecision ? JSON.stringify(opportunity.finalDecision) : null, opportunity.executionRef ? JSON.stringify(opportunity.executionRef) : null, opportunity.cycles.length, opportunity.finalDecision?.snapshotHash ?? null, this.agentMode, opportunity.executionRef?.scheduledSendAt ? new Date(opportunity.executionRef.scheduledSendAt).toISOString() : null, opportunity.executionRef?.fireAt ? new Date(opportunity.executionRef.fireAt).toISOString() : null, opportunity.executionRef?.checks ? JSON.stringify(opportunity.executionRef.checks) : null, opportunity.closedAt ? new Date(opportunity.closedAt).toISOString() : null, opportunity.closedReason ?? null],
      );
      this.counters.persisted += 1;
      return true;
    } catch (error) { this.counters.persistErrors += 1; this.log("V3_PERSIST_OPPORTUNITY_FAIL", String(error?.message ?? error).slice(0, 140)); return false; }
  }

  async #persistCycle(opportunityId, cycle) {
    if (!this.pool?.query) return false;
    try {
      await this.pool.query(
        `INSERT INTO iq_v3_cycles(opportunity_id,cycle_number,at,tte_ms,closed_candle_id,price,feature_snapshot_id,asset_scenario,asset_state,consensus_result,agreement,payload,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
         ON CONFLICT(opportunity_id,cycle_number) DO NOTHING`,
        [opportunityId, cycle.cycleNumber, new Date(cycle.at).toISOString(), cycle.tteMs, cycle.closedCandleId, cycle.price, cycle.featureSnapshotId, cycle.assetScenario, cycle.assetState, cycle.consensusResult, cycle.agreement, JSON.stringify({ specialistStates: cycle.specialistStates, agentSpecialistStates: cycle.agentSpecialistStates ?? null, changedSincePreviousCycle: cycle.changedSincePreviousCycle, bestCounterCase: cycle.asset?.bestCounterCase ?? null, reasons: cycle.consensus?.challenge?.reasons ?? [], agentMode: cycle.agentMode ?? null, agents: cycle.agents ?? null, deterministic: cycle.deterministic ?? null })],
      );
      return true;
    } catch (error) { this.counters.persistErrors += 1; this.log("V3_PERSIST_CYCLE_FAIL", String(error?.message ?? error).slice(0, 140)); return false; }
  }

  /** Callback do ExpirationDiscovery para persistir ofertas (observacao read-only). */
  async persistOffer(offer) {
    if (!this.pool?.query) return false;
    try {
      await this.pool.query(
        `INSERT INTO iq_v3_expiration_offers(market_key,expiration_at,active_id,first_seen_at,first_seen_tte_ms,deadtime_ms,payout,buyable,source,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(market_key,expiration_at) DO NOTHING`,
        [offer.marketKey, new Date(offer.expirationAt).toISOString(), offer.activeId, new Date(offer.firstSeenAt).toISOString(), offer.firstSeenTteMs, offer.deadtimeMs ?? null, offer.payout ?? null, offer.buyable === true, offer.source ?? null],
      );
      return true;
    } catch { return false; }
  }

  latencyStats() {
    const values = [...this.latencySamples].sort((a, b) => a - b);
    const at = (fraction) => (values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] : null);
    return { count: values.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: values.length ? values[values.length - 1] : null };
  }

  /** Ha tempo para mais um ciclo LLM? Estimativa conservadora por tipo + deadline pre-send. */
  #canRunMoreCycles(opportunity, at = this.now()) {
    if (!opportunity || opportunity.finalizedAt !== null) return false;
    if (CLOSED_STATES.includes(opportunity.status)) return false;
    if (opportunity.cycles.length >= this.maxAgentCycles) return false;
    const estimate = opportunity.cycles.length === 0 ? this.estimatedFullCycleMs : this.estimatedDeltaCycleMs;
    return (opportunity.targetSendAt - this.agentSafetyMarginMs - at) >= estimate;
  }

  #noteFeedBlocked(reason, marketKey = null, at = null) {    if (!reason) return;
    this.counters.candleFeedBlocked += 1;
    this.counters.feedBlockedReasons[reason] = (this.counters.feedBlockedReasons[reason] ?? 0) + 1;
    this.counters.lastFeedBlockedReason = reason;
    this.counters.lastFeedBlockedMarket = marketKey ?? null;
    this.counters.lastFeedBlockedAt = at ?? this.now();
  }

  /** Diagnostico externo (relay): registra bloqueio de feed SEM chamar agentes. */
  noteFeedBlocked(reason, marketKey = null) { this.#noteFeedBlocked(reason, marketKey); }

  status() {
    return {
      version: V3_RUNTIME_VERSION,
      strategy: { version: this.strategy?.version ?? null, status: this.strategy?.status ?? null, executable: this.strategy?.executable === true, strategyHash: this.strategy?.strategyHash ?? null, statsEpoch: this.strategy?.statsEpoch ?? null },
      executionEnabled: this.executionEnabled,
      executionMode: "OBSERVE_ONLY",
      agentMode: this.agentMode,
      agentArchitecture: this.agentArchitecture,
      agentSafetyMarginMs: this.agentSafetyMarginMs,
      estimatedWaveMs: this.estimatedWaveMs,
      lifecycle: { maxAgentCycles: this.maxAgentCycles, analysisSafetyMarginMs: this.agentSafetyMarginMs, estimatedFullCycleMs: this.estimatedFullCycleMs, estimatedDeltaCycleMs: this.estimatedDeltaCycleMs },
      agents: { available: this.agents?.available === true, calls: this.agentCalls.length, latency: agentLatencyStats(this.agentCalls) },
      scheduler: this.scheduler.status(),
      queue: { depth: this.queueDepth, maxDepth: this.maxQueueDepth, markets: this.queues.size },
      counters: { ...this.counters },
      candleFeed: {
        blocked: this.counters.candleFeedBlocked,
        reasons: { ...this.counters.feedBlockedReasons },
        lastReason: this.counters.lastFeedBlockedReason,
        lastMarketKey: this.counters.lastFeedBlockedMarket,
        lastAt: this.counters.lastFeedBlockedAt,
      },
      latency: this.latencyStats(),
      engine: this.engine.stats(),
      discovery: this.discovery.status(),
      lastError: this.lastError,
      lastCycleAt: this.lastCycleAt,
    };
  }

  opportunities(options = {}) { return this.engine.list(options); }
  discoveryStatus() { return this.discovery.status(); }

  /** Selftest READ-ONLY dos agentes reais (sem ordem). Modos: SINGLE | WAVE_A | FULL | CONCURRENCY. */
  async agentSelftest({ measurements, specialists = null, expiration = null, cycleNumber = 0, mode = "FULL", role = "RSI", concurrency = 5, budgetMs = null } = {}) {
    if (!this.agents?.available) return { available: false, reason: "AGENT_UNAVAILABLE", agentMode: this.agentMode };
    const client = this.agents;
    const inputNumbers = collectInputNumbers(measurements, expiration);
    const timing = expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs ?? null, phase: expiration.phase ?? null } : null;
    const startedAt = this.now();
    if (mode === "SINGLE") {
      const chosen = WAVE1_ROLES.includes(role) ? role : "RSI";
      const envelope = buildPacketEnvelope({ role: chosen, measurements, timing, cycleNumber });
      const call = await client.call({ role: chosen, requestId: `selftest:${cycleNumber}:${chosen}`, opportunityId: "selftest", budgetMs, inputNumbers, prompt: factPrompt(envelope) });
      return { available: call.status === "OK", reason: call.reason, result: call.status === "OK" ? "AGENT_OK" : "AGENT_UNAVAILABLE", agentMode: this.agentMode, agentCalls: [call], latency: agentLatencyStats([call]), asset: null, independent: null, consensus: null, finalGate: null, wallMs: Math.max(0, this.now() - startedAt) };
    }
    if (mode === "WAVE_A") {
      const calls = await Promise.all(WAVE1_ROLES.map((roleName) => {
        const envelope = buildPacketEnvelope({ role: roleName, measurements, timing, cycleNumber });
        return client.call({ role: roleName, requestId: `selftest:${cycleNumber}:${roleName}`, opportunityId: "selftest", budgetMs, inputNumbers, prompt: factPrompt(envelope) });
      }));
      const available = calls.every((call) => call.status === "OK");
      return { available, reason: available ? null : "AGENT_UNAVAILABLE", result: available ? "AGENT_OK" : "AGENT_UNAVAILABLE", agentMode: this.agentMode, agentCalls: calls, latency: agentLatencyStats(calls), asset: null, independent: null, consensus: null, finalGate: null, wallMs: Math.max(0, this.now() - startedAt) };
    }
    if (mode === "CONCURRENCY") {
      const total = Math.max(1, Math.min(30, Number(concurrency) || 5));
      const calls = await Promise.all(Array.from({ length: total }, (_, index) => {
        const envelope = buildPacketEnvelope({ role: "RSI", measurements, timing, cycleNumber });
        return client.call({ role: "RSI", requestId: `selftest:conc:${index}`, opportunityId: "selftest-conc", budgetMs, inputNumbers, prompt: factPrompt(envelope) });
      }));
      const available = calls.filter((call) => call.status === "OK").length;
      return { available: available > 0, reason: available === total ? null : "PARTIAL", result: `${available}/${total}`, agentMode: this.agentMode, agentCalls: calls, latency: agentLatencyStats(calls), wallMs: Math.max(0, this.now() - startedAt) };
    }
    const result = await runAgentCycle({ client, measurements, expiration, cycleNumber, opportunityId: "selftest", budgetMs, now: this.now });
    return {
      available: result.available, reason: result.reason, result: result.result, architecture: result.architecture, agentMode: this.agentMode,
      agentCalls: result.agentCalls, factPackets: result.factPackets, latency: { ...agentLatencyStats(result.agentCalls), wall: result.latency },
      asset: result.asset, independent: result.independent, finalGate: result.finalGate ?? null, consensus: result.consensus,
      wallMs: Math.max(0, this.now() - startedAt),
    };
  }
}
