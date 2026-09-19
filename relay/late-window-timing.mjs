/**
 * LATE WINDOW TIMING (Fase 4 — SHADOW) — politica de timing LATE_WINDOW_V2 vs CURRENT_V1.
 *
 * OBJETIVO (pesquisa, nunca execucao):
 *  - CURRENT_V1 (producao): candidato -> revalidacao em targetEntryAt - entryLeadMs (1.0-2.0s) ->
 *    ordem com expiracao targetEntryAt + horizonte. Entra ~E-61s.
 *  - LATE_WINDOW_V2 (esta politica): continua observando candles/ticks/features/Critic/Consensus/
 *    Quality Gate ate o limite real de compra da MESMA expiracao E (turbo 1m: E-30s exclusivo),
 *    com margem adaptativa derivada da latencia real (ACK + persistencia DB + decisao + guarda de
 *    relogio). Se a oportunidade continuar valida -> entraria; se mudar -> cancela. Direcao NUNCA
 *    inverte (acao diferente = cancelamento); expiracao NUNCA cai para a proxima (fail-closed).
 *
 * INVARIANTES:
 *  - SHADOW_ONLY: controlsExecution/controlsDirection/controlsStake = false. Este modulo NAO envia
 *    ordem, NAO altera candidate/posicao, NAO toca threshold/pesos/gate.
 *  - Isolamento: tudo chaveado por marketKey + candidateId; NORMAL != OTC.
 *  - Anti-leakage: o T0 e congelado no begin; observacoes posteriores entram apenas em `late` e
 *    `comparison`, nunca no T0. Avaliacoes depois do deadline sao marcadas afterDeadline=true e
 *    nunca determinam o veredito.
 *  - Semantica IQ turbo 1m derivada de relay/iqoption-ws.mjs computeExpiration (referencia
 *    iqoptionapi/expiration.py): a expiracao E e compravel em S quando E-90s <= S < E-30s.
 */
import { computeExpiration } from "./iqoption-ws.mjs";
import { revalidateCandidate, comparableSnapshot, compareCandidateSnapshots } from "./entry-timing.mjs";

export const LATE_WINDOW_VERSION = "late-window-timing-v1";
export const TIMING_POLICY_CURRENT = "CURRENT_V1";
export const TIMING_POLICY_LATE = "LATE_WINDOW_V2";
export const TIMING_OBSERVATION_KIND = "TIMING_POLICY_SHADOW";

export const TURBO_1M_CUTOFF_MS = 30_000;
export const TURBO_1M_WINDOW_OPEN_MS = 90_000;
export const MIN_LATE_MARGIN_MS = 1_000;
export const MAX_LATE_MARGIN_MS = 5_000;
export const LATE_JITTER_BUFFER_MS = 300;
export const LATE_CLOCK_GUARD_MS = 500;
export const DEFAULT_ACK_FALLBACK_MS = 1_500;
export const DEFAULT_PERSIST_FALLBACK_MS = 800;
export const DEFAULT_DECISION_FALLBACK_MS = 50;
export const MAX_EVALUATIONS = 180;

export const LATE_WINDOW_POLICY = Object.freeze({
  version: TIMING_POLICY_LATE,
  currentVersion: TIMING_POLICY_CURRENT,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  controlsDirection: false,
  controlsStake: false,
  scope: "TURBO_1M",
  expirationPolicy: "SAME_EXPIRATION_ONLY_FAIL_CLOSED",
  cutoffRule: "TURBO_1M_E_MINUS_30S_EXCLUSIVE",
  directionPolicy: "NEVER_FLIPS_DIRECTION_OPPORTUNITY_DIES",
  note: "Nunca envia ordem; a expiracao aceita e conferida contra a solicitada e qualquer divergencia e registrada como inconsistencia.",
});

/* ------------------------------- semantica IQ ------------------------------- */

/**
 * Janela de compra da MESMA expiracao para turbo 1m.
 * Para expiracao E (fronteira de minuto): computeExpiration(S, 1) === E quando E-90s <= S < E-30s.
 * O instante E-30s e EXCLUSIVO: a partir dele a IQ passa para E+60s.
 */
export function sameExpirationWindow({ targetExpiryAt = null, productKind = "turbo" } = {}) {
  const expiry = Number(targetExpiryAt);
  if (!Number.isFinite(expiry) || expiry <= 0) return { supported: false, reason: "TARGET_EXPIRY_REQUIRED", productKind };
  if (productKind !== "turbo") return { supported: false, reason: "PRODUCT_OUT_OF_SCOPE", productKind, note: "binary/digital nao sao usados com horizonte de 1m; politica cobre apenas turbo 1m." };
  const opensAt = expiry - TURBO_1M_WINDOW_OPEN_MS;
  const cutoffExclusiveAt = expiry - TURBO_1M_CUTOFF_MS;
  return {
    supported: true, productKind, opensAt, cutoffExclusiveAt, latestSameExpirySendAt: cutoffExclusiveAt,
    widthMs: cutoffExclusiveAt - opensAt, cutoffRule: LATE_WINDOW_POLICY.cutoffRule,
  };
}

