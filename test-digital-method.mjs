// Testar placeDigitalOrderAndWait do IqWsClient
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

  let balanceId = null;

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    const balances = p?.balances ?? [];
    const practiceBal = balances.find(b => b.type === 4);
    balanceId = practiceBal?.id ?? balances[0]?.id ?? null;
  });

  ws.on('message', (msg) => {
    const name = msg?.name ?? '';
    const body = msg?.msg ?? msg;
    console.log(`[MSG] ${name}:`, JSON.stringify(body)?.slice(0, 400));
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  while (balanceId === null) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`balanceId=${balanceId}`);

  const serverNow = Math.floor(ws.serverNow() / 1000);
  const expTime = Math.floor((ws.serverNow() / 1000 + 300) / 300) * 300;

  console.log(`serverNow=${serverNow}, expTime=${expTime}`);

  // Teste com placeDigitalOrderAndWait
  console.log('\n=== Teste placeDigitalOrderAndWait ===');
  try {
    const result = await ws.placeDigitalOrderAndWait({
      price: 2,
      activeId: 76,
      direction: 'call',
      expiration: expTime,
      balanceId: balanceId,
      timeoutMs: 10000
    });
    console.log('SUCESSO:', result);
  } catch (e) {
    console.error('ERRO:', e.message);
  }

  await new Promise(r => setTimeout(r, 3000));
  ws.close();
  console.log('[FIM]');
}

main().catch(e => console.error('ERRO:', e.message));
