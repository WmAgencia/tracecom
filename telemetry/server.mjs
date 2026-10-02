/**
 * PAINEL DO BOT (servidor local) — API + frontend estático. NÃO fala com a IQ.
 * =============================================================================
 * node telemetry/server.mjs            → sobe o painel (http://127.0.0.1:8787)
 * O binário do bot não muda: quem opera continua sendo `ws-otc-v15.mjs`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, readJson, fileStat } from './lib/store.mjs';
import { createRuntime } from './lib/runtime.mjs';
import { createApi, json } from './lib/api.mjs';
import { captureSnapshot, compareSnapshots } from './tools/proof-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function engineProof() {
  const before = readJson(PATHS.proofBefore, null);
  let after = null;
  try { after = captureSnapshot(); } catch (err) { return { status: 'UNKNOWN', message: String(err?.message ?? err) }; }
  if (!before) return { status: 'UNKNOWN', message: 'sem PROOF-ANTES.json', fingerprint: after.engine.engineSha256, fileHash: after.engine.fullFileSha256 };
  const res = compareSnapshots(before, after);
  return {
    status: res.ok ? 'PASS' : 'FAIL',
    fingerprint: res.engineFingerprint.after,
    fileHash: after.engine.fullFileSha256,
    changed: res.hard.map((d) => d.field),
    capturedAt: after.capturedAt,
  };
}

export function createPanelServer({ runtime = createRuntime({ log: (m) => console.log(`[PAINEL] ${m}`) }) } = {}) {
  const api = createApi({ runtime, proof: engineProof });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch((err) => json(res, 500, { ok: false, code: 'INTERNAL', message: String(err?.message ?? err) }));
      return;
    }
    if (req.method !== 'GET') return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.join(UI_DIR, rel);
    if (!file.startsWith(UI_DIR)) return json(res, 403, { ok: false, code: 'FORBIDDEN' });
    const stat = fileStat(file);
    if (!stat.exists) return json(res, 404, { ok: false, code: 'NOT_FOUND', path: rel });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return { server, runtime };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const runtime = createRuntime({ log: (m) => console.log(`[PAINEL] ${m}`) });
  const { host, port, account } = runtime.panelConfig;
  const adopted = runtime.adopt();
  runtime.ingestFromResults({ sessionId: adopted.sessionId ?? null, force: true });
  const { server } = createPanelServer({ runtime });
  server.listen(port, host, () => {
    console.log(`[PAINEL] http://${host}:${port} | conta ${account.toUpperCase()} (read-only no painel)`);
    console.log(`[PAINEL] motor: ws-otc-v15.mjs | prova: ${engineProof().status}`);
    if (adopted.adopted) console.log(`[PAINEL] sessão ${adopted.sessionId} adotada (pid ${adopted.pid})`);
  });
  const shutdown = () => { server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
