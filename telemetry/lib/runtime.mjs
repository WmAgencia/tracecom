/**
 * SUPERVISOR DO RUNTIME — start/stop pelo MESMO fluxo operacional que já existe.
 * =============================================================================
 * ATIVAR  = subir o processo exatamente como o operador sobe:
 *           `node ws-otc-v15.mjs <conta>` (mesmo arquivo, mesma config, mesma conta).
 * DESATIVAR = pedir a parada pelo arquivo de controle; quem executa é o MESMO
 *           `shutdown()` da tecla K/Ctrl+C dentro do bot (não existe segundo
 *           caminho de parada). SIGTERM/SIGKILL só como último recurso técnico.
 * O painel NUNCA fala com a IQ, nunca envia ordem, nunca troca de conta.
 *
 * `createRuntime` aceita injeção (dir/arquivos/spawn) para os testes rodarem
 * isolados, em pasta temporária, sem tocar no bot de verdade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PATHS, ensureDir, readJson, writeJsonAtomic, fileStat } from './store.mjs';
import { deriveState, newSessionId, openSession, finalizeSession } from './sessions.mjs';
import { emptyLedger, ingestRecords } from './ingest.mjs';
import { summarize } from './stats.mjs';
import { engineFingerprint } from '../tools/proof-snapshot.mjs';

const TICK_MS = 500;
const LIVE_STALE_MS = 6_000;
const STOP_GRACE_MS = 25_000;
const STOP_KILL_MS = 6_000;
const LOG_RING = 400;

export const DEFAULT_PANEL_CONFIG = {
  schema: 'tracecom-panel-config-v1',
  host: '127.0.0.1',
  port: 8787,
  account: 'demo',
  _nota: 'host 127.0.0.1 = só esta máquina. account é READ-ONLY no painel: para trocar de conta edite este arquivo (o painel nunca troca conta sozinho).',
};

export function loadPanelConfig(file = PATHS.panelConfig) {
  const existing = readJson(file, null);
  if (!existing || typeof existing !== 'object') {
    ensureDir(path.dirname(file));
    writeJsonAtomic(file, DEFAULT_PANEL_CONFIG);
    return { ...DEFAULT_PANEL_CONFIG };
  }
  const merged = { ...DEFAULT_PANEL_CONFIG, ...existing };
  merged.account = merged.account === 'real' ? 'real' : 'demo';
  merged.port = Number.isFinite(Number(merged.port)) ? Number(merged.port) : DEFAULT_PANEL_CONFIG.port;
  merged.host = typeof merged.host === 'string' && merged.host ? merged.host : DEFAULT_PANEL_CONFIG.host;
  return merged;
}

/** Troca SÓ o número do `baseStake`, preservando o resto do arquivo byte-a-byte. */
export function patchBaseStake(rawConfig, value) {
  const re = /("baseStake"\s*:\s*)(-?\d+(?:\.\d+)?)/g;
  const matches = [...rawConfig.matchAll(re)];
  if (matches.length !== 1) throw new Error(`baseStake esperado 1x no arquivo, encontrado ${matches.length}`);
  return rawConfig.replace(re, `$1${value}`);
}

