/**
 * RSI AGENTS V3 — estrategia UNICA RSI_REVERSAL_PULLBACK_V3 em TODO o universo elegivel.
 *
 * - Universo dinamico (OPEN + enabled + activeId + turbo + candles), snapshot persistido, NORMAL/OTC separados.
 * - Uma unica estrategia para todos os agentes; assignment persistido (sem troca silenciosa).
 * - Candidate com freshness + continuidade; revalidacao completa na janela final (T-5) e override extremo restrito.
 * - V2 (STRICT/PULLBACK) permanece CONGELADA e apenas em SHADOW: as duas decisoes V2 sao registradas
 *   por oportunidade e NUNCA enviam ordem (routing RSI_V3_ONLY).
 * - Ordem SOMENTE via runtime.submitAgentV3Order -> requestOrder (Execution Gate unico). PRACTICE, stake R$10.
 */

import { V3_ID, RSI_V3_POLICY, RSI_V3_VERSION, evaluateIndicatorsV3, updateEpisodeV3, evaluateV3Entry, firstSightThesisV3, classifyOutcomeV3, rsiV3FreezeManifest } from "./rsi-v3.mjs";
import { STRICT_V2_ID, PULLBACK_V2_ID, evaluateIndicatorsV2, evaluateV2 } from "./rsi-skills-v2.mjs";
import { effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";

export const RSI_AGENTS_V3_VERSION = "rsi-agents-v3-single-v1";
export const RSI_V3_EXECUTION_ALLOWLIST = Object.freeze([`agent-v3:${V3_ID}`]);
export const RSI_AGENTS_V3_POLICY = Object.freeze({
  version: RSI_AGENTS_V3_VERSION,
  mode: "NORMAL_RUNTIME_AGENT",
  strategy: V3_ID,
  practiceOnly: true,
  realLocked: true,
  stakeBrl: 10,
  split: "nenhuma divisao: a MESMA estrategia em todos os ativos elegiveis",
  finalWindowMs: 5000,
  minimumSafeMarginMs: 3000,
  turbCutoffMs: 30_000,
  minClosedCandles5s: RSI_V3_POLICY.minClosedCandles5s,
  noSilentSubstitution: true,
  failClosed: true,
  pinned: true,
  autoInvert: false,
  sameExpiryRequired: true,
  shadowV2: { strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID, controlsExecution: false },
  routing: "RSI_V3_ONLY",
  singleBrokerPath: "runtime.submitAgentV3Order -> requestOrder",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export class RsiAgentsV3 {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true, stakeBrl = RSI_AGENTS_V3_POLICY.stakeBrl, skills = null, skillsV2 = null } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.stakeBrl = Number(stakeBrl) > 0 ? Number(stakeBrl) : RSI_AGENTS_V3_POLICY.stakeBrl;
    this.skills = skills ?? { evaluateIndicatorsV3, updateEpisodeV3, evaluateV3Entry, firstSightThesisV3 };
    this.skillsV2 = skillsV2 ?? { evaluateIndicatorsV2, evaluateV2 };
    this.assignments = new Map();
    this.episodes = new Map();
    this.agents = new Map();
    this.opportunities = new Map();
    this.submitted = new Map();
    this.openOrders = new Map();
    this.rejections = [];
    this.universe = { at: null, snapshotId: null, observed: [], eligible: [], byType: { NORMAL: 0, OTC: 0 }, signature: null };
    this.migration = { state: "PENDING", startedAt: null, completedAt: null, universePersistedAt: null, assignmentsPersistedAt: null, complete: false, hold: true, reason: "MIGRACAO_V3" };
    this.counters = {
      evaluations: 0, candidates: 0, expired: 0, continuityLost: 0, waits: {}, rejections: {},
      v3Accepted: 0, ordersAcked: 0, ordersBlocked: 0, normalT5: 0, override: 0,
    };
    this.lastUniversePersistAt = 0;
    this.lastReconcileAt = 0;
  }

  /** Universo operacional dinamico (mesma regra da migracao: sem lista hardcoded). */
  discoverUniverse(markets = []) {
    const at = this.now();
    const list = Array.isArray(markets) ? markets : [];
    const observed = list
      .filter((market) => market && market.marketKey)
      .map((market) => {
        const marketType = String(market.marketType ?? "").toUpperCase();
        const enabled = market.enabled === true;
        const paused = market.paused === true;
        const availability = String(market.availability ?? "UNKNOWN");
        const activeId = num(market.activeId);
        const instrumentTypes = Array.isArray(market.instrumentTypes) ? market.instrumentTypes.map((item) => String(item).toLowerCase()) : [];
        const turboSupported = instrumentTypes.length === 0 || instrumentTypes.includes("turbo");
        const candlesCount = num(market.candles5s) ?? num(market.candlesCount) ?? 0;
        const reasons = [];
        if (marketType !== "NORMAL" && marketType !== "OTC") reasons.push("INVALID_MARKET_TYPE");
        if (!enabled) reasons.push("NOT_ENABLED");
        if (paused) reasons.push("PAUSED");
        if (availability !== "OPEN") reasons.push(`MARKET_${availability}`);
        if (activeId === null || activeId <= 0) reasons.push("INVALID_ACTIVE_ID");
        if (!turboSupported) reasons.push("EXECUTION_NOT_SUPPORTED");
        return {
          marketKey: market.marketKey, marketType, canonical: market.canonical ?? null, activeId,
          enabled, availability, payout: num(market.payout), candlesCount, feedReady: candlesCount >= RSI_AGENTS_V3_POLICY.minClosedCandles5s,
          turboSupported, eligible: reasons.length === 0, reason: reasons.join("+") || null,
        };
      })
      .sort((a, b) => String(a.marketKey).localeCompare(String(b.marketKey)));
    const eligible = observed.filter((row) => row.eligible);
    const byType = { NORMAL: 0, OTC: 0 };
    for (const row of eligible) byType[row.marketType] = (byType[row.marketType] ?? 0) + 1;
    this.universe = { at, snapshotId: `rsi-universe-v3:${at}:${eligible.length}`, observed, eligible, byType, signature: eligible.map((row) => `${row.marketKey}:${row.marketType}`).join("|") };
    return this.universe;
  }

  async #persistUniverseSnapshot() {
    if (!this.pool?.query) return;
    if (this.now() - this.lastUniversePersistAt < 60_000) return;
    this.lastUniversePersistAt = this.now();
    for (const row of this.universe.observed) {
      await this.pool.query(
        `INSERT INTO iq_rsi_universe_v3(snapshot_id, market_key, at, market_type, canonical, active_id, enabled, availability, payout, candles_count, feed_ready, turbo_supported, eligible, reason, payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
         ON CONFLICT(snapshot_id, market_key) DO NOTHING`,
        [this.universe.snapshotId, row.marketKey, this.universe.at, row.marketType, row.canonical, row.activeId, row.enabled, row.availability, row.payout, row.candlesCount, row.feedReady, row.turboSupported, row.eligible, row.reason, JSON.stringify({ policy: RSI_AGENTS_V3_POLICY })],
      ).catch(() => undefined);
    }
    if (this.migration.universePersistedAt === null) this.migration.universePersistedAt = this.now();
  }

  async assignUniverse(markets = []) {
    this.discoverUniverse(markets);
    if (this.migration.startedAt === null) this.migration.startedAt = this.now();
    this.migration.state = "RUNNING";
    await this.#persistUniverseSnapshot();
    await this.#reconcileAssignments(this.universe.eligible);
    await this.#finalizeMigration();
    return [...this.assignments.entries()];
  }

  async #loadPersistedAssignments() {
    if (!this.pool?.query) return [];
    return await this.pool.query("SELECT market_key, strategy, market_type, canonical, active_id, availability, block_reason FROM iq_rsi_agent_assignments_v3")
      .then((result) => result.rows ?? []).catch(() => []);
  }

  async #reconcileAssignments(eligible = []) {
    if (this.now() - this.lastReconcileAt < 15_000 && this.assignments.size > 0) return;
    this.lastReconcileAt = this.now();
    const persisted = await this.#loadPersistedAssignments();
    for (const row of persisted) {
      if (this.assignments.has(row.market_key)) continue;
      const strategy = String(row.strategy);
      const known = strategy === V3_ID;
      this.assignments.set(row.market_key, { marketKey: row.market_key, strategy, marketType: row.market_type ?? null, canonical: row.canonical ?? null, activeId: num(row.active_id), availability: String(row.availability ?? "UNKNOWN"), eligible: false, pinned: true, blocked: !known, blockReason: known ? (row.block_reason ?? null) : `CONFLICT_UNKNOWN_STRATEGY:${strategy}`, assignedAt: this.now() });
      if (!known) this.log("RSI_AGENT_V3_ASSIGNMENT_CONFLICT", JSON.stringify({ marketKey: row.market_key, strategy }));
    }
    const eligibleKeys = new Set(eligible.map((row) => row.marketKey));
    for (const market of eligible) {
      const existing = this.assignments.get(market.marketKey);
      if (existing) {
        existing.marketType = market.marketType; existing.canonical = market.canonical; existing.activeId = market.activeId;
        existing.availability = market.availability; existing.eligible = true;
        if (existing.blockReason && String(existing.blockReason).startsWith("CONFLICT")) continue;
        existing.blocked = false; existing.blockReason = null;
        continue;
      }
      const assignment = { marketKey: market.marketKey, strategy: V3_ID, marketType: market.marketType, canonical: market.canonical, activeId: market.activeId, availability: market.availability, eligible: true, pinned: true, blocked: false, blockReason: null, assignedAt: this.now() };
      this.assignments.set(market.marketKey, assignment);
      if (this.pool?.query) await this.pool.query(
        `INSERT INTO iq_rsi_agent_assignments_v3(market_key, strategy, market_type, canonical, active_id, availability, pinned, block_reason)
         VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT(market_key) DO UPDATE SET availability=$6, active_id=$5, updated_at=now()`,
        [market.marketKey, V3_ID, market.marketType, market.canonical, market.activeId, market.availability, null],
      ).catch(() => undefined);
      this.log("RSI_AGENT_V3_ASSIGNMENT", JSON.stringify({ marketKey: market.marketKey, strategy: V3_ID, marketType: market.marketType }));
    }
    for (const [marketKey, assignment] of this.assignments) {
      if (eligibleKeys.has(marketKey)) continue;
      if (assignment.eligible === false && assignment.blocked) continue;
      assignment.eligible = false;
      const observed = this.universe.observed.find((row) => row.marketKey === marketKey);
      assignment.availability = observed?.availability ?? "NOT_IN_UNIVERSE";
      assignment.blocked = true;
      assignment.blockReason = `NOT_ELIGIBLE:${observed?.reason ?? "NOT_IN_UNIVERSE"}`;
      if (this.pool?.query) await this.pool.query("UPDATE iq_rsi_agent_assignments_v3 SET availability=$2, block_reason=$3, updated_at=now() WHERE market_key=$1", [marketKey, assignment.availability, assignment.blockReason]).catch(() => undefined);
      this.log("RSI_AGENT_V3_ASSIGNMENT_BLOCKED", JSON.stringify({ marketKey, reason: assignment.blockReason }));
    }
    if (this.pool?.query && this.migration.assignmentsPersistedAt === null) this.migration.assignmentsPersistedAt = this.now();
  }

  async #finalizeMigration() {
    const eligible = this.universe.eligible;
    const assigned = eligible.filter((row) => this.assignments.get(row.marketKey)?.eligible === true).length;
    if (!this.pool?.query && this.migration.universePersistedAt === null) {
      this.migration.universePersistedAt = this.now();
      this.migration.assignmentsPersistedAt = this.now();
    }
    const done = assigned === eligible.length && (this.migration.universePersistedAt !== null || !this.pool?.query);
    if (done && !this.migration.complete) {
      this.migration.complete = true; this.migration.hold = false; this.migration.state = "COMPLETE"; this.migration.completedAt = this.now();
      this.log("RSI_AGENT_V3_MIGRATION_COMPLETE", JSON.stringify({ eligible: eligible.length, strategy: V3_ID }));
      return;
    }
    this.migration.state = done ? "COMPLETE" : "HOLD";
    this.migration.reason = done ? null : this.migration.universePersistedAt === null ? "UNIVERSE_SNAPSHOT_PENDING" : "ASSIGNMENTS_PENDING";
  }

  #countEligible() { let count = 0; for (const assignment of this.assignments.values()) if (assignment.eligible === true) count += 1; return count; }

  /** Snapshot sincrono (sem I/O) para o Office. */
  snapshot() {
    let signals = 0; let waiting = 0; let open = 0; let settled = 0; let wins = 0; let losses = 0;
    for (const [marketKey] of this.assignments) {
      const state = this.agents.get(marketKey);
      if (!state) continue;
      if (state.decision === "BUY" || state.decision === "SELL") signals += 1;
      if (state.waitReason) waiting += 1;
      if (state.position?.status === "OPEN") open += 1;
      if (state.lastResult) { settled += 1; if (state.lastResult === "WIN") wins += 1; if (state.lastResult === "LOSS") losses += 1; }
    }
    const eligible = this.#countEligible();
    return {
      version: RSI_AGENTS_V3_VERSION, strategy: V3_ID, enabled: this.enabled, stakeBrl: this.stakeBrl, routing: "RSI_V3_ONLY",
      migration: { state: this.migration.state, complete: this.migration.complete, hold: this.migration.hold, reason: this.migration.reason, startedAt: this.migration.startedAt, completedAt: this.migration.completedAt },
      universe: { at: this.universe.at, eligible: this.universe.eligible.length, observed: this.universe.observed.length, byType: this.universe.byType },
      split: { strategy: V3_ID, eligible, normal: this.universe.byType.NORMAL ?? 0, otc: this.universe.byType.OTC ?? 0 },
      groups: { v3: { total: this.assignments.size, eligible, signals, waiting, open, settled, wins, losses } },
      shadowV2: { strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID, controlsExecution: false },
      readyToArm: true, armed: false, practiceOnly: true, realLocked: true,
    };
  }

  #setState(state) { this.agents.set(state.marketKey, state); }

  stateFor(marketKey) {
    if (!marketKey) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return null;
    const state = this.agents.get(marketKey) ?? {};
    return {
      strategyId: assignment.strategy, label: "RSI V3",
      decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? null,
      state: state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING",
      lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null, qualityClass: state.qualityClass ?? null,
      candidateAt: state.candidateAt ?? null, candidateRsi: state.candidateRsi ?? null, rsi: state.rsi ?? null,
      entryMode: state.entryMode ?? null, expectedCushion: state.expectedCushion ?? null,
      strictV2Decision: state.strictV2Decision ?? null, pullbackV2Decision: state.pullbackV2Decision ?? null,
      blocked: assignment.blocked === true, blockReason: assignment.blockReason ?? null, eligible: assignment.eligible === true,
    };
  }

  /** Avaliacao + shadow V2 + execucao (somente V3) por mercado. */
  async observeMarket({ marketKey, marketType = null, activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return null;
    const at = num(now) ?? this.now();
    const list = Array.isArray(candles) ? candles : [];
    void this.#settleCausal({ marketKey, candles: list, now: at });
    const baseState = { agentId: `${V3_ID}:${marketKey}`, marketKey, strategy: V3_ID, at, accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: null, orderId: null, executionId: null, decision: "WAIT", waitReason: null, reason: null, candidateAt: null, expiryAt: num(targetExpiryAt) };
    if (assignment.blocked === true) {
      const blocked = { ...baseState, waitReason: assignment.blockReason ?? "ASSIGNMENT_BLOCKED", reason: assignment.blockReason ?? "assinatura bloqueada (fail closed)" };
      this.#setState(blocked); void this.#persistState(blocked); return blocked;
    }
    const indicators = this.skills.evaluateIndicatorsV3({ candles: list, now: at });
    if (indicators.closedCandles < RSI_AGENTS_V3_POLICY.minClosedCandles5s) {
      const waiting = { ...baseState, waitReason: "NO_FEED_INSUFFICIENT_CANDLES", reason: `candles fechados=${indicators.closedCandles}` };
      this.#setState(waiting); void this.#persistState(waiting); return waiting;
    }
    this.counters.evaluations += 1;
    const v2Indicators = this.skillsV2.evaluateIndicatorsV2({ candles: list, now: at });
    const enriched = { ...indicators, targetExpiryAt: num(targetExpiryAt) };
    const previousEpisode = this.episodes.get(marketKey) ?? null;
    const episodeUpdate = this.skills.updateEpisodeV3({ episode: previousEpisode, indicators: enriched, at });
    let episode = episodeUpdate.episode ?? null;
    if (episodeUpdate.event.startsWith("CANDIDATE_EXPIRED")) this.counters.expired += 1;
    else if (episodeUpdate.event.startsWith("CANDIDATE_CONTINUITY_LOST")) this.counters.continuityLost += 1;
    if (episode) {
      if (episode.candidateExpiry !== null && num(targetExpiryAt) !== null && num(targetExpiryAt) > episode.candidateExpiry) {
        episode.carriedExpiries = (episode.carriedExpiries ?? 0) + 1;
        episode.candidateExpiry = num(targetExpiryAt);
      }
      this.episodes.set(marketKey, episode);
    } else {
      this.episodes.delete(marketKey);
    }
    const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: effectiveSafeMarginMs(latency) }) : null;
    const entryEval = this.skills.evaluateV3Entry({ indicators, episode, window, at });
    const v2Strict = this.skillsV2.evaluateV2({ strategy: STRICT_V2_ID, indicators: v2Indicators, episode });
    const v2Pullback = this.skillsV2.evaluateV2({ strategy: PULLBACK_V2_ID, indicators: v2Indicators, episode });
    const projection = entryEval.projection ?? null;
    const state = {
      ...baseState,
      rsi: num(indicators.rsi), rsiBand: indicators.rsiBand, rsiTrajectory: episode ? (indicators.rsi <= RSI_V3_POLICY.rsiBuyThreshold || indicators.rsi >= RSI_V3_POLICY.rsiSellThreshold ? "STILL_EXTREME" : entryEval.confirmations?.rsiLeaving ? "LEAVING_EXTREME" : "NEUTRAL") : "NEUTRAL",
      candidateAt: episode?.candidateAt ?? null, candidateAgeMs: episode ? at - episode.candidateAt : null,
      candidateRsi: episode?.candidateRsi ?? null, candidateRsiBand: episode?.candidateRsiBand ?? null,
      candidatePrice: episode?.candidatePrice ?? null, candidateExpiry: episode?.candidateExpiry ?? null,
      stage: entryEval.stage ?? "NONE", strength: entryEval.strength ?? "NONE",
      expectedCushion: projection?.expectedCushionNormalized ?? null,
      strictV2Decision: v2Strict.decision, pullbackV2Decision: v2Pullback.decision,
      decision: entryEval.accepted ? entryEval.direction : "WAIT",
      entryMode: entryEval.entryMode ?? null,
      execEval: entryEval, v2StrictEval: v2Strict, v2PullbackEval: v2Pullback, episodeEvent: episodeUpdate.event,
      episode: episode ? {
        direction: episode.direction, candidateAt: episode.candidateAt, candidateRsi: episode.candidateRsi, candidateRsiBand: episode.candidateRsiBand,
        candidatePrice: episode.candidatePrice, candidateExpiry: episode.candidateExpiry, candidateReason: episode.candidateReason,
        touchedUpper: episode.touchedUpper, touchedLower: episode.touchedLower, outsideUpper: episode.outsideUpper, outsideLower: episode.outsideLower,
        reenteredUpper: episode.reenteredUpper, reenteredLower: episode.reenteredLower, maxPosition: episode.maxPosition, minPosition: episode.minPosition,
        maxSpread: episode.maxSpread, minSpread: episode.minSpread, maxRsi: episode.maxRsi, minRsi: episode.minRsi,
        maxPlusDI: episode.maxPlusDI, maxMinusDI: episode.maxMinusDI, oldDiWeakStreak: episode.oldDiWeakStreak, newDiReactStreak: episode.newDiReactStreak,
        neutralTicks: episode.neutralTicks, lateralTicks: episode.lateralTicks, carriedExpiries: episode.carriedExpiries ?? 0,
      } : null,
      candidateIndicators: episode?.candidateIndicators ?? null,
      indicators,
    };
    if (episodeUpdate.event === "CANDIDATE_CREATED" || episodeUpdate.event === "CANDIDATE_FLIPPED") {
      this.counters.candidates += 1;
      this.log("RSI_AGENT_V3_CANDIDATE", JSON.stringify({ marketKey, direction: episode.direction, rsi: episode.candidateRsi, band: episode.candidateRsiBand, reason: episode.candidateReason, at }));
      void this.#persistEvent({ marketKey, event: "CANDIDATE_CREATED", decision: episode.direction, reason: episode.candidateReason, payload: { candidateRsi: episode.candidateRsi, candidateBand: episode.candidateRsiBand, candidatePrice: episode.candidatePrice, candidateExpiry: episode.candidateExpiry } });
    }
    if (!episode) {
      state.waitReason = episodeUpdate.event === "NO_CANDIDATE" ? "NO_CANDIDATE_RSI_NEUTRO" : episodeUpdate.event;
      state.reason = "RSI neutro: candidate somente nasce em extremo (<=30 / >=70)";
      this.#setState(state); void this.#persistState(state); return state;
    }
    const opportunityId = `rsi-v3-opp:${marketKey}:${episode.candidateAt}:${num(targetExpiryAt) ?? "NA"}`;
    const opportunity = this.#opportunityRecord({ opportunityId, assignment, episode, entryEval, v2Strict, v2Pullback, indicators, projection, targetExpiryAt, payout, at, state });
    if (entryEval.decision !== "WAIT" || v2Strict.decision !== "WAIT" || v2Pullback.decision !== "WAIT") void this.#persistOpportunity(opportunity);
    if (entryEval.decision === "WAIT") {
      state.waitReason = entryEval.stage === "OLD_TREND_WEAKENING" ? "OLD_TREND_WEAKENING_NEW_DIRECTION_MISSING" : entryEval.blockers?.[0] ?? entryEval.status;
      state.reason = entryEval.reason;
      this.counters.waits[state.waitReason] = (this.counters.waits[state.waitReason] ?? 0) + 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (!window) { state.waitReason = "OBSERVE_ONLY_NO_EXPIRY"; this.#setState(state); void this.#persistState(state); return state; }
    const override = entryEval.entryMode === "EXTREME_REVERSAL_OVERRIDE";
    const inNormalWindow = at >= window.entryWindowOpensAt && at <= window.entryWindowClosesAt;
    const inOverrideWindow = override && at >= window.purchaseCutoffAt - RSI_V3_POLICY.overrideMinLeadMs && at < window.entryWindowOpensAt;
    if (!inNormalWindow && !inOverrideWindow) {
      state.waitReason = at < window.entryWindowOpensAt ? "OBSERVE_ONLY" : at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
      this.#setState(state); void this.#persistState(state); return state;
    }
    // REVALIDACAO COMPLETA (T-5 ou override): recalculo do zero + "primeira vista".
    const revalIndicators = this.skills.evaluateIndicatorsV3({ candles: list, now: at });
    const revalEpisodeUpdate = this.skills.updateEpisodeV3({ episode, indicators: { ...revalIndicators, targetExpiryAt: num(targetExpiryAt) }, at });
    const revalEpisode = revalEpisodeUpdate.episode ?? null;
    const revalEval = this.skills.evaluateV3Entry({ indicators: revalIndicators, episode: revalEpisode, window, at });
    const firstSight = this.skills.firstSightThesisV3({ indicators: revalIndicators, direction: entryEval.direction });
    state.revalidationAt = at;
    state.revalidation = { accepted: revalEval.accepted === true, firstSightValid: firstSight.valid === true, firstSightReason: firstSight.reason, stage: revalEval.stage, strength: revalEval.strength };
    if (!revalEpisode || revalEval.accepted !== true || revalEval.direction !== entryEval.direction || firstSight.valid !== true) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = `tese morreu na revalidacao: ${firstSight.reason}`;
      this.counters.waits.CANCELLED_REVALIDATION = (this.counters.waits.CANCELLED_REVALIDATION ?? 0) + 1;
      void this.#persistEvent({ marketKey, event: "REVALIDATION_CANCELLED", decision: entryEval.direction, reason: state.reason, payload: { firstSight, revalBlockers: revalEval.blockers ?? [] } });
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (this.migration.complete !== true) {
      state.decision = "WAIT"; state.waitReason = "MIGRATION_IN_PROGRESS"; state.reason = "migracao V3 em andamento: nenhuma ordem";
      this.#setState(state); void this.#persistState(state); return state;
    }
    const entryMode = inOverrideWindow ? "EXTREME_REVERSAL_OVERRIDE" : "NORMAL_T5";
    state.entryMode = entryMode;
    const idempotencyKey = `rsi-agent-v3:${V3_ID}:${marketKey}:${targetExpiryAt}:${state.decision}:${entryMode}`;
    if (this.submitted.has(idempotencyKey)) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    const assignmentNow = this.assignments.get(marketKey);
    const precheck = {
      strategyMatches: assignmentNow?.strategy === V3_ID,
      assignmentEligible: assignmentNow?.eligible === true && assignmentNow?.blocked !== true,
      practiceOnly: true,
      stakeMatches: this.stakeBrl === RSI_AGENTS_V3_POLICY.stakeBrl,
      candidateFresh: at - episode.candidateAt <= RSI_V3_POLICY.candidateMaxAgeMs,
      projectionPresent: projection !== null,
    };
    const precheckFailed = Object.entries(precheck).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (precheckFailed.length) {
      state.decision = "WAIT"; state.waitReason = `FAIL_CLOSED_${precheckFailed.join("_")}`; state.reason = "pre-checks de execucao falharam";
      this.counters.ordersBlocked += 1;
      this.rejections.push({ marketKey, strategy: V3_ID, reason: state.waitReason, at });
      this.#setState(state); void this.#persistState(state); return state;
    }
    try {
      const order = await this.runtime.submitAgentV3Order({
        marketKey, direction: state.decision, strategyId: V3_ID, skill: V3_ID,
        stake: this.stakeBrl, expectedStake: RSI_AGENTS_V3_POLICY.stakeBrl, idempotencyKey, decisionId: state.agentId,
        candidateAt: episode.candidateAt, expiryAt: targetExpiryAt, entryMode, projection,
        shadow: { strictV2Decision: v2Strict.decision, pullbackV2Decision: v2Pullback.decision },
      });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      state.submitAt = this.now();
      state.orderId = order?.brokerOrderId !== null && order?.brokerOrderId !== undefined ? String(order.brokerOrderId) : null;
      state.executionId = order?.executionId !== null && order?.executionId !== undefined ? String(order.executionId) : null;
      state.requestedStake = num(order?.stakeRequested) ?? this.stakeBrl;
      state.effectiveStake = num(order?.stake) ?? null;
      if (accepted) {
        this.submitted.set(idempotencyKey, { at: state.submitAt, marketKey, direction: state.decision });
        this.openOrders.set(marketKey, opportunityId);
        this.counters.ordersAcked += 1;
        this.counters.v3Accepted += 1;
        if (entryMode === "EXTREME_REVERSAL_OVERRIDE") this.counters.override += 1; else this.counters.normalT5 += 1;
        state.reason = `ordem aceita PRACTICE (${entryMode}) execution=${state.executionId ?? "-"} order=${state.orderId ?? "-"} stake=${state.effectiveStake ?? "-"}`;
        state.position = { status: "OPEN", brokerOrderId: state.orderId, executionId: state.executionId, requestedStake: state.requestedStake, effectiveStake: state.effectiveStake, entryMode };
        this.#opportunitiesSet(opportunityId, { ...opportunity, accepted: true, v3_decision: state.decision, entry_mode: entryMode, order_id: state.orderId, execution_id: state.executionId, effective_stake: state.effectiveStake, entry_price: num(revalIndicators?.bollinger?.close) ?? opportunity.entry_price, entry_noise: num(revalIndicators?.noiseHorizon) ?? opportunity.entry_noise, direction: state.decision, decision: state.decision });
        void this.#persistOpportunity(this.#opportunitiesGet(opportunityId));
      } else {
        state.decision = "WAIT"; state.waitReason = `ORDER_${order?.disposition ?? order?.state ?? "BLOCKED"}`;
        state.reason = String(order?.reason ?? order?.state ?? "bloqueado").slice(0, 160);
        this.counters.ordersBlocked += 1;
        this.rejections.push({ marketKey, strategy: V3_ID, reason: state.waitReason, at, orderId: state.orderId, executionId: state.executionId });
        void this.#persistEvent({ marketKey, event: "ORDER_BLOCKED", decision: entryEval.direction, reason: state.reason, payload: { orderId: state.orderId, executionId: state.executionId } });
      }
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.decision = "WAIT"; state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.counters.ordersBlocked += 1;
      this.counters.rejections[code] = (this.counters.rejections[code] ?? 0) + 1;
      this.rejections.push({ marketKey, strategy: V3_ID, reason: code, message: state.reason, at });
      this.log("RSI_AGENT_V3_ORDER_BLOCKED", JSON.stringify({ marketKey, reason: code }));
      void this.#persistEvent({ marketKey, event: "ORDER_BLOCKED", decision: entryEval.direction, reason: state.reason, payload: { code } });
    }
    this.#setState(state); void this.#persistState(state);
    return state;
  }

  #opportunityRecord({ opportunityId, assignment, episode, entryEval, v2Strict, v2Pullback, indicators, projection, targetExpiryAt, payout, at, state }) {
    return {
      opportunity_id: opportunityId, market_key: assignment.marketKey, market_type: assignment.marketType ?? null,
      agent_id: `${V3_ID}:${assignment.marketKey}`, strategy_id: V3_ID,
      observed_at: episode.candidateAt, candidate_at: episode.candidateAt, candidate_age_ms: at - episode.candidateAt,
      candidate_rsi: episode.candidateRsi, candidate_rsi_band: episode.candidateRsiBand, candidate_price: episode.candidatePrice,
      candidate_expiry: episode.candidateExpiry, direction: entryEval.direction ?? episode.direction,
      entry_mode: entryEval.entryMode ?? null, stage: entryEval.stage, strength: entryEval.strength,
      decision: entryEval.decision, accepted: entryEval.accepted === true,
      rsi: num(indicators.rsi), rsi_trajectory: state.rsiTrajectory,
      bollinger: indicators.bollinger, band: { position: indicators.bollinger?.position ?? null, touchUpper: indicators.bollinger?.touchUpper ?? null, touchLower: indicators.bollinger?.touchLower ?? null, outsideUpper: indicators.bollinger?.outsideUpper ?? null, outsideLower: indicators.bollinger?.outsideLower ?? null, width: indicators.bollinger?.width ?? null, widthSlope: indicators.bollinger?.widthSlope ?? null, expanding: indicators.bollinger?.expanding ?? null, rejectionUpperNow: indicators.rejectionUpperNow, rejectionLowerNow: indicators.rejectionLowerNow },
      dmi: indicators.dmi, adx: indicators.adx, structural_trend: indicators.structuralTrend, short_horizon_direction: indicators.shortHorizonDirection,
      projection, expected_cushion: projection?.expectedCushionNormalized ?? null,
      v3_decision: entryEval.decision, strict_v2_decision: v2Strict.decision, pullback_v2_decision: v2Pullback.decision,
      order_id: null, execution_id: null, effective_stake: null, entry_price: num(indicators.bollinger?.close), entry_noise: num(indicators.noiseHorizon),
      expiry_at: num(targetExpiryAt), expiry_price: null, result: null, profit: null,
      actual_displacement: null, actual_cushion: null, projection_correct: null, quality_class: null, settlement_basis: null,
      indicators: { ...indicators, targetExpiryAt: num(targetExpiryAt) }, payload: { payout: num(payout), candidates: entryEval.candidate ?? null, v2: { strict: { status: v2Strict.status, reason: v2Strict.reason }, pullback: { status: v2Pullback.status, reason: v2Pullback.reason } } },
    };
  }

  #opportunitiesGet(id) { return this.opportunities.get(id) ?? null; }
  #opportunitiesSet(id, record) {
    this.opportunities.set(id, record);
    if (this.opportunities.size > 800) this.opportunities.delete(this.opportunities.keys().next().value);
    return record;
  }

  async #persistOpportunity(record) {
    if (!this.pool?.query || !record) return;
    this.#opportunitiesSet(record.opportunity_id, record);
    await this.pool.query(
      `INSERT INTO iq_rsi_opportunities_v3(opportunity_id, market_key, market_type, agent_id, strategy_id, observed_at, candidate_at, candidate_age_ms, candidate_rsi, candidate_rsi_band, candidate_price, candidate_expiry, direction, entry_mode, stage, strength, decision, accepted, rsi, rsi_trajectory, bollinger, band, dmi, adx, structural_trend, short_horizon_direction, projection, expected_cushion, v3_decision, strict_v2_decision, pullback_v2_decision, order_id, execution_id, effective_stake, entry_price, entry_noise, expiry_at, expiry_price, result, profit, actual_displacement, actual_cushion, projection_correct, quality_class, settlement_basis, indicators, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25,$26,$27::jsonb,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46::jsonb,$47::jsonb, now())
       ON CONFLICT(opportunity_id) DO UPDATE SET candidate_age_ms=$8, direction=$13, entry_mode=$14, stage=$15, strength=$16, decision=$17, accepted=$18, rsi=$19, rsi_trajectory=$20, bollinger=$21::jsonb, band=$22::jsonb, dmi=$23::jsonb, adx=$24::jsonb, structural_trend=$25, short_horizon_direction=$26, projection=$27::jsonb, expected_cushion=$28, v3_decision=$29, strict_v2_decision=$30, pullback_v2_decision=$31, order_id=COALESCE($32, iq_rsi_opportunities_v3.order_id), execution_id=COALESCE($33, iq_rsi_opportunities_v3.execution_id), effective_stake=COALESCE($34, iq_rsi_opportunities_v3.effective_stake), entry_price=COALESCE($35, iq_rsi_opportunities_v3.entry_price), entry_noise=COALESCE($36, iq_rsi_opportunities_v3.entry_noise), expiry_price=COALESCE($38, iq_rsi_opportunities_v3.expiry_price), result=COALESCE($39, iq_rsi_opportunities_v3.result), profit=COALESCE($40, iq_rsi_opportunities_v3.profit), actual_displacement=COALESCE($41, iq_rsi_opportunities_v3.actual_displacement), actual_cushion=COALESCE($42, iq_rsi_opportunities_v3.actual_cushion), projection_correct=COALESCE($43, iq_rsi_opportunities_v3.projection_correct), quality_class=COALESCE($44, iq_rsi_opportunities_v3.quality_class), settlement_basis=COALESCE($45, iq_rsi_opportunities_v3.settlement_basis), indicators=$46::jsonb, payload=$47::jsonb, updated_at=now()`,
      [record.opportunity_id, record.market_key, record.market_type, record.agent_id, record.strategy_id, record.observed_at, record.candidate_at, record.candidate_age_ms, record.candidate_rsi, record.candidate_rsi_band, record.candidate_price, record.candidate_expiry, record.direction, record.entry_mode, record.stage, record.strength, record.decision, record.accepted, record.rsi, record.rsi_trajectory, JSON.stringify(record.bollinger), JSON.stringify(record.band), JSON.stringify(record.dmi), JSON.stringify(record.adx), record.structural_trend, record.short_horizon_direction, JSON.stringify(record.projection), record.expected_cushion, record.v3_decision, record.strict_v2_decision, record.pullback_v2_decision, record.order_id, record.execution_id, record.effective_stake, record.entry_price, record.entry_noise, record.expiry_at, record.expiry_price, record.result, record.profit, record.actual_displacement, record.actual_cushion, record.projection_correct, record.quality_class, record.settlement_basis, JSON.stringify(record.indicators ?? {}), JSON.stringify(record.payload ?? {})],
    ).catch(() => undefined);
  }

  /** Settlement causal (observacional) de oportunidade sem ordem; nunca mexe em resultado de broker. */
  async #settleCausal({ marketKey, candles, now }) {
    if (!marketKey || !Array.isArray(candles) || !candles.length) return 0;
    let settled = 0;
    for (const record of [...this.opportunities.values()]) {
      if (record.market_key !== marketKey || record.result !== null) continue;
      const expiry = num(record.expiry_at); if (expiry === null || now < expiry + 5_000) continue;
      if (record.order_id) continue; // ordem real: settle via broker
      const direction = record.direction;
      if (direction !== "BUY" && direction !== "SELL") continue;
      const entryPrice = num(record.entry_price);
      const expiryCandle = candles.filter((candle) => num(candle.bucketStart) !== null && Number(candle.bucketStart) >= expiry).sort((a, b) => a.bucketStart - b.bucketStart)[0] ?? candles[candles.length - 1];
      const expiryPrice = num(expiryCandle?.close);
      if (entryPrice === null || expiryPrice === null) continue;
      const raw = expiryPrice > entryPrice ? "WIN" : expiryPrice < entryPrice ? "LOSS" : "DRAW";
      const result = direction === "BUY" ? raw : raw === "WIN" ? "LOSS" : raw === "LOSS" ? "WIN" : "DRAW";
      const payout = num(record.payload?.payout) ?? 0;
      const profit = result === "WIN" ? Number((this.stakeBrl * (payout / 100)).toFixed(2)) : result === "LOSS" ? -this.stakeBrl : 0;
      const classification = classifyOutcomeV3({ result, entryPrice, expiryPrice, direction, noiseHorizon: num(record.entry_noise) });
      record.result = result; record.profit = profit; record.expiry_price = expiryPrice;
      record.actual_displacement = classification.actualDisplacement; record.actual_cushion = classification.actualCushion;
      record.projection_correct = classification.projectionCorrect; record.quality_class = classification.qualityClass;
      record.settlement_basis = "CAUSAL_COUNTERFACTUAL_V3";
      this.#opportunitiesSet(record.opportunity_id, record);
      if (this.pool?.query) await this.pool.query("UPDATE iq_rsi_opportunities_v3 SET expiry_price=$2, result=$3, profit=$4, actual_displacement=$5, actual_cushion=$6, projection_correct=$7, quality_class=$8, settlement_basis=$9, updated_at=now() WHERE opportunity_id=$1", [record.opportunity_id, expiryPrice, result, profit, classification.actualDisplacement, classification.actualCushion, classification.projectionCorrect, classification.qualityClass, record.settlement_basis]).catch(() => undefined);
      settled += 1;
    }
    return settled;
  }

  /** Liquidacao REAL do broker para a perna executada (mesmo caminho normal). */
  recordSettlement({ marketKey = null, result = null, profit = null, entryPrice = null, expiryPrice = null, payout = null } = {}) {
    const assignment = this.assignments.get(marketKey);
    let state = this.agents.get(marketKey);
    if (!state && !assignment) return null;
    if (!state) { state = { agentId: `${V3_ID}:${marketKey}`, marketKey, strategy: V3_ID, decision: "WAIT" }; this.agents.set(marketKey, state); }
    state.lastResult = result; state.lastPnl = num(profit); state.entryPrice = num(entryPrice); state.expiryPrice = num(expiryPrice); state.payout = num(payout);
    state.position = { status: "SETTLED", result, profit: num(profit), orderId: state.orderId ?? null, executionId: state.executionId ?? null, requestedStake: state.requestedStake ?? this.stakeBrl, effectiveStake: state.effectiveStake ?? null, entryMode: state.entryMode ?? null };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    const opportunityId = this.openOrders.get(marketKey);
    if (opportunityId) {
      this.openOrders.delete(marketKey);
      const record = this.#opportunitiesGet(opportunityId);
      if (record) {
        const classification = classifyOutcomeV3({ result, entryPrice: num(entryPrice) ?? record.entry_price, expiryPrice: num(expiryPrice), direction: record.direction, noiseHorizon: num(record.entry_noise) });
        record.result = result; record.profit = num(profit); record.expiry_price = num(expiryPrice);
        record.actual_displacement = classification.actualDisplacement; record.actual_cushion = classification.actualCushion;
        record.projection_correct = classification.projectionCorrect; record.quality_class = classification.qualityClass;
        record.settlement_basis = "BROKER_EXECUTED_V3";
        state.qualityClass = classification.qualityClass;
        this.#opportunitiesSet(opportunityId, record);
        if (this.pool?.query) void this.pool.query("UPDATE iq_rsi_opportunities_v3 SET expiry_price=$2, result=$3, profit=$4, actual_displacement=$5, actual_cushion=$6, projection_correct=$7, quality_class=$8, settlement_basis=$9, updated_at=now() WHERE opportunity_id=$1", [opportunityId, num(expiryPrice), result, num(profit), classification.actualDisplacement, classification.actualCushion, classification.projectionCorrect, classification.qualityClass, record.settlement_basis]).catch(() => undefined);
      }
    }
    void this.#persistState(state);
    return state;
  }

  async #persistState(state) {
    if (!this.pool?.query || !state?.marketKey) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state_v3(agent_id, market_key, strategy, status, decision, wait_reason, candidate_at, candidate_age_ms, candidate_rsi, candidate_price, candidate_expiry, revalidation_at, submit_at, expiry_at, entry_mode, rsi, rsi_trajectory, rsi_band, bollinger, band, dmi, adx, stage, strength, structural_trend, short_horizon_direction, projection, expected_cushion, strict_v2_decision, pullback_v2_decision, order_id, execution_id, requested_stake, effective_stake, last_result, last_pnl, quality_class, last_reason, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39::jsonb, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$4, decision=$5, wait_reason=$6, candidate_at=$7, candidate_age_ms=$8, candidate_rsi=$9, candidate_price=$10, candidate_expiry=$11, revalidation_at=$12, submit_at=$13, expiry_at=$14, entry_mode=COALESCE($15, iq_rsi_agent_state_v3.entry_mode), rsi=$16, rsi_trajectory=$17, rsi_band=$18, bollinger=$19::jsonb, band=$20::jsonb, dmi=$21::jsonb, adx=$22::jsonb, stage=$23, strength=$24, structural_trend=$25, short_horizon_direction=$26, projection=$27::jsonb, expected_cushion=$28, strict_v2_decision=$29, pullback_v2_decision=$30, order_id=COALESCE($31, iq_rsi_agent_state_v3.order_id), execution_id=COALESCE($32, iq_rsi_agent_state_v3.execution_id), requested_stake=$33, effective_stake=COALESCE($34, iq_rsi_agent_state_v3.effective_stake), last_result=COALESCE($35, iq_rsi_agent_state_v3.last_result), last_pnl=COALESCE($36, iq_rsi_agent_state_v3.last_pnl), quality_class=COALESCE($37, iq_rsi_agent_state_v3.quality_class), last_reason=$38, payload=$39::jsonb, updated_at=now()`,
      [state.agentId, state.marketKey, V3_ID, state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING", state.decision, state.waitReason, state.candidateAt, state.candidateAgeMs, state.candidateRsi, state.candidatePrice, state.candidateExpiry, state.revalidationAt, state.submitAt, state.expiryAt, state.entryMode, state.rsi, state.rsiTrajectory, state.rsiBand, JSON.stringify(state.indicators?.bollinger ?? null), JSON.stringify({ position: state.indicators?.bollinger?.position ?? null, touchUpper: state.indicators?.bollinger?.touchUpper ?? null, touchLower: state.indicators?.bollinger?.touchLower ?? null, outsideUpper: state.indicators?.bollinger?.outsideUpper ?? null, outsideLower: state.indicators?.bollinger?.outsideLower ?? null, rejectionUpperNow: state.indicators?.rejectionUpperNow ?? null, rejectionLowerNow: state.indicators?.rejectionLowerNow ?? null, widthSlope: state.indicators?.bollinger?.widthSlope ?? null, expanding: state.indicators?.bollinger?.expanding ?? null }), JSON.stringify(state.indicators?.dmi ?? null), JSON.stringify(state.indicators?.adx ?? null), state.stage, state.strength, state.indicators?.structuralTrend ?? null, state.indicators?.shortHorizonDirection ?? null, JSON.stringify(state.execEval?.projection ?? null), state.expectedCushion, state.strictV2Decision, state.pullbackV2Decision, state.orderId, state.executionId, state.requestedStake ?? this.stakeBrl, state.effectiveStake, state.lastResult ?? null, state.lastPnl ?? null, state.qualityClass ?? null, state.reason, JSON.stringify({ execEval: state.execEval ? { stage: state.execEval.stage, strength: state.execEval.strength, blockers: state.execEval.blockers, strengths: state.execEval.strengths, firstSight: state.execEval.firstSight, confirmations: state.execEval.confirmations } : null, revalidation: state.revalidation ?? null, episode: state.episode ?? null, episodeEvent: state.episodeEvent ?? null, candidateIndicators: state.candidateIndicators ?? null, v2: { strict: state.v2StrictEval ? { status: state.v2StrictEval.status, reason: state.v2StrictEval.reason } : null, pullback: state.v2PullbackEval ? { status: state.v2PullbackEval.status, reason: state.v2PullbackEval.reason } : null }, policy: RSI_AGENTS_V3_POLICY })],
    ).catch(() => undefined);
  }

  async #persistEvent({ marketKey, event, decision, reason, payload = {} }) {
    if (!this.pool?.query) return;
    await this.pool.query(
      "INSERT INTO iq_rsi_events_v3(market_key, agent_id, strategy_id, event, decision, reason, payload, created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb, now())",
      [marketKey, `${V3_ID}:${marketKey}`, V3_ID, event, decision ?? null, reason ?? null, JSON.stringify(payload)],
    ).catch(() => undefined);
  }

  /** Agregados autoritativos do banco (inclui comparacao V3 x V2 shadow e entry modes). */
  async #dbStats() {
    if (!this.pool?.query) return null;
    try {
      const rows = (await this.pool.query("SELECT market_key, market_type, direction, entry_mode, stage, strength, candidate_rsi_band, result, profit, quality_class, projection_correct, v3_decision, strict_v2_decision, pullback_v2_decision, settlement_basis FROM iq_rsi_opportunities_v3 ORDER BY observed_at DESC LIMIT 5000")).rows ?? [];
      const empty = () => ({ opportunities: 0, directional: 0, executed: 0, settled: 0, wins: 0, losses: 0, draws: 0, pnl: 0, projectionCorrect: 0, strongWin: 0, normalWin: 0, thinWin: 0, thinLoss: 0, normalLoss: 0, strongLoss: 0 });
      const bump = (entry, row) => {
        entry.opportunities += 1;
        if (row.v3_decision === "BUY" || row.v3_decision === "SELL") entry.directional += 1;
        if (row.settlement_basis === "BROKER_EXECUTED_V3") entry.executed += 1;
        if (row.result) {
          entry.settled += 1;
          if (row.result === "WIN") entry.wins += 1; else if (row.result === "LOSS") entry.losses += 1; else entry.draws += 1;
          entry.pnl = Number((entry.pnl + (Number(row.profit) || 0)).toFixed(2));
          if (row.projection_correct === true) entry.projectionCorrect += 1;
          if (row.quality_class === "STRONG_WIN") entry.strongWin += 1;
          if (row.quality_class === "NORMAL_WIN") entry.normalWin += 1;
          if (row.quality_class === "THIN_WIN") entry.thinWin += 1;
          if (row.quality_class === "THIN_LOSS") entry.thinLoss += 1;
          if (row.quality_class === "NORMAL_LOSS") entry.normalLoss += 1;
          if (row.quality_class === "STRONG_LOSS") entry.strongLoss += 1;
        }
      };
      const by = (key) => { const map = new Map(); for (const row of rows) { const name = row[key] ?? "NA"; const entry = map.get(name) ?? empty(); map.set(name, entry); bump(entry, row); } return Object.fromEntries([...map.entries()].map(([name, entry]) => [name, summarize(entry)])); };
      const summarize = (entry) => ({ ...entry, decided: entry.wins + entry.losses, wr: entry.wins + entry.losses ? Number((entry.wins / (entry.wins + entry.losses)).toFixed(4)) : null });
      const comparison = {
        sameOpportunity: rows.length,
        v3Directional: rows.filter((row) => row.v3_decision === "BUY" || row.v3_decision === "SELL").length,
        strictShadowDirectional: rows.filter((row) => row.strict_v2_decision === "BUY" || row.strict_v2_decision === "SELL").length,
        pullbackShadowDirectional: rows.filter((row) => row.pullback_v2_decision === "BUY" || row.pullback_v2_decision === "SELL").length,
        v3AgreesStrict: rows.filter((row) => row.v3_decision === row.strict_v2_decision).length,
        v3AgreesPullback: rows.filter((row) => row.v3_decision === row.pullback_v2_decision).length,
      };
      const total = empty();
      for (const row of rows) bump(total, row);
      return { rows: rows.length, total: summarize(total), comparison, byEntryMode: by("entry_mode"), byStage: by("stage"), byStrength: by("strength"), byRsiBand: by("candidate_rsi_band"), byDirection: by("direction"), byType: by("market_type"), byMarket: by("market_key") };
    } catch { return null; }
  }

  async status() {
    const dbStats = await this.#dbStats();
    const agents = [...this.assignments.keys()].sort().map((marketKey) => {
      const assignment = this.assignments.get(marketKey);
      const state = this.agents.get(marketKey) ?? {};
      return {
        agentId: `${V3_ID}:${marketKey}`, marketKey, strategy: V3_ID, marketType: assignment.marketType,
        availability: assignment.availability, eligible: assignment.eligible === true, blocked: assignment.blocked === true, blockReason: assignment.blockReason ?? null,
        decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? "SEM_AVALIACAO", reason: state.reason ?? null,
        rsi: state.rsi ?? null, rsiBand: state.rsiBand ?? null, rsiTrajectory: state.rsiTrajectory ?? null,
        candidateAt: state.candidateAt ?? null, candidateAgeMs: state.candidateAgeMs ?? null, candidateRsi: state.candidateRsi ?? null,
        candidatePrice: state.candidatePrice ?? null, candidateExpiry: state.candidateExpiry ?? null, candidateReason: state.episode?.candidateReason ?? null,
        stage: state.stage ?? null, strength: state.strength ?? null,
        expectedCushion: state.expectedCushion ?? null, projection: state.execEval?.projection ?? null,
        entryMode: state.entryMode ?? null, revalidationAt: state.revalidationAt ?? null, submitAt: state.submitAt ?? null, expiryAt: state.expiryAt ?? null,
        strictV2Decision: state.strictV2Decision ?? "WAIT", pullbackV2Decision: state.pullbackV2Decision ?? "WAIT",
        accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: state.effectiveStake ?? null,
        orderId: state.orderId ?? null, executionId: state.executionId ?? null,
        position: state.position ?? null, lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null, qualityClass: state.qualityClass ?? null,
        bollinger: state.indicators?.bollinger ?? null, dmi: state.indicators?.dmi ?? null, adx: state.indicators?.adx ?? null,
      };
    });
    const eligibleAssignments = [...this.assignments.values()].filter((assignment) => assignment.eligible === true);
    return {
      version: RSI_AGENTS_V3_VERSION, strategy: V3_ID, mode: RSI_AGENTS_V3_POLICY.mode, enabled: this.enabled,
      practiceOnly: true, realTouched: false, stakeBrl: this.stakeBrl, pinned: true, failClosed: true,
      policy: RSI_AGENTS_V3_POLICY, skills: { v3: V3_ID, strictV2: STRICT_V2_ID, pullbackV2: PULLBACK_V2_ID }, skillsVersion: RSI_V3_VERSION,
      migration: { ...this.migration },
      universe: { at: this.universe.at, snapshotId: this.universe.snapshotId, total: this.universe.observed.length, eligible: this.universe.eligible.length, byType: this.universe.byType, markets: this.universe.observed.map((row) => ({ marketKey: row.marketKey, marketType: row.marketType, eligible: row.eligible, reason: row.reason, candlesCount: row.candlesCount })) },
      totals: { eligible: eligibleAssignments.length, normal: eligibleAssignments.filter((assignment) => assignment.marketType === "NORMAL").length, otc: eligibleAssignments.filter((assignment) => assignment.marketType === "OTC").length, blocked: agents.filter((agent) => agent.blocked === true).length, waiting: agents.filter((agent) => agent.waitReason && agent.waitReason !== "SEM_AVALIACAO").length, signals: agents.filter((agent) => agent.decision === "BUY" || agent.decision === "SELL").length },
      groups: { v3: { total: agents.length, eligible: eligibleAssignments.length, waiting: agents.filter((agent) => agent.waitReason && agent.waitReason !== "SEM_AVALIACAO").length, signals: agents.filter((agent) => agent.decision === "BUY" || agent.decision === "SELL").length, open: agents.filter((agent) => agent.position?.status === "OPEN").length, settled: agents.filter((agent) => agent.lastResult).length, wins: agents.filter((agent) => agent.lastResult === "WIN").length, losses: agents.filter((agent) => agent.lastResult === "LOSS").length } },
      assignments: agents.map((agent) => ({ marketKey: agent.marketKey, strategy: V3_ID, marketType: agent.marketType, availability: agent.availability, eligible: agent.eligible, blocked: agent.blocked, blockReason: agent.blockReason, activeId: this.assignments.get(agent.marketKey)?.activeId ?? null })),
      agents,
      dbStats,
      counters: { ...this.counters },
      rejections: this.rejections.slice(-40),
      shadowV2: { strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID, controlsExecution: false, note: "V2 congelada; decisoes registradas por oportunidade e nunca executam." },
      legacy: { v1: { paused: true }, v2: { frozen: true, executionDisabled: true } },
      readyToArm: true, armed: false,
      armInstructions: "ARM PRACTICE no TraceCon (autoExecute) — RSI_REVERSAL_PULLBACK_V3 executa via requestOrder, stake R$10, REAL LOCKED.",
    };
  }
}

export function rsiAgentsV3FreezeManifest() {
  return {
    schema: "rsi-agents-v3-freeze-v1",
    version: RSI_AGENTS_V3_VERSION,
    frozenAtUtc: new Date().toISOString(),
    policy: RSI_AGENTS_V3_POLICY,
    skills: rsiV3FreezeManifest(),
    execution: { practiceOnly: true, realLocked: true, stakeBrl: RSI_AGENTS_V3_POLICY.stakeBrl, routing: "RSI_V3_ONLY", singleBrokerPath: RSI_AGENTS_V3_POLICY.singleBrokerPath, autoInvert: false, sameExpiryRequired: true },
    shadow: { strictV2: STRICT_V2_ID, pullbackV2: PULLBACK_V2_ID, controlsExecution: false },
    observability: ["agentId", "marketKey", "strategyId", "candidateAt", "candidateAgeMs", "candidateRsi", "candidatePrice", "rsiAtT5", "rsiAtSubmit", "rsiTrajectory", "bollinger", "bandPosition", "touch", "outside", "reentry", "rejection", "bandRiding", "bandWidth", "bandSlope", "plusDI", "minusDI", "diSpread", "diSlopes", "adx", "adxSlope", "trendState", "shortDirection", "entryMode", "projection", "expectedExpiryZone", "expectedCushion", "submitAt", "entryPrice", "expiryAt", "expiryPrice", "result", "actualCushion", "qualityClass", "payout", "pnl"],
    noTuning: true,
  };
}