/** true quando um envio em `atMs` ainda recebe exatamente targetExpiryAt. */
export function sameExpirationAt({ targetExpiryAt = null, atMs = null, productKind = "turbo" } = {}) {
  const window = sameExpirationWindow({ targetExpiryAt, productKind });
  if (!window.supported) return false;
  const at = Number(atMs);
  return Number.isFinite(at) && at >= window.opensAt && at < window.cutoffExclusiveAt;
}

/** Deadline de envio do LATE_WINDOW_V2: cutoff(E-30s) - margem adaptativa. */
export function lateDeadlineAt({ targetExpiryAt = null, marginMs = MIN_LATE_MARGIN_MS, productKind = "turbo" } = {}) {
  const window = sameExpirationWindow({ targetExpiryAt, productKind });
  if (!window.supported) return null;
  const margin = Math.max(MIN_LATE_MARGIN_MS, Math.min(MAX_LATE_MARGIN_MS, Math.round(Number(marginMs) || MIN_LATE_MARGIN_MS)));
  return window.cutoffExclusiveAt - margin;
}

/* ------------------------------- latencia / margem ------------------------------- */

export function percentileMs(samples = [], fraction = 0.95) {
  const values = (Array.isArray(samples) ? samples : []).map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(fraction * values.length) - 1));
  return Math.round(values[index]);
}

/**
 * Margem adaptativa a partir da latencia REAL: p95(ACK) + p95(persistencia DB) + p95(decisao->submit)
 * + jitter + guarda de relogio, limitada a [1s, 5s]. Rapida/estavel -> margem menor; lenta/instavel -> maior.
 */
export function adaptiveLateMarginMs({
  ackSamples = [], persistSamples = [], decisionSamples = [], quantile = 0.95,
  jitterMs = LATE_JITTER_BUFFER_MS, clockGuardMs = LATE_CLOCK_GUARD_MS,
  min = MIN_LATE_MARGIN_MS, max = MAX_LATE_MARGIN_MS,
  fallbackAckMs = DEFAULT_ACK_FALLBACK_MS, fallbackPersistMs = DEFAULT_PERSIST_FALLBACK_MS, fallbackDecisionMs = DEFAULT_DECISION_FALLBACK_MS,
} = {}) {
  const ack = percentileMs(ackSamples, quantile);
  const persist = percentileMs(persistSamples, quantile);
  const decision = percentileMs(decisionSamples, quantile);
  const components = {
    ackMs: ack ?? fallbackAckMs, persistMs: persist ?? fallbackPersistMs, decisionMs: decision ?? fallbackDecisionMs,
    jitterMs, clockGuardMs, quantile,
    sources: { ack: ack === null ? "FALLBACK" : "MEASURED", persist: persist === null ? "FALLBACK" : "MEASURED", decision: decision === null ? "FALLBACK" : "MEASURED" },
  };
  const raw = components.ackMs + components.persistMs + components.decisionMs + jitterMs + clockGuardMs;
  return { marginMs: Math.max(min, Math.min(max, Math.round(raw))), rawMs: Math.round(raw), components };
}

/** Aceita o veredito dos bracos com as MESMAS regras do runtime (nunca reimplementa pesos). */
export function evaluateLateCandidate({ candidate = {}, final = {}, freshness = {}, gate = {} } = {}) {
  const revalidation = revalidateCandidate({ candidate, final, freshness });
  const enabled = gate.enabled === true;
  const threshold = Number.isFinite(Number(gate.threshold)) ? Number(gate.threshold) : null;
  const score = Number.isFinite(Number(gate.score)) ? Number(gate.score) : null;
  const locationOk = gate.locationOk !== false;
  const microVeto = gate.microVeto === true;
  const belowThreshold = threshold !== null && score !== null && score < threshold;
  let gateReason = null;
  if (enabled) {
    if (!locationOk) gateReason = "VALID_SETUP_BUT_BAD_ENTRY_PRICE";
    else if (microVeto) gateReason = "MICROSTRUCTURE_VETO";
    else if (belowThreshold) gateReason = "QUALITY_SCORE_BELOW_THRESHOLD";
  }
  const gateAccepted = !enabled || gateReason === null;
  const valid = revalidation.ok && gateAccepted;
  const reason = !revalidation.ok ? (revalidation.reason ?? "CANDIDATE_REVALIDATION_FAILED") : gateReason;
  return {
    valid, reason, revalidation,
    gate: { enabled, accepted: gateAccepted, reason: gateReason, score, threshold, locationOk, microVeto },
  };
}

/* ------------------------------- anti-leakage ------------------------------- */

const FUTURE_KEY_PATTERN = /(result|settlement|outcome|pnl|profit|postwindow|post_window|future|expiryclose|expiry_close|broker)/i;
/** Chaves agendadas conhecidas em T0 (planejamento, nao dados futuros). */
const SCHEDULED_TARGET_KEYS = new Set(["targetEntryAt", "targetExpiryAt", "currentSubmitAt"]);

/** Detecta qualquer referencia temporal futura (> asOfMs) dentro do snapshot congelado. */
export function findFutureReferences(value, asOfMs, path = "t0", found = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) return found;
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 1_000_000_000_000 && value > Number(asOfMs)) found.push(`${path}=${value}`);
    return found;
  }
  if (typeof value === "string") return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findFutureReferences(entry, asOfMs, `${path}[${index}]`, found, depth + 1));
    return found;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SCHEDULED_TARGET_KEYS.has(key)) continue;
      if (FUTURE_KEY_PATTERN.test(key)) { found.push(`${path}.${key}`); continue; }
      findFutureReferences(entry, asOfMs, `${path}.${key}`, found, depth + 1);
    }
  }
  return found;
}

