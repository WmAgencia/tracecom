/**
 * API DO PAINEL — só leitura do motor + os dois comandos que existem no fluxo atual
 * (ATIVAR/DESATIVAR). Recebe o runtime por injeção para poder ser testada isolada.
 */
import { aggregate, rangeStart } from './stats.mjs';

export function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export function connectionOf(live) {
  if (!live) return { ws: 'OFFLINE', feed: 'NO_FEED', candles: 0, warmup: false, universe: null, phase: 'booting', stale: true };
  const phase = live.phase ?? 'booting';
  return {
    ws: phase === 'running' ? 'CONNECTED' : phase === 'connecting' ? 'CONNECTING' : 'OFFLINE',
    feed: live.closedCandles > 0 && phase === 'running' ? 'LIVE' : 'NO_FEED',
    candles: live.closedCandles ?? 0,
    warmup: live.warmupDone === true,
    phase,
    universe: live.universe ?? null,
    updatedAt: live.updatedAt ?? null,
    stale: live.updatedAt ? Date.now() - Date.parse(live.updatedAt) > 6_000 : true,
  };
}

export function createApi({ runtime, proof = () => ({ status: 'UNKNOWN' }) }) {
  const historyFor = (range, limit) => {
    const from = rangeStart(range);
    const at = (t) => Date.parse(t?.settledAt ?? t?.sentAt ?? 0) || 0;
    const trades = runtime.readTrades().trades.filter((t) => at(t) >= from).sort((a, b) => at(b) - at(a));
    const sessions = runtime.readSessions().sessions
      .filter((s) => Date.parse(s.startedAt ?? s.requestedAt ?? 0) >= from)
      .sort((a, b) => Date.parse(b.startedAt ?? b.requestedAt ?? 0) - Date.parse(a.startedAt ?? a.requestedAt ?? 0));
    return { range, from: new Date(from).toISOString(), trades: trades.slice(0, limit), tradesTotal: trades.length, sessions: sessions.slice(0, 50) };
  };

  return async function handle(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/health') return json(res, 200, { ok: true, at: new Date().toISOString(), account: runtime.panelConfig.account });

    if (route === 'GET /api/engine') {
      const info = runtime.engineInfo();
      const proofInfo = proof();
      return json(res, 200, {
        ok: true,
        engine: { rev: 'V16', fingerprint: info.fingerprint, fileHash: proofInfo.fileHash ?? null },
        proof: proofInfo,
        account: { mode: runtime.panelConfig.account, readOnly: true },
        paths: {
          orders: 'binary-options.open-option (dentro do bot, único ponto)',
          stop: 'telemetry/control.json → shutdown() da tecla K',
          start: `node ws-otc-v15.mjs ${runtime.panelConfig.account}`,
        },
        config: {
          trading: info.config?.trading ?? null,
          strategy: info.config?.strategy ?? null,
          risk: info.config?.risk ?? null,
          sell: info.config?.sell ?? null,
          universe: info.config?.universe ?? null,
          stop: info.config?.stop ?? null,
        },
      });
    }

    if (route === 'GET /api/runtime') {
      const snap = runtime.snapshot();
      return json(res, 200, {
        ok: true,
        account: { mode: runtime.panelConfig.account, label: runtime.panelConfig.account === 'real' ? 'REAL' : 'PRACTICE (demo)', readOnly: true },
        state: snap.state,
        pid: snap.pid,
        sessionId: snap.sessionId,
        startedAt: snap.startedAt,
        uptimeMs: snap.uptimeMs,
        session: snap.session,
        live: snap.live,
        connection: connectionOf(snap.live),
        stake: runtime.stake(),
        lastExit: snap.lastExit,
        errors: snap.errors,
      });
    }

    if (route === 'POST /api/runtime/start') {
      const body = (await readBody(req)) ?? {};
      const result = runtime.start({ confirmReal: body.confirm ?? null });
      return json(res, result.ok ? 200 : 409, result);
    }

    if (route === 'POST /api/runtime/stop') {
      const body = (await readBody(req)) ?? {};
      const result = runtime.stop({ force: body.force === true });
      return json(res, result.ok ? 200 : 409, result);
    }

    if (route === 'GET /api/stake') return json(res, 200, { ok: true, ...runtime.stake() });

    if (route === 'POST /api/stake') {
      const body = (await readBody(req)) ?? {};
      const result = runtime.setStake(body.value);
      return json(res, result.ok ? 200 : 400, result);
    }

    if (route === 'GET /api/stats') {
      const trades = runtime.readTrades().trades;
      const sessions = runtime.readSessions().sessions;
      const agg = aggregate(trades);
      const countSessions = (fromMs) => sessions.filter((s) => Date.parse(s.startedAt ?? s.requestedAt ?? 0) >= fromMs).length;
      return json(res, 200, {
        ok: true, ...agg,
        sessions: {
          day: countSessions(Date.parse(agg.from.day)),
          week: countSessions(Date.parse(agg.from.week)),
          month: countSessions(Date.parse(agg.from.month)),
          all: sessions.length,
        },
        today: agg.ranges.day,
      });
    }

    if (route === 'GET /api/history') {
      const q = url.searchParams.get('range');
      const range = ['day', 'week', 'month', 'all'].includes(q) ? q : 'all';
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      return json(res, 200, { ok: true, ...historyFor(range, limit) });
    }

    if (route === 'GET /api/events') {
      const limit = Math.min(400, Math.max(1, Number(url.searchParams.get('limit')) || 80));
      return json(res, 200, { ok: true, events: runtime.events().slice(-limit).reverse() });
    }

    if (route === 'GET /api/log') {
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('tail')) || 200));
      const file = runtime.logFile();
      if (!file) return json(res, 200, { ok: true, lines: [] });
      const { fileStat } = await import('./store.mjs');
      const stat = fileStat(file);
      if (!stat.exists) return json(res, 200, { ok: true, lines: [] });
      const fs = await import('node:fs');
      return json(res, 200, { ok: true, lines: fs.readFileSync(file, 'utf8').split('\n').slice(-limit) });
    }

    return json(res, 404, { ok: false, code: 'NOT_FOUND', route });
  };
}
