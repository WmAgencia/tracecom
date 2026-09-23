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
import { ExpirationOpportunityEngine } from "./opportunity-engine.mjs";
import { ExpirationTargetTiming } from "./timing.mjs";
import { measureAll } from "./measurements.mjs";
import { runSpecialists } from "./specialists.mjs";
import { classifyAsset } from "./asset-agent.mjs";
import { runConsensus } from "./consensus.mjs";
import { buildV3DecisionSnapshot } from "./decision-snapshot.mjs";
import { stableStringify } from "../intelligence/features.mjs";

export const V3_RUNTIME_VERSION = "v3-runtime-v1";

const defaultStrategy = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V3", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null, statsEpoch: null });

export class V3Runtime {
  constructor({ now = () => Date.now(), log = () => {}, pool = null, strategy = null, discovery = null, engine = null } = {}) {
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.pool = pool;
    this.strategy = strategy ?? defaultStrategy;
    this.discovery = discovery ?? new ExpirationDiscovery({ now });
    this.engine = engine ?? new ExpirationOpportunityEngine({ now });
    this.prevByMarket = new Map();
    this.lastClosedCandleId = new Map();
    this.counters = { candleCycles: 0, cyclesSkippedNoOpportunity: 0, cyclesSkippedWindow: 0, cyclesSkippedDuplicateCandle: 0, snapshots: 0, approvals: 0, executionBlocked: 0, persisted: 0, persistErrors: 0 };
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
      if (this.engine.activeFor(front.marketKey)) continue;
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

  /** Um ciclo por candle fechado; so dentro de (hardCutoff, discoveryWindow]. */
  onClosedCandle({ marketKey, candles, brokerNow = null } = {}) {
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    // A frente compravel e derivada do relogio do broker: adota a cada candle fechado (5s),
    // dando resolucao de 5s a descoberta (~TTE 330) sem depender do poll de initialization (60s).
    if (this.discovery.byMarket.size) this.#adoptDueFronts(at);
    const opportunity = this.engine.activeFor(String(marketKey));
    if (!opportunity) { this.counters.cyclesSkippedNoOpportunity += 1; return null; }
    const window = ExpirationTargetTiming.canSubmit({ expirationAt: opportunity.expirationAt, brokerNow: at, purchaseDeadlineAt: opportunity.purchaseDeadlineAt });
    if (window.ok !== true) { this.counters.cyclesSkippedWindow += 1; this.engine.enforceWindow(opportunity.opportunityId, at); return null; }
    if (!Array.isArray(candles) || candles.length < 40) return null;
    const startedAt = this.now();
    const measurements = measureAll(candles, { marketKey, cycleNumber: opportunity.cycles.length + 1 });
    if (!measurements) return null;
    const closedCandleId = measurements.closedCandleId;
    if (this.lastClosedCandleId.get(marketKey) === closedCandleId) { this.counters.cyclesSkippedDuplicateCandle += 1; return null; }
    this.lastClosedCandleId.set(marketKey, closedCandleId);
    const featureSnapshotId = `v3feat:${crypto.createHash("sha256").update(stableStringify(measurements)).digest("hex").slice(0, 24)}`;
    const previous = this.prevByMarket.get(marketKey) ?? {};
    const previousByRole = { RSI: previous.rsi, DMI_ADX: previous.dmi, BOLLINGER: previous.bollinger, ATR: previous.atr, PRICE_ACTION: previous.priceAction };
    const specialists = runSpecialists({ measurements, previousByRole });
    const asset = classifyAsset({ measurements, specialists, previousAssessment: previous.asset ?? null, timing: { tteMs: window.derived?.tteMs ?? null } });
    const consensus = runConsensus({ measurements, asset, timing: { ok: window.ok === true, code: window.code, tteMs: window.derived?.tteMs ?? null }, changedSincePreviousCycle: asset?.changedSincePreviousCycle ?? [] });

    const cycle = {
      at, tteMs: window.derived?.tteMs ?? null, closedCandleId, featureSnapshotId,
      price: measurements.closedCandle.close,
      specialistStates: { rsi: specialists.rsi?.assessment ?? null, dmi: specialists.dmi?.assessment ?? null, bollinger: specialists.bollinger?.assessment ?? null, atr: specialists.atr?.assessment ?? null, priceAction: specialists.priceAction?.assessment ?? null },
      assetScenario: asset?.scenario ?? null, assetState: asset?.state ?? null,
      consensusResult: consensus.result, agreement: consensus.agreement,
      changedSincePreviousCycle: asset?.changedSincePreviousCycle ?? [],
      status: asset?.state ?? "WAIT",
      measurements, specialists, asset, consensus,
    };
    this.engine.recordCycle(opportunity.opportunityId, cycle);
    this.engine.enforceWindow(opportunity.opportunityId, at);
    this.engine.finalizeCycle(opportunity.opportunityId, { asset, consensus, brokerNow: at });
    this.prevByMarket.set(marketKey, { ...specialists, asset });

    if ((consensus.result === "APPROVE_BUY" || consensus.result === "APPROVE_SELL") && !["MISSED_5M_ENTRY_WINDOW", "CANCELLED"].includes(opportunity.status)) {
      const finalDecision = { result: consensus.result, at, tteMs: window.derived?.tteMs ?? null, scenario: asset?.scenario ?? null };
      const snapshot = buildV3DecisionSnapshot({ strategy: this.strategy, opportunity, cycles: opportunity.cycles, asset, consensus, specialists, measurements, finalDecision, timing: window.derived });
      this.counters.snapshots += 1;
      this.counters.approvals += 1;
      if (this.executionEnabled) this.log("V3_EXECUTION_READY_BUT_NOT_WIRED", stableStringify({ opportunityId: opportunity.opportunityId, result: consensus.result }));
      opportunity.finalDecision = { ...opportunity.finalDecision, snapshotHash: snapshot.snapshotHash, executionBlocked: this.executionEnabled ? "V3_EXECUTION_NOT_WIRED" : "V3_NOT_ACTIVE" };
      this.counters.executionBlocked += 1;
      void this.#persistCycle(opportunity.opportunityId, cycle);
      void this.#persistOpportunity(opportunity);
    } else {
      void this.#persistCycle(opportunity.opportunityId, cycle);
      if (["NO_SETUP", "CANCELLED", "MISSED_5M_ENTRY_WINDOW"].includes(opportunity.status)) void this.#persistOpportunity(opportunity);
    }
    const latencyMs = Math.max(0, this.now() - startedAt);
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 500) this.latencySamples.shift();
    this.counters.candleCycles += 1;
    this.lastCycleAt = at;
    this.log("V3_CYCLE", stableStringify({ opportunityId: opportunity.opportunityId, cycle: cycle.cycleNumber, tteMs: cycle.tteMs, scenario: asset?.scenario, state: asset?.state, consensus: consensus.result, agreement: consensus.agreement, latencyMs }));
    return { opportunityId: opportunity.opportunityId, cycle: cycle.cycleNumber, tteMs: cycle.tteMs, assetState: asset?.state ?? null, scenario: asset?.scenario ?? null, consensus: consensus.result, agreement: consensus.agreement, latencyMs };
  }

