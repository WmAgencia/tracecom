/**
 * RSI AGENTS 5x5 — 10 agentes NORMAIS do runtime TraceCon:
 *   5 x RSI_REVERSAL_STRICT   (reversao confirmada: RSI extremo + Bollinger + DMI/ADX completo)
 *   5 x RSI_EXTREME_PULLBACK  (pullback curto: RSI extremo + Bollinger, bloqueia band riding/aceleracao)
 * Ativos OTC fixos por grupo, atribuicao PERSISTIDA no banco (sem troca silenciosa).
 * Ordem SEMPRE pelo caminho normal: runtime.submitAgentOrder -> requestOrder (Execution Gate) sob ARM/autoExecute PRACTICE.
 * Sem harness, sem cap de experimento. Stake R$1. REAL nunca e habilitado por este modulo.
 */
import { evaluateVariant, STRICT_ID, PULLBACK_ID } from "./rsi-variants.mjs";
import { effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";

export const RSI_AGENTS_VERSION = "rsi-agents-5x5-v1";
export const RSI_AGENTS = Object.freeze({ STRICT: "RSI_REVERSAL_STRICT", PULLBACK: "RSI_EXTREME_PULLBACK", STRICT_SKILL: STRICT_ID, PULLBACK_SKILL: PULLBACK_ID });
export const RSI_AGENTS_POLICY = Object.freeze({
  version: RSI_AGENTS_VERSION, mode: "NORMAL_RUNTIME_AGENT", practiceOnly: true, realLocked: true,
  stakeBrl: 1, groupSize: 5, otcUniverseSize: 10, finalWindowMs: 5000, minimumSafeMarginMs: 3000,
  turbCutoffMs: 30_000, noSilentSubstitution: true, autoInvert: false, sameExpiryRequired: true,
  singleBrokerPath: "runtime.submitAgentOrder -> requestOrder",
});
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export class RsiAgents5x5 {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.assignments = new Map(); // marketKey -> { strategy, activeId, canonical, availability }
    this.agents = new Map();      // marketKey -> state observavel
    this.submitted = new Map();   // idempotencyKey -> { at, marketKey, direction }
    this.lastEvaluationAt = new Map();
    this.rejections = [];
  }

  /** Descobre ate 10 OTCs OPEN com feed e atribui 5 STRICT + 5 PULLBACK (persistido; sem troca silenciosa). */
  async assignUniverse(markets = []) {
    if (this.assignments.size >= RSI_AGENTS_POLICY.otcUniverseSize) return [...this.assignments.entries()];
    const candidates = markets
      .filter((market) => market.marketType === "OTC" && market.enabled === true && market.availability === "OPEN" && market.activeId !== null && market.activeId !== undefined)
      .sort((a, b) => String(a.marketKey).localeCompare(String(b.marketKey)))
      .slice(0, RSI_AGENTS_POLICY.otcUniverseSize);
    for (let index = 0; index < candidates.length; index += 1) {
      const market = candidates[index];
      if (this.assignments.has(market.marketKey)) continue;
      const strategy = index < RSI_AGENTS_POLICY.groupSize ? RSI_AGENTS.STRICT : RSI_AGENTS.PULLBACK;
      this.assignments.set(market.marketKey, { strategy, activeId: market.activeId, canonical: market.canonical ?? null, availability: market.availability, assignedAt: this.now() });
      if (this.pool?.query) await this.pool.query(
        `INSERT INTO iq_rsi_agent_assignments(market_key, strategy, active_id, canonical, availability) VALUES($1,$2,$3,$4,$5) ON CONFLICT(market_key) DO UPDATE SET availability=$5, updated_at=now()`,
        [market.marketKey, strategy, market.activeId, market.canonical ?? null, market.availability],
      ).catch(() => undefined);
    }
    return [...this.assignments.entries()];
  }

  /** Marcadores de indisponibilidade sem substituicao silenciosa (registra motivo). */
  async markAvailability(marketKey, availability) {
    const assignment = this.assignments.get(marketKey);
    if (!assignment) return;
    if (assignment.availability === availability) return;
    assignment.availability = availability;
    if (this.pool?.query) await this.pool.query(`UPDATE iq_rsi_agent_assignments SET availability=$2, updated_at=now() WHERE market_key=$1`, [marketKey, availability]).catch(() => undefined);
    this.log("RSI_AGENT_AVAILABILITY", JSON.stringify({ marketKey, availability, note: "sem substituicao silenciosa" }));
  }

  skillFor(strategy) { return strategy === RSI_AGENTS.STRICT ? RSI_AGENTS.STRICT_SKILL : RSI_AGENTS.PULLBACK_SKILL; }

  /** Avaliacao por mercado (candles reais do runtime) + execucao via caminho normal quando ARMADO. */
  async observeMarket({ marketKey, marketType = "OTC", activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled) return null;
    const assignment = this.assignments.get(marketKey);
    if (!assignment || marketType !== "OTC") return null;
    const at = num(now) ?? this.now();
    const skill = this.skillFor(assignment.strategy);
    const evaluation = evaluateVariant({ variant: skill, candles, now: at });
    const agentId = `${assignment.strategy}:${marketKey}`;
    const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: effectiveSafeMarginMs(latency) }) : null;
    const state = {
      agentId, marketKey, strategy: assignment.strategy, at,
      rsi: evaluation.rsi ?? null, rsiBand: evaluation.rsiBand ?? null, rsiTrajectory: evaluation.rsiTrajectory ?? null,
      bollinger: evaluation.bollinger ?? null, bollingerState: evaluation.status ?? null, bollingerConfirmed: evaluation.bollingerConfirmed ?? false, bandRiding: evaluation.bandRiding ?? false,
      plusDI: evaluation.dmi?.plusDI ?? null, minusDI: evaluation.dmi?.minusDI ?? null, spread: evaluation.dmi?.spread ?? null,
      adx: evaluation.adx?.value ?? null, adxSlope: evaluation.adx?.slope ?? null,
      structuralTrend: this.#structuralTrend(candles), shortHorizonDirection: evaluation.direction ?? null,
      decision: "WAIT", waitReason: null, reason: null, candidateAt: null, revalidationAt: null, submitAt: null,
    };
    if (!evaluation.direction) { state.waitReason = "NO_OPPORTUNITY"; state.reason = "RSI fora de extremo"; this.#setState(state); return state; }
    if (!evaluation.accepted) {
      state.waitReason = evaluation.status;
      state.reason = evaluation.rejectedStrongTrend || evaluation.strongAccel ? "tendencia antiga forte/acelerando" : "confirmacoes incompletas";
      this.#setState(state); return state;
    }
    state.decision = evaluation.direction; state.reason = `confluencia ${evaluation.variant}`;
    if (!window) { void this.#persist(state); this.#setState(state); return state; }
    if (at < window.entryWindowOpensAt) { state.waitReason = "OBSERVE_ONLY"; this.#setState(state); return state; }
    if (at > window.entryWindowClosesAt) {
      state.waitReason = at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
      this.#setState(state); return state;
    }
    const revalidation = evaluateVariant({ variant: skill, candles, now: at });
    state.revalidationAt = at;
    if (!revalidation.accepted || revalidation.direction !== state.decision) {
      state.decision = "WAIT"; state.waitReason = "CANCELLED_REVALIDATION"; state.reason = "condicao desapareceu na revalidacao";
      this.#setState(state); void this.#persist(state); return state;
    }
    state.candidateAt = state.candidateAt ?? at;
    const idempotencyKey = `rsi-agent:${assignment.strategy}:${marketKey}:${targetExpiryAt}:${state.decision}`;
    if (this.submitted.has(idempotencyKey)) { state.waitReason = "DUPLICATE_BLOCKED"; this.#setState(state); return state; }
    try {
      const order = await this.runtime.submitAgentOrder({ marketKey, direction: state.decision, strategyId: assignment.strategy, skill: evaluation.variant, stake: RSI_AGENTS_POLICY.stakeBrl, idempotencyKey, decisionId: agentId });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      state.submitAt = this.now();
      if (accepted) { this.submitted.set(idempotencyKey, { at: state.submitAt, marketKey, direction: state.decision }); state.reason = "ordem aceita pelo broker (PRACTICE)"; state.position = { status: "OPEN", brokerOrderId: order?.brokerOrderId ?? null }; }
      else { state.waitReason = `ORDER_${order?.disposition ?? order?.state ?? "BLOCKED"}`; state.reason = String(order?.reason ?? order?.state ?? "bloqueado").slice(0, 160); this.rejections.push({ marketKey, strategy: assignment.strategy, reason: state.waitReason, at }); }
    } catch (error) {
      const code = String(error?.code ?? "ERROR");
      state.waitReason = `ORDER_BLOCKED_${code}`; state.reason = `${code}: ${String(error?.message ?? error).slice(0, 160)}`;
      this.rejections.push({ marketKey, strategy: assignment.strategy, reason: code, message: state.reason, at });
      this.log("RSI_AGENT_ORDER_BLOCKED", JSON.stringify({ marketKey, strategy: assignment.strategy, reason: code }));
    }
    this.#setState(state); void this.#persist(state);
    return state;
  }

  /** Resultado real de trade vindo do settlement do broker (mesmo caminho normal). */
  recordSettlement({ marketKey = null, result = null, profit = null, entryPrice = null, expiryPrice = null, payout = null } = {}) {
    const assignment = this.assignments.get(marketKey);
    let state = this.agents.get(marketKey);
    if (!state && !assignment) return null;
    if (!state) { state = { agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy, at: this.now(), decision: "WAIT", waitReason: null, reason: null }; this.agents.set(marketKey, state); }
    state.lastResult = result; state.lastPnl = num(profit); state.expiryPrice = num(expiryPrice); state.entryPrice = num(entryPrice); state.payout = num(payout);
    state.position = { status: "SETTLED", result, profit: num(profit) };
    state.decision = "WAIT"; state.reason = `liquidado ${result}`;
    void this.#persist(state);
    return state;
  }

  #setState(state) { this.agents.set(state.marketKey, state); this.lastEvaluationAt.set(state.marketKey, state.at); }
  #structuralTrend(candles) { const list = Array.isArray(candles) ? candles : []; if (list.length < 30) return "UNKNOWN"; const first = Number(list[list.length - 30]?.close); const last = Number(list[list.length - 1]?.close); if (!Number.isFinite(first) || !Number.isFinite(last)) return "UNKNOWN"; if (last > first) return "BULLISH"; if (last < first) return "BEARISH"; return "NEUTRAL"; }

  async #persist(state) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_agent_state(agent_id, market_key, strategy, status, decision, wait_reason, rsi, rsi_band, bollinger_state, dmi, adx, structural_trend, short_horizon_direction, candidate_at, revalidation_at, submit_at, last_reason, position, last_result, last_pnl, payload, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21::jsonb, now())
       ON CONFLICT(agent_id) DO UPDATE SET status=$4, decision=$5, wait_reason=$6, rsi=$7, rsi_band=$8, bollinger_state=$9::jsonb, dmi=$10::jsonb, adx=$11::jsonb, structural_trend=$12, short_horizon_direction=$13, candidate_at=$14, revalidation_at=$15, submit_at=$16, last_reason=$17, position=$18::jsonb, last_result=$19, last_pnl=$20, payload=$21::jsonb, updated_at=now()`,
      [state.agentId, state.marketKey, state.strategy, state.waitReason ? "WAIT" : (state.decision === "BUY" || state.decision === "SELL" ? "SIGNAL" : "ANALYZING"), state.decision, state.waitReason, state.rsi, state.rsiBand, JSON.stringify({ upper: state.bollinger?.upper ?? null, middle: state.bollinger?.middle ?? null, lower: state.bollinger?.lower ?? null, position: state.bollinger?.position ?? null, state: state.bollingerState, confirmed: state.bollingerConfirmed, bandRiding: state.bandRiding }), JSON.stringify({ plusDI: state.plusDI, minusDI: state.minusDI, spread: state.spread }), JSON.stringify({ value: state.adx, slope: state.adxSlope }), state.structuralTrend, state.shortHorizonDirection, state.candidateAt, state.revalidationAt, state.submitAt, state.reason, JSON.stringify(state.position ?? null), state.lastResult ?? null, state.lastPnl ?? null, JSON.stringify({ policy: RSI_AGENTS_POLICY })],
    ).catch(() => undefined);
  }

  async status() {
    const agents = [...this.assignments.keys()].sort().map((marketKey) => {
      const assignment = this.assignments.get(marketKey);
      const state = this.agents.get(marketKey) ?? { agentId: `${assignment.strategy}:${marketKey}`, marketKey, strategy: assignment.strategy, decision: "WAIT", waitReason: "SEM_AVALIACAO", reason: null };
      return { ...state, strategy: assignment.strategy, availability: assignment.availability, activeId: assignment.activeId, skill: this.skillFor(assignment.strategy) };
    });
    const summarize = (strategy) => {
      const group = agents.filter((agent) => agent.strategy === strategy);
      return { total: group.length, analyzing: group.filter((agent) => !agent.waitReason).length, waiting: group.filter((agent) => agent.waitReason).length, signals: group.filter((agent) => agent.decision === "BUY" || agent.decision === "SELL").length, open: group.filter((agent) => agent.position?.status === "OPEN").length, settled: group.filter((agent) => agent.lastResult).length, wins: group.filter((agent) => agent.lastResult === "WIN").length, losses: group.filter((agent) => agent.lastResult === "LOSS").length };
    };
    return {
      version: RSI_AGENTS_VERSION, mode: "NORMAL_RUNTIME_AGENT", enabled: this.enabled, policy: RSI_AGENTS_POLICY,
      practiceOnly: true, realTouched: false, stakeBrl: RSI_AGENTS_POLICY.stakeBrl,
      groups: { strict: summarize(RSI_AGENTS.STRICT), pullback: summarize(RSI_AGENTS.PULLBACK) },
      assignments: agents.map((agent) => ({ marketKey: agent.marketKey, strategy: agent.strategy, skill: agent.skill, availability: agent.availability, activeId: agent.activeId })),
      agents: agents.map((agent) => ({ agentId: agent.agentId, marketKey: agent.marketKey, strategy: agent.strategy, availability: agent.availability, decision: agent.decision, waitReason: agent.waitReason, reason: agent.reason, rsi: agent.rsi, rsiBand: agent.rsiBand, rsiTrajectory: agent.rsiTrajectory, bollinger: agent.bollinger, bollingerState: agent.bollingerState, plusDI: agent.plusDI, minusDI: agent.minusDI, spread: agent.spread, adx: agent.adx, adxSlope: agent.adxSlope, structuralTrend: agent.structuralTrend, shortHorizonDirection: agent.shortHorizonDirection, candidateAt: agent.candidateAt, revalidationAt: agent.revalidationAt, submitAt: agent.submitAt, position: agent.position ?? null, lastResult: agent.lastResult ?? null, lastPnl: agent.lastPnl ?? null })),
      rejections: this.rejections.slice(-40),
      readyToArm: true, armInstructions: "ARM PRACTICE no TraceCon (autoExecute) — os 10 agentes passam a enviar via requestOrder normal; REAL continua LOCKED.",
    };
  }
}

export function rsiAgentsFreezeManifest() {
  return { schema: "rsi-agents-5x5-freeze-v1", version: RSI_AGENTS_VERSION, frozenAtUtc: new Date().toISOString(), policy: RSI_AGENTS_POLICY, skills: { strict: RSI_AGENTS.STRICT_SKILL, pullback: RSI_AGENTS.PULLBACK_SKILL }, noTuning: true, rules: { strict: "RSI extremo + Bollinger + DMI/ADX completo; strong continuation bloqueia", pullback: "RSI extremo + Bollinger; short pullback permitido; band riding/aceleracao forte bloqueia", singleBrokerPath: "runtime.submitAgentOrder -> requestOrder", realLocked: true, stakeBrl: 1 } };
}
