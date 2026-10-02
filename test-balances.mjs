// Verificar saldos
import https from 'https';
import CONFIG from './bot-config-v13.json' with { type: 'json' };
import { IqWsClient } from './iqoption-ws.mjs';

const LOGIN = CONFIG.login;

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function loginIQ() {
  const data = JSON.stringify({ identifier: LOGIN.email, password: LOGIN.password });
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
  }, data);
  const j = JSON.parse(res.body);
  return j.ssid ?? j.result?.ssid;
}

async function main() {
  console.log('Login...');
  const ssid = await loginIQ();
  console.log('Logado!');

  const ws = new IqWsClient({ log: (m) => {} });

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    console.log('=== PROFILE ===');
    console.log('balance:', p.balance);
    console.log('balance_id:', p.balance_id);
    console.log('balance_type:', p.balance_type);
    console.log('=== BALANCES ===');
    for (const b of (p?.balances ?? [])) {
      console.log(`  id=${b.id} type=${b.type} amount=${b.amount} currency=${b.currency ?? '?'}`);
    }
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');
  await new Promise(r => setTimeout(r, 3000));
  ws.close();
}

main().catch(e => console.error('ERRO:', e.message));
