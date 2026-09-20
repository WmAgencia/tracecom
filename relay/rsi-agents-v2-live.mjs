/**
 * RSI AGENTS V2 LIVE — runner da V2 ORIGINAL (rsi-skills-v2, inalterada) sobre a INFRAESTRUTURA ATUAL.
 * Strategy Core = V2 (decide oportunidade/direcao/confirmacao). Scheduler/timing/observabilidade = atuais.
 *
 * - Fonte do universo: registry de instrumentos (iq_rsi_instruments) controlado pelo MESAS.
 *   Desabilitado => sem novos candidates; candidate vivo => cancel auditavel MARKET_DISABLED_BY_USER.
 * - ACTIVE WATCH preservado (rsi-v3-watch.mjs): 1 avaliacao por candle 5s, dedupe por bucket,
 *   PRIORITY_FINAL_WATCH; nunca depois do cutoff.
 * - BINARY: expiry sincronizado, ultima avaliacao causal, revalidacao CURRENT-STATE antes da ordem.
 * - BLITZ: entra imediatamente quando a confirmacao existir (expiry = entrada + duracao); somente
 *   se o caminho de ordem foi descoberto/suportado (fail-closed BLITZ_ORDER_PATH_UNSUPPORTED).
 * - entrySnapshot IMUTAVEL + evaluations[] compacto + counterEvidenceAtEntry.
 * - Ordem SOMENTE via runtime.submitAgentV2LiveOrder -> requestOrder (Execution Gate unico). PRACTICE, R$10.
 */
