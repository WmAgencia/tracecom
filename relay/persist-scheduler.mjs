/**
 * PERSIST SCHEDULER — backpressure para o pool Postgres.
 *
 * Causa raiz dos 502: os modulos de shadow/telemetria (scenario-shadow,
 * timing-intersection, dual-round, late-window, indicator-5m, solo, V4 events)
 * persistem por mercado/candle. Quando o pooler fica lento, cada modulo segue
 * enfileirando queries e a fila cresce sem limite (>300 esperando), fazendo os
 * GET de observabilidade estourarem o timeout do edge.
 *
 * Regras:
 *  - limite de concorrencia (in-flight);
 *  - fila limitada para escrita BEST-EFFORT: excedente e DROPADO e contado
 *    (telemetria/shadow e best-effort; nunca derruba o runtime);
 *  - queries CRITICAS (audit/config/markets/executions/MESAS/state V4) nunca
 *    sao dropadas por fila cheia;
 *  - circuit breaker: apos N falhas consecutivas, pausa best-effort por um
 *    cooldown para o banco respirar (criticos continuam passando).
 *
 * Nenhuma regra de estrategia aqui — apenas agendamento de I/O.
 */

export const CRITICAL_SQL = /iq_audit_trail|iq_runtime_config|iq_markets|iq_executions|iq_rsi_instruments|iq_rsi_events_v4|iq_rsi_agent_state_v4|iq_rsi_opportunities_v4|iq_rsi_universe_v4|iq_auth_session|schema_migrations|iq_v4_export/i;

export const PERSIST_SCHEDULER_VERSION = "persist-scheduler-v1";

export function createPersistScheduler({ pool, maxInFlight = 5, maxQueue = 120, breakerFailures = 6, breakerCooldownMs = 20_000, now = () => Date.now() } = {}) {
  if (!pool || typeof pool.__rawQuery !== "function") throw new Error("PERSIST_SCHEDULER_POOL_REQUIRED");
  const state = { inFlight: 0, queue: 0, dropped: 0, droppedLastMinute: 0, total: 0, critical: 0, bestEffort: 0, consecutiveFailures: 0, breakerUntil: 0, lastDropAt: 0 };
  const queue = [];

  function stats() {
    return {
      version: PERSIST_SCHEDULER_VERSION,
      inFlight: state.inFlight, queue: state.queue, maxInFlight, maxQueue,
      dropped: state.dropped, total: state.total, critical: state.critical, bestEffort: state.bestEffort,
      consecutiveFailures: state.consecutiveFailures,
      breakerActive: now() < state.breakerUntil,
      breakerUntil: state.breakerUntil > now() ? new Date(state.breakerUntil).toISOString() : null,
    };
  }

  function pump() {
    while (state.inFlight < maxInFlight && queue.length > 0) {
      const job = queue.shift();
      state.queue = queue.length;
      state.inFlight += 1;
      job();
    }
  }

  function drop(bestEffortResult) {
    state.dropped += 1;
    state.droppedLastMinute += 1;
    state.lastDropAt = now();
    return Promise.resolve(bestEffortResult);
  }

  function query(text, params) {
    const sql = String(text ?? "");
    const critical = CRITICAL_SQL.test(sql);
    state.total += 1;
    if (critical) state.critical += 1; else state.bestEffort += 1;

    // Best-effort saturado: dropa (nunca espalha a fila) — telemetria e descartavel.
    if (!critical && (state.inFlight >= maxInFlight && queue.length >= maxQueue)) return drop({ rows: [], dropped: true, reason: "QUEUE_FULL", bestEffort: true });
    if (!critical && now() < state.breakerUntil) return drop({ rows: [], dropped: true, reason: "BREAKER_OPEN", bestEffort: true });

    return new Promise((resolve, reject) => {
      const run = () => {
        pool.__rawQuery(text, params)
          .then((result) => { state.consecutiveFailures = 0; resolve(result); })
          .catch((error) => {
            state.consecutiveFailures += 1;
            if (state.consecutiveFailures >= breakerFailures) state.breakerUntil = now() + breakerCooldownMs;
            if (!critical) drop({ rows: [], dropped: true, reason: "DB_ERROR", bestEffort: true }).then(resolve);
            else reject(error);
          })
          .finally(() => { state.inFlight = Math.max(0, state.inFlight - 1); pump(); });
      };
      queue.push(run);
      state.queue = queue.length;
      pump();
    });
  }

  return { version: PERSIST_SCHEDULER_VERSION, query, stats };
}
