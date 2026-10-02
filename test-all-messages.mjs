// Escutar TODAS as mensagens para descobrir a resposta do get-instruments
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
  const seen = new Set();

  ws.on('message', (msg) => {
    const name = msg?.name ?? '';
    const body = msg?.msg ?? msg;
    if (!seen.has(name)) {
      seen.add(name);
      console.log(`[MSG] ${name}:`, JSON.stringify(body)?.slice(0, 200));
    }
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado');

  await new Promise(r => setTimeout(r, 2000));

  // Enviar get-instruments
  console.log('\n=== Enviando get-instruments (digital) ===');
  ws.send('sendMessage', {
    name: 'get-instruments',
    version: '4.0',
    body: { type: 'digital-option', instrument_types: ['digital-option'] }
  }, 'test-digital-01');

  await new Promise(r => setTimeout(r, 5000));

  // Também tentar com diferentes formatos
  console.log('\n=== Enviando get-instruments (turbo) ===');
  ws.send('sendMessage', {
    name: 'get-instruments',
    version: '4.0',
    body: { type: 'turbo-option', instrument_types: ['turbo-option'] }
  }, 'test-turbo-01');

  await new Promise(r => setTimeout(r, 5000));

  // Tentar get-options
  console.log('\n=== Enviando get-options (turbo) ===');
  ws.send('sendMessage', {
    name: 'get-options',
    version: '2.0',
    body: { limit: 10, instrument_type: 'turbo', user_balance_id: 1250741747 }
  }, 'test-options-01');

  await new Promise(r => setTimeout(r, 5000));

  console.log('\nMensagens vistas:', [...seen]);
  ws.close();
  console.log('[FIM]');
}

main().catch(e => console.error('ERRO:', e.message));
