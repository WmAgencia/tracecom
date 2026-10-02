// Descobre todos os tipos de mensagem WS da IQ Option
import { IqWsClient } from './iqoption-ws.mjs';
import https from 'https';

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  // Login
  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);

  let ssid;
  try { const j = JSON.parse(loginRes.body); ssid = j.ssid ?? j.result?.ssid; }
  catch (e) {
    console.log('Login raw:', loginRes.body.slice(0, 500));
    process.exit(1);
  }
  console.log('Login OK');

  const ws = new IqWsClient('wss://iqoption.com/prizmjsapi/optimized');
  const allMsgs = new Set();
  let total = 0;

  ws.on('ready', () => {
    console.log('WS Ready - ouvindo mensagens por 30s...');

    // Escuta TODAS as mensagens via generic handler
    ws.on('message', (msg) => {
      total++;
      const name = msg?.name ?? msg?.msg?.name ?? 'unknown';
      if (!allMsgs.has(name)) {
        allMsgs.add(name);
        console.log('[NEW]', name, JSON.stringify(msg).slice(0, 150));
      }
    });
  });

  await ws.connect({ ssid, timeoutMs: 30000 });

  setTimeout(() => {
    console.log(`\n[📊] Total ${total} msgs, ${allMsgs.size} tipos únicos:`);
    for (const n of [...allMsgs].sort()) console.log('  ', n);
    ws.close();
    process.exit(0);
  }, 30000);
}

main().catch(e => { console.error(e.message); process.exit(1); });
