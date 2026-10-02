/**
 * SESSÃO = entre ATIVAR confirmado pelo runtime e DESATIVAR confirmado.
 * Funções puras (sem I/O) para poderem ser testadas offline.
 */
import { summarize } from './stats.mjs';

export const STATES = ['STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'DEGRADED'];

export function newSessionId(now = Date.now(), rand = Math.random) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `s-${stamp}-${Math.floor(rand() * 0xffff).toString(16).padStart(4, '0')}`;
}

export function openSession({
  id, requestedAt, account = null, stakeApplied = null, engine = null,
  pid = null, logFile = null, source = 'panel',
}) {
  return {
    id,
    requestedAt: requestedAt ?? new Date().toISOString(),
    startedAt: null,          // só quando o runtime confirma (telemetria do bot)
    endedAt: null,
    endReason: null,
    exitCode: null,
    state: 'STARTING',
    source,
    pid,
    logFile,
    account,
    stakeApplied,
    engine,
    startBalance: null,
    endBalance: null,
    stats: summarize([]),
    botStats: null,
    tradeIds: [],
    error: null,
  };
}

/** Fecha a sessão com os números do LEDGER (fonte da verdade) + o que o bot reportou. */
export function finalizeSession(session, {
  endedAt, endReason = null, exitCode = null, endBalance = null, trades = [], botStats = null, error = null,
}) {
  const own = trades.filter((t) => t.sessionId === session.id);
  const stats = summarize(own);
  return {
    ...session,
    state: 'STOPPED',
    endedAt: endedAt ?? new Date().toISOString(),
    endReason: endReason ?? session.endReason ?? null,
    exitCode: exitCode ?? session.exitCode ?? null,
    endBalance: Number.isFinite(Number(endBalance)) ? Number(endBalance) : session.endBalance,
    stats,
    botStats: botStats ?? session.botStats,
    tradeIds: own.map((t) => t.id),
    error: error ?? session.error,
  };
}

/**
 * Estado REAL do runtime, derivado (nunca otimista).
 * live: último retrato de telemetry/live.json (ou null) · pidAlive: função/booleano.
 */
export function deriveState({ runtime, live, pidAlive, now = Date.now(), liveStaleMs = 6_000 } = {}) {
  const pid = Number(runtime?.pid ?? 0);
  const alive = typeof pidAlive === 'function' ? Boolean(pid > 0 && pidAlive(pid)) : Boolean(pidAlive);
  const liveAt = live?.updatedAt ? Date.parse(live.updatedAt) : 0;
  const fresh = Number.isFinite(liveAt) && liveAt > 0 && now - liveAt <= liveStaleMs;
  const stopRequested = Boolean(runtime?.stop?.requestedAt);
  const exiting = Boolean(live?.stopped);

  if (!alive || exiting) return 'STOPPED';
  if (stopRequested) return 'STOPPING';
  if (!fresh) return 'DEGRADED';            // processo vivo sem telemetria fresca
  if (live?.warmupDone && live?.startedAt) return 'RUNNING';
  return 'STARTING';
}
