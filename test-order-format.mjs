// Teste com formato alternativo
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

  const ws = new IqWsClient({ log: (m) => console.log('[WS]', m) });

  let balanceId = null;

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    const balances = p?.balances ?? [];
    const mainBal = balances.find(b => Number(b.amount) > 0) ?? balances[0];
    balanceId = mainBal?.id ?? null;
    console.log(`[PERFIL] balanceId=${balanceId}`);
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  while (balanceId === null) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`[OK] balanceId=${balanceId}`);

  // Tentar com digital-options ao invés de binary-options
  console.log('\n=== Teste 1: binary-options.open-option ===');
  const msgId1 = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send('sendMessage', {
    body: {
      price: 2,
      active_id: 76,
      expired: 2,
      direction: 'call',
      option_type_id: 3,
      user_balance_id: Number(balanceId)
    },
    name: 'binary-options.open-option',
    version: '1.0'
  }, msgId1);
  console.log(`[ENVIADO] ${msgId1}`);

  await new Promise(r => setTimeout(r, 3000));

  // Tentar com digital-options
  console.log('\n=== Teste 2: digital-options.place-digital-option ===');
  const msgId2 = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send('sendMessage', {
    body: {
      price: 2,
      active_id: 76,
      expired: 2,
      direction: 'call',
      option_type: 'turbo',
      user_balance_id: Number(balanceId)
    },
    name: 'digital-options.place-digital-option',
    version: '2.0'
  }, msgId2);
  console.log(`[ENVIADO] ${msgId2}`);

  await new Promise(r => setTimeout(r, 3000));

  // Tentar com instrument-trade.new-order
  console.log('\n=== Teste 3: instrument-trade.new-order ===');
  const msgId3 = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send('sendMessage', {
    name: 'instrument-trade.new-order',
    version: '1.0',
    body: {
      active_id: 76,
      direction: 'buy',
      amount: 2,
      type: 2, // turbo
      expired_epoch: Math.floor(Date.now() / 1000) + 120, // 2 min
      user_balance_id: Number(balanceId)
    }
  }, msgId3);
  console.log(`[ENVIADO] ${msgId3}`);

  await new Promise(r => setTimeout(r, 5000));

  ws.close();
  console.log('\n[Teste] Finalizado');
}

main().catch(e => console.error('ERRO:', e.message));
