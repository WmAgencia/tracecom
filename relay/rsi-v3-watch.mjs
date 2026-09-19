/**
 * RSI V3.1 — SCHEDULER/MONITORAMENTO (nenhuma regra direcional aqui).
 *
 * Estados:
 *  - NORMAL_SCAN: sem candidate; scan normal do mercado.
 *  - ACTIVE_CANDIDATE: candidate vivo; avaliar a CADA candle de 5s (sem throttle generico).
 *  - PRIORITY_FINAL_WATCH: candidate proximo do cutoff; prioridade + garantia de avaliacao final causal.
 *
 * Regras:
 *  - Event-driven: a avaliacao acontece quando um candle de 5s fecha (nunca busy loop).
 *  - Dedupe por candle (bucketEnd): no maximo UMA avaliacao por candle por mercado.
 *  - Nunca avalia depois do cutoff; MISSED continua fail-closed.
 */

export const RSI_V3_WATCH_POLICY = Object.freeze({
  version: "rsi-v3-watch-v1",
  priorityLeadMs: 10_000,
  normalThrottleMs: 2_000,
  candleMs: 5_000,
});

/** Modo de observacao para o mercado dado o candidate vivo e a janela da expiracao alvo. */
export function watchModeFor({ hasCandidate = false, at = null, window = null, priorityLeadMs = RSI_V3_WATCH_POLICY.priorityLeadMs } = {}) {
  if (!hasCandidate) return "NORMAL_SCAN";
  const atMs = Number(at);
  const opensAt = window ? Number(window.entryWindowOpensAt) : null;
  if (Number.isFinite(atMs) && Number.isFinite(opensAt) && atMs >= opensAt - priorityLeadMs) return "PRIORITY_FINAL_WATCH";
  return "ACTIVE_CANDIDATE";
}

/**
 * Decide se esta chamada deve avaliar o mercado (event-driven, 1x por candle).
 * - Com candidate: ignora o throttle generico; so dedupe de candle.
 * - Sem candidate: dedupe de candle + throttle curto anti-duplicata.
 */
export function shouldEvaluate({ now = null, lastAt = null, bucketEnd = null, lastBucket = null, candidateActive = false, throttleMs = RSI_V3_WATCH_POLICY.normalThrottleMs } = {}) {
  const nowMs = Number(now);
  const bucket = bucketEnd === null || bucketEnd === undefined ? null : Number(bucketEnd);
  const lastBucketMs = lastBucket === null || lastBucket === undefined ? null : Number(lastBucket);
  if (bucket !== null && lastBucketMs !== null && bucket === lastBucketMs) return false;
  if (candidateActive) return true;
  const lastAtMs = Number(lastAt);
  if (Number.isFinite(nowMs) && Number.isFinite(lastAtMs) && nowMs - lastAtMs < throttleMs) return false;
  return true;
}

export function createWatchRecord({ marketKey, candidateAt, targetExpiryAt, at } = {}) {
  return {
    marketKey, watchKey: `${candidateAt}:${targetExpiryAt}`, candidateAt: Number(candidateAt), expiryAt: Number(targetExpiryAt),
    mode: "ACTIVE_CANDIDATE", startedAt: Number(at), priorityStartedAt: null,
    evaluationCount: 0, lastEvaluationAt: null, evaluationGapMs: null, maxEvaluationGapMs: 0,
    timeToExpiryMs: null, timeToCutoffMs: null,
    finalEvaluationAt: null, finalEvaluationLeadMs: null,
    revalidationAt: null, submitAt: null, submitLatencyMs: null,
    missedReported: false, cancelledReported: false, finalReported: false,
  };
}

export function touchWatchRecord(record, { at, mode = null, timeToExpiryMs = null, timeToCutoffMs = null } = {}) {
  const atMs = Number(at);
  if (record.lastEvaluationAt !== null) {
    const gap = atMs - record.lastEvaluationAt;
    if (gap >= 0) { record.evaluationGapMs = gap; if (gap > record.maxEvaluationGapMs) record.maxEvaluationGapMs = gap; }
  } else {
    record.evaluationGapMs = null;
  }
  record.evaluationCount += 1;
  record.lastEvaluationAt = atMs;
  if (mode) record.mode = mode;
  if (timeToExpiryMs !== null) record.timeToExpiryMs = timeToExpiryMs;
  if (timeToCutoffMs !== null) record.timeToCutoffMs = timeToCutoffMs;
  return record;
}