export function isAlive(pid) {
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

export function parseLogLine(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return null;
  if (text.startsWith('[\u23F1')) return null;      // linha do odômetro do terminal: refresh, não é evento
  const ev = { at: new Date().toISOString(), text: text.slice(0, 400), kind: 'log' };
  if (text.includes('[📤 ORDEM]')) return { ...ev, kind: 'order', level: 'info' };
  if (text.includes('[✂️ REVERSÃO]')) return { ...ev, kind: 'sell-request', level: 'warn' };
  if (text.startsWith('[✂️✅]') || text.startsWith('[✂️❌]')) return { ...ev, kind: 'sell', level: 'info' };
  if (/^\[(✅|❌|➖)\]\s/.test(text)) return { ...ev, kind: 'result', level: text.startsWith('[✅]') ? 'info' : 'warn' };
  if (text.includes('[🛑 TRAVA DE PERDA]')) return { ...ev, kind: 'guard', level: 'error' };
  if (text.includes('[⛔ BLOQUEADO]')) return { ...ev, kind: 'guard', level: 'error' };
  if (text.includes('[⏸ PAUSA]')) return { ...ev, kind: 'guard', level: 'warn' };
  if (text.includes('[🛑] Encerrando')) return { ...ev, kind: 'shutdown', level: 'warn' };
  if (text.includes('[✅] OPERANDO')) return { ...ev, kind: 'ready', level: 'info' };
  if (text.includes('[💼] CONTA')) return { ...ev, kind: 'account', level: 'info' };
  if (text.includes('[🧬] CÓDIGO')) return { ...ev, kind: 'build', level: 'info' };
  if (text.includes('[WS]')) return { ...ev, kind: 'ws', level: 'warn' };
  if (text.includes('[⚠️]')) return { ...ev, kind: 'warn', level: 'warn' };
  if (text.includes('[📋]') || text.includes('[🔁] universo') || text.includes('[🔁] histórico')) return { ...ev, kind: 'universe', level: 'info' };
  if (text.includes('[👁️]') || text.includes('[🔍]')) return { ...ev, kind: 'diag', level: 'info' };
  return ev;
}

export function parseEndReason(logText) {
  const m = /\[🛑\] Encerrando \(([^)]+)\)/.exec(logText ?? '');
  return m ? m[1] : null;
}