import { STRICT_V2_ID, PULLBACK_V2_ID, RSI_SKILLS_V2_POLICY, evaluateIndicatorsV2, updateEpisodeV2, evaluateV2, rsiSkillsV2FreezeManifest } from "./rsi-skills-v2.mjs";
import { computeFiftyFiftySplit } from "./rsi-agents-v2.mjs";
import { classifyOutcomeV3 } from "./rsi-v3.mjs";
import { watchModeFor, createWatchRecord, touchWatchRecord } from "./rsi-v3-watch.mjs";
import { effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";

export const RSI_AGENTS_V2_LIVE_VERSION = "rsi-agents-v2-live-v1";
export const RSI_V2_LIVE_EXECUTION_ALLOWLIST = Object.freeze([`agent-v2:${STRICT_V2_ID}`, `agent-v2:${PULLBACK_V2_ID}`, "agent-v2:RSI_REVERSAL_V2_BLITZ"]);
export const RSI_AGENTS_V2_LIVE_POLICY = Object.freeze({
  version: RSI_AGENTS_V2_LIVE_VERSION,
  mode: "NORMAL_RUNTIME_AGENT",
  strategyCore: "rsi-skills-v2 (ORIGINAL, congelada)",
  strategyVersion: "v2-live",
  practiceOnly: true,
  realLocked: true,
  stakeBrl: 10,
  instruments: ["BINARY"],
  finalWindowMs: 5000,
  minimumSafeMarginMs: 3000,
  turbCutoffMs: 30000,
  // (3) Janela infra: piso da margem de seguranca reduzido 3000->1500ms (ack p95 medido ~0,8s),
  // alargando a janela util de entrada sem permitir ordem depois do cutoff. Nao altera a V2.
  minimumSafeMarginMs: 1500,
  // GATE DE ELEGIBILIDADE DE ENTRADA (infra/execucao; nao altera o core V2 congelado):
  // a ordem so pode sair se o RSI AINDA estiver perto do extremo no momento da entrada
  // (BUY: <= buyMax; SELL: >= sellMin). Bollinger/DMI/ADX continuam sendo a confirmacao V2.
  entryRsiNearExtreme: { buyMax: 35, sellMin: 65 },
  watchPolicy: "ACTIVE_CANDIDATE+PRIORITY_FINAL_WATCH (preservado da V3.1)",
  routing: "RSI_V2_ONLY",
  singleBrokerPath: "runtime.submitAgentV2LiveOrder -> requestOrder",
  firstTenSampleSize: 10,
  noTuning: true,
  failClosed: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const instrumentOf = (row) => String(row?.instrumentType ?? row?.instrument_type ?? "BINARY").toUpperCase();
const V2_CORE = Object.freeze({ strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID });

export class RsiAgentsV2Live {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true, stakeBrl = RSI_AGENTS_V2_LIVE_POLICY.stakeBrl, skills = null } = {}) {
    this.skills = skills ?? { evaluateIndicatorsV2, updateEpisodeV2, evaluateV2 };
    this.pool = pool; this.runtime = runtime; this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.stakeBrl = Number(stakeBrl) > 0 ? Number(stakeBrl) : RSI_AGENTS_V2_LIVE_POLICY.stakeBrl;
    this.instruments = new Map();     // key `${marketKey}|${instrumentType}` -> registry row
    this.assignments = new Map();     // marketKey -> assignment
    this.episodes = new Map();        // watchKey ${marketKey}|${instrumentType} -> episode v4
    this.watch = new Map();           // watchKey -> watch record
    this.opportunities = new Map();   // opportunityId -> record
    this.agents = new Map();          // `${marketKey}|${instrumentType}` -> state
    this.submitted = new Map();
    this.rejections = [];
    this.counters = {
      evaluations: 0, candidates: 0, expired: 0, normalized: 0, waits: {}, rejections: {},
      v4Accepted: 0, ordersAcked: 0, ordersBlocked: 0, binaryAcked: 0, blitzAcked: 0,
      blitzUnsupported: 0, marketDisabledCancels: 0,
      watchStarted: 0, watchCancelled: 0, priorityStarted: 0, finalEvaluations: 0, missedWindows: 0,
    };
    this.migration = { state: "PENDING", startedAt: null, completedAt: null, complete: false, hold: true, reason: "MIGRACAO_V4" };
    this.lastReconcileAt = 0;
    this.statePersist = new Map();   // agentKey -> { signature, at } (coalescing de escrita)
    this.universe = { at: null, enabled: 0, total: 0, byType: { BINARY: 0 }, signature: null };
    this.skillAssignments = new Map();
  }

  /** Registry (MESAS) -> universo executavel. Nunca inventa instrumento. */
  assignUniverse(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    const at = this.now();
    const enabledRows = list.filter((row) => row && row.marketKey && row.enabled === true);
    const current = new Set(list.filter((row) => row && row.marketKey).map((row) => `${row.marketKey}|${instrumentOf(row)}`));
    this.instruments = new Map(list.filter((row) => row && row.marketKey).map((row) => [`${row.marketKey}|${instrumentOf(row)}`, { ...row, instrumentType: instrumentOf(row), durationSeconds: num(row.durationSeconds ?? row.duration_seconds) }]));
    const byType = { BINARY: 0 };
    for (const row of enabledRows) { const key = instrumentOf(row); if (byType[key] !== undefined) byType[key] += 1; }
    this.universe = { at, enabled: enabledRows.length, total: list.length, byType, signature: enabledRows.map((row) => `${row.marketKey}|${instrumentOf(row)}`).join(",") };
    this.universeEmpty = list.length > 0 && enabledRows.length === 0;

    // Cancelamento auditavel de mercados desabilitados (episode vivo).
    for (const [watchKey, episode] of [...this.episodes]) {
      const [marketKey, instrumentType] = watchKey.split("|");
      const row = this.instruments.get(`${marketKey}|${instrumentType}`);
      if (!row || row.enabled !== true) this.#cancelEpisode({ watchKey, marketKey, instrumentType, reason: "MARKET_DISABLED_BY_USER", episode });
    }
    // Assignments (por mercado; o instrumento e resolvido por linha).
    const seen = new Set();
    for (const row of list.filter((entry) => entry && entry.marketKey)) {
      const marketKey = row.marketKey;
      if (seen.has(marketKey)) continue;
      seen.add(marketKey);
      const enabled = row.enabled === true;
      const existing = this.assignments.get(marketKey);
      this.assignments.set(marketKey, {
        marketKey, strategy: STRICT_V2_ID, marketType: row.marketType ?? null, canonical: row.canonical ?? null,
        instrumentTypes: [...new Set(list.filter((entry) => entry.marketKey === marketKey).map(instrumentOf))],
        enabled, availability: row.availability ?? row.status ?? "UNKNOWN", activeId: num(row.activeId ?? row.active_id),
        blocked: !enabled, blockReason: enabled ? null : "MARKET_DISABLED_BY_USER", assignedAt: existing?.assignedAt ?? at,
      });
    }
    if (this.migration.startedAt === null) this.migration.startedAt = at;
    this.#assignSkills();
    const done = seen.size > 0 && (current.size === 0 || [...this.instruments.values()].every((row) => this.assignments.has(row.marketKey)));
    if (done) { this.migration.complete = true; this.migration.hold = false; this.migration.state = "COMPLETE"; this.migration.completedAt = this.migration.completedAt ?? at; }
    else { this.migration.state = "HOLD"; this.migration.reason = "ASSIGNMENTS_PENDING"; }
    return this.universe;
  }

  #watchKey(marketKey, instrumentType) { return `${marketKey}|${instrumentType}`; }

  /** V2 ORIGINAL 50/50 (mesma regra do rsi-agents-v2.computeFiftyFiftySplit). */
  #assignSkills() {
    const enabledRows = [...this.assignments.values()]
      .filter((row) => row.enabled === true)
      .map((row) => ({ marketKey: row.marketKey, marketType: row.marketType ?? (String(row.marketKey).includes(":OTC") ? "OTC" : "NORMAL") }));
    const split = computeFiftyFiftySplit(enabledRows);
    const keyOf = (row) => (typeof row === "string" ? row : (row?.marketKey ?? row?.market_key ?? null));
    this.skillAssignments = new Map();
    for (const row of split.strict) { const key = keyOf(row); if (key) this.skillAssignments.set(key, STRICT_V2_ID); }
    for (const row of split.pullback) { const key = keyOf(row); if (key) this.skillAssignments.set(key, PULLBACK_V2_ID); }
  }

  skillFor(marketKey) { return this.skillAssignments.get(marketKey) ?? STRICT_V2_ID; }

  /** Adapta a decisao da V2 ORIGINAL para o formato de telemetria (sem alterar a regra V2). */
  #coreDecision({ marketKey, indicators, episode }) {
    const skillId = this.skillFor(marketKey);
    const result = this.skills.evaluateV2({ strategy: skillId, indicators, episode });
    const accepted = result?.accepted === true && (result.decision === "BUY" || result.decision === "SELL");
    return {
      accepted, direction: accepted ? result.decision : "WAIT",
      reason: accepted ? `V2_ENTRY_OK:${skillId}:${result.status ?? "OK"}` : (result?.reason ?? result?.status ?? "WAIT"),
      reasonCodes: accepted ? [] : [String(result?.status ?? result?.reason ?? "WAIT")],
      checks: { strategy: skillId, status: result?.status ?? null },
      counterEvidence: [], entryReason: accepted ? [`V2_OK_${skillId}`] : [], cushion: null, hardBlocksChecked: [],
    };
  }

  /**
   * (3) Janela de entrada V2-live: mesma semantica de entryWindow, com piso de margem 1500ms
   * (infra/execucao; cutoff e opens inalterados; nunca apos o cutoff).
   */
  #entryWindowV2Live({ targetExpiryAt, latency = {} } = {}) {
    const expiry = num(targetExpiryAt);
    if (expiry === null) return null;
    const rawMargin = (num(latency.ackP95Ms) ?? 0) + (num(latency.persistP95Ms) ?? 0) + (num(latency.decisionMs) ?? 30) + (num(latency.jitterMs) ?? 300) + (num(latency.bufferMs) ?? 150);
    const margin = Math.max(RSI_AGENTS_V2_LIVE_POLICY.minimumSafeMarginMs, Math.min(3000, Math.round(rawMargin)));
    const cutoff = expiry - RSI_AGENTS_V2_LIVE_POLICY.turbCutoffMs;
    const opens = cutoff - RSI_AGENTS_V2_LIVE_POLICY.finalWindowMs;
    const closes = cutoff - margin;
    return { purchaseCutoffAt: cutoff, entryWindowOpensAt: opens, entryWindowClosesAt: closes, safeMarginMs: margin, windowMs: closes - opens };
  }

  /** Gate de entrada: o RSI precisa estar perto do extremo no instante da ordem (infra). */  #entryRsiEligible({ indicators, direction }) {
    if (direction !== "BUY" && direction !== "SELL") return { ok: false, reason: "SEM_DIRECAO" };
    const rsi = num(indicators?.rsi);
    if (rsi === null) return { ok: false, reason: "RSI_UNAVAILABLE" };
    const gate = RSI_AGENTS_V2_LIVE_POLICY.entryRsiNearExtreme;
    if (direction === "BUY") return rsi <= gate.buyMax ? { ok: true, rsi, reason: "RSI_PERTO_EXTREMO_BUY" } : { ok: false, rsi, reason: "RSI_LONGE_DO_EXTREMO" };
    return rsi >= gate.sellMin ? { ok: true, rsi, reason: "RSI_PERTO_EXTREMO_SELL" } : { ok: false, rsi, reason: "RSI_LONGE_DO_EXTREMO" };
  }

  #cancelEpisode({ watchKey, marketKey, instrumentType, reason, episode }) {
    this.episodes.delete(watchKey);
    const record = this.watch.get(watchKey);
    if (record) { this.watch.delete(watchKey); this.counters.watchCancelled += 1; }
    this.counters.marketDisabledCancels += 1;
    this.log("RSI_AGENT_V4_CANCEL", JSON.stringify({ marketKey, instrumentType, reason }));
    void this.#persistEvent({ marketKey, instrumentType, event: reason === "MARKET_DISABLED_BY_USER" ? "MARKET_DISABLED_BY_USER" : "ACTIVE_WATCH_CANCELLED", decision: episode?.direction ?? null, reason, payload: { candidateAt: episode?.candidateAt ?? null, watch: this.#watchSummary(record) } });
  }

  watchFor(marketKey, instrumentType = "BINARY") { return this.#watchSummary(this.watch.get(this.#watchKey(marketKey, instrumentType)) ?? null); }
  hasActiveCandidate(marketKey, instrumentType = null) {
    if (instrumentType) return this.episodes.has(this.#watchKey(marketKey, String(instrumentType).toUpperCase()));
    return [...this.episodes.keys()].some((key) => key.startsWith(`${marketKey}|`));
  }
  stateFor(marketKey) {
    const states = [...this.agents.values()].filter((row) => row.marketKey === marketKey);
    if (!states.length) return null;
    const state = states.find((row) => row.decision === "BUY" || row.decision === "SELL") ?? states[0];
    const watch = state.watch ?? null;
    const skillId = state.strategy ?? this.skillFor(marketKey);
    return {
      strategyId: skillId, strategyVersion: "v2-live", label: `RSI V2 LIVE ${state.instrumentType ?? ""}`.trim(),
      instrumentType: state.instrumentType ?? null, durationSeconds: state.durationSeconds ?? null,
      decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? null,
      state: state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING",
      lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null, qualityClass: state.qualityClass ?? null,
      candidateAt: state.candidateAt ?? null, candidateRsi: state.candidateRsi ?? null, rsi: state.rsi ?? null,
      entryMode: state.entryMode ?? null, expectedCushion: state.expectedCushion ?? null, cushionClass: state.cushionClass ?? null,
      counterEvidence: state.counterEvidence ?? [], entryReason: state.entryReason ?? [],
      watchMode: watch?.watchMode ?? null, evaluationCount: watch?.evaluationCount ?? null,
      blocked: this.assignments.get(marketKey)?.blocked === true, blockReason: this.assignments.get(marketKey)?.blockReason ?? null,
    };
  }

  #watchSummary(record) {
    if (!record) return null;
    return {
      watchMode: record.mode, candidateAt: record.candidateAt, expiryAt: record.expiryAt,
      evaluationCount: record.evaluationCount, lastEvaluationAt: record.lastEvaluationAt,
      evaluationGapMs: record.evaluationGapMs, maxEvaluationGapMs: record.maxEvaluationGapMs,
      timeToExpiryMs: record.timeToExpiryMs, timeToCutoffMs: record.timeToCutoffMs,
      finalEvaluationAt: record.finalEvaluationAt, finalEvaluationLeadMs: record.finalEvaluationLeadMs,
      revalidationAt: record.revalidationAt, submitAt: record.submitAt, submitLatencyMs: record.submitLatencyMs,
    };
  }

  #watchTouch({ marketKey, instrumentType, at, episode, targetExpiryAt = null, window = null, event = null }) {
    const watchKey = this.#watchKey(marketKey, instrumentType);
    const existing = this.watch.get(watchKey) ?? null;
    if (!episode) {
      if (existing) {
        this.watch.delete(watchKey); this.counters.watchCancelled += 1;
        const summary = this.#watchSummary(existing);
        void this.#persistEvent({ marketKey, instrumentType, event: "ACTIVE_WATCH_CANCELLED", reason: event ?? "CANDIDATE_ENDED", payload: summary });
      }
      return null;
    }
    let record = existing;
    if (record && record.candidateAt !== episode.candidateAt) {
      this.counters.watchCancelled += 1;
      void this.#persistEvent({ marketKey, instrumentType, event: "ACTIVE_WATCH_CANCELLED", reason: "NEW_CANDIDATE", payload: this.#watchSummary(record) });
      record = null;
    }
    const target = num(targetExpiryAt);
    if (!record) {
      record = createWatchRecord({ marketKey, candidateAt: episode.candidateAt, targetExpiryAt: target, at });
      this.watch.set(watchKey, record);
      this.counters.watchStarted += 1;
      void this.#persistEvent({ marketKey, instrumentType, event: "ACTIVE_WATCH_STARTED", decision: episode.direction, reason: episode.candidateReason, payload: { candidateAt: episode.candidateAt, candidateRsi: episode.candidateRsi, expiryAt: target } });
    } else if (target !== null && record.expiryAt !== target) {
      record.expiryAt = target; record.finalReported = false; record.missedFor = null; record.cancelledFor = null; record.priorityStartedAt = null;
    }
    const mode = watchModeFor({ hasCandidate: true, at, window });
    if (mode === "PRIORITY_FINAL_WATCH" && record.priorityStartedAt === null && window) {
      record.priorityStartedAt = at; this.counters.priorityStarted += 1;
      void this.#persistEvent({ marketKey, instrumentType, event: "PRIORITY_FINAL_WATCH_STARTED", decision: episode.direction, payload: { candidateAt: record.candidateAt, expiryAt: record.expiryAt, timeToCutoffMs: window.purchaseCutoffAt - at } });
    }
    if (mode === "PRIORITY_FINAL_WATCH" && record.priorityStartedAt === null) record.priorityStartedAt = at;
    touchWatchRecord(record, { at, mode, timeToExpiryMs: target !== null ? target - at : null, timeToCutoffMs: window ? window.purchaseCutoffAt - at : null });
    return record;
  }

  /** Avaliacao por mercado/instrumento. Binario usa expiry alvo; Blitz usa entrada imediata. */
  async observeMarket({ marketKey, instrumentType = "BINARY", durationSeconds = null, marketType = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled) return null;
    const at = num(now) ?? this.now();
    const type = instrumentOf({ instrumentType });
    const registryKey = this.#watchKey(marketKey, type);
    const registry = this.instruments.get(registryKey) ?? null;
    const assignment = this.assignments.get(marketKey) ?? null;
    const list = Array.isArray(candles) ? candles : [];
    const baseState = { agentId: `${this.skillFor(marketKey)}:${marketKey}:${type}`, marketKey, instrumentType: type, strategy: this.skillFor(marketKey), at, accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: null, orderId: null, executionId: null, decision: "WAIT", waitReason: null, reason: null, candidateAt: null, expiryAt: num(targetExpiryAt), durationSeconds: num(durationSeconds) ?? (type === "BINARY" ? 60 : 60) };

    if (!registry || registry.enabled !== true) {
      const episode = this.episodes.get(registryKey) ?? null;
      if (episode) this.#cancelEpisode({ watchKey: registryKey, marketKey, instrumentType: type, reason: "MARKET_DISABLED_BY_USER", episode });
      const blocked = { ...baseState, waitReason: "MARKET_DISABLED_BY_USER", reason: "instrumento desabilitado no MESAS" };
      this.#setState(blocked); void this.#persistState(blocked); return blocked;
    }

    const indicators = this.skills.evaluateIndicatorsV2({ candles: list, now: at });
    if (indicators.closedCandles < RSI_SKILLS_V2_POLICY.minClosedCandles5s) {
      const waiting = { ...baseState, waitReason: "NO_FEED_INSUFFICIENT_CANDLES", reason: `candles fechados=${indicators.closedCandles}` };
      this.#setState(waiting); void this.#persistState(waiting); return waiting;
    }
    this.counters.evaluations += 1;

    const previousEpisode = this.episodes.get(registryKey) ?? null;
    const update = this.skills.updateEpisodeV2({ episode: previousEpisode, indicators, at });
    const episode = update.episode ?? null;
    if (episode) this.episodes.set(registryKey, episode); else this.episodes.delete(registryKey);
    if (update.event === "CANDIDATE_EXPIRED_AGE") this.counters.expired += 1;
    if (update.event === "CANDIDATE_ENDED_NORMALIZED") this.counters.normalized += 1;

    const isBinary = type === "BINARY";
    const window = isBinary && targetExpiryAt ? this.#entryWindowV2Live({ targetExpiryAt, latency }) : null;
    const watchRecord = this.#watchTouch({ marketKey, instrumentType: type, at, episode, targetExpiryAt, window, event: update.event });
    const decision = this.#coreDecision({ marketKey, indicators, episode });
    const projection = decision.cushion?.projection ?? null;
    const state = {
      ...baseState,
      rsi: num(indicators.rsi), rsiBand: indicators.rsiBand, rsiTrajectory: episode ? (episode.direction === "BUY" ? (indicators.rsi <= (RSI_SKILLS_V2_POLICY.rsiBuyThreshold ?? 30) ? "STILL_EXTREME" : "LEAVING_EXTREME") : (indicators.rsi >= (RSI_SKILLS_V2_POLICY.rsiSellThreshold ?? 70) ? "STILL_EXTREME" : "LEAVING_EXTREME")) : "NEUTRAL",
      candidateAt: episode?.candidateAt ?? null, candidateAgeMs: episode ? at - episode.candidateAt : null,
      candidateRsi: episode?.candidateRsi ?? null, candidatePrice: episode?.candidatePrice ?? null,
      expectedCushion: decision.cushion?.normalized ?? null, cushionClass: decision.cushion?.class ?? null,
      decision: decision.accepted ? decision.direction : "WAIT", entryMode: null,
      counterEvidence: decision.counterEvidence, entryReason: decision.entryReason, checks: decision.checks,
      watch: this.#watchSummary(watchRecord), indicators, projection, episode,
    };
    if (update.event === "CANDIDATE_CREATED" || update.event === "CANDIDATE_FLIPPED") {
      this.counters.candidates += 1;
      void this.#persistEvent({ marketKey, instrumentType: type, event: "CANDIDATE_CREATED", decision: episode.direction, reason: episode.candidateReason, payload: { candidateRsi: episode.candidateRsi, candidatePrice: episode.candidatePrice, instrumentType: type } });
    }
    if (!episode) {
      state.waitReason = update.event === "NO_CANDIDATE" ? "NO_CANDIDATE_RSI_NEUTRO" : update.event;
      state.reason = "RSI neutro: candidate somente nasce em extremo (<=30 / >=70)";
      this.#setState(state); void this.#persistState(state); return state;
    }

    const opportunityId = `rsi-v4-opp:${marketKey}:${type}:${episode.candidateAt}`;
    const opportunity = this.#opportunityRecord({ opportunityId, marketKey, marketType, instrumentType: type, durationSeconds: baseState.durationSeconds, episode, decision, indicators, targetExpiryAt, payout, at, state });
    const previousOpportunity = this.#opportunitiesGet(opportunityId);
    if (previousOpportunity?.payload?.entrySnapshot) opportunity.payload.entrySnapshot = previousOpportunity.payload.entrySnapshot;
    if (Array.isArray(previousOpportunity?.evaluations) && previousOpportunity.evaluations.length) opportunity.evaluations = previousOpportunity.evaluations;
    this.#evaluationsPush(opportunity, { at, price: num(indicators.bollinger?.close), rsi: num(indicators.rsi), position: num(indicators.bollinger?.position), plusDI: num(indicators.dmi?.plusDI), minusDI: num(indicators.dmi?.minusDI), adx: num(indicators.adx?.value), cushion: num(decision.cushion?.normalized), decision: decision.accepted ? decision.direction : "WAIT", reasonCodes: decision.accepted ? [] : decision.reasonCodes });
    void this.#persistOpportunity(opportunity);

    const rsiGate = this.#entryRsiEligible({ indicators, direction: decision.accepted ? decision.direction : null });
    state.entryRsiOk = rsiGate.ok === true; state.entryRsiReason = rsiGate.reason;
    if (isBinary) {
      if (!decision.accepted || rsiGate.ok !== true) {
        state.waitReason = decision.accepted !== true
          ? (decision.counterEvidence.some((row) => row.severity === "HARD") ? `CONTRA_EVIDENCIA_${decision.reason}` : decision.reason)
          : "RSI_LONGE_DO_EXTREMO";
        state.reason = decision.accepted === true
          ? `RSI ${num(indicators.rsi)} fora da zona de extremo no momento da ordem (BUY<=${RSI_AGENTS_V2_LIVE_POLICY.entryRsiNearExtreme.buyMax} / SELL>=${RSI_AGENTS_V2_LIVE_POLICY.entryRsiNearExtreme.sellMin})`
          : decision.reason;
        this.counters.waits[state.waitReason] = (this.counters.waits[state.waitReason] ?? 0) + 1;
        this.#setState(state); void this.#persistState(state); return state;
      }
      if (!window) { state.waitReason = "OBSERVE_ONLY_NO_EXPIRY"; this.#setState(state); void this.#persistState(state); return state; }
      const inNormalWindow = at >= window.entryWindowOpensAt && at <= window.entryWindowClosesAt;
      const lastCandleEnd = num(list[list.length - 1]?.bucketEnd);
      const nextCandleEnd = lastCandleEnd !== null ? lastCandleEnd + 5000 : null;
      const isFinalChance = nextCandleEnd === null ? true : nextCandleEnd >= window.entryWindowClosesAt;
      if (!inNormalWindow || !isFinalChance) {
        state.decision = "WAIT"; state.entryMode = null;
        state.waitReason = at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : at > window.entryWindowClosesAt ? "NO_SAFE_ENTRY_INSIDE_5S_WINDOW" : "OBSERVE_ONLY";
        if (state.waitReason === "OBSERVE_ONLY") state.reason = "aguardando janela final (ultima avaliacao causal)";
        if (state.waitReason === "MISSED_ENTRY_WINDOW" && watchRecord && watchRecord.missedFor !== watchRecord.expiryAt) {
          watchRecord.missedFor = watchRecord.expiryAt; this.counters.missedWindows += 1;
          void this.#persistEvent({ marketKey, instrumentType: type, event: "MISSED_ENTRY_WINDOW", decision: episode.direction, payload: { candidateAt: watchRecord.candidateAt, expiryAt: watchRecord.expiryAt, timeToCutoffMs: window.purchaseCutoffAt - at, evaluationCount: watchRecord.evaluationCount } });
        }
        this.#setState(state); void this.#persistState(state); return state;
      }
      return this.#revalidateAndSubmit({ state, opportunity, opportunityId, episode, indicators, decision, window, marketKey, instrumentType: type, marketType, payout, at, watchRecord, entryMode: "NORMAL_T5", expiryAt: num(targetExpiryAt), durationSeconds: 60 });
    }

    // BLITZ: entra imediatamente quando a confirmacao existir (expiry = entrada + duracao).
    const duration = baseState.durationSeconds;
    if (!decision.accepted) {
      state.waitReason = decision.reason;
      state.reason = decision.reason;
      this.counters.waits[state.waitReason] = (this.counters.waits[state.waitReason] ?? 0) + 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (watchRecord) {
      watchRecord.finalEvaluationAt = at; watchRecord.finalEvaluationLeadMs = 0;
      if (watchRecord.finalReported !== true) {
        watchRecord.finalReported = true; this.counters.finalEvaluations += 1;
        void this.#persistEvent({ marketKey, instrumentType: type, event: "BLITZ_CONFIRMED", decision: episode.direction, payload: { candidateAt: watchRecord.candidateAt, durationSeconds: duration, entryReason: decision.entryReason } });
      }
    }
    return this.#revalidateAndSubmit({ state, opportunity, opportunityId, episode, indicators, decision, window: null, marketKey, instrumentType: type, marketType, payout, at, watchRecord, entryMode: "BLITZ_IMMEDIATE", expiryAt: at + Number(duration) * 1000, durationSeconds: duration });
  }

  /** REVALIDATE (current state) + ENTER. A decisao V4 ja e current-state; aqui so confirmamos a ordem. */
  async #revalidateAndSubmit({ state, opportunity, opportunityId, episode, indicators, decision, window, marketKey, instrumentType, marketType, payout, at, watchRecord, entryMode, expiryAt, durationSeconds }) {
    const recheck = this.#coreDecision({ marketKey, indicators, episode });
    if (recheck.accepted !== true || recheck.direction !== episode.direction) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = `tese morreu na revalidacao: ${recheck.reason}`;
      this.counters.waits.CANCELLED_REVALIDATION = (this.counters.waits.CANCELLED_REVALIDATION ?? 0) + 1;
      void this.#persistEvent({ marketKey, instrumentType, event: "REVALIDATION_CANCELLED", decision: episode.direction, reason: state.reason, payload: { counterEvidence: recheck.counterEvidence, reasonCodes: recheck.reasonCodes } });
      if (watchRecord && watchRecord.cancelledFor !== watchRecord.expiryAt) {
        watchRecord.cancelledFor = watchRecord.expiryAt; this.counters.watchCancelled += 1;
        void this.#persistEvent({ marketKey, instrumentType, event: "ACTIVE_WATCH_CANCELLED", decision: episode.direction, reason: recheck.reason, payload: this.#watchSummary(watchRecord) });
      }
      const cancelRecord = this.#opportunitiesGet(opportunityId);
      if (cancelRecord) { cancelRecord.revalidation_at = at; cancelRecord.payload = { ...(cancelRecord.payload ?? {}), cancelReason: state.reason }; this.#opportunitiesSet(opportunityId, cancelRecord); void this.#persistOpportunity(cancelRecord); }
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (this.migration.complete !== true) {
      state.decision = "WAIT"; state.waitReason = "MIGRATION_IN_PROGRESS"; state.reason = "migracao V4 em andamento: nenhuma ordem";
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (watchRecord) { watchRecord.revalidationAt = at; watchRecord.finalEvaluationAt = watchRecord.finalEvaluationAt ?? at; watchRecord.finalEvaluationLeadMs = watchRecord.finalEvaluationLeadMs ?? 0; }
    if (entryMode === "NORMAL_T5" && watchRecord && watchRecord.finalReported !== true) {
      watchRecord.finalReported = true;
      watchRecord.finalEvaluationAt = at;
      watchRecord.finalEvaluationLeadMs = window ? window.entryWindowClosesAt - at : 0;
      this.counters.finalEvaluations += 1;
      void this.#persistEvent({ marketKey, instrumentType, event: "FINAL_EVALUATION", decision: episode.direction, payload: { candidateAt: watchRecord.candidateAt, expiryAt: watchRecord.expiryAt, leadMs: watchRecord.finalEvaluationLeadMs, cutoffLeadMs: window ? window.purchaseCutoffAt - at : null, evaluationCount: watchRecord.evaluationCount, maxEvaluationGapMs: watchRecord.maxEvaluationGapMs } });
    }
    state.entryMode = entryMode;
    const skillId = recheck.checks?.strategy ?? this.skillFor(marketKey);
    const idempotencyKey = `rsi-agent-v2live:${skillId}:${marketKey}:${instrumentType}:${expiryAt}:${recheck.direction}:${entryMode}`;
    if (this.submitted.has(idempotencyKey)) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    const assignmentNow = this.assignments.get(marketKey);
    const precheck = {
      strategyMatches: true,
      assignmentEnabled: assignmentNow?.enabled === true && assignmentNow?.blocked !== true,
      practiceOnly: true,
      stakeMatches: this.stakeBrl === RSI_AGENTS_V2_LIVE_POLICY.stakeBrl,
      candidateFresh: at - episode.candidateAt <= (RSI_SKILLS_V2_POLICY.episodeMaxAgeMs ?? 480000),
      projectionPresent: true,
      noHardCounterEvidence: recheck.counterEvidence.every((row) => row.severity !== "HARD"),
      cushionNotFragile: true,
      rsiNearExtremeAtSubmit: this.#entryRsiEligible({ indicators, direction: recheck.direction }).ok === true,
    };
    const precheckFailed = Object.entries(precheck).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (precheckFailed.length) {
      state.decision = "WAIT"; state.waitReason = `FAIL_CLOSED_${precheckFailed.join("_")}`; state.reason = "pre-checks de execucao falharam";
      this.counters.ordersBlocked += 1;
      this.rejections.push({ marketKey, instrumentType, strategy: STRICT_V2_ID, reason: state.waitReason, at });
      this.#setState(state); void this.#persistState(state); return state;
    }
    try {
      const order = await this.runtime.submitAgentV2LiveOrder({
        marketKey, direction: recheck.direction, strategyId: skillId, skill: skillId, stake: this.stakeBrl, expectedStake: RSI_AGENTS_V2_LIVE_POLICY.stakeBrl,
        idempotencyKey, decisionId: state.agentId, candidateAt: episode.candidateAt, expiryAt, instrumentType, durationSeconds,
        entryMode, projection: recheck.cushion?.projection ?? null, counterEvidence: recheck.counterEvidence,
      });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      state.submitAt = this.now();
      state.orderId = order?.brokerOrderId !== null && order?.brokerOrderId !== undefined ? String(order.brokerOrderId) : null;
      state.executionId = order?.executionId !== null && order?.executionId !== undefined ? String(order.executionId) : null;
      state.requestedStake = num(order?.stakeRequested) ?? this.stakeBrl;
      state.effectiveStake = num(order?.stake) ?? null;
      if (watchRecord) { watchRecord.submitAt = state.submitAt; watchRecord.submitLatencyMs = state.submitAt - (watchRecord.finalEvaluationAt ?? at); }
      if (accepted) {
        this.submitted.set(idempotencyKey, { at: state.submitAt, marketKey, instrumentType });
        this.counters.ordersAcked += 1; this.counters.v4Accepted += 1;
        if (instrumentType === "BINARY") this.counters.blitzAcked += 1; else this.counters.binaryAcked += 1;
        state.reason = `ordem aceita PRACTICE (${instrumentType}/${entryMode}) execution=${state.executionId ?? "-"} stake=${state.effectiveStake ?? "-"}`;
        state.position = { status: "OPEN", instrumentType, durationSeconds, orderId: state.orderId, executionId: state.executionId, requestedStake: state.requestedStake, effectiveStake: state.effectiveStake, entryMode };
        const entrySnapshot = {
          payload: opportunity.payload, indicators: opportunity.indicators, bollinger: opportunity.bollinger, band: opportunity.band,
          dmi: opportunity.dmi, adx: opportunity.adx, rsi: opportunity.rsi, expected_cushion: opportunity.expected_cushion,
          counterEvidenceAtEntry: recheck.counterEvidence, entryReason: recheck.entryReason, hardBlocksChecked: recheck.hardBlocksChecked,
          direction: recheck.direction, instrumentType, durationSeconds, entryMode, watch: this.#watchSummary(watchRecord), safeCutoff: window?.purchaseCutoffAt ?? null,
        };
        this.#opportunitiesSet(opportunityId, {
          ...opportunity, accepted: true, v3_decision: recheck.direction, entry_mode: entryMode,
          order_id: state.orderId, execution_id: state.executionId, effective_stake: state.effectiveStake,
          entry_price: num(indicators?.bollinger?.close) ?? opportunity.entry_price, entry_noise: num(indicators?.noiseHorizon) ?? opportunity.entry_noise,
          direction: recheck.direction, decision: recheck.direction, revalidation_at: at, submit_at: state.submitAt,
          counter_evidence: recheck.counterEvidence, entry_reason: recheck.entryReason, hard_blocks_checked: recheck.hardBlocksChecked,
          payload: { ...(opportunity.payload ?? {}), entrySnapshot },
        });
        void this.#persistOpportunity(this.#opportunitiesGet(opportunityId));
        void this.#persistEvent({ marketKey, instrumentType, event: "ORDER_SUBMITTED", decision: recheck.direction, reason: entryMode, payload: { orderId: state.orderId, executionId: state.executionId, instrumentType, durationSeconds, expiryAt } });
      } else {
        state.decision = "WAIT"; state.waitReason = `ORDER_${order?.disposition ?? order?.state ?? "BLOCKED"}`;
        state.reason = String(order?.reason ?? order?.state ?? "bloqueado").slice(0, 160);
        this.counters.ordersBlocked += 1;
        this.rejections.push({ marketKey, instrumentType, strategy: STRICT_V2_ID, reason: state.waitReason, at, orderId: state.orderId, executionId: state.executionId });
        void this.#persistEvent({ marketKey, instrumentType, event: "ORDER_BLOCKED", decision: recheck.direction, reason: state.reason, payload: { orderId: state.orderId, executionId: state.executionId } });
      }
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.decision = "WAIT"; state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.counters.ordersBlocked += 1;
      if (code === "BLITZ_ORDER_PATH_UNSUPPORTED") { this.counters.blitzUnsupported += 1; void this.#persistEvent({ marketKey, instrumentType, event: "BLITZ_ORDER_PATH_UNSUPPORTED", decision: episode.direction, reason: state.reason }); }
      else void this.#persistEvent({ marketKey, instrumentType, event: "ORDER_BLOCKED", decision: episode.direction, reason: state.reason, payload: { code } });
      this.rejections.push({ marketKey, instrumentType, strategy: STRICT_V2_ID, reason: code, message: state.reason, at });
    }
    state.watch = this.#watchSummary(watchRecord);
    this.#setState(state); void this.#persistState(state);
    return state;
  }

  #evaluationsPush(record, row) {
    const list = Array.isArray(record.evaluations) ? record.evaluations : [];
    list.push({ at: row.at, price: row.price, rsi: row.rsi, position: row.position, plusDI: row.plusDI, minusDI: row.minusDI, adx: row.adx, cushion: row.cushion, decision: row.decision, reasonCodes: row.reasonCodes });
    if (list.length > 120) list.splice(0, list.length - 120);
    record.evaluations = list;
  }

  #opportunityRecord({ opportunityId, marketKey, marketType, instrumentType, durationSeconds, episode, decision, indicators, targetExpiryAt, payout, at, state }) {
    return {
      opportunity_id: opportunityId, market_key: marketKey, market_type: marketType, instrument_type: instrumentType, duration_seconds: durationSeconds,
      agent_id: `${STRICT_V2_ID}:${marketKey}:${instrumentType}`, strategy_id: STRICT_V2_ID, strategy_version: "v2-live",
      observed_at: episode.candidateAt, candidate_at: episode.candidateAt, candidate_age_ms: at - episode.candidateAt,
      candidate_rsi: episode.candidateRsi, candidate_price: episode.candidatePrice,
      direction: decision.direction !== "WAIT" ? decision.direction : episode.direction,
      entry_mode: null, decision: decision.accepted ? decision.direction : "WAIT", accepted: false, rsi: num(indicators.rsi),
      rsi_trajectory: episode.direction === "BUY" ? (num(indicators.rsi) <= 30 ? "STILL_EXTREME" : "LEAVING_EXTREME") : (num(indicators.rsi) >= 70 ? "STILL_EXTREME" : "LEAVING_EXTREME"),
      bollinger: indicators.bollinger, band: { position: indicators.bollinger?.position ?? null, touchUpper: indicators.bollinger?.touchUpper ?? null, touchLower: indicators.bollinger?.touchLower ?? null, outsideUpper: indicators.bollinger?.outsideUpper ?? null, outsideLower: indicators.bollinger?.outsideLower ?? null, width: indicators.bollinger?.width ?? null, widthSlope: indicators.bollinger?.widthSlope ?? null, expanding: indicators.bollinger?.expanding ?? null, rejectionUpperNow: indicators.rejectionUpperNow, rejectionLowerNow: indicators.rejectionLowerNow },
      dmi: indicators.dmi, adx: indicators.adx, structural_trend: indicators.structuralTrend, short_horizon_direction: indicators.shortHorizonDirection,
      projection: decision.cushion?.projection ?? null, expected_cushion: decision.cushion?.normalized ?? null, cushion_class: decision.cushion?.class ?? null,
      v3_decision: decision.accepted ? decision.direction : "WAIT", order_id: null, execution_id: null, effective_stake: null,
      entry_price: num(indicators.bollinger?.close), entry_noise: num(indicators.noiseHorizon), expiry_at: num(targetExpiryAt), result: null, profit: null,
      actual_displacement: null, actual_cushion: null, quality_class: null, settlement_basis: null,
      counter_evidence: decision.counterEvidence, entry_reason: decision.entryReason, hard_blocks_checked: decision.hardBlocksChecked,
      evaluations: [], revalidation_at: null, submit_at: null,
      indicators: { ...indicators, targetExpiryAt: num(targetExpiryAt) },
      payload: { payout: num(payout), checks: decision.checks, reasonCodes: decision.reasonCodes, v4: rsiSkillsV2FreezeManifest().workflow },
    };
  }

  #opportunitiesGet(id) { return this.opportunities.get(id) ?? null; }
  #opportunitiesSet(id, record) { this.opportunities.set(id, record); if (this.opportunities.size > 800) this.opportunities.delete(this.opportunities.keys().next().value); return record; }
  #setState(state) { this.agents = this.agents ?? new Map(); this.agents.set(`${state.marketKey}|${state.instrumentType}`, state); }

  async #persistOpportunity(record) {
    if (!this.pool?.query || !record) return;
    this.#opportunitiesSet(record.opportunity_id, record);
    await this.pool.query(
      `INSERT INTO iq_rsi_opportunities_v2live(opportunity_id, market_key, market_type, instrument_type, duration_seconds, agent_id, strategy_id, strategy_version, observed_at, candidate_at, candidate_age_ms, candidate_rsi, candidate_price, direction, entry_mode, decision, accepted, rsi, rsi_trajectory, bollinger, band, dmi, adx, structural_trend, short_horizon_direction, projection, expected_cushion, cushion_class, order_id, execution_id, effective_stake, entry_price, entry_noise, expiry_at, result, profit, actual_displacement, actual_cushion, quality_class, settlement_basis, counter_evidence, entry_reason, hard_blocks_checked, evaluations, indicators, payload, revalidation_at, submit_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41::jsonb,$42::jsonb,$43::jsonb,$44::jsonb,$45::jsonb,$46::jsonb,$47,$48, now())
       ON CONFLICT(opportunity_id) DO UPDATE SET candidate_age_ms=$11, direction=$14, entry_mode=COALESCE($15, iq_rsi_opportunities_v2live.entry_mode), decision=$16, accepted=$17, rsi=$18, rsi_trajectory=$19, bollinger=$20::jsonb, band=$21::jsonb, dmi=$22::jsonb, adx=$23::jsonb, structural_trend=$24, short_horizon_direction=$25, projection=$26::jsonb, expected_cushion=$27, cushion_class=$28, order_id=COALESCE($29, iq_rsi_opportunities_v2live.order_id), execution_id=COALESCE($30, iq_rsi_opportunities_v2live.execution_id), effective_stake=COALESCE($31, iq_rsi_opportunities_v2live.effective_stake), entry_price=COALESCE($32, iq_rsi_opportunities_v2live.entry_price), entry_noise=COALESCE($33, iq_rsi_opportunities_v2live.entry_noise), result=COALESCE($35, iq_rsi_opportunities_v2live.result), profit=COALESCE($36, iq_rsi_opportunities_v2live.profit), actual_displacement=COALESCE($37, iq_rsi_opportunities_v2live.actual_displacement), actual_cushion=COALESCE($38, iq_rsi_opportunities_v2live.actual_cushion), quality_class=COALESCE($39, iq_rsi_opportunities_v2live.quality_class), settlement_basis=COALESCE($40, iq_rsi_opportunities_v2live.settlement_basis), counter_evidence=$41::jsonb, entry_reason=$42::jsonb, hard_blocks_checked=$43::jsonb, evaluations=$44::jsonb, indicators=$45::jsonb, payload=$46::jsonb, revalidation_at=COALESCE($47, iq_rsi_opportunities_v2live.revalidation_at), submit_at=COALESCE($48, iq_rsi_opportunities_v2live.submit_at), updated_at=now()`,
      [record.opportunity_id, record.market_key, record.market_type, record.instrument_type, record.duration_seconds, record.agent_id, record.strategy_id, record.strategy_version, record.observed_at, record.candidate_at, record.candidate_age_ms, record.candidate_rsi, record.candidate_price, record.direction, record.entry_mode, record.decision, record.accepted, record.rsi, record.rsi_trajectory, JSON.stringify(record.bollinger), JSON.stringify(record.band), JSON.stringify(record.dmi), JSON.stringify(record.adx), record.structural_trend, record.short_horizon_direction, JSON.stringify(record.projection), record.expected_cushion, record.cushion_class, record.order_id, record.execution_id, record.effective_stake, record.entry_price, record.entry_noise, record.expiry_at, record.result, record.profit, record.actual_displacement, record.actual_cushion, record.quality_class, record.settlement_basis, JSON.stringify(record.counter_evidence ?? []), JSON.stringify(record.entry_reason ?? []), JSON.stringify(record.hard_blocks_checked ?? []), JSON.stringify(record.evaluations ?? []), JSON.stringify(record.indicators ?? {}), JSON.stringify(record.payload ?? {}), record.revalidation_at ?? null, record.submit_at ?? null],
    ).catch(() => undefined);
  }

  async #persistState(state) {
    if (!this.pool?.query || !state?.marketKey) return;
    // Coalescing de escrita: so grava quando o estado muda (ou a cada 60s para freshness).
    // O estado em memoria continua por avaliacao; o banco guarda o ultimo estado relevante.
    const writeKey = state.agentId ?? `${state.marketKey}|${state.instrumentType}`;
    const signature = `${state.decision}|${state.waitReason ?? ""}|${state.candidateAt ?? ""}|${state.rsiBand ?? ""}|${state.entryMode ?? ""}|${state.lastResult ?? ""}`;
    const previousWrite = this.statePersist.get(writeKey);
    const atMs = num(state.at) ?? this.now();
    const changed = !previousWrite || previousWrite.signature !== signature;
    const stale = !previousWrite || atMs - previousWrite.at >= 60_000;
    if (!changed && !stale) return;
    this.statePersist.set(writeKey, { signature, at: atMs });
    const watch = state.watch ?? null;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state_v2live(agent_id, market_key, instrument_type, duration_seconds, strategy, status, decision, wait_reason, candidate_at, candidate_age_ms, candidate_rsi, candidate_price, revalidation_at, submit_at, expiry_at, entry_mode, rsi, rsi_trajectory, rsi_band, bollinger, band, dmi, adx, expected_cushion, cushion_class, counter_evidence, entry_reason, order_id, execution_id, requested_stake, effective_stake, last_result, last_pnl, quality_class, last_reason, payload, watch_mode, watch_started_at, priority_started_at, evaluation_count, last_evaluation_at, evaluation_gap_ms, max_evaluation_gap_ms, time_to_expiry_ms, time_to_cutoff_ms, final_evaluation_at, final_evaluation_lead_ms, submit_latency_ms, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,$26::jsonb,$27::jsonb,$28,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$6, decision=$7, wait_reason=$8, candidate_at=$9, candidate_age_ms=$10, candidate_rsi=$11, candidate_price=$12, revalidation_at=COALESCE($13, iq_rsi_agent_state_v2live.revalidation_at), submit_at=COALESCE($14, iq_rsi_agent_state_v2live.submit_at), expiry_at=$15, entry_mode=COALESCE($16, iq_rsi_agent_state_v2live.entry_mode), rsi=$17, rsi_trajectory=$18, rsi_band=$19, bollinger=$20::jsonb, band=$21::jsonb, dmi=$22::jsonb, adx=$23::jsonb, expected_cushion=$24, cushion_class=$25, counter_evidence=$26::jsonb, entry_reason=$27::jsonb, order_id=COALESCE($28, iq_rsi_agent_state_v2live.order_id), execution_id=COALESCE($29, iq_rsi_agent_state_v2live.execution_id), requested_stake=$30, effective_stake=COALESCE($31, iq_rsi_agent_state_v2live.effective_stake), last_result=COALESCE($32, iq_rsi_agent_state_v2live.last_result), last_pnl=COALESCE($33, iq_rsi_agent_state_v2live.last_pnl), quality_class=COALESCE($34, iq_rsi_agent_state_v2live.quality_class), last_reason=$35, payload=$36::jsonb, watch_mode=$37, watch_started_at=$38, priority_started_at=$39, evaluation_count=$40, last_evaluation_at=$41, evaluation_gap_ms=$42, max_evaluation_gap_ms=$43, time_to_expiry_ms=$44, time_to_cutoff_ms=$45, final_evaluation_at=$46, final_evaluation_lead_ms=$47, submit_latency_ms=$48, updated_at=now()`,
      [state.agentId, state.marketKey, state.instrumentType, state.durationSeconds, STRICT_V2_ID, state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING", state.decision, state.waitReason, state.candidateAt, state.candidateAgeMs, state.candidateRsi, state.candidatePrice, state.revalidationAt, state.submitAt, state.expiryAt, state.entryMode, state.rsi, state.rsiTrajectory, state.rsiBand, JSON.stringify(state.indicators?.bollinger ?? null), JSON.stringify({ position: state.indicators?.bollinger?.position ?? null, touchUpper: state.indicators?.bollinger?.touchUpper ?? null, touchLower: state.indicators?.bollinger?.touchLower ?? null, outsideUpper: state.indicators?.bollinger?.outsideUpper ?? null, outsideLower: state.indicators?.bollinger?.outsideLower ?? null, rejectionUpperNow: state.indicators?.rejectionUpperNow ?? null, rejectionLowerNow: state.indicators?.rejectionLowerNow ?? null }), JSON.stringify(state.indicators?.dmi ?? null), JSON.stringify(state.indicators?.adx ?? null), state.expectedCushion, state.cushionClass, JSON.stringify(state.counterEvidence ?? []), JSON.stringify(state.entryReason ?? []), state.orderId, state.executionId, state.requestedStake ?? this.stakeBrl, state.effectiveStake, state.lastResult ?? null, state.lastPnl ?? null, state.qualityClass ?? null, state.reason, JSON.stringify({ checks: state.checks ?? null, projection: state.projection ?? null, episode: state.episode ?? null, policy: RSI_AGENTS_V2_LIVE_POLICY, watch }), watch?.watchMode ?? null, watch?.watchStartedAt ? new Date(watch.watchStartedAt).toISOString() : null, watch?.priorityStartedAt ? new Date(watch.priorityStartedAt).toISOString() : null, watch?.evaluationCount ?? null, watch?.lastEvaluationAt ? new Date(watch.lastEvaluationAt).toISOString() : null, watch?.evaluationGapMs ?? null, watch?.maxEvaluationGapMs ?? null, watch?.timeToExpiryMs ?? null, watch?.timeToCutoffMs ?? null, watch?.finalEvaluationAt ? new Date(watch.finalEvaluationAt).toISOString() : null, watch?.finalEvaluationLeadMs ?? null, watch?.submitLatencyMs ?? null],
    ).catch(() => undefined);
  }

  async #persistEvent({ marketKey, instrumentType = null, event, decision = null, reason = null, payload = {} }) {
    if (!this.pool?.query) return;
    await this.pool.query(
      "INSERT INTO iq_rsi_events_v2live(market_key, instrument_type, agent_id, strategy_id, event, decision, reason, payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [marketKey, instrumentType, `${STRICT_V2_ID}:${marketKey}`, STRICT_V2_ID, event, decision, reason, JSON.stringify(payload)],
    ).catch(() => undefined);
  }

  async #persistUniverseSnapshot() {
    if (!this.pool?.query) return;
    const rows = [...this.instruments.values()];
    if (!rows.length) return;
    const snapshotId = `rsi-universe-v4:${this.universe.at}:${rows.length}`;
    for (const row of rows) {
      await this.pool.query(
        `INSERT INTO iq_rsi_universe_v2live(snapshot_id, market_key, instrument_type, at, market_type, canonical, active_id, enabled, availability, payout, duration_seconds, payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT(snapshot_id, market_key, instrument_type) DO NOTHING`,
        [snapshotId, row.marketKey, instrumentOf(row), this.universe.at, row.marketType ?? null, row.canonical ?? null, num(row.activeId ?? row.active_id), row.enabled === true, row.availability ?? row.status ?? null, num(row.payout), num(row.durationSeconds ?? row.duration_seconds), JSON.stringify({ policy: RSI_AGENTS_V2_LIVE_POLICY })],
      ).catch(() => undefined);
    }
  }

  /** Settlement do broker: classifica, atualiza oportunidade e alimenta o pacote first-10. */
  async recordSettlement({ marketKey, instrumentType = "BINARY", result = null, profit = null, entryPrice = null, expiryPrice = null, payout = null } = {}) {
    let state = null;
    for (const [key, value] of this.agents ?? []) { if (value.marketKey === marketKey && value.instrumentType === instrumentType) { state = value; break; } }
    if (!state) return null;
    state.lastResult = result; state.lastPnl = num(profit); state.entryPrice = num(entryPrice); state.expiryPrice = num(expiryPrice);
    state.position = { status: "SETTLED", instrumentType, result, profit: num(profit), orderId: state.orderId ?? null, executionId: state.executionId ?? null, entryMode: state.entryMode ?? null };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    void this.#persistState(state);
    const record = [...this.opportunities.values()].filter((row) => row.market_key === marketKey && row.instrument_type === instrumentType && row.result === null && row.order_id).sort((a, b) => (b.submit_at ?? 0) - (a.submit_at ?? 0))[0] ?? null;
    if (record) {
      const classification = this.skills.classifyOutcomeV3({ result, entryPrice: num(entryPrice) ?? record.entry_price, expiryPrice: num(expiryPrice), direction: record.direction, noiseHorizon: num(record.entry_noise) });
      record.result = result; record.profit = num(profit); record.expiry_price = num(expiryPrice);
      record.actual_displacement = classification.actualDisplacement; record.actual_cushion = classification.actualCushion;
      record.quality_class = classification.qualityClass; record.settlement_basis = "BROKER_EXECUTED_V2_LIVE";
      this.#opportunitiesSet(record.opportunity_id, record);
      if (this.pool?.query) void this.pool.query("UPDATE iq_rsi_opportunities_v2live SET expiry_price=$2, result=$3, profit=$4, actual_displacement=$5, actual_cushion=$6, quality_class=$7, settlement_basis=$8, updated_at=now() WHERE opportunity_id=$1", [record.opportunity_id, num(expiryPrice), result, num(profit), classification.actualDisplacement, classification.actualCushion, classification.qualityClass, record.settlement_basis]).catch(() => undefined);
      await this.#exportFirstTen({ record, result, profit: num(profit), expiryPrice: num(expiryPrice), payout: num(payout) });
    }
    return state;
  }

  /** Pacote congelado first-10 por (strategyVersion, instrumentType, duration). */
  async #exportFirstTen({ record, result, profit, expiryPrice, payout }) {
    if (!this.pool?.query) return null;
    const duration = record.instrument_type === "BINARY" ? (record.duration_seconds ?? 45) : 60;
    try {
      const count = (await this.pool.query("SELECT count(*)::int AS n FROM iq_v4_export_trades WHERE strategy_version=$1 AND instrument_type=$2 AND duration_seconds=$3", ["v2-live", record.instrument_type, duration])).rows?.[0]?.n ?? 0;
      if (count >= RSI_AGENTS_V2_LIVE_POLICY.firstTenSampleSize) return null;
      const tradeNumber = count + 1;
      const pkg = buildV2LiveTradePackage({ tradeNumber, record, result, profit, expiryPrice, payout });
      await this.pool.query("INSERT INTO iq_v4_export_trades(strategy_version, instrument_type, duration_seconds, trade_number, package, created_at) VALUES($1,$2,$3,$4,$5::jsonb, now()) ON CONFLICT(strategy_version, instrument_type, duration_seconds, trade_number) DO NOTHING", ["v2-live", record.instrument_type, duration, tradeNumber, JSON.stringify(pkg)]);
      const rows = (await this.pool.query("SELECT package FROM iq_v4_export_trades WHERE strategy_version=$1 AND instrument_type=$2 AND duration_seconds=$3 ORDER BY trade_number", ["v2-live", record.instrument_type, duration])).rows ?? [];
      const summary = buildV2LiveSummary({ tradeNumber: tradeNumber, instrumentType: record.instrument_type, durationSeconds: duration, packages: rows.map((row) => row.package) });
      await this.pool.query("INSERT INTO iq_v4_export_summary(strategy_version, instrument_type, duration_seconds, summary, updated_at) VALUES($1,$2,$3,$4::jsonb, now()) ON CONFLICT(strategy_version, instrument_type, duration_seconds) DO UPDATE SET summary=$4::jsonb, updated_at=now()", ["v2-live", record.instrument_type, duration, JSON.stringify(summary)]);
      this.log("RSI_AGENT_V4_EXPORT", JSON.stringify({ instrumentType: record.instrument_type, tradeNumber, settled: tradeNumber }));
      return { tradeNumber, summary };
    } catch (error) {
      this.log("RSI_AGENT_V4_EXPORT_FAIL", String(error?.message ?? error));
      return null;
    }
  }

  /**
   * Eventos persistidos da V4 (read-only, auditoria). Nunca expõe segredos:
   * apenas colunas publicas de iq_rsi_events_v2live.
   */
  async events({ marketKey = null, limit = 100 } = {}) {
    if (!this.pool?.query) return { events: [], total: 0, limit: 0, unavailable: true };
    const bounded = Math.max(1, Math.min(500, Number(limit) || 100));
    const params = [];
    let where = "";
    if (marketKey) { params.push(String(marketKey).slice(0, 40)); where = "WHERE market_key=$1"; }
    params.push(bounded);
    const rows = (await this.pool.query(`SELECT id, at, market_key, instrument_type, agent_id, strategy_id, event, decision, reason, payload FROM iq_rsi_events_v2live ${where} ORDER BY id DESC LIMIT $${params.length}`, params)).rows ?? [];
    return { events: rows.map(mapV4EventRow), total: rows.length, limit: bounded, marketKey: marketKey ?? null };
  }

  /** Funil agregado de eventos persistidos (read-only). */
  async eventsFunnel({ marketKey = null } = {}) {
    if (!this.pool?.query) return { funnel: [], unavailable: true };
    const params = [];
    let where = "";
    if (marketKey) { params.push(String(marketKey).slice(0, 40)); where = "WHERE market_key=$1"; }
    const rows = (await this.pool.query(`SELECT event, count(*)::int AS total, max(at) AS last_at FROM iq_rsi_events_v2live ${where} GROUP BY event ORDER BY total DESC`, params)).rows ?? [];
    return { funnel: rows.map((row) => ({ event: row.event, total: Number(row.total) || 0, lastAt: row.last_at instanceof Date ? row.last_at.toISOString() : (row.last_at ?? null) })) };
  }

  status() {
    const agents = [...(this.agents ?? new Map()).values()];
    return {
      version: RSI_AGENTS_V2_LIVE_VERSION, strategy: STRICT_V2_ID, strategyVersion: "v2-live", mode: "NORMAL_RUNTIME_AGENT",
      enabled: this.enabled, stakeBrl: this.stakeBrl, routing: "RSI_V2_ONLY", practiceOnly: true, realLocked: true,
      migration: { ...this.migration }, universe: this.universe,
      universeEmpty: this.universeEmpty === true,
      blockedReason: this.universeEmpty === true ? "MESAS_ZERO_ENABLED" : null,
      totals: { enabled: this.universe.enabled, blocked: [...this.assignments.values()].filter((row) => row.blocked).length, signals: agents.filter((row) => row.decision === "BUY" || row.decision === "SELL").length, open: agents.filter((row) => row.position?.status === "OPEN").length, settled: agents.filter((row) => row.lastResult).length, wins: agents.filter((row) => row.lastResult === "WIN").length, losses: agents.filter((row) => row.lastResult === "LOSS").length },
      agents, counters: { ...this.counters }, rejections: this.rejections.slice(-40),
      policy: RSI_AGENTS_V2_LIVE_POLICY, freeze: rsiSkillsV2FreezeManifest(),
      readyToArm: true, armed: false,
    };
  }
}

/** Mapeia uma linha de iq_rsi_events_v2live para payload publico (função pura). */
export function mapV4EventRow(row = {}) {
  return {
    id: num(row.id),
    at: row.at instanceof Date ? row.at.toISOString() : (row.at ?? null),
    marketKey: row.market_key ?? null,
    instrumentType: row.instrument_type ?? null,
    agentId: row.agent_id ?? null,
    strategyId: row.strategy_id ?? STRICT_V2_ID,
    event: row.event ?? null,
    decision: row.decision ?? null,
    reason: row.reason ?? null,
    payload: row.payload ?? {},
  };
}

/** Pacote de auditoria da operacao (schema pedido; sem dados sensiveis). */
export function buildV2LiveTradePackage({ tradeNumber, record, result, profit, expiryPrice, payout }) {
  const snap = record.payload?.entrySnapshot ?? null;
  const indicators = snap?.indicators ?? record.indicators ?? {};
  const candidate = record.payload?.candidates ?? { candidateAt: record.candidate_at, candidateRsi: record.candidate_rsi, candidatePrice: record.candidate_price };
  return {
    schema: "tracecon-v4-trade-v1",
    tradeNumber, strategyVersion: "v2-live", strategyId: record.agent_id?.includes(PULLBACK_V2_ID) ? PULLBACK_V2_ID : STRICT_V2_ID,
    market: record.market_key, underlying: String(record.market_key).split(":")[0], instrumentType: record.instrument_type,
    marketType: record.market_type ?? (String(record.market_key).includes(":OTC") ? "OTC" : "NORMAL"),
    direction: record.direction, duration: record.duration_seconds ?? (record.instrument_type === "BINARY" ? 45 : 60),
    payout, stake: 10, accountMode: "PRACTICE",
    timestamps: { candidateAt: record.candidate_at, entryAt: record.submit_at, expiryAt: record.expiry_at },
    candidateToEntryMs: record.submit_at && record.candidate_at ? Number(record.submit_at) - Number(record.candidate_at) : null,
    prices: { candidatePrice: record.candidate_price, entryPrice: record.entry_price, expiryPrice, actualDisplacement: record.actual_displacement },
    candidateSnapshot: { rsi: candidate?.candidateRsi ?? record.candidate_rsi, candidateReason: candidate?.candidateReason ?? null },
    entrySnapshot: {
      rsi: record.rsi, rsiTrajectory: record.rsi_trajectory,
      bollinger: record.bollinger, band: record.band, dmi: record.dmi, adx: record.adx,
      atr: indicators.realizedVolatility ?? null, velocity: indicators.velocity ?? null, acceleration: indicators.acceleration ?? null,
      shortDirection: record.short_horizon_direction, expectedCushion: record.expected_cushion, cushionClass: record.cushion_class,
      counterEvidenceAtEntry: record.counter_evidence ?? [], entryReason: record.entry_reason ?? [], hardBlocksChecked: record.hard_blocks_checked ?? [],
    },
    evaluations: record.evaluations ?? [],
    settlement: { result, profit, expiryPrice, actualCushion: record.actual_cushion, qualityClass: record.quality_class, payout },
    timing: record.instrument_type === "BINARY" ? { requestedDuration: record.duration_seconds ?? 45, actualDuration: record.duration_seconds ?? 45, entryTriggeredExpiry: record.expiry_at } : { safeCutoff: snap?.safeCutoff ?? null, fixedExpiry: record.expiry_at },
    audit: { watch: snap?.watch ?? null, hardBlocksChecked: record.hard_blocks_checked ?? [] },
  };
}

export function buildV2LiveSummary({ tradeNumber = null, instrumentType, durationSeconds, packages = [] } = {}) {
  const rows = Array.isArray(packages) ? packages : [];
  const wins = rows.filter((row) => row.settlement?.result === "WIN").length;
  const losses = rows.filter((row) => row.settlement?.result === "LOSS").length;
  const draws = rows.filter((row) => row.settlement?.result === "DRAW").length;
  const decided = wins + losses;
  const qualityDistribution = {};
  for (const row of rows) { const key = row.settlement?.qualityClass ?? "UNKNOWN"; qualityDistribution[key] = (qualityDistribution[key] ?? 0) + 1; }
  const counterEvidenceDistribution = {};
  for (const row of rows) for (const item of row.entrySnapshot?.counterEvidenceAtEntry ?? []) { counterEvidenceDistribution[item.code] = (counterEvidenceDistribution[item.code] ?? 0) + 1; }
  const avg = (pick) => { const values = rows.map(pick).filter((value) => Number.isFinite(Number(value))); return values.length ? Number((values.reduce((sum, value) => sum + Number(value), 0) / values.length).toFixed(4)) : null; };
  const payouts = rows.map((row) => Number(row.payout)).filter((value) => Number.isFinite(value));
  return {
    schema: "tracecon-v4-summary-v1", strategyVersion: "v2-live", instrumentType, duration: durationSeconds,
    sampleSize: rows.length, completedSample: rows.length >= 10,
    wins, losses, draws, wr: decided ? Number((wins / decided).toFixed(4)) : null,
    averagePayout: payouts.length ? Number((payouts.reduce((sum, value) => sum + value, 0) / payouts.length).toFixed(2)) : null,
    pnl: Number(rows.reduce((sum, row) => sum + (Number(row.settlement?.profit) || 0), 0).toFixed(2)),
    averageCandidateToEntryMs: avg((row) => row.candidateToEntryMs),
    qualityDistribution, averageExpectedCushion: avg((row) => row.entrySnapshot?.expectedCushion), averageActualCushion: avg((row) => row.settlement?.actualCushion),
    lossReasonDistribution: rows.filter((row) => row.settlement?.result === "LOSS").reduce((acc, row) => { const key = row.settlement?.qualityClass ?? "UNKNOWN"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}),
    counterEvidenceDistribution,
    note: "amostra inicial de auditoria (nao e validacao estatistica; sem claim de edge).",
    generatedAtUtc: new Date().toISOString(),
  };
}

export function rsiAgentsV2LiveFreezeManifest() {
  return {
    schema: "rsi-agents-v4-freeze-v1", version: RSI_AGENTS_V2_LIVE_VERSION, policy: RSI_AGENTS_V2_LIVE_POLICY,
    skills: rsiSkillsV2FreezeManifest(),
    execution: { practiceOnly: true, realLocked: true, stakeBrl: 10, routing: "RSI_V2_ONLY", singleBrokerPath: RSI_AGENTS_V2_LIVE_POLICY.singleBrokerPath },
    instruments: ["BINARY", "BINARY"], noTuning: true,
  };
}

export { RSI_SKILLS_V2_POLICY, rsiSkillsV2FreezeManifest };
