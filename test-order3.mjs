// Teste para ouvir todas as mensagens
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

  const ws = new IqWsClient({ log: (m) => {} });

  let balanceId = null;

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    const balances = p?.balances ?? [];
    const mainBal = balances.find(b => Number(b.amount) > 0) ?? balances[0];
    balanceId = mainBal?.id ?? null;
    console.log(`[PERFIL] Saldo: ${mainBal?.currency ?? 'USD'} $${mainBal?.amount ?? 0} (balanceId: ${balanceId})`);
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  // Aguardar balanceId
  while (balanceId === null) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`[OK] balanceId=${balanceId}`);

  // Ouvir TODAS as mensagens
  ws.on('message', (msg) => {
    if (msg?.name === 'binary-options.open-option') {
      console.log('[OPEN-OPTION-RESP]', JSON.stringify(msg));
    }
    if (msg?.request_id && msg?.msg) {
      console.log('[MSG]', JSON.stringify(msg));
    }
  });

  // Enviar ordem
  const req = buildOrderRequest({
    price: 2,
    activeId: 76, // EURUSD
    direction: 'CALL',
    expiration: 2,
    optionTypeId: 3,
    balanceId: balanceId
  });

  const msgId = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send(req.name, req.msg, msgId);
  console.log('[ENVIADO]', msgId);

  // Aguardar
  await new Promise(r => setTimeout(r, 15000));

  ws.close();
}

main().catch(e => console.error('ERRO:', e.message));