  async #persistOpportunity(opportunity) {
    if (!this.pool?.query) return false;
    try {
      await this.pool.query(
        `INSERT INTO iq_v3_opportunities(opportunity_id,strategy_version,strategy_hash,market_key,active_id,expiration_at,first_seen_at,first_seen_tte_ms,target_send_at,hard_cutoff_at,purchase_deadline_at,payout,buyability,status,final_decision,execution_ref,cycles_count,snapshot_hash,closed_at,closed_reason,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,now())
         ON CONFLICT(opportunity_id) DO UPDATE SET status=EXCLUDED.status, final_decision=COALESCE(EXCLUDED.final_decision,iq_v3_opportunities.final_decision), execution_ref=COALESCE(EXCLUDED.execution_ref,iq_v3_opportunities.execution_ref), cycles_count=EXCLUDED.cycles_count, snapshot_hash=COALESCE(EXCLUDED.snapshot_hash,iq_v3_opportunities.snapshot_hash), closed_at=EXCLUDED.closed_at, closed_reason=EXCLUDED.closed_reason, updated_at=now()`,
        [opportunity.opportunityId, this.strategy?.version ?? null, this.strategy?.strategyHash ?? null, opportunity.marketKey, opportunity.activeId ?? null, new Date(opportunity.expirationAt).toISOString(), new Date(opportunity.firstSeenAt).toISOString(), opportunity.firstSeenTteMs, new Date(opportunity.targetSendAt).toISOString(), new Date(opportunity.hardStrategicCutoffAt).toISOString(), opportunity.purchaseDeadlineAt ? new Date(opportunity.purchaseDeadlineAt).toISOString() : null, opportunity.payout ?? null, opportunity.buyability ?? null, opportunity.status, opportunity.finalDecision ? JSON.stringify(opportunity.finalDecision) : null, opportunity.executionRef ? JSON.stringify(opportunity.executionRef) : null, opportunity.cycles.length, opportunity.finalDecision?.snapshotHash ?? null, opportunity.closedAt ? new Date(opportunity.closedAt).toISOString() : null, opportunity.closedReason ?? null],
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
        [opportunityId, cycle.cycleNumber, new Date(cycle.at).toISOString(), cycle.tteMs, cycle.closedCandleId, cycle.price, cycle.featureSnapshotId, cycle.assetScenario, cycle.assetState, cycle.consensusResult, cycle.agreement, JSON.stringify({ specialistStates: cycle.specialistStates, changedSincePreviousCycle: cycle.changedSincePreviousCycle, bestCounterCase: cycle.asset?.bestCounterCase ?? null, reasons: cycle.consensus?.challenge?.reasons ?? [] })],
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

  status() {
    return {
      version: V3_RUNTIME_VERSION,
      strategy: { version: this.strategy?.version ?? null, status: this.strategy?.status ?? null, executable: this.strategy?.executable === true, strategyHash: this.strategy?.strategyHash ?? null, statsEpoch: this.strategy?.statsEpoch ?? null },
      executionEnabled: this.executionEnabled,
      executionMode: "OBSERVE_ONLY",
      counters: { ...this.counters },
      latency: this.latencyStats(),
      engine: this.engine.stats(),
      discovery: this.discovery.status(),
      lastError: this.lastError,
      lastCycleAt: this.lastCycleAt,
    };
  }

  opportunities(options = {}) { return this.engine.list(options); }
  discoveryStatus() { return this.discovery.status(); }
}