function buildTimingT0({ marketKey, marketType, activeId, agentId, direction, candidateAt, targetEntryAt, targetExpiryAt, currentSubmitAt, currentLeadMs, payout, productKind, snapshot = {} }) {
  return {
    marketKey, marketType, activeId, agentId, direction,
    candidateAt, targetEntryAt, targetExpiryAt, currentSubmitAt, currentLeadMs, payout, productKind,
    price: snapshot.price ?? null, regime: snapshot.regime ?? null, setup: snapshot.setup ?? null, trigger: snapshot.trigger ?? null,
    structure: snapshot.structure ?? null, location: snapshot.location ?? null, momentum: snapshot.momentum ?? null,
    strength: snapshot.strength ?? null, volatility: snapshot.volatility ?? null, microstructure: snapshot.microstructure ?? null,
    critic: snapshot.critic ? { verdict: snapshot.critic.verdict ?? null, independentAction: snapshot.critic.independentAction ?? null, contradictions: snapshot.critic.contradictions ?? [], riskFlags: snapshot.critic.riskFlags ?? [] } : null,
    consensus: snapshot.consensus ? { status: snapshot.consensus.status ?? null, reason: snapshot.consensus.reason ?? null } : null,
    freshness: snapshot.freshness ? { fresh: snapshot.freshness.fresh === true, reason: snapshot.freshness.reason ?? null, tickAgeMs: snapshot.freshness.tickAgeMs ?? null } : null,
    knowledgeContextIds: snapshot.knowledgeContextIds ?? [], brainGeneration: snapshot.brainGeneration ?? null,
  };
}

/* ------------------------------- classe ------------------------------- */

