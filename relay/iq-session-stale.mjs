/**
 * V3 — DETECCAO DE SESSAO IQ EXPIrada (fail-closed, sem loop infinito de SSID obsoleto).
 *
 * STALE somente com EVIDENCIA: WS conectado + time valid + conta PRACTICE NAO verificada
 * por N conexoes consecutivas. Timeout transitório / queda de rede / heartbeat perdido /
 * manutencao => NAO invalida (strikes zeram quando o WS cai ou a conta verifica).
 */
export const IQ_SESSION_STALE_VERSION = "v3-iq-session-stale-v1";

export function evaluateIqSessionStaleness({ wsConnected = false, timeValid = false, practiceVerified = false, strikes = 0, priorStale = false, minStrikes = 3 } = {}) {
  const live = wsConnected === true && timeValid === true;
  const nextStrikes = live && practiceVerified !== true ? Number(strikes) + 1 : 0;
  const stale = priorStale === true || nextStrikes >= Math.max(1, Number(minStrikes) || 3);
  return {
    stale,
    strikes: nextStrikes,
    state: stale ? "IQ_SESSION_EXPIRED" : nextStrikes > 0 ? "SESSION_UNDER_EVALUATION" : "SESSION_OK",
    reason: stale ? "IQ_LOGIN_REQUIRED" : null,
  };
}