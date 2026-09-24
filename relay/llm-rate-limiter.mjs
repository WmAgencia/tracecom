/**
 * V3 — GLOBAL LLM REQUEST SCHEDULER (rate limiter compartilhado pelo provider).
 *
 * Controla o total de chamadas LLM do V3 em todo o runtime:
 * - maxConcurrentRequests configuravel (env LLM_MAX_CONCURRENCY, default conservador 8);
 * - fila global com prioridade: 1) CONSENSUS (apos Wave1), 2) deadline mais proximo, 3) novas Wave1;
 * - remaining budget: se nao couber mais antes do deadline => SKIPPED_PROVIDER_CAPACITY;
 * - HTTP 429: no maximo 1 retry curto SE retryAfter + latencia estimada couberem no deadline;
 *   senao FAIL-CLOSED com PROVIDER_RATE_LIMIT.
 * Nao bloqueia o event loop; nunca chama depois do analysis deadline.
 */
export const LLM_RATE_LIMITER_VERSION = "v3-llm-rate-limiter-v1";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLlmRateLimiter({ maxConcurrent = 8, now = () => Date.now(), log = () => {}, sleep = defaultSleep } = {}) {
  const state = {
    inflight: 0,
    queue: [],
    seq: 0,
    maxConcurrent: Math.max(1, Number(maxConcurrent) || 8),
    total: 0,
    skipped: 0,
    retries: 0,
    rateLimited: 0,
    recent429: 0,
    last429At: null,
    lastProviderError: null,
    lastErrorAt: null,
    startedAt: now(),
  };

  const safeError = (text) => {
    const value = String(text ?? "").slice(0, 200);
    return value.replace(/sk-[A-Za-z0-9_\-]+/g, "sk-***") || null;
  };

  function pump() {
    while (state.inflight < state.maxConcurrent && state.queue.length > 0) {
      const job = state.queue.shift();
      const remaining = job.deadlineAt - now();
      if (remaining <= 0) {
        state.skipped += 1;
        job.resolve({ status: "ERROR", reason: "SKIPPED_PROVIDER_CAPACITY", model: null, provider: null, limits: {}, text: null, parsed: null, latencyMs: null, usage: null, finishReason: null, httpStatus: null, skipped: true, queueWaitMs: now() - job.queuedAt });
        continue;
      }
      state.inflight += 1;
      const queueWaitMs = now() - job.queuedAt;
      Promise.resolve()
        .then(() => job.run(queueWaitMs))
        .finally(() => { state.inflight -= 1; pump(); });
    }
  }

  function push(job) {
    state.queue.push(job);
    state.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.deadlineAt !== b.deadlineAt) return a.deadlineAt - b.deadlineAt;
      return a.seq - b.seq;
    });
    pump();
  }

  /** `run` retorna o resultado do provider (runTextProvider). Re-tenta 429 no maximo 1x. */
  function run({ priority = 1, deadlineAt = null, execute, estimatedLatencyMs = 1500, suppressProviderError = false } = {}) {
    const seq = state.seq; state.seq += 1;
    state.total += 1;
    return new Promise((resolve) => {
      push({
        seq, priority, resolve, queuedAt: now(), deadlineAt: Number.isFinite(Number(deadlineAt)) && Number(deadlineAt) > 0 ? Number(deadlineAt) : now() + 20_000,
        run: async (queueWaitMs = 0) => {
          let result;
          try { result = await execute(); } catch (error) { result = { status: "ERROR", reason: error?.name === "AbortError" ? "TIMEOUT" : "ERROR", model: null, provider: null, limits: {}, text: null, parsed: null, latencyMs: null, usage: null, finishReason: null, httpStatus: null }; }
          if (Number(result?.httpStatus) === 429) {
            state.recent429 += 1; state.last429At = now(); state.rateLimited += 1;
            const retryAfter = retryAfterMs(result?.limits);
            const remaining = (Number.isFinite(Number(deadlineAt)) ? Number(deadlineAt) : now() + 20_000) - now();
            if (Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter + Number(estimatedLatencyMs) <= remaining) {
              state.retries += 1;
              await sleep(retryAfter);
              try { result = await execute(); } catch (error) { result = { status: "ERROR", reason: error?.name === "AbortError" ? "TIMEOUT" : "ERROR", model: null, provider: null, limits: {}, text: null, parsed: null, latencyMs: null, usage: null, finishReason: null, httpStatus: null }; }
            } else {
              result = { ...result, status: "ERROR", reason: "PROVIDER_RATE_LIMIT" };
            }
          }
          if (Number(result?.httpStatus) >= 400 && !suppressProviderError) { state.lastProviderError = safeError(result?.text ?? result?.reason); state.lastErrorAt = now(); }
          resolve({ ...result, queueWaitMs });
        },
      });
    });
  }

  function stats() {
    const t = now();
    return {
      version: LLM_RATE_LIMITER_VERSION,
      inflight: state.inflight,
      queueDepth: state.queue.length,
      maxConcurrent: state.maxConcurrent,
      total: state.total,
      skipped: state.skipped,
      retries: state.retries,
      rateLimited: state.rateLimited,
      recent429: t - (state.last429At ?? 0) < 60_000 ? state.recent429 : 0,
      last429At: state.last429At,
      lastProviderError: state.lastProviderError,
      lastErrorAt: state.lastErrorAt,
    };
  }

  return { run, stats };
}

function retryAfterMs(headers) {
  const raw = headers?.["retry-after"];
  if (raw === null || raw === undefined) return null;
  const value = Number(String(raw).trim());
  if (Number.isFinite(value)) return Math.max(0, value * 1000);
  const parsed = new Date(String(raw)).getTime();
  return Number.isFinite(parsed) ? Math.max(0, parsed - Date.now()) : null;
}