export class LateWindowTimingShadow {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, maxInMemory = 300, marginOptions = {} } = {}) {
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxInMemory = maxInMemory;
    this.marginOptions = marginOptions;
    this.observations = new Map();
    this.byWindow = new Map();
    this.byCandidate = new Map();
    this.persist = { attempts: 0, failures: 0, lastError: null, lastOkAt: null };
  }

  #remember(observation) {
    this.observations.set(observation.id, observation);
    if (observation.windowKey) this.byWindow.set(observation.windowKey, observation.id);
    if (observation.candidateId) this.byCandidate.set(observation.candidateId, observation.id);
    if (this.observations.size > this.maxInMemory) {
      const oldest = [...this.observations.values()].filter((row) => row.outcome !== "OBSERVING").sort((a, b) => a.openedAt - b.openedAt)[0];
      if (oldest) this.observations.delete(oldest.id);
    }
  }

  /** Todas as janelas ainda abertas do mercado (expiracao E-60s e E podem coexistir ate o deadline). */
  activeObservationsForMarket(marketKey) {
    return [...this.observations.values()].filter((row) => row.marketKey === marketKey && row.outcome === "OBSERVING");
  }

  activeForMarket(marketKey) {
    const actives = this.activeObservationsForMarket(marketKey);
    return actives.length ? actives[actives.length - 1] : null;
  }

  getByCandidate(candidateId) {
    const id = this.byCandidate.get(candidateId);
    return id ? this.observations.get(id) ?? null : null;
  }

  getByWindow(windowKey) {
    const id = this.byWindow.get(windowKey);
    return id ? this.observations.get(id) ?? null : null;
  }

  list() { return [...this.observations.values()]; }

  /** Cria a observacao da politica NOVA a partir do candidato CURRENT_V1. Supersede a anterior do mercado. */
  begin({
    marketKey, marketType = null, activeId = null, agentId = null, candidateId, correlationId = null,
    direction, candidateSnapshot = {}, targetEntryAt = null, targetExpiryAt = null,
    currentSubmitAt = null, currentLeadMs = null, productKind = "turbo", payout = null, serverNowMs = null,
    latency = {}, atMs = this.now(),
  } = {}) {
    const window = sameExpirationWindow({ targetExpiryAt, productKind });
    const windowKey = `${marketKey}:${targetExpiryAt}`;
    const previous = this.getByWindow(windowKey);
    if (previous && previous.outcome === "OBSERVING" && previous.candidateId !== candidateId) {
      this.finalize({ windowKey, atMs, serverNowMs, reason: "SUPERSEDED_BY_NEW_CANDIDATE" });
    }
    const margin = adaptiveLateMarginMs({ ...this.marginOptions, ...latency });
    const marginP50 = adaptiveLateMarginMs({ ...this.marginOptions, ...latency, quantile: 0.5 });
    const deadlineAt = window.supported ? window.cutoffExclusiveAt - margin.marginMs : null;
    const observation = {
      id: `timing_${candidateId ?? `${marketKey}_${targetExpiryAt}`}`, version: LATE_WINDOW_VERSION,
      policyVersion: TIMING_POLICY_LATE, currentPolicyVersion: TIMING_POLICY_CURRENT, kind: TIMING_OBSERVATION_KIND, provenance: "PROSPECTIVE",
      marketKey, marketType, activeId, agentId, candidateId, correlationId,
      targetEntryAt, targetExpiryAt, windowKey: `${marketKey}:${targetExpiryAt}`, productKind, direction: direction ?? null, payout: Number.isFinite(Number(payout)) ? Number(payout) : null,
      openedAt: atMs, openedServerNow: serverNowMs, closedAt: null,
      t0: buildTimingT0({ marketKey, marketType, activeId, agentId, direction, candidateAt: candidateSnapshot.at ?? null, targetEntryAt, targetExpiryAt, currentSubmitAt, currentLeadMs, payout, productKind, snapshot: candidateSnapshot }),
      t0Comparable: comparableSnapshot(candidateSnapshot),
      policy: {
        ...LATE_WINDOW_POLICY, window, margin, marginP50,
        deadlineAt, deadlineAtP50: window.supported ? window.cutoffExclusiveAt - marginP50.marginMs : null,
        sameExpirationAtDeadline: window.supported ? (computeExpiration(Math.floor(deadlineAt / 1000), 1).expiration === Math.round(targetExpiryAt / 1000)) : null,
      },
      current: {
        submitAt: currentSubmitAt, leadMs: currentLeadMs, decisionAt: null, consensusAction: null, executionId: null,
        disposition: null, reason: null, ackedAt: null, brokerOrderId: null, brokerExpirationSec: null, expirationMismatch: null,
        entryPrice: null, result: null, profit: null, settledAt: null,
      },
      late: {
        deadlineAt, lastEvaluationAt: null, evaluations: [], firstEvaluation: null, lastBeforeDeadline: null,
        verdict: window.supported ? "PENDING" : "WINDOW_UNSUPPORTED", reason: window.supported ? null : window.reason,
        becameInvalidAt: null, recoveredAt: null, transitions: [], entryPriceWouldBe: null,
        result: null, normalizedPnl: null, settledAt: null,
      },
      comparison: null, outcome: "OBSERVING", outcomeReason: null, persistState: "PENDING", persistPromise: null, lastPersistAt: null,
    };
    deepFreeze(observation.t0);
    this.#remember(observation);
    observation.persistPromise = this.#persistInsert(observation);
    this.#safeLog("LATE_WINDOW_BEGIN", { marketKey, candidateId, targetExpiryAt, deadlineAt, marginMs: margin.marginMs, supported: window.supported });
    return observation;
  }

  /**
   * Observacao a cada avaliacao do pipeline (ticks/candles 5s/features). Nunca toca no T0 nem envia ordem.
   * O veredito da politica NOVA e sempre a ULTIMA avaliacao em/antes do deadline; avaliacoes apos o
   * deadline sao diagnosticas (afterDeadline=true) e nao decidem.
   */
  observe({
    marketKey, candidateId = null, atMs = this.now(), serverNowMs = null, final = {}, freshness = {}, latestSnapshot = {},
    score = null, threshold = null, locationOk = true, microVeto = false, gateEnabled = false,
    price = null, candles = [], payout = null,
  } = {}) {
    const observation = (candidateId ? this.getByCandidate(candidateId) : null) ?? this.activeForMarket(marketKey);
    if (!observation || observation.outcome !== "OBSERVING") return null;
    const at = Number.isFinite(Number(serverNowMs)) ? Number(serverNowMs) : Number(atMs);
    const verdict = evaluateLateCandidate({
      candidate: { action: observation.direction, regime: observation.t0.regime, setup: observation.t0.setup },
      final, freshness,
      gate: { enabled: gateEnabled === true, score, threshold, locationOk, microVeto },
    });
    const changedFields = observation.t0Comparable
      ? compareCandidateSnapshots(observation.t0Comparable, comparableSnapshot(latestSnapshot)).changes.map((change) => change.field)
      : [];
    const evaluation = {
      at, atMs, afterDeadline: observation.late.deadlineAt !== null ? at > observation.late.deadlineAt : false,
      price: Number.isFinite(Number(price)) ? Number(price) : null,
      action: final.action ?? null, regime: final.regime ?? null, setup: final.setup ?? null, trigger: final.trigger ?? null,
      criticVerdict: final.criticVerdict ?? null, consensusStatus: final.consensusStatus ?? null,
      revalidationOk: verdict.revalidation.ok === true, revalidationReason: verdict.revalidation.reason ?? null,
      score: verdict.gate.score, threshold: verdict.gate.threshold,
      locationOk: verdict.gate.locationOk, microVeto: verdict.gate.microVeto,
      gateAccepted: verdict.gate.accepted === true, gateReason: verdict.gate.reason,
      valid: verdict.valid === true, validReason: verdict.reason, fresh: freshness.fresh === true, changedFields,
    };
    const late = observation.late;
    const previous = late.evaluations[late.evaluations.length - 1] ?? null;
    if (late.evaluations.length < MAX_EVALUATIONS) late.evaluations.push(evaluation);
    late.lastEvaluationAt = at;
    if (!late.firstEvaluation) late.firstEvaluation = evaluation;
    if (!evaluation.afterDeadline) {
      late.lastBeforeDeadline = evaluation;
      late.verdict = evaluation.valid ? "ACCEPT" : (evaluation.revalidationOk === false ? `CANCEL_${evaluation.revalidationReason ?? "REVALIDATION_FAILED"}` : `CANCEL_${evaluation.gateReason ?? "GATE_REJECT"}`);
      late.reason = evaluation.valid ? null : (evaluation.revalidationOk === false ? (evaluation.revalidationReason ?? "REVALIDATION_FAILED") : (evaluation.gateReason ?? "GATE_REJECT"));
      late.entryPriceWouldBe = evaluation.price;
    }
    if (previous && previous.valid !== evaluation.valid) {
      late.transitions.push({ at, from: previous.valid, to: evaluation.valid, reason: evaluation.valid ? null : (evaluation.revalidationReason ?? evaluation.gateReason ?? null), afterDeadline: evaluation.afterDeadline });
      if (!evaluation.valid && late.becameInvalidAt === null) late.becameInvalidAt = at;
      if (evaluation.valid && previous.valid === false) late.recoveredAt = at;
    }
    if (payout !== null && Number.isFinite(Number(payout))) observation.payout = Number(payout);
    this.#maybePersist(observation, { candles, force: evaluation.afterDeadline });
    if (late.deadlineAt !== null && at >= late.deadlineAt && observation.outcome === "OBSERVING") {
      // Finaliza SOMENTE esta janela (nunca todas as do mercado: a expiracao seguinte pode estar em observacao).
      this.finalize({ candidateId: observation.candidateId, windowKey: observation.windowKey, atMs, serverNowMs: at, reason: "DEADLINE_REACHED", candles });
    }
    return evaluation;
  }

  markCurrentSend({ candidateId = null, executionId = null, disposition = null, reason = null, atMs = this.now() } = {}) {
    const observation = this.#resolve(candidateId);
    if (!observation) return null;
    observation.current = { ...observation.current, decisionAt: atMs, executionId, disposition, reason };
    void this.#persistUpdate(observation, { force: true });
    return observation.id;
  }

  markCurrentAck({ candidateId = null, atMs = this.now(), brokerOrderId = null, brokerExpirationSec = null, entryPrice = null } = {}) {
    const observation = this.#resolve(candidateId);
    if (!observation) return null;
    const requested = Math.round(Number(observation.targetExpiryAt) / 1000);
    const mismatch = brokerExpirationSec !== null && brokerExpirationSec !== undefined ? Number(brokerExpirationSec) !== requested : null;
    observation.current = { ...observation.current, ackedAt: atMs, brokerOrderId, brokerExpirationSec: brokerExpirationSec ?? null, expirationMismatch: mismatch, entryPrice: entryPrice ?? null, executed: true };
    void this.#persistUpdate(observation, { force: true });
    return observation.id;
  }

  markCurrentReject({ candidateId = null, reason = null, atMs = this.now() } = {}) {
    const observation = this.#resolve(candidateId);
    if (!observation) return null;
    observation.current = { ...observation.current, disposition: "REJECT", reason, rejectedAt: atMs, executed: false };
    void this.#persistUpdate(observation, { force: true });
    return observation.id;
  }

  markCurrentCancel({ candidateId = null, reason = null, atMs = this.now() } = {}) {
    const observation = this.#resolve(candidateId);
    if (!observation) return null;
    observation.current = { ...observation.current, cancelledAt: atMs, cancelReason: reason };
    void this.#persistUpdate(observation, { force: true });
    return observation.id;
  }

  markCurrentSettle({ candidateId = null, result = null, profit = null, stake = null, atMs = this.now() } = {}) {
    const observation = this.#resolve(candidateId);
    if (!observation) return null;
    observation.current = { ...observation.current, result, profit: Number.isFinite(Number(profit)) ? Number(profit) : null, stake: Number.isFinite(Number(stake)) ? Number(stake) : observation.current.stake ?? null, settledAt: atMs };
    void this.#persistUpdate(observation, { force: true });
    return observation.id;
  }

  #resolve(candidateId) {
    if (!candidateId) return null;
    const inMemory = this.getByCandidate(candidateId);
    if (inMemory) return inMemory;
    void this.#loadByCandidate(candidateId);
    return null;
  }

  /** Fecha a janela: compara CURRENT_V1 x LATE_WINDOW_V2 e registra o resultado (sem PnL de broker). */
  finalize({ marketKey = null, candidateId = null, windowKey = null, atMs = this.now(), serverNowMs = null, reason = "DEADLINE_REACHED", candles = [] } = {}) {
    const targets = candidateId ? [this.getByCandidate(candidateId)]
      : windowKey ? [this.getByWindow(windowKey)]
        : marketKey ? this.activeObservationsForMarket(marketKey) : [];
    let lastFinalized = null;
    for (const observation of targets) {
      if (!observation || observation.outcome !== "OBSERVING") continue;
      lastFinalized = this.#finalizeObservation(observation, { atMs, serverNowMs, reason, candles });
    }
    return lastFinalized;
  }

  #finalizeObservation(observation, { atMs, serverNowMs, reason, candles }) {
    const decision = observation.late.lastBeforeDeadline ?? null;
    const window = observation.policy.window;
    const deadlineAt = observation.late.deadlineAt;
    const closedBeforeDeadline = deadlineAt === null || Number(atMs) < deadlineAt;
    let outcome = "LATE_CANCEL";
    let outcomeReason = decision ? (decision.revalidationOk === false ? (decision.revalidationReason ?? "REVALIDATION_FAILED") : (decision.gateReason ?? "GATE_REJECT")) : "NO_EVALUATION_BEFORE_DEADLINE";
    if (!window.supported) { outcome = "WINDOW_UNSUPPORTED"; outcomeReason = window.reason ?? "PRODUCT_OUT_OF_SCOPE"; }
    else if (closedBeforeDeadline && reason !== "DEADLINE_REACHED") {
      // Interrupcao (supersede/reconexao/restart) antes do deadline nao e decisao: nao conta como ACCEPT/CANCEL.
      outcome = reason; outcomeReason = decision ? (decision.valid ? "WOULD_ACCEPT_AT_INTERRUPTION" : "WOULD_CANCEL_AT_INTERRUPTION") : "NO_EVALUATION_BEFORE_DEADLINE";
    }
    else if (decision?.valid === true) { outcome = "LATE_ACCEPT"; outcomeReason = null; }
    const currentMoment = observation.current.ackedAt ?? observation.current.submitAt ?? observation.current.decisionAt ?? observation.openedAt;
    const windowStart = currentMoment;
    const evaluationsInWindow = observation.late.evaluations.filter((row) => row.at > windowStart && row.at <= deadlineAt);
    const candleSource = Array.isArray(candles) && candles.length ? candles : (Array.isArray(observation.lastCandles) ? observation.lastCandles : []);
    const buckets = candleSource
      .map((candle) => Number(candle?.bucketStart))
      .filter((bucket) => Number.isFinite(bucket) && bucket > windowStart && bucket <= deadlineAt);
    const first = observation.late.firstEvaluation;
    const last = decision;
    const scoreDelta = first && last && first.score !== null && last.score !== null ? last.score - first.score : null;
    observation.comparison = {
      currentVersion: TIMING_POLICY_CURRENT, lateVersion: TIMING_POLICY_LATE,
      currentDecisionAt: observation.current.decisionAt ?? observation.current.submitAt, currentSubmitAt: observation.current.submitAt,
      currentEntryAt: observation.current.ackedAt, currentExecuted: observation.current.executed === true || observation.current.ackedAt !== null,
      currentDisposition: observation.current.disposition ?? null, currentCancelReason: observation.current.cancelReason ?? null,
      lateDeadlineAt: deadlineAt, lateMarginMs: observation.policy.margin.marginMs, lateMarginComponents: observation.policy.margin.components,
      additionalObservedMsVsCurrentSubmit: deadlineAt !== null && observation.current.submitAt !== null ? deadlineAt - observation.current.submitAt : null,
      additionalObservedMsVsCurrentEntry: deadlineAt !== null && observation.current.ackedAt !== null ? deadlineAt - observation.current.ackedAt : null,
      additionalEvaluations: evaluationsInWindow.length,
      additionalCandles5s: new Set(buckets).size,
      additionalTickPrices: new Set(evaluationsInWindow.map((row) => row.price).filter((value) => value !== null)).size,
      keptSameExpiration: observation.policy.sameExpirationAtDeadline,
      expirationRiskAtDeadlinePlus1ms: window.supported ? (computeExpiration(Math.floor((deadlineAt + 1) / 1000), 1).expiration === Math.round(observation.targetExpiryAt / 1000)) : null,
      wouldAction: last?.action ?? null, candidateAction: observation.direction,
      actionChangedToWait: last ? last.action === "WAIT" : null,
      directionFlipped: last ? ((last.action === "BUY" || last.action === "SELL") ? last.action !== observation.direction : false) : null,
      criticChanged: first && last ? first.criticVerdict !== last.criticVerdict : null,
      consensusChanged: first && last ? first.consensusStatus !== last.consensusStatus : null,
      gateChanged: first && last ? (first.gateAccepted !== last.gateAccepted || first.score !== last.score) : null,
      gateAcceptedAtDeadline: last?.gateAccepted ?? null,
      locationChanged: first && last ? first.locationOk !== last.locationOk : null,
      scoreDelta, degraded: scoreDelta !== null ? scoreDelta < 0 : null,
      becameInvalid: observation.late.becameInvalidAt !== null, recovered: observation.late.recoveredAt !== null,
      transitions: observation.late.transitions.slice(-20),
      changedFieldsAtDeadline: last?.changedFields ?? [],
      brokerExpirationObserved: observation.current.brokerExpirationSec ?? null,
      expirationRequested: Math.round(Number(observation.targetExpiryAt) / 1000),
      expirationMismatchObserved: observation.current.expirationMismatch ?? null,
      controlPolicy: "SHADOW_ONLY_NEVER_CONTROLS_EXECUTION",
    };
    observation.late.verdict = decision ? (decision.valid ? "ACCEPT" : observation.late.verdict) : "CANCEL_NO_EVALUATION_BEFORE_DEADLINE";
    observation.outcome = outcome; observation.outcomeReason = outcomeReason;
    observation.closedAt = atMs; observation.closedServerNow = serverNowMs ?? atMs; observation.finalizeReason = reason;
    if (observation.windowKey) this.byWindow.delete(observation.windowKey);
    this.#persistUpdate(observation, { force: true });
    this.#safeLog("LATE_WINDOW_FINALIZE", { marketKey: observation.marketKey, candidateId: observation.candidateId, outcome, outcomeReason, reason });
    return observation;
  }

  /** Liquidacao CAUSAL do braco LATE (nunca broker): entrada no deadline, saida no candle >= expiracao. */
  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = this.now() } = {}) {
    if (!Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const candle = candles[index];
    if (!candle || !Number.isFinite(Number(candle.bucketStart))) return 0;
    let settled = 0;
    for (const observation of this.observations.values()) {
      if (observation.marketKey !== marketKey || observation.late.result !== null) continue;
      if (observation.outcome !== "LATE_ACCEPT") continue;
      if (!observation.late.entryPriceWouldBe || Number(candle.bucketStart) < Number(observation.targetExpiryAt)) continue;
      const close = Number(candle.close);
      const entry = Number(observation.late.entryPriceWouldBe);
      if (!Number.isFinite(close) || !Number.isFinite(entry)) continue;
      const direction = observation.direction;
      const up = close > entry;
      observation.late.result = direction === "BUY" ? (up ? "WIN" : close < entry ? "LOSS" : "DRAW") : (!up ? "WIN" : close > entry ? "LOSS" : "DRAW");
      const payout = Number(observation.payout);
      const fraction = payout > 1 ? payout / 100 : (Number.isFinite(payout) && payout > 0 ? payout : 0.85);
      observation.late.normalizedPnl = Number((observation.late.result === "WIN" ? fraction : observation.late.result === "LOSS" ? -1 : 0).toFixed(4));
      observation.late.settledAt = nowMs; observation.late.settlementBasis = "CAUSAL_COUNTERFACTUAL";
      this.#persistUpdate(observation, { force: true });
      settled += 1;
    }
    return settled;
  }

  /** Agregado para dashboard/endpoint (somente leitura). */
  summary() {
    const rows = this.list();
    const finalized = rows.filter((row) => row.outcome !== "OBSERVING");
    const accepted = finalized.filter((row) => row.outcome === "LATE_ACCEPT");
    const nums = (pick) => finalized.map(pick).filter((value) => Number.isFinite(value));
    const avg = (values) => (values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null);
    return {
      version: LATE_WINDOW_VERSION, policy: LATE_WINDOW_POLICY.execution, observations: rows.length, observing: rows.filter((row) => row.outcome === "OBSERVING").length,
      finalized: finalized.length, lateAccept: accepted.length, lateCancel: finalized.filter((row) => row.outcome === "LATE_CANCEL").length,
      windowUnsupported: finalized.filter((row) => row.outcome === "WINDOW_UNSUPPORTED").length,
      outcomes: Object.fromEntries([...new Set(finalized.map((row) => row.outcome))].map((outcome) => [outcome, finalized.filter((row) => row.outcome === outcome).length])),
      additionalObservedMs: avg(nums((row) => row.comparison?.additionalObservedMsVsCurrentSubmit)),
      additionalCandles: avg(nums((row) => row.comparison?.additionalCandles5s)),
      additionalTickPrices: avg(nums((row) => row.comparison?.additionalTickPrices)),
      becameInvalid: finalized.filter((row) => row.comparison?.becameInvalid === true).length,
      recovered: finalized.filter((row) => row.comparison?.recovered === true).length,
      sameExpirationViolations: finalized.filter((row) => row.comparison?.keptSameExpiration !== true).length,
      expirationMismatchObserved: finalized.filter((row) => row.comparison?.expirationMismatchObserved === true).length,
      lateSettled: finalized.filter((row) => row.late.result !== null).length,
      lateResults: finalized.reduce((acc, row) => { if (row.late.result) acc[row.late.result] = (acc[row.late.result] ?? 0) + 1; return acc; }, {}),
      lateNormalizedPnl: Number(finalized.reduce((sum, row) => sum + (Number(row.late.normalizedPnl) || 0), 0).toFixed(4)),
      marginSnapshot: adaptiveLateMarginMs(this.marginOptions),
    };
  }

  statusSnapshot() { return { observations: this.observations.size, persist: { ...this.persist } }; }

  /* ------------------------------- persistencia ------------------------------- */

  #safeLog(event, payload) { this.log(event, JSON.stringify(payload)); }

  #maybePersist(observation, { candles = [], force = false } = {}) {
    observation.lastCandles = candles;
    const now = this.now();
    if (!force && observation.lastPersistAt !== null && now - observation.lastPersistAt < 5_000) return;
    observation.lastPersistAt = now;
    void this.#persistUpdate(observation, { force });
  }

  async #persistInsert(observation) {
    if (!this.pool?.query) { observation.persistState = "NO_POOL"; return false; }
    this.persist.attempts += 1;
    try {
      await this.pool.query(
        `INSERT INTO iq_timing_policy_observations(
           observation_id, version, timing_policy_version, current_policy_version, kind, provenance, market_key, market_type, active_id, agent_id,
           candidate_id, correlation_id, target_entry_at, target_expiry_at, window_key, product_kind, direction, payout,
           t0, policy, current_policy, late_policy, evaluations, comparison, outcome, outcome_reason, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13::double precision / 1000.0),to_timestamp($14::double precision / 1000.0),$15,$16,$17,$18,
           $19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25,$26,now(),now())`,
        [
          observation.id, observation.version, observation.policyVersion, observation.currentPolicyVersion, observation.kind, observation.provenance,
          observation.marketKey, observation.marketType, observation.activeId, observation.agentId, observation.candidateId, observation.correlationId,
          observation.targetEntryAt, observation.targetExpiryAt, observation.windowKey, observation.productKind, observation.direction, observation.payout,
          JSON.stringify(observation.t0), JSON.stringify(observation.policy), JSON.stringify(observation.current), JSON.stringify(observation.late),
          JSON.stringify(observation.late.evaluations), observation.comparison ? JSON.stringify(observation.comparison) : null, observation.outcome, observation.outcomeReason,
        ],
      );
      observation.persistState = "PERSISTED";
      this.persist.lastOkAt = this.now();
      return true;
    } catch (error) {
      observation.persistState = "FAILED"; this.#recordPersistFailure(error);
      return false;
    }
  }

  async #persistUpdate(observation, { force = false } = {}) {
    if (!this.pool?.query) { observation.persistState = "NO_POOL"; return false; }
    if (observation.outcome !== "OBSERVING" || force) {
      // Serializa sempre depois do INSERT inicial (nunca UPDATE em linha inexistente).
      try { await observation.persistPromise; } catch { /* insert tratado */ }
      this.persist.attempts += 1;
      try {
        await this.pool.query(
          `UPDATE iq_timing_policy_observations
              SET policy=$2::jsonb, current_policy=$3::jsonb, late_policy=$4::jsonb, evaluations=$5::jsonb, comparison=$6::jsonb,
                  outcome=$7, outcome_reason=$8, updated_at=now()
            WHERE observation_id=$1`,
          [observation.id, JSON.stringify(observation.policy), JSON.stringify(observation.current), JSON.stringify(observation.late), JSON.stringify(observation.late.evaluations), observation.comparison ? JSON.stringify(observation.comparison) : null, observation.outcome, observation.outcomeReason],
        );
        this.persist.lastOkAt = this.now();
        return true;
      } catch (error) { this.#recordPersistFailure(error); return false; }
    }
    return false;
  }

  #recordPersistFailure(error) {
    this.persist.failures += 1; this.persist.lastError = String(error?.message ?? error).slice(0, 200);
    this.#safeLog("LATE_WINDOW_PERSIST_FAILED", { error: this.persist.lastError });
  }

  async #loadByCandidate(candidateId) {
    if (!this.pool?.query) return null;
    try {
      const result = await this.pool.query(
        "SELECT observation_id, market_key, candidate_id, target_entry_at, target_expiry_at, t0, policy, current_policy, late_policy, comparison, outcome, outcome_reason FROM iq_timing_policy_observations WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 1",
        [candidateId],
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const observation = {
        id: row.observation_id, version: LATE_WINDOW_VERSION, policyVersion: row.policy?.version ?? TIMING_POLICY_LATE, currentPolicyVersion: TIMING_POLICY_CURRENT,
        kind: TIMING_OBSERVATION_KIND, provenance: "PROSPECTIVE", marketKey: row.market_key, candidateId: row.candidate_id,
        targetEntryAt: row.target_entry_at ? new Date(row.target_entry_at).getTime() : null, targetExpiryAt: row.target_expiry_at ? new Date(row.target_expiry_at).getTime() : null,
        t0: row.t0 ?? {}, policy: row.policy ?? {}, current: row.current_policy ?? {}, late: row.late_policy ?? { evaluations: [] },
        comparison: row.comparison ?? null, outcome: row.outcome ?? "OBSERVING", outcomeReason: row.outcome_reason ?? null,
        openedAt: row.t0?.candidateAt ?? null, persistState: "LOADED", persistPromise: Promise.resolve(true),
      };
      if (!Array.isArray(observation.late.evaluations)) observation.late.evaluations = [];
      this.#remember(observation);
      return observation;
    } catch (error) { this.#recordPersistFailure(error); return null; }
  }

  toJSON() { return { version: LATE_WINDOW_VERSION, observations: this.list().slice(-200).map((row) => ({ id: row.id, marketKey: row.marketKey, candidateId: row.candidateId, outcome: row.outcome, late: row.late, current: row.current, comparison: row.comparison })) }; }

  loadFrom(snapshot = {}) {
    if (!snapshot || typeof snapshot !== "object") return false;
    for (const row of Array.isArray(snapshot.observations) ? snapshot.observations : []) {
      if (!row?.id) continue;
      const observation = {
        id: row.id, version: LATE_WINDOW_VERSION, policyVersion: TIMING_POLICY_LATE, currentPolicyVersion: TIMING_POLICY_CURRENT, kind: TIMING_OBSERVATION_KIND,
        provenance: "PROSPECTIVE", marketKey: row.marketKey ?? null, candidateId: row.candidateId ?? null,
        t0: row.t0 ?? {}, policy: row.policy ?? {}, current: row.current ?? {}, late: row.late ?? { evaluations: [], deadlineAt: null, verdict: "PENDING" },
        comparison: row.comparison ?? null, outcome: row.outcome ?? "OBSERVING", outcomeReason: row.outcomeReason ?? null,
        openedAt: row.openedAt ?? 0, persistState: "LOADED", persistPromise: Promise.resolve(true),
      };
      if (!Array.isArray(observation.late.evaluations)) observation.late.evaluations = [];
      this.#remember(observation);
    }
    return true;
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
