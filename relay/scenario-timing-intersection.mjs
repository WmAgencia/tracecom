/**
 * SCENARIO x TIMING INTERSECTION (camada OBSERVACIONAL SEPARADA) — RESEARCH/SHADOW ONLY.
 *
 * Este e o UNICO modulo que conhece os dois lados:
 *   - `relay/scenario-shadow.mjs`  (SCENARIO_ENGINE_V3_SHADOW);
 *   - `relay/late-window-timing.mjs` (LATE_WINDOW_V2).
 *
 * INVARIANTES DE ISOLAMENTO (provados em teste):
 *  - SOMENTE LEITURA: nunca chama begin/observe/finalize/cancel/mark* de nenhum dos dois lados,
 *    nunca altera seus estados e nunca importa nenhuma funcao de decisao/execucao;
 *  - cada lado produz o proprio estado; esta camada apenas COMPARA os dois estados como dado
 *    (scenario no candidate vs scenario no late deadline vs late window ACCEPT/CANCEL);
 *  - desligar qualquer um dos lados nao muda o resultado do outro (nenhuma chamada cruzada);
 *  - NUNCA envia ordem, NAO controla execucao, stake, direcao, threshold, JIT nem Execution Gate.
 */
import { TIMING_POLICY_CURRENT, TIMING_POLICY_LATE, LATE_WINDOW_VERSION, LATE_WINDOW_POLICY } from "./late-window-timing.mjs";
import { SCENARIO_ENGINE_V3_SHADOW, CURRENT_G2, SCENARIO_SHADOW_VERSION } from "./scenario-shadow.mjs";

export const SCENARIO_TIMING_INTERSECTION_VERSION = "scenario-timing-intersection-v1";
export const SCENARIO_TIMING_INTERSECTION_KIND = "SCENARIO_TIMING_INTERSECTION";
export const INTERSECTION_VERDICTS = Object.freeze([
  "BOTH_ENTRY", "SCENARIO_ENTRY_LATE_CANCEL", "SCENARIO_WAIT_LATE_ACCEPT", "BOTH_WAIT", "INSUFFICIENT_DATA",
]);
export const INTERSECTION_CODES = Object.freeze([
  "SCENARIO_AT_CANDIDATE", "SCENARIO_AT_LATE_DEADLINE", "SCENARIO_CHANGED_BEFORE_DEADLINE",
  "SCENARIO_FINAL_WAIT", "SCENARIO_FINAL_ENTRY", "LATE_ACCEPT", "LATE_CANCEL", "LATE_OBSERVING",
  "LATE_WINDOW_UNSUPPORTED", "SCENARIO_INVALIDATED_BEFORE_DEADLINE",
]);

export const SCENARIO_TIMING_INTERSECTION_POLICY = Object.freeze({
  version: SCENARIO_TIMING_INTERSECTION_VERSION,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  mutatesNeither: true,
  mode: "READ_ONLY_COMPARISON",
  note: "Compara scenario e timing como dado; nao chama metodos de nenhum dos lados e nao envia ordem.",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

function deepFreeze(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value)) deepFreeze(entry, depth + 1);
  return Object.freeze(value);
}

/** Ponto de cenario (stage) mais recente com `at <= atMs` (comparacao pura, sem tocar os lados). */
export function scenarioPointAt(stages = [], atMs = null) {
  const list = (Array.isArray(stages) ? stages : []).filter((row) => Number.isFinite(Number(row?.at)));
  const bound = num(atMs);
  const eligible = bound === null ? list : list.filter((row) => Number(row.at) <= bound);
  const point = eligible[eligible.length - 1] ?? null;
  if (!point) return null;
  return { stage: point.stage ?? null, at: num(point.at), scenario: point.scenario ?? null, action: point.action ?? null, regime: point.regime ?? null, playbook: point.playbook ?? null };
}

function timingVerdict(timing = {}) {
  const outcome = timing?.outcome ?? "UNKNOWN";
  if (outcome === "OBSERVING") return "LATE_OBSERVING";
  if (outcome === "LATE_ACCEPT") return "LATE_ACCEPT";
  if (outcome === "WINDOW_UNSUPPORTED") return "LATE_WINDOW_UNSUPPORTED";
  return "LATE_CANCEL";
}

/**
 * Intersecao OBSERVACIONAL pura: le os dois estados congelados e devolve a comparacao decomposta.
 * Nunca chama metodos, nunca muta `scenario` nem `timing`.
 */