export function createRuntime({
  log = () => {},
  dir = PATHS.panel,
  resultsFile = PATHS.results,
  configFile = PATHS.config,
  engineFile = PATHS.engine,
  spawnImpl = nodeSpawn,
  panelConfigFile = PATHS.panelConfig,
  isAliveImpl = isAlive,
  tickMs = TICK_MS,
} = {}) {
  const paths = {
    dir,
    logs: path.join(dir, 'logs'),
    live: path.join(dir, 'live.json'),
    control: path.join(dir, 'control.json'),
    runtime: path.join(dir, 'runtime.json'),
    trades: path.join(dir, 'ledger', 'trades.json'),
    sessions: path.join(dir, 'ledger', 'sessions.json'),
    results: resultsFile,
    config: configFile,
    engine: engineFile,
  };
  ensureDir(paths.logs);
  ensureDir(path.dirname(paths.trades));
  const panelConfig = loadPanelConfig(panelConfigFile);
  const state = {
    child: null, pid: null, sessionId: null, starting: false,
    errors: [], events: [], logFile: null, lastExit: null, stopTimers: [], lastResultsMtime: 0,
  };

  const safeRead = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
  const readLive = () => readJson(paths.live, null);
  const readRuntimeFile = () => readJson(paths.runtime, {}) ?? {};
  const readTradesLedger = () => readJson(paths.trades, null) ?? emptyLedger();
  const readSessions = () => {
    const doc = readJson(paths.sessions, null);
    return { schema: 'tracecom-session-ledger-v1', updatedAt: new Date().toISOString(), sessions: Array.isArray(doc?.sessions) ? doc.sessions : [] };
  };
  const writeSessions = (doc) => writeJsonAtomic(paths.sessions, { ...doc, updatedAt: new Date().toISOString() });

  function pushEvent(ev) {
    if (!ev) return;
    state.events.push(ev);
    if (state.events.length > LOG_RING) state.events.splice(0, state.events.length - LOG_RING);
  }

  function appendLog(text) {
    if (state.logFile) { try { fs.appendFileSync(state.logFile, text); } catch { /* best-effort */ } }
    // O odômetro do terminal usa `\r` como fronteira (refresh no lugar): cada `\r`/`\n`
    // é uma linha. Separar pelos dois mantém a linha real que vier colada no refresh.
    for (const line of String(text).split(/[\r\n]+/)) pushEvent(parseLogLine(line));
  }

  function persistRuntime(patch = {}) {
    const doc = { ...readRuntimeFile(), ...patch };
    writeJsonAtomic(paths.runtime, doc);
    return doc;
  }

  function clearStopRequest() {
    writeJsonAtomic(paths.control, { schema: 'tracecom-control-v1', stop: null, updatedAt: new Date().toISOString() });
  }

  function currentSession() {
    return readSessions().sessions.find((s) => s.id === state.sessionId) ?? null;
  }

  function upsertSession(session) {
    const doc = readSessions();
    const at = doc.sessions.findIndex((s) => s.id === session.id);
    if (at === -1) doc.sessions.push(session); else doc.sessions[at] = session;
    writeSessions(doc);
    return session;
  }

  function sessionSinceMs(sessionId) {
    const session = readSessions().sessions.find((s) => s.id === sessionId);
    if (!session) return NaN;
    return Date.parse(session.startedAt ?? session.requestedAt ?? '') || NaN;
  }

  function ingestFromResults({ sessionId = null, force = false } = {}) {
    const stat = fileStat(paths.results);
    if (!stat.exists) return { added: 0, updated: 0, pending: 0 };
    if (!force && stat.mtimeMs === state.lastResultsMtime) return { added: 0, updated: 0, pending: 0, unchanged: true };
    state.lastResultsMtime = stat.mtimeMs;
    const raw = readJson(paths.results, null);
    if (!Array.isArray(raw)) return { added: 0, updated: 0, pending: 0 };   // escrita parcial: tenta no próximo tick
    const ledger = readTradesLedger();
    const res = ingestRecords(ledger, raw, {
      sessionId,
      sinceMs: sessionId ? sessionSinceMs(sessionId) : NaN,
      currency: readLive()?.currencySymbol ?? 'R$',
    });
    if (res.added) {
      writeJsonAtomic(paths.trades, res.ledger);
      log(`[LEDGER] +${res.added} novos, ${res.pending} em aberto, ${res.skipped} repetidos (sessão ${sessionId ?? 'fora de sessão'})`);
    }
    return res;
  }

  // ─── START ──────────────────────────────────────────────────────────────────
  function start({ confirmReal = null } = {}) {
    const current = api.snapshot();
    if (current.state !== 'STOPPED') return { ok: false, code: 'ALREADY_RUNNING', state: current.state };
    const account = panelConfig.account;
    if (account === 'real' && confirmReal !== 'REAL') {
      return { ok: false, code: 'REAL_CONFIRMATION_REQUIRED', message: 'conta real exige confirmação explícita' };
    }
    clearStopRequest();
    const now = Date.now();
    const sessionId = newSessionId(now);
    const logFile = path.join(paths.logs, `bot-${sessionId}.log`);
    const child = spawnImpl(process.execPath, [paths.engine, account], {
      cwd: path.dirname(paths.engine),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    state.child = child;
    state.pid = child.pid;
    state.sessionId = sessionId;
    state.logFile = logFile;
    state.starting = true;
    state.lastExit = null;
    state.errors = [];
    state.lastResultsMtime = 0;
    pushEvent({ at: new Date().toISOString(), kind: 'start', level: 'info', text: `ATIVAR → ${account.toUpperCase()} | pid ${child.pid} | sessão ${sessionId}` });

    const write = (buf) => appendLog(buf.toString('utf8'));
    child.stdout?.on('data', write);
    child.stderr?.on('data', write);
    child.on('error', (err) => {
      pushEvent({ at: new Date().toISOString(), kind: 'fatal', level: 'error', text: `falha ao subir o bot: ${err?.message ?? err}` });
      state.errors.push(String(err?.message ?? err));
    });
    child.on('exit', (code, signal) => onExit(code, signal));

    upsertSession(openSession({
      id: sessionId,
      requestedAt: new Date(now).toISOString(),
      account: { type: account === 'real' ? 'REAL' : 'DEMO' },
      stakeApplied: api.stake().configured,
      engine: {
        rev: 'V16',
        fileHash: null,
        engineFingerprint: (() => { try { return engineFingerprint(paths.engine); } catch { return null; } })(),
      },
      pid: child.pid,
      logFile,
      source: 'panel',
    }));
    persistRuntime({
      schema: 'tracecom-runtime-v1',
      sessionId, pid: child.pid, account,
      requestedAt: new Date(now).toISOString(), logFile, stop: null,
    });
    return { ok: true, code: 'STARTING', sessionId, pid: child.pid, state: 'STARTING' };
  }

  // ─── STOP ───────────────────────────────────────────────────────────────────
  function stop({ force = false } = {}) {
    const snap = api.snapshot();
    if (snap.state === 'STOPPED') return { ok: true, code: 'ALREADY_STOPPED', state: 'STOPPED' };
    const open = Number(snap.live?.openPositions?.length ?? 0);
    if (open > 0 && !force) {
      return { ok: false, code: 'OPEN_POSITIONS', open, requiresConfirmation: true, message: 'existem posições abertas — parar agora abandona o acompanhamento delas' };
    }
    const id = randomUUID();
    const requestedAt = new Date().toISOString();
    writeJsonAtomic(paths.control, { schema: 'tracecom-control-v1', stop: { id, requestedAt, reason: 'PAINEL' }, updatedAt: requestedAt });
    writeJsonAtomic(paths.runtime, { ...readRuntimeFile(), pid: state.pid, sessionId: state.sessionId, stop: { id, requestedAt } });
    pushEvent({ at: requestedAt, kind: 'stop', level: 'warn', text: 'DESATIVAR → pedido de parada enviado ao bot (mesmo shutdown da tecla K)' });

    const pid = state.pid;
    const graceful = setTimeout(() => {
      if (isAliveImpl(pid)) {
        log(`[STOP] sem saída em ${STOP_GRACE_MS / 1000}s — enviando SIGTERM`);
        try { process.kill(pid, 'SIGTERM'); } catch { /* já morreu */ }
      }
    }, STOP_GRACE_MS);
    const forced = setTimeout(() => {
      if (isAliveImpl(pid)) {
        log('[STOP] ainda vivo — SIGKILL (último recurso)');
        try { process.kill(pid, 'SIGKILL'); } catch { /* já morreu */ }
      }
    }, STOP_GRACE_MS + STOP_KILL_MS);
    graceful.unref?.();
    forced.unref?.();
    state.stopTimers.push(graceful, forced);
    return { ok: true, code: 'STOPPING', state: 'STOPPING', open };
  }

  function onExit(code, signal) {
    const sessionId = state.sessionId;
    const reasonFromLog = state.logFile ? parseEndReason(safeRead(state.logFile)) : null;
    const live = readLive();
    ingestFromResults({ sessionId, force: true });
    const session = currentSession();
    if (session) {
      const ended = finalizeSession(session, {
        endedAt: new Date().toISOString(),
        endReason: reasonFromLog ?? live?.stopReason ?? (signal ? `signal:${signal}` : 'exit'),
        exitCode: code,
        endBalance: live?.balance ?? null,
        trades: readTradesLedger().trades,
        botStats: live?.stats ?? null,
        error: state.errors.length ? state.errors.join('; ') : null,
      });
      upsertSession(ended);
      log(`[SESSÃO] ${ended.id} encerrada (${ended.endReason}) | ${ended.stats.ops} ops | W${ended.stats.wins}/L${ended.stats.losses}/D${ended.stats.draws} | ${ended.stats.profit}`);
    }
    pushEvent({ at: new Date().toISOString(), kind: 'exit', level: 'warn', text: `bot encerrou (código ${code}${signal ? `, sinal ${signal}` : ''})` });
    state.child = null;
    state.pid = null;
    state.sessionId = null;
    state.starting = false;
    state.lastExit = { at: new Date().toISOString(), code, signal };
    for (const t of state.stopTimers) clearTimeout(t);
    state.stopTimers = [];
    persistRuntime({ pid: null, sessionId: null, stoppedAt: new Date().toISOString() });
  }

  /** Adota uma sessão que já está rodando (reinício do painel ou bot subido na mão). */
  function adoptExternal(live) {
    const startedAt = new Date(live.startedAt).toISOString();
    const id = `ext-${live.pid}-${Date.parse(startedAt)}`;
    const exists = readSessions().sessions.some((s) => s.id === id);
    state.pid = Number(live.pid);
    state.sessionId = id;
    state.starting = false;
    if (!exists) {
      upsertSession({
        ...openSession({
          id,
          requestedAt: startedAt,
          account: { type: live.accountType ?? null, currency: live.currencySymbol === 'US$' ? 'USD' : 'BRL' },
          stakeApplied: Number(live?.config?.baseStake) || null,
          engine: { rev: live.rev ?? 'V16', fileHash: live.codeHash ?? null, engineFingerprint: null },
          pid: Number(live.pid),
          source: 'terminal',
        }),
        startedAt,
        state: 'RUNNING',
        startBalance: Number.isFinite(Number(live.sessionStartBalance)) ? Number(live.sessionStartBalance) : null,
      });
    }
    persistRuntime({ schema: 'tracecom-runtime-v1', sessionId: id, pid: Number(live.pid), account: live.accountType === 'REAL' ? 'real' : 'demo', requestedAt: startedAt, external: true, stop: null });
    pushEvent({ at: new Date().toISOString(), kind: 'adopt', level: 'warn', text: `sessão ${id} adotada — bot já estava rodando (pid ${live.pid})` });
    log(`[SESSÃO] ${id} adotada (pid ${live.pid})`);
    return { adopted: true, pid: state.pid, sessionId: id };
  }

  function adopt() {
    const doc = readRuntimeFile();
    const pid = Number(doc?.pid ?? 0);
    if (pid && isAliveImpl(pid)) {
      state.pid = pid;
      state.sessionId = doc.sessionId ?? null;
      state.logFile = doc.logFile ?? null;
      state.starting = false;
      pushEvent({ at: new Date().toISOString(), kind: 'adopt', level: 'warn', text: `sessão ${doc.sessionId ?? '?'} adotada (pid ${pid} já estava rodando)` });
      return { adopted: true, pid, sessionId: state.sessionId };
    }
    if (doc?.pid) {
      const pending = readSessions().sessions.find((s) => s.id === doc.sessionId && !s.endedAt);
      if (pending) {
        const liveBefore = readLive();
        upsertSession(finalizeSession(pending, {
          endedAt: liveBefore?.updatedAt ?? new Date().toISOString(),
          endReason: 'painel fora (processo encerrado)',
          endBalance: liveBefore?.balance ?? null,
          trades: readTradesLedger().trades,
          botStats: liveBefore?.stats ?? null,
        }));
        log(`[SESSÃO] ${pending.id} fechada retroativamente (o painel estava fora)`);
      }
      persistRuntime({ pid: null, sessionId: null, stoppedAt: new Date().toISOString() });
    }
    const live = readLive();
    const fresh = live?.updatedAt ? Date.now() - Date.parse(live.updatedAt) <= LIVE_STALE_MS : false;
    if (fresh && live?.pid && isAliveImpl(live.pid) && live.warmupDone && live.startedAt) return adoptExternal(live);
    return { adopted: false };
  }

  function tick() {
    const live = readLive();
    if (live?.startedAt && live?.warmupDone && state.sessionId) {
      const session = currentSession();
      if (session && !session.startedAt) {
        upsertSession({
          ...session,
          startedAt: new Date(live.startedAt).toISOString(),
          state: 'RUNNING',
          startBalance: Number.isFinite(Number(live.sessionStartBalance)) ? Number(live.sessionStartBalance) : null,
          stakeApplied: Number(live?.config?.baseStake) || session.stakeApplied,
          account: live.accountType ? { type: live.accountType, currency: live.currencySymbol === 'US$' ? 'USD' : 'BRL' } : session.account,
        });
        log(`[SESSÃO] ${session.id} confirmada pelo runtime (startedAt=${new Date(live.startedAt).toISOString()})`);
      }
    }
    if (state.pid && !isAliveImpl(state.pid)) onExit(state.lastExit?.code ?? null, null);
    if (!state.pid && live?.pid && live?.warmupDone && live?.startedAt) {
      const fresh = live.updatedAt ? Date.now() - Date.parse(live.updatedAt) <= LIVE_STALE_MS : false;
      if (fresh && isAliveImpl(live.pid)) adoptExternal(live);
    }
    // Ingestão contínua: o run pode operar fora do painel (ou a sessão acabou de fechar) e
    // nada pode ser perdido. Sem sessão aberta, o trade entra como "fora de sessão".
    ingestFromResults({ sessionId: state.sessionId });
  }

  const timer = setInterval(() => { try { tick(); } catch (err) { log(`[TICK] erro: ${err?.message ?? err}`); } }, tickMs);
  timer.unref?.();

  const api = {
    paths,
    panelConfig,
    events: () => state.events.slice(),
    ingestFromResults,
    readTrades: () => readTradesLedger(),
    readLive,
    readSessions,
    logFile: () => state.logFile,
    tick,
    stopTimer: () => clearInterval(timer),

    snapshot() {
      const live = readLive();
      const runtimeDoc = readRuntimeFile();
      const stateName = deriveState({ runtime: runtimeDoc, live, pidAlive: isAliveImpl, liveStaleMs: LIVE_STALE_MS });
      // Sessão atual; se não há nenhuma aberta, mostra a ÚLTIMA (o painel parado ainda
      // conta o que aconteceu na última sessão, em vez de zerar tudo).
      const all = readSessions().sessions;
      const session = currentSession()
        ?? all.slice().sort((a, b) => Date.parse(b.startedAt ?? b.requestedAt ?? 0) - Date.parse(a.startedAt ?? a.requestedAt ?? 0))[0]
        ?? null;
      // Sessão em andamento mostra os números do LEDGER (fonte da verdade), não só o que
      // a telemetria reportou: histórico e painel contam a mesma coisa.
      const liveSession = session && !session.endedAt
        ? { ...session, stats: summarize(readTradesLedger().trades.filter((t) => t.sessionId === session.id)) }
        : session;
      const startedAt = live?.startedAt ? new Date(live.startedAt).toISOString() : session?.startedAt ?? null;
      return {
        state: stateName,
        pid: state.pid,
        sessionId: state.sessionId,
        startedAt,
        uptimeMs: startedAt ? Date.now() - Date.parse(startedAt) : 0,
        live: live ?? null,
        session: liveSession,
        lastExit: state.lastExit,
        errors: state.errors,
        logFile: state.logFile,
      };
    },

    stake() {
      const live = readLive();
      const cfg = readJson(paths.config, {});
      const configured = Number(cfg?.trading?.baseStake ?? 2);
      const running = api.snapshot().state !== 'STOPPED';
      // NUNCA mostrar um valor e operar outro: parado, vale o configurado; rodando, vale
      // o que o processo realmente carregou no boot (telemetria do próprio bot).
      const applied = running ? Number(live?.config?.baseStake ?? configured) : configured;
      const maxStake = Number(cfg?.risk?.maxStake ?? 30);
      const mult = Number(cfg?.martingale?.martingaleMultiplier ?? 2.75);
      const positions = 1 + Math.max(0, Math.round(Number(cfg?.strategy?.pyramidMax ?? 1)));
      const safeMax = Math.round((maxStake / (mult * positions)) * 100) / 100;
      return {
        configured, applied,
        pending: Math.abs(configured - applied) > 0.001,
        currency: live?.currencySymbol ?? 'R$',
        min: 1, max: safeMax, maxStake,
      };
    },

    setStake(value) {
      const stake = api.stake();
      const num = Math.round(Number(value) * 100) / 100;
      if (!Number.isFinite(num) || num < stake.min) return { ok: false, code: 'STAKE_INVALID', message: `valor mínimo ${stake.min}` };
      if (num > stake.max) return { ok: false, code: 'STAKE_TOO_HIGH', message: `valor máximo seguro ${stake.max} (senão a ordem de recuperação estoura o teto por ordem de ${stake.maxStake})` };
      const raw = safeRead(paths.config);
      if (!raw) return { ok: false, code: 'CONFIG_UNREADABLE' };
      let patched;
      try { patched = patchBaseStake(raw, num); } catch (err) { return { ok: false, code: 'CONFIG_PATCH_FAILED', message: String(err?.message ?? err) }; }
      const tmp = `${paths.config}.tmp`;
      fs.writeFileSync(tmp, patched);
      fs.renameSync(tmp, paths.config);
      const readBack = Number(readJson(paths.config, {})?.trading?.baseStake);
      if (readBack !== num) {                       // read-back obrigatório
        fs.writeFileSync(paths.config, raw);        // volta o original: NUNCA mostrar um valor e operar outro
        return { ok: false, code: 'READBACK_MISMATCH', message: `read-back ${readBack} != ${num}` };
      }
      pushEvent({ at: new Date().toISOString(), kind: 'stake', level: 'info', text: `valor fixo salvo: ${stake.currency}${num.toFixed(2)} (aplica no próximo start; o bot lê a config no boot)` });
      return { ok: true, ...api.stake() };
    },

    start,
    stop,
    adopt,
    engineInfo: () => {
      const cfg = readJson(paths.config, {});
      const { login, ...safeCfg } = cfg ?? {};
      return { fingerprint: (() => { try { return engineFingerprint(paths.engine); } catch { return null; } })(), config: safeCfg };
    },
  };
  return api;
}
