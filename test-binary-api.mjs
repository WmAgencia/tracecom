// Testar binary-options.open-option (API do v10)
import https from 'https';
import CONFIG from './bot-config-v13.json' with { type: 'json' };
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

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
    console.log('Balances:', balances.map(b => ({ id: b.id, type: b.type, amount: b.amount })));
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

  // Calcular expiração para 2 minutos
  const serverNowSec = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
  const { expiration, optionTypeId } = computeExpiration(serverNowSec, 2);
  console.log(`serverNow=${serverNowSec}, expiration=${expiration}, optionTypeId=${optionTypeId}`);

  // Teste com binary-options.open-option (como v10)
  console.log('\n=== Teste binary-options.open-option (TURBO 2min) ===');
  ws.send('sendMessage', {
    body: {
      price: 2,
      active_id: 76,  // EURUSD-OTC
      expired: expiration,
      direction: 'call',
      option_type_id: optionTypeId,
      user_balance_id: Number(balanceId)
    },
    name: 'binary-options.open-option',
    version: '1.0'
  }, ws.uuid().replace(/-/g, "").slice(0, 12));
  console.log('[ENVIADO]');

  await new Promise(r => setTimeout(r, 5000));

  ws.close();
  console.log('[FIM]');
}

main().catch(e => console.error('ERRO:', e.message));