export function buildIntersection({ scenario = null, timing = null, atMs = null } = {}) {
  const scenarioStages = scenario?.stages ?? [];
  const deadlineAt = firstFinite(timing?.late?.deadlineAt, timing?.policy?.deadlineAt);
  const atCandidate = scenarioPointAt(scenarioStages, scenario?.candidateAt ?? null) ?? scenarioPointAt(scenarioStages, deadlineAt);
  const atLateDeadline = scenarioPointAt(scenarioStages, deadlineAt);
  const lateVerdictCode = timing ? timingVerdict(timing) : "INSUFFICIENT_DATA";
  const lateDecision = timing?.late?.lastBeforeDeadline ?? null;
  const scenarioFinalAction = scenario?.finalAction ?? scenario?.scenarioDecision?.action ?? null;
  const scenarioInvalidated = scenario?.status === "CANCELLED" || scenario?.scenarioDecision?.cancelled === true;

  const codes = [];
  if (atCandidate) codes.push("SCENARIO_AT_CANDIDATE");
  if (scenario && deadlineAt !== null && atLateDeadline) codes.push("SCENARIO_AT_LATE_DEADLINE");
  if (scenario?.persistence?.scenarioChanged === true && atLateDeadline) codes.push("SCENARIO_CHANGED_BEFORE_DEADLINE");
  if (scenarioInvalidated) codes.push("SCENARIO_INVALIDATED_BEFORE_DEADLINE");
  if (scenarioFinalAction === "BUY" || scenarioFinalAction === "SELL") codes.push("SCENARIO_FINAL_ENTRY");
  else if (scenarioFinalAction === "WAIT") codes.push("SCENARIO_FINAL_WAIT");
  if (timing) codes.push(lateVerdictCode);

  const scenarioEntry = scenarioFinalAction === "BUY" || scenarioFinalAction === "SELL";
  const scenarioDirection = scenarioEntry ? scenarioFinalAction : (atLateDeadline?.action === "BUY" || atLateDeadline?.action === "SELL" ? atLateDeadline.action : null);
  const lateEntry = timing?.outcome === "LATE_ACCEPT";
  let verdict = "INSUFFICIENT_DATA";
  if (scenario && timing) {
    if (timing?.outcome === "OBSERVING") verdict = "INSUFFICIENT_DATA";
    else if (scenarioEntry && lateEntry) verdict = "BOTH_ENTRY";
    else if (scenarioEntry && !lateEntry) verdict = "SCENARIO_ENTRY_LATE_CANCEL";
    else if (!scenarioEntry && lateEntry) verdict = "SCENARIO_WAIT_LATE_ACCEPT";
    else verdict = "BOTH_WAIT";
  }
  const directionAgreement = scenarioEntry && lateEntry && lateDecision ? (scenarioDirection === lateDecision.action || lateDecision.action === null) : null;
  const intersectionId = `intersection_${timing?.candidateId ?? scenario?.candidateId ?? scenario?.marketKey ?? "UNKNOWN"}_${timing?.windowKey ?? timing?.targetExpiryAt ?? scenario?.targetExpiryAt ?? "na"}`;

  return deepFreeze({
    id: intersectionId,
    version: SCENARIO_TIMING_INTERSECTION_VERSION,
    kind: SCENARIO_TIMING_INTERSECTION_KIND,
    execution: "SHADOW_ONLY",
    controlsExecution: false,
    mutatedInputs: false,
    at: num(atMs),
    marketKey: scenario?.marketKey ?? timing?.marketKey ?? null,
    marketType: scenario?.marketType ?? timing?.marketType ?? null,
    candidateId: scenario?.candidateId ?? timing?.candidateId ?? null,
    correlationId: scenario?.correlationId ?? timing?.correlationId ?? null,
    executionId: scenario?.executionId ?? timing?.current?.executionId ?? null,
    scenarioObservationId: scenario?.id ?? null,
    timingObservationId: timing?.id ?? null,
    versions: {
      scenarioShadowVersion: SCENARIO_SHADOW_VERSION, scenarioPolicyVersion: scenario?.scenarioPolicyVersion ?? SCENARIO_ENGINE_V3_SHADOW,
      scenarioEngineVersion: scenario?.scenarioEngineVersion ?? null, currentPolicyVersion: CURRENT_G2,
      timingPolicyVersion: timing?.policyVersion ?? TIMING_POLICY_LATE, currentTimingPolicyVersion: TIMING_POLICY_CURRENT,
      lateWindowVersion: LATE_WINDOW_VERSION,
    },
    scenarioAtCandidate: atCandidate,
    scenarioAtLateDeadline: atLateDeadline,
    scenarioFinalAction,
    scenarioStatus: scenario?.status ?? null,
    scenarioChanged: scenario?.persistence?.scenarioChanged === true,
    scenarioChangeCount: scenario?.persistence?.scenarioChangeCount ?? null,
    scenarioDivergence: scenario?.divergence?.divergence ?? null,
    lateDeadlineAt: deadlineAt,
    lateVerdict: timing?.late?.verdict ?? null,
    lateOutcome: timing?.outcome ?? null,
    lateOutcomeReason: timing?.outcomeReason ?? null,
    lateValidAtDeadline: lateDecision?.valid ?? null,
    lateActionAtDeadline: lateDecision?.action ?? null,
    lateEvaluations: timing?.late?.evaluations?.length ?? 0,
    latestTimingEvaluation: timing?.late?.evaluations?.[timing.late.evaluations.length - 1] ?? null,
    directionAgreement,
    verdict,
    intersectionCodes: codes,
    comparison: {
      note: "Intersecao COMPARATIVA (nunca votacao): scenario e timing permanecem independentes.",
      scenarioDirection, lateEntry, lateCancel: timing ? !lateEntry && timing.outcome !== "OBSERVING" : null,
      keptSameExpiration: timing?.comparison?.keptSameExpiration ?? timing?.policy?.sameExpirationAtDeadline ?? null,
      directionFlipForbidden: true,
      adoptedDirection: null,
      timingControlPolicy: LATE_WINDOW_POLICY.execution,
    },
  });
}

