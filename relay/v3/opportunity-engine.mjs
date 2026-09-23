/**
 * V3 — EXPIRATION OPPORTUNITY ENGINE.
 *
 * A EXPIRATION cria a oportunidade: quando a IQ oferece uma expiration real que vira a
 * frente compravel (~TTE 330s), nasce UMA opportunity para (marketKey, expirationAt).
 * Dedup absoluto: a mesma dupla nunca gera duas opportunities.
 *
 * O engine NAO decide direcao: ele mantem estado, memoria de ciclos e aplica as regras
 * temporais (target ~302s, hard cutoff TTE<=300 => MISSED_5M_ENTRY_WINDOW).
 */
import { ExpirationTargetTiming } from "./timing.mjs";

export const V3_OPPORTUNITY_VERSION = "v3-opportunity-engine-v1";

export const OPPORTUNITY_STATES = Object.freeze([
  "DISCOVERED", "ANALYZING", "NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE",
  "FINAL_REVIEW", "APPROVED_BUY", "APPROVED_SELL", "CANCELLED", "MISSED_5M_ENTRY_WINDOW",
  "EXECUTING", "ACKNOWLEDGED", "SETTLED", "EXPIRED_UNSETTLED",
]);

export const CLOSED_STATES = Object.freeze(["NO_SETUP", "CANCELLED", "MISSED_5M_ENTRY_WINDOW", "SETTLED", "EXPIRED_UNSETTLED"]);
export const CANDIDATE_STATES = Object.freeze(["BUY_CANDIDATE", "SELL_CANDIDATE"]);

const iso = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);

export class ExpirationOpportunityEngine {
  constructor({ now = () => Date.now(), maxCycles = 40 } = {}) {
    this.now = now;
    this.maxCycles = maxCycles;
    this.opportunities = new Map();
    this.counters = { discovered: 0, duplicatesBlocked: 0, cycles: 0, noSetup: 0, wait: 0, candidates: 0, approved: 0, cancelled: 0, missedWindow: 0, closed: 0 };
  }

  static opportunityId(marketKey, expirationAt) { return `${marketKey}@${iso(expirationAt)}`; }

  /** Descobre/cria a opportunity. Retorna { opportunity, created }. Nunca duplica. */
  discover({ marketKey, activeId = null, expirationAt, brokerNow, payout = null, buyability = null, deadtimeMs = null, discoveryMaxTteMs = 330_000 } = {}) {
    const id = ExpirationOpportunityEngine.opportunityId(marketKey, expirationAt);
    const existing = this.opportunities.get(id);
    if (existing) { this.counters.duplicatesBlocked += 1; return { opportunity: existing, created: false }; }
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    let derived;
    try { derived = ExpirationTargetTiming.derive({ expirationAt, brokerNow: at, purchaseDeadlineAt: Number(deadtimeMs) > 0 ? Number(expirationAt) - Number(deadtimeMs) : null }); }
    catch { return { opportunity: null, created: false, error: "INVALID_EXPIRATION" }; }
    if (derived.tteMs > discoveryMaxTteMs) return { opportunity: null, created: false, error: "TTE_ABOVE_DISCOVERY_WINDOW", derived };
    // Janela perdida nao cria opportunity: adocao tardia (TTE <= 300s) e MISSED_5M_ENTRY_WINDOW, nao perseguicao.
    if (derived.tteMs <= derived.targetHoldSeconds * 1000) return { opportunity: null, created: false, error: "MISSED_5M_ENTRY_WINDOW", derived };
    const opportunity = {
      version: V3_OPPORTUNITY_VERSION,
      opportunityId: id, marketKey, activeId,
      expirationAt: derived.expirationAt,
      firstSeenAt: derived.brokerNow, firstSeenTteMs: derived.tteMs,
      brokerNow: derived.brokerNow,
      targetSendAt: derived.targetSendAt,
      hardStrategicCutoffAt: derived.hardStrategicCutoffAt,
      purchaseDeadlineAt: derived.purchaseDeadlineAt,
      payout, buyability, deadtimeMs,
      createdAt: derived.brokerNow,
      status: "DISCOVERED",
      cycles: [],
      tentativeDecision: null,
      decisionHistory: [],
      finalDecision: null,
      finalizedAt: null,
      executionRef: null,
      closedAt: null,
      closedReason: null,
    };
    this.opportunities.set(id, opportunity);
    this.counters.discovered += 1;
    return { opportunity, created: true, derived };
  }

