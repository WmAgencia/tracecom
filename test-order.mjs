// Script de teste para order
import https from 'https';
import CONFIG from './bot-config-v13.json' with { type: 'json' };
import { IqWsClient, buildOrderRequest } from './iqoption-ws.mjs';

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
    console.log(`Saldo: ${mainBal?.currency ?? 'USD'} $${mainBal?.amount ?? 0} (balanceId: ${balanceId})`);
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('WS Conectado');

  // Testar com EURUSD (id: 76)
  const testAsset = 76;
  const testDirection = 'CALL';
  const testStake = 2;
  const testExpiration = 2; // minutos

  console.log(`\nTestando ordem: EURUSD | ${testDirection} | $${testStake} | ${testExpiration}min`);

  // Mostrar o request que será enviado
  const req = buildOrderRequest({
    price: testStake,
    activeId: testAsset,
    direction: testDirection,
    expiration: testExpiration,
    optionTypeId: 3,
    balanceId: balanceId
  });
  console.log('Request:', JSON.stringify(req, null, 2));

  try {
    const result = await ws.placeOrderAndWait({
      price: testStake,
      activeId: testAsset,
      direction: testDirection,
      expiration: testExpiration,
      optionTypeId: 3,
      balanceId: balanceId,
      timeoutMs: 30_000,
    });
    console.log('Resultado:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('ERRO:', e.message);
  }

  // Aguardar resultado
  await new Promise(r => setTimeout(r, 5000));
  ws.close();
}

main().catch(e => console.error('ERRO FATAL:', e.message));
