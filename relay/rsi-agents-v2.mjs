/**
 * RSI AGENTS V2 — comparacao ampla e controlada STRICT V2 x PULLBACK V2.
 *
 *  - Universo descoberto dinamicamente (OPEN + enabled + activeId + feed + execucao suportada),
 *    snapshot persistido (NORMAL/OTC preservados). Nada hardcoded.
 *  - Divisao 50/50 persistente e balanceada (nunca todos OTC/NORMAL num lado; diff <= 1).
 *  - Atribuicao fixa; sem troca silenciosa. Mercado novo elegivel entra no lado menor;
 *    mercado que sumiu do feed fica bloqueado (fail closed), nunca reassinado.
 *  - Todo mercado avalia as DUAS skills no mesmo instante: a atribuida pode executar,
 *    a outra roda em SHADOW (nunca envia ordem) com decisao comparavel persistida.
 *  - Episodio de reversao: candidateAt obrigatoriamente em RSI extremo (<=30 / >=70);
 *    entrada pode ocorrer saindo do extremo, no mesmo episodio.
 *  - Timing preservado (janela [cutoff-5s, cutoff-safe], revalidacao imediata, mesma expiracao,
 *    cancelar sem inverter), PRACTICE only, stake R$10, ordem SOMENTE via
 *    runtime.submitAgentV2Order -> requestOrder (Execution Gate unico).
 *  - Migracao: nenhuma ordem enquanto assignments/skills sao migrados (hold explicito).
 */