  get(opportunityId) { return this.opportunities.get(String(opportunityId)) ?? null; }

  activeFor(marketKey) {
    for (const opportunity of this.opportunities.values()) {
      if (opportunity.marketKey === marketKey && !CLOSED_STATES.includes(opportunity.status)) return opportunity;
    }
    return null;
  }

  /** Registra um ciclo completo (ja com specialist/asset/consensus resolvidos). */
  recordCycle(opportunityId, cycle) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) return null;
    if (CLOSED_STATES.includes(opportunity.status) || opportunity.finalizedAt !== null) return opportunity;
    const number = opportunity.cycles.length + 1;
    const entry = { cycleNumber: number, ...cycle };
    opportunity.cycles.push(entry);
    if (opportunity.cycles.length > this.maxCycles) opportunity.cycles.splice(0, opportunity.cycles.length - this.maxCycles);
    this.counters.cycles += 1;
    // Revisao pre-freeze: NO SUNK COST — um ciclo posterior pode rebaixar/trocar a decisao tentativa.
    opportunity.status = entry.status ?? opportunity.status;
    if (opportunity.status === "NO_SETUP") this.counters.noSetup += 1;
    else if (opportunity.status === "WAIT") this.counters.wait += 1;
    else if (CANDIDATE_STATES.includes(opportunity.status)) this.counters.candidates += 1;
    return opportunity;
  }

  /** Aplica a regra temporal absoluta (cutoff TTE<=300s e purchase deadline do broker). */
  enforceWindow(opportunityId, brokerNow = null) {
    const opportunity = this.get(opportunityId);
    if (!opportunity || CLOSED_STATES.includes(opportunity.status)) return opportunity;
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    if (ExpirationTargetTiming.cutoffPassed({ expirationAt: opportunity.expirationAt, brokerNow: at })) {
      this.#close(opportunity, "MISSED_5M_ENTRY_WINDOW", "TTE_AT_OR_BELOW_300S_WITHOUT_SUBMIT");
      this.counters.missedWindow += 1;
      return opportunity;
    }
    if (opportunity.purchaseDeadlineAt !== null && at >= opportunity.purchaseDeadlineAt) {
      this.#close(opportunity, "CANCELLED", "BROKER_PURCHASE_DEADLINE_PASSED");
      return opportunity;
    }
    return opportunity;
  }

  /** Decide o estado TENTATIVO do ciclo; revisavel ate o freeze (pre-send). Nunca persegue, nunca troca expiration. */
  finalizeCycle(opportunityId, { asset, consensus, brokerNow = null, timingOk = null } = {}) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) return null;
    if (opportunity.finalizedAt !== null || CLOSED_STATES.includes(opportunity.status)) return opportunity;
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    const outcome = consensus?.result ?? "CANCEL";
    const direction = outcome === "APPROVE_BUY" ? "UP" : outcome === "APPROVE_SELL" ? "DOWN" : "NONE";
    const tentative = {
      at, cycleNumber: opportunity.cycles.length, result: outcome, direction,
      consensusDirection: consensus?.direction ?? null,
      scenario: asset?.scenario ?? null, assetState: asset?.state ?? null,
      agreement: consensus?.agreement ?? null,
    };
    opportunity.tentativeDecision = tentative;
    opportunity.decisionHistory.push(tentative);
    if (opportunity.decisionHistory.length > 12) opportunity.decisionHistory.splice(0, opportunity.decisionHistory.length - 12);
    if (outcome === "APPROVE_BUY" || outcome === "APPROVE_SELL") {
      // Aprovacao TENTATIVA: acontece na ANALYSIS WINDOW; a EXECUTION WINDOW (~302s) e do scheduler.
      const window = ExpirationTargetTiming.analysis({ expirationAt: opportunity.expirationAt, brokerNow: at });
      if (window.ok !== true) { this.enforceWindow(opportunityId, at); return opportunity; }
      const beforeTarget = at < opportunity.targetSendAt;
      opportunity.status = beforeTarget ? "FINAL_REVIEW" : outcome === "APPROVE_BUY" ? "APPROVED_BUY" : "APPROVED_SELL";
      this.counters.approved += 1;
      return opportunity;
    }
    if (asset?.state === "NO_SETUP" && opportunity.cycles.length >= 1) { this.#close(opportunity, "NO_SETUP", "FIRST_FULL_CYCLE_NO_SETUP"); return opportunity; }
    // Cancelamento TENTATIVO: NAO fecha a opportunity (pode haver Cycle 2); nunca rebaixa para estado executavel antigo.
    if (asset?.state === "WAIT") { opportunity.status = "WAIT"; return opportunity; }
    if (asset?.state === "BUY_CANDIDATE" || asset?.state === "SELL_CANDIDATE") { opportunity.status = asset.state; return opportunity; }
    opportunity.status = "ANALYZING";
    return opportunity;
  }

  /** FREEZE pre-send: a ultima decisao TENTATIVA valida vira FINAL. Idempotente. */
  finalizeOpportunity(opportunityId, { brokerNow = null, reason = "NO_MORE_CYCLES" } = {}) {
    const opportunity = this.get(opportunityId);
    if (!opportunity || opportunity.finalizedAt !== null) return opportunity;
    if (CLOSED_STATES.includes(opportunity.status)) return opportunity;
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    const latest = opportunity.tentativeDecision;
    const result = latest?.result ?? "CANCEL";
    const direction = latest?.direction ?? "NONE";
    const window = ExpirationTargetTiming.analysis({ expirationAt: opportunity.expirationAt, brokerNow: at });
    opportunity.finalizedAt = at;
    opportunity.finalDecision = {
      at, result, direction,
      scenario: latest?.scenario ?? null, agreement: latest?.agreement ?? null,
      cycleNumber: latest?.cycleNumber ?? null, finalReason: String(reason).slice(0, 80),
      timing: window.derived ?? null,
    };
    if (result === "APPROVE_BUY" || result === "APPROVE_SELL") {
      opportunity.status = at < opportunity.targetSendAt ? "FINAL_REVIEW" : result === "APPROVE_BUY" ? "APPROVED_BUY" : "APPROVED_SELL";
    } else {
      this.#close(opportunity, "CANCELLED", `FINAL_CONSENSUS_${result}_${reason}`.slice(0, 120));
    }
    return opportunity;
  }

  /** Cancela explicitamente (revalidacao bloqueou / consenso cancelou no alvo). */
  cancel(opportunityId, reason = "CANCELLED") {
    const opportunity = this.get(opportunityId);
    if (!opportunity || CLOSED_STATES.includes(opportunity.status)) return opportunity;
    this.#close(opportunity, "CANCELLED", String(reason).slice(0, 120));
    this.counters.cancelled += 1;
    return opportunity;
  }

  /** Marca o envio (usado pelo caminho de execucao futuro; V3 atual e observe-only). */
  markExecution(opportunityId, executionRef) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) return null;
    if (opportunity.status !== "APPROVED_BUY" && opportunity.status !== "APPROVED_SELL") return opportunity;
    opportunity.status = "EXECUTING";
    opportunity.executionRef = executionRef ?? null;
    return opportunity;
  }

  markSettled(opportunityId, { state = "SETTLED", brokerOrderId = null } = {}) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) return null;
    opportunity.status = state === "EXPIRED_UNSETTLED" ? "EXPIRED_UNSETTLED" : "SETTLED";
    opportunity.executionRef = { ...(opportunity.executionRef ?? {}), brokerOrderId };
    this.counters.closed += 1;
    return opportunity;
  }

  #close(opportunity, status, reason) {
    opportunity.status = status;
    opportunity.closedAt = this.now();
    opportunity.closedReason = reason;
    opportunity.finalizedAt = opportunity.finalizedAt ?? this.now();
    this.counters.closed += 1;
    this.counters.cancelled += status === "CANCELLED" ? 1 : 0;
  }

  list({ marketKey = null, status = null, limit = 50 } = {}) {
    return [...this.opportunities.values()]
      .filter((opportunity) => (!marketKey || opportunity.marketKey === marketKey) && (!status || opportunity.status === status))
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
  }

  stats() {
    const byStatus = {};
    for (const opportunity of this.opportunities.values()) byStatus[opportunity.status] = (byStatus[opportunity.status] ?? 0) + 1;
    const cycles = [...this.opportunities.values()].map((opportunity) => opportunity.cycles.length);
    return {
      version: V3_OPPORTUNITY_VERSION,
      opportunities: this.opportunities.size,
      byStatus,
      counters: { ...this.counters },
      cycles: { total: cycles.reduce((sum, value) => sum + value, 0), max: cycles.length ? Math.max(...cycles) : 0, average: cycles.length ? Math.round((cycles.reduce((sum, value) => sum + value, 0) / cycles.length) * 10) / 10 : 0 },
    };
  }
}
