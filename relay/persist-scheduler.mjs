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

export const CRITICAL_SQL = /tc-critical|to_regclass|iq_runtime_config|iq_markets|iq_executions|iq_candles_5s|iq_rsi_instruments|iq_rsi_events_v4|iq_rsi_agent_state_v4|iq_rsi_opportunities_v4|iq_rsi_universe_v4|iq_auth_session|schema_migrations|iq_v4_export|iq_lab_|iq_perf_epoch|iq_mcp_config|iq_agent_config|iq_shadow_trades/i;

export const PERSIST_SCHEDULER_VERSION = "persist-scheduler-v3";

export function createPersistScheduler({ pool, maxInFlight = 5, maxQueue = 120, maxCriticalQueue = 1000, maxBestEffortPerSecond = 8, maxQueryMs = 12_000, breakerFailures = 6, breakerCooldownMs = 20_000, now = () => Date.now() } = {}) {
  if (!pool || typeof pool.__rawQuery !== "function") throw new Error("PERSIST_SCHEDULER_POOL_REQUIRED");
  const state = { inFlight: 0, queue: 0, dropped: 0, criticalDropped: 0, total: 0, critical: 0, bestEffort: 0, rateLimited: 0, consecutiveFailures: 0, breakerUntil: 0, lastDropAt: 0, rateWindowAt: now(), rateWindowCount: 0 };
  const queue = [];

  function stats() {
    return {
      version: PERSIST_SCHEDULER_VERSION,
      inFlight: state.inFlight, queue: state.queue, maxInFlight, maxQueue, maxCriticalQueue, maxBestEffortPerSecond,
      dropped: state.dropped, criticalDropped: state.criticalDropped, total: state.total,
      critical: state.critical, bestEffort: state.bestEffort, rateLimited: state.rateLimited,
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

  function drop(reason, { criticalDrop = false } = {}) {
    state.dropped += 1;
    if (criticalDrop) state.criticalDropped += 1;
    state.lastDropAt = now();
    return Promise.resolve({ rows: [], dropped: true, reason, bestEffort: !criticalDrop });
  }

  function rateOk() {
    const t = now();
    if (t - state.rateWindowAt >= 1_000) { state.rateWindowAt = t; state.rateWindowCount = 0; }
    state.rateWindowCount += 1;
    return state.rateWindowCount <= maxBestEffortPerSecond;
  }

  function query(text, params) {
    const sql = String(text ?? "");
    const critical = CRITICAL_SQL.test(sql);
    state.total += 1;
    if (critical) state.critical += 1; else state.bestEffort += 1;

    // Criticos: sempre admitidos (config/markets/executions/MESAS/state de execucao).
    // Fila de criticos e alta mas limitada — nunca cresce sem limite.
    if (critical && queue.length >= maxCriticalQueue) return drop("CRITICAL_QUEUE_FULL", { criticalDrop: true });
    // Best-effort: breaker aberto, fila cheia ou rate excedido => dropa (telemetria e descartavel).
    if (!critical) {
      if (now() < state.breakerUntil) return drop("BREAKER_OPEN");
      if (state.inFlight >= maxInFlight && queue.length >= maxQueue) return drop("QUEUE_FULL");
      if (!rateOk()) { state.rateLimited += 1; return drop("RATE_LIMITED"); }
    } else {
      rateOk(); // criticos contam no orcamento mas nunca sao dropados por rate
    }

    return new Promise((resolve, reject) => {
      const run = () => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          state.consecutiveFailures += 1;
          if (state.consecutiveFailures >= breakerFailures) state.breakerUntil = now() + breakerCooldownMs;
          if (!critical) drop("QUERY_TIMEOUT").then(resolve);
          else reject(new Error("QUERY_TIMEOUT"));
          state.inFlight = Math.max(0, state.inFlight - 1);
          pump();
        }, Math.max(200, Number(maxQueryMs) || 12_000));
        const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); state.inFlight = Math.max(0, state.inFlight - 1); pump(); };
        pool.__rawQuery(text, params)
          .then((result) => finish(() => { state.consecutiveFailures = 0; resolve(result); }))
          .catch((error) => finish(() => {
            state.consecutiveFailures += 1;
            if (state.consecutiveFailures >= breakerFailures) state.breakerUntil = now() + breakerCooldownMs;
            if (!critical) drop("DB_ERROR").then(resolve);
            else reject(error);
          }));
      };
      queue.push(run);
      state.queue = queue.length;
      pump();
    });
  }

  return { version: PERSIST_SCHEDULER_VERSION, query, stats };
}