function firstFinite(...values) {
  for (const value of values) { const parsed = num(value); if (parsed !== null) return parsed; }
  return null;
}

/** Registro append-only em memoria + persistencia best-effort (nunca derruba o runtime). */
export class ScenarioTimingIntersectionShadow {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, maxInMemory = 500, enabled = true } = {}) {
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxInMemory = maxInMemory;
    this.enabled = enabled === true;
    this.intersections = new Map();
    this.byCandidate = new Map();
    this.persist = { attempts: 0, failures: 0, lastError: null, lastOkAt: null };
  }

  setEnabled(enabled) { this.enabled = enabled === true; return this.enabled; }

  /**
   * Observa os DOIS estados (somente leitura). Retorna a intersecao registrada ou null.
   * Nunca chama metodos nos objetos recebidos; se um lado estiver ausente, registra o que existe.
   */
  observe({ scenarioObservation = null, timingObservation = null, atMs = null } = {}) {
    if (this.enabled !== true) return null;
    if (!scenarioObservation && !timingObservation) return null;
    const row = buildIntersection({ scenario: scenarioObservation, timing: timingObservation, atMs: atMs ?? this.now() });
    this.intersections.set(row.id, row);
    if (row.candidateId) this.byCandidate.set(row.candidateId, row.id);
    if (this.intersections.size > this.maxInMemory) {
      const oldest = [...this.intersections.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
      if (oldest) this.intersections.delete(oldest.id);
    }
    this.#safeLog("SCENARIO_TIMING_INTERSECTION", { id: row.id, verdict: row.verdict, codes: row.intersectionCodes, candidateId: row.candidateId });
    void this.#persist(row);
    return row;
  }

  list() { return [...this.intersections.values()]; }
  get(id) { return this.intersections.get(id) ?? null; }
  getByCandidate(candidateId) { const id = this.byCandidate.get(candidateId); return id ? this.intersections.get(id) ?? null : null; }

  summary() {
    const rows = this.list();
    const counts = (pick) => rows.reduce((acc, row) => { const key = pick(row) ?? "UNSPECIFIED"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
    return {
      version: SCENARIO_TIMING_INTERSECTION_VERSION, policy: SCENARIO_TIMING_INTERSECTION_POLICY,
      intersections: rows.length,
      byVerdict: counts((row) => row.verdict),
      byCode: rows.reduce((acc, row) => { for (const code of row.intersectionCodes ?? []) acc[code] = (acc[code] ?? 0) + 1; return acc; }, {}),
      bothEntry: rows.filter((row) => row.verdict === "BOTH_ENTRY").length,
      scenarioEntryLateCancel: rows.filter((row) => row.verdict === "SCENARIO_ENTRY_LATE_CANCEL").length,
      scenarioWaitLateAccept: rows.filter((row) => row.verdict === "SCENARIO_WAIT_LATE_ACCEPT").length,
      bothWait: rows.filter((row) => row.verdict === "BOTH_WAIT").length,
      isolation: { mode: "READ_ONLY_COMPARISON", mutatesNeither: true, scenarioControlsTiming: false, timingControlsScenario: false, controlsExecution: false },
    };
  }

  statusSnapshot() { return { intersections: this.intersections.size, enabled: this.enabled === true, persist: { ...this.persist } }; }

  status() {
    return {
      ...this.summary(),
      enabled: this.enabled === true,
      execution: "SHADOW_ONLY", controlsExecution: false, brokerAutomation: "NONE",
      persist: { ...this.persist, mode: this.pool ? "POSTGRES" : "MEMORY" },
      separation: "SCENARIO_STATE != TIMING_STATE (comparacao somente leitura)",
      at: this.now(),
    };
  }

  /* ------------------------------- persistencia ------------------------------- */

  #safeLog(event, payload) { this.log(event, JSON.stringify(payload)); }

  async #persist(row) {
    if (!this.pool?.query) return false;
    this.persist.attempts += 1;
    try {
      await this.pool.query(
        `INSERT INTO iq_scenario_timing_intersections(
           intersection_id, version, kind, market_key, market_type, candidate_id, correlation_id, execution_id,
           scenario_observation_id, timing_observation_id, scenario_policy_version, scenario_engine_version,
           timing_policy_version, current_policy_version, scenario_at_candidate, scenario_at_late_deadline,
           scenario_final_action, late_deadline_at, late_outcome, late_verdict, late_valid_at_deadline,
           intersection_codes, verdict, direction_agreement, payload, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,
           to_timestamp($18::double precision / 1000.0),$19,$20,$21,$22::jsonb,$23,$24,$25::jsonb,now(),now())
         ON CONFLICT(intersection_id) DO UPDATE SET scenario_at_late_deadline=EXCLUDED.scenario_at_late_deadline,
           scenario_final_action=EXCLUDED.scenario_final_action, late_outcome=EXCLUDED.late_outcome,
           late_verdict=EXCLUDED.late_verdict, late_valid_at_deadline=EXCLUDED.late_valid_at_deadline,
           intersection_codes=EXCLUDED.intersection_codes, verdict=EXCLUDED.verdict,
           direction_agreement=EXCLUDED.direction_agreement, payload=EXCLUDED.payload, updated_at=now()`,
        [
          row.id, row.version, row.kind, row.marketKey, row.marketType, row.candidateId, row.correlationId, row.executionId,
          row.scenarioObservationId, row.timingObservationId, row.versions.scenarioPolicyVersion, row.versions.scenarioEngineVersion,
          row.versions.timingPolicyVersion, row.versions.currentPolicyVersion,
          JSON.stringify(row.scenarioAtCandidate), JSON.stringify(row.scenarioAtLateDeadline), row.scenarioFinalAction,
          row.lateDeadlineAt, row.lateOutcome, row.lateVerdict, row.lateValidAtDeadline,
          JSON.stringify(row.intersectionCodes ?? []), row.verdict, row.directionAgreement, JSON.stringify(row),
        ],
      );
      this.persist.lastOkAt = this.now();
      return true;
    } catch (error) {
      this.persist.failures += 1; this.persist.lastError = String(error?.message ?? error).slice(0, 200);
      this.#safeLog("SCENARIO_TIMING_INTERSECTION_PERSIST_FAILED", { error: this.persist.lastError });
      return false;
    }
  }

  toJSON() { return { version: SCENARIO_TIMING_INTERSECTION_VERSION, intersections: this.list() }; }

  loadFrom(snapshot = {}) {
    if (!snapshot || !Array.isArray(snapshot.intersections)) return false;
    for (const row of snapshot.intersections.slice(-this.maxInMemory)) if (row?.id) { this.intersections.set(row.id, row); if (row.candidateId) this.byCandidate.set(row.candidateId, row.id); }
    return true;
  }
}

export const scenarioTimingIntersection = new ScenarioTimingIntersectionShadow();
