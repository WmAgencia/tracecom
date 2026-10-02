// Diagnóstico READ-ONLY da hidratação do boot do bot (login + get-candles).
// NÃO envia ordens. Mede: tempo por chunk, timeouts, prontos e se a IQ ecoa request_id.
import fs from 'fs';
import https from 'https';
import { IqWsClient } from '../iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../bot-config-v15.json', import.meta.url), 'utf8'));
const t0 = Date.now();
const ms = () => Date.now() - t0;

async function login() {
  const postData = JSON.stringify({ identifier: CONFIG.login.email, password: CONFIG.login.password });
  const body = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
    }, (res) => { let text = ''; res.on('data', (d) => text += d); res.on('end', () => resolve(text)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  const parsed = JSON.parse(body);
  const ssid = parsed.result?.ssid ?? parsed.ssid;
  if (!ssid) throw new Error('LOGIN_SEM_SSID');
  return ssid;
}

const client = new IqWsClient({ log: (...a) => console.log('[ws]', ...a) });
let candleMsgs = 0, semRequestId = 0, amostra = null;
client.on('message', (m) => {
  if (m?.name !== 'candles') return;
  candleMsgs++;
  const rid = m?.request_id ?? m?.requestId ?? null;
  if (rid === null) semRequestId++;
  if (!amostra) amostra = { request_id: rid, keysTopo: Object.keys(m), keysMsg: Object.keys(m?.msg ?? {}), candles: m?.msg?.candles?.length ?? null };
});

async function main() {
  const ssid = await login();
  console.log(`[${ms()}ms] LOGIN OK`);
  await client.connect({ ssid });
  console.log(`[${ms()}ms] WS conectado`);
  const init = (await client.getInitializationData())?.msg ?? {};
  const turbo = init?.turbo?.actives ?? {};
  const todas = Object.entries(turbo).map(([id, a]) => ({ id: Number(id), name: a?.name, enabled: a?.enabled, is_suspended: a?.is_suspended }));
  const usaveis = todas.filter((r) => r.name && /otc/i.test(r.name) && r.enabled !== false && r.is_suspended !== true);
  console.log(`[${ms()}ms] OTC usáveis: ${usaveis.length} (turbo total: ${todas.length})`);

  const CHUNK = 10;
  let prontos = 0;
  const stats = [];
  const total = usaveis.length;
  for (let i = 0; i < total; i += CHUNK) {
    const chunk = usaveis.slice(i, i + CHUNK);
    const c0 = Date.now();
    await Promise.all(chunk.map(async (row) => {
      const r = { name: row.name, h5: null, h1: null, t5: 0, t1: 0 };
      try { const s = Date.now(); const h5 = await client.getCandlesHistory({ activeId: row.id, size: 5, count: 120 }); r.t5 = Date.now() - s; r.h5 = h5?.msg?.candles?.length ?? 0; }
      catch (e) { r.h5 = `ERR:${e?.code ?? e?.message}`; }
      try { const s = Date.now(); const h1 = await client.getCandlesHistory({ activeId: row.id, size: 60, count: 30 }); r.t1 = Date.now() - s; r.h1 = h1?.msg?.candles?.length ?? 0; }
      catch (e) { r.h1 = `ERR:${e?.code ?? e?.message}`; }
      if (typeof r.h5 === 'number' && typeof r.h1 === 'number' && r.h5 >= 20 && r.h1 >= 1) prontos++;
      stats.push(r);
    }));
    console.log(`[${ms()}ms] chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(total / CHUNK)} em ${Date.now() - c0}ms | prontos: ${prontos}`);
  }
  console.log(`[${ms()}ms] HIDRATAÇÃO: ${prontos}/${total} prontos`);
  console.log(`[${ms()}ms] mensagens 'candles': ${candleMsgs} | sem request_id: ${semRequestId}`);
  console.log('amostra:', JSON.stringify(amostra));
  const lentas = stats.filter((s) => (s.t5 || 0) > 3000 || (s.t1 || 0) > 3000 || typeof s.h5 === 'string' || typeof s.h1 === 'string');
  console.log(`chamadas lentas/falhas: ${lentas.length}`);
  for (const s of lentas.slice(0, 25)) console.log('  ', s.name, '| h5', s.h5, `${s.t5}ms`, '| h1', s.h1, `${s.t1}ms`);

  // Sonda de concorrência (ids distintos) — h5 e h1 ao MESMO tempo para 2 ativos.
  const probe = usaveis.slice(0, 2);
  for (const row of probe) {
    const s = Date.now();
    const [a, b] = await Promise.all([
      client.getCandlesHistory({ activeId: row.id, size: 5, count: 120 }).then((m) => ({ ok: true, n: m?.msg?.candles?.length ?? 0, rid: m?.request_id ?? null })).catch((e) => ({ ok: false, err: e?.code })),
      client.getCandlesHistory({ activeId: row.id, size: 60, count: 30 }).then((m) => ({ ok: true, n: m?.msg?.candles?.length ?? 0, rid: m?.request_id ?? null })).catch((e) => ({ ok: false, err: e?.code })),
    ]);
    console.log(`[${ms()}ms] sonda paralela ${row.name}: 5s=${JSON.stringify(a)} 60s=${JSON.stringify(b)} em ${Date.now() - s}ms`);
  }

  console.log(`[${ms()}ms] FIM — nenhuma ordem enviada`);
  try { client.close(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('FALHA', e); process.exit(1); });
