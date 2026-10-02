// Teste para ouvir a resposta da ordem digital
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
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  while (balanceId === null) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`balanceId=${balanceId}`);

  // Ouvir TODAS as mensagens
  ws.on('message', (msg) => {
    console.log('[MSG]', JSON.stringify(msg).slice(0, 300));
  });

  // Enviar ordem digital
  const msgId = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send('sendMessage', {
    body: {
      price: 2,
      active_id: 76,
      expired: 120, // 2 minutos em segundos
      direction: 'call',
      option_type: 'turbo',
      user_balance_id: Number(balanceId)
    },
    name: 'digital-options.place-digital-option',
    version: '2.0'
  }, msgId);
  console.log(`[ENVIADO] ${msgId}`);

  await new Promise(r => setTimeout(r, 10000));

  ws.close();
}

main().catch(e => console.error('ERRO:', e.message));
