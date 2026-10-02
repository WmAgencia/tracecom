// Capturar TODAS as mensagens sem predicado
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
  const allMessages = [];
  let msgCount = 0;

  // Capturar todas as mensagens
  ws.on('message', (msg) => {
    msgCount++;
    const name = msg?.name ?? '';
    const body = msg?.msg ?? msg;
    allMessages.push({ name, body, request_id: msg?.request_id });
    if (msgCount <= 30) {
      console.log(`[${msgCount}] name=${name} request_id=${msg?.request_id}`, JSON.stringify(body)?.slice(0, 300));
    }
  });

  // Capturar timeSync separadamente
  ws.on('timeSync', (msg) => { /* skip */ });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Conectado\n');

  await new Promise(r => setTimeout(r, 2000));

  // Enviar get-instruments
  console.log('\n--- Enviando get-instruments ---');
  ws.send('sendMessage', {
    name: 'get-instruments',
    version: '4.0',
    body: { type: 'turbo-option', instrument_types: ['turbo-option'] }
  }, 'inst-turbo-001');

  await new Promise(r => setTimeout(r, 8000));

  console.log('\n--- Todas as mensagens únicas ---');
  const uniqueNames = [...new Set(allMessages.map(m => m.name))];
  console.log('Nomes únicos:', uniqueNames);

  console.log('\n--- Mensagens relacionadas a instruments/options ---');
  const relevant = allMessages.filter(m =>
    m.name?.toLowerCase().includes('instr') ||
    m.name?.toLowerCase().includes('option') ||
    m.name?.toLowerCase().includes('get') ||
    m.name?.toLowerCase().includes('result')
  );
  console.log(JSON.stringify(relevant, null, 2));

  ws.close();
  console.log('\n[FIM]');
}

main().catch(e => console.error('ERRO:', e.message));