import { STRICT_V2_ID, PULLBACK_V2_ID, RSI_SKILLS_V2, RSI_SKILLS_V2_POLICY, evaluateV2, evaluateIndicatorsV2, updateEpisodeV2, rsiSkillsV2FreezeManifest } from "./rsi-skills-v2.mjs";
import { effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";

export const RSI_AGENTS_V2_VERSION = "rsi-agents-v2-50-50-v1";
export const RSI_AGENTS_V2 = Object.freeze({ STRICT: STRICT_V2_ID, PULLBACK: PULLBACK_V2_ID });
export const RSI_AGENTS_V2_POLICY = Object.freeze({
  version: RSI_AGENTS_V2_VERSION,
  mode: "NORMAL_RUNTIME_AGENT",
  practiceOnly: true,
  realLocked: true,
  stakeBrl: 10,
  groupCount: 2,
  split: "50/50 balanceado por NORMAL/OTC",
  finalWindowMs: 5000,
  minimumSafeMarginMs: 3000,
  turbCutoffMs: 30_000,
  minClosedCandles5s: RSI_SKILLS_V2_POLICY.minClosedCandles5s,
  noSilentSubstitution: true,
  failClosed: true,
  pinned: true,
  autoInvert: false,
  sameExpiryRequired: true,
  singleBrokerPath: "runtime.submitAgentV2Order -> requestOrder",
});
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const otherStrategy = (strategy) => (strategy === STRICT_V2_ID ? PULLBACK_V2_ID : STRICT_V2_ID);

/** Intercala duas listas por maior restante (evita concentrar uma classe inteira num lado). */
export function interleaveByType(normals = [], otcs = []) {
  const left = [...normals];
  const right = [...otcs];
  const ordered = [];
  while (left.length || right.length) {
    if (!right.length || (left.length && left.length >= right.length)) ordered.push(left.shift());
    else ordered.push(right.shift());
  }
  return ordered;
}

/**
 * Divisao 50/50 deterministica e balanceada por tipo.
 * STRICT recebe ceil(total/2) quando o total e impar.
 */
export function computeFiftyFiftySplit(eligible = []) {
  const normals = eligible.filter((market) => market.marketType === "NORMAL").sort((a, b) => String(a.marketKey).localeCompare(String(b.marketKey)));
  const otcs = eligible.filter((market) => market.marketType === "OTC").sort((a, b) => String(a.marketKey).localeCompare(String(b.marketKey)));
  const ordered = interleaveByType(normals, otcs);
  const strict = [];
  const pullback = [];
  ordered.forEach((market, index) => { (index % 2 === 0 ? strict : pullback).push(market); });
  return { strict, pullback, total: ordered.length, strictCount: strict.length, pullbackCount: pullback.length };
}

export class RsiAgentsV2 {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true, skills = null, stakeBrl = RSI_AGENTS_V2_POLICY.stakeBrl } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.skills = skills ?? { evaluateIndicatorsV2, updateEpisodeV2, evaluateV2 };
    this.stakeBrl = Number(stakeBrl) > 0 ? Number(stakeBrl) : RSI_AGENTS_V2_POLICY.stakeBrl;
    this.assignments = new Map();
    this.episodes = new Map();
    this.agents = new Map();
    this.submitted = new Map();
    this.shadowPending = new Map();
    this.openOrders = new Map();
    this.rejections = [];
    this.universe = { at: null, snapshotId: null, observed: [], eligible: [], byType: { NORMAL: 0, OTC: 0 }, signature: null };
    this.migration = { state: "PENDING", startedAt: null, completedAt: null, universePersistedAt: null, assignmentsPersistedAt: null, complete: false, hold: true, reason: "MIGRACAO_V2" };
    this.counters = {
      evaluations: 0, candidates: 0, candidatesStrict: 0, candidatesPullback: 0, episodeExpired: 0,
      strictAccepted: 0, pullbackAccepted: 0, shadowDirectional: 0, ordersAcked: 0, ordersBlocked: 0,
      waits: {}, rejections: {},
    };
    this.lastUniversePersistAt = 0;
    this.lastReconcileAt = 0;
  }

  /** Universo operacional dinamico: OPEN + enabled + activeId + turbo + feed auditavel. */
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
          enabled, availability, payout: num(market.payout), candlesCount, feedReady: candlesCount >= RSI_AGENTS_V2_POLICY.minClosedCandles5s,
          turboSupported, eligible: reasons.length === 0, reason: reasons.join("+") || null,
        };
      })
      .sort((a, b) => String(a.marketKey).localeCompare(String(b.marketKey)));
    const eligible = observed.filter((row) => row.eligible);
    const byType = { NORMAL: 0, OTC: 0 };
    for (const row of eligible) byType[row.marketType] = (byType[row.marketType] ?? 0) + 1;
    const signature = eligible.map((row) => `${row.marketKey}:${row.marketType}`).join("|");
    this.universe = { at, snapshotId: `rsi-universe-v2:${at}:${eligible.length}`, observed, eligible, byType, signature };
    return this.universe;
  }

  async #persistUniverseSnapshot() {
    if (!this.pool?.query) return;
    if (this.now() - this.lastUniversePersistAt < 60_000) return;
    this.lastUniversePersistAt = this.now();
    const snapshotId = this.universe.snapshotId;
    for (const row of this.universe.observed) {
      await this.pool.query(
        `INSERT INTO iq_rsi_universe_v2(snapshot_id, market_key, at, market_type, canonical, active_id, enabled, availability, payout, candles_count, feed_ready, turbo_supported, eligible, reason, payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
         ON CONFLICT(snapshot_id, market_key) DO NOTHING`,
        [snapshotId, row.marketKey, this.universe.at, row.marketType, row.canonical, row.activeId, row.enabled, row.availability, row.payout, row.candlesCount, row.feedReady, row.turboSupported, row.eligible, row.reason, JSON.stringify({ policy: RSI_AGENTS_V2_POLICY })],
      ).catch(() => undefined);
    }
    if (this.migration.universePersistedAt === null) this.migration.universePersistedAt = this.now();
  }

  /** Migra/confirma assignments 50/50 persistidos; nunca troca um mercado existente em silencio. */
  async assignUniverse(markets = []) {
    const universe = this.discoverUniverse(markets);
    if (this.migration.startedAt === null) this.migration.startedAt = this.now();
    this.migration.state = "RUNNING";
    await this.#persistUniverseSnapshot();
    await this.#reconcileAssignments(universe.eligible);
    await this.#finalizeMigration();
    return [...this.assignments.entries()];
  }

  async #loadPersistedAssignments() {
    if (!this.pool?.query) return [];
    return await this.pool.query("SELECT market_key, strategy, market_type, canonical, active_id, availability, block_reason FROM iq_rsi_agent_assignments_v2")
      .then((result) => result.rows ?? []).catch(() => []);
  }

  async #reconcileAssignments(eligible = []) {
    if (this.now() - this.lastReconcileAt < 15_000 && this.assignments.size > 0) return;
    this.lastReconcileAt = this.now();
    const persisted = await this.#loadPersistedAssignments();
    for (const row of persisted) {
      if (!this.assignments.has(row.market_key)) {
        const strategy = String(row.strategy);
        if (!RSI_SKILLS_V2.includes(strategy)) {
          this.assignments.set(row.market_key, { marketKey: row.market_key, strategy, marketType: row.market_type ?? null, canonical: row.canonical ?? null, activeId: num(row.active_id), availability: String(row.availability ?? "UNKNOWN"), eligible: false, pinned: true, blocked: true, blockReason: `CONFLICT_UNKNOWN_STRATEGY:${strategy}`, assignedAt: this.now() });
          this.log("RSI_AGENT_V2_ASSIGNMENT_CONFLICT", JSON.stringify({ marketKey: row.market_key, strategy }));
          continue;
        }
        this.assignments.set(row.market_key, { marketKey: row.market_key, strategy, marketType: row.market_type ?? null, canonical: row.canonical ?? null, activeId: num(row.active_id), availability: String(row.availability ?? "UNKNOWN"), eligible: false, pinned: true, blocked: false, blockReason: row.block_reason ?? null, assignedAt: this.now() });
      }
    }
    const eligibleKeys = new Set(eligible.map((row) => row.marketKey));
    // 1. Mercados novos elegiveis sem assignment: entram no lado menor (balanceado por tipo).
    for (const market of eligible) {
      const existing = this.assignments.get(market.marketKey);
      if (existing) {
        existing.marketType = market.marketType; existing.canonical = market.canonical; existing.activeId = market.activeId;
        existing.availability = market.availability; existing.eligible = true;
        if (existing.blocked && existing.blockReason && existing.blockReason.startsWith("CONFLICT")) continue;
        existing.blocked = false; existing.blockReason = null;
        continue;
      }
      const strategy = this.#pickBalancedStrategy(market.marketType);
      const assignment = { marketKey: market.marketKey, strategy, marketType: market.marketType, canonical: market.canonical, activeId: market.activeId, availability: market.availability, eligible: true, pinned: true, blocked: false, blockReason: null, assignedAt: this.now() };
      this.assignments.set(market.marketKey, assignment);
      if (this.pool?.query) await this.pool.query(
        `INSERT INTO iq_rsi_agent_assignments_v2(market_key, strategy, market_type, canonical, active_id, availability, pinned, block_reason)
         VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT(market_key) DO UPDATE SET availability=$6, active_id=$5, updated_at=now()`,
        [market.marketKey, strategy, market.marketType, market.canonical, market.activeId, market.availability, null],
      ).catch(() => undefined);
      this.log("RSI_AGENT_V2_ASSIGNMENT", JSON.stringify({ marketKey: market.marketKey, strategy, marketType: market.marketType }));
    }
    // 2. Mercados atribuidos que sumiram do universo elegivel: fail closed, sem reassinatura.
    for (const [marketKey, assignment] of this.assignments) {
      if (eligibleKeys.has(marketKey)) continue;
      if (assignment.eligible === false && assignment.blocked) continue;
      assignment.eligible = false;
      assignment.availability = this.universe.observed.find((row) => row.marketKey === marketKey)?.availability ?? "NOT_IN_UNIVERSE";
      assignment.blocked = true;
      assignment.blockReason = `NOT_ELIGIBLE:${this.universe.observed.find((row) => row.marketKey === marketKey)?.reason ?? "NOT_IN_UNIVERSE"}`;
      if (this.pool?.query) await this.pool.query("UPDATE iq_rsi_agent_assignments_v2 SET availability=$2, block_reason=$3, updated_at=now() WHERE market_key=$1", [marketKey, assignment.availability, assignment.blockReason]).catch(() => undefined);
      this.log("RSI_AGENT_V2_ASSIGNMENT_BLOCKED", JSON.stringify({ marketKey, reason: assignment.blockReason }));
    }
    if (this.pool?.query && this.migration.assignmentsPersistedAt === null) this.migration.assignmentsPersistedAt = this.now();
  }

  #pickBalancedStrategy(marketType) {
    let strictTotal = 0; let pullTotal = 0; let strictType = 0; let pullType = 0;
    for (const assignment of this.assignments.values()) {
      const count = assignment.eligible === false && assignment.blocked ? 0 : 1;
      if (!count) continue;
      if (assignment.strategy === STRICT_V2_ID) { strictTotal += 1; if (assignment.marketType === marketType) strictType += 1; }
      else { pullTotal += 1; if (assignment.marketType === marketType) pullType += 1; }
    }
    if (strictTotal !== pullTotal) return strictTotal < pullTotal ? STRICT_V2_ID : PULLBACK_V2_ID;
    return strictType <= pullType ? STRICT_V2_ID : PULLBACK_V2_ID;
  }

  async #finalizeMigration() {
    const eligible = this.universe.eligible;
    const assigned = eligible.filter((row) => this.assignments.get(row.marketKey)?.eligible === true).length;
    // Sem banco (modo in-memory) a migracao nao tem snapshot a persistir: fecha localmente.
    if (!this.pool?.query && this.migration.universePersistedAt === null) {
      this.migration.universePersistedAt = this.now();
      this.migration.assignmentsPersistedAt = this.now();
    }
    const done = assigned === eligible.length && (this.migration.universePersistedAt !== null || !this.pool?.query);
    if (done && !this.migration.complete) {
      this.migration.complete = true; this.migration.hold = false; this.migration.state = "COMPLETE"; this.migration.completedAt = this.now();
      this.log("RSI_AGENT_V2_MIGRATION_COMPLETE", JSON.stringify({ eligible: eligible.length, strict: this.#countByStrategy(STRICT_V2_ID), pullback: this.#countByStrategy(PULLBACK_V2_ID) }));
      return;
    }
    this.migration.state = done ? "COMPLETE" : "HOLD";
    this.migration.reason = done ? null : this.migration.universePersistedAt === null ? "UNIVERSE_SNAPSHOT_PENDING" : "ASSIGNMENTS_PENDING";
  }

  #countByStrategy(strategy) { let count = 0; for (const assignment of this.assignments.values()) if (assignment.strategy === strategy && assignment.eligible === true) count += 1; return count; }

  #setState(state) { this.agents.set(state.marketKey, state); }

  /** Snapshot sincrono (sem I/O) para o Office: universo, split, migracao e grupo resumido. */
  snapshot() {
    const summarize = (strategy) => {
      let total = 0; let signals = 0; let waiting = 0; let open = 0; let settled = 0; let wins = 0; let losses = 0;
      for (const [marketKey, assignment] of this.assignments) {
        if (assignment.strategy !== strategy) continue;
        total += 1;
        const state = this.agents.get(marketKey);
        if (!state) continue;
        if (state.decision === "BUY" || state.decision === "SELL") signals += 1;
        if (state.waitReason) waiting += 1;
        if (state.position?.status === "OPEN") open += 1;
        if (state.lastResult) { settled += 1; if (state.lastResult === "WIN") wins += 1; if (state.lastResult === "LOSS") losses += 1; }
      }
      return { total, signals, waiting, open, settled, wins, losses };
    };
    return {
      version: RSI_AGENTS_V2_VERSION, enabled: this.enabled, stakeBrl: this.stakeBrl,
      migration: { state: this.migration.state, complete: this.migration.complete, hold: this.migration.hold, reason: this.migration.reason, startedAt: this.migration.startedAt, completedAt: this.migration.completedAt },
      universe: { at: this.universe.at, eligible: this.universe.eligible.length, observed: this.universe.observed.length, byType: this.universe.byType },
      split: { strict: this.#countByStrategy(STRICT_V2_ID), pullback: this.#countByStrategy(PULLBACK_V2_ID) },
      groups: { strict: summarize(STRICT_V2_ID), pullback: summarize(PULLBACK_V2_ID) },
      readyToArm: true, armed: false, practiceOnly: true, realLocked: true,
    };
  }
  stateFor(marketKey) {
    if (!marketKey) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return null;
    const state = this.agents.get(marketKey) ?? {};
    return {
      strategyId: assignment.strategy, label: assignment.strategy === STRICT_V2_ID ? "STRICT" : "PULLBACK",
      decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? null, state: state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING",
      lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null, candidateAt: state.candidateAt ?? null,
      rsi: state.rsi ?? null, shadowDecision: state.shadowDecision ?? null, shadowStrategyId: state.shadowStrategyId ?? null,
      blocked: assignment.blocked === true, blockReason: assignment.blockReason ?? null, eligible: assignment.eligible === true,
    };
  }

  /** Observacao por mercado (candles reais) com execucao da skill atribuida + shadow da outra. */
  async observeMarket({ marketKey, marketType = null, activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return null;
    const at = num(now) ?? this.now();
    const list = Array.isArray(candles) ? candles : [];
    const indicators = this.skills.evaluateIndicatorsV2({ candles: list, now: at });
    const agentId = `${assignment.strategy}:${marketKey}`;
    const baseState = {
      agentId, marketKey, strategy: assignment.strategy, shadowStrategy: otherStrategy(assignment.strategy), at,
      accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: null, orderId: null, executionId: null,
      rsi: num(indicators.rsi), rsiBand: indicators.rsiBand ?? null, rsiTrajectory: null,
      bollinger: indicators.bollinger ?? null, dmi: indicators.dmi ?? null, adx: indicators.adx ?? null,
      structuralTrend: indicators.structuralTrend ?? "UNKNOWN", shortHorizonDirection: indicators.shortHorizonDirection ?? "UNKNOWN",
      decision: "WAIT", waitReason: null, reason: null, candidateAt: null, revalidationAt: null, submitAt: null, expiryAt: num(targetExpiryAt),
      executingDecision: "WAIT", shadowDecision: "WAIT", agreement: null,
    };
    void this.#settleShadowCausal({ marketKey, candles: list, now: at });
    if (assignment.blocked === true) {
      const blocked = { ...baseState, waitReason: assignment.blockReason ?? "ASSIGNMENT_BLOCKED", reason: assignment.blockReason ?? "assignments bloqueados (fail closed)" };
      this.#setState(blocked); void this.#persistState(blocked); return blocked;
    }
    if (indicators.closedCandles < RSI_AGENTS_V2_POLICY.minClosedCandles5s) {
      const waiting = { ...baseState, waitReason: "NO_FEED_INSUFFICIENT_CANDLES", reason: `candles fechados=${indicators.closedCandles}` };
      this.#setState(waiting); void this.#persistState(waiting); return waiting;
    }
    this.counters.evaluations += 1;
    const previousEpisode = this.episodes.get(marketKey) ?? null;
    const episodeUpdate = this.skills.updateEpisodeV2({ episode: previousEpisode, indicators, at });
    const episode = episodeUpdate.episode ?? null;
    if (episodeUpdate.event.startsWith("EPISODE_EXPIRED")) { this.episodes.delete(marketKey); this.counters.episodeExpired += 1; }
    else if (episode) this.episodes.set(marketKey, episode);
    const execEval = this.skills.evaluateV2({ strategy: assignment.strategy, indicators, episode });
    const shadowEval = this.skills.evaluateV2({ strategy: otherStrategy(assignment.strategy), indicators, episode });
    const state = {
      ...baseState,
      rsiTrajectory: episode ? (num(indicators.rsi) !== null && (num(indicators.rsi) <= RSI_SKILLS_V2_POLICY.rsiBuyThreshold || num(indicators.rsi) >= RSI_SKILLS_V2_POLICY.rsiSellThreshold) ? "STILL_EXTREME" : "LEAVING_EXTREME") : "NEUTRAL",
      candidateAt: episode?.candidateAt ?? null,
      executingDecision: execEval.decision, shadowDecision: shadowEval.decision,
      agreement: execEval.decision === shadowEval.decision,
      execEval, shadowEval, episodeEvent: episodeUpdate.event,
      episode: episode ? { direction: episode.direction, candidateAt: episode.candidateAt, candidateRsi: episode.candidateRsi, candidateRsiBand: episode.candidateRsiBand, candidateIndicators: episode.candidateIndicators ?? null, touchedUpper: episode.touchedUpper, touchedLower: episode.touchedLower, outsideUpper: episode.outsideUpper, outsideLower: episode.outsideLower, reenteredUpper: episode.reenteredUpper, reenteredLower: episode.reenteredLower, oppositeReactionStreak: episode.oppositeReactionStreak ?? 0, maxSpread: episode.maxSpread, minSpread: episode.minSpread, maxRsi: episode.maxRsi, minRsi: episode.minRsi, maxPlusDI: episode.maxPlusDI, maxMinusDI: episode.maxMinusDI } : null,
    };
    if (!episode) {
      state.waitReason = episodeUpdate.event === "NO_CANDIDATE" ? "NO_CANDIDATE_RSI_NEUTRO" : episodeUpdate.event;
      state.reason = "RSI neutro: candidate somente nasce em extremo (<=30 / >=70)";
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (episodeUpdate.event === "CANDIDATE_CREATED" || episodeUpdate.event === "CANDIDATE_FLIPPED") {
      this.counters.candidates += 1;
      if (assignment.strategy === STRICT_V2_ID) this.counters.candidatesStrict += 1; else this.counters.candidatesPullback += 1;
      this.log("RSI_AGENT_V2_CANDIDATE", JSON.stringify({ marketKey, strategy: assignment.strategy, direction: episode.direction, rsi: episode.candidateRsi, at }));
    }
    const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: effectiveSafeMarginMs(latency) }) : null;
    const record = this.#shadowRecord({ state, assignment, episode, execEval, shadowEval, indicators, targetExpiryAt, payout, at });
    if (execEval.decision !== "WAIT" || shadowEval.decision !== "WAIT") void this.#persistShadowOpportunity(record);
    if (execEval.decision !== "WAIT") state.decision = execEval.decision;
    if (execEval.decision === "WAIT") {
      state.waitReason = execEval.accepted === false && (execEval.direction === "BUY" || execEval.direction === "SELL") ? execEval.status : "NO_SIGNAL";
      state.reason = execEval.reason ?? null;
      if (state.waitReason !== "NO_SIGNAL") { this.counters.waits[state.waitReason] = (this.counters.waits[state.waitReason] ?? 0) + 1; void this.#persistEvent({ marketKey, strategy: assignment.strategy, event: "WAIT", decision: "WAIT", reason: state.reason, payload: { status: execEval.status, blockers: execEval.blockers, shadowDecision: shadowEval.decision, episode } }); }
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (!window) { state.waitReason = "OBSERVE_ONLY_NO_EXPIRY"; this.#setState(state); void this.#persistState(state); return state; }
    if (at < window.entryWindowOpensAt) { state.waitReason = "OBSERVE_ONLY"; this.#setState(state); void this.#persistState(state); return state; }
    if (at > window.entryWindowClosesAt) {
      state.waitReason = at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
      this.#setState(state); void this.#persistState(state); return state;
    }
    // REVALIDACAO imediatamente antes do envio (mesma expiracao; nunca inverte).
    const revalIndicators = this.skills.evaluateIndicatorsV2({ candles: list, now: at });
    const revalEpisodeUpdate = this.skills.updateEpisodeV2({ episode, indicators: revalIndicators, at });
    const revalEpisode = revalEpisodeUpdate.episode ?? null;
    const revalEval = this.skills.evaluateV2({ strategy: assignment.strategy, indicators: revalIndicators, episode: revalEpisode });
    state.revalidationAt = at;
    if (!revalEpisode || revalEval.decision === "WAIT" || revalEval.direction !== execEval.direction) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = "tese morreu na revalidacao (sem inversao automatica)";
      this.counters.waits.CANCELLED_REVALIDATION = (this.counters.waits.CANCELLED_REVALIDATION ?? 0) + 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (this.migration.complete !== true) {
      state.decision = "WAIT"; state.waitReason = "MIGRATION_IN_PROGRESS"; state.reason = "assignments/skills V2 em migracao: nenhuma ordem";
      this.#setState(state); void this.#persistState(state); return state;
    }
    const idempotencyKey = `rsi-agent-v2:${assignment.strategy}:${marketKey}:${targetExpiryAt}:${state.decision}`;
    if (this.submitted.has(idempotencyKey)) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    // FAIL CLOSED antes do requestOrder (strategyId/agentId/marketKey/assignment/stake/PRACTICE).
    const assignmentNow = this.assignments.get(marketKey);
    const precheck = {
      strategyMatches: assignmentNow?.strategy === assignment.strategy,
      assignmentEligible: assignmentNow?.eligible === true && assignmentNow?.blocked !== true,
      agentIdMatches: agentId === `${assignment.strategy}:${marketKey}`,
      practiceOnly: true,
      stakeMatches: this.stakeBrl === RSI_AGENTS_V2_POLICY.stakeBrl,
    };
    const precheckFailed = Object.entries(precheck).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (precheckFailed.length) {
      state.decision = "WAIT"; state.waitReason = `FAIL_CLOSED_${precheckFailed.join("_")}`; state.reason = "pre-checks de execucao falharam";
      this.counters.ordersBlocked += 1;
      this.rejections.push({ marketKey, strategy: assignment.strategy, reason: state.waitReason, at });
      this.#setState(state); void this.#persistState(state); return state;
    }
    try {
      const order = await this.runtime.submitAgentV2Order({
        marketKey, direction: state.decision, strategyId: assignment.strategy, skill: execEval.strategy,
        stake: this.stakeBrl, expectedStake: RSI_AGENTS_V2_POLICY.stakeBrl, idempotencyKey, decisionId: agentId,
        candidateAt: episode.candidateAt, expiryAt: targetExpiryAt,
        shadow: { strategy: shadowEval.strategy, decision: shadowEval.decision },
      });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      state.submitAt = this.now();
      state.orderId = order?.brokerOrderId !== null && order?.brokerOrderId !== undefined ? String(order.brokerOrderId) : null;
      state.executionId = order?.executionId !== null && order?.executionId !== undefined ? String(order.executionId) : null;
      state.requestedStake = num(order?.stakeRequested) ?? this.stakeBrl;
      state.effectiveStake = num(order?.stake) ?? null;
      if (accepted) {
        this.submitted.set(idempotencyKey, { at: state.submitAt, marketKey, direction: state.decision });
        this.openOrders.set(marketKey, record.opportunityId);
        this.counters.ordersAcked += 1;
        if (assignment.strategy === STRICT_V2_ID) this.counters.strictAccepted += 1; else this.counters.pullbackAccepted += 1;
        state.reason = `ordem aceita PRACTICE execution=${state.executionId ?? "-"} order=${state.orderId ?? "-"} stake=${state.effectiveStake ?? "-"}`;
        state.position = { status: "OPEN", brokerOrderId: state.orderId, executionId: state.executionId, requestedStake: state.requestedStake, effectiveStake: state.effectiveStake };
        void this.#persistShadowOpportunity({ ...record, orderId: state.orderId, executionId: state.executionId, effectiveStake: state.effectiveStake, executingAccepted: true, executingDecision: state.decision });
      } else {
        state.decision = "WAIT"; state.waitReason = `ORDER_${order?.disposition ?? order?.state ?? "BLOCKED"}`;
        state.reason = String(order?.reason ?? order?.state ?? "bloqueado").slice(0, 160);
        this.counters.ordersBlocked += 1;
        this.rejections.push({ marketKey, strategy: assignment.strategy, reason: state.waitReason, at, orderId: state.orderId, executionId: state.executionId });
        void this.#persistEvent({ marketKey, strategy: assignment.strategy, event: "ORDER_BLOCKED", decision: execEval.direction, reason: state.reason, payload: { orderId: state.orderId, executionId: state.executionId } });
      }
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.decision = "WAIT"; state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.counters.ordersBlocked += 1;
      this.counters.rejections[code] = (this.counters.rejections[code] ?? 0) + 1;
      this.rejections.push({ marketKey, strategy: assignment.strategy, reason: code, message: state.reason, at });
      this.log("RSI_AGENT_V2_ORDER_BLOCKED", JSON.stringify({ marketKey, strategy: assignment.strategy, reason: code }));
      void this.#persistEvent({ marketKey, strategy: assignment.strategy, event: "ORDER_BLOCKED", decision: execEval.direction, reason: state.reason, payload: { code } });
    }
    this.#setState(state); void this.#persistState(state);
    return state;
  }

  #shadowRecord({ assignment, episode, execEval, shadowEval, indicators, targetExpiryAt, payout, at }) {
    const direction = execEval.direction ?? shadowEval.direction ?? episode?.direction ?? null;
    return {
      opportunityId: `rsi-opp-v2:${assignment.marketKey}:${episode?.candidateAt ?? at}:${targetExpiryAt ?? "NA"}`,
      marketKey: assignment.marketKey, marketType: assignment.marketType ?? null,
      strategyExecuting: assignment.strategy, strategyShadow: otherStrategy(assignment.strategy),
      observedAt: episode?.candidateAt ?? at, expiryAt: num(targetExpiryAt), at,
      executingDecision: execEval.decision, shadowDecision: shadowEval.decision,
      executingAccepted: execEval.accepted === true, shadowAccepted: shadowEval.accepted === true,
      direction: direction === "BUY" || direction === "SELL" ? direction : null,
      rsi: num(indicators.rsi), rsiBand: indicators.rsiBand ?? null,
      bollinger: indicators.bollinger ?? null, dmi: indicators.dmi ?? null, adx: indicators.adx ?? null,
      structuralTrend: indicators.structuralTrend ?? null, shortHorizonDirection: indicators.shortHorizonDirection ?? null,
      payout: num(payout), entryPrice: num(indicators.bollinger?.close),
      executingResult: null, executingProfit: null, executingSettledAt: null,
      shadowResult: null, shadowProfit: null, shadowSettledAt: null, settlementBasis: null,
      agreement: execEval.decision === shadowEval.decision,
      shadowReason: shadowEval.reason ?? null, executingReason: execEval.reason ?? null, payload: { blockers: { executing: execEval.blockers ?? [], shadow: shadowEval.blockers ?? [] }, candidateRsi: episode?.candidateRsi ?? null, candidateIndicators: episode?.candidateIndicators ?? null, submitIndicators: indicators ? { rsi: num(indicators.rsi), rsiBand: indicators.rsiBand ?? null, bollinger: indicators.bollinger ?? null, dmi: indicators.dmi ?? null, adx: indicators.adx ?? null, structuralTrend: indicators.structuralTrend ?? null, shortHorizonDirection: indicators.shortHorizonDirection ?? null } : null },
    };
  }

  async #persistShadowOpportunity(record) {
    if (!this.pool?.query || !record) return;
    this.shadowPending.set(record.opportunityId, record);
    if (this.shadowPending.size > 500) this.shadowPending.delete(this.shadowPending.keys().next().value);
    const tags = {
      direction: record.direction, rsiBand: record.rsiBand,
      bollingerMode: record.bollinger ? (record.bollinger.outsideUpper ? "OUTSIDE_UPPER" : record.bollinger.outsideLower ? "OUTSIDE_LOWER" : record.bollinger.touchUpper ? "TOUCH_UPPER" : record.bollinger.touchLower ? "TOUCH_LOWER" : "INSIDE") : null,
      dmiState: record.dmi ? (record.dmi.plusDI - record.dmi.minusDI >= 8 ? "PLUS_DOMINANT" : record.dmi.minusDI - record.dmi.plusDI >= 8 ? "MINUS_DOMINANT" : "BALANCED") : null,
      adxState: record.adx ? (record.adx.rising ? "RISING" : record.adx.slope !== null && record.adx.slope < 0 ? "FALLING" : "FLAT") : null,
    };
    await this.pool.query(
      `INSERT INTO iq_rsi_shadow_opportunities_v2(opportunity_id, market_key, market_type, strategy_executing, strategy_shadow, observed_at, expiry_at, executing_decision, shadow_decision, agreement, executing_accepted, shadow_accepted, direction, rsi, rsi_band, bollinger, dmi, adx, structural_trend, short_horizon_direction, tags, order_id, execution_id, effective_stake, executing_result, executing_profit, executing_settled_at, shadow_result, shadow_profit, shadow_settled_at, settlement_basis, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb, now())
       ON CONFLICT(opportunity_id) DO UPDATE SET executing_decision=$8, shadow_decision=$9, agreement=$10, executing_accepted=$11, shadow_accepted=$12, order_id=COALESCE($22, iq_rsi_shadow_opportunities_v2.order_id), execution_id=COALESCE($23, iq_rsi_shadow_opportunities_v2.execution_id), effective_stake=COALESCE($24, iq_rsi_shadow_opportunities_v2.effective_stake), payload=$32::jsonb, updated_at=now()`,
      [record.opportunityId, record.marketKey, record.marketType, record.strategyExecuting, record.strategyShadow, record.observedAt, record.expiryAt, record.executingDecision, record.shadowDecision, record.agreement, record.executingAccepted, record.shadowAccepted, record.direction, record.rsi, record.rsiBand, JSON.stringify(record.bollinger), JSON.stringify(record.dmi), JSON.stringify(record.adx), record.structuralTrend, record.shortHorizonDirection, JSON.stringify(tags), record.orderId ?? null, record.executionId ?? null, record.effectiveStake ?? null, record.executingResult ?? null, record.executingProfit ?? null, record.executingSettledAt ?? null, record.shadowResult ?? null, record.shadowProfit ?? null, record.shadowSettledAt ?? null, record.settlementBasis ?? null, JSON.stringify(record.payload ?? {})],
    ).catch(() => undefined);
  }

  /** Settlement CAUSAL hipotetico das decisoes SHADOW (nunca envia ordem). */
  async #settleShadowCausal({ marketKey, candles, now }) {
    if (!marketKey || !Array.isArray(candles) || !candles.length) return 0;
    let settled = 0;
    for (const record of [...this.shadowPending.values()]) {
      if (record.marketKey !== marketKey || record.shadowResult !== null || record.shadowDecision !== "BUY" && record.shadowDecision !== "SELL") continue;
      const expiry = num(record.expiryAt); if (expiry === null || now < expiry + 5_000) continue;
      const entryPrice = num(record.entryPrice);
      const expiryCandle = candles.filter((candle) => num(candle.bucketStart) !== null && Number(candle.bucketStart) >= expiry).sort((a, b) => a.bucketStart - b.bucketStart)[0] ?? candles[candles.length - 1];
      const expiryPrice = num(expiryCandle?.close);
      if (entryPrice === null || expiryPrice === null) continue;
      const raw = expiryPrice > entryPrice ? "WIN" : expiryPrice < entryPrice ? "LOSS" : "DRAW";
      const outcome = record.shadowDecision === "BUY" ? raw : raw === "WIN" ? "LOSS" : raw === "LOSS" ? "WIN" : "DRAW";
      const payout = num(record.payout) ?? 0;
      const profit = outcome === "WIN" ? Number((this.stakeBrl * (payout / 100)).toFixed(2)) : outcome === "LOSS" ? -this.stakeBrl : 0;
      record.shadowResult = outcome; record.shadowProfit = profit; record.shadowSettledAt = now; record.settlementBasis = "CAUSAL_COUNTERFACTUAL_SHADOW";
      this.shadowPending.set(record.opportunityId, record);
      if (this.pool?.query) await this.pool.query("UPDATE iq_rsi_shadow_opportunities_v2 SET shadow_result=$2, shadow_profit=$3, shadow_settled_at=$4, settlement_basis=$5, updated_at=now() WHERE opportunity_id=$1", [record.opportunityId, outcome, profit, now, record.settlementBasis]).catch(() => undefined);
      settled += 1;
    }
    return settled;
  }

  /** Liquidacao REAL do broker para a perna executada (mesmo caminho normal). */
  recordSettlement({ marketKey = null, result = null, profit = null, entryPrice = null, expiryPrice = null, payout = null } = {}) {
    const assignment = this.assignments.get(marketKey);
    let state = this.agents.get(marketKey);
    if (!state && !assignment) return null;
    if (!state) { state = { agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy, decision: "WAIT" }; this.agents.set(marketKey, state); }
    state.lastResult = result; state.lastPnl = num(profit); state.entryPrice = num(entryPrice); state.expiryPrice = num(expiryPrice); state.payout = num(payout);
    state.position = { status: "SETTLED", result, profit: num(profit), orderId: state.orderId ?? null, executionId: state.executionId ?? null, requestedStake: state.requestedStake ?? this.stakeBrl, effectiveStake: state.effectiveStake ?? null };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    void this.#persistState(state);
    const opportunityId = this.openOrders.get(marketKey);
    if (opportunityId) {
      this.openOrders.delete(marketKey);
      const record = this.shadowPending.get(opportunityId);
      if (record) {
        record.executingResult = result; record.executingProfit = num(profit); record.executingSettledAt = this.now(); record.settlementBasis = "BROKER_EXECUTED";
        this.shadowPending.set(opportunityId, record);
        if (this.pool?.query) void this.pool.query("UPDATE iq_rsi_shadow_opportunities_v2 SET executing_result=$2, executing_profit=$3, executing_settled_at=$4, settlement_basis=$5, updated_at=now() WHERE opportunity_id=$1", [opportunityId, result, num(profit), record.executingSettledAt, record.settlementBasis]).catch(() => undefined);
      }
    }
    return state;
  }

  async #persistState(state) {
    if (!this.pool?.query || !state?.marketKey) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state_v2(agent_id, market_key, strategy, shadow_strategy, status, decision, wait_reason, candidate_at, revalidation_at, submit_at, expiry_at, rsi, rsi_trajectory, rsi_band, bollinger, band, dmi, adx, structural_trend, short_horizon_direction, executing_decision, shadow_decision, shadow_payload, order_id, execution_id, requested_stake, effective_stake, last_result, last_pnl, last_reason, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28,$29,$30,$31::jsonb, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$5, decision=$6, wait_reason=$7, candidate_at=$8, revalidation_at=$9, submit_at=$10, expiry_at=$11, rsi=$12, rsi_trajectory=$13, rsi_band=$14, bollinger=$15::jsonb, dmi=$17::jsonb, adx=$18::jsonb, structural_trend=$19, short_horizon_direction=$20, executing_decision=$21, shadow_decision=$22, shadow_payload=$23::jsonb, order_id=COALESCE($24, iq_rsi_agent_state_v2.order_id), execution_id=COALESCE($25, iq_rsi_agent_state_v2.execution_id), requested_stake=$26, effective_stake=$27, last_result=$28, last_pnl=$29, last_reason=$30, payload=$31::jsonb, updated_at=now()`,
      [state.agentId, state.marketKey, state.strategy, state.shadowStrategy ?? null, state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING", state.decision, state.waitReason, state.candidateAt, state.revalidationAt, state.submitAt, state.expiryAt, state.rsi, state.rsiTrajectory, state.rsiBand, JSON.stringify(state.bollinger), JSON.stringify({ position: state.bollinger?.position ?? null, touchUpper: state.bollinger?.touchUpper ?? null, touchLower: state.bollinger?.touchLower ?? null, outsideUpper: state.bollinger?.outsideUpper ?? null, outsideLower: state.bollinger?.outsideLower ?? null, reenteredUpper: state.reenteredUpper ?? null, reenteredLower: state.reenteredLower ?? null, widthSlope: state.bollinger?.widthSlope ?? null, expanding: state.bollinger?.expanding ?? null }), JSON.stringify(state.dmi), JSON.stringify(state.adx), state.structuralTrend, state.shortHorizonDirection, state.executingDecision, state.shadowDecision, JSON.stringify({ shadowEval: state.shadowEval ?? null, execEval: state.execEval ?? null, episode: state.episode ?? null, episodeEvent: state.episodeEvent ?? null, agreement: state.agreement ?? null }), state.orderId, state.executionId, state.requestedStake ?? this.stakeBrl, state.effectiveStake, state.lastResult ?? null, state.lastPnl ?? null, state.reason, JSON.stringify({ policy: RSI_AGENTS_V2_POLICY })],
    ).catch(() => undefined);
  }

  async #persistEvent({ marketKey, strategy, event, decision, reason, payload = {} }) {
    if (!this.pool?.query) return;
    await this.pool.query(
      "INSERT INTO iq_rsi_events_v2(market_key, strategy, event, decision, reason, payload, created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb, now())",
      [marketKey, strategy, event, decision, reason, JSON.stringify(payload)],
    ).catch(() => undefined);
  }

  /** Agregados autoritativos do banco (sobrevivem a restart); fallback em memoria. */
  async #dbStats() {
    if (!this.pool?.query) return null;
    try {
      const rows = (await this.pool.query("SELECT * FROM iq_rsi_shadow_opportunities_v2 ORDER BY observed_at DESC LIMIT 5000")).rows ?? [];
      const empty = () => ({ signals: 0, trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0, waits: 0, payoutSum: 0, payoutN: 0, shadowSignals: 0, shadowTrades: 0, shadowWins: 0, shadowLosses: 0, shadowDraws: 0, shadowPnl: 0 });
      const byStrategy = new Map([[STRICT_V2_ID, empty()], [PULLBACK_V2_ID, empty()]]);
      const byMarket = new Map(); const byDirection = new Map(); const byType = new Map(); const byRsiBand = new Map(); const byBollinger = new Map(); const byAdx = new Map();
      const comparison = { sameOpportunity: rows.length, agreement: 0, disagree: 0, executingOnly: 0, shadowOnly: 0, bothWait: 0 };
      const directional = (value) => value === "BUY" || value === "SELL";
      const bumpExecuting = (entry, row) => {
        if (row.executing_accepted) entry.signals += 1;
        if (row.executing_accepted && row.executing_result) {
          entry.trades += 1;
          if (row.executing_result === "WIN") entry.wins += 1; else if (row.executing_result === "LOSS") entry.losses += 1; else entry.draws += 1;
          entry.pnl = Number((entry.pnl + (Number(row.executing_profit) || 0)).toFixed(2));
          if (row.effective_stake) { entry.payoutSum += Number(row.payout ?? 0); entry.payoutN += 1; }
        }
        if (directional(row.direction) && !row.executing_accepted) entry.waits += 1;
      };
      const bumpShadow = (entry, row) => {
        if (directional(row.shadow_decision)) entry.shadowSignals += 1;
        if (row.shadow_result) {
          entry.shadowTrades += 1;
          if (row.shadow_result === "WIN") entry.shadowWins += 1; else if (row.shadow_result === "LOSS") entry.shadowLosses += 1; else entry.shadowDraws += 1;
          entry.shadowPnl = Number((entry.shadowPnl + (Number(row.shadow_profit) || 0)).toFixed(2));
        }
      };
      const entryFor = (map, key) => { const entry = map.get(key) ?? empty(); map.set(key, entry); return entry; };
      for (const row of rows) {
        bumpExecuting(entryFor(byStrategy, row.strategy_executing), row);
        bumpShadow(entryFor(byStrategy, row.strategy_shadow), row);
        bumpExecuting(entryFor(byMarket, row.market_key), row);
        bumpExecuting(entryFor(byType, row.market_type), row);
        bumpExecuting(entryFor(byDirection, row.direction), row);
        bumpExecuting(entryFor(byRsiBand, row.rsi_band), row);
        bumpExecuting(entryFor(byBollinger, row.tags?.bollingerMode ?? null), row);
        bumpExecuting(entryFor(byAdx, row.tags?.adxState ?? null), row);
        if (row.executing_decision === row.shadow_decision) comparison.agreement += 1; else comparison.disagree += 1;
        if (directional(row.executing_decision) && row.shadow_decision === "WAIT") comparison.executingOnly += 1;
        if (directional(row.shadow_decision) && row.executing_decision === "WAIT") comparison.shadowOnly += 1;
        if (row.executing_decision === "WAIT" && row.shadow_decision === "WAIT") comparison.bothWait += 1;
      }
      const summarize = (entry) => ({ signals: entry.signals, trades: entry.trades, wins: entry.wins, losses: entry.losses, draws: entry.draws, pnl: Number(entry.pnl.toFixed(2)), waits: entry.waits, decided: entry.wins + entry.losses, wr: entry.wins + entry.losses ? Number((entry.wins / (entry.wins + entry.losses)).toFixed(4)) : null, avgPayout: entry.payoutN ? Number((entry.payoutSum / entry.payoutN).toFixed(2)) : null, shadowSignals: entry.shadowSignals, shadowTrades: entry.shadowTrades, shadowWins: entry.shadowWins, shadowLosses: entry.shadowLosses, shadowDraws: entry.shadowDraws, shadowPnl: Number(entry.shadowPnl.toFixed(2)), shadowDecided: entry.shadowWins + entry.shadowLosses, shadowWr: entry.shadowWins + entry.shadowLosses ? Number((entry.shadowWins / (entry.shadowWins + entry.shadowLosses)).toFixed(4)) : null });
      const compact = (map) => Object.fromEntries([...map.entries()].filter(([key]) => key !== null).map(([key, entry]) => [key, summarize(entry)]));
      return { rows: rows.length, strict: summarize(byStrategy.get(STRICT_V2_ID)), pullback: summarize(byStrategy.get(PULLBACK_V2_ID)), comparison, byMarket: compact(byMarket), byDirection: compact(byDirection), byType: compact(byType), byRsiBand: compact(byRsiBand), byBollinger: compact(byBollinger), byAdx: compact(byAdx) };
    } catch { return null; }
  }

  async status() {
    const dbStats = await this.#dbStats();
    const agents = [...this.assignments.keys()].sort().map((marketKey) => {
      const assignment = this.assignments.get(marketKey);
      const state = this.agents.get(marketKey) ?? {};
      return {
        agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy,
        label: assignment.strategy === STRICT_V2_ID ? "STRICT" : "PULLBACK", marketType: assignment.marketType,
        availability: assignment.availability, eligible: assignment.eligible === true, blocked: assignment.blocked === true, blockReason: assignment.blockReason ?? null,
        decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? "SEM_AVALIACAO", reason: state.reason ?? null,
        rsi: state.rsi ?? null, rsiBand: state.rsiBand ?? null, rsiTrajectory: state.rsiTrajectory ?? null,
        bollinger: state.bollinger ?? null, dmi: state.dmi ?? null, adx: state.adx ?? null,
        structuralTrend: state.structuralTrend ?? null, shortHorizonDirection: state.shortHorizonDirection ?? null,
        candidateAt: state.candidateAt ?? null, revalidationAt: state.revalidationAt ?? null, submitAt: state.submitAt ?? null, expiryAt: state.expiryAt ?? null,
        executingDecision: state.executingDecision ?? "WAIT", shadowDecision: state.shadowDecision ?? "WAIT",
        shadowStrategyId: assignment.strategy === STRICT_V2_ID ? PULLBACK_V2_ID : STRICT_V2_ID,
        accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: state.effectiveStake ?? null,
        orderId: state.orderId ?? null, executionId: state.executionId ?? null,
        position: state.position ?? null, lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null,
      };
    });
    const summarize = (strategy) => {
      const group = agents.filter((agent) => agent.strategy === strategy);
      return {
        total: group.length,
        normal: group.filter((agent) => agent.marketType === "NORMAL").length,
        otc: group.filter((agent) => agent.marketType === "OTC").length,
        eligible: group.filter((agent) => agent.eligible === true).length,
        blocked: group.filter((agent) => agent.blocked === true).length,
        waiting: group.filter((agent) => agent.waitReason && agent.waitReason !== "SEM_AVALIACAO").length,
        signals: group.filter((agent) => agent.decision === "BUY" || agent.decision === "SELL").length,
        open: group.filter((agent) => agent.position?.status === "OPEN").length,
        settled: group.filter((agent) => agent.lastResult).length,
        wins: group.filter((agent) => agent.lastResult === "WIN").length,
        losses: group.filter((agent) => agent.lastResult === "LOSS").length,
      };
    };
    return {
      version: RSI_AGENTS_V2_VERSION, mode: RSI_AGENTS_V2_POLICY.mode, enabled: this.enabled,
      practiceOnly: true, realTouched: false, stakeBrl: this.stakeBrl, pinned: true, failClosed: true,
      policy: RSI_AGENTS_V2_POLICY, skills: { strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID }, skillsPolicy: RSI_SKILLS_V2_POLICY,
      migration: { ...this.migration },
      universe: { at: this.universe.at, snapshotId: this.universe.snapshotId, total: this.universe.observed.length, eligible: this.universe.eligible.length, byType: this.universe.byType, markets: this.universe.observed.map((row) => ({ marketKey: row.marketKey, marketType: row.marketType, eligible: row.eligible, reason: row.reason, candlesCount: row.candlesCount })) },
      split: { strict: this.#countByStrategy(STRICT_V2_ID), pullback: this.#countByStrategy(PULLBACK_V2_ID), diff: Math.abs(this.#countByStrategy(STRICT_V2_ID) - this.#countByStrategy(PULLBACK_V2_ID)) },
      groups: { strict: summarize(STRICT_V2_ID), pullback: summarize(PULLBACK_V2_ID) },
      assignments: agents.map((agent) => ({ marketKey: agent.marketKey, strategy: agent.strategy, marketType: agent.marketType, availability: agent.availability, eligible: agent.eligible, blocked: agent.blocked, blockReason: agent.blockReason, activeId: this.assignments.get(agent.marketKey)?.activeId ?? null })),
      agents,
      dbStats,
      counters: { ...this.counters },
      rejections: this.rejections.slice(-40),
      legacyV1: { paused: true, reason: "MIGRADO_PARA_V2", module: "rsi-agents-5x5", note: "V1 pausado durante a migracao; historico/assignments/logs/resultados preservados." },
      readyToArm: true, armed: false,
      armInstructions: "ARM PRACTICE no TraceCon (autoExecute) — STRICT V2/PULLBACK V2 executam via requestOrder normal, stake R$10, REAL LOCKED.",
    };
  }
}

export function rsiAgentsV2FreezeManifest() {
  return {
    schema: "rsi-agents-v2-freeze-v1",
    version: RSI_AGENTS_V2_VERSION,
    frozenAtUtc: new Date().toISOString(),
    policy: RSI_AGENTS_V2_POLICY,
    split: { rule: "50/50 balanceado por NORMAL/OTC, diff <= 1, persistido", noSilentSubstitution: true },
    shadow: { rule: "skill atribuida executa; a outra avalia em shadow e nunca envia ordem", persistence: "iq_rsi_shadow_opportunities_v2" },
    execution: { practiceOnly: true, realLocked: true, stakeBrl: RSI_AGENTS_V2_POLICY.stakeBrl, singleBrokerPath: RSI_AGENTS_V2_POLICY.singleBrokerPath, autoInvert: false, sameExpiryRequired: true },
    skills: rsiSkillsV2FreezeManifest(),
    observability: ["candidateAt", "revalidationAt", "submitAt", "expiryAt", "rsi", "rsiTrajectory", "bollinger", "bandPosition", "touch", "outside", "reentry", "rejection", "bandRiding", "bandWidthSlope", "plusDI", "minusDI", "spread", "diSlopes", "adx", "adxSlope", "structuralTrend", "shortHorizonDirection", "executingStrategyDecision", "shadowStrategyDecision", "orderId", "executionId", "effectiveStake", "resultado"],
    noTuning: true,
  };
}
