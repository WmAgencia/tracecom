/**
 * V3 — EXECUTION/SAFETY GATE (deterministico) v2.
 *
 * A direcao de mercado vem do CONSENSUS FINAL (LLM, Wave 2). Este modulo NAO decide mercado:
 * nao conta familias, nao exige direcao do Asset, nao aplica heuristica tecnica, nao vota.
 * Ele somente valida CONTRATO OPERACIONAL e SEGURANCA; qualquer falha => CANCEL (fail-closed).
 */
export const V3_EXECUTION_GATE_VERSION = "v3-execution-gate-v2";

export const GATE_RESULTS = Object.freeze(["APPROVE_BUY", "APPROVE_SELL", "CANCEL"]);
const APPROVALS = new Set(["APPROVE_BUY", "APPROVE_SELL"]);
export const EXPECTED_AGENT_CALLS = 7;

/** Autoridade direcional FINAL: SEMPRE do Consensus Final (LLM). Asset e hipotese independente, nunca sobrescreve. */
export function canonicalDecisionDirection(consensus) {
  const result = consensus?.result ?? null;
  if (result === "APPROVE_BUY") return "UP";
  if (result === "APPROVE_SELL") return "DOWN";
  return "NONE";
}

export function executionGate({
  consensus = null,
  calls = [],
  timing = null,
  opportunityId = null,
  latencyTotalMs = null,
  deadlineMs = null,
  stalenessMs = null,
  analysisAtMs = null,
  now = Date.now(),
} = {}) {
  const checks = [];
  const reasons = [];
  const check = (id, ok, detail = null) => { checks.push({ id, ok: ok === true, detail }); if (ok !== true) reasons.push(id); return ok === true; };

  // 1) Contrato de chamadas: 7/7 OK, mesmo opportunityId.
  const allOk = calls.length === EXPECTED_AGENT_CALLS && calls.every((call) => call?.status === "OK");
  check("ALL_AGENT_CALLS_OK", allOk, { count: calls.length, expected: EXPECTED_AGENT_CALLS, failed: calls.filter((call) => call?.status !== "OK").map((call) => call?.role ?? null) });
  if (opportunityId) {
    const sameOpportunity = calls.every((call) => !call?.opportunityId || call.opportunityId === opportunityId);
    check("SAME_OPPORTUNITY_ID", sameOpportunity, opportunityId);
  }

  // 2) Decisao presente e com contrato valido (schema ja validado no client; aqui so o minimo de seguranca).
  check("DECISION_PRESENT", Boolean(consensus && typeof consensus === "object"));
  const result = consensus?.result ?? null;
  check("RESULT_ENUM", GATE_RESULTS.includes(result), result);
  const approving = APPROVALS.has(result);
  if (approving) {
    check("RESULT_DIRECTION_CONSISTENT", (result === "APPROVE_BUY" && consensus?.direction === "UP") || (result === "APPROVE_SELL" && consensus?.direction === "DOWN"), { result, direction: consensus?.direction ?? null });
    // 3) A propria decisao nao pode declarar blockers/invalidations/ambiguidades ativos ao aprovar.
    check("NO_DECLARED_BLOCKERS", (consensus?.blockers ?? []).length === 0, consensus?.blockers ?? []);
    check("NO_ACTIVE_INVALIDATIONS", (consensus?.invalidations ?? []).length === 0, consensus?.invalidations ?? []);
    check("NO_MARKET_AMBIGUITIES", (consensus?.marketAmbiguities ?? []).length === 0, consensus?.marketAmbiguities ?? []);
  }

  // 4) Timing estrategico e deadline de analise (operacional, nao tecnico).
  if (timing) {
    const tte = Number(timing.tteMs);
    check("ANALYSIS_WINDOW", Number.isFinite(tte) ? (tte > 300_000 && tte <= 330_000) : false, timing);
  }
  if (deadlineMs !== null && deadlineMs !== undefined && latencyTotalMs !== null && latencyTotalMs !== undefined) {
    check("ANALYSIS_DEADLINE_RESPECTED", Number(latencyTotalMs) <= Number(deadlineMs), { latencyTotalMs, deadlineMs });
  }
  if (stalenessMs !== null && stalenessMs !== undefined && analysisAtMs !== null && analysisAtMs !== undefined) {
    check("FRESHNESS", (Number(now) - Number(analysisAtMs)) <= Number(stalenessMs), { ageMs: Number(now) - Number(analysisAtMs), stalenessMs });
  }

  const pass = checks.every((item) => item.ok);
  // Fail-closed: se qualquer contrato falhar, CANCEL. Nunca inventa BUY/SELL.
  const gated = pass ? (GATE_RESULTS.includes(result) ? result : "CANCEL") : "CANCEL";
  return {
    version: V3_EXECUTION_GATE_VERSION,
    pass,
    result: gated,
    consensusResult: result,
    direction: result === "APPROVE_BUY" ? "UP" : result === "APPROVE_SELL" ? "DOWN" : (consensus?.direction ?? "NONE"),
    checks,
    reasons,
  };
}
