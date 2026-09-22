/**
 * RSI AGENTS V2 BLITZ — Strategy Core V2 ORIGINAL (rsi-skills-v2, congelada) + API OFICIAL (MCP).
 *
 * - Universo: TODOS os ativos BLITZ_45S habilitados no MESAS (registry vindo do MCP oficial).
 * - Entrada: imediata na confirmacao da V2 (expiry = entrada + 45s). Sem janela/cutoff de minuto.
 * - Gate de entrada: RSI ainda perto do extremo (BUY<=35 / SELL>=65) no momento da ordem.
 * - Cooldown por ativo: 1 entrada a cada 45s (evita empilhar posicoes no mesmo candle).
 * - Ordem SOMENTE via runtime.submitAgentBlitzOrder (gate unico: PRACTICE/ARM/stake R$10/allowlist).
 * - Telemetria nas tabelas *_v2live com instrument_type='BLITZ_45S'.
 */
import { STRICT_V2_ID, PULLBACK_V2_ID, RSI_SKILLS_V2_POLICY, evaluateIndicatorsV2, updateEpisodeV2, evaluateV2, rsiSkillsV2FreezeManifest } from "./rsi-skills-v2.mjs";
import { computeFiftyFiftySplit } from "./rsi-agents-v2.mjs";

export const RSI_AGENTS_V2_BLITZ_VERSION = "rsi-agents-v2-blitz-v1";
export const RSI_AGENTS_V2_BLITZ_POLICY = Object.freeze({
  version: RSI_AGENTS_V2_BLITZ_VERSION,
  mode: "NORMAL_RUNTIME_AGENT",
  strategyCore: "rsi-skills-v2 (ORIGINAL, congelada)",
  strategyVersion: "v2-live-blitz",
  instrumentType: "BLITZ_45S",
  durationSeconds: 45,
  entryRsiNearExtreme: { buyMax: 35, sellMin: 65 },
  stakeBrl: 10,
  practiceOnly: true,
  realLocked: true,
  routing: "RSI_V2_ONLY",
  cooldownMs: 45_000,
  singleBrokerPath: "runtime.submitAgentBlitzOrder -> IQ MCP place_trade",
  failClosed: true,
  noTuning: true,
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const instrumentOf = (row) => String(row?.instrumentType ?? row?.instrument_type ?? "BLITZ_45S").toUpperCase();

export class RsiAgentsV2Blitz {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true, stakeBrl = RSI_AGENTS_V2_BLITZ_POLICY.stakeBrl, skills = null } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.stakeBrl = Number(stakeBrl) > 0 ? Number(stakeBrl) : RSI_AGENTS_V2_BLITZ_POLICY.stakeBrl;
    this.skills = skills ?? { evaluateIndicatorsV2, updateEpisodeV2, evaluateV2 };
    this.instruments = new Map();
    this.assignments = new Map();
    this.skillAssignments = new Map();
    this.episodes = new Map();
    this.lastEntryAt = new Map();
    this.agents = new Map();
    this.opportunities = new Map();
    this.counters = { evaluations: 0, candidates: 0, accepted: 0, ordersAcked: 0, ordersBlocked: 0, gateBlocks: 0, cooldownBlocks: 0, waits: {}, rejections: {} };
    this.migration = { state: "PENDING", startedAt: null, completedAt: null, complete: false, hold: true, reason: "MIGRACAO_V2_BLITZ" };
    this.universe = { at: null, enabled: 0, total: 0, signature: null };
  }

  assignUniverse(rows = []) {
    const at = this.now();
    const all = Array.isArray(rows) ? rows : [];
    const blitzRows = all.filter((row) => row && row.marketKey && instrumentOf(row) === "BLITZ_45S");
    this.instruments = new Map(blitzRows.map((row) => [`${row.marketKey}|BLITZ_45S`, { ...row, instrumentType: "BLITZ_45S", durationSeconds: 45 }]));
    const enabledRows = blitzRows.filter((row) => row.enabled === true);
    this.universe = { at, enabled: enabledRows.length, total: blitzRows.length, signature: enabledRows.map((row) => row.marketKey).join(",") };
    for (const [watchKey, episode] of [...this.episodes]) {
      const marketKey = watchKey.split("|")[0];
      const row = this.instruments.get(`${marketKey}|BLITZ_45S`);
      if (!row || row.enabled !== true) {
        this.episodes.delete(watchKey);
        void this.#persistEvent({ marketKey, event: "MARKET_DISABLED_BY_USER", decision: episode?.direction ?? null, reason: "instrumento desabilitado no MESAS", payload: {} });
      }
    }
    for (const row of blitzRows) {
      const existing = this.assignments.get(row.marketKey);
      this.assignments.set(row.marketKey, { marketKey: row.marketKey, strategy: STRICT_V2_ID, enabled: row.enabled === true, marketType: row.marketType ?? null, canonical: row.canonical ?? null, availability: row.availability ?? row.status ?? "UNKNOWN", activeId: num(row.activeId ?? row.active_id), blocked: row.enabled !== true, blockReason: row.enabled === true ? null : "MARKET_DISABLED_BY_USER", assignedAt: existing?.assignedAt ?? at });
    }
    const split = computeFiftyFiftySplit(enabledRows.map((row) => ({ marketKey: row.marketKey, marketType: row.marketType ?? "OTC" })));
    this.skillAssignments = new Map();
    for (const row of split.strict) this.skillAssignments.set(row.marketKey, STRICT_V2_ID);
    for (const row of split.pullback) this.skillAssignments.set(row.marketKey, PULLBACK_V2_ID);
    if (this.migration.startedAt === null) this.migration.startedAt = at;
    this.migration.complete = blitzRows.length > 0;
    this.migration.hold = !this.migration.complete;
    this.migration.state = this.migration.complete ? "COMPLETE" : "HOLD";
    this.migration.completedAt = this.migration.completedAt ?? at;
    return this.universe;
  }

  skillFor(marketKey) { return this.skillAssignments.get(marketKey) ?? STRICT_V2_ID; }
  hasActiveCandidate(marketKey) { return this.episodes.has(`${marketKey}|BLITZ_45S`); }
  stateFor(marketKey) {
    const state = [...this.agents.values()].find((row) => row.marketKey === marketKey) ?? null;
    if (!state) return null;
    return { strategyId: RSI_AGENTS_V2_BLITZ_POLICY.strategyVersion, strategyVersion: "v2-live-blitz", instrumentType: "BLITZ_45S", durationSeconds: 45, decision: state.decision ?? "WAIT", waitReason: state.waitReason ?? null, candidateAt: state.candidateAt ?? null, rsi: state.rsi ?? null, entryMode: state.entryMode ?? null, orderId: state.orderId ?? null, lastResult: state.lastResult ?? null, lastPnl: state.lastPnl ?? null };
  }

  #entryRsiEligible({ indicators, direction }) {
    if (direction !== "BUY" && direction !== "SELL") return { ok: false, reason: "SEM_DIRECAO" };
    const rsi = num(indicators?.rsi);
    if (rsi === null) return { ok: false, reason: "RSI_UNAVAILABLE" };
    const gate = RSI_AGENTS_V2_BLITZ_POLICY.entryRsiNearExtreme;
    if (direction === "BUY") return rsi <= gate.buyMax ? { ok: true, rsi } : { ok: false, rsi, reason: "RSI_LONGE_DO_EXTREMO" };
    return rsi >= gate.sellMin ? { ok: true, rsi } : { ok: false, rsi, reason: "RSI_LONGE_DO_EXTREMO" };
  }

  #coreDecision({ marketKey, indicators, episode }) {
    const skillId = this.skillFor(marketKey);
    const result = this.skills.evaluateV2({ strategy: skillId, indicators, episode });
    const accepted = result?.accepted === true && (result.decision === "BUY" || result.decision === "SELL");
    return { accepted, direction: accepted ? result.decision : "WAIT", reason: accepted ? `V2_BLITZ_OK:${skillId}:${result.status ?? "OK"}` : (result?.reason ?? result?.status ?? "WAIT"), status: result?.status ?? null, skillId };
  }

  async observeMarket({ marketKey, instrumentType = "BLITZ_45S", durationSeconds = 45, candles = [], payout = null, now = null } = {}) {
    if (!this.enabled) return null;
    const at = num(now) ?? this.now();
    const list = Array.isArray(candles) ? candles : [];
    const registry = this.instruments.get(`${marketKey}|BLITZ_45S`) ?? null;
    const baseState = { agentId: `blitz:${marketKey}`, marketKey, instrumentType: "BLITZ_45S", strategy: this.skillFor(marketKey), at, accountMode: "PRACTICE", requestedStake: this.stakeBrl, effectiveStake: null, orderId: null, executionId: null, decision: "WAIT", waitReason: null, reason: null, candidateAt: null, durationSeconds: 45, entryMode: null };
    if (!registry || registry.enabled !== true) {
      this.episodes.delete(`${marketKey}|BLITZ_45S`);
      const blocked = { ...baseState, waitReason: "MARKET_DISABLED_BY_USER", reason: "instrumento desabilitado no MESAS" };
      this.#setState(blocked); void this.#persistState(blocked); return blocked;
    }
    const indicators = this.skills.evaluateIndicatorsV2({ candles: list, now: at });
    if (indicators.closedCandles < RSI_SKILLS_V2_POLICY.minClosedCandles5s) {
      const waiting = { ...baseState, waitReason: "NO_FEED_INSUFFICIENT_CANDLES", reason: `candles fechados=${indicators.closedCandles}` };
      this.#setState(waiting); void this.#persistState(waiting); return waiting;
    }
    this.counters.evaluations += 1;
    const watchKey = `${marketKey}|BLITZ_45S`;
    const previousEpisode = this.episodes.get(watchKey) ?? null;
    const update = this.skills.updateEpisodeV2({ episode: previousEpisode, indicators, at });
    const episode = update.episode ?? null;
    if (episode) this.episodes.set(watchKey, episode); else this.episodes.delete(watchKey);
    if (update.event === "CANDIDATE_CREATED" || update.event === "CANDIDATE_FLIPPED") {
      this.counters.candidates += 1;
      void this.#persistEvent({ marketKey, event: "CANDIDATE_CREATED", decision: episode?.direction ?? null, reason: episode?.candidateReason ?? null, payload: { candidateRsi: episode?.candidateRsi ?? null, instrumentType: "BLITZ_45S" } });
    }
    const decision = this.#coreDecision({ marketKey, indicators, episode });
    const gate = this.#entryRsiEligible({ indicators, direction: decision.accepted ? decision.direction : null });
    const state = { ...baseState, rsi: num(indicators.rsi), rsiBand: indicators.rsiBand, candidateAt: episode?.candidateAt ?? null, candidateRsi: episode?.candidateRsi ?? null, decision: decision.accepted ? decision.direction : "WAIT", entryRsiOk: gate.ok === true, v2Status: decision.status };
    if (!episode) {
      state.waitReason = update.event === "NO_CANDIDATE" ? "NO_CANDIDATE_RSI_NEUTRO" : update.event;
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (!decision.accepted) {
      state.waitReason = decision.reason; state.reason = decision.reason;
      this.counters.waits[state.waitReason] = (this.counters.waits[state.waitReason] ?? 0) + 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (gate.ok !== true) {
      state.waitReason = "RSI_LONGE_DO_EXTREMO"; state.reason = `RSI ${num(indicators.rsi)} fora da zona de extremo no momento da ordem`;
      this.counters.gateBlocks += 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    const lastEntry = this.lastEntryAt.get(marketKey) ?? 0;
    if (at - lastEntry < RSI_AGENTS_V2_BLITZ_POLICY.cooldownMs) {
      state.waitReason = "COOLDOWN_45S"; state.reason = "cooldown por ativo apos entrada";
      this.counters.cooldownBlocks += 1;
      this.#setState(state); void this.#persistState(state); return state;
    }
    const recheck = this.#coreDecision({ marketKey, indicators, episode });
    const recheckGate = this.#entryRsiEligible({ indicators, direction: recheck.accepted ? recheck.direction : null });
    if (!recheck.accepted || recheck.direction !== decision.direction || recheckGate.ok !== true) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = `revalidacao V2 bloqueou: ${recheck.reason}`;
      void this.#persistEvent({ marketKey, event: "REVALIDATION_CANCELLED", decision: decision.direction, reason: state.reason, payload: {} });
      this.#setState(state); void this.#persistState(state); return state;
    }
    if (this.migration.complete !== true) {
      state.waitReason = "MIGRATION_IN_PROGRESS"; this.#setState(state); void this.#persistState(state); return state;
    }
    state.entryMode = "BLITZ_IMMEDIATE_45S";
    const expiryAt = at + 45_000;
    const idempotencyKey = `rsi-v2-blitz:${marketKey}:${episode.candidateAt}:${expiryAt}:${recheck.direction}`;
    if (this.lastEntryAt.get(`${marketKey}:key`) === idempotencyKey) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    try {
      const order = await this.runtime.submitAgentBlitzOrder({ marketKey, direction: recheck.direction, stake: this.stakeBrl, expectedStake: RSI_AGENTS_V2_BLITZ_POLICY.stakeBrl, idempotencyKey, entryMode: "BLITZ_IMMEDIATE_45S", decisionId: state.agentId });
      this.lastEntryAt.set(marketKey, at); this.lastEntryAt.set(`${marketKey}:key`, idempotencyKey);
      this.counters.ordersAcked += 1; this.counters.accepted += 1;
      state.orderId = order?.brokerOrderId !== null && order?.brokerOrderId !== undefined ? String(order.brokerOrderId) : null;
      state.executionId = order?.executionId ?? null;
      state.effectiveStake = num(order?.effectiveStake) ?? this.stakeBrl;
      state.reason = `ordem BLITZ aceita PRACTICE (45s) position=${state.orderId ?? "-"} stake=${state.effectiveStake}`;
      state.position = { status: "OPEN", instrumentType: "BLITZ_45S", durationSeconds: 45, orderId: state.orderId, executionId: state.executionId, entryMode: "BLITZ_IMMEDIATE_45S" };
      void this.#persistOpportunity({
        opportunity_id: `rsi-v2-blitz-opp:${marketKey}:${episode.candidateAt}:${expiryAt}`, market_key: marketKey, market_type: registry.marketType ?? "OTC",
        instrument_type: "BLITZ_45S", duration_seconds: 45, agent_id: `blitz:${marketKey}`, strategy_id: recheck.skillId, strategy_version: "v2-live-blitz",
        observed_at: episode.candidateAt, candidate_at: episode.candidateAt, candidate_age_ms: at - episode.candidateAt, candidate_rsi: episode.candidateRsi, candidate_price: episode.candidatePrice,
        direction: recheck.direction, entry_mode: "BLITZ_IMMEDIATE_45S", decision: recheck.direction, accepted: true,
        rsi: num(indicators.rsi), rsi_trajectory: null, bollinger: indicators.bollinger, band: indicators.band ?? null, dmi: indicators.dmi, adx: indicators.adx,
        structural_trend: indicators.structuralTrend, short_horizon_direction: indicators.shortHorizonDirection, projection: null, expected_cushion: null, cushion_class: null,
        order_id: state.orderId, execution_id: state.executionId, effective_stake: state.effectiveStake, entry_price: num(indicators.bollinger?.close), entry_noise: num(indicators.noiseHorizon),
        expiry_at: expiryAt, result: null, profit: null, actual_displacement: null, actual_cushion: null, quality_class: null, settlement_basis: null,
        counter_evidence: [], entry_reason: [`V2_BLITZ_OK:${recheck.skillId}:${recheck.status ?? "OK"}`, "RSI_PERTO_EXTREMO", "DURACAO_45S"], hard_blocks_checked: [], evaluations: [], indicators: { ...indicators }, payload: { payout: num(payout), source: "IQ_MCP_BLITZ", status: recheck.status }, revalidation_at: at, submit_at: at,
      });
      void this.#persistEvent({ marketKey, event: "ORDER_SUBMITTED", decision: recheck.direction, reason: "BLITZ_IMMEDIATE_45S", payload: { positionId: state.orderId, durationSeconds: 45 } });
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.decision = "WAIT"; state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.counters.ordersBlocked += 1;
      this.counters.rejections[code] = (this.counters.rejections[code] ?? 0) + 1;
      void this.#persistEvent({ marketKey, event: "ORDER_BLOCKED", decision: recheck.direction, reason: state.reason, payload: { code } });
    }
    this.#setState(state); void this.#persistState(state);
    return state;
  }

  recordSettlement({ marketKey, result = null, profit = null } = {}) {
    const state = [...this.agents.values()].find((row) => row.marketKey === marketKey) ?? null;
    if (!state) return null;
    state.lastResult = result; state.lastPnl = num(profit); state.position = { ...(state.position ?? {}), status: "SETTLED", result, profit: num(profit) };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    void this.#persistState(state);
    return state;
  }

  #setState(state) { this.agents.set(`${state.marketKey}|BLITZ_45S`, state); }

  async #persistState(state) {
    if (!this.pool?.query || !state?.marketKey) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state_v2live(agent_id, market_key, instrument_type, duration_seconds, strategy, status, decision, wait_reason, candidate_at, candidate_age_ms, candidate_rsi, candidate_price, revalidation_at, submit_at, expiry_at, entry_mode, rsi, rsi_trajectory, rsi_band, bollinger, band, dmi, adx, expected_cushion, cushion_class, counter_evidence, entry_reason, order_id, execution_id, requested_stake, effective_stake, last_result, last_pnl, quality_class, last_reason, payload, watch_mode, updated_at)
       VALUES($1,$2,'BLITZ_45S',45,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22,$23,$24::jsonb,$25::jsonb,$26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$4, decision=$5, wait_reason=$6, candidate_at=$7, candidate_age_ms=$8, candidate_rsi=$9, candidate_price=$10, revalidation_at=COALESCE($11, iq_rsi_agent_state_v2live.revalidation_at), submit_at=COALESCE($12, iq_rsi_agent_state_v2live.submit_at), expiry_at=$13, entry_mode=COALESCE($14, iq_rsi_agent_state_v2live.entry_mode), rsi=$15, rsi_trajectory=$16, rsi_band=$17, bollinger=$18::jsonb, band=$19::jsonb, dmi=$20::jsonb, adx=$21::jsonb, order_id=COALESCE($26, iq_rsi_agent_state_v2live.order_id), execution_id=COALESCE($27, iq_rsi_agent_state_v2live.execution_id), effective_stake=COALESCE($29, iq_rsi_agent_state_v2live.effective_stake), last_result=COALESCE($30, iq_rsi_agent_state_v2live.last_result), last_pnl=COALESCE($31, iq_rsi_agent_state_v2live.last_pnl), quality_class=COALESCE($32, iq_rsi_agent_state_v2live.quality_class), last_reason=$33, payload=$34::jsonb, watch_mode=$35, updated_at=now()`,
      [state.agentId, state.marketKey, state.strategy ?? STRICT_V2_ID, state.waitReason ? "WAIT" : state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING", state.decision, state.waitReason, state.candidateAt, state.candidateAt !== null ? state.at - state.candidateAt : null, state.candidateRsi, state.candidatePrice ?? null, null, null, null, state.entryMode, state.rsi, null, state.rsiBand ?? null, JSON.stringify(state.indicators?.bollinger ?? null), JSON.stringify(state.indicators?.band ?? null), JSON.stringify(state.indicators?.dmi ?? null), JSON.stringify(state.indicators?.adx ?? null), null, null, JSON.stringify([]), JSON.stringify([]), state.orderId, state.executionId, this.stakeBrl, state.effectiveStake, state.lastResult ?? null, state.lastPnl ?? null, state.qualityClass ?? null, state.reason, JSON.stringify({ v2Status: state.v2Status ?? null, entryRsiOk: state.entryRsiOk === true, policy: RSI_AGENTS_V2_BLITZ_POLICY }), "BLITZ_IMMEDIATE_45S"],
    ).catch(() => undefined);
  }

  async #persistOpportunity(record) {
    if (!this.pool?.query || !record) return;
    this.opportunities.set(record.opportunity_id, record);
    await this.pool.query(
      `INSERT INTO iq_rsi_opportunities_v2live(opportunity_id, market_key, market_type, instrument_type, duration_seconds, agent_id, strategy_id, strategy_version, observed_at, candidate_at, candidate_age_ms, candidate_rsi, candidate_price, direction, entry_mode, decision, accepted, rsi, rsi_trajectory, bollinger, band, dmi, adx, structural_trend, short_horizon_direction, projection, expected_cushion, cushion_class, order_id, execution_id, effective_stake, entry_price, entry_noise, expiry_at, result, profit, actual_displacement, actual_cushion, quality_class, settlement_basis, counter_evidence, entry_reason, hard_blocks_checked, evaluations, indicators, payload, revalidation_at, submit_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41::jsonb,$42::jsonb,$43::jsonb,$44::jsonb,$45::jsonb,$46::jsonb,$47,$48, now())
       ON CONFLICT(opportunity_id) DO NOTHING`,
      [record.opportunity_id, record.market_key, record.market_type, record.instrument_type, record.duration_seconds, record.agent_id, record.strategy_id, record.strategy_version, record.observed_at, record.candidate_at, record.candidate_age_ms, record.candidate_rsi, record.candidate_price, record.direction, record.entry_mode, record.decision, record.accepted, record.rsi, record.rsi_trajectory, JSON.stringify(record.bollinger), JSON.stringify(record.band), JSON.stringify(record.dmi), JSON.stringify(record.adx), record.structural_trend, record.short_horizon_direction, JSON.stringify(record.projection), record.expected_cushion, record.cushion_class, record.order_id, record.execution_id, record.effective_stake, record.entry_price, record.entry_noise, record.expiry_at, record.result, record.profit, record.actual_displacement, record.actual_cushion, record.quality_class, record.settlement_basis, JSON.stringify(record.counter_evidence ?? []), JSON.stringify(record.entry_reason ?? []), JSON.stringify(record.hard_blocks_checked ?? []), JSON.stringify(record.evaluations ?? []), JSON.stringify(record.indicators ?? {}), JSON.stringify(record.payload ?? {}), record.revalidation_at ?? null, record.submit_at ?? null],
    ).catch(() => undefined);
  }

  async #persistEvent({ marketKey, event, decision = null, reason = null, payload = {} }) {
    if (!this.pool?.query) return;
    await this.pool.query("INSERT INTO iq_rsi_events_v2live(market_key, instrument_type, agent_id, strategy_id, event, decision, reason, payload) VALUES($1,'BLITZ_45S',$2,$3,$4,$5,$6,$7::jsonb)", [marketKey, `blitz:${marketKey}`, "RSI_REVERSAL_V2_BLITZ", event, decision, reason, JSON.stringify(payload)]).catch(() => undefined);
  }

  status() {
    const agents = [...this.agents.values()];
    return {
      version: RSI_AGENTS_V2_BLITZ_VERSION, strategyCore: "rsi-skills-v2 (ORIGINAL, congelada)", strategyVersion: "v2-live-blitz",
      instrumentType: "BLITZ_45S", durationSeconds: 45, enabled: this.enabled, stakeBrl: this.stakeBrl, routing: "RSI_V2_ONLY",
      practiceOnly: true, realLocked: true, migration: { ...this.migration }, universe: this.universe,
      totals: { enabled: this.universe.enabled, signals: agents.filter((row) => row.decision === "BUY" || row.decision === "SELL").length, open: agents.filter((row) => row.position?.status === "OPEN").length, settled: agents.filter((row) => row.lastResult).length, wins: agents.filter((row) => row.lastResult === "WIN").length, losses: agents.filter((row) => row.lastResult === "LOSS").length },
      agents, counters: { ...this.counters }, policy: RSI_AGENTS_V2_BLITZ_POLICY, freeze: rsiSkillsV2FreezeManifest(),
    };
  }
}

export function rsiAgentsV2BlitzFreezeManifest() {
  return { schema: "rsi-agents-v2-blitz-freeze-v1", version: RSI_AGENTS_V2_BLITZ_VERSION, policy: RSI_AGENTS_V2_BLITZ_POLICY, skills: rsiSkillsV2FreezeManifest(), noTuning: true };
}
