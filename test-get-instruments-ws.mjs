// Obter instrumentos digitais via WebSocket antes de operar
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

  let serverTime = null;
  let balanceId = null;
  let availableInstruments = null;

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    const balances = p?.balances ?? [];
    const practiceBal = balances.find(b => b.type === 4);
    balanceId = practiceBal?.id ?? balances[0]?.id ?? null;
    console.log('Balances:', balances.map(b => ({ id: b.id, type: b.type, amount: b.amount, currency: b.currency })));
  });

  ws.on('timeSync', (msg) => {
    serverTime = msg?.msg ?? msg;
  });

  ws.on('message', (msg) => {
    const name = msg?.name ?? '';
    const body = msg?.msg ?? msg;
    console.log(`[MSG] ${name}:`, JSON.stringify(body)?.slice(0, 500));

    if (name === 'digital-options.get-available-instruments') {
      availableInstruments = body;
    }
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  while (balanceId === null) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`balanceId=${balanceId}`);

  // Pedir instrumentos disponíveis para active_id=76 (EURUSD-OTC)
  console.log('\n=== Solicitando instrumentos disponíveis ===');
  const msgId = ws.uuid().replace(/-/g, "").slice(0, 12);
  ws.send('sendMessage', {
    body: {
      active_id: 76,
      expiration: 300  // 5 minutos
    },
    name: 'digital-options.get-available-instruments',
    version: '2.0'
  }, msgId);
  console.log(`[ENVIADO] ${msgId}`);

  await new Promise(r => setTimeout(r, 5000));
  console.log('Instrumentos:', JSON.stringify(availableInstruments, null, 2)?.slice(0, 1000));

  ws.close();
  console.log('[FIM]');
}

main().catch(e => console.error('ERRO:', e.message));
